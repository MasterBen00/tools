<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { refDebounced, useStorage } from "@vueuse/core";
import { ClipboardPaste, Sparkles, ThumbsUp, Trash2 } from "lucide-vue-next";
import { Btn, CodeArea, CodeBlock, CopyButton, Panel, Tabs, ToolPage } from "@/components/ui";
import { useHandoff } from "@/composables/handoff";
import { readClipboard } from "@/composables/useClipboard";
import { DOCKERFILE_SAMPLE_BAD, DOCKERFILE_SAMPLE_GOOD, dockerignoreFor, lint, type Finding, type Severity } from "./dockerfileRules";

const input = useStorage("devtools:dockerfile-linter:input", DOCKERFILE_SAMPLE_BAD);
const debounced = refDebounced(computed(() => input.value ?? ""), 200);
const filter = ref<"all" | Severity>("all");
const selected = ref<Finding | null>(null);
const viewer = ref<HTMLElement>();

useHandoff<{ input?: string }>("dockerfile-linter", (p) => {
    if (p.input != null) input.value = p.input;
});

async function paste() {
    const t = await readClipboard();
    if (t) input.value = t;
}

const result = computed(() => lint(debounced.value));
const lines = computed(() => debounced.value.split(/\r?\n/));
const counts = computed(() => {
    const c = { error: 0, warning: 0, info: 0 };
    for (const f of result.value.findings) c[f.severity]++;
    return c;
});
const shown = computed(() => result.value.findings.filter((f) => filter.value === "all" || f.severity === filter.value));
const filterOptions = computed(() => [
    { value: "all" as const, label: `All (${result.value.findings.length})` },
    { value: "error" as const, label: `Errors (${counts.value.error})` },
    { value: "warning" as const, label: `Warnings (${counts.value.warning})` },
    { value: "info" as const, label: `Info (${counts.value.info})` },
]);
const grade = computed(() => {
    const s = result.value.score;
    if (!result.value.instructions.length) return { label: "—", cls: "text-muted" };
    if (counts.value.error) return { label: "Fix the errors first", cls: "text-danger" };
    if (s >= 90) return { label: "Production ready", cls: "text-success" };
    if (s >= 70) return { label: "Good, a few improvements", cls: "text-success" };
    if (s >= 40) return { label: "Needs work", cls: "text-warn" };
    return { label: "Many problems", cls: "text-danger" };
});
const dockerignore = computed(() => dockerignoreFor(result.value.ecosystems));

const badge: Record<Severity, string> = {
    error: "bg-danger-soft text-danger",
    warning: "bg-warn-soft text-warn",
    info: "bg-info-soft text-info",
};

/** Lines covered by the selected finding's instruction (continuations included). */
const highlighted = computed(() => {
    const f = selected.value;
    if (!f || !f.line) return new Set<number>();
    const ins = result.value.instructions.find((i) => i.line === f.line);
    const end = ins ? ins.endLine : f.line;
    const s = new Set<number>();
    for (let n = f.line; n <= end; n++) s.add(n);
    return s;
});
const lineIssues = computed(() => {
    const m = new Map<number, Severity>();
    const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
    for (const f of result.value.findings) {
        const cur = m.get(f.line);
        if (!cur || rank[f.severity] < rank[cur]) m.set(f.line, f.severity);
    }
    return m;
});
const dot: Record<Severity, string> = { error: "bg-danger", warning: "bg-warn", info: "bg-info" };

async function select(f: Finding) {
    selected.value = selected.value === f ? null : f;
    await nextTick();
    viewer.value?.querySelector(`[data-line="${f.line}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
}
</script>

<template>
    <ToolPage>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <Tabs v-model="filter" :options="filterOptions" size="sm" />
            <span class="text-muted">Samples:</span>
            <Btn size="sm" variant="ghost" @click="input = DOCKERFILE_SAMPLE_BAD"><Sparkles /> Spring Boot with issues</Btn>
            <Btn size="sm" variant="ghost" @click="input = DOCKERFILE_SAMPLE_GOOD"><ThumbsUp /> Good multi-stage</Btn>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
            <Panel title="Dockerfile" flush>
                <template #actions>
                    <Btn size="sm" variant="ghost" @click="paste"><ClipboardPaste /> Paste</Btn>
                    <Btn size="sm" variant="ghost" :disabled="!input" @click="input = ''"><Trash2 /> Clear</Btn>
                </template>
                <CodeArea v-model="input" language="dockerfile" :wrap="false" height="28rem" placeholder="Paste a Dockerfile here…" />
            </Panel>

            <div class="flex min-w-0 flex-col gap-4">
                <Panel title="Score">
                    <div class="flex flex-wrap items-center gap-4">
                        <div class="font-display text-4xl font-semibold tabular-nums" :class="grade.cls">{{ result.instructions.length ? result.score : "—" }}</div>
                        <div class="min-w-0 text-sm">
                            <p class="font-medium" :class="grade.cls">{{ grade.label }}</p>
                            <p class="text-muted">
                                {{ result.instructions.length }} instructions · {{ result.stages.length }} stage{{ result.stages.length === 1 ? "" : "s" }}
                                <template v-if="result.ecosystems.size"> · {{ [...result.ecosystems].join(", ") }}</template>
                            </p>
                        </div>
                        <div class="ml-auto flex flex-wrap gap-1.5">
                            <button v-for="s in ['error', 'warning', 'info'] as const" :key="s" type="button" class="cursor-pointer rounded-full px-2.5 py-0.5 text-xs font-medium" :class="badge[s]" @click="filter = filter === s ? 'all' : s">
                                {{ counts[s] }} {{ s }}{{ s !== "info" && counts[s] !== 1 ? "s" : "" }}
                            </button>
                        </div>
                    </div>
                </Panel>

                <Panel :title="`Findings (${shown.length})`" flush>
                    <p v-if="!result.instructions.length" class="p-4 text-sm text-muted">Paste a Dockerfile to lint it.</p>
                    <p v-else-if="!shown.length" class="p-4 text-sm text-success">Nothing to report{{ filter === "all" ? "" : ` at ${filter} level` }}.</p>
                    <ul v-else class="max-h-[34rem] divide-y divide-line overflow-y-auto">
                        <li v-for="(f, i) in shown" :key="i">
                            <button type="button" class="w-full cursor-pointer px-4 py-2.5 text-left text-sm transition-colors hover:bg-subtle" :class="selected === f ? 'bg-subtle' : ''" @click="select(f)">
                                <div class="flex flex-wrap items-center gap-2">
                                    <span class="rounded-full px-2 py-px text-[11px] font-medium uppercase" :class="badge[f.severity]">{{ f.severity }}</span>
                                    <span class="font-mono text-xs text-fg-muted">{{ f.code }}</span>
                                    <span v-if="f.line" class="text-xs text-muted">line {{ f.line }}</span>
                                </div>
                                <p class="mt-1 text-fg">{{ f.message }}</p>
                                <p v-if="f.line && lines[f.line - 1]" class="mt-1 truncate font-mono text-xs text-fg-subtle">{{ lines[f.line - 1].trim() }}</p>
                            </button>
                            <div v-if="selected === f" class="space-y-2 px-4 pb-3 text-sm">
                                <div><span class="text-xs font-medium text-muted uppercase">Fix</span><p class="mt-0.5 font-mono text-xs break-words text-fg">{{ f.fix }}</p></div>
                                <div><span class="text-xs font-medium text-muted uppercase">Why</span><p class="mt-0.5 text-fg-muted">{{ f.why }}</p></div>
                            </div>
                        </li>
                    </ul>
                </Panel>
            </div>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
            <Panel title="Dockerfile with line numbers" flush>
                <template #actions><span class="text-xs text-muted">Click a finding to highlight its line</span></template>
                <div ref="viewer" class="max-h-[28rem] overflow-auto py-2 font-mono text-[13px] leading-relaxed">
                    <div
                        v-for="(l, i) in lines"
                        :key="i"
                        :data-line="i + 1"
                        class="flex min-w-max"
                        :class="highlighted.has(i + 1) ? (selected ? badge[selected.severity] : '') : ''"
                    >
                        <span class="flex w-12 shrink-0 items-center justify-end gap-1.5 pr-3 text-right text-fg-subtle tabular-nums select-none">
                            <span v-if="lineIssues.get(i + 1)" class="size-1.5 rounded-full" :class="dot[lineIssues.get(i + 1)!]" />{{ i + 1 }}
                        </span>
                        <span class="pr-4 whitespace-pre">{{ l || " " }}</span>
                    </div>
                </div>
            </Panel>

            <Panel title=".dockerignore reminder" flush>
                <template #actions><CopyButton :text="dockerignore" /></template>
                <p class="border-b border-line px-4 py-3 text-sm text-fg-muted">
                    The Dockerfile cannot show it, but a missing <span class="code">.dockerignore</span> sends node_modules, build output, .git and .env files to the
                    daemon, slows every build, busts the COPY cache and can leak secrets into the image. A starting point for this project:
                </p>
                <div class="max-h-[22rem] overflow-auto px-4 py-3 text-[13px]"><CodeBlock :code="dockerignore" language="bash" /></div>
            </Panel>
        </div>
        <p class="text-xs text-muted">
            Static analysis in your browser; nothing is built or uploaded. Codes starting with DL follow hadolint where an equivalent rule exists; DX codes are
            extra checks of this tool.
        </p>
    </ToolPage>
</template>
