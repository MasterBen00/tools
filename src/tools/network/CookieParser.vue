<script setup lang="ts">
import { computed, ref } from "vue";
import { useStorage } from "@vueuse/core";
import { AlertCircle, CircleCheck, ClipboardPaste, Info, PencilLine, Sparkles, Trash2, TriangleAlert } from "lucide-vue-next";
import { Btn, CodeArea, CodeBlock, CopyButton, Field, Notice, Panel, Tabs, ToolPage } from "@/components/ui";
import { readClipboard } from "@/composables/useClipboard";
import { useHandoff } from "@/composables/handoff";
import { analyzeSetCookie, byteSize, decodeValue, duration, lifetimeSeconds, parseCookieHeader, parseSetCookie, relative, type Issue, type SetCookie } from "./cookies";

const SAMPLE = `Set-Cookie: __Host-session=s%3AqL7xv2kP9aZ.Xn3eR8tW5yHc1uJ2iO0pLmNbVcXzA; Path=/; Secure; HttpOnly; SameSite=Lax
Set-Cookie: JSESSIONID=8F2C61A0E4B7D93C5A1F0E6B2D47C913; Path=/app; HttpOnly
Set-Cookie: auth_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSIsIm5hbWUiOiJBZGEiLCJleHAiOjE5MDAwMDAwMDB9.tJ0aQ6Zr8m6H6w5K3q1yVb4bVnqv0J7b2vH0k8XcY1E; Path=/; Secure; SameSite=None; Max-Age=63072000
Set-Cookie: tracking=abc123; Domain=.shop.example.com; Path=/; SameSite=None
Set-Cookie: __Secure-prefs=eyJ0aGVtZSI6ImRhcmsiLCJsYW5nIjoiZW4ifQ%3D%3D; Path=/; Expires=Fri, 01 Jan 2027 00:00:00 GMT; SameSite=Strict
Set-Cookie: old_banner=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly; SameSite=Lax
Set-Cookie: cart_id=7c9e6679-7425-40de-944b-e07fc1f90ae7; Path=/; Secure; SameSite=Lax; Priority=High; Partitioned`;

type Mode = "auto" | "cookie" | "set-cookie";
const tab = useStorage<"parse" | "build">("devtools:cookie-parser:tab", "parse");
const input = useStorage("devtools:cookie-parser:input", SAMPLE);
const mode = ref<Mode>("auto");

useHandoff<{ input?: string }>("cookie-parser", (p) => {
    if (p.input != null) {
        input.value = p.input;
        tab.value = "parse";
    }
});

const detected = computed<"cookie" | "set-cookie">(() => {
    if (mode.value !== "auto") return mode.value;
    const t = input.value.trim();
    if (/^cookie\s*:/i.test(t)) return "cookie";
    if (/^set-cookie\s*:/im.test(t)) return "set-cookie";
    return /;\s*(path|domain|expires|max-age|secure|httponly|samesite|partitioned|priority)\b/i.test(t) ? "set-cookie" : "cookie";
});

const setCookies = computed(() =>
    input.value
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !/^\s*#/.test(l))
        .map((l) => {
            const c = parseSetCookie(l);
            return { c, issues: analyzeSetCookie(c), decoded: decodeValue(c.value), lifetime: lifetimeSeconds(c) };
        }),
);
const pairs = computed(() =>
    parseCookieHeader(input.value).map((p) => ({ ...p, size: byteSize(p.name) + byteSize(p.value) + 1, decoded: decodeValue(p.value) })),
);
const pairIssues = computed<Issue[]>(() => {
    const out: Issue[] = [];
    const seen = new Map<string, number>();
    for (const p of pairs.value) seen.set(p.name, (seen.get(p.name) ?? 0) + 1);
    for (const [n, k] of seen) if (k > 1) out.push({ level: "info", text: `"${n}" appears ${k} times: same name set for different paths or domains. Servers usually read the first (most specific path).` });
    if (pairs.value.some((p) => !p.name)) out.push({ level: "warn", text: "Some entries have no name (no = sign)." });
    const total = byteSize(input.value.replace(/^\s*cookie\s*:\s*/i, ""));
    if (total > 8192) out.push({ level: "warn", text: `The Cookie header is ${total} bytes; many servers reject request headers over 8 KB (Tomcat, nginx defaults).` });
    return out;
});

const counts = (issues: Issue[]) => ({ error: issues.filter((i) => i.level === "error").length, warn: issues.filter((i) => i.level === "warn").length });
const issueClass = (l: Issue["level"]) => (l === "error" ? "text-danger" : l === "warn" ? "text-warn" : "text-info");

async function paste() {
    const t = await readClipboard();
    if (t) input.value = t;
}

// ---------- builder ----------
interface Built {
    name: string;
    value: string;
    encode: boolean;
    domain: string;
    path: string;
    expiry: "session" | "max-age" | "expires";
    maxAge: number;
    expires: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite: "" | "Strict" | "Lax" | "None";
    partitioned: boolean;
    priority: "" | "Low" | "Medium" | "High";
}
const DEFAULT_BUILT: Built = {
    name: "__Host-session",
    value: "c2Vzc2lvbi1pZC0xMjM0NQ",
    encode: true,
    domain: "",
    path: "/",
    expiry: "max-age",
    maxAge: 86400 * 7,
    expires: "",
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
    partitioned: false,
    priority: "",
};
const b = useStorage<Built>("devtools:cookie-parser:builder", { ...DEFAULT_BUILT }, undefined, { mergeDefaults: true });

const builtValue = computed(() => (b.value.encode ? encodeURIComponent(b.value.value) : b.value.value));
const expiresDate = computed(() => (b.value.expires ? new Date(b.value.expires) : null));
const builtString = computed(() => {
    const v = b.value;
    const parts = [`${v.name}=${builtValue.value}`];
    if (v.domain) parts.push(`Domain=${v.domain}`);
    if (v.path) parts.push(`Path=${v.path}`);
    if (v.expiry === "max-age") parts.push(`Max-Age=${Math.trunc(v.maxAge)}`);
    if (v.expiry === "expires" && expiresDate.value && !Number.isNaN(expiresDate.value.getTime())) parts.push(`Expires=${expiresDate.value.toUTCString()}`);
    if (v.secure) parts.push("Secure");
    if (v.httpOnly) parts.push("HttpOnly");
    if (v.sameSite) parts.push(`SameSite=${v.sameSite}`);
    if (v.partitioned) parts.push("Partitioned");
    if (v.priority) parts.push(`Priority=${v.priority}`);
    return parts.join("; ");
});
const builtIssues = computed(() => analyzeSetCookie(parseSetCookie(builtString.value)));
const jsString = computed(() => {
    const s = builtString.value
        .split("; ")
        .filter((p) => p !== "HttpOnly")
        .join("; ");
    return `document.cookie = ${JSON.stringify(s)};`;
});
const springString = computed(() => {
    const v = b.value;
    const lines = [`ResponseCookie cookie = ResponseCookie.from(${JSON.stringify(v.name)}, ${JSON.stringify(builtValue.value)})`];
    if (v.domain) lines.push(`        .domain(${JSON.stringify(v.domain)})`);
    if (v.path) lines.push(`        .path(${JSON.stringify(v.path)})`);
    if (v.expiry === "max-age") lines.push(`        .maxAge(Duration.ofSeconds(${Math.trunc(v.maxAge)}))`);
    if (v.expiry === "expires" && expiresDate.value) lines.push(`        .maxAge(Duration.between(Instant.now(), Instant.parse(${JSON.stringify(expiresDate.value.toISOString())})))`);
    if (v.secure) lines.push("        .secure(true)");
    if (v.httpOnly) lines.push("        .httpOnly(true)");
    if (v.sameSite) lines.push(`        .sameSite(${JSON.stringify(v.sameSite)})`);
    if (v.partitioned) lines.push("        .partitioned(true) // Spring 6.2+");
    lines.push("        .build();", "response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());");
    return lines.join("\n");
});

function loadIntoBuilder(c: SetCookie) {
    let value = c.value;
    let encode = false;
    try {
        if (/%[0-9a-f]{2}/i.test(value)) {
            value = decodeURIComponent(value);
            encode = true;
        }
    } catch {
        /* keep raw */
    }
    const ss = (c.sameSite ?? "").toLowerCase();
    const pr = (c.priority ?? "").toLowerCase();
    b.value = {
        name: c.name,
        value,
        encode,
        domain: c.domain ?? "",
        path: c.path ?? "",
        expiry: c.maxAge != null ? "max-age" : c.expiresDate ? "expires" : "session",
        maxAge: c.maxAge ?? DEFAULT_BUILT.maxAge,
        expires: c.expiresDate ? toLocalInput(c.expiresDate) : "",
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: ss === "strict" ? "Strict" : ss === "lax" ? "Lax" : ss === "none" ? "None" : "",
        partitioned: c.partitioned,
        priority: pr === "low" ? "Low" : pr === "medium" ? "Medium" : pr === "high" ? "High" : "",
    };
    tab.value = "build";
}
function toLocalInput(d: Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function sendToParser() {
    input.value = `Set-Cookie: ${builtString.value}`;
    mode.value = "auto";
    tab.value = "parse";
}
</script>

<template>
    <ToolPage>
        <template #actions>
            <Tabs
                v-model="tab"
                :options="[
                    { value: 'parse', label: 'Parse' },
                    { value: 'build', label: 'Build' },
                ]"
            />
        </template>

        <template v-if="tab === 'parse'">
            <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <Tabs
                    v-model="mode"
                    size="sm"
                    :options="[
                        { value: 'auto', label: 'Auto-detect' },
                        { value: 'cookie', label: 'Cookie header' },
                        { value: 'set-cookie', label: 'Set-Cookie lines' },
                    ]"
                />
                <span class="text-xs text-muted">Reading as <b class="text-fg">{{ detected === "cookie" ? "a Cookie request header" : `${setCookies.length} Set-Cookie line(s)` }}</b>. One Set-Cookie per line; the header name is optional.</span>
            </div>
            <Panel title="Input" flush>
                <template #actions>
                    <Btn size="sm" variant="ghost" @click="input = SAMPLE"><Sparkles /> Sample</Btn>
                    <Btn size="sm" variant="ghost" @click="paste"><ClipboardPaste /> Paste</Btn>
                    <Btn size="sm" variant="ghost" :disabled="!input" @click="input = ''"><Trash2 /> Clear</Btn>
                </template>
                <CodeArea v-model="input" height="9rem" :wrap="false" placeholder="Cookie: a=1; b=2   or   Set-Cookie: sid=…; Path=/; Secure; HttpOnly" />
            </Panel>

            <p v-if="!input.trim()" class="text-sm text-muted">Paste a Cookie header or Set-Cookie lines.</p>

            <template v-else-if="detected === 'cookie'">
                <div v-if="pairIssues.length" class="space-y-2">
                    <Notice v-for="(i, k) in pairIssues" :key="k" :type="i.level === 'warn' ? 'warning' : 'info'">{{ i.text }}</Notice>
                </div>
                <Panel :title="`${pairs.length} cookies`" flush>
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm">
                            <thead class="text-left text-xs text-muted uppercase">
                                <tr><th class="px-4 py-2">Name</th><th class="px-4 py-2">Value</th><th class="px-4 py-2">Decoded / hint</th><th class="px-4 py-2 text-right">Bytes</th></tr>
                            </thead>
                            <tbody class="divide-y divide-line border-t border-line">
                                <tr v-for="(p, k) in pairs" :key="k" class="align-top">
                                    <td class="px-4 py-2 font-mono text-[12px] whitespace-nowrap text-fg">{{ p.name || "(no name)" }}</td>
                                    <td class="max-w-[22rem] px-4 py-2 font-mono text-[12px] break-all">{{ p.value }}</td>
                                    <td class="max-w-[26rem] px-4 py-2 text-xs">
                                        <span v-if="p.decoded.hint" class="chip mb-1">{{ p.decoded.hint }}</span>
                                        <span v-if="p.decoded.decoded !== p.value" class="block font-mono break-all">{{ p.decoded.decoded }}</span>
                                        <pre v-if="p.decoded.detail" class="mt-1 max-h-40 overflow-auto rounded bg-subtle p-2 text-[11px] whitespace-pre-wrap">{{ p.decoded.detail }}</pre>
                                    </td>
                                    <td class="px-4 py-2 text-right text-xs text-muted tabular-nums">{{ p.size }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </Panel>
            </template>

            <div v-else class="grid gap-4 xl:grid-cols-2">
                <Panel v-for="(s, k) in setCookies" :key="k" flush>
                    <template #title>
                        <span class="font-mono break-all">{{ s.c.name || "(no name)" }}</span>
                    </template>
                    <template #actions>
                        <span v-if="counts(s.issues).error" class="chip text-danger">{{ counts(s.issues).error }} error{{ counts(s.issues).error > 1 ? "s" : "" }}</span>
                        <span v-if="counts(s.issues).warn" class="chip text-warn">{{ counts(s.issues).warn }} warning{{ counts(s.issues).warn > 1 ? "s" : "" }}</span>
                        <span v-if="!counts(s.issues).error && !counts(s.issues).warn" class="chip text-success">looks good</span>
                        <Btn size="sm" variant="ghost" title="Edit in builder" @click="loadIntoBuilder(s.c)"><PencilLine /> Edit</Btn>
                    </template>
                    <div class="space-y-3 p-4 text-sm">
                        <div>
                            <div class="label">Value <span class="font-normal text-muted">({{ s.c.size }} bytes with name)</span></div>
                            <p class="font-mono text-[12px] break-all">{{ s.c.value || "(empty)" }}</p>
                            <div v-if="s.decoded.hint || s.decoded.decoded !== s.c.value" class="mt-1 text-xs">
                                <span v-if="s.decoded.hint" class="chip">{{ s.decoded.hint }}</span>
                                <span v-if="s.decoded.decoded !== s.c.value" class="mt-1 block font-mono break-all text-fg-muted">{{ s.decoded.decoded }}</span>
                                <pre v-if="s.decoded.detail" class="mt-1 max-h-40 overflow-auto rounded bg-subtle p-2 text-[11px] whitespace-pre-wrap">{{ s.decoded.detail }}</pre>
                            </div>
                        </div>
                        <dl class="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5">
                            <dt class="text-muted">Domain</dt>
                            <dd class="font-mono text-[12px] break-all">{{ s.c.domain ?? "(host-only: exact host that set it)" }}</dd>
                            <dt class="text-muted">Path</dt>
                            <dd class="font-mono text-[12px]">{{ s.c.path ?? "(default: directory of the request path)" }}</dd>
                            <template v-if="s.c.expires !== undefined">
                                <dt class="text-muted">Expires</dt>
                                <dd>
                                    <span class="font-mono text-[12px]">{{ s.c.expires }}</span>
                                    <span v-if="s.c.expiresDate" class="block text-xs text-muted">{{ s.c.expiresDate.toLocaleString() }} · {{ relative(s.c.expiresDate.getTime() - Date.now()) }}</span>
                                </dd>
                            </template>
                            <template v-if="s.c.maxAge !== undefined">
                                <dt class="text-muted">Max-Age</dt>
                                <dd class="text-[12px]">{{ s.c.maxAge === null ? "invalid" : duration(s.c.maxAge) }}</dd>
                            </template>
                            <dt class="text-muted">Lifetime</dt>
                            <dd class="text-[12px]">{{ s.lifetime === null ? "Session cookie (until the browser closes)" : s.lifetime <= 0 ? "Expired (deletes the cookie)" : `Expires ${relative(s.lifetime * 1000)}` }}</dd>
                            <dt class="text-muted">Flags</dt>
                            <dd class="flex flex-wrap gap-1">
                                <span class="chip" :class="s.c.secure ? 'text-success' : 'text-warn'">{{ s.c.secure ? "Secure" : "no Secure" }}</span>
                                <span class="chip" :class="s.c.httpOnly ? 'text-success' : ''">{{ s.c.httpOnly ? "HttpOnly" : "no HttpOnly" }}</span>
                                <span class="chip">SameSite={{ s.c.sameSite ?? "(Lax default)" }}</span>
                                <span v-if="s.c.partitioned" class="chip">Partitioned (CHIPS)</span>
                                <span v-if="s.c.priority" class="chip">Priority={{ s.c.priority }}</span>
                            </dd>
                        </dl>
                        <ul v-if="s.issues.length" class="space-y-1.5 border-t border-line pt-3">
                            <li v-for="(i, n) in s.issues" :key="n" class="flex items-start gap-2 text-[13px]">
                                <AlertCircle v-if="i.level === 'error'" class="mt-0.5 size-4 shrink-0" :class="issueClass(i.level)" />
                                <TriangleAlert v-else-if="i.level === 'warn'" class="mt-0.5 size-4 shrink-0" :class="issueClass(i.level)" />
                                <Info v-else class="mt-0.5 size-4 shrink-0" :class="issueClass(i.level)" />
                                <span>{{ i.text }}</span>
                            </li>
                        </ul>
                        <p v-else class="flex items-center gap-2 border-t border-line pt-3 text-[13px] text-success"><CircleCheck class="size-4" /> No issues found.</p>
                    </div>
                </Panel>
            </div>
        </template>

        <template v-else>
            <div class="grid gap-4 lg:grid-cols-2">
                <Panel title="Attributes">
                    <template #actions>
                        <Btn size="sm" variant="ghost" @click="b = { ...DEFAULT_BUILT }"><Sparkles /> Sample</Btn>
                    </template>
                    <div class="grid gap-3 sm:grid-cols-2">
                        <Field label="Name"><input v-model="b.name" class="input font-mono" /></Field>
                        <Field label="Path"><input v-model="b.path" class="input font-mono" placeholder="/" /></Field>
                        <Field label="Value" class="sm:col-span-2">
                            <input v-model="b.value" class="input font-mono" />
                            <label class="mt-1.5 flex items-center gap-2 text-xs text-muted"><input v-model="b.encode" type="checkbox" class="checkbox" /> URL-encode the value</label>
                        </Field>
                        <Field label="Domain" hint="Empty = host-only (safest)."><input v-model="b.domain" class="input font-mono" placeholder="example.com" /></Field>
                        <Field label="Expiry">
                            <select v-model="b.expiry" class="select">
                                <option value="session">Session cookie</option>
                                <option value="max-age">Max-Age (seconds)</option>
                                <option value="expires">Expires (date)</option>
                            </select>
                        </Field>
                        <Field v-if="b.expiry === 'max-age'" label="Max-Age" :hint="duration(b.maxAge)" class="sm:col-span-2">
                            <input v-model.number="b.maxAge" type="number" class="input font-mono" />
                        </Field>
                        <Field v-if="b.expiry === 'expires'" label="Expires (local time)" class="sm:col-span-2">
                            <input v-model="b.expires" type="datetime-local" class="input" />
                        </Field>
                        <Field label="SameSite">
                            <select v-model="b.sameSite" class="select">
                                <option value="">(not set, Lax by default)</option>
                                <option value="Strict">Strict</option>
                                <option value="Lax">Lax</option>
                                <option value="None">None</option>
                            </select>
                        </Field>
                        <Field label="Priority">
                            <select v-model="b.priority" class="select">
                                <option value="">(not set)</option>
                                <option>Low</option>
                                <option>Medium</option>
                                <option>High</option>
                            </select>
                        </Field>
                        <div class="flex flex-wrap gap-x-4 gap-y-2 text-sm sm:col-span-2">
                            <label class="flex items-center gap-2"><input v-model="b.secure" type="checkbox" class="checkbox" /> Secure</label>
                            <label class="flex items-center gap-2"><input v-model="b.httpOnly" type="checkbox" class="checkbox" /> HttpOnly</label>
                            <label class="flex items-center gap-2"><input v-model="b.partitioned" type="checkbox" class="checkbox" /> Partitioned</label>
                        </div>
                    </div>
                </Panel>
                <div class="min-w-0 space-y-4">
                    <Panel title="Set-Cookie" flush>
                        <template #actions>
                            <Btn size="sm" variant="ghost" @click="sendToParser">Inspect</Btn>
                            <CopyButton :text="`Set-Cookie: ${builtString}`" />
                        </template>
                        <p class="p-4 font-mono text-[12px] break-all text-fg">Set-Cookie: {{ builtString }}</p>
                        <ul v-if="builtIssues.length" class="space-y-1.5 border-t border-line px-4 py-3">
                            <li v-for="(i, n) in builtIssues" :key="n" class="flex items-start gap-2 text-[13px]">
                                <AlertCircle v-if="i.level === 'error'" class="mt-0.5 size-4 shrink-0" :class="issueClass(i.level)" />
                                <TriangleAlert v-else-if="i.level === 'warn'" class="mt-0.5 size-4 shrink-0" :class="issueClass(i.level)" />
                                <Info v-else class="mt-0.5 size-4 shrink-0" :class="issueClass(i.level)" />
                                <span>{{ i.text }}</span>
                            </li>
                        </ul>
                    </Panel>
                    <Panel title="Spring ResponseCookie" flush>
                        <template #actions><CopyButton :text="springString" /></template>
                        <div class="overflow-x-auto p-4"><CodeBlock :code="springString" language="java" /></div>
                    </Panel>
                    <Panel title="JavaScript" flush>
                        <template #actions><CopyButton :text="jsString" /></template>
                        <div class="overflow-x-auto p-4">
                            <CodeBlock :code="jsString" language="javascript" />
                            <p v-if="b.httpOnly" class="mt-2 text-xs text-muted">HttpOnly is left out: scripts cannot set or read HttpOnly cookies.</p>
                        </div>
                    </Panel>
                </div>
            </div>
        </template>
    </ToolPage>
</template>
