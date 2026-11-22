<script setup lang="ts">
import { computed } from "vue";
import { refDebounced, useStorage } from "@vueuse/core";
import { ClipboardPaste, Sparkles, Trash2 } from "lucide-vue-next";
import { Btn, CodeArea, CopyButton, Notice, Panel, Tabs, ToolPage } from "@/components/ui";
import { useHandoff } from "@/composables/handoff";
import { readClipboard } from "@/composables/useClipboard";
import { APACHE_SAMPLE, formatApache, formatNginx, NGINX_SAMPLE } from "./serverConfigFormat";

type Mode = "nginx" | "apache";
const modes: { value: Mode; label: string }[] = [
    { value: "nginx", label: "Nginx" },
    { value: "apache", label: "Apache" },
];
const SAMPLES: Record<Mode, string> = { nginx: NGINX_SAMPLE, apache: APACHE_SAMPLE };

const mode = useStorage<Mode>("devtools:nginx-config-formatter:mode", "nginx");
const inputs = useStorage("devtools:nginx-config-formatter:inputs", { ...SAMPLES }, undefined, { mergeDefaults: true });
const opts = useStorage("devtools:nginx-config-formatter:options", { indent: "4", align: false, minify: false }, undefined, { mergeDefaults: true });

const input = computed({
    get: () => inputs.value[mode.value],
    set: (v: string) => (inputs.value[mode.value] = v),
});
const debounced = refDebounced(input, 150);

useHandoff<{ input?: string; mode?: Mode }>("nginx-config-formatter", (p) => {
    if (p.mode === "nginx" || p.mode === "apache") mode.value = p.mode;
    else if (p.input && /<VirtualHost|<Directory|<IfModule/i.test(p.input)) mode.value = "apache";
    if (p.input != null) input.value = p.input;
});

async function paste() {
    const t = await readClipboard();
    if (t) input.value = t;
}

const result = computed(() => {
    const o = {
        indent: opts.value.indent === "tab" ? "\t" : " ".repeat(Number(opts.value.indent) || 4),
        align: opts.value.align,
        minify: opts.value.minify && mode.value === "nginx",
    };
    return mode.value === "nginx" ? formatNginx(debounced.value, o) : formatApache(debounced.value, o);
});
const errors = computed(() => result.value.issues.filter((i) => i.severity === "error").length);
</script>

<template>
    <ToolPage>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <Tabs v-model="mode" :options="modes" />
            <label class="flex items-center gap-2">
                <span class="text-muted">Indent</span>
                <select v-model="opts.indent" class="select !w-auto" :disabled="opts.minify && mode === 'nginx'">
                    <option value="2">2 spaces</option>
                    <option value="4">4 spaces</option>
                    <option value="tab">Tab</option>
                </select>
            </label>
            <template v-if="mode === 'nginx'">
                <label class="flex items-center gap-2"><input v-model="opts.align" type="checkbox" class="checkbox" :disabled="opts.minify" /> Align values</label>
                <label class="flex items-center gap-2"><input v-model="opts.minify" type="checkbox" class="checkbox" /> Minify</label>
            </template>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
            <Panel :title="mode === 'nginx' ? 'nginx.conf' : 'Apache config'" flush>
                <template #actions>
                    <Btn size="sm" variant="ghost" @click="input = SAMPLES[mode]"><Sparkles /> Sample</Btn>
                    <Btn size="sm" variant="ghost" @click="paste"><ClipboardPaste /> Paste</Btn>
                    <Btn size="sm" variant="ghost" :disabled="!input" @click="input = ''"><Trash2 /> Clear</Btn>
                </template>
                <CodeArea v-model="input" :language="mode" :wrap="false" height="32rem" :placeholder="mode === 'nginx' ? 'Paste an nginx config…' : 'Paste an Apache httpd config or .htaccess…'" />
            </Panel>
            <Panel title="Formatted" flush>
                <template #actions><CopyButton :text="result.output" /></template>
                <CodeArea :model-value="result.output" :language="mode" readonly :wrap="opts.minify && mode === 'nginx'" height="32rem" placeholder="Formatted output appears here" />
            </Panel>
        </div>

        <Panel v-if="result.issues.length" :title="`Problems (${result.issues.length})`" flush>
            <ul class="divide-y divide-line">
                <li v-for="(i, n) in result.issues" :key="n" class="flex items-start gap-3 px-4 py-2 text-sm">
                    <span class="mt-0.5 shrink-0 rounded-full px-2 py-px text-[11px] font-medium uppercase" :class="i.severity === 'error' ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn'">{{ i.severity }}</span>
                    <span class="shrink-0 text-xs text-muted tabular-nums">line {{ i.line }}</span>
                    <span class="min-w-0 break-words">{{ i.message }}</span>
                </li>
            </ul>
        </Panel>
        <Notice v-else-if="input.trim()" type="success">No structural problems found.</Notice>
        <Notice v-if="errors" type="warning">The output is a best effort; fix the errors above before deploying, then check with {{ mode === "nginx" ? "nginx -t" : "apachectl configtest" }}.</Notice>
        <p class="text-xs text-muted">
            Comments, quoted strings, variables and regex locations are kept as written. Blank lines are preserved (several collapse into one).
            <template v-if="mode === 'nginx'">*_by_lua_block bodies are re-indented but otherwise left alone. Minify drops comments.</template>
            <template v-else>Section tags are matched case-insensitively; backslash continuation lines get an extra indent.</template>
        </p>
    </ToolPage>
</template>
