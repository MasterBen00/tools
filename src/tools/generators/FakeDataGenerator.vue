<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStorage } from "@vueuse/core";
import Papa from "papaparse";
import { ArrowDown, ArrowUp, Download, Plus, RefreshCw, X } from "lucide-vue-next";
import { Btn, CodeBlock, CopyButton, Notice, Panel, Tabs, ToolPage } from "@/components/ui";
import { downloadBlob } from "@/composables/useClipboard";
import { BD, BD_TLDS, EMAIL_DOMAINS, GLOBAL, JOBS, LOREM, TLDS, URL_PATHS, URL_WORDS } from "./fakeData";

type FieldType =
    | "rowId" | "firstName" | "lastName" | "fullName" | "email" | "username" | "phone" | "street" | "city" | "country"
    | "postalCode" | "company" | "jobTitle" | "uuid" | "integer" | "decimal" | "boolean" | "date" | "datetime"
    | "pastDate" | "futureDate" | "ipv4" | "url" | "color" | "sentence" | "paragraph" | "enum";

const TYPES: { value: FieldType; label: string; group: string }[] = [
    { value: "rowId", label: "Row number", group: "Identity" },
    { value: "uuid", label: "UUID v4", group: "Identity" },
    { value: "firstName", label: "First name", group: "Person" },
    { value: "lastName", label: "Last name", group: "Person" },
    { value: "fullName", label: "Full name", group: "Person" },
    { value: "email", label: "Email", group: "Person" },
    { value: "username", label: "Username", group: "Person" },
    { value: "phone", label: "Phone", group: "Person" },
    { value: "jobTitle", label: "Job title", group: "Person" },
    { value: "company", label: "Company", group: "Person" },
    { value: "street", label: "Street address", group: "Address" },
    { value: "city", label: "City", group: "Address" },
    { value: "country", label: "Country", group: "Address" },
    { value: "postalCode", label: "Postal code", group: "Address" },
    { value: "integer", label: "Integer", group: "Numbers" },
    { value: "decimal", label: "Decimal", group: "Numbers" },
    { value: "boolean", label: "Boolean", group: "Numbers" },
    { value: "date", label: "Date in range", group: "Dates" },
    { value: "datetime", label: "ISO datetime in range", group: "Dates" },
    { value: "pastDate", label: "Past date", group: "Dates" },
    { value: "futureDate", label: "Future date", group: "Dates" },
    { value: "ipv4", label: "IPv4", group: "Internet" },
    { value: "url", label: "URL", group: "Internet" },
    { value: "color", label: "Hex color", group: "Internet" },
    { value: "sentence", label: "Lorem sentence", group: "Text" },
    { value: "paragraph", label: "Lorem paragraph", group: "Text" },
    { value: "enum", label: "One of a list", group: "Text" },
];
const GROUPS = [...new Set(TYPES.map((t) => t.group))];

interface FieldDef {
    id: number;
    name: string;
    type: FieldType;
    min?: number;
    max?: number;
    decimals?: number;
    from?: string;
    to?: string;
    values?: string;
}
type Locale = "global" | "bd";
type Format = "json" | "csv" | "sql" | "ndjson";
type Value = string | number | boolean;

let nextId = Date.now();
const f = (name: string, type: FieldType, extra: Partial<FieldDef> = {}): FieldDef => ({ id: nextId++, name, type, ...extra });

const PRESETS: Record<string, { locale: Locale; table: string; fields: () => FieldDef[] }> = {
    Users: {
        locale: "global",
        table: "users",
        fields: () => [
            f("id", "rowId", { min: 1 }), f("first_name", "firstName"), f("last_name", "lastName"), f("email", "email"),
            f("username", "username"), f("phone", "phone"), f("city", "city"), f("country", "country"),
            f("is_active", "boolean"), f("created_at", "datetime", { from: "2023-01-01", to: "2025-12-31" }),
        ],
    },
    Orders: {
        locale: "global",
        table: "orders",
        fields: () => [
            f("order_id", "uuid"), f("customer_id", "integer", { min: 1, max: 500 }),
            f("status", "enum", { values: "pending, paid, shipped, delivered, cancelled" }),
            f("total", "decimal", { min: 5, max: 900, decimals: 2 }), f("currency", "enum", { values: "USD, EUR, GBP" }),
            f("items", "integer", { min: 1, max: 8 }), f("ordered_at", "datetime", { from: "2025-01-01", to: "2025-12-31" }),
            f("delivery_date", "futureDate", { max: 30 }),
        ],
    },
    "Bangladeshi customers": {
        locale: "bd",
        table: "customers",
        fields: () => [
            f("id", "rowId", { min: 1001 }), f("full_name", "fullName"), f("phone", "phone"), f("email", "email"),
            f("address", "street"), f("city", "city"), f("postal_code", "postalCode"), f("employer", "company"),
            f("balance_bdt", "decimal", { min: 0, max: 250000, decimals: 2 }), f("joined_on", "pastDate", { max: 1095 }),
        ],
    },
};

const fields = useStorage<FieldDef[]>("devtools:fake-data-generator:fields", PRESETS.Users.fields());
const count = useStorage("devtools:fake-data-generator:count", 50);
const seed = useStorage("devtools:fake-data-generator:seed", "");
const locale = useStorage<Locale>("devtools:fake-data-generator:locale", "global");
const format = useStorage<Format>("devtools:fake-data-generator:format", "json");
const table = useStorage("devtools:fake-data-generator:table", "users");
const preset = ref("");
// Random seed used when no explicit seed is set; it only changes on Regenerate so editing a field name does not reshuffle.
const autoSeed = ref((Math.random() * 2 ** 32) >>> 0);

watch(preset, (p) => {
    const pr = PRESETS[p];
    if (pr) {
        fields.value = pr.fields();
        locale.value = pr.locale;
        table.value = pr.table;
    }
    preset.value = "";
});

function addField() {
    fields.value.push(f(`field_${fields.value.length + 1}`, "fullName"));
}
function move(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= fields.value.length) return;
    const arr = [...fields.value];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    fields.value = arr;
}
function onTypeChange(fd: FieldDef) {
    const defaults: Partial<Record<FieldType, Partial<FieldDef>>> = {
        integer: { min: 1, max: 1000 },
        decimal: { min: 0, max: 1000, decimals: 2 },
        rowId: { min: 1 },
        date: { from: "2020-01-01", to: "2025-12-31" },
        datetime: { from: "2024-01-01", to: "2025-12-31" },
        pastDate: { max: 365 },
        futureDate: { max: 90 },
        enum: { values: "red, green, blue" },
    };
    Object.assign(fd, defaults[fd.type] ?? {});
}

// ---------------------------------------------------------------- PRNG
function mulberry32(a: number) {
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function seedNumber(s: string): number {
    if (/^\d+$/.test(s)) return Number(BigInt(s) % 4294967296n);
    let h = 2166136261;
    for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
    return h >>> 0;
}

const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const pad = (n: number, w: number) => String(n).padStart(w, "0");
const DAY = 86400000;

const generated = computed(() => {
    const rnd = mulberry32(seed.value.trim() ? seedNumber(seed.value.trim()) : autoSeed.value);
    const seeded = !!seed.value.trim();
    const int = (a: number, b: number) => Math.floor(rnd() * (b - a + 1)) + a;
    const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
    const bd = locale.value === "bd";
    const L = bd ? BD : GLOBAL;
    const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
    const n = Math.min(10000, Math.max(1, Math.floor(Number(count.value) || 1)));
    const defs = fields.value;
    const rows: Record<string, Value>[] = [];

    const sentence = () => {
        const words = Array.from({ length: int(6, 14) }, () => pick(LOREM));
        const s = words.join(" ");
        return s[0].toUpperCase() + s.slice(1) + ".";
    };
    const uuid = () => {
        if (!seeded && typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
        const b = Array.from({ length: 16 }, () => int(0, 255));
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        const h = b.map((x) => x.toString(16).padStart(2, "0")).join("");
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    };
    const dateBetween = (from?: string, to?: string) => {
        const a = Date.parse(from || "2020-01-01");
        const b = Date.parse(to || "2025-12-31");
        const lo = Math.min(a || 0, b || 0);
        const hi = Math.max(a || 0, b || 0);
        return new Date(lo + Math.floor(rnd() * (hi - lo + DAY)));
    };
    const globalPhone = () => {
        const fmt = int(0, 4);
        if (fmt === 0) return `+1 (${int(201, 989)}) 555-01${pad(int(0, 99), 2)}`;
        if (fmt === 1) return `+44 7700 900${pad(int(0, 999), 3)}`;
        if (fmt === 2) return `+49 30 ${pad(int(0, 9999999), 7)}`;
        if (fmt === 3) return `+61 4${pad(int(0, 99), 2)} ${pad(int(0, 999), 3)} ${pad(int(0, 999), 3)}`;
        return `+81 90-${pad(int(0, 9999), 4)}-${pad(int(0, 9999), 4)}`;
    };

    for (let i = 0; i < n; i++) {
        let person: { first: string; last: string } | null = null;
        let place: { city: string; country: string; postal: string } | null = null;
        const getPerson = () =>
            (person ??= { first: rnd() < 0.5 ? pick(L.firstMale) : pick(L.firstFemale), last: pick(L.last) });
        const getPlace = () => {
            if (place) return place;
            if (bd) {
                const [city, base] = pick(BD.cities);
                place = { city, country: "Bangladesh", postal: pad(base + int(0, 99), 4) };
            } else {
                const [city, country] = pick(GLOBAL.places);
                place = { city, country, postal: pad(int(1000, 99999), 5) };
            }
            return place;
        };
        const row: Record<string, Value> = {};
        for (const d of defs) {
            const key = d.name || "field";
            let v: Value;
            switch (d.type) {
                case "rowId": v = (d.min ?? 1) + i; break;
                case "uuid": v = uuid(); break;
                case "firstName": v = getPerson().first; break;
                case "lastName": v = getPerson().last; break;
                case "fullName": v = `${getPerson().first} ${getPerson().last}`; break;
                case "email": {
                    const p = getPerson();
                    const sep = pick([".", "_", ""]);
                    const num = rnd() < 0.4 ? String(int(1, 99)) : "";
                    v = `${slug(p.first)}${sep}${slug(p.last)}${num}@${pick(EMAIL_DOMAINS)}`;
                    break;
                }
                case "username": {
                    const p = getPerson();
                    v = `${slug(p.first)}${pick([".", "_", ""])}${slug(p.last).slice(0, int(1, 6))}${int(1, 999)}`;
                    break;
                }
                case "phone": v = bd ? `+8801${pick(BD.operators).slice(1)}${pad(int(0, 99999999), 8)}` : globalPhone(); break;
                case "jobTitle": v = pick(JOBS); break;
                case "company":
                    v = bd ? `${pick(BD.companies)} ${pick(BD.companySuffix)}` : rnd() < 0.25 ? `${pick(GLOBAL.last)} & ${pick(GLOBAL.last)}` : `${pick(GLOBAL.companyWords)} ${pick(GLOBAL.companySuffix)}`;
                    break;
                case "street":
                    v = bd ? `House ${int(1, 120)}, Road ${int(1, 32)}, ${pick(BD.areas)}` : `${int(1, 9999)} ${pick(GLOBAL.streets)} ${pick(GLOBAL.streetTypes)}`;
                    break;
                case "city": v = getPlace().city; break;
                case "country": v = getPlace().country; break;
                case "postalCode": v = getPlace().postal; break;
                case "integer": {
                    const a = d.min ?? 0, b = d.max ?? 100;
                    v = int(Math.min(a, b), Math.max(a, b));
                    break;
                }
                case "decimal": {
                    const a = d.min ?? 0, b = d.max ?? 100, dec = Math.min(10, Math.max(0, d.decimals ?? 2));
                    v = Number((Math.min(a, b) + rnd() * Math.abs(b - a)).toFixed(dec));
                    break;
                }
                case "boolean": v = rnd() < 0.5; break;
                case "date": v = dateBetween(d.from, d.to).toISOString().slice(0, 10); break;
                case "datetime": v = dateBetween(d.from, d.to).toISOString().slice(0, 19) + "Z"; break;
                case "pastDate": v = new Date(today - int(0, Math.max(0, d.max ?? 365)) * DAY).toISOString().slice(0, 10); break;
                case "futureDate": v = new Date(today + int(1, Math.max(1, d.max ?? 90)) * DAY).toISOString().slice(0, 10); break;
                case "ipv4": {
                    let a = int(1, 223);
                    while (a === 10 || a === 127) a = int(1, 223);
                    v = `${a}.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`;
                    break;
                }
                case "url":
                    v = `https://www.${pick(URL_WORDS)}${pick(URL_WORDS)}.${pick(bd ? BD_TLDS : TLDS)}/${pick(URL_PATHS)}`;
                    break;
                case "color": v = "#" + int(0, 0xffffff).toString(16).padStart(6, "0"); break;
                case "sentence": v = sentence(); break;
                case "paragraph": v = Array.from({ length: int(3, 6) }, sentence).join(" "); break;
                case "enum": {
                    const opts = (d.values ?? "").split(",").map((s) => s.trim()).filter(Boolean);
                    v = opts.length ? pick(opts) : "";
                    break;
                }
                default: v = "";
            }
            row[key] = v;
        }
        rows.push(row);
    }
    return rows;
});

const columns = computed(() => [...new Set(fields.value.map((d) => d.name || "field"))]);
const duplicateNames = computed(() => columns.value.length !== fields.value.length);

function sqlIdent(s: string) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`;
}
function sqlValue(v: Value) {
    if (typeof v === "number") return String(v);
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    return `'${v.replace(/'/g, "''")}'`;
}

const output = computed(() => {
    const rows = generated.value;
    switch (format.value) {
        case "json": return JSON.stringify(rows, null, 2) + "\n";
        case "ndjson": return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
        case "csv": return Papa.unparse(rows, { columns: columns.value, newline: "\n" }) + "\n";
        case "sql": {
            const t = (table.value.trim() || "fake_data").split(".").map(sqlIdent).join(".");
            const cols = columns.value;
            const head = `INSERT INTO ${t} (${cols.map(sqlIdent).join(", ")}) VALUES\n`;
            const out: string[] = [];
            for (let s = 0; s < rows.length; s += 500) {
                out.push(head + rows.slice(s, s + 500).map((r) => "  (" + cols.map((c) => sqlValue(r[c])).join(", ") + ")").join(",\n") + ";");
            }
            return out.join("\n\n") + "\n";
        }
    }
    return "";
});

const PREVIEW_LINES = 120;
const outputPreview = computed(() => {
    const lines = output.value.split("\n");
    return lines.length > PREVIEW_LINES ? lines.slice(0, PREVIEW_LINES).join("\n") + `\n… (${lines.length - PREVIEW_LINES} more lines; copy or download for everything)` : output.value;
});

function download() {
    const ext = { json: "json", ndjson: "ndjson", csv: "csv", sql: "sql" }[format.value];
    const mime = { json: "application/json", ndjson: "application/x-ndjson", csv: "text/csv", sql: "application/sql" }[format.value];
    downloadBlob(output.value, `${(table.value.trim() || "fake-data").replace(/[^\w.-]+/g, "_")}.${ext}`, mime);
}

const needsRange = (t: FieldType) => t === "integer" || t === "decimal";
const needsDates = (t: FieldType) => t === "date" || t === "datetime";
</script>

<template>
    <ToolPage>
        <template #actions>
            <Btn variant="primary" :disabled="!!seed.trim()" :title="seed.trim() ? 'Clear the seed to get new random data' : 'Generate a new random set'" @click="autoSeed = (Math.random() * 2 ** 32) >>> 0">
                <RefreshCw /> Regenerate
            </Btn>
        </template>

        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <label class="flex items-center gap-2">
                <span class="text-muted">Rows</span>
                <input v-model.number="count" type="number" min="1" max="10000" class="input !w-24" />
            </label>
            <label class="flex items-center gap-2">
                <span class="text-muted">Seed</span>
                <input v-model="seed" class="input !w-32 font-mono" placeholder="random" spellcheck="false" />
            </label>
            <Tabs v-model="locale" size="sm" :options="[{ value: 'global', label: 'Global' }, { value: 'bd', label: 'Bangladesh' }]" />
            <select v-model="preset" class="select !w-auto" aria-label="Presets">
                <option value="">Presets…</option>
                <option v-for="(_, k) in PRESETS" :key="k" :value="k">{{ k }}</option>
            </select>
        </div>

        <Panel title="Fields" flush>
            <template #actions>
                <Btn size="sm" variant="ghost" @click="addField"><Plus /> Add field</Btn>
            </template>
            <div class="divide-y divide-line">
                <div v-for="(fd, i) in fields" :key="fd.id" class="flex flex-wrap items-center gap-2 px-4 py-2">
                    <input v-model="fd.name" class="input !w-40 font-mono" placeholder="field name" spellcheck="false" aria-label="Field name" />
                    <select v-model="fd.type" class="select !w-48" aria-label="Field type" @change="onTypeChange(fd)">
                        <optgroup v-for="g in GROUPS" :key="g" :label="g">
                            <option v-for="t in TYPES.filter((x) => x.group === g)" :key="t.value" :value="t.value">{{ t.label }}</option>
                        </optgroup>
                    </select>
                    <template v-if="needsRange(fd.type)">
                        <input v-model.number="fd.min" type="number" class="input !w-24" placeholder="min" aria-label="Minimum" />
                        <span class="text-muted">to</span>
                        <input v-model.number="fd.max" type="number" class="input !w-24" placeholder="max" aria-label="Maximum" />
                        <label v-if="fd.type === 'decimal'" class="flex items-center gap-1 text-xs text-muted">
                            decimals <input v-model.number="fd.decimals" type="number" min="0" max="10" class="input !w-16" />
                        </label>
                    </template>
                    <label v-else-if="fd.type === 'rowId'" class="flex items-center gap-1 text-xs text-muted">
                        start at <input v-model.number="fd.min" type="number" class="input !w-24" />
                    </label>
                    <template v-else-if="needsDates(fd.type)">
                        <input v-model="fd.from" type="date" class="input !w-40" aria-label="From date" />
                        <span class="text-muted">to</span>
                        <input v-model="fd.to" type="date" class="input !w-40" aria-label="To date" />
                    </template>
                    <label v-else-if="fd.type === 'pastDate' || fd.type === 'futureDate'" class="flex items-center gap-1 text-xs text-muted">
                        within <input v-model.number="fd.max" type="number" min="1" class="input !w-24" /> days
                    </label>
                    <input v-else-if="fd.type === 'enum'" v-model="fd.values" class="input min-w-0 flex-1" placeholder="comma, separated, values" aria-label="Values" />
                    <span class="flex-1" />
                    <div class="flex items-center">
                        <Btn size="sm" variant="ghost" title="Move up" :disabled="i === 0" @click="move(i, -1)"><ArrowUp /></Btn>
                        <Btn size="sm" variant="ghost" title="Move down" :disabled="i === fields.length - 1" @click="move(i, 1)"><ArrowDown /></Btn>
                        <Btn size="sm" variant="ghost" title="Remove" @click="fields.splice(i, 1)"><X /></Btn>
                    </div>
                </div>
                <p v-if="!fields.length" class="px-4 py-3 text-sm text-muted">No fields. Add one or pick a preset.</p>
            </div>
        </Panel>
        <Notice v-if="duplicateNames" type="warning">Some field names repeat; later fields overwrite earlier ones with the same name.</Notice>

        <Panel flush>
            <template #title>Preview <span class="ml-1 text-xs font-normal text-muted">first {{ Math.min(20, generated.length) }} of {{ generated.length }} rows</span></template>
            <div class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead class="text-left text-xs text-muted uppercase">
                        <tr>
                            <th v-for="c in columns" :key="c" class="px-3 py-2 font-medium whitespace-nowrap">{{ c }}</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-line border-t border-line">
                        <tr v-for="(r, i) in generated.slice(0, 20)" :key="i">
                            <td v-for="c in columns" :key="c" class="max-w-72 truncate px-3 py-1.5 font-mono text-xs whitespace-nowrap" :title="String(r[c])">{{ String(r[c]) }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </Panel>

        <Panel flush>
            <template #title>Export</template>
            <template #actions>
                <Tabs
                    v-model="format"
                    size="sm"
                    :options="[{ value: 'json', label: 'JSON' }, { value: 'csv', label: 'CSV' }, { value: 'sql', label: 'SQL' }, { value: 'ndjson', label: 'NDJSON' }]"
                />
                <input v-if="format === 'sql'" v-model="table" class="input !w-32 !py-0.5 font-mono text-xs" placeholder="table" aria-label="Table name" />
                <CopyButton :text="output" />
                <Btn size="sm" variant="ghost" @click="download"><Download /> Download</Btn>
            </template>
            <div class="max-h-[28rem] overflow-auto">
                <CodeBlock :code="outputPreview" :language="format === 'sql' ? 'sql' : format === 'csv' ? undefined : 'json'" />
            </div>
        </Panel>
    </ToolPage>
</template>
