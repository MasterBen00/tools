<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStorage } from "@vueuse/core";
import { load } from "js-yaml";
import { ChevronDown, ChevronRight, ClipboardPaste, FileCode2, Search, Sparkles, Trash2 } from "lucide-vue-next";
import { Btn, CodeArea, CodeBlock, CopyButton, Notice, Panel, Tabs, ToolPage } from "@/components/ui";
import { readClipboard } from "@/composables/useClipboard";
import { useHandoff } from "@/composables/handoff";
import { SHOP_API, TASKS_SWAGGER2 } from "./openapiSamples";

// Specs are free-form documents, so a loose object type keeps the traversal readable.
type O = Record<string, any>;
type Mode = "req" | "res";

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options", "trace"];

const input = useStorage("devtools:openapi-viewer:input", SHOP_API);
const view = ref<"endpoints" | "schemas">("endpoints");
const filter = ref("");
const collapsed = ref<string[]>([]);
const selectedKey = ref("");
const selectedSchema = ref("");
const responseCode = ref("");

useHandoff<{ input?: string }>("openapi-viewer", (p) => {
    if (p.input != null) input.value = p.input;
});

const isObj = (x: unknown): x is O => x !== null && typeof x === "object" && !Array.isArray(x);

const parsed = computed<{ spec: O | null; error: string }>(() => {
    const text = input.value.trim();
    if (!text) return { spec: null, error: "" };
    try {
        const doc = text.startsWith("{") ? JSON.parse(text) : load(text);
        if (!isObj(doc)) throw new Error("The document is not an object.");
        if (!doc.openapi && !doc.swagger) throw new Error("Missing the openapi (3.x) or swagger (2.0) version field.");
        return { spec: doc, error: "" };
    } catch (e) {
        const err = e as { reason?: string; message?: string; mark?: { line: number; column: number } };
        const msg = err.mark ? `Line ${err.mark.line + 1}, column ${err.mark.column + 1}: ${err.reason ?? err.message}` : (err.message ?? String(e));
        return { spec: null, error: msg };
    }
});
const spec = computed(() => parsed.value.spec);
const isV2 = computed(() => !!spec.value?.swagger);

// ---------- $ref resolution ----------
function deref(ref: string): unknown {
    if (!spec.value || !ref.startsWith("#/")) return undefined;
    let cur: unknown = spec.value;
    for (const raw of ref.slice(2).split("/")) {
        const key = decodeURIComponent(raw.replace(/~1/g, "/").replace(/~0/g, "~"));
        if (!isObj(cur) && !Array.isArray(cur)) return undefined;
        cur = (cur as O)[key];
    }
    return cur;
}
/** Follow $ref chains on a non-schema object (parameter, response, request body). */
function resolve(x: unknown): O | null {
    let cur = x;
    for (let i = 0; i < 20 && isObj(cur) && typeof cur.$ref === "string"; i++) cur = deref(cur.$ref);
    return isObj(cur) ? cur : null;
}
const refName = (ref: string) => ref.split("/").pop() ?? ref;

// ---------- examples from schemas ----------
function stringExample(s: O): string {
    switch (s.format) {
        case "date-time": return "2026-03-14T09:30:00Z";
        case "date": return "2026-03-14";
        case "time": return "09:30:00";
        case "uuid": return "3fa85f64-5717-4562-b3fc-2c963f66afa6";
        case "email": return "user@example.com";
        case "uri":
        case "url": return "https://example.com/resource";
        case "hostname": return "example.com";
        case "ipv4": return "192.0.2.10";
        case "ipv6": return "2001:db8::1";
        case "byte": return "aGVsbG8gd29ybGQ=";
        case "binary": return "<binary>";
        case "password": return "********";
        default: return s.pattern ? `string matching ${s.pattern}` : "string";
    }
}

function example(schema: unknown, mode: Mode, seen: string[] = []): unknown {
    if (!isObj(schema) || seen.length > 14) return null;
    if (typeof schema.$ref === "string") {
        if (seen.includes(schema.$ref)) return null; // cycle
        return example(deref(schema.$ref), mode, [...seen, schema.$ref]);
    }
    if (schema.example !== undefined) return schema.example;
    if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
    if (schema.const !== undefined) return schema.const;
    if (schema.default !== undefined) return schema.default;
    if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
    if (Array.isArray(schema.allOf)) {
        let merged: unknown;
        for (const part of schema.allOf) {
            const v = example(part, mode, seen);
            if (isObj(v)) merged = { ...(isObj(merged) ? merged : {}), ...v };
            else if (merged === undefined) merged = v;
        }
        if (isObj(schema.properties)) merged = { ...(isObj(merged) ? merged : {}), ...(objectExample(schema, mode, seen) as O) };
        return merged ?? null;
    }
    const alt = schema.oneOf ?? schema.anyOf;
    if (Array.isArray(alt) && alt.length) return example(alt[0], mode, seen);
    let type = schema.type;
    if (Array.isArray(type)) type = type.find((t: string) => t !== "null") ?? "null";
    if (!type) type = schema.properties || schema.additionalProperties ? "object" : schema.items ? "array" : undefined;
    switch (type) {
        case "object": return objectExample(schema, mode, seen);
        case "array": {
            const item = example(schema.items, mode, seen);
            return item === null && isObj(schema.items) && typeof schema.items.$ref === "string" && seen.includes(schema.items.$ref) ? [] : [item];
        }
        case "string": return stringExample(schema);
        case "integer": return typeof schema.minimum === "number" ? schema.minimum : 0;
        case "number": return typeof schema.minimum === "number" ? schema.minimum : 0.0;
        case "boolean": return true;
        case "null": return null;
        default: return isObj(schema.properties) ? objectExample(schema, mode, seen) : null;
    }
}
function objectExample(schema: O, mode: Mode, seen: string[]): O {
    const out: O = {};
    for (const [k, p] of Object.entries(isObj(schema.properties) ? schema.properties : {})) {
        const flag = (k2: string) => (isObj(p) && p[k2]) || resolve(p)?.[k2];
        if (mode === "req" && flag("readOnly")) continue;
        if (mode === "res" && flag("writeOnly")) continue;
        out[k] = example(p, mode, seen);
    }
    if (!Object.keys(out).length && isObj(schema.additionalProperties)) out.key = example(schema.additionalProperties, mode, seen);
    return out;
}

// ---------- schema description ----------
function typeLabel(s: unknown): string {
    if (!isObj(s)) return "any";
    if (typeof s.$ref === "string") return refName(s.$ref);
    if (Array.isArray(s.allOf)) return s.allOf.map(typeLabel).join(" & ");
    const alt = s.oneOf ?? s.anyOf;
    if (Array.isArray(alt)) return alt.map(typeLabel).join(" | ");
    const t = Array.isArray(s.type) ? s.type.join(" | ") : s.type;
    if (t === "array") return `${typeLabel(s.items)}[]`;
    let base = t ?? (s.properties ? "object" : s.items ? "array" : "any");
    if (s.format) base += `(${s.format})`;
    if (s.nullable) base += " | null";
    return base;
}

interface Row { name: string; depth: number; type: string; required: boolean; description: string; enumVals: string; flags: string }

/** Properties of a schema after following $ref and merging allOf. */
function collectProps(schema: unknown, seen: string[]): { props: [string, O][]; required: string[]; seen: string[] } {
    const props: [string, O][] = [];
    const required: string[] = [];
    const walk = (s: unknown, sn: string[]) => {
        if (!isObj(s) || sn.length > 14) return;
        if (typeof s.$ref === "string") {
            if (sn.includes(s.$ref)) return;
            sn.push(s.$ref);
            walk(deref(s.$ref), sn);
            return;
        }
        if (Array.isArray(s.allOf)) s.allOf.forEach((p: unknown) => walk(p, sn));
        if (isObj(s.properties)) for (const [k, v] of Object.entries(s.properties)) if (isObj(v)) props.push([k, v]);
        if (Array.isArray(s.required)) required.push(...s.required);
    };
    const sn = [...seen];
    walk(schema, sn);
    return { props, required, seen: sn };
}

function schemaRows(schema: unknown, depth = 0, seen: string[] = [], out: Row[] = []): Row[] {
    if (depth > 5) return out;
    let target = schema;
    // Describe the element type for arrays at the top level.
    const top = resolve(schema);
    if (depth === 0 && top && (top.type === "array" || top.items) && !top.properties) target = top.items;
    const { props, required, seen: sn } = collectProps(target, seen);
    for (const [name, p] of props) {
        const r = resolve(p) ?? p;
        out.push({
            name,
            depth,
            type: typeLabel(p),
            required: required.includes(name),
            description: (p.description ?? r.description ?? "") as string,
            enumVals: Array.isArray(r.enum) ? r.enum.join(", ") : "",
            flags: [r.readOnly && "read-only", r.writeOnly && "write-only", r.deprecated && "deprecated"].filter(Boolean).join(", "),
        });
        let child: unknown = p;
        const childResolved = resolve(child);
        if (childResolved && (childResolved.type === "array" || childResolved.items) && !childResolved.properties) child = childResolved.items;
        if (isObj(child) && typeof child.$ref === "string" && sn.includes(child.$ref)) continue;
        const nested = collectProps(child, sn);
        if (nested.props.length) schemaRows(child, depth + 1, sn, out);
    }
    return out;
}

// ---------- operations ----------
interface Param { name: string; in: string; required: boolean; type: string; description: string; schema: O | null; example: unknown; deprecated: boolean }
interface Content { contentType: string; schema: O | null; example: unknown }
interface Resp extends Content { code: string; description: string }
interface Endpoint {
    key: string;
    method: string;
    path: string;
    summary: string;
    description: string;
    operationId: string;
    tags: string[];
    deprecated: boolean;
    params: Param[];
    body: (Content & { required: boolean; description: string }) | null;
    responses: Resp[];
    security: string[][];
}

function mediaExample(media: O, schema: O | null, mode: Mode): unknown {
    if (media.example !== undefined) return media.example;
    if (isObj(media.examples)) {
        const first = resolve(Object.values(media.examples)[0]);
        if (first && first.value !== undefined) return first.value;
    }
    return schema ? example(schema, mode) : null;
}
function pickContent(content: unknown): [string, O] | null {
    if (!isObj(content)) return null;
    const entries = Object.entries(content).filter(([, v]) => isObj(v)) as [string, O][];
    return entries.find(([k]) => /json/i.test(k)) ?? entries[0] ?? null;
}

function paramOf(raw: unknown): Param | null {
    const p = resolve(raw);
    if (!p || !p.name) return null;
    const schema: O | null = isV2.value ? (p.in === "body" ? (p.schema ?? null) : p) : (p.schema ?? (isObj(p.content) ? (pickContent(p.content)?.[1].schema ?? null) : null));
    let ex: unknown = p.example;
    if (ex === undefined && isObj(p.examples)) ex = resolve(Object.values(p.examples)[0])?.value;
    if (ex === undefined && schema) ex = example(schema, "req");
    return {
        name: p.name,
        in: p.in,
        required: !!p.required || p.in === "path",
        type: schema ? typeLabel(schema) : "any",
        description: p.description ?? "",
        schema,
        example: ex,
        deprecated: !!p.deprecated,
    };
}

const endpoints = computed<Endpoint[]>(() => {
    const s = spec.value;
    if (!s || !isObj(s.paths)) return [];
    const out: Endpoint[] = [];
    for (const [path, rawItem] of Object.entries(s.paths)) {
        const item = resolve(rawItem);
        if (!item) continue;
        const shared = Array.isArray(item.parameters) ? item.parameters : [];
        for (const method of METHODS) {
            const op = item[method];
            if (!isObj(op)) continue;
            const byKey = new Map<string, Param>();
            for (const raw of [...shared, ...(Array.isArray(op.parameters) ? op.parameters : [])]) {
                const p = paramOf(raw);
                if (p) byKey.set(`${p.in}:${p.name}`, p);
            }
            const all = [...byKey.values()];
            let body: Endpoint["body"] = null;
            if (isV2.value) {
                const b = all.find((p) => p.in === "body");
                const form = all.filter((p) => p.in === "formData");
                const consumes: string[] = op.consumes ?? s.consumes ?? ["application/json"];
                if (b) body = { contentType: consumes[0] ?? "application/json", schema: b.schema, example: b.schema ? example(b.schema, "req") : null, required: b.required, description: b.description };
                else if (form.length) {
                    const schema: O = { type: "object", properties: Object.fromEntries(form.map((f) => [f.name, f.schema ?? {}])), required: form.filter((f) => f.required).map((f) => f.name) };
                    body = { contentType: consumes.find((c) => c.includes("form")) ?? "application/x-www-form-urlencoded", schema, example: example(schema, "req"), required: true, description: "" };
                }
            } else {
                const rb = resolve(op.requestBody);
                const picked = rb && pickContent(rb.content);
                if (rb && picked) {
                    const schema = (picked[1].schema ?? null) as O | null;
                    body = { contentType: picked[0], schema, example: mediaExample(picked[1], schema, "req"), required: !!rb.required, description: rb.description ?? "" };
                }
            }
            const responses: Resp[] = [];
            for (const [code, rawResp] of Object.entries(isObj(op.responses) ? op.responses : {})) {
                const r = resolve(rawResp);
                if (!r) continue;
                if (isV2.value) {
                    const schema = (r.schema ?? null) as O | null;
                    const produces: string[] = op.produces ?? s.produces ?? ["application/json"];
                    const ex = isObj(r.examples) ? Object.values(r.examples)[0] : undefined;
                    responses.push({ code, description: r.description ?? "", contentType: schema ? (produces[0] ?? "") : "", schema, example: ex !== undefined ? ex : schema ? example(schema, "res") : null });
                } else {
                    const picked = pickContent(r.content);
                    const schema = (picked?.[1].schema ?? null) as O | null;
                    responses.push({ code, description: r.description ?? "", contentType: picked?.[0] ?? "", schema, example: picked ? mediaExample(picked[1], schema, "res") : null });
                }
            }
            const sec = (op.security ?? s.security ?? []) as O[];
            out.push({
                key: `${method} ${path}`,
                method,
                path,
                summary: op.summary ?? "",
                description: op.description ?? "",
                operationId: op.operationId ?? "",
                tags: Array.isArray(op.tags) && op.tags.length ? op.tags : ["default"],
                deprecated: !!op.deprecated,
                params: all.filter((p) => p.in !== "body" && p.in !== "formData"),
                body,
                responses,
                security: Array.isArray(sec) ? sec.filter(isObj).map((o) => Object.keys(o)) : [],
            });
        }
    }
    return out;
});

const info = computed(() => {
    const s = spec.value;
    if (!s) return null;
    const i = isObj(s.info) ? s.info : {};
    let servers: { url: string; description: string }[] = [];
    if (isV2.value) {
        const schemes: string[] = Array.isArray(s.schemes) && s.schemes.length ? s.schemes : ["https"];
        servers = schemes.map((sc) => ({ url: `${s.host ? `${sc}://${s.host}` : ""}${s.basePath ?? ""}` || "/", description: s.host ? "" : "No host given (relative)" }));
    } else if (Array.isArray(s.servers)) {
        servers = s.servers.filter(isObj).map((sv: O) => ({
            url: String(sv.url ?? "/").replace(/\{(\w+)\}/g, (m, n) => (isObj(sv.variables) && isObj(sv.variables[n]) ? String(sv.variables[n].default ?? m) : m)),
            description: sv.description ?? "",
        }));
    }
    return {
        title: i.title ?? "Untitled API",
        version: i.version ?? "",
        description: i.description ?? "",
        specVersion: s.openapi ? `OpenAPI ${s.openapi}` : `Swagger ${s.swagger}`,
        servers,
        paths: isObj(s.paths) ? Object.keys(s.paths).length : 0,
    };
});

const schemaMap = computed<Record<string, O>>(() => {
    const s = spec.value;
    if (!s) return {};
    const src = isV2.value ? s.definitions : s.components?.schemas;
    return isObj(src) ? (src as Record<string, O>) : {};
});
const schemaPrefix = computed(() => (isV2.value ? "#/definitions/" : "#/components/schemas/"));

// ---------- list / selection ----------
const filtered = computed(() => {
    const q = filter.value.trim().toLowerCase();
    if (!q) return endpoints.value;
    return endpoints.value.filter((e) => [e.method, e.path, e.summary, e.operationId, ...e.tags].some((x) => x.toLowerCase().includes(q)));
});
const groups = computed(() => {
    const tagOrder: string[] = (spec.value?.tags ?? []).filter(isObj).map((t: O) => t.name);
    const map = new Map<string, Endpoint[]>();
    for (const t of tagOrder) map.set(t, []);
    for (const e of filtered.value) for (const t of e.tags) (map.get(t) ?? map.set(t, []).get(t)!).push(e);
    const descs = new Map<string, string>((spec.value?.tags ?? []).filter(isObj).map((t: O) => [t.name, t.description ?? ""]));
    return [...map.entries()].filter(([, list]) => list.length).map(([tag, list]) => ({ tag, description: descs.get(tag) ?? "", list }));
});
function toggleTag(tag: string) {
    collapsed.value = collapsed.value.includes(tag) ? collapsed.value.filter((t) => t !== tag) : [...collapsed.value, tag];
}

const selected = computed(() => endpoints.value.find((e) => e.key === selectedKey.value) ?? null);
watch(
    endpoints,
    (list) => {
        if (!list.some((e) => e.key === selectedKey.value)) selectedKey.value = list.find((e) => e.body)?.key ?? list[0]?.key ?? "";
    },
    { immediate: true },
);
watch(
    selected,
    (e) => {
        if (e && !e.responses.some((r) => r.code === responseCode.value)) responseCode.value = e.responses.find((r) => /^2/.test(r.code))?.code ?? e.responses[0]?.code ?? "";
    },
    { immediate: true },
);
const response = computed(() => selected.value?.responses.find((r) => r.code === responseCode.value) ?? null);

const schemaNames = computed(() => Object.keys(schemaMap.value));
const filteredSchemas = computed(() => {
    const q = filter.value.trim().toLowerCase();
    return q ? schemaNames.value.filter((n) => n.toLowerCase().includes(q)) : schemaNames.value;
});
watch(
    schemaNames,
    (names) => {
        if (!names.includes(selectedSchema.value)) selectedSchema.value = names[0] ?? "";
    },
    { immediate: true },
);
const schemaRef = computed<O | null>(() => (selectedSchema.value ? { $ref: schemaPrefix.value + selectedSchema.value.replace(/~/g, "~0").replace(/\//g, "~1") } : null));

const json = (v: unknown) => JSON.stringify(v, null, 2) ?? "null";

// ---------- curl ----------
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const scalar = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

const curl = computed(() => {
    const e = selected.value;
    if (!e || !spec.value) return "";
    let base = info.value?.servers[0]?.url ?? "";
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(base)) base = "https://api.example.com" + (base === "/" ? "" : base);
    base = base.replace(/\/$/, "");
    const path = e.path.replace(/\{([^}]+)\}/g, (_m, n: string) => {
        const p = e.params.find((x) => x.in === "path" && x.name === n);
        return encodeURIComponent(scalar(p?.example) || n);
    });
    const query: string[] = [];
    const headers: string[] = [];
    const flags: string[] = [];
    for (const p of e.params) {
        if (p.in === "query") query.push(`${encodeURIComponent(p.name)}=${encodeURIComponent(scalar(p.example))}`);
        else if (p.in === "header") headers.push(`${p.name}: ${scalar(p.example)}`);
        else if (p.in === "cookie") headers.push(`Cookie: ${p.name}=${scalar(p.example)}`);
    }
    // Security requirements: use the first alternative.
    const schemes: O = (isV2.value ? spec.value.securityDefinitions : spec.value.components?.securitySchemes) ?? {};
    for (const name of e.security[0] ?? []) {
        const sc = resolve(schemes[name]);
        if (!sc) continue;
        if (sc.type === "apiKey") {
            if (sc.in === "header") headers.push(`${sc.name}: <api-key>`);
            else if (sc.in === "query") query.push(`${encodeURIComponent(sc.name)}=%3Capi-key%3E`);
            else if (sc.in === "cookie") headers.push(`Cookie: ${sc.name}=<api-key>`);
        } else if (sc.type === "basic" || (sc.type === "http" && /^basic$/i.test(sc.scheme))) flags.push("-u 'user:password'");
        else headers.push("Authorization: Bearer <token>");
    }
    const responseType = response.value?.contentType || e.responses.find((r) => r.contentType)?.contentType;
    if (responseType) headers.push(`Accept: ${responseType}`);
    const lines = [`curl -X ${e.method.toUpperCase()} ${shq(base + path + (query.length ? "?" + query.join("&") : ""))}`];
    for (const f of flags) lines.push(`  ${f}`);
    for (const h of headers) lines.push(`  -H ${shq(h)}`);
    if (e.body) {
        const ct = e.body.contentType;
        if (/multipart/i.test(ct) && isObj(e.body.example)) {
            for (const [k, v] of Object.entries(e.body.example)) lines.push(`  -F ${shq(`${k}=${scalar(v)}`)}`);
        } else if (/x-www-form-urlencoded/i.test(ct) && isObj(e.body.example)) {
            lines.push(`  -H ${shq(`Content-Type: ${ct}`)}`);
            for (const [k, v] of Object.entries(e.body.example)) lines.push(`  --data-urlencode ${shq(`${k}=${scalar(v)}`)}`);
        } else {
            lines.push(`  -H ${shq(`Content-Type: ${ct}`)}`);
            lines.push(`  --data-raw ${shq(typeof e.body.example === "string" ? e.body.example : json(e.body.example))}`);
        }
    }
    return lines.join(" \\\n");
});

const badge = (m: string) =>
    ({
        get: "bg-info-soft text-info",
        post: "bg-success/15 text-success",
        put: "bg-warn-soft text-warn",
        patch: "bg-accent-soft text-accent",
        delete: "bg-danger-soft text-danger",
    })[m] ?? "bg-subtle text-fg-muted";
const statusClass = (c: string) => (/^2/.test(c) ? "text-success" : /^3/.test(c) ? "text-info" : /^4/.test(c) ? "text-warn" : /^5/.test(c) ? "text-danger" : "text-fg-muted");

async function paste() {
    const t = await readClipboard();
    if (t) input.value = t;
}
</script>

<template>
    <ToolPage>
        <template #actions>
            <Btn size="sm" variant="ghost" @click="input = SHOP_API"><Sparkles /> OpenAPI 3 sample</Btn>
            <Btn size="sm" variant="ghost" @click="input = TASKS_SWAGGER2"><Sparkles /> Swagger 2 sample</Btn>
        </template>

        <div class="grid gap-4 lg:grid-cols-2">
            <Panel title="Spec (YAML or JSON)" flush>
                <template #actions>
                    <Btn size="sm" variant="ghost" @click="paste"><ClipboardPaste /> Paste</Btn>
                    <Btn size="sm" variant="ghost" :disabled="!input" @click="input = ''"><Trash2 /> Clear</Btn>
                </template>
                <CodeArea v-model="input" language="yaml" height="16rem" :wrap="false" :invalid="!!parsed.error" placeholder="Paste an OpenAPI 3.x or Swagger 2.0 document…" />
            </Panel>
            <Panel title="API">
                <Notice v-if="parsed.error" type="error">{{ parsed.error }}</Notice>
                <p v-else-if="!info" class="text-sm text-muted">Paste a spec to see its endpoints.</p>
                <div v-else class="space-y-3 text-sm">
                    <div class="flex flex-wrap items-baseline gap-2">
                        <h2 class="font-display text-xl font-semibold">{{ info.title }}</h2>
                        <span v-if="info.version" class="chip">v{{ info.version }}</span>
                        <span class="chip">{{ info.specVersion }}</span>
                    </div>
                    <p v-if="info.description" class="line-clamp-4 whitespace-pre-line text-fg-muted">{{ info.description }}</p>
                    <div>
                        <div class="label">Servers</div>
                        <ul class="space-y-1">
                            <li v-for="s in info.servers" :key="s.url" class="flex flex-wrap items-center gap-2">
                                <code class="code break-all">{{ s.url }}</code>
                                <span v-if="s.description" class="text-xs text-muted">{{ s.description }}</span>
                            </li>
                            <li v-if="!info.servers.length" class="text-muted">None declared (relative to the host serving the spec).</li>
                        </ul>
                    </div>
                    <div class="flex flex-wrap gap-2 text-xs text-muted">
                        <span class="chip">{{ info.paths }} paths</span>
                        <span class="chip">{{ endpoints.length }} operations</span>
                        <span class="chip">{{ schemaNames.length }} schemas</span>
                    </div>
                </div>
            </Panel>
        </div>

        <template v-if="spec">
            <div class="flex flex-wrap items-center gap-3">
                <Tabs
                    v-model="view"
                    :options="[
                        { value: 'endpoints', label: `Endpoints (${endpoints.length})` },
                        { value: 'schemas', label: `Schemas (${schemaNames.length})` },
                    ]"
                />
                <div class="relative min-w-0 flex-1 sm:max-w-xs">
                    <Search class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle" />
                    <input v-model="filter" class="input pl-8" :placeholder="view === 'endpoints' ? 'Filter by path, method, tag…' : 'Filter schemas…'" aria-label="Filter" />
                </div>
            </div>

            <div v-if="view === 'endpoints'" class="grid items-start gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
                <Panel title="Endpoints" flush>
                    <p v-if="!groups.length" class="p-4 text-sm text-muted">No endpoints match.</p>
                    <div v-for="g in groups" :key="g.tag" class="border-b border-line last:border-b-0">
                        <button type="button" class="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left hover:bg-subtle" @click="toggleTag(g.tag)">
                            <ChevronRight v-if="collapsed.includes(g.tag)" class="size-4 text-fg-subtle" />
                            <ChevronDown v-else class="size-4 text-fg-subtle" />
                            <span class="text-sm font-semibold text-fg">{{ g.tag }}</span>
                            <span class="ml-auto text-xs text-muted">{{ g.list.length }}</span>
                        </button>
                        <ul v-if="!collapsed.includes(g.tag)" class="pb-1">
                            <li v-for="e in g.list" :key="e.key">
                                <button
                                    type="button"
                                    class="flex w-full cursor-pointer items-start gap-2 px-3 py-1.5 text-left text-sm hover:bg-subtle"
                                    :class="e.key === selectedKey ? 'bg-accent-soft' : ''"
                                    @click="selectedKey = e.key"
                                >
                                    <span class="mt-0.5 w-14 shrink-0 rounded px-1 py-0.5 text-center font-mono text-[10px] font-bold uppercase" :class="badge(e.method)">{{ e.method }}</span>
                                    <span class="min-w-0">
                                        <span class="block font-mono text-[12px] break-all text-fg" :class="e.deprecated ? 'line-through' : ''">{{ e.path }}</span>
                                        <span v-if="e.summary" class="block truncate text-xs text-muted">{{ e.summary }}</span>
                                    </span>
                                </button>
                            </li>
                        </ul>
                    </div>
                </Panel>

                <div v-if="selected" class="min-w-0 space-y-4">
                    <Panel>
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="rounded px-2 py-0.5 font-mono text-xs font-bold uppercase" :class="badge(selected.method)">{{ selected.method }}</span>
                            <code class="font-mono text-sm break-all text-fg">{{ selected.path }}</code>
                            <span v-if="selected.deprecated" class="chip text-warn">deprecated</span>
                        </div>
                        <p v-if="selected.summary" class="mt-2 font-medium text-fg">{{ selected.summary }}</p>
                        <p v-if="selected.description" class="mt-1 text-sm whitespace-pre-line text-fg-muted">{{ selected.description }}</p>
                        <div class="mt-2 flex flex-wrap gap-2 text-xs text-muted">
                            <span v-if="selected.operationId" class="chip">operationId: {{ selected.operationId }}</span>
                            <span v-if="selected.security.length" class="chip">auth: {{ selected.security.map((s) => s.join(' + ') || 'none').join(' or ') }}</span>
                            <span v-else class="chip">no auth</span>
                        </div>
                    </Panel>

                    <Panel title="Parameters" flush>
                        <p v-if="!selected.params.length" class="p-4 text-sm text-muted">No parameters.</p>
                        <div v-else class="overflow-x-auto">
                            <table class="w-full text-sm">
                                <thead class="text-left text-xs text-muted uppercase">
                                    <tr><th class="px-4 py-2">Name</th><th class="px-4 py-2">In</th><th class="px-4 py-2">Type</th><th class="px-4 py-2">Description</th></tr>
                                </thead>
                                <tbody class="divide-y divide-line border-t border-line">
                                    <tr v-for="p in selected.params" :key="p.in + p.name">
                                        <td class="px-4 py-2 font-mono text-[12px] whitespace-nowrap text-fg">
                                            {{ p.name }}<span v-if="p.required" class="text-danger" title="Required">*</span>
                                        </td>
                                        <td class="px-4 py-2"><span class="chip">{{ p.in }}</span></td>
                                        <td class="px-4 py-2 font-mono text-[12px] text-accent">{{ p.type }}<span v-if="p.schema && p.schema.enum" class="block text-muted">{{ p.schema.enum.join(" | ") }}</span></td>
                                        <td class="px-4 py-2 text-fg-muted">
                                            {{ p.description }}
                                            <span v-if="p.example !== null && p.example !== undefined" class="block text-xs text-muted">e.g. <code class="code">{{ scalar(p.example) }}</code></span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </Panel>

                    <Panel v-if="selected.body" flush>
                        <template #title>
                            Request body <span class="ml-1 font-mono text-xs font-normal text-muted">{{ selected.body.contentType }}{{ selected.body.required ? " · required" : "" }}</span>
                        </template>
                        <template #actions><CopyButton :text="json(selected.body.example)" label="Copy JSON" /></template>
                        <p v-if="selected.body.description" class="px-4 pt-3 text-sm text-fg-muted">{{ selected.body.description }}</p>
                        <div class="grid gap-0 xl:grid-cols-2">
                            <div class="overflow-x-auto border-b border-line xl:border-r xl:border-b-0">
                                <div class="px-4 pt-3 text-xs text-muted">Schema: <span class="font-mono text-accent">{{ typeLabel(selected.body.schema) }}</span></div>
                                <table class="w-full text-sm">
                                    <tbody>
                                        <tr v-for="(r, i) in schemaRows(selected.body.schema)" :key="i" class="align-top">
                                            <td class="py-1 pr-2 font-mono text-[12px] whitespace-nowrap text-fg" :style="{ paddingLeft: `${1 + r.depth * 1.1}rem` }">{{ r.name }}<span v-if="r.required" class="text-danger">*</span></td>
                                            <td class="py-1 pr-4 font-mono text-[12px] text-accent">
                                                {{ r.type }}
                                                <span v-if="r.enumVals" class="block text-muted">{{ r.enumVals }}</span>
                                                <span v-if="r.flags" class="block text-warn">{{ r.flags }}</span>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            <div class="min-w-0 overflow-x-auto p-4"><CodeBlock :code="json(selected.body.example)" language="json" /></div>
                        </div>
                    </Panel>

                    <Panel title="Responses" flush>
                        <template #actions><CopyButton v-if="response" :text="json(response.example)" label="Copy JSON" /></template>
                        <div class="flex flex-wrap gap-1 border-b border-line px-4 py-2">
                            <button
                                v-for="r in selected.responses"
                                :key="r.code"
                                type="button"
                                class="cursor-pointer rounded-md px-2 py-0.5 font-mono text-xs font-semibold ring-1 ring-line"
                                :class="[statusClass(r.code), r.code === responseCode ? 'bg-subtle' : 'opacity-70 hover:opacity-100']"
                                @click="responseCode = r.code"
                            >
                                {{ r.code }}
                            </button>
                        </div>
                        <div v-if="response">
                            <p class="px-4 pt-3 text-sm text-fg-muted">
                                {{ response.description }}
                                <span v-if="response.contentType" class="ml-1 font-mono text-xs text-muted">{{ response.contentType }}</span>
                            </p>
                            <p v-if="!response.schema" class="px-4 py-3 text-sm text-muted">No body.</p>
                            <div v-else class="grid gap-0 xl:grid-cols-2">
                                <div class="overflow-x-auto border-b border-line xl:border-r xl:border-b-0">
                                    <div class="px-4 pt-3 text-xs text-muted">Schema: <span class="font-mono text-accent">{{ typeLabel(response.schema) }}</span></div>
                                    <table class="w-full text-sm">
                                        <tbody>
                                            <tr v-for="(r, i) in schemaRows(response.schema)" :key="i" class="align-top">
                                                <td class="py-1 pr-2 font-mono text-[12px] whitespace-nowrap text-fg" :style="{ paddingLeft: `${1 + r.depth * 1.1}rem` }">{{ r.name }}<span v-if="r.required" class="text-danger">*</span></td>
                                                <td class="py-1 pr-4 font-mono text-[12px] text-accent">
                                                    {{ r.type }}
                                                    <span v-if="r.enumVals" class="block text-muted">{{ r.enumVals }}</span>
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                                <div class="min-w-0 overflow-x-auto p-4"><CodeBlock :code="json(response.example)" language="json" /></div>
                            </div>
                        </div>
                    </Panel>

                    <Panel title="curl" flush>
                        <template #actions><CopyButton :text="curl" /></template>
                        <div class="overflow-x-auto p-4"><CodeBlock :code="curl" language="bash" /></div>
                    </Panel>
                </div>
            </div>

            <div v-else class="grid items-start gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
                <Panel title="Schemas" flush>
                    <p v-if="!filteredSchemas.length" class="p-4 text-sm text-muted">No schemas.</p>
                    <ul class="py-1">
                        <li v-for="n in filteredSchemas" :key="n">
                            <button
                                type="button"
                                class="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-mono text-[12px] text-fg hover:bg-subtle"
                                :class="n === selectedSchema ? 'bg-accent-soft' : ''"
                                @click="selectedSchema = n"
                            >
                                <FileCode2 class="size-3.5 shrink-0 text-fg-subtle" />
                                <span class="truncate">{{ n }}</span>
                                <span class="ml-auto shrink-0 text-[11px] text-muted">{{ typeLabel(schemaMap[n]) }}</span>
                            </button>
                        </li>
                    </ul>
                </Panel>
                <Panel v-if="schemaRef" flush>
                    <template #title>{{ selectedSchema }}</template>
                    <template #actions><CopyButton :text="json(example(schemaRef, 'res'))" label="Copy example" /></template>
                    <p v-if="schemaMap[selectedSchema]?.description" class="px-4 pt-3 text-sm text-fg-muted">{{ schemaMap[selectedSchema]?.description }}</p>
                    <div class="grid gap-0 xl:grid-cols-2">
                        <div class="overflow-x-auto border-b border-line xl:border-r xl:border-b-0">
                            <table class="w-full text-sm">
                                <thead class="text-left text-xs text-muted uppercase">
                                    <tr><th class="px-4 py-2">Property</th><th class="py-2 pr-4">Type</th></tr>
                                </thead>
                                <tbody class="border-t border-line">
                                    <tr v-for="(r, i) in schemaRows(schemaRef)" :key="i" class="align-top">
                                        <td class="py-1 pr-2 font-mono text-[12px] whitespace-nowrap text-fg" :style="{ paddingLeft: `${1 + r.depth * 1.1}rem` }">{{ r.name }}<span v-if="r.required" class="text-danger">*</span></td>
                                        <td class="py-1 pr-4 font-mono text-[12px] text-accent">
                                            {{ r.type }}
                                            <span v-if="r.enumVals" class="block text-muted">{{ r.enumVals }}</span>
                                            <span v-if="r.flags" class="block text-warn">{{ r.flags }}</span>
                                            <span v-if="r.description" class="block font-sans text-fg-muted">{{ r.description }}</span>
                                        </td>
                                    </tr>
                                    <tr v-if="!schemaRows(schemaRef).length">
                                        <td colspan="2" class="px-4 py-2 text-muted">
                                            {{ typeLabel(schemaMap[selectedSchema]) }}<span v-if="schemaMap[selectedSchema]?.enum">: {{ schemaMap[selectedSchema]?.enum.join(", ") }}</span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <div class="min-w-0 overflow-x-auto p-4"><CodeBlock :code="json(example(schemaRef, 'res'))" language="json" /></div>
                    </div>
                </Panel>
            </div>
        </template>
    </ToolPage>
</template>
