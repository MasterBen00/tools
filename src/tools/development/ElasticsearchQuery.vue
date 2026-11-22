<script setup lang="ts">
import { computed, ref } from "vue";
import { useStorage } from "@vueuse/core";
import { ClipboardPaste, Plus, Sparkles, Trash2, X } from "lucide-vue-next";
import { Btn, CodeArea, CodeBlock, CopyButton, Notice, Panel, Tabs, ToolPage } from "@/components/ui";
import { useHandoff } from "@/composables/handoff";
import { readClipboard } from "@/composables/useClipboard";

type Occur = "must" | "filter" | "should" | "must_not";
type QType = "match" | "match_phrase" | "multi_match" | "term" | "terms" | "range" | "exists" | "prefix" | "wildcard" | "nested";
type AggType = "terms" | "date_histogram" | "range" | "avg" | "sum" | "min" | "max" | "cardinality";

interface Leaf {
    type: QType;
    field: string;
    value: string;
    gt: string;
    gte: string;
    lt: string;
    lte: string;
}
interface Clause extends Leaf {
    id: number;
    occur: Occur;
    inner: Leaf;
}
interface SortRow {
    id: number;
    field: string;
    order: "asc" | "desc";
}
interface AggRow {
    id: number;
    name: string;
    type: AggType;
    field: string;
    size: number;
    interval: string;
    ranges: string;
    sub: boolean;
    subName: string;
    subType: AggType;
    subField: string;
}
interface Builder {
    index: string;
    clauses: Clause[];
    msm: string;
    size: number;
    from: number;
    sorts: SortRow[];
    source: string;
    aggs: AggRow[];
}

const OCCURS: Occur[] = ["must", "filter", "should", "must_not"];
const QTYPES: QType[] = ["match", "match_phrase", "multi_match", "term", "terms", "range", "exists", "prefix", "wildcard", "nested"];
const LEAF_TYPES = QTYPES.filter((t) => t !== "nested");
const AGG_TYPES: AggType[] = ["terms", "date_histogram", "range", "avg", "sum", "min", "max", "cardinality"];
const BUCKET_AGGS: AggType[] = ["terms", "date_histogram", "range"];
const RANGE_OPS = ["gte", "gt", "lte", "lt"] as const;
const INTERVALS = ["minute", "hour", "day", "week", "month", "quarter", "year"];

let nextId = Date.now();
const leaf = (type: QType = "match", field = "", value = "", r: Partial<Leaf> = {}): Leaf => ({ type, field, value, gt: "", gte: "", lt: "", lte: "", ...r });
const clause = (occur: Occur, l: Leaf, inner: Leaf = leaf("term")): Clause => ({ id: nextId++, occur, ...l, inner });
const agg = (r: Partial<AggRow>): AggRow => ({
    id: nextId++, name: "agg", type: "terms", field: "", size: 10, interval: "month", ranges: "", sub: false, subName: "", subType: "avg", subField: "", ...r,
});

const sampleBuilder = (): Builder => ({
    index: "articles",
    clauses: [
        clause("must", leaf("multi_match", "title^2, body", "spring boot elasticsearch")),
        clause("filter", leaf("term", "status", "published")),
        clause("filter", leaf("range", "published_at", "", { gte: "now-1y/d" })),
        clause("should", leaf("terms", "tags", "java, spring")),
        clause("must_not", leaf("exists", "deleted_at")),
        clause("filter", leaf("nested", "comments"), leaf("range", "comments.rating", "", { gte: "4" })),
    ],
    msm: "",
    size: 20,
    from: 0,
    sorts: [{ id: nextId++, field: "published_at", order: "desc" }, { id: nextId++, field: "_score", order: "desc" }],
    source: "title, author, published_at, tags",
    aggs: [
        agg({ name: "by_author", type: "terms", field: "author.keyword", size: 10, sub: true, subName: "avg_rating", subType: "avg", subField: "rating" }),
        agg({ name: "per_month", type: "date_histogram", field: "published_at", interval: "month" }),
    ],
});

const tab = useStorage<"builder" | "format">("devtools:elasticsearch-query-builder:tab", "builder");
const b = useStorage<Builder>("devtools:elasticsearch-query-builder:builder", sampleBuilder(), undefined, { mergeDefaults: true });
const outTab = ref<"json" | "kibana" | "curl" | "spring">("kibana");

// ---------------------------------------------------------------- builder → DSL
function typed(s: string): string | number | boolean {
    const t = s.trim();
    if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(t)) return Number(t);
    if (t === "true" || t === "false") return t === "true";
    return t;
}
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function leafDsl(l: Leaf, inner?: Leaf): Record<string, unknown> {
    const f = l.field.trim() || "field";
    switch (l.type) {
        case "match": return { match: { [f]: l.value } };
        case "match_phrase": return { match_phrase: { [f]: l.value } };
        case "multi_match": return { multi_match: { query: l.value, fields: list(l.field) } };
        case "term": return { term: { [f]: typed(l.value) } };
        case "terms": return { terms: { [f]: list(l.value).map(typed) } };
        case "range": {
            const r: Record<string, unknown> = {};
            for (const op of ["gt", "gte", "lt", "lte"] as const) if (l[op].trim()) r[op] = typed(l[op]);
            return { range: { [f]: r } };
        }
        case "exists": return { exists: { field: f } };
        case "prefix": return { prefix: { [f]: l.value } };
        case "wildcard": return { wildcard: { [f]: { value: l.value } } };
        case "nested": return { nested: { path: f, query: inner ? leafDsl(inner) : { match_all: {} } } };
    }
}

function aggDsl(type: AggType, a: Pick<AggRow, "field" | "size" | "interval" | "ranges">): Record<string, unknown> {
    const field = a.field.trim() || "field";
    if (type === "terms") return { terms: { field, size: Number(a.size) || 10 } };
    if (type === "date_histogram") return { date_histogram: { field, calendar_interval: a.interval || "month" } };
    if (type === "range") {
        const ranges = list(a.ranges).map((r) => {
            const [from, to] = r.split("-").map((x) => x.trim());
            const o: Record<string, number> = {};
            if (from) o.from = Number(from);
            if (to) o.to = Number(to);
            return o;
        });
        return { range: { field, ranges: ranges.length ? ranges : [{ to: 100 }, { from: 100 }] } };
    }
    return { [type]: { field } };
}

const body = computed(() => {
    const v = b.value;
    const out: Record<string, unknown> = {};
    if (!v.clauses.length) out.query = { match_all: {} };
    else {
        const bool: Record<string, unknown> = {};
        for (const o of OCCURS) {
            const cs = v.clauses.filter((c) => c.occur === o);
            if (cs.length) bool[o] = cs.map((c) => leafDsl(c, c.type === "nested" ? c.inner : undefined));
        }
        if (v.msm.trim() && bool.should) bool.minimum_should_match = typed(v.msm);
        out.query = { bool };
    }
    out.size = Number(v.size) || 0;
    if (Number(v.from) > 0) out.from = Number(v.from);
    const sorts = v.sorts.filter((s) => s.field.trim());
    if (sorts.length) out.sort = sorts.map((s) => ({ [s.field.trim()]: { order: s.order } }));
    if (list(v.source).length) out._source = { includes: list(v.source) };
    if (v.aggs.length) {
        const aggs: Record<string, unknown> = {};
        for (const a of v.aggs) {
            const node = aggDsl(a.type, a);
            if (a.sub && BUCKET_AGGS.includes(a.type) && a.subField.trim())
                node.aggs = { [a.subName.trim() || "sub"]: aggDsl(a.subType, { field: a.subField, size: 10, interval: "month", ranges: "" }) };
            aggs[a.name.trim() || `agg_${a.id}`] = node;
        }
        out.aggs = aggs;
    }
    return out;
});

const json = computed(() => JSON.stringify(body.value, null, 2));
const index = computed(() => b.value.index.trim() || "my-index");
const kibana = computed(() => `GET ${index.value}/_search\n${json.value}`);
const curl = computed(
    () => `curl -X GET "http://localhost:9200/${index.value}/_search?pretty" \\\n  -H 'Content-Type: application/json' \\\n  -d '${json.value.replace(/'/g, "'\\''")}'`,
);

// ---------------------------------------------------------------- Spring Data Elasticsearch hint (elasticsearch-java 8.15+ style)
const js = (s: string) => JSON.stringify(s);
function javaValue(s: string) {
    const v = typed(s);
    return typeof v === "number" ? (Number.isInteger(v) ? `${v}L` : String(v)) : typeof v === "boolean" ? String(v) : js(v);
}
function javaLeaf(l: Leaf, p: string, inner?: Leaf, depth = 0): string {
    const f = js(l.field.trim() || "field");
    const x = depth ? "y" : "x";
    switch (l.type) {
        case "match": return `${p}.match(${x} -> ${x}.field(${f}).query(${js(l.value)}))`;
        case "match_phrase": return `${p}.matchPhrase(${x} -> ${x}.field(${f}).query(${js(l.value)}))`;
        case "multi_match": return `${p}.multiMatch(${x} -> ${x}.fields(List.of(${list(l.field).map(js).join(", ")})).query(${js(l.value)}))`;
        case "term": return `${p}.term(${x} -> ${x}.field(${f}).value(${javaValue(l.value)}))`;
        case "terms":
            return `${p}.terms(${x} -> ${x}.field(${f}).terms(tv -> tv.value(List.of(${list(l.value).map((v) => `FieldValue.of(${javaValue(v)})`).join(", ")}))))`;
        case "range": {
            const ops = (["gt", "gte", "lt", "lte"] as const).filter((o) => l[o].trim());
            const numeric = ops.every((o) => typeof typed(l[o]) === "number");
            const chain = ops.map((o) => `.${o}(${numeric ? String(Number(l[o])) + (Number.isInteger(Number(l[o])) ? ".0" : "") : js(l[o].trim())})`).join("");
            return numeric
                ? `${p}.range(${x} -> ${x}.number(n -> n.field(${f})${chain}))`
                : `${p}.range(${x} -> ${x}.date(d -> d.field(${f})${chain}))`;
        }
        case "exists": return `${p}.exists(${x} -> ${x}.field(${f}))`;
        case "prefix": return `${p}.prefix(${x} -> ${x}.field(${f}).value(${js(l.value)}))`;
        case "wildcard": return `${p}.wildcard(${x} -> ${x}.field(${f}).value(${js(l.value)}))`;
        case "nested": return `${p}.nested(${x} -> ${x}.path(${f}).query(iq -> ${inner ? javaLeaf(inner, "iq", undefined, depth + 1) : "iq.matchAll(m -> m)"}))`;
    }
}
const CAMEL: Record<Occur, string> = { must: "must", filter: "filter", should: "should", must_not: "mustNot" };
function javaAgg(type: AggType, a: Pick<AggRow, "field" | "size" | "interval">, p: string): string {
    const f = js(a.field.trim() || "field");
    if (type === "terms") return `${p}.terms(t -> t.field(${f}).size(${Number(a.size) || 10}))`;
    if (type === "date_histogram") return `${p}.dateHistogram(h -> h.field(${f}).calendarInterval(CalendarInterval.${(a.interval || "month")[0].toUpperCase() + (a.interval || "month").slice(1)}))`;
    if (type === "range") return `${p}.range(r -> r.field(${f}) /* add .ranges(...) */)`;
    return `${p}.${type}(m -> m.field(${f}))`;
}
const spring = computed(() => {
    const v = b.value;
    const lines = ["NativeQuery query = NativeQuery.builder()"];
    if (!v.clauses.length) lines.push("    .withQuery(q -> q.matchAll(m -> m))");
    else {
        lines.push("    .withQuery(q -> q.bool(b -> b");
        for (const c of v.clauses) lines.push(`        .${CAMEL[c.occur]}(m -> ${javaLeaf(c, "m", c.type === "nested" ? c.inner : undefined)})`);
        if (v.msm.trim() && v.clauses.some((c) => c.occur === "should")) lines.push(`        .minimumShouldMatch(${js(v.msm.trim())})`);
        lines.push("    ))");
    }
    const size = Number(v.size) || 10;
    const from = Number(v.from) || 0;
    lines.push(`    .withPageable(PageRequest.of(${Math.floor(from / size)}, ${size}))${from % size ? " // from is not a multiple of size: adjust" : ""}`);
    const sorts = v.sorts.filter((s) => s.field.trim());
    if (sorts.length) lines.push(`    .withSort(Sort.by(${sorts.map((s) => `Sort.Order.${s.order}(${js(s.field.trim())})`).join(", ")}))`);
    if (list(v.source).length) lines.push(`    .withSourceFilter(new FetchSourceFilterBuilder().withIncludes(${list(v.source).map(js).join(", ")}).build())`);
    for (const a of v.aggs) {
        let expr = javaAgg(a.type, a, "a");
        if (a.sub && BUCKET_AGGS.includes(a.type) && a.subField.trim())
            expr += `\n        .aggregations(${js(a.subName.trim() || "sub")}, s -> ${javaAgg(a.subType, { field: a.subField, size: 10, interval: "month" }, "s")})`;
        lines.push(`    .withAggregation(${js(a.name.trim() || "agg")}, Aggregation.of(a -> ${expr}))`);
    }
    lines.push("    .build();", "", `SearchHits<Article> hits = elasticsearchOperations.search(query, Article.class, IndexCoordinates.of(${js(index.value)}));`);
    return lines.join("\n");
});

const output = computed(() => ({ json: json.value, kibana: kibana.value, curl: curl.value, spring: spring.value })[outTab.value]);
const outLang = computed(() => ({ json: "json", kibana: "json", curl: "bash", spring: "java" })[outTab.value]);

function addClause() {
    b.value.clauses.push(clause("must", leaf("match")));
}

// ---------------------------------------------------------------- formatter / validator
const FORMAT_SAMPLE = `GET /products/_search
{
  "size": 20000,
  "query": {
    "bool": {
      "must": { "match": { "name": "wireless headphones" } },
      "filter": [
        { "term": { "brand": "Sony Electronics" } },
        { "range": { "price": { } } },
        { "wildcard": { "sku": { "value": "*-BT" } } }
      ],
      "should": [ { "match_phrase": { "description": "noise cancelling" } } ],
      "must_not": [ { "termz": { "status": "discontinued" } } ]
    }
  },
  "aggs": { "brands": { "terms": { "field": "brand.keyword" } } },
  "sorting": [ { "price": "asc" } ]
}`;
const fmtInput = useStorage("devtools:elasticsearch-query-builder:format-input", FORMAT_SAMPLE);
const minify = useStorage("devtools:elasticsearch-query-builder:minify", false);

const KNOWN_TOP = new Set([
    "query", "size", "from", "sort", "_source", "aggs", "aggregations", "post_filter", "highlight", "track_total_hits", "timeout", "min_score",
    "search_after", "collapse", "explain", "fields", "script_fields", "stored_fields", "docvalue_fields", "suggest", "rescore", "pit",
    "runtime_mappings", "knn", "indices_boost", "profile", "version", "seq_no_primary_term", "terminate_after", "track_scores", "stats",
    "retriever", "rank", "ext", "slice",
]);
const KNOWN_QUERIES = new Set([
    "bool", "match", "match_phrase", "match_phrase_prefix", "match_bool_prefix", "multi_match", "combined_fields", "query_string",
    "simple_query_string", "term", "terms", "terms_set", "range", "exists", "prefix", "wildcard", "regexp", "fuzzy", "ids", "nested",
    "has_child", "has_parent", "parent_id", "match_all", "match_none", "constant_score", "dis_max", "function_score", "boosting",
    "geo_distance", "geo_bounding_box", "geo_shape", "geo_polygon", "geo_grid", "shape", "more_like_this", "script", "script_score",
    "percolate", "wrapper", "pinned", "rank_feature", "distance_feature", "intervals", "span_term", "span_near", "span_or", "span_not",
    "span_first", "span_multi", "span_containing", "span_within", "field_masking_span", "knn", "sparse_vector", "semantic", "text_expansion",
    "weighted_tokens", "rule",
]);

interface Issue {
    level: "error" | "warning" | "info";
    path: string;
    msg: string;
}
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const FIELD_META = new Set(["boost", "_name", "case_insensitive", "rewrite"]);

function checkQuery(q: unknown, path: string, issues: Issue[]) {
    if (!isObj(q)) return issues.push({ level: "error", path, msg: "A query clause must be an object." });
    const keys = Object.keys(q);
    if (keys.length !== 1) return issues.push({ level: "error", path, msg: `A query clause must have exactly one query type, found ${keys.length ? keys.join(", ") : "none"}.` });
    const type = keys[0];
    const body = q[type];
    const p = `${path}.${type}`;
    if (!KNOWN_QUERIES.has(type)) issues.push({ level: "warning", path: p, msg: `Unknown query type "${type}".` });
    if (!isObj(body) && type !== "knn") return issues.push({ level: "error", path: p, msg: "The query body must be an object." });
    const fieldKeys = isObj(body) ? Object.keys(body).filter((k) => !FIELD_META.has(k)) : [];
    switch (type) {
        case "bool":
            for (const [k, v] of Object.entries(body as object)) {
                if (["must", "filter", "should", "must_not"].includes(k)) {
                    if (Array.isArray(v)) v.forEach((c, i) => checkQuery(c, `${p}.${k}[${i}]`, issues));
                    else if (isObj(v)) checkQuery(v, `${p}.${k}`, issues);
                    else issues.push({ level: "error", path: `${p}.${k}`, msg: `${k} must be an object or an array of objects.` });
                } else if (!["minimum_should_match", "boost", "_name"].includes(k)) {
                    issues.push({ level: "warning", path: `${p}.${k}`, msg: `Unknown bool option "${k}".` });
                }
            }
            break;
        case "term":
            for (const f of fieldKeys) {
                const raw = (body as Record<string, unknown>)[f];
                const v = isObj(raw) ? raw.value : raw;
                if (typeof v === "string" && (/\s/.test(v) || /[A-Z]/.test(v)) && !f.endsWith(".keyword"))
                    issues.push({ level: "info", path: `${p}.${f}`, msg: `term is not analyzed. "${v}" has spaces or capitals, so on a text field it will not match; use match, or ${f}.keyword.` });
            }
            break;
        case "range":
            for (const f of fieldKeys) {
                const r = (body as Record<string, unknown>)[f];
                if (!isObj(r) || !["gt", "gte", "lt", "lte", "from", "to"].some((k) => k in r))
                    issues.push({ level: "error", path: `${p}.${f}`, msg: "range needs at least one of gt, gte, lt or lte." });
            }
            break;
        case "wildcard":
            for (const f of fieldKeys) {
                const raw = (body as Record<string, unknown>)[f];
                const v = isObj(raw) ? (raw.value ?? raw.wildcard) : raw;
                if (typeof v === "string" && /^[*?]/.test(v))
                    issues.push({ level: "warning", path: `${p}.${f}`, msg: "A leading wildcard scans every term in the field and is slow; consider a reversed field, n-grams or the wildcard field type." });
            }
            break;
        case "nested":
        case "has_child":
        case "has_parent": {
            const o = body as Record<string, unknown>;
            if (type === "nested" && !o.path) issues.push({ level: "error", path: p, msg: "nested needs a path." });
            if (!o.query) issues.push({ level: "error", path: p, msg: `${type} needs a query.` });
            else checkQuery(o.query, `${p}.query`, issues);
            break;
        }
        case "constant_score": {
            const o = body as Record<string, unknown>;
            if (o.filter) checkQuery(o.filter, `${p}.filter`, issues);
            else issues.push({ level: "error", path: p, msg: "constant_score needs a filter." });
            break;
        }
        case "dis_max": {
            const qs = (body as Record<string, unknown>).queries;
            if (Array.isArray(qs)) qs.forEach((c, i) => checkQuery(c, `${p}.queries[${i}]`, issues));
            else issues.push({ level: "error", path: p, msg: "dis_max needs a queries array." });
            break;
        }
        case "function_score":
        case "script_score": {
            const o = body as Record<string, unknown>;
            if (o.query) checkQuery(o.query, `${p}.query`, issues);
            break;
        }
        case "boosting": {
            const o = body as Record<string, unknown>;
            for (const k of ["positive", "negative"]) {
                if (o[k]) checkQuery(o[k], `${p}.${k}`, issues);
                else issues.push({ level: "error", path: p, msg: `boosting needs ${k}.` });
            }
            break;
        }
    }
}

function checkAggs(aggs: unknown, path: string, issues: Issue[]) {
    if (!isObj(aggs)) return issues.push({ level: "error", path, msg: "aggs must be an object of named aggregations." });
    for (const [name, def] of Object.entries(aggs)) {
        const p = `${path}.${name}`;
        if (!isObj(def)) { issues.push({ level: "error", path: p, msg: "An aggregation must be an object." }); continue; }
        const types = Object.keys(def).filter((k) => !["aggs", "aggregations", "meta"].includes(k));
        if (types.length !== 1) issues.push({ level: "error", path: p, msg: `An aggregation needs exactly one type, found ${types.length ? types.join(", ") : "none"}.` });
        if (types[0] === "filter") checkQuery(def.filter, `${p}.filter`, issues);
        const sub = def.aggs ?? def.aggregations;
        if (sub !== undefined) checkAggs(sub, `${p}.aggs`, issues);
    }
}

const formatted = computed(() => {
    const raw = fmtInput.value;
    if (!raw.trim()) return { out: "", issues: [] as Issue[], error: "" };
    const lines = raw.split(/\r?\n/);
    let headerIdx = lines.findIndex((l) => l.trim());
    let header = "";
    if (headerIdx >= 0 && /^\s*(GET|POST|PUT|DELETE|HEAD)\s+\S+/i.test(lines[headerIdx])) header = lines[headerIdx].trim();
    else headerIdx = -1;
    const bodyText = header ? lines.slice(headerIdx + 1).join("\n") : raw;
    const lineOffset = header ? headerIdx + 1 : 0;
    if (!bodyText.trim()) return { out: header, issues: [], error: "" };
    let parsed: unknown;
    try {
        parsed = JSON.parse(bodyText);
    } catch (e) {
        const msg = (e as Error).message;
        let line = 0, col = 0;
        const lc = /line (\d+) column (\d+)/.exec(msg);
        const pos = /position (\d+)/.exec(msg);
        if (lc) { line = +lc[1]; col = +lc[2]; }
        else if (pos) {
            const before = bodyText.slice(0, +pos[1]).split("\n");
            line = before.length;
            col = before[before.length - 1].length + 1;
        }
        return { out: "", issues: [], error: line ? `Line ${line + lineOffset}, column ${col}: ${msg.replace(/\s*\(line \d+ column \d+\)/, "")}` : msg };
    }
    const issues: Issue[] = [];
    if (!isObj(parsed)) issues.push({ level: "error", path: "$", msg: "The request body must be a JSON object." });
    else {
        for (const k of Object.keys(parsed)) if (!KNOWN_TOP.has(k)) issues.push({ level: "warning", path: `$.${k}`, msg: `Unknown top-level key "${k}".` });
        if (parsed.query !== undefined) checkQuery(parsed.query, "$.query", issues);
        if (parsed.post_filter !== undefined) checkQuery(parsed.post_filter, "$.post_filter", issues);
        const aggs = parsed.aggs ?? parsed.aggregations;
        if (aggs !== undefined) checkAggs(aggs, "$.aggs", issues);
        const size = Number(parsed.size ?? 10);
        const from = Number(parsed.from ?? 0);
        if (size > 10000) issues.push({ level: "warning", path: "$.size", msg: "size above 10000 exceeds the default index.max_result_window; use search_after with a PIT or the scroll API." });
        else if (from + size > 10000) issues.push({ level: "warning", path: "$.from", msg: "from + size above 10000 exceeds index.max_result_window; use search_after for deep paging." });
    }
    const text = minify.value ? JSON.stringify(parsed) : JSON.stringify(parsed, null, 2);
    return { out: header ? `${header}\n${text}` : text, issues, error: "" };
});

useHandoff<{ input?: string }>("elasticsearch-query-builder", (p) => {
    if (p.input != null) {
        fmtInput.value = p.input;
        tab.value = "format";
    }
});
</script>

<template>
    <ToolPage>
        <template #actions>
            <Tabs v-model="tab" :options="[{ value: 'builder', label: 'Builder' }, { value: 'format', label: 'Format & validate' }]" />
        </template>

        <template v-if="tab === 'builder'">
            <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <label class="flex items-center gap-2"><span class="text-muted">Index</span><input v-model="b.index" class="input !w-40 font-mono" spellcheck="false" /></label>
                <label class="flex items-center gap-2"><span class="text-muted">size</span><input v-model.number="b.size" type="number" min="0" class="input !w-20" /></label>
                <label class="flex items-center gap-2"><span class="text-muted">from</span><input v-model.number="b.from" type="number" min="0" class="input !w-20" /></label>
                <label class="flex items-center gap-2" title="Only used when there are should clauses"><span class="text-muted">minimum_should_match</span><input v-model="b.msm" class="input !w-20 font-mono" placeholder="1 or 75%" /></label>
                <span class="flex-1" />
                <Btn size="sm" variant="ghost" @click="b = sampleBuilder()"><Sparkles /> Sample</Btn>
                <Btn size="sm" variant="ghost" @click="b = { index: b.index, clauses: [], msm: '', size: 10, from: 0, sorts: [], source: '', aggs: [] }"><Trash2 /> Clear</Btn>
            </div>

            <Panel title="Bool query clauses" flush>
                <template #actions><Btn size="sm" variant="ghost" @click="addClause"><Plus /> Add clause</Btn></template>
                <div class="divide-y divide-line">
                    <div v-for="(c, i) in b.clauses" :key="c.id" class="flex flex-wrap items-center gap-2 px-4 py-2">
                        <select v-model="c.occur" class="select !w-28 font-mono" aria-label="Occurrence">
                            <option v-for="o in OCCURS" :key="o" :value="o">{{ o }}</option>
                        </select>
                        <select v-model="c.type" class="select !w-36 font-mono" aria-label="Query type">
                            <option v-for="t in QTYPES" :key="t" :value="t">{{ t }}</option>
                        </select>
                        <input
                            v-model="c.field"
                            class="input !w-44 font-mono"
                            :placeholder="c.type === 'nested' ? 'path' : c.type === 'multi_match' ? 'field1^2, field2' : 'field'"
                            spellcheck="false"
                            aria-label="Field"
                        />
                        <template v-if="c.type === 'range'">
                            <input v-for="op in RANGE_OPS" :key="op" v-model="c[op]" class="input !w-28 font-mono" :placeholder="op" :aria-label="op" title="Number, date or date math such as now-7d/d" />
                        </template>
                        <template v-else-if="c.type === 'nested'">
                            <span class="text-xs text-muted">→</span>
                            <select v-model="c.inner.type" class="select !w-36 font-mono" aria-label="Inner query type">
                                <option v-for="t in LEAF_TYPES" :key="t" :value="t">{{ t }}</option>
                            </select>
                            <input v-model="c.inner.field" class="input !w-44 font-mono" placeholder="path.field" spellcheck="false" aria-label="Inner field" />
                            <template v-if="c.inner.type === 'range'">
                                <input v-for="op in RANGE_OPS" :key="op" v-model="c.inner[op]" class="input !w-24 font-mono" :placeholder="op" :aria-label="op" />
                            </template>
                            <input v-else-if="c.inner.type !== 'exists'" v-model="c.inner.value" class="input min-w-0 flex-1 font-mono" placeholder="value" aria-label="Inner value" />
                        </template>
                        <input
                            v-else-if="c.type !== 'exists'"
                            v-model="c.value"
                            class="input min-w-0 flex-1 font-mono"
                            :placeholder="c.type === 'terms' ? 'a, b, c' : c.type === 'wildcard' ? 'abc*' : 'value'"
                            aria-label="Value"
                        />
                        <span class="flex-1" />
                        <Btn size="sm" variant="ghost" title="Remove" @click="b.clauses.splice(i, 1)"><X /></Btn>
                    </div>
                    <p v-if="!b.clauses.length" class="px-4 py-3 text-sm text-muted">No clauses: the query is match_all.</p>
                </div>
            </Panel>

            <div class="grid gap-4 lg:grid-cols-2">
                <Panel title="Sort and _source">
                    <template #actions><Btn size="sm" variant="ghost" @click="b.sorts.push({ id: Date.now(), field: '', order: 'asc' })"><Plus /> Sort</Btn></template>
                    <div class="space-y-2">
                        <div v-for="(s, i) in b.sorts" :key="s.id" class="flex items-center gap-2">
                            <input v-model="s.field" class="input min-w-0 flex-1 font-mono" placeholder="field or _score" spellcheck="false" aria-label="Sort field" />
                            <Tabs v-model="s.order" size="sm" :options="[{ value: 'asc', label: 'asc' }, { value: 'desc', label: 'desc' }]" />
                            <Btn size="sm" variant="ghost" title="Remove" @click="b.sorts.splice(i, 1)"><X /></Btn>
                        </div>
                        <label class="block pt-2 text-sm">
                            <span class="label">_source includes</span>
                            <input v-model="b.source" class="input font-mono" placeholder="title, author.*" spellcheck="false" />
                        </label>
                    </div>
                </Panel>
                <Panel title="Aggregations">
                    <template #actions><Btn size="sm" variant="ghost" @click="b.aggs.push(agg({ name: `agg_${b.aggs.length + 1}` }))"><Plus /> Aggregation</Btn></template>
                    <div class="space-y-3">
                        <p v-if="!b.aggs.length" class="text-sm text-muted">No aggregations.</p>
                        <div v-for="(a, i) in b.aggs" :key="a.id" class="space-y-2 rounded-lg border border-line p-2">
                            <div class="flex flex-wrap items-center gap-2">
                                <input v-model="a.name" class="input !w-32 font-mono" placeholder="name" spellcheck="false" aria-label="Aggregation name" />
                                <select v-model="a.type" class="select !w-36 font-mono" aria-label="Aggregation type">
                                    <option v-for="t in AGG_TYPES" :key="t" :value="t">{{ t }}</option>
                                </select>
                                <input v-model="a.field" class="input min-w-0 flex-1 font-mono" placeholder="field" spellcheck="false" aria-label="Field" />
                                <Btn size="sm" variant="ghost" title="Remove" @click="b.aggs.splice(i, 1)"><X /></Btn>
                            </div>
                            <div class="flex flex-wrap items-center gap-2 text-sm">
                                <label v-if="a.type === 'terms'" class="flex items-center gap-1 text-xs text-muted">size <input v-model.number="a.size" type="number" min="1" class="input !w-20" /></label>
                                <select v-if="a.type === 'date_histogram'" v-model="a.interval" class="select !w-32" aria-label="Calendar interval">
                                    <option v-for="iv in INTERVALS" :key="iv" :value="iv">{{ iv }}</option>
                                </select>
                                <input v-if="a.type === 'range'" v-model="a.ranges" class="input min-w-0 flex-1 font-mono" placeholder="-100, 100-500, 500-" aria-label="Ranges" />
                                <label v-if="BUCKET_AGGS.includes(a.type)" class="flex items-center gap-2 text-xs"><input v-model="a.sub" type="checkbox" class="checkbox" /> Sub-aggregation</label>
                            </div>
                            <div v-if="a.sub && BUCKET_AGGS.includes(a.type)" class="flex flex-wrap items-center gap-2 pl-4">
                                <span class="text-xs text-muted">↳</span>
                                <input v-model="a.subName" class="input !w-28 font-mono" placeholder="name" spellcheck="false" aria-label="Sub-aggregation name" />
                                <select v-model="a.subType" class="select !w-32 font-mono" aria-label="Sub-aggregation type">
                                    <option v-for="t in AGG_TYPES.filter((x) => x !== 'range' && x !== 'date_histogram')" :key="t" :value="t">{{ t }}</option>
                                </select>
                                <input v-model="a.subField" class="input min-w-0 flex-1 font-mono" placeholder="field" spellcheck="false" aria-label="Sub-aggregation field" />
                            </div>
                        </div>
                    </div>
                </Panel>
            </div>

            <Panel flush>
                <template #title>Request</template>
                <template #actions>
                    <Tabs
                        v-model="outTab"
                        size="sm"
                        :options="[{ value: 'kibana', label: 'Kibana Dev Tools' }, { value: 'json', label: 'JSON body' }, { value: 'curl', label: 'curl' }, { value: 'spring', label: 'Spring Data' }]"
                    />
                    <CopyButton :text="output" />
                </template>
                <div class="max-h-[36rem] overflow-auto">
                    <CodeBlock :code="output" :language="outLang" />
                </div>
                <p v-if="outTab === 'spring'" class="border-t border-line px-4 py-2 text-xs text-muted">
                    A starting point for Spring Data Elasticsearch 5.x with the elasticsearch-java 8.15+ client (typed range builders); adjust the entity class and imports.
                </p>
            </Panel>
        </template>

        <template v-else>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <label class="flex items-center gap-2"><input v-model="minify" type="checkbox" class="checkbox" /> Minify</label>
                <span class="text-xs text-muted">Accepts a JSON body or Kibana Dev Tools format with a first line such as GET /index/_search.</span>
            </div>
            <div class="grid gap-4 lg:grid-cols-2">
                <Panel title="Query DSL" flush>
                    <template #actions>
                        <Btn size="sm" variant="ghost" @click="fmtInput = FORMAT_SAMPLE"><Sparkles /> Sample</Btn>
                        <Btn size="sm" variant="ghost" @click="async () => (fmtInput = await readClipboard())"><ClipboardPaste /> Paste</Btn>
                        <Btn size="sm" variant="ghost" :disabled="!fmtInput" @click="fmtInput = ''"><Trash2 /> Clear</Btn>
                    </template>
                    <CodeArea v-model="fmtInput" language="json" :wrap="false" height="28rem" :invalid="!!formatted.error" placeholder="Paste a search request…" />
                </Panel>
                <Panel title="Formatted" flush>
                    <template #actions>
                        <Btn size="sm" variant="ghost" :disabled="!formatted.out" @click="fmtInput = formatted.out">Use as input</Btn>
                        <CopyButton :text="formatted.out" />
                    </template>
                    <CodeArea :model-value="formatted.out" language="json" readonly :wrap="minify" height="28rem" placeholder="Formatted output appears here" />
                </Panel>
            </div>
            <Notice v-if="formatted.error" type="error">{{ formatted.error }}</Notice>
            <Notice v-else-if="formatted.out && !formatted.issues.length" type="success">Valid JSON; no problems found.</Notice>
            <Panel v-if="formatted.issues.length" :title="`${formatted.issues.length} finding${formatted.issues.length === 1 ? '' : 's'}`" flush>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead class="text-left text-xs text-muted uppercase">
                            <tr><th class="px-4 py-2 font-medium">Level</th><th class="px-4 py-2 font-medium">Path</th><th class="px-4 py-2 font-medium">Message</th></tr>
                        </thead>
                        <tbody class="divide-y divide-line border-t border-line">
                            <tr v-for="(is, i) in formatted.issues" :key="i">
                                <td class="px-4 py-2 font-medium whitespace-nowrap" :class="{ 'text-danger': is.level === 'error', 'text-warn': is.level === 'warning', 'text-accent': is.level === 'info' }">{{ is.level }}</td>
                                <td class="px-4 py-2 font-mono text-xs whitespace-nowrap">{{ is.path }}</td>
                                <td class="px-4 py-2">{{ is.msg }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </Panel>
        </template>
    </ToolPage>
</template>
