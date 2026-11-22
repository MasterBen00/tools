<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStorage } from "@vueuse/core";
import { ArrowDown, ArrowRightLeft, ArrowUp, ClipboardPaste, Eraser, Info, Plus, Sparkles, Trash2, TriangleAlert, X } from "lucide-vue-next";
import { Btn, CodeArea, CodeBlock, CopyButton, Field, Notice, Panel, ToolPage } from "@/components/ui";
import { readClipboard } from "@/composables/useClipboard";
import { useHandoff } from "@/composables/handoff";

const SAMPLE =
    "https://shop.example.com:8443/de/kategorie/Herren%20Schuhe/trail-runner-3?color=forest%20green&size=44&size=45&q=caf%C3%A9+au+lait&utm_source=newsletter&utm_medium=email&utm_campaign=spring_sale_2026&fbclid=IwAR2xYz123&ref=home#/reviews?sort=newest&page=2";

const input = useStorage("devtools:url-parser:input", SAMPLE);
const encodedView = ref(false);
const plusSpaces = ref(false);

useHandoff<{ input?: string }>("url-parser", (p) => {
    if (p.input != null) input.value = p.input;
});

// ---------- punycode (RFC 3492 decode) ----------
function punyDecode(s: string): string {
    const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
    const adapt = (delta: number, points: number, first: boolean) => {
        delta = first ? Math.floor(delta / damp) : delta >> 1;
        delta += Math.floor(delta / points);
        let k = 0;
        while (delta > ((base - tMin) * tMax) >> 1) {
            delta = Math.floor(delta / (base - tMin));
            k += base;
        }
        return k + Math.floor(((base - tMin + 1) * delta) / (delta + skew));
    };
    const out: number[] = [];
    let n = 128, i = 0, bias = 72;
    const basic = Math.max(0, s.lastIndexOf("-"));
    for (let j = 0; j < basic; j++) out.push(s.charCodeAt(j));
    for (let idx = basic > 0 ? basic + 1 : 0; idx < s.length; ) {
        const oldi = i;
        let w = 1;
        for (let k = base; ; k += base) {
            if (idx >= s.length) throw new Error("bad punycode");
            const cp = s.charCodeAt(idx++);
            const digit = cp >= 48 && cp <= 57 ? cp - 22 : cp >= 65 && cp <= 90 ? cp - 65 : cp >= 97 && cp <= 122 ? cp - 97 : base;
            if (digit >= base) throw new Error("bad punycode");
            i += digit * w;
            const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
            if (digit < t) break;
            w *= base - t;
        }
        const len = out.length + 1;
        bias = adapt(i - oldi, len, oldi === 0);
        n += Math.floor(i / len);
        i %= len;
        out.splice(i++, 0, n);
    }
    return String.fromCodePoint(...out);
}
const toUnicodeHost = (h: string) =>
    h
        .split(".")
        .map((l) => {
            if (!/^xn--/i.test(l)) return l;
            try {
                return punyDecode(l.slice(4));
            } catch {
                return l;
            }
        })
        .join(".");

// ---------- model ----------
const safeDecode = (s: string, plus = false) => {
    try {
        return decodeURIComponent(plus ? s.replace(/\+/g, " ") : s);
    } catch {
        return s;
    }
};
const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443", "ws:": "80", "wss:": "443", "ftp:": "21" };

interface Seg { id: number; value: string }
interface QP { id: number; key: string; value: string; noEq: boolean; bad: boolean }
let nextId = 1;
const parts = ref({
    protocol: "",
    username: "",
    password: "",
    hostname: "",
    port: "",
    opaque: false,
    opaquePath: "",
    segments: [] as Seg[],
    params: [] as QP[],
    hash: null as string | null,
});
const parseError = ref("");
const assumedScheme = ref(false);
const rawQuery = ref<string | null>(null);

function parseQuery(q: string): QP[] {
    return q
        .split("&")
        .filter((p) => p !== "")
        .map((p) => {
            const i = p.indexOf("=");
            const k = i < 0 ? p : p.slice(0, i);
            const v = i < 0 ? "" : p.slice(i + 1);
            return { id: nextId++, key: safeDecode(k, true), value: safeDecode(v, true), noEq: i < 0, bad: !decodable(k) || !decodable(v) };
        });
}
function decodable(s: string) {
    try {
        decodeURIComponent(s.replace(/\+/g, " "));
        return true;
    } catch {
        return false;
    }
}

function parse(text: string) {
    let t = text.trim();
    parseError.value = "";
    assumedScheme.value = false;
    if (!t) return;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(t)) {
        t = "https://" + t;
        assumedScheme.value = true;
    }
    let u: URL;
    try {
        u = new URL(t);
    } catch {
        parseError.value = "Not a valid URL.";
        return;
    }
    const hashIdx = t.indexOf("#");
    const beforeHash = hashIdx < 0 ? t : t.slice(0, hashIdx);
    const qIdx = beforeHash.indexOf("?");
    rawQuery.value = qIdx < 0 ? null : beforeHash.slice(qIdx + 1);
    parts.value.protocol = u.protocol;
    parts.value.username = safeDecode(u.username);
    parts.value.password = safeDecode(u.password);
    parts.value.hostname = toUnicodeHost(u.hostname);
    parts.value.port = u.port || (/:(\d+)(?=[/?#]|$)/.exec(beforeHash.replace(/^[^/]*\/\/[^/]*@/, ""))?.[1] ?? "");
    parts.value.opaque = !u.host && !/^[a-z][a-z0-9+.-]*:\/\//i.test(t);
    parts.value.opaquePath = parts.value.opaque ? u.pathname : "";
    parts.value.segments = parts.value.opaque ? [] : u.pathname.replace(/^\//, "").split("/").map((v) => ({ id: nextId++, value: safeDecode(v) }));
    parts.value.params = rawQuery.value === null ? [] : parseQuery(rawQuery.value);
    parts.value.hash = hashIdx < 0 ? null : t.slice(hashIdx + 1);
    plusSpaces.value = /\+/.test(rawQuery.value ?? "") && !/%20/.test(rawQuery.value ?? "");
}
watch(input, parse, { immediate: true });

// ---------- encode / rebuild ----------
const encSeg = (s: string) => encodeURIComponent(s).replace(/%(24|26|2B|2C|3B|3D|3A|40)/gi, (m) => decodeURIComponent(m));
const encQ = (s: string) => {
    const e = encodeURIComponent(s).replace(/%(3A|2F|40|2C|3F)/gi, (m) => decodeURIComponent(m));
    return plusSpaces.value ? e.replace(/%20/g, "+") : e;
};
const queryString = computed(() => parts.value.params.map((p) => (p.noEq && !p.value ? encQ(p.key) : `${encQ(p.key)}=${encQ(p.value)}`)).join("&"));
const rebuilt = computed(() => {
    if (!input.value.trim() || parseError.value) return "";
    let s = parts.value.protocol;
    if (parts.value.opaque) s += parts.value.opaquePath;
    else {
        s += "//";
        if (parts.value.username || parts.value.password) s += encodeURIComponent(parts.value.username) + (parts.value.password ? ":" + encodeURIComponent(parts.value.password) : "") + "@";
        s += parts.value.hostname;
        if (parts.value.port) s += ":" + parts.value.port;
        s += "/" + parts.value.segments.map((x) => encSeg(x.value)).join("/");
    }
    if (parts.value.params.length) s += "?" + queryString.value;
    else if (rawQuery.value !== null && rawQuery.value === "") s += "?";
    if (parts.value.hash !== null) s += "#" + parts.value.hash;
    return s;
});
const normalized = computed(() => {
    try {
        return new URL(rebuilt.value);
    } catch {
        return null;
    }
});

const queryJson = computed(() => {
    const out: Record<string, string | string[]> = {};
    for (const p of parts.value.params) {
        const cur = out[p.key];
        if (cur === undefined) out[p.key] = p.value;
        else out[p.key] = Array.isArray(cur) ? [...cur, p.value] : [cur, p.value];
    }
    return JSON.stringify(out, null, 2);
});

const hashRoute = computed(() => {
    const h = parts.value.hash;
    if (!h) return null;
    const m = /^(!?\/[^?]*)(?:\?(.*))?$/.exec(h);
    if (!m) return null;
    return { path: safeDecode(m[1]!), params: m[2] ? parseQuery(m[2]) : [] };
});

// ---------- warnings ----------
const TRACKING = /^(utm_[a-z_]+|fbclid|gclid|gclsrc|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|_ga|_gl|igshid|yclid|twclid|ttclid|li_fat_id|s_cid|mkt_tok|vero_id|_hsenc|_hsmi|oly_anon_id|oly_enc_id|rb_clickid|epik|srsltid|ref_src)$/i;
const isTracking = (key: string) => TRACKING.test(key);
const defaultPort = (protocol: string) => DEFAULT_PORTS[protocol] ?? "";
const tracking = computed(() => parts.value.params.filter((p) => TRACKING.test(p.key)));
function stripTracking() {
    parts.value.params = parts.value.params.filter((p) => !TRACKING.test(p.key));
}

interface Warn { level: "warn" | "info"; text: string }
const warnings = computed<Warn[]>(() => {
    const w: Warn[] = [];
    if (!input.value.trim() || parseError.value) return w;
    if (assumedScheme.value) w.push({ level: "info", text: "No scheme given, so https:// was assumed." });
    if (parts.value.username || parts.value.password) w.push({ level: "warn", text: "Credentials in the URL: they end up in logs, browser history and Referer headers. Browsers block them in subresource requests." });
    if (parts.value.protocol === "http:" || parts.value.protocol === "ws:") w.push({ level: "warn", text: `${parts.value.protocol}// is unencrypted: use ${parts.value.protocol === "http:" ? "https" : "wss"}://.` });
    const ascii = normalized.value?.hostname ?? "";
    if (/(^|\.)xn--/i.test(ascii) || /[^\x00-\x7f]/.test(parts.value.hostname)) w.push({ level: "info", text: `Internationalised domain: ${parts.value.hostname} is sent as ${ascii}. Check for look-alike characters (homograph attacks).` });
    if (parts.value.port && DEFAULT_PORTS[parts.value.protocol] === parts.value.port) w.push({ level: "info", text: `Port ${parts.value.port} is the default for ${parts.value.protocol.slice(0, -1)} and can be omitted.` });
    if (tracking.value.length) w.push({ level: "info", text: `${tracking.value.length} tracking parameter(s): ${[...new Set(tracking.value.map((p) => p.key))].join(", ")}.` });
    const dupes = [...new Set(parts.value.params.map((p) => p.key).filter((k, i, a) => a.indexOf(k) !== i))];
    if (dupes.length) w.push({ level: "info", text: `Repeated parameter(s) ${dupes.join(", ")}: frameworks differ (Spring binds all values to a List, many others keep the first or last).` });
    if (parts.value.params.some((p) => p.bad)) w.push({ level: "warn", text: "Malformed percent-encoding in the query (a % not followed by two hex digits)." });
    const rq = rawQuery.value ?? "";
    if (/\+/.test(rq) && /%20/i.test(rq)) w.push({ level: "warn", text: "Mixed space encoding: both + and %20 are used in the query." });
    const raw = input.value.trim();
    if (/%[0-9a-f]{2}/i.test(raw) && /[\s"<>^`{|}]|[^\x00-\x7f]/.test(raw.replace(/#.*$/, "").replace(/^[^/]*\/\/[^/?#]*/, ""))) w.push({ level: "warn", text: "Mixed encoding: some characters are percent-encoded while others (spaces, non-ASCII, quotes) are not." });
    if (hashRoute.value?.params.length) w.push({ level: "info", text: "The fragment contains its own query (hash routing). It is never sent to the server; only the client-side router sees it." });
    if (rebuilt.value.length > 2000) w.push({ level: "info", text: `${rebuilt.value.length} characters: some proxies, CDNs and older browsers cut URLs beyond ~2000 characters.` });
    return w;
});

// ---------- edit helpers ----------
function addParam() {
    parts.value.params.push({ id: nextId++, key: "", value: "", noEq: false, bad: false });
}
function moveParam(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= parts.value.params.length) return;
    const arr = parts.value.params;
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
}
function addSegment() {
    parts.value.segments.push({ id: nextId++, value: "" });
}
const showVal = (s: string) => (encodedView.value ? encQ(s) : s);
const setVal = (s: string) => (encodedView.value ? safeDecode(s, true) : s);

async function paste() {
    const t = await readClipboard();
    if (t) input.value = t;
}
</script>

<template>
    <ToolPage>
        <Panel title="URL" flush>
            <template #actions>
                <Btn size="sm" variant="ghost" @click="input = SAMPLE"><Sparkles /> Sample</Btn>
                <Btn size="sm" variant="ghost" @click="paste"><ClipboardPaste /> Paste</Btn>
                <Btn size="sm" variant="ghost" :disabled="!input" @click="input = ''"><Trash2 /> Clear</Btn>
            </template>
            <CodeArea v-model="input" height="5rem" placeholder="https://user@example.com:8080/path/to/page?q=1#section" />
        </Panel>

        <Notice v-if="parseError" type="error">{{ parseError }}</Notice>
        <template v-else-if="input.trim()">
            <Panel title="Rebuilt URL" flush>
                <template #actions>
                    <Btn size="sm" variant="ghost" :disabled="rebuilt === input.trim()" @click="input = rebuilt"><ArrowRightLeft /> Use as input</Btn>
                    <CopyButton :text="rebuilt" />
                </template>
                <div class="space-y-2 p-4">
                    <p class="font-mono text-[13px] break-all text-fg">{{ rebuilt }}</p>
                    <dl class="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-xs">
                        <template v-if="normalized">
                            <dt class="text-muted">Origin</dt>
                            <dd class="font-mono break-all">{{ normalized.origin }}</dd>
                            <template v-if="normalized.href !== rebuilt">
                                <dt class="text-muted">As sent</dt>
                                <dd class="font-mono break-all text-fg-muted">{{ normalized.href }}</dd>
                            </template>
                        </template>
                    </dl>
                </div>
                <ul v-if="warnings.length" class="space-y-1.5 border-t border-line px-4 py-3">
                    <li v-for="(w, k) in warnings" :key="k" class="flex items-start gap-2 text-[13px]">
                        <TriangleAlert v-if="w.level === 'warn'" class="mt-0.5 size-4 shrink-0 text-warn" />
                        <Info v-else class="mt-0.5 size-4 shrink-0 text-info" />
                        <span>{{ w.text }}</span>
                    </li>
                </ul>
            </Panel>

            <div class="grid items-start gap-4 lg:grid-cols-2">
                <Panel title="Parts">
                    <div class="grid gap-3 sm:grid-cols-2">
                        <Field label="Protocol"><input v-model="parts.protocol" class="input font-mono" /></Field>
                        <Field label="Port" :hint="defaultPort(parts.protocol) ? `Default for ${parts.protocol.slice(0, -1)}: ${defaultPort(parts.protocol)}` : ''">
                            <input v-model="parts.port" class="input font-mono" inputmode="numeric" :placeholder="defaultPort(parts.protocol) ? `${defaultPort(parts.protocol)} (default)` : ''" />
                        </Field>
                        <Field label="Hostname" class="sm:col-span-2" :hint="normalized && normalized.hostname !== parts.hostname ? `ASCII (punycode): ${normalized.hostname}` : ''">
                            <input v-model="parts.hostname" class="input font-mono" :disabled="parts.opaque" />
                        </Field>
                        <Field label="Username"><input v-model="parts.username" class="input font-mono" autocomplete="off" /></Field>
                        <Field label="Password"><input v-model="parts.password" class="input font-mono" autocomplete="off" /></Field>
                        <Field label="Hash (fragment)" class="sm:col-span-2" :hint="parts.hash ? `Decoded: ${safeDecode(parts.hash)}` : 'Without the leading #'">
                            <input :value="parts.hash ?? ''" class="input font-mono" @input="parts.hash = ($event.target as HTMLInputElement).value || null" />
                        </Field>
                    </div>
                    <div v-if="hashRoute" class="mt-3 rounded-lg bg-subtle p-3 text-xs">
                        <div class="mb-1 font-medium text-fg">Hash route</div>
                        <div>Path: <code class="code">{{ hashRoute.path }}</code></div>
                        <div v-if="hashRoute.params.length" class="mt-1 flex flex-wrap gap-1">
                            <span v-for="p in hashRoute.params" :key="p.id" class="chip">{{ p.key }}={{ p.value }}</span>
                        </div>
                    </div>
                </Panel>

                <Panel :title="parts.opaque ? 'Path' : `Path segments (${parts.segments.length})`">
                    <template #actions>
                        <Btn v-if="!parts.opaque" size="sm" variant="ghost" @click="addSegment"><Plus /> Add</Btn>
                    </template>
                    <input v-if="parts.opaque" v-model="parts.opaquePath" class="input font-mono" />
                    <div v-else class="space-y-2">
                        <p class="font-mono text-xs break-all text-muted">/{{ parts.segments.map((s) => encSeg(s.value)).join("/") }}</p>
                        <div v-for="(seg, i) in parts.segments" :key="seg.id" class="flex items-center gap-2">
                            <span class="w-5 shrink-0 text-right text-xs text-muted tabular-nums">{{ i + 1 }}</span>
                            <input v-model="seg.value" class="input min-w-0 flex-1 font-mono" :placeholder="i === parts.segments.length - 1 ? '(empty: trailing slash)' : '(empty)'" :aria-label="`Path segment ${i + 1}`" />
                            <Btn size="sm" variant="ghost" title="Remove" @click="parts.segments.splice(i, 1)"><X /></Btn>
                        </div>
                    </div>
                </Panel>
            </div>

            <Panel :title="`Query parameters (${parts.params.length})`" flush>
                <template #actions>
                    <label class="mr-2 flex items-center gap-1.5 text-xs"><input v-model="encodedView" type="checkbox" class="checkbox" /> Encoded</label>
                    <label class="mr-2 flex items-center gap-1.5 text-xs"><input v-model="plusSpaces" type="checkbox" class="checkbox" /> Spaces as +</label>
                    <Btn v-if="tracking.length" size="sm" variant="ghost" @click="stripTracking"><Eraser /> Strip tracking ({{ tracking.length }})</Btn>
                    <Btn size="sm" variant="ghost" @click="addParam"><Plus /> Add</Btn>
                </template>
                <p v-if="!parts.params.length" class="p-4 text-sm text-muted">No query parameters.</p>
                <div v-else class="divide-y divide-line">
                    <div v-for="(p, i) in parts.params" :key="p.id" class="flex flex-wrap items-center gap-2 px-4 py-2 sm:flex-nowrap" :class="isTracking(p.key) ? 'bg-warn-soft/40' : ''">
                        <input :value="showVal(p.key)" class="input min-w-0 flex-1 font-mono" placeholder="key" aria-label="Parameter key" @input="p.key = setVal(($event.target as HTMLInputElement).value)" />
                        <span class="text-muted">=</span>
                        <input :value="showVal(p.value)" class="input min-w-0 flex-[2] font-mono" placeholder="value" aria-label="Parameter value" @input="p.value = setVal(($event.target as HTMLInputElement).value)" />
                        <div class="flex shrink-0">
                            <Btn size="sm" variant="ghost" title="Move up" :disabled="i === 0" @click="moveParam(i, -1)"><ArrowUp /></Btn>
                            <Btn size="sm" variant="ghost" title="Move down" :disabled="i === parts.params.length - 1" @click="moveParam(i, 1)"><ArrowDown /></Btn>
                            <Btn size="sm" variant="ghost" title="Remove" @click="parts.params.splice(i, 1)"><X /></Btn>
                        </div>
                    </div>
                </div>
            </Panel>

            <Panel title="Query as JSON" flush>
                <template #actions><CopyButton :text="queryJson" /></template>
                <div class="overflow-x-auto p-4"><CodeBlock :code="queryJson" language="json" /></div>
            </Panel>
        </template>
    </ToolPage>
</template>
