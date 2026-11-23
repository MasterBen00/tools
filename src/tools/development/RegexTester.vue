<script setup lang="ts">
import { useHandoff } from "@/composables/handoff";
import { computed, onBeforeUnmount, ref } from "vue";
import { watchDebounced } from "@vueuse/core";
import type { RegexMatch, RegexRequest, RegexResponse } from "./regex.worker";
import { Eraser, FlaskConical } from "lucide-vue-next";
import { Btn, CodeArea, CopyButton, Notice, Panel, Tabs, ToolPage } from "@/components/ui";

const pattern = ref("(?<user>[\\w.+-]+)@(?<domain>[\\w-]+\\.[\\w.]+)");
const flags = ref<string[]>(["g", "i"]);
const text = ref("Contact: ada@example.com, grace.hopper@navy.mil\nNot an email: foo@bar");
const replacement = ref("$<user> at $<domain>");
const tab = ref<"matches" | "replace">("matches");

const flagInfo = [
    { f: "g", t: "global" },
    { f: "i", t: "ignore case" },
    { f: "m", t: "multiline" },
    { f: "s", t: "dotAll" },
    { f: "u", t: "unicode" },
    { f: "y", t: "sticky" },
];

function toggle(f: string) {
    flags.value = flags.value.includes(f) ? flags.value.filter((x) => x !== f) : [...flags.value, f];
}

// Compiling is safe on the main thread (no matching happens), so syntax errors still show instantly.
const compiled = computed<{ re?: RegExp; error?: string }>(() => {
    if (!pattern.value) return {};
    try {
        return { re: new RegExp(pattern.value, flags.value.join("")) };
    } catch (e) {
        return { error: (e as Error).message };
    }
});

// Matching and replacing run in a worker: a catastrophically backtracking pattern
// (e.g. ^(a+)+$) would otherwise freeze the tab. Runs past TIMEOUT_MS are killed.
const TIMEOUT_MS = 1500;
const matches = ref<RegexMatch[]>([]);
const matchedText = ref(""); // the text `matches` was computed against
const replaced = ref("");
const capped = ref(false);
const timedOut = ref(false);

let worker: Worker | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastId = 0;

function getWorker() {
    if (!worker) {
        worker = new Worker(new URL("./regex.worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (e: MessageEvent<RegexResponse>) => {
            const res = e.data;
            if (res.id !== lastId) return; // stale reply from an older request
            clearTimeout(timer);
            if (!res.ok) return clearResults();
            matches.value = res.matches;
            capped.value = res.capped;
            replaced.value = res.replaced ?? "";
        };
    }
    return worker;
}

function clearResults() {
    matches.value = [];
    capped.value = false;
    replaced.value = "";
}

function run() {
    const id = ++lastId;
    clearTimeout(timer);
    timedOut.value = false;
    const re = compiled.value.re;
    matchedText.value = text.value;
    if (!re || typeof Worker === "undefined") return clearResults();
    const req: RegexRequest = {
        id,
        pattern: re.source,
        flags: re.flags,
        text: text.value,
        mode: tab.value,
        replacement: replacement.value,
    };
    getWorker().postMessage(req);
    timer = setTimeout(() => {
        if (id !== lastId) return;
        worker?.terminate();
        worker = undefined; // a fresh one is created on the next run
        clearResults();
        timedOut.value = true;
    }, TIMEOUT_MS);
}

watchDebounced([pattern, flags, text, replacement, tab], run, { debounce: 150, immediate: true });
onBeforeUnmount(() => {
    clearTimeout(timer);
    worker?.terminate();
});

function esc(s: string) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const highlighted = computed(() => {
    // Use the text the current matches belong to, so indices never point into newer, unmatched text.
    const t = matchedText.value;
    let html = "";
    let pos = 0;
    for (const m of matches.value) {
        if (m.index < pos) continue;
        html += esc(t.slice(pos, m.index));
        html += m.text === "" ? `<mark class="rx-empty"></mark>` : `<mark class="rx-mark">${esc(m.text)}</mark>`;
        pos = m.end;
    }
    html += esc(t.slice(pos));
    return html + "\n";
});

// Input sent from the chat assistant.
useHandoff<{ input?: string; pattern?: string }>("regex-tester", (p) => {
    if (p.pattern != null) pattern.value = p.pattern;
    if (p.input != null) text.value = p.input;
});
</script>

<template>
    <ToolPage>
        <template #actions>
            <Tabs v-model="tab" :options="[{ value: 'matches', label: 'Matches' }, { value: 'replace', label: 'Replace' }]" />
        </template>

        <Panel title="Expression">
            <div class="flex items-center gap-2">
                <span class="font-mono text-muted">/</span>
                <input v-model="pattern" class="input font-mono" spellcheck="false" placeholder="Regular expression" aria-label="Pattern" />
                <span class="font-mono text-muted">/{{ flags.join("") }}</span>
            </div>
            <div class="mt-3 flex flex-wrap gap-1.5">
                <button
                    v-for="f in flagInfo"
                    :key="f.f"
                    type="button"
                    :title="f.t"
                    class="cursor-pointer rounded-md border px-2 py-1 font-mono text-xs transition"
                    :class="flags.includes(f.f) ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted hover:bg-subtle'"
                    @click="toggle(f.f)"
                >
                    {{ f.f }} <span class="font-sans">{{ f.t }}</span>
                </button>
            </div>
            <Notice v-if="compiled.error" type="error" class="mt-3">{{ compiled.error }}</Notice>
            <Notice v-else-if="timedOut" type="error" class="mt-3">
                Stopped: this pattern took too long (likely catastrophic backtracking). Results cleared.
            </Notice>
            <Notice v-else-if="capped" type="warning" class="mt-3">Showing the first 10,000 matches only.</Notice>
        </Panel>

        <div class="grid gap-4 lg:grid-cols-2">
            <Panel title="Test text" flush>
                <template #actions>
                    <Btn size="sm" variant="ghost" :disabled="!text" @click="text = ''"><Eraser /> Clear</Btn>
                </template>
                <CodeArea v-model="text" placeholder="Text to test against…" height="12rem" />
                <div class="border-t border-line">
                    <div class="px-4 pt-2 text-xs font-medium tracking-wide text-muted uppercase">Highlighted</div>
                    <!-- eslint-disable-next-line vue/no-v-html -->
                    <pre class="rx-out max-h-64 overflow-auto p-4 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap" v-html="highlighted" />
                </div>
            </Panel>

            <Panel v-if="tab === 'matches'" :title="`${matches.length} match${matches.length === 1 ? '' : 'es'}`" flush>
                <div v-if="!matches.length" class="p-4 text-sm text-muted">
                    <FlaskConical class="mb-1 inline size-4" /> No matches yet.
                </div>
                <ul v-else class="max-h-[28rem] divide-y divide-line overflow-auto">
                    <li v-for="(m, i) in matches" :key="i" class="space-y-1.5 px-4 py-2.5 text-sm">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="chip">#{{ i + 1 }}</span>
                            <span class="chip">index {{ m.index }}–{{ m.end }}</span>
                            <code class="code break-all">{{ m.text === "" ? "(empty)" : m.text }}</code>
                        </div>
                        <dl v-if="m.groups.length" class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                            <template v-for="(g, gi) in m.groups" :key="gi">
                                <dt class="text-muted">Group {{ gi + 1 }}</dt>
                                <dd class="font-mono break-all">{{ g === undefined ? "undefined" : JSON.stringify(g) }}</dd>
                            </template>
                            <template v-for="(v, k) in m.named" :key="k">
                                <dt class="text-accent">&lt;{{ k }}&gt;</dt>
                                <dd class="font-mono break-all">{{ v === undefined ? "undefined" : JSON.stringify(v) }}</dd>
                            </template>
                        </dl>
                    </li>
                </ul>
            </Panel>

            <Panel v-else title="Replace" flush>
                <template #actions><CopyButton :text="replaced" /></template>
                <div class="border-b border-line p-4">
                    <label class="label" for="rx-repl">Replacement</label>
                    <input id="rx-repl" v-model="replacement" class="input font-mono" spellcheck="false" placeholder="$1, $<name>, $&amp;" />
                    <p class="mt-1 text-xs text-muted">Use $1, $&lt;name&gt;, $&amp; for the whole match.</p>
                </div>
                <CodeArea :model-value="replaced" readonly height="12rem" placeholder="Result appears here" />
            </Panel>
        </div>
    </ToolPage>
</template>

<style scoped>
.rx-out :deep(.rx-mark) {
    background: color-mix(in srgb, var(--accent) 28%, transparent);
    border-radius: 3px;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent);
    color: inherit;
}
.rx-out :deep(.rx-empty) {
    border-left: 2px solid var(--accent);
}
</style>
