<script setup lang="ts">
import { computed, ref } from "vue";
import { useStorage } from "@vueuse/core";
import Papa from "papaparse";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
    ArrowDown, ArrowUp, ClipboardPaste, Columns3, Download, Import, Minus, Plus, Rows3, Sparkles, TextAlignCenter,
    TextAlignEnd, TextAlignStart, Trash2, X,
} from "lucide-vue-next";
import { Btn, CodeBlock, CopyButton, Notice, Panel, Tabs, ToolPage } from "@/components/ui";
import { useHandoff } from "@/composables/handoff";
import { downloadBlob, readClipboard } from "@/composables/useClipboard";

type Align = "none" | "left" | "center" | "right";
interface Grid {
    header: string[];
    align: Align[];
    rows: string[][];
}

const sample = (): Grid => ({
    header: ["Tool", "Category", "Price (BDT)", "Status"],
    align: ["left", "center", "right", "none"],
    rows: [
        ["Spring Boot starter", "Backend", "0", "Stable"],
        ["Vue 3 admin template", "Frontend", "4,500", "Beta"],
        ["Elasticsearch | OpenSearch guide", "Search", "1,200", "Draft"],
        ["বাংলা font pack", "Design", "350", "Stable"],
    ],
});

const grid = useStorage<Grid>("devtools:markdown-table-generator:grid", sample());
const pretty = useStorage("devtools:markdown-table-generator:pretty", true);
const escapePipes = useStorage("devtools:markdown-table-generator:escape", true);
const compact = useStorage("devtools:markdown-table-generator:compact", false);
const importText = ref("");
const importHeader = ref(true);
const importMsg = ref<{ type: "success" | "error"; text: string } | null>(null);
const outTab = ref<"markdown" | "html" | "csv">("markdown");

const cols = computed(() => grid.value.header.length);

// ---------------------------------------------------------------- grid edits
function addRow(at = grid.value.rows.length) {
    grid.value.rows.splice(at, 0, Array.from({ length: cols.value }, () => ""));
}
function removeRow(i: number) {
    grid.value.rows.splice(i, 1);
}
function moveRow(i: number, d: number) {
    const j = i + d;
    const r = grid.value.rows;
    if (j < 0 || j >= r.length) return;
    [r[i], r[j]] = [r[j], r[i]];
}
function addCol(at = cols.value) {
    const g = grid.value;
    g.header.splice(at, 0, `Column ${g.header.length + 1}`);
    g.align.splice(at, 0, "none");
    for (const r of g.rows) r.splice(at, 0, "");
}
function removeCol(j: number) {
    const g = grid.value;
    if (g.header.length <= 1) return;
    g.header.splice(j, 1);
    g.align.splice(j, 1);
    for (const r of g.rows) r.splice(j, 1);
}
function moveCol(j: number, d: number) {
    const k = j + d;
    const g = grid.value;
    if (k < 0 || k >= g.header.length) return;
    const sw = <T,>(a: T[]) => ([a[j], a[k]] = [a[k], a[j]]);
    sw(g.header);
    sw(g.align);
    for (const r of g.rows) sw(r);
}
const NEXT_ALIGN: Record<Align, Align> = { none: "left", left: "center", center: "right", right: "none" };
function clearAll() {
    grid.value = { header: ["Column 1", "Column 2", "Column 3"], align: ["none", "none", "none"], rows: [["", "", ""], ["", "", ""]] };
}

// ---------------------------------------------------------------- import
const SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
function splitMdRow(line: string): string[] {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
    const cells: string[] = [];
    let cur = "";
    for (let i = 0; i < s.length; i++) {
        if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
        if (s[i] === "|") { cells.push(cur.trim()); cur = ""; continue; }
        cur += s[i];
    }
    cells.push(cur.trim());
    return cells.map((c) => c.replace(/<br\s*\/?>/gi, "\n"));
}

function loadRows(header: string[], rows: string[][], align?: Align[]) {
    const width = Math.max(header.length, ...rows.map((r) => r.length), 1);
    const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? "");
    grid.value = {
        header: pad(header).map((h, i) => h || (header.length ? "" : `Column ${i + 1}`)),
        align: Array.from({ length: width }, (_, i) => align?.[i] ?? "none"),
        rows: rows.map(pad),
    };
}

function importData(text = importText.value) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) { importMsg.value = { type: "error", text: "Nothing to import." }; return; }
    const sepIdx = lines.findIndex((l) => SEP_RE.test(l) && l.includes("-"));
    if (sepIdx === 1 && lines[0].includes("|")) {
        const align = splitMdRow(lines[1]).map((c): Align => {
            const l = c.startsWith(":"), r = c.endsWith(":");
            return l && r ? "center" : r ? "right" : l ? "left" : "none";
        });
        loadRows(splitMdRow(lines[0]), lines.slice(2).map(splitMdRow), align);
        importMsg.value = { type: "success", text: `Loaded a Markdown table with ${lines.length - 2} rows.` };
        return;
    }
    const res = Papa.parse<string[]>(text.trim(), { skipEmptyLines: "greedy" });
    if (!res.data.length) { importMsg.value = { type: "error", text: "Could not read any rows." }; return; }
    if (importHeader.value) loadRows(res.data[0], res.data.slice(1));
    else loadRows([], res.data);
    const d = res.meta.delimiter === "\t" ? "tab" : `"${res.meta.delimiter}"`;
    importMsg.value = { type: "success", text: `Loaded ${importHeader.value ? res.data.length - 1 : res.data.length} rows (delimiter ${d}).` };
}

// ---------------------------------------------------------------- output
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;
const COMBINING = /[̀-ͯঁ-ঃ়-ৗৢৣ​-‍️]/u;
function displayWidth(s: string): number {
    let w = 0;
    for (const ch of s) w += COMBINING.test(ch) ? 0 : WIDE.test(ch) ? 2 : 1;
    return w;
}

function mdCell(s: string): string {
    let t = s.replace(/\r?\n/g, "<br>");
    if (escapePipes.value) t = t.replace(/(?<!\\)\|/g, "\\|");
    return t;
}

const markdown = computed(() => {
    const g = grid.value;
    const head = g.header.map(mdCell);
    const body = g.rows.map((r) => r.map(mdCell));
    const n = head.length;
    if (!n) return "";
    const sepFor = (a: Align, w: number) => {
        if (a === "center") return ":" + "-".repeat(Math.max(1, w - 2)) + ":";
        if (a === "left") return ":" + "-".repeat(Math.max(2, w - 1));
        if (a === "right") return "-".repeat(Math.max(2, w - 1)) + ":";
        return "-".repeat(Math.max(3, w));
    };
    if (compact.value) {
        const line = (cells: string[]) => "|" + cells.join("|") + "|";
        return [line(head), line(g.align.map((a) => sepFor(a, 3))), ...body.map(line)].join("\n") + "\n";
    }
    if (!pretty.value) {
        const line = (cells: string[]) => "| " + cells.join(" | ") + " |";
        return [line(head), line(g.align.map((a) => sepFor(a, 3))), ...body.map(line)].join("\n") + "\n";
    }
    const widths = Array.from({ length: n }, (_, j) => Math.max(3, displayWidth(head[j]), ...body.map((r) => displayWidth(r[j] ?? ""))));
    const padCell = (s: string, j: number) => {
        const gap = widths[j] - displayWidth(s);
        const a = g.align[j];
        if (a === "right") return " ".repeat(gap) + s;
        if (a === "center") return " ".repeat(Math.floor(gap / 2)) + s + " ".repeat(Math.ceil(gap / 2));
        return s + " ".repeat(gap);
    };
    const line = (cells: string[]) => "| " + cells.map(padCell).join(" | ") + " |";
    return [line(head), "| " + g.align.map((a, j) => sepFor(a, widths[j])).join(" | ") + " |", ...body.map(line)].join("\n") + "\n";
});

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const html = computed(() => {
    const g = grid.value;
    const attr = (j: number) => (g.align[j] && g.align[j] !== "none" ? ` style="text-align: ${g.align[j]}"` : "");
    const cell = (s: string) => esc(s).replace(/\r?\n/g, "<br>");
    const out = ["<table>", "  <thead>", "    <tr>"];
    g.header.forEach((h, j) => out.push(`      <th${attr(j)}>${cell(h)}</th>`));
    out.push("    </tr>", "  </thead>", "  <tbody>");
    for (const r of g.rows) {
        out.push("    <tr>");
        r.forEach((c, j) => out.push(`      <td${attr(j)}>${cell(c)}</td>`));
        out.push("    </tr>");
    }
    out.push("  </tbody>", "</table>");
    return out.join("\n") + "\n";
});
const csv = computed(() => Papa.unparse([grid.value.header, ...grid.value.rows], { newline: "\n" }) + "\n");

const output = computed(() => ({ markdown: markdown.value, html: html.value, csv: csv.value })[outTab.value]);
const outLang = computed(() => ({ markdown: "markdown", html: "xml", csv: undefined })[outTab.value]);

const preview = computed(() => {
    const raw = marked.parse(markdown.value, { gfm: true, async: false }) as string;
    const clean = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
    // The preview styles force left alignment; turn align attributes into inline styles so they win.
    const doc = new DOMParser().parseFromString(clean, "text/html");
    doc.querySelectorAll("[align]").forEach((el) => {
        (el as HTMLElement).style.textAlign = el.getAttribute("align") ?? "";
        el.removeAttribute("align");
    });
    return doc.body.innerHTML;
});

function download() {
    const ext = { markdown: "md", html: "html", csv: "csv" }[outTab.value];
    const mime = { markdown: "text/markdown", html: "text/html", csv: "text/csv" }[outTab.value];
    downloadBlob(output.value, `table.${ext}`, mime);
}

useHandoff<{ input?: string }>("markdown-table-generator", (p) => {
    if (p.input != null) {
        importText.value = p.input;
        importData(p.input);
    }
});
</script>

<template>
    <ToolPage>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <label class="flex items-center gap-2"><input v-model="pretty" type="checkbox" class="checkbox" :disabled="compact" /> Align columns</label>
            <label class="flex items-center gap-2"><input v-model="compact" type="checkbox" class="checkbox" /> Compact</label>
            <label class="flex items-center gap-2"><input v-model="escapePipes" type="checkbox" class="checkbox" /> Escape pipes</label>
            <span class="text-xs text-muted">{{ grid.rows.length }} rows × {{ cols }} columns</span>
            <span class="flex-1" />
            <Btn size="sm" variant="ghost" @click="grid = sample()"><Sparkles /> Sample</Btn>
            <Btn size="sm" variant="ghost" @click="clearAll"><Trash2 /> Clear</Btn>
        </div>

        <Panel title="Table" flush>
            <template #actions>
                <Btn size="sm" variant="ghost" @click="addRow()"><Rows3 /> Add row</Btn>
                <Btn size="sm" variant="ghost" @click="addCol()"><Columns3 /> Add column</Btn>
            </template>
            <div class="overflow-x-auto p-3">
                <table class="text-sm">
                    <thead>
                        <tr>
                            <th v-for="(_, j) in grid.header" :key="'c' + j" class="px-1 pb-1 font-normal">
                                <div class="flex items-center justify-center gap-0.5">
                                    <Btn size="sm" variant="ghost" :title="`Alignment: ${grid.align[j]} (click to change)`" @click="grid.align[j] = NEXT_ALIGN[grid.align[j]]">
                                        <TextAlignStart v-if="grid.align[j] === 'left'" />
                                        <TextAlignCenter v-else-if="grid.align[j] === 'center'" />
                                        <TextAlignEnd v-else-if="grid.align[j] === 'right'" />
                                        <Minus v-else />
                                    </Btn>
                                    <Btn size="sm" variant="ghost" title="Move column left" :disabled="j === 0" @click="moveCol(j, -1)">←</Btn>
                                    <Btn size="sm" variant="ghost" title="Move column right" :disabled="j === cols - 1" @click="moveCol(j, 1)">→</Btn>
                                    <Btn size="sm" variant="ghost" title="Insert column to the right" @click="addCol(j + 1)"><Plus /></Btn>
                                    <Btn size="sm" variant="ghost" title="Delete column" :disabled="cols <= 1" @click="removeCol(j)"><X /></Btn>
                                </div>
                            </th>
                            <th />
                        </tr>
                        <tr>
                            <th v-for="(_, j) in grid.header" :key="'h' + j" class="p-0.5">
                                <input v-model="grid.header[j]" class="input min-w-36 font-semibold" :style="{ textAlign: grid.align[j] === 'none' ? 'left' : grid.align[j] }" :aria-label="`Header ${j + 1}`" />
                            </th>
                            <th class="px-1 text-left text-xs font-normal text-muted">header</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(row, i) in grid.rows" :key="i">
                            <td v-for="(_, j) in row" :key="j" class="p-0.5">
                                <input v-model="row[j]" class="input min-w-36" :style="{ textAlign: grid.align[j] === 'none' ? 'left' : grid.align[j] }" :aria-label="`Row ${i + 1}, column ${j + 1}`" />
                            </td>
                            <td class="px-1 whitespace-nowrap">
                                <Btn size="sm" variant="ghost" title="Move up" :disabled="i === 0" @click="moveRow(i, -1)"><ArrowUp /></Btn>
                                <Btn size="sm" variant="ghost" title="Move down" :disabled="i === grid.rows.length - 1" @click="moveRow(i, 1)"><ArrowDown /></Btn>
                                <Btn size="sm" variant="ghost" title="Insert row below" @click="addRow(i + 1)"><Plus /></Btn>
                                <Btn size="sm" variant="ghost" title="Delete row" @click="removeRow(i)"><X /></Btn>
                            </td>
                        </tr>
                    </tbody>
                </table>
                <p v-if="!grid.rows.length" class="px-1 pt-2 text-sm text-muted">No body rows. Add one above.</p>
            </div>
        </Panel>

        <div class="grid gap-4 lg:grid-cols-2">
            <Panel flush>
                <template #title>Output</template>
                <template #actions>
                    <Tabs v-model="outTab" size="sm" :options="[{ value: 'markdown', label: 'Markdown' }, { value: 'html', label: 'HTML' }, { value: 'csv', label: 'CSV' }]" />
                    <CopyButton :text="output" />
                    <Btn size="sm" variant="ghost" @click="download"><Download /> Download</Btn>
                </template>
                <div class="max-h-[28rem] overflow-auto">
                    <CodeBlock :code="output" :language="outLang" />
                </div>
            </Panel>
            <Panel title="Preview">
                <div class="prose-tool overflow-x-auto" v-html="preview" />
            </Panel>
        </div>

        <Panel title="Import CSV, TSV or a Markdown table" flush>
            <template #actions>
                <label class="flex items-center gap-2 text-xs"><input v-model="importHeader" type="checkbox" class="checkbox" /> First row is the header (CSV)</label>
                <Btn size="sm" variant="ghost" @click="async () => (importText = await readClipboard())"><ClipboardPaste /> Paste</Btn>
                <Btn size="sm" variant="primary" :disabled="!importText.trim()" @click="importData()"><Import /> Load into grid</Btn>
            </template>
            <textarea
                v-model="importText"
                class="min-h-32 w-full resize-y bg-transparent p-4 font-mono text-[13px] text-fg outline-none placeholder:text-fg-subtle"
                spellcheck="false"
                placeholder="name,role&#10;Rahim,Backend&#10;&#10;or | a | b |&#10;|---|---|&#10;| 1 | 2 |"
            />
        </Panel>
        <Notice v-if="importMsg" :type="importMsg.type">{{ importMsg.text }}</Notice>
    </ToolPage>
</template>
