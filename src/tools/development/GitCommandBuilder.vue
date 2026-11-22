<script setup lang="ts">
import { computed, ref } from "vue";
import { useStorage } from "@vueuse/core";
import { RotateCcw, Search, Sparkles } from "lucide-vue-next";
import { Btn, CodeBlock, CopyButton, Panel, ToolPage } from "@/components/ui";
import { useHandoff } from "@/composables/handoff";
import { fill, GROUPS, PARAMS, RECIPES, refProblem, type Danger, type Recipe } from "./gitRecipes";

const DEFAULT_RECIPE = "undo-commit-keep";
const selectedId = useStorage("devtools:git-command-builder:recipe", DEFAULT_RECIPE);
const defaults = Object.fromEntries(Object.entries(PARAMS).map(([k, p]) => [k, p.default]));
const values = useStorage<Record<string, string>>("devtools:git-command-builder:params", { ...defaults }, undefined, { mergeDefaults: true });
const query = ref("");

useHandoff<{ input?: string }>("git-command-builder", (p) => {
    if (p.input == null) return;
    const exact = RECIPES.find((r) => r.id === p.input);
    if (exact) selectedId.value = exact.id;
    else query.value = p.input;
});

const recipe = computed<Recipe>(() => RECIPES.find((r) => r.id === selectedId.value) ?? RECIPES[0]);

const filtered = computed(() => {
    const terms = query.value.toLowerCase().split(/\s+/).filter(Boolean);
    const match = (r: Recipe) => {
        const hay = `${r.title} ${r.group} ${r.keywords ?? ""} ${r.commands.join(" ")}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
    };
    return GROUPS.map((g) => ({ group: g, items: RECIPES.filter((r) => r.group === g && match(r)) })).filter((g) => g.items.length);
});
const matchCount = computed(() => filtered.value.reduce((s, g) => s + g.items.length, 0));

const commands = computed(() => recipe.value.commands.map((c) => fill(c, values.value)));
const script = computed(() => commands.value.join("\n"));
const runnable = computed(() => commands.value.filter((c) => !c.startsWith("#")).join("\n"));

function problem(key: string): string {
    const def = PARAMS[key];
    const v = values.value[key] ?? "";
    if (def.kind === "number") return /^\d+$/.test(v.trim()) && Number(v) >= (key === "stash" ? 0 : 1) ? "" : `Enter a whole number; using ${def.default}.`;
    if (def.kind === "ref") return refProblem(v.trim());
    return v.trim() ? "" : "Required.";
}

const dangerStyle: Record<Danger, { cls: string; label: string }> = {
    safe: { cls: "bg-accent-soft text-success", label: "Safe" },
    caution: { cls: "bg-warn-soft text-warn", label: "Caution" },
    destructive: { cls: "bg-danger-soft text-danger", label: "Destructive" },
};

/** Split text on `backticks` so inline commands render as code. */
const segments = (s: string) => s.split(/`([^`]+)`/).map((t, i) => ({ code: i % 2 === 1, t }));

function resetParams() {
    for (const k of recipe.value.params) values.value[k] = PARAMS[k].default;
}
</script>

<template>
    <ToolPage>
        <template #actions>
            <Btn size="sm" variant="ghost" @click="selectedId = DEFAULT_RECIPE"><Sparkles /> Sample</Btn>
        </template>

        <div class="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
            <Panel flush>
                <template #title>What do you want to do?</template>
                <template #actions><span class="text-xs text-muted">{{ matchCount }} recipes</span></template>
                <div class="border-b border-line p-3">
                    <div class="relative">
                        <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
                        <input v-model="query" class="input !pl-9" type="search" placeholder="Search: undo, squash, stash…" aria-label="Search recipes" />
                    </div>
                </div>
                <nav class="max-h-[36rem] overflow-y-auto py-1">
                    <p v-if="!filtered.length" class="px-4 py-3 text-sm text-muted">No recipe matches “{{ query }}”.</p>
                    <div v-for="g in filtered" :key="g.group" class="py-1">
                        <p class="px-4 pt-2 pb-1 text-xs font-medium text-muted uppercase">{{ g.group }}</p>
                        <button
                            v-for="r in g.items"
                            :key="r.id"
                            type="button"
                            class="flex w-full cursor-pointer items-center gap-2 px-4 py-1.5 text-left text-sm transition-colors"
                            :class="r.id === recipe.id ? 'bg-subtle font-medium text-fg' : 'text-fg-muted hover:bg-subtle hover:text-fg'"
                            @click="selectedId = r.id"
                        >
                            <span class="size-1.5 shrink-0 rounded-full" :class="r.danger === 'destructive' ? 'bg-danger' : r.danger === 'caution' ? 'bg-warn' : 'bg-success'" />
                            <span class="min-w-0">{{ r.title }}</span>
                        </button>
                    </div>
                </nav>
            </Panel>

            <div class="flex min-w-0 flex-col gap-4">
                <Panel flush>
                    <template #title>
                        <span class="flex flex-wrap items-center gap-2">
                            {{ recipe.title }}
                            <span class="rounded-full px-2 py-px text-[11px] font-medium uppercase" :class="dangerStyle[recipe.danger].cls">{{ dangerStyle[recipe.danger].label }}</span>
                        </span>
                    </template>
                    <template #actions>
                        <CopyButton :text="runnable" label="Copy all" />
                    </template>
                    <div v-if="recipe.params.length" class="grid gap-3 border-b border-line p-4 sm:grid-cols-2">
                        <label v-for="k in recipe.params" :key="k" class="block min-w-0">
                            <span class="label">{{ PARAMS[k].label }}</span>
                            <input v-model="values[k]" class="input font-mono" :inputmode="PARAMS[k].kind === 'number' ? 'numeric' : undefined" spellcheck="false" autocapitalize="off" :placeholder="PARAMS[k].default" />
                            <span v-if="problem(k)" class="mt-1 block text-xs text-warn">{{ problem(k) }}</span>
                        </label>
                        <div class="sm:col-span-2">
                            <Btn size="sm" variant="ghost" @click="resetParams"><RotateCcw /> Reset values</Btn>
                        </div>
                    </div>
                    <div class="overflow-x-auto px-4 py-3 text-[13px]"><CodeBlock :code="script" language="bash" /></div>
                    <ul class="divide-y divide-line border-t border-line">
                        <li v-for="(c, i) in commands.filter((x) => !x.startsWith('#'))" :key="i" class="flex items-center gap-2 px-4 py-1.5">
                            <code class="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted" :title="c">{{ c }}</code>
                            <CopyButton :text="c" icon-only label="Copy command" />
                        </li>
                    </ul>
                </Panel>

                <div class="grid gap-4 xl:grid-cols-2">
                    <Panel title="What it does">
                        <p class="text-sm leading-6 text-fg">{{ recipe.explain }}</p>
                    </Panel>
                    <Panel title="How to undo">
                        <p class="text-sm leading-6 text-fg">
                            <template v-for="(s, i) in segments(recipe.undo)" :key="i"><span v-if="s.code" class="code">{{ s.t }}</span><template v-else>{{ s.t }}</template></template>
                        </p>
                    </Panel>
                </div>
                <Panel v-if="recipe.before.length" title="Before you run">
                    <ul class="list-disc space-y-1 pl-5 text-sm leading-6 text-fg">
                        <li v-for="(b, i) in recipe.before" :key="i">{{ b }}</li>
                    </ul>
                </Panel>
            </div>
        </div>
        <p class="text-xs text-muted">
            Values are shell-quoted for bash/zsh (single quotes when needed). Lines starting with # are comments and are left out of Copy all.
            In PowerShell, wrap arguments containing @{ } in quotes.
        </p>
    </ToolPage>
</template>
