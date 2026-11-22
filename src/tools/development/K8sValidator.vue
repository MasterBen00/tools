<script setup lang="ts">
import { computed, ref } from "vue";
import { refDebounced, useStorage } from "@vueuse/core";
import { ClipboardPaste, Sparkles, Trash2 } from "lucide-vue-next";
import { Btn, CodeArea, Notice, Panel, Tabs, ToolPage } from "@/components/ui";
import { useHandoff } from "@/composables/handoff";
import { readClipboard } from "@/composables/useClipboard";
import { analyze, K8S_SAMPLE, type Severity } from "./k8sRules";

const input = useStorage("devtools:kubernetes-yaml-validator:input", K8S_SAMPLE);
const debounced = refDebounced(computed(() => input.value ?? ""), 200);
const filter = ref<"all" | Severity>("all");

useHandoff<{ input?: string }>("kubernetes-yaml-validator", (p) => {
    if (p.input != null) input.value = p.input;
});

async function paste() {
    const t = await readClipboard();
    if (t) input.value = t;
}

const docs = computed(() => (debounced.value.trim() ? analyze(debounced.value) : []));
const counts = computed(() => {
    const c = { error: 0, warning: 0, info: 0, parse: 0 };
    for (const d of docs.value) {
        if (d.parseError) c.parse++;
        for (const i of d.issues) c[i.severity]++;
    }
    return c;
});
const filterOptions = computed(() => [
    { value: "all" as const, label: `All (${counts.value.error + counts.value.warning + counts.value.info})` },
    { value: "error" as const, label: `Errors (${counts.value.error})` },
    { value: "warning" as const, label: `Warnings (${counts.value.warning})` },
    { value: "info" as const, label: `Info (${counts.value.info})` },
]);

const badge: Record<Severity, string> = {
    error: "bg-danger-soft text-danger",
    warning: "bg-warn-soft text-warn",
    info: "bg-info-soft text-info",
};
const visible = (sev: Severity) => filter.value === "all" || filter.value === sev;
</script>

<template>
    <ToolPage>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <Tabs v-model="filter" :options="filterOptions" size="sm" />
            <span class="text-muted">{{ docs.length }} document{{ docs.length === 1 ? "" : "s" }}</span>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
            <Panel title="Manifests (YAML, multi-document)" flush>
                <template #actions>
                    <Btn size="sm" variant="ghost" @click="input = K8S_SAMPLE"><Sparkles /> Sample</Btn>
                    <Btn size="sm" variant="ghost" @click="paste"><ClipboardPaste /> Paste</Btn>
                    <Btn size="sm" variant="ghost" :disabled="!input" @click="input = ''"><Trash2 /> Clear</Btn>
                </template>
                <CodeArea v-model="input" language="yaml" :wrap="false" height="40rem" :invalid="counts.parse > 0" placeholder="Paste Kubernetes YAML here (documents separated by ---)…" />
            </Panel>

            <div class="flex min-w-0 flex-col gap-4">
                <Panel title="Summary">
                    <div v-if="!docs.length" class="text-sm text-muted">Paste one or more manifests to analyse them.</div>
                    <div v-else class="flex flex-wrap items-center gap-2 text-sm">
                        <button type="button" class="cursor-pointer rounded-full px-2.5 py-0.5 text-xs font-medium" :class="badge.error" @click="filter = 'error'">{{ counts.error }} error{{ counts.error === 1 ? "" : "s" }}</button>
                        <button type="button" class="cursor-pointer rounded-full px-2.5 py-0.5 text-xs font-medium" :class="badge.warning" @click="filter = 'warning'">{{ counts.warning }} warning{{ counts.warning === 1 ? "" : "s" }}</button>
                        <button type="button" class="cursor-pointer rounded-full px-2.5 py-0.5 text-xs font-medium" :class="badge.info" @click="filter = 'info'">{{ counts.info }} info</button>
                        <span v-if="counts.parse" class="text-danger">{{ counts.parse }} document{{ counts.parse === 1 ? "" : "s" }} failed to parse</span>
                        <span v-else-if="!counts.error && !counts.warning" class="text-success">No errors or warnings.</span>
                    </div>
                </Panel>

                <Panel v-for="d in docs" :key="d.index + ':' + d.kind + ':' + d.name" flush>
                    <template #title>
                        <span class="flex flex-wrap items-center gap-2">
                            <span class="chip !text-fg">{{ d.kind || "?" }}</span>
                            <span class="font-mono">{{ d.name || "(unnamed)" }}</span>
                        </span>
                    </template>
                    <template #actions>
                        <span class="text-xs text-muted">doc {{ d.index }} · line {{ d.line }}</span>
                    </template>
                    <div v-if="d.parseError" class="p-4"><Notice type="error">{{ d.parseError }}</Notice></div>
                    <template v-else>
                        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-b border-line px-4 py-3 text-xs">
                            <dt class="text-muted">apiVersion</dt><dd class="font-mono break-all">{{ d.apiVersion || "—" }}</dd>
                            <dt class="text-muted">namespace</dt><dd class="font-mono">{{ d.namespace }}</dd>
                        </dl>
                        <ul class="space-y-1 px-4 py-3 text-sm text-fg">
                            <li v-for="(s, i) in d.summary" :key="i" :class="s.startsWith('•') ? 'pl-3 font-mono text-xs text-fg-muted' : ''">{{ s }}</li>
                        </ul>
                        <ul v-if="d.issues.some((i) => visible(i.severity))" class="divide-y divide-line border-t border-line">
                            <li v-for="(i, n) in d.issues.filter((x) => visible(x.severity))" :key="n" class="flex items-start gap-2 px-4 py-2 text-sm">
                                <span class="mt-0.5 shrink-0 rounded-full px-2 py-px text-[11px] font-medium uppercase" :class="badge[i.severity]">{{ i.severity }}</span>
                                <div class="min-w-0">
                                    <p>{{ i.message }}</p>
                                    <p v-if="i.path" class="mt-0.5 font-mono text-xs break-all text-muted">{{ i.path }}</p>
                                </div>
                            </li>
                        </ul>
                        <p v-else-if="d.issues.length" class="border-t border-line px-4 py-2 text-xs text-muted">No {{ filter }} findings in this document.</p>
                        <p v-else class="border-t border-line px-4 py-2 text-xs text-success">No findings.</p>
                    </template>
                </Panel>
            </div>
        </div>
        <p class="text-xs text-muted">
            Runs entirely in your browser. Checks are static (no cluster access): required fields, removed apiVersions, selector and label wiring between
            the documents in the paste, and common security and reliability practices. Secret values are never shown, only their decoded length.
        </p>
    </ToolPage>
</template>
