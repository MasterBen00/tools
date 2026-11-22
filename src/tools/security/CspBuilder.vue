<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useStorage } from "@vueuse/core";
import { AlertCircle, Download, Info, RotateCcw, TriangleAlert, X } from "lucide-vue-next";
import { Btn, CodeArea, CodeBlock, CopyButton, Notice, Panel, Tabs, ToolPage } from "@/components/ui";
import { useHandoff } from "@/composables/handoff";

type Kind = "sources" | "flag" | "tokens";
interface Def {
    name: string;
    kind: Kind;
    desc: string;
    keywords: string[];
    placeholder?: string;
    note?: string;
}
const SRC = ["'self'", "'none'", "'unsafe-inline'", "'unsafe-eval'", "'strict-dynamic'", "'wasm-unsafe-eval'", "'unsafe-hashes'", "data:", "blob:", "https:"];
const SIMPLE = ["'self'", "'none'", "https:"];
const DEFS: Def[] = [
    { name: "default-src", kind: "sources", desc: "Fallback for every *-src directive that is not set.", keywords: SRC },
    { name: "script-src", kind: "sources", desc: "JavaScript: <script>, inline handlers, eval, workers fallback.", keywords: SRC, placeholder: "'nonce-…' 'sha256-…' https://cdn.example.com" },
    { name: "style-src", kind: "sources", desc: "Stylesheets and inline <style> / style attributes.", keywords: SRC },
    { name: "img-src", kind: "sources", desc: "Images and favicons.", keywords: SRC },
    { name: "font-src", kind: "sources", desc: "Web fonts loaded with @font-face.", keywords: SRC },
    { name: "connect-src", kind: "sources", desc: "fetch, XHR, WebSocket, EventSource, sendBeacon.", keywords: SRC, placeholder: "https://api.example.com wss://api.example.com" },
    { name: "media-src", kind: "sources", desc: "<audio> and <video>.", keywords: SRC },
    { name: "object-src", kind: "sources", desc: "<object> / <embed> plugins. Set to 'none'.", keywords: SRC },
    { name: "frame-src", kind: "sources", desc: "Pages this page may embed in <iframe>.", keywords: SRC },
    { name: "frame-ancestors", kind: "sources", desc: "Who may embed THIS page in a frame (clickjacking).", keywords: SIMPLE, note: "Ignored in <meta>." },
    { name: "worker-src", kind: "sources", desc: "Web workers and service workers.", keywords: SRC },
    { name: "manifest-src", kind: "sources", desc: "The web app manifest.", keywords: SIMPLE },
    { name: "base-uri", kind: "sources", desc: "Allowed values for <base href>. Prevents base-tag hijacking.", keywords: SIMPLE },
    { name: "form-action", kind: "sources", desc: "Where forms may be submitted.", keywords: SIMPLE },
    { name: "upgrade-insecure-requests", kind: "flag", keywords: [], desc: "Rewrite http:// subresource URLs to https:// before fetching." },
    { name: "block-all-mixed-content", kind: "flag", keywords: [], desc: "Deprecated: browsers already block mixed content. Use upgrade-insecure-requests.", note: "Deprecated" },
    { name: "report-uri", kind: "tokens", desc: "URL that receives violation reports (deprecated but still the most widely supported).", keywords: [], placeholder: "/csp-report", note: "Ignored in <meta>." },
    { name: "report-to", kind: "tokens", desc: "Reporting API group name, defined in a Reporting-Endpoints header.", keywords: [], placeholder: "csp-endpoint", note: "Ignored in <meta>." },
    { name: "require-trusted-types-for", kind: "tokens", desc: "Require Trusted Types for DOM XSS sinks like innerHTML.", keywords: ["'script'"] },
    { name: "trusted-types", kind: "tokens", desc: "Names of Trusted Types policies the page may create.", keywords: ["'none'", "'allow-duplicates'"], placeholder: "default dompurify" },
];
const DEF = new Map(DEFS.map((d) => [d.name, d]));
const META_IGNORED = ["frame-ancestors", "report-uri", "report-to", "sandbox"];

interface DirState {
    on: boolean;
    sources: string[];
}
interface CspState {
    dirs: Record<string, DirState>;
    reportOnly: boolean;
    extra: string[];
}

function makeState(policy: Record<string, string[]>, reportOnly = false): CspState {
    return {
        dirs: Object.fromEntries(DEFS.map((d) => [d.name, { on: d.name in policy, sources: policy[d.name] ?? [] }])),
        reportOnly,
        extra: [],
    };
}
const PRESETS: { id: string; label: string; make: () => CspState }[] = [
    {
        id: "strict",
        label: "Strict (nonce + strict-dynamic)",
        make: () => makeState({ "script-src": ["'nonce-{RANDOM}'", "'strict-dynamic'", "https:", "'unsafe-inline'"], "object-src": ["'none'"], "base-uri": ["'none'"], "frame-ancestors": ["'self'"] }),
    },
    {
        id: "basic",
        label: "Basic same-origin",
        make: () => makeState({ "default-src": ["'self'"], "img-src": ["'self'", "data:"], "object-src": ["'none'"], "base-uri": ["'self'"], "form-action": ["'self'"], "frame-ancestors": ["'self'"], "upgrade-insecure-requests": [] }),
    },
    {
        id: "spa",
        label: "SPA + API + Google Fonts",
        make: () =>
            makeState({
                "default-src": ["'self'"],
                "script-src": ["'self'"],
                "style-src": ["'self'", "https://fonts.googleapis.com"],
                "font-src": ["'self'", "https://fonts.gstatic.com"],
                "img-src": ["'self'", "data:", "blob:"],
                "connect-src": ["'self'", "https://api.example.com", "wss://api.example.com"],
                "object-src": ["'none'"],
                "base-uri": ["'self'"],
                "form-action": ["'self'"],
                "frame-ancestors": ["'none'"],
                "upgrade-insecure-requests": [],
            }),
    },
    { id: "none", label: "Allow nothing", make: () => makeState({ "default-src": ["'none'"], "base-uri": ["'none'"], "form-action": ["'none'"], "frame-ancestors": ["'none'"] }) },
    {
        id: "report",
        label: "Report-only start",
        make: () => makeState({ "default-src": ["'self'"], "object-src": ["'none'"], "base-uri": ["'self'"], "report-uri": ["/csp-report"], "report-to": ["csp-endpoint"] }, true),
    },
];

const state = useStorage<CspState>("devtools:csp-builder:state", PRESETS[2]!.make(), undefined, { mergeDefaults: (stored, defaults) => ({ ...defaults, ...stored, dirs: { ...defaults.dirs, ...stored.dirs } }) });
const drafts = reactive<Record<string, string>>({});
const outTab = useStorage<"header" | "meta" | "nginx" | "apache" | "spring" | "helmet">("devtools:csp-builder:out", "header");
const parseText = ref("");
const parseMsg = ref("");

const KW_RE = /^(self|none|unsafe-inline|unsafe-eval|strict-dynamic|wasm-unsafe-eval|unsafe-hashes|report-sample|script|allow-duplicates|nonce-.+|sha(256|384|512)-.+)$/i;
const norm = (t: string) => (KW_RE.test(t) ? `'${t}'` : t);

function dir(name: string): DirState {
    return (state.value.dirs[name] ??= { on: false, sources: [] });
}
function toggleKeyword(name: string, kw: string) {
    const d = dir(name);
    d.on = true;
    if (d.sources.includes(kw)) d.sources = d.sources.filter((s) => s !== kw);
    else d.sources = kw === "'none'" ? ["'none'"] : [...d.sources.filter((s) => s !== "'none'"), kw];
}
function addDraft(name: string) {
    const tokens = (drafts[name] ?? "").split(/[\s,]+/).filter(Boolean).map(norm);
    if (!tokens.length) return;
    const d = dir(name);
    d.on = true;
    d.sources = [...d.sources.filter((s) => !(s === "'none'" && tokens.length)), ...tokens.filter((t) => !d.sources.includes(t))];
    drafts[name] = "";
}
function removeSource(name: string, s: string) {
    dir(name).sources = dir(name).sources.filter((x) => x !== s);
}
function applyPreset(id: string) {
    const p = PRESETS.find((x) => x.id === id);
    if (p) state.value = p.make();
}

// ---------- output ----------
const enabled = computed(() => DEFS.filter((d) => state.value.dirs[d.name]?.on));
const parts = computed(() => {
    const out: { name: string; text: string }[] = [];
    for (const d of enabled.value) {
        const s = state.value.dirs[d.name]!.sources;
        if (d.kind === "flag") out.push({ name: d.name, text: d.name });
        else if (s.length) out.push({ name: d.name, text: `${d.name} ${s.join(" ")}` });
    }
    for (const e of state.value.extra) out.push({ name: e.split(/\s+/)[0]!.toLowerCase(), text: e });
    return out;
});
const policy = computed(() => parts.value.map((p) => p.text).join("; "));
const metaPolicy = computed(() => parts.value.filter((p) => !META_IGNORED.includes(p.name)).map((p) => p.text).join("; "));
const headerName = computed(() => (state.value.reportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy"));
const reportToGroup = computed(() => (state.value.dirs["report-to"]?.on ? state.value.dirs["report-to"].sources[0] : undefined));

const camel = (s: string) => s.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
const snippet = computed(() => {
    const p = policy.value;
    switch (outTab.value) {
        case "header":
            return `${headerName.value}: ${p}` + (reportToGroup.value ? `\nReporting-Endpoints: ${reportToGroup.value}="https://example.com/csp-reports"` : "");
        case "meta":
            return `<meta http-equiv="Content-Security-Policy" content="${metaPolicy.value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">`;
        case "nginx":
            return `add_header ${headerName.value} "${p.replace(/"/g, '\\"')}" always;` + (reportToGroup.value ? `\nadd_header Reporting-Endpoints '${reportToGroup.value}="https://example.com/csp-reports"' always;` : "");
        case "apache":
            return `Header always set ${headerName.value} "${p.replace(/"/g, '\\"')}"` + (reportToGroup.value ? `\nHeader always set Reporting-Endpoints '${reportToGroup.value}="https://example.com/csp-reports"'` : "");
        case "spring": {
            const lines = parts.value.map((x) => `                        ${JSON.stringify(x.text)}`).join(",\n");
            return `@Bean
SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
    http.headers(headers -> headers
            .contentSecurityPolicy(csp -> csp
                    .policyDirectives(String.join("; ",
${lines}))${state.value.reportOnly ? "\n                    .reportOnly()" : ""}));
    return http.build();
}`;
        }
        case "helmet": {
            const body = parts.value
                .map((x) => {
                    const [name, ...vals] = x.text.split(/\s+/);
                    return `      ${camel(name!)}: [${vals.map((v) => JSON.stringify(v)).join(", ")}],`;
                })
                .join("\n");
            return `import helmet from "helmet";

app.use(
  helmet.contentSecurityPolicy({
    useDefaults: false,
    reportOnly: ${state.value.reportOnly},
    directives: {
${body}
    },
  }),
);`;
        }
    }
    return "";
});
const snippetLang = computed(() => ({ header: "http", meta: "xml", nginx: "nginx", apache: "apache", spring: "java", helmet: "javascript" })[outTab.value]);

// ---------- warnings ----------
interface Warn {
    level: "error" | "warn" | "info";
    text: string;
}
const warnings = computed<Warn[]>(() => {
    const w: Warn[] = [];
    const on = (n: string) => !!state.value.dirs[n]?.on;
    const src = (n: string) => (on(n) ? (state.value.dirs[n]?.sources ?? []) : null);
    const effScript = src("script-src") ?? src("default-src");
    const hasNonceHash = (effScript ?? []).some((s) => /^'(nonce-|sha(256|384|512)-)/i.test(s));
    if (!parts.value.length) w.push({ level: "error", text: "The policy is empty." });
    if (!on("default-src") && !on("script-src")) w.push({ level: "warn", text: "Neither default-src nor script-src is set: scripts are unrestricted." });
    if (effScript) {
        const strictDyn = effScript.includes("'strict-dynamic'");
        if (effScript.includes("'unsafe-inline'")) w.push(hasNonceHash ? { level: "info", text: "'unsafe-inline' in script-src is ignored by modern browsers because a nonce or hash is present (kept as a fallback for old browsers)." } : { level: "warn", text: "'unsafe-inline' in script-src allows inline scripts, which defeats most XSS protection. Use nonces or hashes." });
        if (effScript.includes("'unsafe-eval'")) w.push({ level: "warn", text: "'unsafe-eval' allows eval() and new Function(). Prefer 'wasm-unsafe-eval' if you only need WebAssembly." });
        const wild = effScript.filter((s) => s === "*" || s === "https:" || s === "http:" || s === "data:" || s === "blob:");
        if (wild.length && !strictDyn) w.push({ level: "warn", text: `script-src allows ${wild.join(", ")}: an attacker can load script from almost anywhere.` });
        if (strictDyn && !hasNonceHash) w.push({ level: "warn", text: "'strict-dynamic' without a nonce or hash blocks every script." });
        if (effScript.some((s) => /^http:/i.test(s) && s !== "http:")) w.push({ level: "warn", text: "Script hosts over plain http: can be tampered with in transit." });
        if (effScript.some((s) => /nonce-\{?RANDOM\}?/i.test(s))) w.push({ level: "info", text: "Replace {RANDOM} with a fresh, unguessable nonce on every response and put the same value in nonce attributes." });
    }
    if ((effScript ?? []).includes("'unsafe-hashes'")) w.push({ level: "info", text: "'unsafe-hashes' permits inline event handlers matching a hash; refactor to addEventListener when you can." });
    if (!on("object-src") && !(src("default-src") ?? []).includes("'none'")) w.push({ level: "warn", text: "Set object-src 'none' to block plugin-based script execution." });
    if (!on("base-uri")) w.push({ level: "warn", text: "Set base-uri 'self' (or 'none'): without it, an injected <base> tag can redirect relative script URLs." });
    if (!on("frame-ancestors")) w.push({ level: "info", text: "No frame-ancestors: any site can frame this page (clickjacking) unless X-Frame-Options is sent." });
    if (!on("form-action")) w.push({ level: "info", text: "No form-action: injected forms can post data to any site (form-action does not fall back to default-src)." });
    for (const d of enabled.value) {
        const s = state.value.dirs[d.name]!.sources;
        if (d.kind !== "flag" && !s.length) w.push({ level: "warn", text: `${d.name} is enabled but has no sources, so it is left out.` });
        if (s.includes("'none'") && s.length > 1) w.push({ level: "error", text: `${d.name} combines 'none' with other sources; 'none' must be the only value.` });
        if (s.includes("*") && d.name !== "img-src") w.push({ level: "warn", text: `${d.name} uses the * wildcard.` });
    }
    if (on("block-all-mixed-content")) w.push({ level: "info", text: "block-all-mixed-content is deprecated; browsers block mixed content by default." });
    if (on("report-uri") && !on("report-to")) w.push({ level: "info", text: "report-uri is deprecated: add report-to as well (browsers that support it ignore report-uri)." });
    if (on("report-to")) w.push({ level: "info", text: "report-to needs a matching Reporting-Endpoints response header (shown in the header output)." });
    if (state.value.reportOnly && !on("report-uri") && !on("report-to")) w.push({ level: "info", text: "Report-Only without report-uri/report-to only logs violations in the browser console." });
    if (outTab.value === "meta") {
        const ignored = parts.value.filter((p) => META_IGNORED.includes(p.name)).map((p) => p.name);
        if (ignored.length) w.push({ level: "info", text: `<meta> ignores ${ignored.join(", ")}; they are left out of the meta tag. Send them as a header.` });
        if (state.value.reportOnly) w.push({ level: "warn", text: "Report-Only cannot be delivered with <meta>; the meta tag enforces the policy." });
    }
    return w;
});

// ---------- parse ----------
function parsePolicy() {
    let text = parseText.value.trim();
    const ro = /^content-security-policy-report-only\s*:/i.test(text);
    text = text.replace(/^content-security-policy(-report-only)?\s*:\s*/i, "").replace(/^<meta[^>]*content=["']([^"']*)["'][^>]*>$/i, "$1");
    if (!text) return;
    const policyMap: Record<string, string[]> = {};
    const extra: string[] = [];
    for (const part of text.split(";")) {
        const [rawName, ...vals] = part.trim().split(/\s+/);
        if (!rawName) continue;
        const name = rawName.toLowerCase();
        if (DEF.has(name)) {
            if (!(name in policyMap)) policyMap[name] = vals;
        } else extra.push(part.trim());
    }
    const s = makeState(policyMap, ro || state.value.reportOnly);
    s.extra = extra;
    state.value = s;
    parseMsg.value = `Loaded ${Object.keys(policyMap).length} directive(s)${extra.length ? `; kept ${extra.length} unsupported directive(s) as-is: ${extra.map((e) => e.split(/\s+/)[0]).join(", ")}` : ""}.`;
}

useHandoff<{ input?: string }>("csp-builder", (p) => {
    if (p.input) {
        parseText.value = p.input;
        parsePolicy();
    }
});

const chipClass = (active: boolean) => (active ? "bg-accent-soft text-accent ring-accent/40" : "hover:text-fg");
const warnClass = (l: Warn["level"]) => (l === "error" ? "text-danger" : l === "warn" ? "text-warn" : "text-info");
</script>

<template>
    <ToolPage>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span class="text-muted">Presets:</span>
            <Btn v-for="p in PRESETS" :key="p.id" size="sm" variant="secondary" @click="applyPreset(p.id)">{{ p.label }}</Btn>
            <label class="ml-auto flex items-center gap-2"><input v-model="state.reportOnly" type="checkbox" class="checkbox" /> Report-Only</label>
        </div>

        <div class="grid items-start gap-4 lg:grid-cols-2">
            <Panel title="Directives" flush>
                <ul class="divide-y divide-line">
                    <li v-for="d in DEFS" :key="d.name" class="px-4 py-3" :class="state.dirs[d.name]?.on ? '' : 'opacity-75'">
                        <label class="flex cursor-pointer items-start gap-2.5">
                            <input v-model="dir(d.name).on" type="checkbox" class="checkbox mt-0.5" />
                            <span class="min-w-0">
                                <span class="font-mono text-[13px] font-semibold text-fg">{{ d.name }}</span>
                                <span v-if="d.note" class="chip ml-2">{{ d.note }}</span>
                                <span class="block text-xs text-muted">{{ d.desc }}</span>
                            </span>
                        </label>
                        <div v-if="d.kind !== 'flag' && state.dirs[d.name]?.on" class="mt-2 space-y-2 pl-6.5">
                            <div v-if="d.keywords.length" class="flex flex-wrap gap-1">
                                <button v-for="k in d.keywords" :key="k" type="button" class="chip cursor-pointer" :class="chipClass(dir(d.name).sources.includes(k))" @click="toggleKeyword(d.name, k)">{{ k }}</button>
                            </div>
                            <div v-if="dir(d.name).sources.filter((s) => !d.keywords.includes(s)).length" class="flex flex-wrap gap-1">
                                <span v-for="s in dir(d.name).sources.filter((x) => !d.keywords.includes(x))" :key="s" class="chip text-fg">
                                    {{ s }}
                                    <button type="button" class="cursor-pointer text-fg-subtle hover:text-danger" :aria-label="`Remove ${s}`" @click="removeSource(d.name, s)"><X class="size-3" /></button>
                                </span>
                            </div>
                            <input
                                v-model="drafts[d.name]"
                                class="input h-8 py-1 font-mono text-[12px]"
                                :placeholder="d.placeholder ?? 'https://cdn.example.com *.example.com nonce-… sha256-…'"
                                :aria-label="`Add sources to ${d.name}`"
                                @keydown.enter.prevent="addDraft(d.name)"
                                @blur="addDraft(d.name)"
                            />
                        </div>
                    </li>
                </ul>
                <div v-if="state.extra.length" class="border-t border-line px-4 py-3 text-xs">
                    <span class="text-muted">Kept from the parsed policy:</span>
                    <span v-for="(e, k) in state.extra" :key="k" class="chip m-0.5">
                        {{ e }}
                        <button type="button" class="cursor-pointer hover:text-danger" aria-label="Remove" @click="state.extra.splice(k, 1)"><X class="size-3" /></button>
                    </span>
                </div>
            </Panel>

            <div class="min-w-0 space-y-4 lg:sticky lg:top-4">
                <Panel title="Policy" flush>
                    <template #actions><CopyButton :text="policy" /></template>
                    <p class="p-4 font-mono text-[12px] break-all text-fg">{{ policy || "(empty)" }}</p>
                </Panel>
                <Panel flush>
                    <template #title>
                        <Tabs
                            v-model="outTab"
                            size="sm"
                            :options="[
                                { value: 'header', label: 'Header' },
                                { value: 'meta', label: 'Meta' },
                                { value: 'nginx', label: 'Nginx' },
                                { value: 'apache', label: 'Apache' },
                                { value: 'spring', label: 'Spring Security' },
                                { value: 'helmet', label: 'Express' },
                            ]"
                        />
                    </template>
                    <template #actions><CopyButton :text="snippet" /></template>
                    <div class="overflow-x-auto p-4"><CodeBlock :code="snippet" :language="snippetLang" /></div>
                </Panel>
                <Panel title="Review">
                    <p v-if="!warnings.length" class="text-sm text-success">No obvious problems.</p>
                    <ul v-else class="space-y-1.5">
                        <li v-for="(w, k) in warnings" :key="k" class="flex items-start gap-2 text-[13px]">
                            <AlertCircle v-if="w.level === 'error'" class="mt-0.5 size-4 shrink-0" :class="warnClass(w.level)" />
                            <TriangleAlert v-else-if="w.level === 'warn'" class="mt-0.5 size-4 shrink-0" :class="warnClass(w.level)" />
                            <Info v-else class="mt-0.5 size-4 shrink-0" :class="warnClass(w.level)" />
                            <span>{{ w.text }}</span>
                        </li>
                    </ul>
                </Panel>
                <Panel title="Parse existing policy" flush>
                    <template #actions>
                        <Btn size="sm" variant="ghost" :disabled="!parseText.trim()" @click="parsePolicy"><Download /> Load into builder</Btn>
                        <Btn size="sm" variant="ghost" title="Reset to the SPA preset" @click="applyPreset('spa')"><RotateCcw /> Reset</Btn>
                    </template>
                    <CodeArea v-model="parseText" height="6rem" placeholder="Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.example.com" />
                    <div v-if="parseMsg" class="px-4 pb-3"><Notice type="success">{{ parseMsg }}</Notice></div>
                </Panel>
            </div>
        </div>
    </ToolPage>
</template>
