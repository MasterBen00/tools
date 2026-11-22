<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStorage } from "@vueuse/core";
import Papa from "papaparse";
import { ClipboardPaste, Download, Sparkles, Trash2 } from "lucide-vue-next";
import { Btn, CodeArea, CopyButton, Notice, Panel, ToolPage } from "@/components/ui";
import { useHandoff } from "@/composables/handoff";
import { downloadBlob, readClipboard } from "@/composables/useClipboard";

type Dialect = "mysql" | "postgres" | "sqlite" | "sqlserver" | "oracle";
const DIALECTS: { value: Dialect; label: string }[] = [
    { value: "mysql", label: "MySQL / MariaDB" },
    { value: "postgres", label: "PostgreSQL" },
    { value: "sqlite", label: "SQLite" },
    { value: "sqlserver", label: "SQL Server" },
    { value: "oracle", label: "Oracle" },
];

const SAMPLE = `id,name,email,city,balance,is_active,joined_on,notes
1,Rahim Uddin,rahim@example.com,Dhaka,1520.50,true,2024-01-15,
2,Ayesha Khan,ayesha@example.com,Chattogram,0,false,2024-02-03,"Prefers ""SMS"" alerts"
3,O'Brien Liam,liam@example.org,Dublin,320.75,true,2024-03-21,NULL
4,Nusrat Jahan,nusrat@example.net,Sylhet,98000,true,2024-04-09,"VIP, priority support"
5,Karim Hossain,karim@example.com,Rajshahi,-45.10,false,2024-05-30,C:\\temp\\export
`;

const input = useStorage("devtools:sql-insert-generator:input", SAMPLE);
const table = useStorage("devtools:sql-insert-generator:table", "customers");
const dialect = useStorage<Dialect>("devtools:sql-insert-generator:dialect", "mysql");
const batch = useStorage("devtools:sql-insert-generator:batch", 100);
const header = useStorage("devtools:sql-insert-generator:header", true);
const emptyNull = useStorage("devtools:sql-insert-generator:empty-null", true);
const nullText = useStorage("devtools:sql-insert-generator:null-text", true);
const detectTypes = useStorage("devtools:sql-insert-generator:detect-types", true);
const createTable = useStorage("devtools:sql-insert-generator:create", false);
const transaction = useStorage("devtools:sql-insert-generator:tx", false);
const ignoreDup = useStorage("devtools:sql-insert-generator:ignore", false);
const quoteAll = useStorage("devtools:sql-insert-generator:quote", true);
const excluded = ref<string[]>([]);

// ---------------------------------------------------------------- parse input
type Cell = string | number | boolean | null;
interface Parsed {
    format: "json" | "csv";
    cols: string[];
    rows: Cell[][];
    error?: string;
    note?: string;
}

const parsed = computed<Parsed>(() => {
    const text = input.value.trim();
    if (!text) return { format: "csv", cols: [], rows: [] };
    if (text.startsWith("[") || text.startsWith("{")) {
        let json: unknown;
        try {
            json = JSON.parse(text);
        } catch (e) {
            return { format: "json", cols: [], rows: [], error: `JSON: ${(e as Error).message}` };
        }
        const arr = Array.isArray(json) ? json : [json];
        const cols: string[] = [];
        const seen = new Set<string>();
        for (const r of arr) {
            if (r === null || typeof r !== "object" || Array.isArray(r))
                return { format: "json", cols: [], rows: [], error: "JSON input must be an array of objects." };
            for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
        }
        const rows = arr.map((r) =>
            cols.map((c): Cell => {
                const v = (r as Record<string, unknown>)[c];
                if (v === undefined || v === null) return null;
                if (typeof v === "object") return JSON.stringify(v);
                if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
                return String(v);
            }),
        );
        return { format: "json", cols, rows };
    }
    const res = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
    const data = res.data;
    if (!data.length) return { format: "csv", cols: [], rows: [] };
    const width = data.reduce((m, r) => Math.max(m, r.length), 0);
    let cols: string[];
    let rows: string[][];
    if (header.value) {
        cols = Array.from({ length: width }, (_, i) => (data[0][i] ?? "").trim() || `column_${i + 1}`);
        rows = data.slice(1);
    } else {
        cols = Array.from({ length: width }, (_, i) => `column_${i + 1}`);
        rows = data;
    }
    const delim = res.meta.delimiter === "\t" ? "tab" : JSON.stringify(res.meta.delimiter);
    const quoteErr = res.errors.find((e) => e.type === "Quotes");
    return {
        format: "csv",
        cols,
        rows: rows.map((r) => cols.map((_, i) => r[i] ?? "")),
        error: quoteErr ? `Row ${(quoteErr.row ?? 0) + 1}: ${quoteErr.message}` : undefined,
        note: `CSV, delimiter ${delim}`,
    };
});

watch(() => parsed.value.cols.join("\u0000"), () => {
    excluded.value = excluded.value.filter((c) => parsed.value.cols.includes(c));
});

const activeIdx = computed(() => parsed.value.cols.map((c, i) => [c, i] as const).filter(([c]) => !excluded.value.includes(c)));

function toggleCol(c: string) {
    excluded.value = excluded.value.includes(c) ? excluded.value.filter((x) => x !== c) : [...excluded.value, c];
}

// ---------------------------------------------------------------- value typing
type Kind = "null" | "int" | "dec" | "bool" | "date" | "datetime" | "str";
interface Val {
    kind: Kind;
    raw: string;
}
const NUM_RE = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

function classify(v: Cell): Val {
    if (v === null) return { kind: "null", raw: "" };
    if (typeof v === "number") return { kind: Number.isInteger(v) ? "int" : "dec", raw: String(v) };
    if (typeof v === "boolean") return { kind: "bool", raw: String(v) };
    if (emptyNull.value && v === "") return { kind: "null", raw: "" };
    if (nullText.value && /^null$/i.test(v.trim())) return { kind: "null", raw: "" };
    if (detectTypes.value) {
        const t = v.trim();
        if (NUM_RE.test(t) && t === v) return { kind: /[.eE]/.test(t) ? "dec" : "int", raw: t };
        if (/^(true|false)$/i.test(t)) return { kind: "bool", raw: t.toLowerCase() };
        if (DATE_RE.test(t)) return { kind: "date", raw: t };
        if (DATETIME_RE.test(t)) return { kind: "datetime", raw: t };
    }
    return { kind: "str", raw: v };
}

function quoteIdent(name: string): string {
    const d = dialect.value;
    if (!quoteAll.value && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
    if (d === "mysql") return "`" + name.replace(/`/g, "``") + "`";
    if (d === "sqlserver") return "[" + name.replace(/]/g, "]]") + "]";
    return '"' + name.replace(/"/g, '""') + '"';
}
const tableIdent = computed(() =>
    (table.value.trim() || "my_table")
        .split(".")
        .map((p) => quoteIdent(p.trim()))
        .join("."),
);

function strLit(s: string): string {
    let body = s.replace(/'/g, "''");
    if (dialect.value === "mysql") body = body.replace(/\\/g, "\\\\");
    // SQL Server needs the N prefix to keep non-ASCII characters intact in NVARCHAR columns.
    return (dialect.value === "sqlserver" && /[^\x00-\x7F]/.test(s) ? "N'" : "'") + body + "'";
}

function literal(v: Val): string {
    const d = dialect.value;
    switch (v.kind) {
        case "null": return "NULL";
        case "int":
        case "dec": return v.raw;
        case "bool": {
            const t = v.raw === "true";
            return d === "mysql" || d === "postgres" ? (t ? "TRUE" : "FALSE") : t ? "1" : "0";
        }
        case "date": return d === "oracle" ? `DATE '${v.raw}'` : `'${v.raw}'`;
        case "datetime":
            if (d === "oracle" && !/(Z|[+-]\d{2}:?\d{2})$/.test(v.raw)) return `TIMESTAMP '${v.raw.replace("T", " ")}'`;
            return strLit(v.raw);
        default: return strLit(v.raw);
    }
}

// ---------------------------------------------------------------- CREATE TABLE inference
function inferType(vals: Val[]): { type: string; nullable: boolean } {
    const d = dialect.value;
    const nonNull = vals.filter((v) => v.kind !== "null");
    const nullable = nonNull.length < vals.length;
    const kinds = new Set(nonNull.map((v) => v.kind));
    const text = () => {
        const max = nonNull.reduce((m, v) => Math.max(m, [...v.raw].length), 0);
        const len = max <= 50 ? 50 : max <= 100 ? 100 : max <= 255 ? 255 : 0;
        if (!len) return { mysql: "TEXT", postgres: "TEXT", sqlite: "TEXT", sqlserver: "NVARCHAR(MAX)", oracle: "CLOB" }[d];
        return { mysql: `VARCHAR(${len})`, postgres: `VARCHAR(${len})`, sqlite: "TEXT", sqlserver: `NVARCHAR(${len})`, oracle: `VARCHAR2(${len})` }[d];
    };
    if (!nonNull.length) return { type: text(), nullable: true };
    if (kinds.size === 1 && kinds.has("int")) {
        const big = nonNull.some((v) => Math.abs(Number(v.raw)) > 2147483647);
        const t = big
            ? { mysql: "BIGINT", postgres: "BIGINT", sqlite: "INTEGER", sqlserver: "BIGINT", oracle: "NUMBER(19)" }
            : { mysql: "INT", postgres: "INTEGER", sqlite: "INTEGER", sqlserver: "INT", oracle: "NUMBER(10)" };
        return { type: t[d], nullable };
    }
    if ([...kinds].every((k) => k === "int" || k === "dec")) {
        if (nonNull.some((v) => /[eE]/.test(v.raw)))
            return { type: { mysql: "DOUBLE", postgres: "DOUBLE PRECISION", sqlite: "REAL", sqlserver: "FLOAT", oracle: "BINARY_DOUBLE" }[d], nullable };
        let scale = 0;
        let intDigits = 1;
        for (const v of nonNull) {
            const [a, b = ""] = v.raw.replace("-", "").split(".");
            scale = Math.max(scale, b.length);
            intDigits = Math.max(intDigits, a.length);
        }
        const p = Math.min(38, intDigits + scale);
        return { type: d === "sqlite" ? "REAL" : d === "oracle" ? `NUMBER(${p},${scale})` : `DECIMAL(${p},${scale})`, nullable };
    }
    if (kinds.size === 1 && kinds.has("bool"))
        return { type: { mysql: "BOOLEAN", postgres: "BOOLEAN", sqlite: "INTEGER", sqlserver: "BIT", oracle: "NUMBER(1)" }[d], nullable };
    if (kinds.size === 1 && kinds.has("date")) return { type: d === "sqlite" ? "TEXT" : "DATE", nullable };
    if ([...kinds].every((k) => k === "date" || k === "datetime")) {
        const tz = nonNull.some((v) => /(Z|[+-]\d{2}:?\d{2})$/.test(v.raw));
        const t = { mysql: "DATETIME", postgres: tz ? "TIMESTAMPTZ" : "TIMESTAMP", sqlite: "TEXT", sqlserver: tz ? "DATETIMEOFFSET" : "DATETIME2", oracle: tz ? "TIMESTAMP WITH TIME ZONE" : "TIMESTAMP" }[d];
        return { type: t, nullable };
    }
    return { type: text(), nullable };
}

// ---------------------------------------------------------------- statements
const output = computed(() => {
    const p = parsed.value;
    const notes: string[] = [];
    if (!p.rows.length || !activeIdx.value.length) return { sql: "", statements: 0, rows: p.rows.length, notes };
    const d = dialect.value;
    const cols = activeIdx.value;
    const vals = p.rows.map((r) => cols.map(([, i]) => classify(r[i])));
    const colList = "(" + cols.map(([c]) => quoteIdent(c)).join(", ") + ")";
    const out: string[] = [];
    let statements = 0;

    if (createTable.value) {
        const defs = cols.map(([c], j) => {
            const { type, nullable } = inferType(vals.map((r) => r[j]));
            return `  ${quoteIdent(c)} ${type}${nullable ? "" : " NOT NULL"}`;
        });
        const ifne = d === "mysql" || d === "postgres" || d === "sqlite" ? "IF NOT EXISTS " : "";
        out.push(`CREATE TABLE ${ifne}${tableIdent.value} (\n${defs.join(",\n")}\n);`, "");
        statements++;
    }

    if (transaction.value) {
        const begin = { mysql: "START TRANSACTION;", postgres: "BEGIN;", sqlite: "BEGIN TRANSACTION;", sqlserver: "BEGIN TRANSACTION;", oracle: "" }[d];
        if (begin) { out.push(begin); statements++; }
        else notes.push("Oracle starts a transaction implicitly; only COMMIT is added.");
    }

    let size = Math.max(1, Math.floor(Number(batch.value) || 1));
    if (d === "sqlserver" && size > 1000) {
        size = 1000;
        notes.push("SQL Server allows at most 1000 rows per VALUES list; batches were capped at 1000.");
    }
    let verb = "INSERT INTO";
    let suffix = "";
    if (ignoreDup.value) {
        if (d === "mysql") verb = "INSERT IGNORE INTO";
        else if (d === "sqlite") verb = "INSERT OR IGNORE INTO";
        else if (d === "postgres") suffix = "\nON CONFLICT DO NOTHING";
        else notes.push(`${d === "oracle" ? "Oracle" : "SQL Server"} has no INSERT IGNORE; use MERGE to skip duplicates. The option was ignored.`);
    }
    const rowSql = (r: Val[]) => "(" + r.map(literal).join(", ") + ")";

    for (let start = 0; start < vals.length; start += size) {
        const chunk = vals.slice(start, start + size);
        if (d === "oracle" && chunk.length > 1) {
            out.push("INSERT ALL\n" + chunk.map((r) => `  INTO ${tableIdent.value} ${colList} VALUES ${rowSql(r)}`).join("\n") + "\nSELECT 1 FROM DUAL;");
        } else if (chunk.length === 1) {
            out.push(`${verb} ${tableIdent.value} ${colList} VALUES ${rowSql(chunk[0])}${suffix};`);
        } else {
            out.push(`${verb} ${tableIdent.value} ${colList} VALUES\n` + chunk.map((r) => "  " + rowSql(r)).join(",\n") + `${suffix};`);
        }
        statements++;
    }

    if (transaction.value) {
        out.push(d === "sqlserver" ? "COMMIT TRANSACTION;" : "COMMIT;");
        statements++;
    }
    return { sql: out.join("\n") + "\n", statements, rows: vals.length, notes };
});

function download() {
    downloadBlob(output.value.sql, `${(table.value.trim() || "data").replace(/[^\w.-]+/g, "_")}.sql`, "application/sql");
}

useHandoff<{ input?: string }>("sql-insert-generator", (p) => {
    if (p.input != null) input.value = p.input;
});
</script>

<template>
    <ToolPage>
        <div class="flex flex-wrap items-end gap-x-4 gap-y-3 text-sm">
            <label class="flex items-center gap-2">
                <span class="text-muted">Table</span>
                <input v-model="table" class="input !w-40 font-mono" spellcheck="false" aria-label="Table name" placeholder="schema.table" />
            </label>
            <label class="flex items-center gap-2">
                <span class="text-muted">Dialect</span>
                <select v-model="dialect" class="select !w-auto">
                    <option v-for="o in DIALECTS" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
            </label>
            <label class="flex items-center gap-2" title="Rows per INSERT statement; 1 writes one statement per row">
                <span class="text-muted">Rows per INSERT</span>
                <input v-model.number="batch" type="number" min="1" max="10000" class="input !w-24" />
            </label>
        </div>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <label class="flex items-center gap-2"><input v-model="header" type="checkbox" class="checkbox" /> CSV header row</label>
            <label class="flex items-center gap-2"><input v-model="detectTypes" type="checkbox" class="checkbox" /> Detect numbers, booleans, dates</label>
            <label class="flex items-center gap-2"><input v-model="emptyNull" type="checkbox" class="checkbox" /> Empty → NULL</label>
            <label class="flex items-center gap-2"><input v-model="nullText" type="checkbox" class="checkbox" /> Text NULL → NULL</label>
            <label class="flex items-center gap-2"><input v-model="quoteAll" type="checkbox" class="checkbox" /> Quote identifiers</label>
            <label class="flex items-center gap-2"><input v-model="createTable" type="checkbox" class="checkbox" /> CREATE TABLE</label>
            <label class="flex items-center gap-2"><input v-model="transaction" type="checkbox" class="checkbox" /> Wrap in transaction</label>
            <label class="flex items-center gap-2">
                <input v-model="ignoreDup" type="checkbox" class="checkbox" />
                {{ dialect === "mysql" ? "INSERT IGNORE" : dialect === "sqlite" ? "INSERT OR IGNORE" : "ON CONFLICT DO NOTHING" }}
            </label>
        </div>

        <div v-if="parsed.cols.length" class="flex flex-wrap items-center gap-1.5 text-sm">
            <span class="mr-1 text-muted">Columns</span>
            <button
                v-for="c in parsed.cols"
                :key="c"
                type="button"
                class="chip cursor-pointer"
                :class="excluded.includes(c) ? 'line-through opacity-50' : 'text-fg'"
                :title="excluded.includes(c) ? 'Excluded: click to include' : 'Included: click to exclude'"
                @click="toggleCol(c)"
            >
                {{ c }}
            </button>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
            <Panel title="CSV, TSV or JSON array" flush>
                <template #actions>
                    <Btn size="sm" variant="ghost" @click="input = SAMPLE"><Sparkles /> Sample</Btn>
                    <Btn size="sm" variant="ghost" @click="async () => (input = await readClipboard())"><ClipboardPaste /> Paste</Btn>
                    <Btn size="sm" variant="ghost" :disabled="!input" @click="input = ''"><Trash2 /> Clear</Btn>
                </template>
                <CodeArea v-model="input" :wrap="false" height="26rem" placeholder="id,name&#10;1,Alice&#10;&#10;or [{&quot;id&quot;: 1, &quot;name&quot;: &quot;Alice&quot;}]" :invalid="!!parsed.error" />
                <p class="border-t border-line px-4 py-2 text-xs text-muted">
                    {{ parsed.format === "json" ? "JSON array of objects" : parsed.note ?? "CSV" }} · {{ output.rows }} rows · {{ activeIdx.length }} of {{ parsed.cols.length }} columns
                </p>
            </Panel>
            <Panel flush>
                <template #title>SQL <span class="ml-1 text-xs font-normal text-muted">{{ output.statements }} statements</span></template>
                <template #actions>
                    <CopyButton :text="output.sql" />
                    <Btn size="sm" variant="ghost" :disabled="!output.sql" @click="download"><Download /> .sql</Btn>
                </template>
                <CodeArea :model-value="output.sql" language="sql" readonly :wrap="false" height="26rem" placeholder="INSERT statements appear here" />
            </Panel>
        </div>
        <Notice v-if="parsed.error" type="error">{{ parsed.error }}</Notice>
        <Notice v-for="(n, i) in output.notes" :key="i" type="info">{{ n }}</Notice>
    </ToolPage>
</template>
