<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStorage, watchDebounced } from "@vueuse/core";
import type { Plugin } from "prettier";
import { ArrowRightLeft, ChevronDown, ChevronRight, ClipboardPaste, Sparkles, Trash2 } from "lucide-vue-next";
import { Btn, CodeArea, CodeBlock, CopyButton, Notice, Panel, Tabs, ToolPage } from "@/components/ui";
import { readClipboard } from "@/composables/useClipboard";
import { useHandoff } from "@/composables/handoff";
import { BUILTIN_SCALARS, minify, parseSdl, type GqlArg, type GqlSchema, type GqlType } from "./graphql";

type Tab = "format" | "minify" | "builder";

const SAMPLE_QUERY = `# Product page query
query ProductPage($id: ID!, $reviewCount: Int = 5) { product(id: $id) { id name price { amount currency }
  ...Availability reviews(first: $reviewCount, orderBy: {field: CREATED_AT, direction: DESC}) { edges { node { rating body author { name } } } }
  description(format: """Markdown
with "quotes" inside""") } }

fragment Availability on Product { inStock warehouse(region: "eu-central") { name stock } }
`;

const SAMPLE_SDL = `"""
Shop GraphQL API.
"""
scalar DateTime

"An object with a global id"
interface Node {
  id: ID!
}

enum Category {
  SHOES
  APPAREL
  ACCESSORIES
}

enum OrderStatus {
  PENDING
  PAID
  SHIPPED
  DELIVERED
}

type Money {
  amount: Float!
  currency: String!
}

type Product implements Node {
  id: ID!
  name: String!
  description: String
  price: Money!
  category: Category!
  tags: [String!]!
  inStock: Boolean!
  "Paginated reviews, newest first"
  reviews(first: Int = 10, after: String): ReviewConnection!
  related(limit: Int = 4): [Product!]!
  legacySku: String @deprecated(reason: "Use id")
}

type Review implements Node {
  id: ID!
  rating: Int!
  body: String
  author: Customer!
  createdAt: DateTime!
}

type ReviewEdge {
  cursor: String!
  node: Review!
}

type ReviewConnection {
  totalCount: Int!
  edges: [ReviewEdge!]!
}

type Customer implements Node {
  id: ID!
  name: String!
  email: String!
  orders(status: OrderStatus): [Order!]!
}

type Order implements Node {
  id: ID!
  status: OrderStatus!
  total: Money!
  lines: [OrderLine!]!
  customer: Customer!
  placedAt: DateTime!
}

type OrderLine {
  product: Product!
  quantity: Int!
}

union SearchResult = Product | Customer | Order

input ProductFilter {
  category: Category
  minPrice: Float
  maxPrice: Float
  inStockOnly: Boolean = false
}

input OrderLineInput {
  productId: ID!
  quantity: Int!
}

input PlaceOrderInput {
  lines: [OrderLineInput!]!
  couponCode: String
}

type Query {
  "Look up a single product"
  product(id: ID!): Product
  products(filter: ProductFilter, first: Int = 20, after: String): [Product!]!
  search(term: String!): [SearchResult!]!
  me: Customer
  node(id: ID!): Node
}

type Mutation {
  placeOrder(input: PlaceOrderInput!): Order!
  cancelOrder(id: ID!, reason: String): Order!
  deleteProduct(id: ID!): Boolean!
}
`;

const tab = useStorage<Tab>("devtools:graphql-formatter:tab", "format");
const input = useStorage("devtools:graphql-formatter:input", SAMPLE_QUERY);
const indent = useStorage("devtools:graphql-formatter:indent", 2);

useHandoff<{ input?: string; tab?: Tab }>("graphql-formatter", (p) => {
    if (p.input != null) input.value = p.input;
    if (p.tab) tab.value = p.tab === "builder" ? "format" : p.tab;
});

// ---------- format ----------
const formatted = ref("");
const formatError = ref("");
let formatSeq = 0;
async function runFormat() {
    const seq = ++formatSeq;
    if (!input.value.trim()) {
        formatted.value = "";
        formatError.value = "";
        return;
    }
    try {
        const [prettier, gql] = await Promise.all([import("prettier/standalone"), import("prettier/plugins/graphql")]);
        const out = await prettier.format(input.value, { parser: "graphql", plugins: [gql as unknown as Plugin], tabWidth: indent.value, printWidth: 80 });
        if (seq !== formatSeq) return;
        formatted.value = out;
        formatError.value = "";
    } catch (e) {
        if (seq !== formatSeq) return;
        formatted.value = "";
        formatError.value = ((e as Error).message ?? String(e)).split("\n")[0]!;
    }
}
watchDebounced([input, indent], runFormat, { debounce: 200, immediate: true });

// ---------- minify ----------
const minified = computed<{ out: string; error: string }>(() => {
    if (!input.value.trim()) return { out: "", error: "" };
    try {
        return { out: minify(input.value), error: "" };
    } catch (e) {
        return { out: "", error: (e as Error).message };
    }
});
const bytes = (s: string) => new TextEncoder().encode(s).length;

async function paste() {
    const t = await readClipboard();
    if (t) input.value = t;
}

// ---------- query builder ----------
const sdl = useStorage("devtools:graphql-formatter:sdl", SAMPLE_SDL);
const rootKind = ref<"query" | "mutation" | "subscription">("query");
const rootField = ref("");
const selected = ref<string[]>([]);
const expanded = ref<string[]>([]);
const opName = ref("");
const includeOptional = useStorage("devtools:graphql-formatter:optional-args", true);
const MAX_DEPTH = 8;

const schema = computed<{ s: GqlSchema | null; error: string }>(() => {
    if (!sdl.value.trim()) return { s: null, error: "" };
    try {
        return { s: parseSdl(sdl.value), error: "" };
    } catch (e) {
        return { s: null, error: (e as Error).message };
    }
});
const types = computed(() => schema.value.s?.types ?? new Map<string, GqlType>());
const rootKinds = computed(() => {
    const r = schema.value.s?.roots ?? {};
    return (["query", "mutation", "subscription"] as const).filter((k) => r[k] && types.value.has(r[k]!)).map((k) => ({ value: k, label: k[0]!.toUpperCase() + k.slice(1) }));
});
const rootType = computed(() => {
    const n = schema.value.s?.roots[rootKind.value];
    return n ? types.value.get(n) : undefined;
});
const rootFieldDef = computed(() => rootType.value?.fields.find((f) => f.name === rootField.value));

const isComposite = (base: string) => {
    const t = types.value.get(base);
    return !!t && (t.kind === "type" || t.kind === "interface" || t.kind === "union");
};

interface Child {
    seg: string;
    label: string;
    base: string;
    type: string;
    fragment: boolean;
    args: GqlArg[];
    description: string;
    deprecated: boolean;
}
function children(typeName: string): Child[] {
    const t = types.value.get(typeName);
    if (!t) return [];
    const out: Child[] = [];
    if (t.kind === "union") out.push({ seg: "__typename", label: "__typename", base: "String", type: "String!", fragment: false, args: [], description: "Concrete type name", deprecated: false });
    for (const f of t.fields) out.push({ seg: f.name, label: f.name, base: f.base, type: f.type, fragment: false, args: f.args, description: f.description, deprecated: f.deprecated });
    if (t.kind === "union" || t.kind === "interface")
        for (const p of [...new Set(t.possible)]) out.push({ seg: `...on ${p}`, label: `... on ${p}`, base: p, type: p, fragment: true, args: [], description: "", deprecated: false });
    return out;
}
const join = (prefix: string, seg: string) => (prefix ? `${prefix}.${seg}` : seg);

function leafPaths(typeName: string, prefix: string): string[] {
    const kids = children(typeName);
    const leaves = kids.filter((c) => !c.fragment && !isComposite(c.base) && !c.deprecated && !c.args.some((a) => a.type.endsWith("!")));
    return (leaves.length ? leaves : kids.filter((c) => c.seg === "__typename" || c.seg === "id")).map((c) => join(prefix, c.seg));
}

watch(
    rootKinds,
    (kinds) => {
        if (!kinds.some((k) => k.value === rootKind.value) && kinds[0]) rootKind.value = kinds[0].value;
    },
    { immediate: true },
);
watch(
    rootType,
    (t) => {
        if (t && !t.fields.some((f) => f.name === rootField.value)) rootField.value = t.fields[0]?.name ?? "";
    },
    { immediate: true },
);
watch(
    rootFieldDef,
    (f, old) => {
        if (f?.name === old?.name && f?.base === old?.base) return;
        expanded.value = [];
        opName.value = "";
        selected.value = f && isComposite(f.base) ? leafPaths(f.base, "") : [];
    },
    { immediate: true },
);

interface TreeRow extends Child {
    path: string;
    depth: number;
    composite: boolean;
}
const rows = computed<TreeRow[]>(() => {
    const out: TreeRow[] = [];
    const walk = (typeName: string, prefix: string, depth: number) => {
        for (const c of children(typeName)) {
            const path = join(prefix, c.seg);
            const composite = isComposite(c.base);
            out.push({ ...c, path, depth, composite });
            if (composite && depth < MAX_DEPTH && expanded.value.includes(path)) walk(c.base, path, depth + 1);
        }
    };
    const f = rootFieldDef.value;
    if (f && isComposite(f.base)) walk(f.base, "", 0);
    return out;
});

const anyBelow = (path: string) => selected.value.some((p) => p.startsWith(path + "."));
function toggleExpand(path: string) {
    expanded.value = expanded.value.includes(path) ? expanded.value.filter((p) => p !== path && !p.startsWith(path + ".")) : [...expanded.value, path];
}
function toggleRow(r: TreeRow) {
    if (!r.composite) {
        selected.value = selected.value.includes(r.path) ? selected.value.filter((p) => p !== r.path) : [...selected.value, r.path];
        return;
    }
    if (anyBelow(r.path)) selected.value = selected.value.filter((p) => !p.startsWith(r.path + "."));
    else {
        selected.value = [...selected.value, ...leafPaths(r.base, r.path)];
        if (!expanded.value.includes(r.path) && r.depth < MAX_DEPTH) expanded.value = [...expanded.value, r.path];
    }
}
function selectNone() {
    selected.value = [];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const generated = computed(() => {
    const f = rootFieldDef.value;
    if (!f) return { op: "", vars: "{}" };
    const vars: { name: string; arg: GqlArg }[] = [];
    const used = new Set<string>();
    const argList = (fieldName: string, args: GqlArg[]) => {
        const chosen = args.filter((a) => includeOptional.value || a.type.endsWith("!"));
        if (!chosen.length) return "";
        const parts = chosen.map((a) => {
            let v = a.name;
            if (used.has(v)) v = fieldName + cap(a.name);
            for (let k = 2; used.has(v); k++) v = `${fieldName}${cap(a.name)}${k}`;
            used.add(v);
            vars.push({ name: v, arg: a });
            return `${a.name}: $${v}`;
        });
        return `(${parts.join(", ")})`;
    };
    const pad = (d: number) => " ".repeat(d * 2);
    const sel = (typeName: string, prefix: string, depth: number): string[] => {
        const lines: string[] = [];
        if (depth > MAX_DEPTH + 1) return lines;
        for (const c of children(typeName)) {
            const path = join(prefix, c.seg);
            if (!isComposite(c.base)) {
                if (selected.value.includes(path)) lines.push(`${pad(depth)}${c.seg}${argList(c.seg, c.args)}`);
            } else if (anyBelow(path)) {
                const head = c.fragment ? `... on ${c.base}` : `${c.seg}${argList(c.seg, c.args)}`;
                const inner = sel(c.base, path, depth + 1);
                if (inner.length) lines.push(`${pad(depth)}${head} {`, ...inner, `${pad(depth)}}`);
            }
        }
        return lines;
    };
    const rootArgs = argList(f.name, f.args);
    let body: string[];
    if (isComposite(f.base)) {
        const inner = sel(f.base, "", 2);
        body = [`  ${f.name}${rootArgs} {`, ...(inner.length ? inner : ["    __typename"]), "  }"];
    } else body = [`  ${f.name}${rootArgs}`];
    const name = opName.value.trim() || cap(f.name) + cap(rootKind.value);
    const decl = vars.length ? `(${vars.map((v) => `$${v.name}: ${v.arg.type}${v.arg.defaultValue !== undefined ? ` = ${v.arg.defaultValue}` : ""}`).join(", ")})` : "";
    const op = `${rootKind.value} ${name}${decl} {\n${body.join("\n")}\n}\n`;
    const varsObj: Record<string, unknown> = {};
    for (const v of vars) varsObj[v.name] = sampleValue(v.arg.type, 0, v.arg.defaultValue);
    return { op, vars: JSON.stringify(varsObj, null, 2) };
});

function sampleValue(type: string, depth: number, defaultValue?: string): unknown {
    if (defaultValue !== undefined) {
        try {
            return JSON.parse(defaultValue);
        } catch {
            if (/^[_A-Za-z]\w*$/.test(defaultValue)) return defaultValue; // enum default
        }
    }
    const t = type.replace(/!$/, "");
    if (t.startsWith("[")) return [sampleValue(t.slice(1, -1), depth + 1)];
    switch (t) {
        case "Int": return 0;
        case "Float": return 0.0;
        case "Boolean": return false;
        case "String":
        case "ID": return "";
    }
    const def = types.value.get(t);
    if (def?.kind === "enum") return def.values[0] ?? "";
    if (def?.kind === "input") {
        if (depth > 4) return {};
        return Object.fromEntries(def.fields.map((f) => [f.name, sampleValue(f.type, depth + 1)]));
    }
    return "";
}

const fieldTypeClass = (base: string) => {
    const k = types.value.get(base)?.kind;
    return BUILTIN_SCALARS.includes(base) || k === "scalar" ? "text-info" : k === "enum" ? "text-warn" : "text-accent";
};

function useInFormatter() {
    input.value = generated.value.op;
    tab.value = "format";
}
</script>

<template>
    <ToolPage>
        <template #actions>
            <Tabs
                v-model="tab"
                :options="[
                    { value: 'format', label: 'Format' },
                    { value: 'minify', label: 'Minify' },
                    { value: 'builder', label: 'Query builder' },
                ]"
            />
        </template>

        <template v-if="tab !== 'builder'">
            <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <label v-if="tab === 'format'" class="flex items-center gap-2">
                    Indent
                    <select v-model.number="indent" class="select w-auto py-1">
                        <option :value="2">2 spaces</option>
                        <option :value="4">4 spaces</option>
                    </select>
                </label>
                <span v-else-if="minified.out" class="text-xs text-muted">
                    {{ bytes(input) }} → {{ bytes(minified.out) }} bytes ({{ Math.round((1 - bytes(minified.out) / Math.max(1, bytes(input))) * 100) }}% smaller). Comments are dropped, strings and block strings are kept.
                </span>
            </div>
            <div class="grid gap-4 lg:grid-cols-2">
                <Panel title="GraphQL" flush>
                    <template #actions>
                        <Btn size="sm" variant="ghost" @click="input = SAMPLE_QUERY"><Sparkles /> Sample</Btn>
                        <Btn size="sm" variant="ghost" @click="paste"><ClipboardPaste /> Paste</Btn>
                        <Btn size="sm" variant="ghost" :disabled="!input" @click="input = ''"><Trash2 /> Clear</Btn>
                    </template>
                    <CodeArea v-model="input" language="graphql" height="24rem" :wrap="false" placeholder="Paste a query, mutation, fragment or SDL…" />
                </Panel>
                <Panel :title="tab === 'format' ? 'Formatted' : 'Minified'" flush>
                    <template #actions>
                        <Btn
                            size="sm"
                            variant="ghost"
                            :disabled="!(tab === 'format' ? formatted : minified.out)"
                            @click="input = tab === 'format' ? formatted : minified.out"
                            ><ArrowRightLeft /> Use as input</Btn
                        >
                        <CopyButton :text="tab === 'format' ? formatted : minified.out" />
                    </template>
                    <div v-if="tab === 'format' && formatError" class="p-4"><Notice type="error">{{ formatError }}</Notice></div>
                    <div v-else-if="tab === 'minify' && minified.error" class="p-4"><Notice type="error">{{ minified.error }}</Notice></div>
                    <CodeArea v-else :model-value="tab === 'format' ? formatted : minified.out" language="graphql" readonly height="24rem" :wrap="tab === 'minify'" placeholder="Output appears here" />
                </Panel>
            </div>
        </template>

        <template v-else>
            <div class="grid gap-4 lg:grid-cols-2">
                <Panel title="Schema (SDL)" flush>
                    <template #actions>
                        <Btn size="sm" variant="ghost" @click="sdl = SAMPLE_SDL"><Sparkles /> Sample</Btn>
                        <Btn size="sm" variant="ghost" @click="async () => { const t = await readClipboard(); if (t) sdl = t; }"><ClipboardPaste /> Paste</Btn>
                        <Btn size="sm" variant="ghost" :disabled="!sdl" @click="sdl = ''"><Trash2 /> Clear</Btn>
                    </template>
                    <CodeArea v-model="sdl" language="graphql" height="30rem" :wrap="false" :invalid="!!schema.error" placeholder="Paste a GraphQL schema (type Query { … })" />
                </Panel>

                <Panel title="Fields" flush>
                    <template #actions>
                        <Btn size="sm" variant="ghost" :disabled="!selected.length" @click="selectNone">Select none</Btn>
                    </template>
                    <div v-if="schema.error" class="p-4"><Notice type="error">{{ schema.error }}</Notice></div>
                    <div v-else-if="!rootKinds.length" class="p-4"><Notice type="info">No Query, Mutation or Subscription type found in the schema.</Notice></div>
                    <template v-else>
                        <div class="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
                            <Tabs v-model="rootKind" size="sm" :options="rootKinds" />
                            <select v-model="rootField" class="select w-auto min-w-0 flex-1 font-mono" aria-label="Root field">
                                <option v-for="f in rootType?.fields ?? []" :key="f.name" :value="f.name">{{ f.name }}: {{ f.type }}</option>
                            </select>
                        </div>
                        <div v-if="rootFieldDef" class="border-b border-line px-4 py-2 text-xs text-muted">
                            <span v-if="rootFieldDef.description">{{ rootFieldDef.description }} · </span>
                            returns <span class="font-mono" :class="fieldTypeClass(rootFieldDef.base)">{{ rootFieldDef.type }}</span>
                            <span v-if="rootFieldDef.args.length"> · args: <span class="font-mono">{{ rootFieldDef.args.map((a) => `${a.name}: ${a.type}`).join(", ") }}</span></span>
                        </div>
                        <div class="max-h-[26rem] overflow-auto py-1">
                            <p v-if="!rows.length" class="px-4 py-2 text-sm text-muted">This field returns a scalar, so it has no sub-selection.</p>
                            <div v-for="r in rows" :key="r.path" class="flex items-center gap-1.5 py-0.5 pr-3 text-sm hover:bg-subtle" :style="{ paddingLeft: `${0.75 + r.depth * 1.15}rem` }">
                                <button v-if="r.composite" type="button" class="grid size-5 shrink-0 cursor-pointer place-items-center rounded text-fg-subtle hover:text-fg" :disabled="r.depth >= MAX_DEPTH" :aria-label="expanded.includes(r.path) ? 'Collapse' : 'Expand'" @click="toggleExpand(r.path)">
                                    <ChevronDown v-if="expanded.includes(r.path)" class="size-4" />
                                    <ChevronRight v-else class="size-4" />
                                </button>
                                <span v-else class="w-5 shrink-0" />
                                <input
                                    type="checkbox"
                                    class="checkbox"
                                    :checked="r.composite ? anyBelow(r.path) : selected.includes(r.path)"
                                    :aria-label="`Select ${r.label}`"
                                    @change="toggleRow(r)"
                                />
                                <span class="min-w-0 truncate font-mono text-[12px]" :class="[r.fragment ? 'text-fg-muted italic' : 'text-fg', r.deprecated ? 'line-through' : '']" :title="r.description">
                                    {{ r.label }}<span v-if="r.args.length" class="text-muted">({{ r.args.map((a) => a.name).join(", ") }})</span>
                                </span>
                                <span v-if="!r.fragment" class="ml-auto shrink-0 font-mono text-[11px]" :class="fieldTypeClass(r.base)">{{ r.type }}</span>
                            </div>
                        </div>
                    </template>
                </Panel>
            </div>

            <div v-if="rootFieldDef && !schema.error" class="space-y-4">
                <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                    <label class="flex items-center gap-2">
                        Operation name
                        <input v-model="opName" class="input w-56 font-mono" :placeholder="cap(rootFieldDef.name) + cap(rootKind)" />
                    </label>
                    <label class="flex items-center gap-2"><input v-model="includeOptional" type="checkbox" class="checkbox" /> Include optional arguments as variables</label>
                </div>
                <div class="grid gap-4 lg:grid-cols-2">
                    <Panel title="Operation" flush>
                        <template #actions>
                            <Btn size="sm" variant="ghost" @click="useInFormatter"><ArrowRightLeft /> Open in formatter</Btn>
                            <CopyButton :text="generated.op" />
                        </template>
                        <div class="overflow-x-auto p-4"><CodeBlock :code="generated.op" language="graphql" /></div>
                    </Panel>
                    <Panel title="Variables" flush>
                        <template #actions><CopyButton :text="generated.vars" /></template>
                        <div class="overflow-x-auto p-4"><CodeBlock :code="generated.vars" language="json" /></div>
                    </Panel>
                </div>
            </div>
        </template>
    </ToolPage>
</template>
