<script setup lang="ts">
import { useHandoff } from "@/composables/handoff";
import { computed, onMounted, ref, shallowRef } from "vue";
import { useStorage } from "@vueuse/core";
import { Check, Copy, LoaderCircle, Search, Sparkles, Trash2, X } from "lucide-vue-next";
import { Btn, Panel, ToolPage } from "@/components/ui";
import { copyText } from "@/composables/useClipboard";
import type { EmojiItem } from "./emojiData";

const items = shallowRef<EmojiItem[]>([]);
const loading = ref(true);
const loadError = ref("");

onMounted(async () => {
    try {
        const mod = await import("./emojiData");
        items.value = mod.loadEmoji();
    } catch {
        loadError.value = "Could not load the emoji list.";
    } finally {
        loading.value = false;
    }
});

const byChar = computed(() => new Map(items.value.map((e) => [e.char, e])));

/* ---------------- Browse ---------------- */

const CATEGORIES = [
    { value: "all", label: "All" },
    { value: "smileys", label: "Smileys" },
    { value: "people", label: "People" },
    { value: "nature", label: "Animals & nature" },
    { value: "food", label: "Food" },
    { value: "travel", label: "Travel" },
    { value: "activities", label: "Activities" },
    { value: "objects", label: "Objects" },
    { value: "symbols", label: "Symbols" },
    { value: "flags", label: "Flags" },
    { value: "unicode", label: "Unicode symbols" },
];
const GROUPS = [
    { value: "", label: "All" },
    { value: "arrows", label: "Arrows & keys" },
    { value: "math", label: "Math" },
    { value: "currency", label: "Currency" },
    { value: "box", label: "Box drawing" },
    { value: "greek", label: "Greek" },
    { value: "punctuation", label: "Punctuation & spaces" },
];

const category = useStorage("devtools:emoji-picker:category", "all");
const group = ref("");
const query = ref("");

function matches(e: EmojiItem, terms: string[], q: string): boolean {
    if (!terms.length) return true;
    if (e.char === q) return true;
    const cp = /^(?:u\+|0x|\\u\{?)?([0-9a-f]{2,6})\}?$/i.exec(q);
    if (cp && [...e.char].some((c) => c.codePointAt(0)!.toString(16) === cp[1].toLowerCase().replace(/^0+/, ""))) return true;
    const hay = `${e.name} ${e.keywords}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
}

const filtered = computed(() => {
    const q = query.value.trim();
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return items.value.filter(
        (e) =>
            (q || category.value === "all" || e.category === category.value) &&
            (category.value !== "unicode" || !group.value || e.group === group.value || q !== "") &&
            matches(e, terms, q),
    );
});

const counts = computed(() => {
    const c: Record<string, number> = { all: items.value.length };
    for (const e of items.value) c[e.category] = (c[e.category] ?? 0) + 1;
    return c;
});

/* ---------------- Skin tones ---------------- */

const TONES = [
    { mod: "", label: "Default", swatch: "✋" },
    { mod: "\u{1F3FB}", label: "Light", swatch: "✋🏻" },
    { mod: "\u{1F3FC}", label: "Medium-light", swatch: "✋🏼" },
    { mod: "\u{1F3FD}", label: "Medium", swatch: "✋🏽" },
    { mod: "\u{1F3FE}", label: "Medium-dark", swatch: "✋🏾" },
    { mod: "\u{1F3FF}", label: "Dark", swatch: "✋🏿" },
];
const tone = useStorage("devtools:emoji-picker:tone", "");

function withTone(e: EmojiItem): string {
    if (!e.tone || !tone.value) return e.char;
    const cps = [...e.char];
    // Modifier goes right after the base; it replaces an emoji-presentation selector (FE0F) there.
    const rest = cps.slice(1);
    if (rest[0] === "️") rest.shift();
    return cps[0] + tone.value + rest.join("");
}

/* ---------------- Selection & formats ---------------- */

interface Selected { char: string; name: string }
const selected = ref<Selected | null>(null);

function select(e: EmojiItem) {
    selected.value = { char: withTone(e), name: e.name };
}

const hex = (n: number, w = 4) => n.toString(16).toUpperCase().padStart(w, "0");

function describe(char: string) {
    const cps = [...char].map((c) => c.codePointAt(0)!);
    const units: number[] = [];
    for (let i = 0; i < char.length; i++) units.push(char.charCodeAt(i));
    const bytes = [...new TextEncoder().encode(char)];
    const u16 = units.map((u) => `\\u${hex(u)}`).join("");
    return {
        cps,
        formats: [
            { label: "Character", value: char },
            { label: "Code points", value: cps.map((c) => `U+${hex(c)}`).join(" ") },
            { label: "HTML entity (decimal)", value: cps.map((c) => `&#${c};`).join("") },
            { label: "HTML entity (hex)", value: cps.map((c) => `&#x${hex(c, 1)};`).join("") },
            { label: "CSS escape", value: cps.map((c) => `\\${hex(c, 1)}`).join("") },
            { label: "JavaScript (code point)", value: cps.map((c) => (c > 0xffff ? `\\u{${hex(c, 1)}}` : `\\u${hex(c)}`)).join("") },
            { label: "JavaScript (UTF-16)", value: u16 },
            { label: "Java string literal", value: `"${u16}"` },
            { label: "Python", value: cps.map((c) => (c > 0xffff ? `\\U${hex(c, 8)}` : `\\u${hex(c)}`)).join("") },
            { label: "URL-encoded (UTF-8)", value: encodeURIComponent(char) },
            { label: "UTF-8 bytes (hex)", value: bytes.map((b) => hex(b, 2)).join(" ") },
        ],
        utf16: units.length,
        utf8: bytes.length,
    };
}

const details = computed(() => (selected.value ? describe(selected.value.char) : null));

/* ---------------- Copy + recents ---------------- */

const recent = useStorage<string[]>("devtools:emoji-picker:recent", []);
const justCopied = ref("");

async function copy(value: string, char: string, label = "Copied") {
    if (!(await copyText(value, label))) return;
    recent.value = [char, ...recent.value.filter((c) => c !== char)].slice(0, 24);
    justCopied.value = value;
    setTimeout(() => {
        if (justCopied.value === value) justCopied.value = "";
    }, 1200);
}

function quickCopy(e: EmojiItem) {
    const c = withTone(e);
    select(e);
    copy(c, c, `Copied ${c}`);
}

function selectChar(char: string) {
    const known = byChar.value.get(char);
    selected.value = { char, name: known?.name ?? nameFor(char) };
}

/* ---------------- Inspect text ---------------- */

const inspectInput = useStorage("devtools:emoji-picker:inspect", "Hi 👋🏽 — ৳500 café 🇧🇩 👨‍👩‍👧");

const INVISIBLE: Record<number, string> = {
    0x20: "SPACE", 0x09: "TAB", 0x0a: "LF", 0x0d: "CR", 0xa0: "NBSP", 0x200b: "ZWSP", 0x200c: "ZWNJ", 0x200d: "ZWJ",
    0x2060: "WJ", 0xfeff: "BOM", 0xad: "SHY", 0x200e: "LRM", 0x200f: "RLM", 0x202f: "NNBSP", 0xfe0f: "VS16", 0xfe0e: "VS15",
};

function nameFor(g: string): string {
    const known = byChar.value.get(g) ?? byChar.value.get(g.replace(/️/g, "")) ?? byChar.value.get(g + "️");
    if (known) return known.name;
    const cp = g.codePointAt(0)!;
    if (cp >= 0x1f3fb && cp <= 0x1f3ff) return "skin tone modifier";
    if (/^\p{Lu}$/u.test(g)) return "uppercase letter";
    if (/^\p{Ll}$/u.test(g)) return "lowercase letter";
    if (/^\p{N}$/u.test(g)) return "digit";
    if (/^[ঀ-৿]+$/.test(g)) return "Bengali";
    if (/\p{Extended_Pictographic}/u.test(g)) return [...g].length > 1 ? "emoji sequence" : "emoji";
    if (/^\p{M}$/u.test(g)) return "combining mark";
    if (/^\p{P}$/u.test(g)) return "punctuation";
    if (/^\p{S}$/u.test(g)) return "symbol";
    if (/^\p{Z}$/u.test(g)) return "space";
    if (/^\p{C}$/u.test(g)) return "control / format";
    return "";
}

const graphemes = computed(() => {
    const text = inspectInput.value;
    if (!text) return [];
    type Seg = { segment: string };
    const segs: string[] =
        typeof Intl !== "undefined" && "Segmenter" in Intl
            ? [...(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text) as Iterable<Seg>)].map((s) => s.segment)
            : [...text];
    return segs.slice(0, 500).map((g) => {
        const cps = [...g].map((c) => c.codePointAt(0)!);
        const label = cps.length === 1 && INVISIBLE[cps[0]] ? INVISIBLE[cps[0]] : "";
        return { g, cps, label, name: nameFor(g) };
    });
});
const inspectStats = computed(() => {
    const t = inspectInput.value;
    return { graphemes: graphemes.value.length, cps: [...t].length, units: t.length, bytes: new TextEncoder().encode(t).length };
});

useHandoff<{ input?: string; query?: string }>("emoji-picker", (p) => {
    if (p.input != null) inspectInput.value = p.input;
    if (p.query != null) query.value = p.query;
});
</script>

<template>
    <ToolPage>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label class="relative min-w-[14rem] flex-1">
                <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
                <input v-model="query" class="input !pl-9" type="search" placeholder="Search by name, keyword, character or code point (U+1F600)…" aria-label="Search emoji and symbols" />
            </label>
            <div class="flex items-center gap-1" role="radiogroup" aria-label="Skin tone">
                <button
                    v-for="t in TONES"
                    :key="t.label"
                    type="button"
                    class="grid size-8 cursor-pointer place-items-center rounded-lg text-lg transition-colors"
                    :class="tone === t.mod ? 'bg-accent-soft ring-1 ring-accent' : 'hover:bg-subtle'"
                    :title="`Skin tone: ${t.label}`"
                    :aria-checked="tone === t.mod"
                    role="radio"
                    @click="tone = t.mod"
                >{{ t.swatch }}</button>
            </div>
        </div>

        <div class="flex flex-wrap gap-1.5" role="tablist">
            <button
                v-for="c in CATEGORIES"
                :key="c.value"
                type="button"
                role="tab"
                :aria-selected="category === c.value"
                class="cursor-pointer rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors ring-inset"
                :class="category === c.value ? 'bg-accent-soft text-accent-strong ring-accent dark:text-accent' : 'bg-surface text-fg-subtle ring-line hover:text-fg'"
                @click="category = c.value; group = ''"
            >
                {{ c.label }} <span class="text-muted tabular-nums">{{ counts[c.value] ?? 0 }}</span>
            </button>
        </div>

        <div class="grid gap-4 lg:grid-cols-[1fr_22rem]">
            <Panel flush>
                <template #title>
                    <span>{{ query.trim() ? "Search results" : CATEGORIES.find((c) => c.value === category)?.label }}</span>
                    <span class="ml-1 text-xs font-normal text-muted">{{ filtered.length }}</span>
                </template>
                <template #actions>
                    <span class="hidden text-xs text-muted sm:inline">Click to inspect · double-click to copy</span>
                </template>
                <div v-if="category === 'unicode' && !query.trim()" class="flex flex-wrap gap-1 border-b border-line px-4 py-2">
                    <button
                        v-for="g in GROUPS"
                        :key="g.value"
                        type="button"
                        class="chip cursor-pointer"
                        :class="group === g.value ? '!bg-accent-soft !text-accent-strong dark:!text-accent' : ''"
                        @click="group = g.value"
                    >{{ g.label }}</button>
                </div>
                <div v-if="loading" class="flex items-center justify-center gap-2 p-10 text-sm text-muted">
                    <LoaderCircle class="size-4 animate-spin" /> Loading emoji…
                </div>
                <div v-else-if="loadError" class="p-6 text-center text-sm text-danger">{{ loadError }}</div>
                <div v-else-if="!filtered.length" class="p-10 text-center text-sm text-muted">Nothing matches “{{ query }}”.</div>
                <div v-else class="grid max-h-[28rem] grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1 overflow-y-auto p-3">
                    <button
                        v-for="e in filtered"
                        :key="e.char"
                        type="button"
                        class="grid aspect-square cursor-pointer place-items-center rounded-lg text-2xl leading-none transition-colors hover:bg-subtle"
                        :class="[
                            selected?.name === e.name ? 'bg-accent-soft ring-1 ring-accent' : '',
                            e.category === 'unicode' ? 'font-mono !text-xl text-fg' : '',
                        ]"
                        :title="e.name"
                        :aria-label="e.name"
                        @click="select(e)"
                        @dblclick="quickCopy(e)"
                    >
                        <span v-if="e.group === 'punctuation' && /^[\s​-‏⁠﻿­️]$/.test(e.char)" class="rounded border border-dashed border-line px-0.5 font-sans text-[9px] leading-tight text-muted uppercase">{{ e.keywords.split(" ")[0] }}</span>
                        <template v-else>{{ withTone(e) }}</template>
                    </button>
                </div>
                <div v-if="recent.length" class="flex flex-wrap items-center gap-1 border-t border-line px-4 py-2">
                    <span class="mr-1 text-xs text-muted">Recently copied</span>
                    <button
                        v-for="c in recent"
                        :key="c"
                        type="button"
                        class="grid size-8 cursor-pointer place-items-center rounded-md text-lg hover:bg-subtle"
                        :title="`Copy ${byChar.get(c)?.name ?? c}`"
                        @click="selectChar(c); copy(c, c, `Copied ${c}`)"
                    >{{ c }}</button>
                    <Btn size="sm" variant="ghost" class="ml-auto" title="Clear recent" @click="recent = []"><X /></Btn>
                </div>
            </Panel>

            <Panel title="Details">
                <div v-if="!selected || !details" class="py-8 text-center text-sm text-muted">Pick an emoji or symbol to see its code points and escapes.</div>
                <div v-else class="space-y-3">
                    <div class="flex items-center gap-4">
                        <div class="grid size-20 shrink-0 place-items-center rounded-2xl bg-subtle text-5xl leading-none">{{ selected.char }}</div>
                        <div class="min-w-0">
                            <p class="font-medium text-fg first-letter:uppercase">{{ selected.name || "Unknown" }}</p>
                            <p class="mt-1 font-mono text-xs text-fg-muted">{{ details.formats[1].value }}</p>
                            <p class="mt-1 text-xs text-muted">{{ details.cps.length }} code point{{ details.cps.length === 1 ? "" : "s" }} · {{ details.utf16 }} UTF-16 units · {{ details.utf8 }} bytes</p>
                        </div>
                    </div>
                    <Btn variant="primary" class="w-full" @click="copy(selected.char, selected.char, `Copied ${selected.char}`)"><Copy /> Copy character</Btn>
                    <ul class="divide-y divide-line rounded-xl border border-line">
                        <li v-for="f in details.formats.slice(1)" :key="f.label" class="flex items-center gap-2 px-3 py-1.5">
                            <div class="min-w-0 flex-1">
                                <p class="text-[11px] text-muted">{{ f.label }}</p>
                                <p class="font-mono text-xs break-all text-fg">{{ f.value }}</p>
                            </div>
                            <Btn size="sm" variant="ghost" :title="`Copy ${f.label}`" @click="copy(f.value, selected.char, `Copied ${f.label}`)">
                                <Check v-if="justCopied === f.value" class="text-success" /><Copy v-else />
                            </Btn>
                        </li>
                    </ul>
                </div>
            </Panel>
        </div>

        <Panel flush>
            <template #title>
                Inspect text
                <span class="ml-1 text-xs font-normal text-muted">
                    {{ inspectStats.graphemes }} graphemes · {{ inspectStats.cps }} code points · {{ inspectStats.units }} UTF-16 units · {{ inspectStats.bytes }} UTF-8 bytes
                </span>
            </template>
            <template #actions>
                <Btn size="sm" variant="ghost" @click="inspectInput = 'Hi 👋🏽 — ৳500 café 🇧🇩 👨‍👩‍👧'"><Sparkles /> Sample</Btn>
                <Btn size="sm" variant="ghost" :disabled="!inspectInput" @click="inspectInput = ''"><Trash2 /> Clear</Btn>
            </template>
            <textarea
                v-model="inspectInput"
                aria-label="Text to inspect"
                placeholder="Paste any text to see each character and its code points…"
                class="h-20 w-full resize-y border-b border-line bg-transparent px-4 py-3 text-[15px] text-fg outline-none placeholder:text-fg-subtle"
            />
            <div v-if="graphemes.length" class="max-h-[22rem] overflow-auto">
                <table class="w-full text-sm">
                    <thead class="sticky top-0 bg-surface text-left text-xs text-muted uppercase">
                        <tr>
                            <th class="px-4 py-2 font-medium">#</th>
                            <th class="px-4 py-2 font-medium">Char</th>
                            <th class="px-4 py-2 font-medium">Code points</th>
                            <th class="px-4 py-2 font-medium">Name</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-line border-t border-line">
                        <tr v-for="(r, i) in graphemes" :key="i" class="cursor-pointer hover:bg-subtle" @click="selectChar(r.g)">
                            <td class="px-4 py-1.5 font-mono text-xs text-muted tabular-nums">{{ i + 1 }}</td>
                            <td class="px-4 py-1.5 text-lg">
                                <span v-if="r.label" class="chip !text-warn">{{ r.label }}</span>
                                <template v-else>{{ r.g }}</template>
                            </td>
                            <td class="px-4 py-1.5 font-mono text-xs whitespace-nowrap text-fg-muted">{{ r.cps.map((c) => "U+" + c.toString(16).toUpperCase().padStart(4, "0")).join(" ") }}</td>
                            <td class="px-4 py-1.5 text-fg-muted">{{ r.name }}</td>
                        </tr>
                    </tbody>
                </table>
                <p v-if="inspectStats.graphemes > 500" class="px-4 py-2 text-xs text-muted">Showing the first 500 characters.</p>
            </div>
        </Panel>
    </ToolPage>
</template>
