<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useDebounceFn, useStorage } from "@vueuse/core";
import { ClipboardPaste, Download, Maximize, Sparkles, Trash2, ZoomIn, ZoomOut } from "lucide-vue-next";
import { Btn, CodeArea, CopyButton, Notice, Panel, Tabs, ToolPage } from "@/components/ui";
import { isDark } from "@/composables/prefs";
import { useHandoff } from "@/composables/handoff";
import { downloadBlob, readClipboard } from "@/composables/useClipboard";

const SAMPLE = `-- A small shop schema (MySQL flavour, with a PostgreSQL-style ALTER at the end)
CREATE TABLE IF NOT EXISTS \`customers\` (
  \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`email\` VARCHAR(255) NOT NULL UNIQUE,
  \`full_name\` VARCHAR(120) NOT NULL,
  \`phone\` VARCHAR(20) NULL COMMENT 'E.164 format',
  \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB;

CREATE TABLE customer_profiles (
  customer_id BIGINT UNSIGNED NOT NULL PRIMARY KEY REFERENCES customers(id),
  date_of_birth DATE,
  newsletter BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE categories (
  id INT PRIMARY KEY,
  parent_id INT NULL, /* self reference */
  name VARCHAR(80) NOT NULL,
  CONSTRAINT fk_category_parent FOREIGN KEY (parent_id) REFERENCES categories (id)
);

CREATE TABLE products (
  id INT NOT NULL PRIMARY KEY,
  category_id INT NOT NULL,
  sku VARCHAR(32) NOT NULL,
  name VARCHAR(200) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  status ENUM('draft','active','archived') NOT NULL DEFAULT 'draft',
  CONSTRAINT uq_products_sku UNIQUE (sku),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE orders (
  id BIGINT PRIMARY KEY,
  customer_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(20) NOT NULL,
  total DECIMAL(12,2) NOT NULL,
  placed_at TIMESTAMP NOT NULL
);

CREATE TABLE order_items (
  order_id BIGINT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (order_id, product_id),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

ALTER TABLE orders ADD CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers (id);
`;

// ---------------------------------------------------------------- tokenizer
interface Tok {
    k: "id" | "qid" | "str" | "num" | "p";
    v: string;
}

function tokenize(sql: string): Tok[] {
    const out: Tok[] = [];
    let i = 0;
    const n = sql.length;
    while (i < n) {
        const c = sql[i];
        if (/\s/.test(c)) { i++; continue; }
        if (c === "-" && sql[i + 1] === "-") { while (i < n && sql[i] !== "\n") i++; continue; }
        if (c === "#") { while (i < n && sql[i] !== "\n") i++; continue; }
        if (c === "/" && sql[i + 1] === "*") { const e = sql.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; continue; }
        if (c === "'") {
            let s = "";
            i++;
            while (i < n) {
                if (sql[i] === "\\" && i + 1 < n) { s += sql[i + 1]; i += 2; continue; }
                if (sql[i] === "'") { if (sql[i + 1] === "'") { s += "'"; i += 2; continue; } i++; break; }
                s += sql[i++];
            }
            out.push({ k: "str", v: s });
            continue;
        }
        if (c === '"' || c === "`" || (c === "[" && sql[i + 1] !== "]")) {
            const close = c === "[" ? "]" : c;
            let s = "";
            i++;
            while (i < n) {
                if (sql[i] === close) { if (sql[i + 1] === close) { s += close; i += 2; continue; } i++; break; }
                s += sql[i++];
            }
            out.push({ k: "qid", v: s });
            continue;
        }
        if (c === "[" && sql[i + 1] === "]") { out.push({ k: "p", v: "[]" }); i += 2; continue; }
        const num = /^\d+(?:\.\d+)?/.exec(sql.slice(i, i + 40));
        if (num) { out.push({ k: "num", v: num[0] }); i += num[0].length; continue; }
        const word = /^[A-Za-z_À-￿][\w$À-￿]*/.exec(sql.slice(i, i + 200));
        if (word) { out.push({ k: "id", v: word[0] }); i += word[0].length; continue; }
        if (c === ":" && sql[i + 1] === ":") { out.push({ k: "p", v: "::" }); i += 2; continue; }
        out.push({ k: "p", v: c });
        i++;
    }
    return out;
}

// ---------------------------------------------------------------- parser
interface Column {
    name: string;
    type: string;
    notNull: boolean;
    pk: boolean;
    unique: boolean;
    comment: string;
}
interface Fk {
    cols: string[];
    refTable: string;
    refCols: string[];
}
interface Table {
    name: string;
    columns: Column[];
    pk: string[];
    uniques: string[][];
    fks: Fk[];
}
interface Schema {
    tables: Map<string, Table>;
    warnings: string[];
}

const up = (t?: Tok) => (t && t.k === "id" ? t.v.toUpperCase() : "");
const lc = (s: string) => s.toLowerCase();

function splitStatements(toks: Tok[]): Tok[][] {
    const out: Tok[][] = [];
    let cur: Tok[] = [];
    for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        const isGo = up(t) === "GO" && cur.length === 0;
        if ((t.k === "p" && t.v === ";") || isGo) {
            if (cur.length) out.push(cur);
            cur = [];
            continue;
        }
        cur.push(t);
    }
    if (cur.length) out.push(cur);
    return out;
}

/** Splits tokens at depth-0 commas. */
function splitTop(toks: Tok[]): Tok[][] {
    const out: Tok[][] = [];
    let cur: Tok[] = [];
    let depth = 0;
    for (const t of toks) {
        if (t.k === "p" && t.v === "(") depth++;
        if (t.k === "p" && t.v === ")") depth--;
        if (t.k === "p" && t.v === "," && depth === 0) { out.push(cur); cur = []; continue; }
        cur.push(t);
    }
    if (cur.length) out.push(cur);
    return out;
}

/** Index of the ")" matching the "(" at `open`. */
function matchParen(toks: Tok[], open: number): number {
    let depth = 0;
    for (let i = open; i < toks.length; i++) {
        if (toks[i].k === "p" && toks[i].v === "(") depth++;
        else if (toks[i].k === "p" && toks[i].v === ")" && --depth === 0) return i;
    }
    return -1;
}

const isIdent = (t?: Tok) => !!t && (t.k === "id" || t.k === "qid");

/** Reads a possibly schema-qualified name; returns the last part and the next index. */
function readName(toks: Tok[], i: number): [string, number] {
    if (!isIdent(toks[i])) return ["", i];
    let name = toks[i].v;
    i++;
    while (toks[i]?.k === "p" && toks[i].v === "." && isIdent(toks[i + 1])) {
        name = toks[i + 1].v;
        i += 2;
    }
    return [name, i];
}

/** Reads "(a, b, c)" at i; returns names (with any "(len)" / ASC / DESC dropped) and the index after ")". */
function readCols(toks: Tok[], i: number): [string[], number] {
    if (!(toks[i]?.k === "p" && toks[i].v === "(")) return [[], i];
    const end = matchParen(toks, i);
    if (end < 0) return [[], toks.length];
    const cols = splitTop(toks.slice(i + 1, end))
        .map((part) => (isIdent(part[0]) ? part[0].v : ""))
        .filter(Boolean);
    return [cols, end + 1];
}

function typeText(toks: Tok[]): string {
    let s = "";
    for (const t of toks) {
        const v = t.k === "str" ? `'${t.v}'` : t.k === "qid" ? t.v : t.v;
        const noSpaceBefore = t.k === "p" && ["(", ")", ",", "[]"].includes(t.v);
        const prev = s[s.length - 1];
        if (s && !noSpaceBefore && prev !== "(" && prev !== ",") s += " ";
        s += v;
    }
    return s;
}

const TYPE_STOP = new Set([
    "CONSTRAINT", "NOT", "NULL", "PRIMARY", "REFERENCES", "UNIQUE", "DEFAULT", "CHECK", "AUTO_INCREMENT", "AUTOINCREMENT",
    "IDENTITY", "GENERATED", "COLLATE", "COMMENT", "ON", "AS", "CHARSET", "KEY", "ENCODE", "STORAGE", "INVISIBLE", "VISIBLE",
    "SERIAL_DEFAULT_VALUE", "SPARSE", "ROWGUIDCOL", "FILESTREAM", "MASKED", "ENCRYPTED",
]);

function parseColumn(toks: Tok[], table: Table, schema: Schema) {
    const col: Column = { name: toks[0].v, type: "", notNull: false, pk: false, unique: false, comment: "" };
    let i = 1;
    const typeToks: Tok[] = [];
    while (i < toks.length) {
        const u = up(toks[i]);
        if (TYPE_STOP.has(u)) break;
        if (u === "CHARACTER" && up(toks[i + 1]) === "SET") break;
        if (toks[i].k === "p" && toks[i].v === "(") {
            const end = matchParen(toks, i);
            typeToks.push(...toks.slice(i, end < 0 ? toks.length : end + 1));
            i = end < 0 ? toks.length : end + 1;
            continue;
        }
        typeToks.push(toks[i++]);
    }
    col.type = typeText(typeToks) || "unknown";
    while (i < toks.length) {
        const u = up(toks[i]);
        if (u === "NOT" && up(toks[i + 1]) === "NULL") { col.notNull = true; i += 2; continue; }
        if (u === "PRIMARY" && up(toks[i + 1]) === "KEY") { col.pk = true; col.notNull = true; i += 2; continue; }
        if (u === "UNIQUE") { col.unique = true; i += up(toks[i + 1]) === "KEY" ? 2 : 1; continue; }
        if (u === "COMMENT" && toks[i + 1]?.k === "str") { col.comment = toks[i + 1].v; i += 2; continue; }
        if (u === "REFERENCES") {
            const [ref, j] = readName(toks, i + 1);
            const [refCols, k] = readCols(toks, j);
            if (ref) table.fks.push({ cols: [col.name], refTable: ref, refCols });
            else schema.warnings.push(`${table.name}.${col.name}: could not read the REFERENCES target.`);
            i = k;
            continue;
        }
        if (toks[i].k === "p" && toks[i].v === "(") {
            const end = matchParen(toks, i);
            i = end < 0 ? toks.length : end + 1;
            continue;
        }
        i++;
    }
    table.columns.push(col);
}

/** Parses a table-level constraint (PRIMARY KEY / UNIQUE / FOREIGN KEY); returns false when the item is not a constraint. */
function parseTableConstraint(toks: Tok[], table: Table, schema: Schema): boolean {
    let i = 0;
    if (up(toks[0]) === "CONSTRAINT") i = isIdent(toks[1]) && !["PRIMARY", "UNIQUE", "FOREIGN", "CHECK"].includes(up(toks[1])) ? 2 : 1;
    const u = up(toks[i]);
    if (u === "PRIMARY" && up(toks[i + 1]) === "KEY") {
        let j = i + 2;
        while (toks[j] && !(toks[j].k === "p" && toks[j].v === "(")) j++;
        const [cols] = readCols(toks, j);
        table.pk = cols;
        return true;
    }
    if (u === "UNIQUE") {
        let j = i + 1;
        while (toks[j] && !(toks[j].k === "p" && toks[j].v === "(")) j++;
        const [cols] = readCols(toks, j);
        if (cols.length) table.uniques.push(cols);
        return true;
    }
    if (u === "FOREIGN" && up(toks[i + 1]) === "KEY") {
        let j = i + 2;
        while (toks[j] && !(toks[j].k === "p" && toks[j].v === "(")) j++;
        const [cols, k] = readCols(toks, j);
        if (up(toks[k]) !== "REFERENCES") {
            schema.warnings.push(`${table.name}: FOREIGN KEY without REFERENCES was skipped.`);
            return true;
        }
        const [ref, m] = readName(toks, k + 1);
        const [refCols] = readCols(toks, m);
        table.fks.push({ cols, refTable: ref, refCols });
        return true;
    }
    // A column may be called "key" or "index": treat it as a column when a type name follows.
    if ((u === "KEY" || u === "INDEX") && i === 0 && /^(var|n?char|n?varchar|int|integer|bigint|smallint|tinyint|text|uuid|date|datetime|timestamp|bool|boolean|decimal|numeric|float|double|real|json|jsonb|blob|bytea|serial|bigserial)$/i.test(toks[1]?.v ?? "")) return false;
    if (["CHECK", "KEY", "INDEX", "FULLTEXT", "SPATIAL", "EXCLUDE", "PERIOD", "LIKE"].includes(u) || (i > 0 && u)) return true;
    return false;
}

function getOrCreate(schema: Schema, name: string): Table {
    const key = lc(name);
    let t = schema.tables.get(key);
    if (!t) {
        t = { name, columns: [], pk: [], uniques: [], fks: [] };
        schema.tables.set(key, t);
    }
    return t;
}

function parseSchema(sql: string): Schema {
    const schema: Schema = { tables: new Map(), warnings: [] };
    for (const st of splitStatements(tokenize(sql))) {
        const head = up(st[0]);
        if (head === "CREATE") {
            let i = 1;
            while (["OR", "REPLACE", "GLOBAL", "LOCAL", "TEMP", "TEMPORARY", "UNLOGGED", "VIRTUAL"].includes(up(st[i]))) i++;
            if (up(st[i]) !== "TABLE") continue; // views, indexes, sequences… are ignored
            i++;
            if (up(st[i]) === "IF" && up(st[i + 1]) === "NOT" && up(st[i + 2]) === "EXISTS") i += 3;
            const [name, j] = readName(st, i);
            if (!name) { schema.warnings.push("A CREATE TABLE without a readable name was skipped."); continue; }
            if (!(st[j]?.k === "p" && st[j].v === "(")) {
                schema.warnings.push(`${name}: CREATE TABLE without a column list (e.g. AS SELECT) was skipped.`);
                continue;
            }
            const end = matchParen(st, j);
            if (end < 0) { schema.warnings.push(`${name}: unbalanced parentheses.`); continue; }
            const table = getOrCreate(schema, name);
            for (const item of splitTop(st.slice(j + 1, end))) {
                if (!item.length) continue;
                if (item[0].k === "id" && parseTableConstraint(item, table, schema)) continue;
                if (isIdent(item[0])) parseColumn(item, table, schema);
            }
        } else if (head === "ALTER" && up(st[1]) === "TABLE") {
            let i = 2;
            while (["ONLY", "IF", "EXISTS"].includes(up(st[i]))) i++;
            const [name, j] = readName(st, i);
            if (!name) continue;
            const table = getOrCreate(schema, name);
            for (const action of splitTop(st.slice(j))) {
                if (up(action[0]) !== "ADD") continue;
                const rest = action.slice(1);
                if (up(rest[0]) === "COLUMN") {
                    const r = rest.slice(1);
                    let k = 0;
                    if (up(r[0]) === "IF" && up(r[1]) === "NOT" && up(r[2]) === "EXISTS") k = 3;
                    if (isIdent(r[k])) parseColumn(r.slice(k), table, schema);
                } else if (!parseTableConstraint(rest, table, schema) && isIdent(rest[0])) {
                    parseColumn(rest, table, schema);
                }
            }
        }
    }
    // Fold column-level flags with table-level keys.
    for (const t of schema.tables.values()) {
        for (const c of t.columns) {
            if (t.pk.some((p) => lc(p) === lc(c.name))) { c.pk = true; c.notNull = true; }
            if (c.pk && !t.pk.length) t.pk = [c.name];
            if (c.unique) t.uniques.push([c.name]);
        }
        for (const u of t.uniques) if (u.length === 1) {
            const c = t.columns.find((x) => lc(x.name) === lc(u[0]));
            if (c) c.unique = true;
        }
    }
    return schema;
}

// ---------------------------------------------------------------- Mermaid output
type TypeMode = "full" | "base" | "none";
type ColMode = "all" | "keys" | "none";
const typeMode = useStorage<TypeMode>("devtools:sql-er-diagram:type-mode", "full");
const colMode = useStorage<ColMode>("devtools:sql-er-diagram:col-mode", "all");
const direction = useStorage<"TB" | "LR">("devtools:sql-er-diagram:direction", "TB");
const showComments = useStorage("devtools:sql-er-diagram:comments", true);
const input = useStorage("devtools:sql-er-diagram:input", SAMPLE);

function safeName(s: string): string {
    let r = s.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "unnamed";
    if (!/^[A-Za-z_]/.test(r)) r = "t_" + r;
    return r;
}
function safeType(t: string): string {
    if (typeMode.value === "none") return "col";
    let s = t.trim();
    if (typeMode.value === "base") s = s.replace(/\s*\(.*$/s, "");
    s = s
        .replace(/'/g, "")
        .replace(/\s*,\s*/g, "_")
        .replace(/\s+/g, "_")
        .replace(/[^A-Za-z0-9_\-()[\]]/g, "_");
    // Parentheses must balance and an empty arg list looks odd.
    if ((s.match(/\(/g) ?? []).length !== (s.match(/\)/g) ?? []).length) s = s.replace(/[()]/g, "_");
    s = s.replace(/\(\)/g, "");
    if (!/^[A-Za-z]/.test(s)) s = "t_" + s;
    return s.length > 60 ? s.slice(0, 57) + "___" : s;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.some((y) => lc(x) === lc(y)));

const result = computed(() => {
    const schema = parseSchema(input.value);
    const warnings = [...schema.warnings];
    const lines = ["erDiagram"];
    if (direction.value === "LR") lines.push("    direction LR");
    const tables = [...schema.tables.values()];
    const rels: string[] = [];
    let relCount = 0;
    for (const t of tables) {
        const fkCols = new Set(t.fks.flatMap((f) => f.cols.map(lc)));
        const cols = t.columns.filter((c) => colMode.value === "all" || (colMode.value === "keys" && (c.pk || c.unique || fkCols.has(lc(c.name)))));
        if (colMode.value === "none" || !cols.length) {
            lines.push(`    ${safeName(t.name)} {`, "    }");
        } else {
            lines.push(`    ${safeName(t.name)} {`);
            for (const c of cols) {
                const keys = [c.pk && "PK", fkCols.has(lc(c.name)) && "FK", c.unique && !c.pk && "UK"].filter(Boolean).join(", ");
                let line = `        ${safeType(c.type)} ${safeName(c.name)}`;
                if (keys) line += ` ${keys}`;
                if (showComments.value && c.comment) line += ` "${c.comment.replace(/"/g, "'").replace(/\s+/g, " ")}"`;
                lines.push(line);
            }
            lines.push("    }");
        }
        for (const fk of t.fks) {
            const parent = schema.tables.get(lc(fk.refTable));
            if (!parent) warnings.push(`${t.name} references ${fk.refTable}, which is not defined in the input.`);
            const unique = (t.pk.length > 0 && sameSet(fk.cols, t.pk)) || t.uniques.some((u) => sameSet(u, fk.cols));
            const nullable = fk.cols.some((name) => {
                const c = t.columns.find((x) => lc(x.name) === lc(name));
                return c ? !c.notNull && !c.pk : false;
            });
            const left = nullable ? "|o" : "||";
            const right = unique ? "o|" : "o{";
            rels.push(`    ${safeName(parent?.name ?? fk.refTable)} ${left}--${right} ${safeName(t.name)} : "${fk.cols.join(", ")}"`);
            relCount++;
        }
    }
    if (!tables.length && input.value.trim()) warnings.push("No CREATE TABLE statements found.");
    return { code: tables.length ? [...lines, ...rels].join("\n") + "\n" : "", warnings, tableCount: tables.length, relCount };
});

// ---------------------------------------------------------------- rendering (same approach as the Mermaid editor)
const svg = ref("");
const renderError = ref("");
const loading = ref(false);
const zoom = ref(1);
const viewport = ref<HTMLElement | null>(null);
const holder = ref<HTMLElement | null>(null);

let mermaidMod: typeof import("mermaid").default | null = null;
let counter = 0;
let renderToken = 0;

function cleanup(id: string) {
    document.getElementById(id)?.remove();
    document.getElementById("d" + id)?.remove();
}

async function render() {
    const src = result.value.code;
    const token = ++renderToken;
    if (!src.trim()) {
        svg.value = "";
        renderError.value = "";
        return;
    }
    try {
        if (!mermaidMod) {
            loading.value = true;
            mermaidMod = (await import("mermaid")).default;
        }
        mermaidMod.initialize({ startOnLoad: false, securityLevel: "strict", theme: isDark.value ? "dark" : "default" });
        const id = `sqler-${Date.now()}-${counter++}`;
        try {
            const res = await mermaidMod.render(id, src);
            if (token !== renderToken) return;
            svg.value = res.svg;
            renderError.value = "";
        } finally {
            cleanup(id);
        }
    } catch (e) {
        if (token !== renderToken) return;
        renderError.value = e instanceof Error ? e.message : String(e);
    } finally {
        loading.value = false;
    }
}
const debounced = useDebounceFn(render, 350);
watch(() => result.value.code, () => debounced());
watch(isDark, () => render());
render();

onBeforeUnmount(() => {
    renderToken++;
    document.querySelectorAll('[id^="dsqler-"]').forEach((n) => n.remove());
});

function zoomBy(f: number) {
    zoom.value = Math.min(5, Math.max(0.2, +(zoom.value * f).toFixed(3)));
}
function svgSize() {
    const el = holder.value?.querySelector("svg");
    if (!el) return { w: 0, h: 0 };
    const vb = el.viewBox.baseVal;
    if (vb && vb.width) return { w: vb.width, h: vb.height };
    const r = el.getBoundingClientRect();
    return { w: r.width / zoom.value, h: r.height / zoom.value };
}
function fit() {
    const { w, h } = svgSize();
    const vp = viewport.value;
    if (!w || !vp) return;
    zoom.value = Math.min(5, Math.max(0.2, Math.min((vp.clientWidth - 24) / w, (vp.clientHeight - 24) / h)));
}
function sizedSvg() {
    const { w, h } = svgSize();
    const doc = new DOMParser().parseFromString(svg.value, "image/svg+xml");
    const root = doc.documentElement;
    root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    if (w) {
        root.setAttribute("width", String(w));
        root.setAttribute("height", String(h));
    }
    root.removeAttribute("style");
    return { text: new XMLSerializer().serializeToString(root), w, h };
}
function downloadSvg() {
    if (svg.value) downloadBlob(sizedSvg().text, "er-diagram.svg", "image/svg+xml");
}
async function downloadPng() {
    if (!svg.value) return;
    const { text, w, h } = sizedSvg();
    if (!w) return;
    const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml;charset=utf-8" }));
    try {
        const img = new Image();
        img.src = url;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(w * 2);
        canvas.height = Math.round(h * 2);
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = isDark.value ? "#171717" : "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
        if (blob) downloadBlob(blob, "er-diagram.png", "image/png");
    } catch {
        renderError.value = "PNG export failed in this browser; try SVG export instead.";
    } finally {
        URL.revokeObjectURL(url);
    }
}

useHandoff<{ input?: string }>("sql-er-diagram", (p) => {
    if (p.input != null) input.value = p.input;
});
</script>

<template>
    <ToolPage>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <label class="flex items-center gap-2">
                <span class="text-muted">Types</span>
                <select v-model="typeMode" class="select !w-auto !py-1">
                    <option value="full">With arguments</option>
                    <option value="base">Base type only</option>
                    <option value="none">Hide</option>
                </select>
            </label>
            <label class="flex items-center gap-2">
                <span class="text-muted">Columns</span>
                <select v-model="colMode" class="select !w-auto !py-1">
                    <option value="all">All</option>
                    <option value="keys">Keys only</option>
                    <option value="none">None</option>
                </select>
            </label>
            <Tabs v-model="direction" size="sm" :options="[{ value: 'TB', label: 'Top-down' }, { value: 'LR', label: 'Left-right' }]" />
            <label class="flex items-center gap-2"><input v-model="showComments" type="checkbox" class="checkbox" /> Column comments</label>
            <span class="text-xs text-muted">{{ result.tableCount }} tables · {{ result.relCount }} relationships</span>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
            <Panel title="SQL DDL" flush>
                <template #actions>
                    <Btn size="sm" variant="ghost" @click="input = SAMPLE"><Sparkles /> Sample</Btn>
                    <Btn size="sm" variant="ghost" @click="async () => (input = await readClipboard())"><ClipboardPaste /> Paste</Btn>
                    <Btn size="sm" variant="ghost" :disabled="!input" @click="input = ''"><Trash2 /> Clear</Btn>
                </template>
                <CodeArea v-model="input" language="sql" :wrap="false" height="24rem" placeholder="Paste CREATE TABLE statements…" />
            </Panel>
            <Panel title="Mermaid erDiagram" flush>
                <template #actions>
                    <CopyButton :text="result.code" />
                    <Btn size="sm" variant="ghost" :disabled="!result.code" @click="downloadBlob(result.code, 'er-diagram.mmd')"><Download /> .mmd</Btn>
                </template>
                <CodeArea :model-value="result.code" readonly :wrap="false" height="24rem" placeholder="The Mermaid source appears here" />
            </Panel>
        </div>

        <Notice v-if="result.warnings.length" type="warning">
            <ul class="list-disc space-y-0.5 pl-4">
                <li v-for="(w, i) in result.warnings" :key="i">{{ w }}</li>
            </ul>
        </Notice>

        <Panel title="Diagram" flush>
            <div class="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2">
                <Btn size="sm" variant="ghost" title="Zoom out" @click="zoomBy(1 / 1.2)"><ZoomOut /></Btn>
                <span class="w-12 text-center font-mono text-xs text-muted">{{ Math.round(zoom * 100) }}%</span>
                <Btn size="sm" variant="ghost" title="Zoom in" @click="zoomBy(1.2)"><ZoomIn /></Btn>
                <Btn size="sm" variant="ghost" @click="zoom = 1">100%</Btn>
                <Btn size="sm" variant="ghost" @click="fit"><Maximize /> Fit</Btn>
                <span class="flex-1" />
                <Btn size="sm" variant="ghost" :disabled="!svg" @click="downloadSvg"><Download /> SVG</Btn>
                <Btn size="sm" variant="ghost" :disabled="!svg" @click="downloadPng"><Download /> PNG</Btn>
            </div>
            <div ref="viewport" class="h-[32rem] overflow-auto bg-subtle p-3">
                <p v-if="loading && !svg" class="text-sm text-muted">Loading Mermaid…</p>
                <p v-else-if="!svg && !renderError" class="text-sm text-muted">Nothing to render.</p>
                <div ref="holder" class="inline-block origin-top-left" :style="{ transform: `scale(${zoom})` }" v-html="svg" />
            </div>
        </Panel>
        <Notice v-if="renderError" type="error"><pre class="font-mono text-xs whitespace-pre-wrap">{{ renderError }}</pre></Notice>
    </ToolPage>
</template>
