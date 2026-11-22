<script setup lang="ts">
import { useHandoff } from "@/composables/handoff";
import { computed, ref } from "vue";
import { useStorage } from "@vueuse/core";
import { ArrowLeftRight, Sparkles, Trash2 } from "lucide-vue-next";
import { diffArrays } from "diff";
import { Btn, CopyButton, Notice, Panel, Tabs, ToolPage } from "@/components/ui";

const SAMPLE_A = `It has been decided by the management team that the new onboarding process will be implemented at the beginning of next quarter, and it is expected that all of the team leads will be required to make sure that their new hires are walked through each of the steps in the checklist that was prepared by the HR department. In order to facilitate a smooth transition, a series of training sessions will be held. Feedback should be submitted by employees no later than the end of the month.

Due to the fact that the previous process was considered to be confusing by a large number of people, the decision was made to simplify it.`;

const SAMPLE_B = `The management team will roll out the new onboarding process at the start of next quarter. Team leads must walk every new hire through the HR checklist. To make the switch smooth, we will run a few short training sessions. Please send us your feedback by the end of the month.

Many people found the old process confusing, so we simplified it.`;

const original = useStorage("devtools:prose-diff:original", SAMPLE_A);
const edited = useStorage("devtools:prose-diff:edited", SAMPLE_B);
const opts = useStorage(
    "devtools:prose-diff:options",
    { ignoreCase: false, ignorePunct: false, view: "inline" as "inline" | "split" },
    undefined,
    { mergeDefaults: true },
);

/* ---------------- Diff ---------------- */

type Kind = "eq" | "add" | "del";
interface Seg { kind: Kind; text: string }

// Words (letters/digits with inner apostrophes and hyphens), whitespace runs, or single punctuation marks.
const TOKEN_RE = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*|\s+|[^\s\p{L}\p{N}]/gu;
const isWord = (t: string) => /[\p{L}\p{N}]/u.test(t);
const isSpace = (t: string) => /^\s+$/.test(t);

function tokenize(text: string, attachPunct: boolean): string[] {
    const raw = text.match(TOKEN_RE) ?? [];
    if (!attachPunct) return raw;
    // Glue punctuation onto the neighbouring word so punctuation-only edits compare equal.
    const out: string[] = [];
    for (const t of raw) {
        const last = out.length ? out[out.length - 1] : undefined;
        if (!isWord(t) && !isSpace(t) && last !== undefined && !isSpace(last)) out[out.length - 1] = last + t;
        else out.push(t);
    }
    return out;
}

function norm(t: string): string {
    if (isSpace(t)) return t.includes("\n\n") ? "\n\n" : " ";
    let s = t;
    if (opts.value.ignorePunct) s = s.replace(/[^\p{L}\p{N}\s]/gu, "");
    if (opts.value.ignoreCase) s = s.toLowerCase();
    return s;
}

interface DiffResult { inline: Seg[]; left: Seg[]; right: Seg[]; added: number; removed: number; kept: number }

const diff = computed<DiffResult>(() => {
    const a = tokenize(original.value, opts.value.ignorePunct);
    const b = tokenize(edited.value, opts.value.ignorePunct);
    const parts = diffArrays(a, b, { comparator: (x, y) => norm(x) === norm(y) });
    const inline: Seg[] = [], left: Seg[] = [], right: Seg[] = [];
    let i = 0, j = 0, added = 0, removed = 0, kept = 0;
    const push = (arr: Seg[], kind: Kind, text: string) => {
        const last = arr[arr.length - 1];
        if (last && last.kind === kind) last.text += text;
        else arr.push({ kind, text });
    };
    for (const p of parts) {
        const n = p.value.length;
        if (p.added) {
            const t = b.slice(j, j + n);
            j += n;
            added += t.filter(isWord).length;
            push(inline, "add", t.join(""));
            push(right, "add", t.join(""));
        } else if (p.removed) {
            const t = a.slice(i, i + n);
            i += n;
            removed += t.filter(isWord).length;
            push(inline, "del", t.join(""));
            push(left, "del", t.join(""));
        } else {
            const ta = a.slice(i, i + n), tb = b.slice(j, j + n);
            i += n;
            j += n;
            kept += tb.filter(isWord).length;
            push(inline, "eq", tb.join(""));
            push(left, "eq", ta.join(""));
            push(right, "eq", tb.join(""));
        }
    }
    return { inline, left, right, added, removed, kept };
});

/* ---------------- Readability ---------------- */

const PARTICIPLES = new Set(
    "written done made given taken seen known shown built sent held found told kept paid left brought bought thought put set chosen driven broken spoken eaten forgotten hidden begun drawn grown thrown worn torn understood sold caught taught run won lost met heard felt meant led read said spent struck sung swept fed hung laid shut split spread stolen sworn woken ridden risen beaten bitten blown flown frozen shaken withdrawn overseen undertaken".split(" "),
);
const BE = "am|is|are|was|were|be|been|being|get|gets|got|gotten|getting";
const PASSIVE_RE = new RegExp(`\\b(?:${BE})\\s+(?:(?:not|never|also|then|now|being|been|already|still|often|always|usually|fully|quickly|widely|generally)\\s+){0,2}([a-z]+)\\b`, "gi");

function syllables(word: string): number {
    let w = word.toLowerCase().replace(/[^a-z]/g, "");
    if (!w) return 0;
    if (w.length <= 3) return 1;
    w = w.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, "").replace(/^y/, "");
    const m = w.match(/[aeiouy]{1,2}/g);
    return Math.max(1, m ? m.length : 1);
}

function splitSentences(text: string): string[] {
    const flat = text.replace(/\s+/g, " ").trim();
    if (!flat) return [];
    const parts = flat.match(/[^.!?]+(?:[.!?]+["'”’)\]]*|$)/g) ?? [];
    // Paragraph breaks without a full stop (headings, list items) also end a sentence.
    return parts
        .flatMap((s) => s.split(/\n{2,}/))
        .map((s) => s.trim())
        .filter((s) => /[\p{L}\p{N}]/u.test(s));
}

interface Stats {
    words: number; sentences: number; chars: number; charsNoSpace: number; syllables: number;
    wps: number; spw: number; flesch: number; grade: number; readSec: number;
    long: { text: string; words: number }[]; passive: string[];
}

function analyse(text: string): Stats {
    const words = text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? [];
    const sents = splitSentences(text);
    const syl = words.reduce((n, w) => n + syllables(w), 0);
    const wc = words.length, sc = Math.max(sents.length, wc ? 1 : 0);
    const wps = sc ? wc / sc : 0, spw = wc ? syl / wc : 0;
    const passive: string[] = [];
    for (const m of text.matchAll(PASSIVE_RE)) {
        const p = m[1].toLowerCase();
        if ((/ed$/.test(p) && p.length > 3) || PARTICIPLES.has(p)) passive.push(m[0]);
    }
    return {
        words: wc,
        sentences: sents.length,
        chars: [...text].length,
        charsNoSpace: [...text.replace(/\s/g, "")].length,
        syllables: syl,
        wps,
        spw,
        flesch: wc ? 206.835 - 1.015 * wps - 84.6 * spw : 0,
        grade: wc ? 0.39 * wps + 11.8 * spw - 15.59 : 0,
        readSec: (wc / 238) * 60,
        long: sents.map((s) => ({ text: s, words: (s.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? []).length })).filter((s) => s.words > 25),
        passive,
    };
}

function fleschLabel(score: number): string {
    if (score >= 90) return "Very easy";
    if (score >= 80) return "Easy";
    if (score >= 70) return "Fairly easy";
    if (score >= 60) return "Plain English";
    if (score >= 50) return "Fairly difficult";
    if (score >= 30) return "Difficult";
    return "Very difficult";
}

const sa = computed(() => analyse(original.value));
const sb = computed(() => analyse(edited.value));

function fmtTime(sec: number): string {
    if (sec < 1) return "0 s";
    if (sec < 60) return `${Math.round(sec)} s`;
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return s ? `${m} min ${s} s` : `${m} min`;
}

type Better = "up" | "down" | null;
interface Metric { label: string; a: number; b: number; fmt: (n: number) => string; better: Better; hint?: string }

const int = (n: number) => Math.round(n).toLocaleString();
const dec1 = (n: number) => n.toFixed(1);
const dec2 = (n: number) => n.toFixed(2);

const metrics = computed<Metric[]>(() => {
    const a = sa.value, b = sb.value;
    return [
        { label: "Words", a: a.words, b: b.words, fmt: int, better: null },
        { label: "Sentences", a: a.sentences, b: b.sentences, fmt: int, better: null },
        { label: "Characters", a: a.chars, b: b.chars, fmt: int, better: null, hint: "Including spaces" },
        { label: "Syllables", a: a.syllables, b: b.syllables, fmt: int, better: null, hint: "Heuristic English count" },
        { label: "Avg words / sentence", a: a.wps, b: b.wps, fmt: dec1, better: "down", hint: "15 to 20 reads comfortably" },
        { label: "Avg syllables / word", a: a.spw, b: b.spw, fmt: dec2, better: "down" },
        { label: "Flesch–Kincaid grade", a: a.grade, b: b.grade, fmt: dec1, better: "down", hint: "US school grade needed" },
        { label: "Long sentences (>25 words)", a: a.long.length, b: b.long.length, fmt: int, better: "down" },
        { label: "Passive voice hints", a: a.passive.length, b: b.passive.length, fmt: int, better: "down", hint: "Form of be/get + past participle" },
    ];
});

function delta(m: Metric): { text: string; cls: string } {
    const d = m.b - m.a;
    const shown = m.fmt(Math.abs(d));
    if (Number(shown.replace(/,/g, "")) === 0) return { text: "±0", cls: "text-muted" };
    const text = (d > 0 ? "+" : "−") + shown;
    if (!m.better) return { text, cls: "text-fg-muted" };
    const good = (m.better === "up") === d > 0;
    return { text, cls: good ? "text-success" : "text-danger" };
}

const changeSummary = computed(() => {
    const { added, removed, kept } = diff.value;
    const base = kept + removed;
    const pctChanged = base ? Math.round(((added + removed) / (base + kept + added)) * 100) : added ? 100 : 0;
    const pctKept = base ? Math.round((kept / base) * 100) : 0;
    return { added, removed, kept, pctChanged, pctKept };
});

const fleschDelta = computed(() => delta({ label: "", a: sa.value.flesch, b: sb.value.flesch, fmt: dec1, better: "up" }));
const hasInput = computed(() => !!(original.value.trim() || edited.value.trim()));
const identical = computed(() => hasInput.value && diff.value.inline.every((s) => s.kind === "eq"));

const cleanCopy = computed(() => edited.value);

function swap() {
    [original.value, edited.value] = [edited.value, original.value];
}
function loadSample() {
    original.value = SAMPLE_A;
    edited.value = SAMPLE_B;
}
function clearAll() {
    original.value = "";
    edited.value = "";
}

const segCls = (k: Kind) =>
    k === "add"
        ? "rounded-sm bg-accent-soft px-0.5 text-accent-strong dark:text-accent"
        : k === "del"
          ? "rounded-sm bg-danger-soft px-0.5 text-danger line-through decoration-1"
          : "";

// Input sent from the chat assistant.
useHandoff<{ left?: string; right?: string; input?: string }>("prose-diff", (p) => {
    if (p.left != null) original.value = p.left;
    if (p.right != null) edited.value = p.right;
    else if (p.input != null) edited.value = p.input;
});

const view = computed({ get: () => opts.value.view, set: (v) => (opts.value.view = v) });
const longTab = ref<"b" | "a">("b");
</script>

<template>
    <ToolPage>
        <div class="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <label class="flex items-center gap-2"><input v-model="opts.ignoreCase" type="checkbox" class="checkbox" /> Ignore case</label>
            <label class="flex items-center gap-2"><input v-model="opts.ignorePunct" type="checkbox" class="checkbox" /> Ignore punctuation</label>
            <div class="ml-auto flex flex-wrap items-center gap-1">
                <Btn size="sm" variant="ghost" @click="loadSample"><Sparkles /> Sample</Btn>
                <Btn size="sm" variant="ghost" @click="swap"><ArrowLeftRight /> Swap</Btn>
                <Btn size="sm" variant="ghost" :disabled="!hasInput" @click="clearAll"><Trash2 /> Clear</Btn>
            </div>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
            <Panel title="Original" flush>
                <template #actions><span class="text-xs text-muted">{{ sa.words }} words</span></template>
                <textarea
                    v-model="original"
                    spellcheck="true"
                    aria-label="Original text"
                    placeholder="Paste the original draft…"
                    class="h-56 w-full resize-y bg-transparent px-4 py-3 text-[15px] leading-7 text-fg outline-none placeholder:text-fg-subtle"
                />
            </Panel>
            <Panel title="Edited" flush>
                <template #actions><span class="text-xs text-muted">{{ sb.words }} words</span></template>
                <textarea
                    v-model="edited"
                    spellcheck="true"
                    aria-label="Edited text"
                    placeholder="Paste the edited draft…"
                    class="h-56 w-full resize-y bg-transparent px-4 py-3 text-[15px] leading-7 text-fg outline-none placeholder:text-fg-subtle"
                />
            </Panel>
        </div>

        <Panel flush>
            <template #title>
                <span class="flex flex-wrap items-center gap-2">
                    Tracked changes
                    <span class="chip !text-accent">+{{ changeSummary.added }} words</span>
                    <span class="chip !text-danger">−{{ changeSummary.removed }} words</span>
                    <span class="chip">{{ changeSummary.pctChanged }}% changed</span>
                    <span class="chip">{{ changeSummary.pctKept }}% of original kept</span>
                </span>
            </template>
            <template #actions>
                <CopyButton :text="cleanCopy" label="Copy edited" />
                <Tabs v-model="view" size="sm" :options="[{ value: 'inline', label: 'Inline' }, { value: 'split', label: 'Side by side' }]" />
            </template>

            <div v-if="!hasInput" class="p-6 text-center text-sm text-muted">Paste an original and an edited draft to see tracked changes.</div>
            <div v-else-if="identical" class="p-4"><Notice type="success">No wording changes{{ opts.ignoreCase || opts.ignorePunct ? " with the selected options" : "" }}.</Notice></div>
            <div v-else class="max-h-[32rem] overflow-auto">
                <article v-if="view === 'inline'" class="mx-auto max-w-3xl px-5 py-5 text-[15px] leading-8 break-words whitespace-pre-wrap text-fg">
                    <template v-for="(s, i) in diff.inline" :key="i"><span :class="segCls(s.kind)">{{ s.text }}</span></template>
                </article>
                <div v-else class="grid divide-line md:grid-cols-2 md:divide-x">
                    <article class="px-5 py-5 text-[15px] leading-8 break-words whitespace-pre-wrap text-fg">
                        <p class="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Original</p>
                        <template v-for="(s, i) in diff.left" :key="i"><span :class="segCls(s.kind)">{{ s.text }}</span></template>
                    </article>
                    <article class="border-t border-line px-5 py-5 text-[15px] leading-8 break-words whitespace-pre-wrap text-fg md:border-t-0">
                        <p class="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Edited</p>
                        <template v-for="(s, i) in diff.right" :key="i"><span :class="segCls(s.kind)">{{ s.text }}</span></template>
                    </article>
                </div>
            </div>
        </Panel>

        <div class="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
            <Panel title="Reading ease">
                <div class="grid grid-cols-2 gap-3">
                    <div v-for="(s, k) in { Original: sa, Edited: sb }" :key="k" class="rounded-xl bg-subtle p-3">
                        <p class="text-xs text-muted">{{ k }}</p>
                        <p class="mt-1 font-display text-3xl font-semibold text-fg tabular-nums">{{ s.words ? s.flesch.toFixed(0) : "–" }}</p>
                        <p class="text-sm text-fg-muted">{{ s.words ? fleschLabel(s.flesch) : "No text" }}</p>
                        <p class="mt-2 text-xs text-muted">Reading time {{ fmtTime(s.readSec) }}</p>
                    </div>
                </div>
                <p class="mt-3 text-sm text-fg-muted">
                    Flesch Reading Ease
                    <span class="font-mono font-medium" :class="fleschDelta.cls">{{ fleschDelta.text }}</span>
                    <span class="text-muted"> · higher is easier; 60 to 70 is plain English. Reading time at 238 words per minute.</span>
                </p>
            </Panel>

            <Panel title="Readability" flush>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead class="text-left text-xs text-muted uppercase">
                            <tr>
                                <th class="px-4 py-2 font-medium">Metric</th>
                                <th class="px-4 py-2 text-right font-medium">Original</th>
                                <th class="px-4 py-2 text-right font-medium">Edited</th>
                                <th class="px-4 py-2 text-right font-medium">Change</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-line border-t border-line">
                            <tr v-for="m in metrics" :key="m.label">
                                <td class="px-4 py-1.5">
                                    <span class="text-fg">{{ m.label }}</span>
                                    <span v-if="m.hint" class="block text-xs text-muted">{{ m.hint }}</span>
                                </td>
                                <td class="px-4 py-1.5 text-right font-mono tabular-nums">{{ m.fmt(m.a) }}</td>
                                <td class="px-4 py-1.5 text-right font-mono tabular-nums">{{ m.fmt(m.b) }}</td>
                                <td class="px-4 py-1.5 text-right font-mono tabular-nums" :class="delta(m).cls">{{ delta(m).text }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </Panel>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
            <Panel title="Long sentences">
                <template #actions>
                    <Tabs v-model="longTab" size="sm" :options="[{ value: 'b', label: `Edited (${sb.long.length})` }, { value: 'a', label: `Original (${sa.long.length})` }]" />
                </template>
                <p v-if="!(longTab === 'a' ? sa : sb).long.length" class="text-sm text-muted">No sentences over 25 words.</p>
                <ol v-else class="space-y-2">
                    <li v-for="(s, i) in (longTab === 'a' ? sa : sb).long" :key="i" class="rounded-lg bg-warn-soft px-3 py-2 text-sm leading-6 text-fg">
                        <span class="chip mr-1 !text-warn">{{ s.words }} words</span> {{ s.text }}
                    </li>
                </ol>
            </Panel>
            <Panel title="Passive voice hints">
                <p class="mb-2 text-xs text-muted">A simple pattern match (be/get + past participle). Review each one; some are fine.</p>
                <div class="grid gap-3 sm:grid-cols-2">
                    <div v-for="(s, k) in { Original: sa, Edited: sb }" :key="k">
                        <p class="mb-1 text-xs font-medium text-fg-muted">{{ k }} ({{ s.passive.length }})</p>
                        <p v-if="!s.passive.length" class="text-sm text-muted">None found.</p>
                        <div v-else class="flex flex-wrap gap-1">
                            <span v-for="(p, i) in s.passive" :key="i" class="chip">{{ p }}</span>
                        </div>
                    </div>
                </div>
            </Panel>
        </div>
    </ToolPage>
</template>
