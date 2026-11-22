<script setup lang="ts">
import { computed, ref } from "vue";
import { useStorage } from "@vueuse/core";
import { RotateCcw } from "lucide-vue-next";
import { Btn, CodeBlock, CopyButton, Field, Notice, Panel, Tabs, ToolPage } from "@/components/ui";

type Jdk = 8 | 11 | 17 | 21 | 25;
type Workload = "web" | "batch" | "lowlatency";
type Approach = "percentage" | "fixed";

interface Inputs {
    memory: number;
    unit: "MiB" | "GiB";
    cpus: number;
    jdk: Jdk;
    workload: Workload;
    threads: number;
    xss: number;
    approach: Approach;
    heapOverride: number | null;
    exitOnOom: boolean;
    heapDump: boolean;
    heapDumpPath: string;
}

const DEFAULTS: Inputs = {
    memory: 2,
    unit: "GiB",
    cpus: 2,
    jdk: 21,
    workload: "web",
    threads: 200,
    xss: 1024,
    approach: "percentage",
    heapOverride: null,
    exitOnOom: true,
    heapDump: true,
    heapDumpPath: "/tmp",
};
const s = useStorage<Inputs>("devtools:jvm-flags-calculator:inputs", { ...DEFAULTS }, undefined, { mergeDefaults: true });
function reset() {
    s.value = { ...DEFAULTS };
}

const totalMiB = computed(() => Math.max(0, Math.round((Number(s.value.memory) || 0) * (s.value.unit === "GiB" ? 1024 : 1))));

const gc = computed(() => {
    const { cpus, workload, jdk } = s.value;
    const mem = totalMiB.value;
    if (cpus < 2 || mem < 1792)
        return {
            name: "Serial GC",
            flags: ["-XX:+UseSerialGC"],
            overhead: 0.01,
            why: `With ${cpus < 2 ? "fewer than 2 CPUs" : "less than 1.75 GiB"} the JVM does not treat the machine as server-class and picks Serial anyway. Serial has the smallest footprint and no concurrent GC threads competing for a single core. Give the container 2+ CPUs and 2 GiB if you want G1.`,
        };
    if (workload === "lowlatency" && jdk >= 21)
        return {
            name: "Generational ZGC",
            flags: jdk >= 23 ? ["-XX:+UseZGC"] : ["-XX:+UseZGC", "-XX:+ZGenerational"],
            overhead: 0.05,
            why: `ZGC keeps pauses well under a millisecond regardless of heap size. ${jdk >= 23 ? "Since JDK 23 ZGC is generational by default." : "On JDK 21 enable the generational mode with -XX:+ZGenerational."} It trades some throughput and memory for latency, so leave extra headroom.`,
        };
    if (workload === "lowlatency" && jdk === 17)
        return {
            name: "ZGC",
            flags: ["-XX:+UseZGC"],
            overhead: 0.05,
            why: "ZGC is production-ready on JDK 17 but not generational yet (that needs JDK 21), so it needs a larger heap headroom to keep up with allocation. Upgrade to 21+ for generational ZGC.",
        };
    if (workload === "batch")
        return {
            name: "Parallel GC",
            flags: ["-XX:+UseParallelGC"],
            overhead: 0.02,
            why: "Batch jobs care about total throughput, not pause times. Parallel GC uses all cores during stop-the-world collections and has the lowest overhead.",
        };
    return {
        name: "G1 GC",
        flags: ["-XX:+UseG1GC", ...(workload === "lowlatency" ? ["-XX:MaxGCPauseMillis=50"] : [])],
        overhead: 0.04,
        why:
            workload === "lowlatency"
                ? `ZGC needs JDK 17+ (generational on 21+); on JDK ${jdk} G1 with a lower pause target is the best option.`
                : "G1 is the default server collector: a balanced choice for web APIs, with a 200 ms pause target and good throughput.",
    };
});

const budget = computed(() => {
    const total = totalMiB.value;
    const { workload, threads, xss } = s.value;
    const metaspace = total < 1024 ? 128 : workload === "batch" ? 192 : 256;
    const codeCache = total < 1024 ? 64 : total < 2048 ? 128 : 240;
    const direct = total < 1024 ? 32 : total < 4096 ? 128 : workload === "batch" ? 128 : 256;
    const stacks = Math.ceil((Math.max(0, threads) * xss) / 1024);
    const nativeBase = 64; // JIT compiler, symbol tables, malloc arenas, class metadata outside metaspace
    const headroom = Math.round(total * 0.05);
    const fixed = metaspace + codeCache + direct + stacks + nativeBase + headroom;
    const autoHeap = Math.floor((total - fixed) / (1 + gc.value.overhead));
    const heap = s.value.heapOverride && s.value.heapOverride > 0 ? Math.round(s.value.heapOverride) : Math.max(0, autoHeap);
    const gcOverhead = Math.round(heap * gc.value.overhead);
    const items = [
        { key: "heap", label: "Heap", flag: s.value.approach === "fixed" ? "-Xmx" : "MaxRAMPercentage", mib: heap, cls: "bg-accent" },
        { key: "meta", label: "Metaspace", flag: "-XX:MaxMetaspaceSize", mib: metaspace, cls: "bg-info" },
        { key: "stacks", label: `Thread stacks (${threads} × ${xss}k)`, flag: "-Xss", mib: stacks, cls: "bg-warn" },
        { key: "code", label: "Code cache", flag: "-XX:ReservedCodeCacheSize", mib: codeCache, cls: "bg-success" },
        { key: "direct", label: "Direct buffers", flag: "-XX:MaxDirectMemorySize", mib: direct, cls: "bg-fg-subtle" },
        { key: "native", label: "GC structures + JVM native", flag: "", mib: gcOverhead + nativeBase, cls: "bg-line-strong" },
        { key: "headroom", label: "Headroom (5%)", flag: "", mib: headroom, cls: "bg-subtle" },
    ];
    const sum = items.reduce((a, b) => a + b.mib, 0);
    return { items, sum, heap, autoHeap, metaspace, codeCache, direct, stacks, over: sum > total };
});

const heapPct = computed(() => (totalMiB.value ? Math.floor((budget.value.heap / totalMiB.value) * 1000) / 10 : 0));

const warnings = computed(() => {
    const w: string[] = [];
    const b = budget.value;
    if (b.over) w.push(`The budget (${fmt(b.sum)}) exceeds the container limit (${fmt(totalMiB.value)}). The kernel OOM-killer will stop the container before the JVM throws OutOfMemoryError.`);
    if (b.heap < 128) w.push("The heap is under 128 MiB. A Spring Boot application usually needs at least 256 MiB of heap; raise the memory limit or lower the thread count.");
    if (s.value.threads > 400 && s.value.workload !== "batch") w.push("More than 400 platform threads: on JDK 21+ consider virtual threads (spring.threads.virtual.enabled=true), which need far less stack memory.");
    if (s.value.jdk === 8) w.push("JDK 8 needs 8u191 or newer for container support (UseContainerSupport, MaxRAMPercentage). Older 8 builds read the host memory and will over-size the heap.");
    if (s.value.approach === "fixed" && totalMiB.value) w.push("Fixed -Xmx does not follow the container limit; remember to change it whenever you change the limit.");
    return w;
});

function fmt(mib: number) {
    return mib >= 1024 ? `${(mib / 1024).toFixed(mib % 1024 ? 2 : 0)} GiB` : `${mib} MiB`;
}

const flags = computed(() => {
    const b = budget.value;
    const f: string[] = [];
    if (s.value.approach === "percentage") f.push(`-XX:InitialRAMPercentage=${heapPct.value}`, `-XX:MaxRAMPercentage=${heapPct.value}`);
    else f.push(`-Xms${b.heap}m`, `-Xmx${b.heap}m`);
    f.push(`-XX:MaxMetaspaceSize=${b.metaspace}m`, `-XX:ReservedCodeCacheSize=${b.codeCache}m`, `-XX:MaxDirectMemorySize=${b.direct}m`);
    if (s.value.xss !== 1024) f.push(`-Xss${s.value.xss}k`);
    f.push(...gc.value.flags);
    if (s.value.exitOnOom) f.push("-XX:+ExitOnOutOfMemoryError");
    if (s.value.heapDump) f.push("-XX:+HeapDumpOnOutOfMemoryError", `-XX:HeapDumpPath=${s.value.heapDumpPath || "/tmp"}`);
    return f;
});

type OutFmt = "env" | "list" | "docker" | "k8s";
const outFmt = ref<OutFmt>("env");
const joined = computed(() => flags.value.join(" "));
const k8sMem = computed(() => (s.value.unit === "GiB" ? `${s.value.memory}Gi` : `${s.value.memory}Mi`));
const output = computed(() => {
    switch (outFmt.value) {
        case "env":
            return `JAVA_TOOL_OPTIONS="${joined.value}"`;
        case "list":
            return flags.value.join("\n");
        case "docker":
            return `ENV JAVA_TOOL_OPTIONS="${joined.value}"`;
        case "k8s":
            return `env:\n  - name: JAVA_TOOL_OPTIONS\n    value: "${joined.value}"\nresources:\n  requests:\n    memory: "${k8sMem.value}"\n    cpu: "${s.value.cpus}"\n  limits:\n    memory: "${k8sMem.value}"`;
    }
    return "";
});
const outLang = computed(() => (outFmt.value === "k8s" ? "yaml" : outFmt.value === "docker" ? "dockerfile" : "bash"));
</script>

<template>
    <ToolPage>
        <template #actions>
            <Btn size="sm" variant="ghost" @click="reset"><RotateCcw /> Reset</Btn>
        </template>

        <div class="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
            <Panel title="Container">
                <div class="flex flex-col gap-4 text-sm">
                    <Field label="Memory limit">
                        <div class="flex gap-2">
                            <input v-model.number="s.memory" type="number" min="0" step="any" class="input" aria-label="Memory" />
                            <select v-model="s.unit" class="select !w-24" aria-label="Unit">
                                <option value="MiB">MiB</option>
                                <option value="GiB">GiB</option>
                            </select>
                        </div>
                    </Field>
                    <Field label="CPU cores" hint="The CPU limit the JVM sees (cgroup quota).">
                        <input v-model.number="s.cpus" type="number" min="0.5" step="0.5" class="input" />
                    </Field>
                    <div>
                        <span class="label">JDK version</span>
                        <Tabs
                            v-model="s.jdk"
                            size="sm"
                            :options="[
                                { value: 8, label: '8' },
                                { value: 11, label: '11' },
                                { value: 17, label: '17' },
                                { value: 21, label: '21' },
                                { value: 25, label: '25' },
                            ]"
                        />
                    </div>
                    <div>
                        <span class="label">Workload</span>
                        <Tabs
                            v-model="s.workload"
                            size="sm"
                            :options="[
                                { value: 'web', label: 'Web API' },
                                { value: 'batch', label: 'Batch' },
                                { value: 'lowlatency', label: 'Low latency' },
                            ]"
                        />
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <Field label="Threads" hint="Tomcat max is 200">
                            <input v-model.number="s.threads" type="number" min="0" class="input" />
                        </Field>
                        <Field label="Stack size (-Xss)">
                            <select v-model.number="s.xss" class="select">
                                <option :value="256">256k</option>
                                <option :value="512">512k</option>
                                <option :value="1024">1m (default)</option>
                                <option :value="2048">2m</option>
                            </select>
                        </Field>
                    </div>
                    <div>
                        <span class="label">Heap sizing</span>
                        <Tabs
                            v-model="s.approach"
                            size="sm"
                            :options="[
                                { value: 'percentage', label: 'MaxRAMPercentage' },
                                { value: 'fixed', label: 'Fixed -Xmx / -Xms' },
                            ]"
                        />
                    </div>
                    <Field label="Heap override (MiB)" :hint="`Leave empty for the computed ${budget.autoHeap} MiB.`">
                        <input v-model.number="s.heapOverride" type="number" min="0" class="input" placeholder="auto" />
                    </Field>
                    <div class="flex flex-col gap-2">
                        <label class="flex items-center gap-2"><input v-model="s.exitOnOom" type="checkbox" class="checkbox" /> -XX:+ExitOnOutOfMemoryError</label>
                        <label class="flex items-center gap-2"><input v-model="s.heapDump" type="checkbox" class="checkbox" /> -XX:+HeapDumpOnOutOfMemoryError</label>
                        <input v-if="s.heapDump" v-model="s.heapDumpPath" class="input font-mono" placeholder="/tmp" aria-label="Heap dump path" />
                    </div>
                </div>
            </Panel>

            <div class="flex min-w-0 flex-col gap-4">
                <Panel title="Memory budget">
                    <div class="flex flex-col gap-4">
                        <div class="flex flex-wrap items-baseline justify-between gap-2">
                            <p class="text-sm text-fg-muted">
                                Heap <span class="text-2xl font-semibold text-fg">{{ fmt(budget.heap) }}</span>
                                <span v-if="s.approach === 'percentage'"> ({{ heapPct }}% of {{ fmt(totalMiB) }})</span>
                            </p>
                            <p class="text-sm" :class="budget.over ? 'font-medium text-danger' : 'text-fg-muted'">{{ fmt(budget.sum) }} of {{ fmt(totalMiB) }} used</p>
                        </div>
                        <div class="flex h-6 w-full overflow-hidden rounded-md ring-1 ring-line" role="img" :aria-label="`Memory budget: ${budget.sum} of ${totalMiB} MiB`">
                            <div
                                v-for="it in budget.items"
                                :key="it.key"
                                :class="it.cls"
                                class="h-full border-r border-surface last:border-r-0"
                                :style="{ width: `${(it.mib / Math.max(budget.sum, totalMiB, 1)) * 100}%` }"
                                :title="`${it.label}: ${it.mib} MiB`"
                            />
                            <div v-if="!budget.over && budget.sum < totalMiB" class="h-full flex-1" />
                        </div>
                        <div v-if="budget.over" class="relative -mt-3 h-1.5 w-full">
                            <div class="absolute top-0 h-full bg-danger" :style="{ left: `${(totalMiB / budget.sum) * 100}%`, right: '0' }" title="Over the container limit" />
                        </div>
                        <div class="overflow-x-auto">
                            <table class="w-full text-sm">
                                <thead class="text-left text-xs text-muted uppercase">
                                    <tr>
                                        <th class="py-2 pr-2 font-medium">Area</th>
                                        <th class="px-2 py-2 font-medium">Flag</th>
                                        <th class="px-2 py-2 text-right font-medium">MiB</th>
                                        <th class="py-2 pl-2 text-right font-medium">Share</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-line border-t border-line">
                                    <tr v-for="it in budget.items" :key="it.key">
                                        <td class="py-1.5 pr-2">
                                            <span class="flex items-center gap-2"><span class="size-3 shrink-0 rounded-sm ring-1 ring-line" :class="it.cls" />{{ it.label }}</span>
                                        </td>
                                        <td class="px-2 py-1.5 font-mono text-xs text-fg-muted">{{ it.flag }}</td>
                                        <td class="px-2 py-1.5 text-right tabular-nums">{{ it.mib }}</td>
                                        <td class="py-1.5 pl-2 text-right text-fg-muted tabular-nums">{{ totalMiB ? Math.round((it.mib / totalMiB) * 100) : 0 }}%</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <Notice v-for="(w, i) in warnings" :key="i" :type="i === 0 && budget.over ? 'error' : 'warning'">{{ w }}</Notice>
                    </div>
                </Panel>

                <Panel :title="`Garbage collector: ${gc.name}`">
                    <p class="text-sm text-fg-muted">{{ gc.why }}</p>
                    <p class="mt-2 flex flex-wrap gap-1.5"><span v-for="f in gc.flags" :key="f" class="code">{{ f }}</span></p>
                </Panel>

                <Panel title="Flags" flush>
                    <template #actions>
                        <Tabs
                            v-model="outFmt"
                            size="sm"
                            :options="[
                                { value: 'env', label: 'JAVA_TOOL_OPTIONS' },
                                { value: 'list', label: 'Flag list' },
                                { value: 'docker', label: 'Dockerfile' },
                                { value: 'k8s', label: 'Kubernetes' },
                            ]"
                        />
                        <CopyButton :text="output" />
                    </template>
                    <div class="overflow-x-auto"><CodeBlock :code="output" :language="outLang" /></div>
                </Panel>
            </div>
        </div>

        <p class="text-xs text-muted">
            Estimates for a typical Spring Boot service. Metaspace, code cache and direct memory are capped so the total stays predictable; JVM native memory (JIT, GC data, malloc) is estimated.
            Check the real numbers with <span class="code">-XX:NativeMemoryTracking=summary</span> and <span class="code">jcmd &lt;pid&gt; VM.native_memory summary</span>.
        </p>
    </ToolPage>
</template>
