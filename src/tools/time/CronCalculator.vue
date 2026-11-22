<script setup lang="ts">
import { useHandoff } from "@/composables/handoff";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { toString as cronToString } from "cronstrue";
import { CronExpressionParser } from "cron-parser";
import { Wand2 } from "lucide-vue-next";
import { Btn, CodeBlock, CopyButton, Notice, Panel, Tabs, ToolPage } from "@/components/ui";
import { SPRING_MACROS, expandMacro, parseSpringCron, springNextRuns } from "./springCron";

type Dialect = "unix" | "spring";
const SPRING_SAMPLE = "0 0 9-17 * * MON-FRI";
const expr = ref("*/15 9-17 * * 1-5");
const dialect = ref<Dialect>("unix");
const runCount = ref(10);
const withZone = ref(true);
const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const tz = ref("local");
const zones: string[] = (() => {
    try {
        return Intl.supportedValuesOf("timeZone");
    } catch {
        return [];
    }
})();

const presets = [
    { label: "Every minute", v: "* * * * *" },
    { label: "Every 5 minutes", v: "*/5 * * * *" },
    { label: "Hourly", v: "0 * * * *" },
    { label: "Daily at midnight", v: "0 0 * * *" },
    { label: "Weekdays 9am", v: "0 9 * * 1-5" },
    { label: "Every Monday 8:30", v: "30 8 * * 1" },
    { label: "Weekends noon", v: "0 12 * * 0,6" },
    { label: "1st of month", v: "0 0 1 * *" },
    { label: "Every Jan 1st", v: "0 0 1 1 *" },
    { label: "Every 30 sec (6 fields)", v: "*/30 * * * * *" },
];
const springPresets = [
    { label: "Top of every hour", v: "0 0 * * * *" },
    { label: "Every 10 minutes", v: "0 */10 * * * *" },
    { label: "Every 30 seconds", v: "*/30 * * * * *" },
    { label: "8, 9 and 10 o'clock daily", v: "0 0 8-10 * * *" },
    { label: "Hourly 9–17 on weekdays", v: "0 0 9-17 * * MON-FRI" },
    { label: "Christmas Day midnight", v: "0 0 0 25 12 ?" },
    { label: "Last day of month", v: "0 0 0 L * *" },
    { label: "Last Friday 17:00", v: "0 0 17 ? * FRIL" },
    { label: "Weekday nearest the 15th", v: "0 0 9 15W * ?" },
    { label: "2nd Monday 6:30", v: "0 30 6 ? * MON#2" },
    { label: "@daily", v: "@daily" },
    { label: "@hourly", v: "@hourly" },
];
const macroList = Object.entries(SPRING_MACROS);

const fieldDefs5 = [
    { name: "Minute", range: "0–59", min: 0, max: 59 },
    { name: "Hour", range: "0–23", min: 0, max: 23 },
    { name: "Day of month", range: "1–31", min: 1, max: 31 },
    { name: "Month", range: "1–12", min: 1, max: 12 },
    { name: "Day of week", range: "0–7 (Sun=0 or 7)", min: 0, max: 6 },
];
const fieldDefs6 = [{ name: "Second", range: "0–59", min: 0, max: 59 }, ...fieldDefs5];
const MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MON_ABBR = ["", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAY_ABBR = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const isSpring = computed(() => dialect.value === "spring");
/** The expression with Spring macros (@daily…) expanded. */
const effective = computed(() => (isSpring.value ? expandMacro(expr.value) : expr.value.trim()));
const isMacro = computed(() => isSpring.value && effective.value !== expr.value.trim());
const tokens = computed(() => effective.value.split(/\s+/).filter(Boolean));
const fiveInSpring = computed(() => isSpring.value && tokens.value.length === 5);

function prependSeconds() {
    expr.value = "0 " + expr.value.trim();
}

function name(field: string, v: string) {
    const up = v.toUpperCase();
    if (field === "Month") {
        const i = /^\d+$/.test(v) ? Number(v) : MON_ABBR.indexOf(up);
        return MONTHS[i] ?? v;
    }
    if (field === "Day of week") {
        const i = /^\d+$/.test(v) ? Number(v) : DAY_ABBR.indexOf(up);
        return DAYS[i] ?? v;
    }
    return v;
}
function mean(field: string, t: string): string {
    const unit = field.toLowerCase();
    if (t === "*" || t === "?") return `every ${unit}`;
    return t
        .split(",")
        .map((part) => {
            const [rangePart, step] = part.split("/");
            let base: string;
            if (rangePart === "*" || rangePart === "?") base = `every ${unit}`;
            else if (rangePart.includes("-")) {
                const [a, b] = rangePart.split("-");
                base = `${name(field, a)} through ${name(field, b)}`;
            } else if (/^L$/i.test(rangePart)) base = "last day";
            else if (/^LW$/i.test(rangePart)) base = "last weekday of the month";
            else if (/^L-\d+$/i.test(rangePart)) base = `${rangePart.slice(2)} days before the last day`;
            else if (/^\d+W$/i.test(rangePart)) base = `weekday nearest day ${rangePart.slice(0, -1)}`;
            else if (field === "Day of week" && /^\w+L$/i.test(rangePart)) base = `last ${name(field, rangePart.slice(0, -1))} of the month`;
            else if (/#/.test(rangePart)) {
                const [d, n] = rangePart.split("#");
                base = `${name(field, d)} number ${n}`;
            } else base = name(field, rangePart);
            if (step) return rangePart === "*" ? `every ${step} ${unit}s` : `every ${step} ${unit}s, ${base}`;
            return base;
        })
        .join("; ");
}

const breakdown = computed(() => {
    const t = tokens.value;
    if (isSpring.value ? t.length !== 6 : t.length !== 5 && t.length !== 6) return [];
    const defs = t.length === 6 ? fieldDefs6 : fieldDefs5;
    return defs.map((d, i) => ({ ...d, value: t[i], meaning: mean(d.name, t[i]) }));
});

const description = computed(() => {
    if (!expr.value.trim()) return { text: "" };
    if (isSpring.value) {
        if (tokens.value.length === 5) return { error: "Spring needs exactly 6 fields: this looks like a 5-field Unix expression with no seconds field." };
        if (tokens.value.length === 7) return { error: "Spring does not support the Quartz year field (7th field). Remove it." };
        try {
            parseSpringCron(effective.value);
        } catch (e) {
            return { error: (e as Error).message };
        }
    } else if (tokens.value.length !== 5 && tokens.value.length !== 6) return { error: `Expected 5 or 6 fields, found ${tokens.value.length}.` };
    try {
        return { text: cronToString(effective.value, { throwExceptionOnParseError: true, use24HourTimeFormat: false }) };
    } catch (e) {
        return { error: typeof e === "string" ? e : (e as Error).message };
    }
});

const zoneId = computed(() => (tz.value === "local" ? localTz : tz.value));

const runs = computed<{ error?: string; items: { when: string; rel: string }[] }>(() => {
    if (!expr.value.trim() || "error" in description.value) return { items: [] };
    try {
        const dates: Date[] = [];
        if (isSpring.value) dates.push(...springNextRuns(parseSpringCron(effective.value), zoneId.value, new Date(), runCount.value));
        else {
            const it = CronExpressionParser.parse(expr.value.trim(), { currentDate: new Date(), tz: zoneId.value });
            for (let i = 0; i < runCount.value && it.hasNext(); i++) dates.push(it.next().toDate());
        }
        const out: { when: string; rel: string }[] = [];
        const f = new Intl.DateTimeFormat("en-US", {
            timeZone: zoneId.value, weekday: "short", year: "numeric", month: "short", day: "numeric",
            hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "short",
        });
        const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
        const now = Date.now();
        for (const d of dates) {
            const s = (d.getTime() - now) / 1000;
            const rel =
                s < 3600 ? rtf.format(Math.round(s / 60), "minute")
                : s < 86400 ? rtf.format(Math.round(s / 3600), "hour")
                : rtf.format(Math.round(s / 86400), "day");
            out.push({ when: f.format(d), rel });
        }
        return { items: out };
    } catch (e) {
        return { items: [], error: (e as Error).message };
    }
});

// Visual builder (5 fields)
type Mode = "every" | "step" | "range" | "list";
interface BField { mode: Mode; step: string; start: string; from: string; to: string; list: string }
const builder = reactive<BField[]>(fieldDefs5.map(() => ({ mode: "every", step: "5", start: "", from: "", to: "", list: "" })));
const modeLabels: { value: Mode; label: string }[] = [
    { value: "every", label: "Every" }, { value: "step", label: "Every N" },
    { value: "range", label: "Range" }, { value: "list", label: "Specific" },
];

function buildField(b: BField, i: number): string {
    const d = fieldDefs5[i];
    if (b.mode === "every") return "*";
    if (b.mode === "step") return `${b.start || "*"}/${b.step || "1"}`;
    if (b.mode === "range") return `${b.from || d.min}-${b.to || d.max}`;
    return b.list.replace(/\s+/g, "") || String(d.min);
}
watch(builder, () => {
    expr.value = (isSpring.value ? "0 " : "") + builder.map(buildField).join(" ");
}, { deep: true });

const scheduled = computed(() => {
    const zone = withZone.value ? `, zone = "${zoneId.value}"` : "";
    return `@Scheduled(cron = "${expr.value.trim()}"${zone})\npublic void runJob() {\n    // ...\n}`;
});

// The spring-cron route reuses this component and opens in Spring mode.
const route = useRoute();
onMounted(() => {
    if (route.meta.toolId === "spring-cron") {
        dialect.value = "spring";
        expr.value = SPRING_SAMPLE;
    }
});

// Input sent from the chat assistant.
useHandoff<{ input?: string }>("cron-calculator", (p) => {
    if (p.input) expr.value = p.input;
});
useHandoff<{ input?: string }>("spring-cron", (p) => {
    dialect.value = "spring";
    if (p.input) expr.value = p.input;
});
</script>

<template>
    <ToolPage>
        <template #actions>
            <Tabs
                v-model="dialect"
                :options="[
                    { value: 'unix', label: 'Unix' },
                    { value: 'spring', label: 'Spring' },
                ]"
            />
        </template>
        <Panel title="Expression">
            <template #actions><CopyButton :text="expr" /></template>
            <div class="flex flex-col gap-3">
                <input v-model="expr" class="input font-mono text-base" spellcheck="false" :placeholder="isSpring ? '0 */5 * * * *' : '*/5 * * * *'" aria-label="Cron expression" />
                <div class="flex flex-wrap gap-1.5">
                    <button v-for="p in isSpring ? springPresets : presets" :key="p.v" type="button" class="chip cursor-pointer hover:border-line-strong hover:text-fg" :title="p.v" @click="expr = p.v">{{ p.label }}</button>
                </div>
                <Notice v-if="fiveInSpring" type="warning">
                    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <span>Spring cron has exactly 6 fields and starts with seconds; this is a 5-field Unix expression, which Spring rejects at startup.</span>
                        <Btn size="sm" variant="secondary" @click="prependSeconds"><Wand2 /> Prepend 0 seconds</Btn>
                    </div>
                </Notice>
                <Notice v-else-if="'error' in description && description.error" type="error">{{ description.error }}</Notice>
                <p v-else-if="'text' in description && description.text" class="text-lg font-medium">{{ description.text }}</p>
                <p v-if="isMacro" class="text-sm text-fg-muted">
                    <span class="code">{{ expr.trim() }}</span> expands to <span class="code">{{ effective }}</span>
                </p>
                <p v-if="isSpring" class="text-xs text-muted">
                    Spring (CronExpression, @Scheduled) uses exactly 6 fields: second minute hour day-of-month month day-of-week. Day-of-week is 0–7 or MON–SUN (0 and 7 are Sunday).
                    Also supported: <span class="code">?</span>, <span class="code">L</span>, <span class="code">L-3</span>, <span class="code">15W</span>, <span class="code">LW</span>,
                    <span class="code">FRIL</span>, <span class="code">MON#2</span>, names like <span class="code">JAN</span> and the macros
                    <template v-for="[m] in macroList" :key="m"><span class="code">{{ m }}</span>&#32;</template>.
                    Unlike Unix cron, when both day fields are restricted a day must match both.
                </p>
                <p v-else class="text-xs text-muted">5 fields (minute hour day-of-month month day-of-week) or 6 fields with a leading seconds field.</p>
            </div>
        </Panel>

        <div class="grid gap-4 lg:grid-cols-2">
            <div class="flex min-w-0 flex-col gap-4">
                <Panel title="Field breakdown" flush>
                    <p v-if="!breakdown.length" class="p-4 text-sm text-muted">Enter a valid expression to see its fields.</p>
                    <div v-else class="overflow-x-auto">
                        <table class="w-full text-sm">
                            <thead class="text-left text-xs text-muted uppercase">
                                <tr><th class="px-4 py-2 font-medium">Field</th><th class="px-2 py-2 font-medium">Value</th><th class="px-4 py-2 font-medium">Meaning</th></tr>
                            </thead>
                            <tbody class="divide-y divide-line border-t border-line">
                                <tr v-for="f in breakdown" :key="f.name">
                                    <td class="px-4 py-2 whitespace-nowrap">{{ f.name }}<div class="text-xs text-muted">{{ f.range }}</div></td>
                                    <td class="px-2 py-2"><span class="code">{{ f.value }}</span></td>
                                    <td class="px-4 py-2">{{ f.meaning }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </Panel>

                <Panel title="Visual builder">
                    <p class="mb-3 text-xs text-muted">{{ isSpring ? "Editing here rewrites the expression above, with 0 in the seconds field." : "Editing here rewrites the 5-field expression above." }}</p>
                    <div class="flex flex-col gap-3">
                        <div v-for="(d, i) in fieldDefs5" :key="d.name" class="grid items-center gap-2 sm:grid-cols-[7rem_9rem_1fr]">
                            <span class="text-sm font-medium">{{ d.name }}</span>
                            <select v-model="builder[i].mode" class="select" :aria-label="`${d.name} mode`">
                                <option v-for="m in modeLabels" :key="m.value" :value="m.value">{{ m.label }}</option>
                            </select>
                            <div class="flex min-w-0 items-center gap-2">
                                <template v-if="builder[i].mode === 'step'">
                                    <input v-model="builder[i].step" type="number" min="1" class="input" aria-label="Step" />
                                    <span class="text-xs whitespace-nowrap text-muted">from</span>
                                    <input v-model="builder[i].start" class="input" placeholder="*" aria-label="Start" />
                                </template>
                                <template v-else-if="builder[i].mode === 'range'">
                                    <input v-model="builder[i].from" type="number" :min="d.min" :max="d.max" class="input" :placeholder="String(d.min)" aria-label="From" />
                                    <span class="text-xs text-muted">to</span>
                                    <input v-model="builder[i].to" type="number" :min="d.min" :max="d.max" class="input" :placeholder="String(d.max)" aria-label="To" />
                                </template>
                                <input v-else-if="builder[i].mode === 'list'" v-model="builder[i].list" class="input" :placeholder="`e.g. ${d.min},${d.min + 1}`" aria-label="Values" />
                                <span v-else class="text-xs text-muted">{{ d.range }}</span>
                            </div>
                        </div>
                    </div>
                </Panel>
            </div>

            <div class="flex min-w-0 flex-col gap-4">
            <Panel :title="`Next ${runCount} runs`" flush>
                <template #actions>
                    <select v-model.number="runCount" class="select !h-7 !w-auto !py-0 text-xs" aria-label="Number of runs">
                        <option :value="5">5</option>
                        <option :value="10">10</option>
                        <option :value="25">25</option>
                    </select>
                    <select v-model="tz" class="select !h-7 !w-auto max-w-48 !py-0 text-xs" aria-label="Time zone">
                        <option value="local">Local ({{ localTz }})</option>
                        <option value="UTC">UTC</option>
                        <option v-for="z in zones" :key="z" :value="z">{{ z }}</option>
                    </select>
                </template>
                <div v-if="runs.error" class="p-4"><Notice type="error">{{ runs.error }}</Notice></div>
                <p v-else-if="!runs.items.length" class="p-4 text-sm text-muted">No upcoming runs.</p>
                <ol v-else class="divide-y divide-line">
                    <li v-for="(r, i) in runs.items" :key="i" class="flex items-center gap-3 px-4 py-2.5">
                        <span class="w-5 text-right text-xs text-muted tabular-nums">{{ i + 1 }}</span>
                        <span class="min-w-0 flex-1 font-mono text-sm">{{ r.when }}</span>
                        <span class="text-xs whitespace-nowrap text-muted">{{ r.rel }}</span>
                    </li>
                </ol>
                <div class="border-t border-line px-4 py-2">
                    <Btn size="sm" variant="ghost" @click="tz = 'UTC'">Use UTC</Btn>
                </div>
            </Panel>

            <Panel v-if="isSpring" title="@Scheduled" flush>
                <template #actions>
                    <label class="flex items-center gap-1.5 text-xs text-fg-muted"><input v-model="withZone" type="checkbox" class="checkbox" /> zone</label>
                    <CopyButton :text="scheduled" />
                </template>
                <CodeBlock :code="scheduled" language="java" />
                <p class="border-t border-line px-4 py-2 text-xs text-muted">
                    Needs <span class="code">@EnableScheduling</span> on a configuration class. Without <span class="code">zone</span>, the server's default time zone is used. To make it configurable, use
                    <span class="code">cron = "${app.jobs.my-job.cron}"</span> and set the expression in application.yml.
                </p>
            </Panel>
            </div>
        </div>
    </ToolPage>
</template>
