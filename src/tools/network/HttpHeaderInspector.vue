<script setup lang="ts">
import { computed, ref } from "vue";
import { useStorage } from "@vueuse/core";
import { CircleCheck, CircleX, ClipboardPaste, Info, Search, Sparkles, Trash2, TriangleAlert } from "lucide-vue-next";
import { Btn, CodeArea, Notice, Panel, ToolPage } from "@/components/ui";
import { readClipboard } from "@/composables/useClipboard";
import { useHandoff } from "@/composables/handoff";
import { HEADER_INFO } from "./httpHeaders";
import { analyzeSetCookie, parseSetCookie } from "./cookies";

const SAMPLE = `HTTP/1.1 200 OK
Date: Sun, 22 Nov 2026 10:14:03 GMT
Server: nginx/1.18.0 (Ubuntu)
Content-Type: text/html; charset=utf-8
Content-Length: 18342
Connection: keep-alive
X-Powered-By: Express
Cache-Control: no-cache
ETag: W/"47a6-9v2gQ3f0b1Zx1o1mZq0dY0j3u2E"
Vary: Accept-Encoding, Origin
Strict-Transport-Security: max-age=86400
X-Frame-Options: SAMEORIGIN
X-XSS-Protection: 1; mode=block
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src * data:
Access-Control-Allow-Origin: *
Set-Cookie: connect.sid=s%3Aj9Fv0T2k.Ri8zZb1wQ; Path=/; HttpOnly
Set-Cookie: theme=dark; Path=/; Max-Age=31536000
X-Request-Id: 6f1c2d9e-3a54-4c1b-9a77-0f5b2e8d4c11`;

const input = useStorage("devtools:http-header-inspector:input", SAMPLE);
const filter = ref("");

useHandoff<{ input?: string }>("http-header-inspector", (p) => {
    if (p.input != null) input.value = p.input;
});

interface Header {
    name: string;
    value: string;
}
const parsed = computed(() => {
    const lines = input.value.replace(/\r/g, "").split("\n");
    const blocks: { start: string; headers: Header[] }[] = [];
    let cur: { start: string; headers: Header[] } = { start: "", headers: [] };
    const push = () => {
        if (cur.start || cur.headers.length) blocks.push(cur);
    };
    const unparsed: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i]!;
        // curl -v prefixes
        const line = raw.replace(/^[<>]\s?/, "");
        if (!line.trim()) continue;
        if (/^HTTP\/[\d.]+\s+\d{3}/i.test(line.trim()) || /^[A-Z]+\s+\S+\s+HTTP\/[\d.]+$/.test(line.trim())) {
            push();
            cur = { start: line.trim(), headers: [] };
            continue;
        }
        if (/^[ \t]/.test(line) && cur.headers.length) {
            cur.headers[cur.headers.length - 1]!.value += " " + line.trim();
            continue;
        }
        const m = /^(:?[!#$%&'*+\-.^_`|~0-9A-Za-z]+)\s*:\s*(.*)$/.exec(line.trim());
        if (m) {
            if (m[1] === ":status") {
                push();
                cur = { start: `HTTP/2 ${m[2]}`, headers: [] };
            }
            cur.headers.push({ name: m[1]!, value: m[2]! });
            continue;
        }
        // DevTools "Name:" on one line and the value on the next.
        const lone = /^([!#$%&'*+\-.^_`|~0-9A-Za-z]+):$/.exec(line.trim());
        if (lone && i + 1 < lines.length) {
            cur.headers.push({ name: lone[1]!, value: lines[++i]!.trim() });
            continue;
        }
        unparsed.push(line.trim());
    }
    push();
    const last = blocks[blocks.length - 1] ?? { start: "", headers: [] };
    return { blocks, last, unparsed };
});
const headers = computed(() => parsed.value.last.headers);
const startLine = computed(() => parsed.value.last.start);
const isRequest = computed(() => {
    if (/^HTTP\//i.test(startLine.value)) return false;
    if (startLine.value) return true;
    const names = headers.value.map((h) => h.name.toLowerCase());
    const req = names.filter((n) => HEADER_INFO.get(n)?.kind === "request").length;
    const res = names.filter((n) => HEADER_INFO.get(n)?.kind === "response").length;
    return req > res;
});
const get = (name: string) => headers.value.filter((h) => h.name.toLowerCase() === name).map((h) => h.value);
const first = (name: string) => get(name)[0];

const rows = computed(() => {
    const q = filter.value.trim().toLowerCase();
    return headers.value
        .map((h) => {
            const info = HEADER_INFO.get(h.name.toLowerCase());
            return {
                ...h,
                category: info?.category ?? (h.name.startsWith(":") ? "HTTP/2 pseudo-header" : "Custom"),
                text: info?.text ?? (h.name.startsWith(":") ? "HTTP/2 pseudo-header carrying the request line or status." : /^x-/i.test(h.name) ? "Custom or vendor-specific header (X- prefix)." : "Not in the built-in dictionary."),
            };
        })
        .filter((r) => !q || [r.name, r.value, r.category].some((x) => x.toLowerCase().includes(q)));
});

// ---------- security checks ----------
type Status = "pass" | "warn" | "fail" | "info";
interface Check {
    title: string;
    status: Status;
    detail: string;
    fix: string;
    weight: number;
}

function parseCsp(s: string) {
    const m = new Map<string, string[]>();
    for (const part of s.split(";")) {
        const [name, ...vals] = part.trim().split(/\s+/);
        if (name && !m.has(name.toLowerCase())) m.set(name.toLowerCase(), vals);
    }
    return m;
}

const checks = computed<Check[]>(() => {
    const out: Check[] = [];
    const csp = first("content-security-policy");
    const cspRO = first("content-security-policy-report-only");
    const policy = csp ? parseCsp(csp) : null;
    // CSP
    if (!csp) {
        out.push({
            title: "Content-Security-Policy",
            status: "fail",
            weight: 25,
            detail: cspRO ? "Only a Report-Only policy is present: nothing is blocked yet." : "No CSP: any injected script runs with full access to the page.",
            fix: "Start with Content-Security-Policy: default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self' and tighten from there (see the CSP builder).",
        });
    } else {
        const script = policy!.get("script-src") ?? policy!.get("default-src");
        const problems: string[] = [];
        if (!script) problems.push("no script-src or default-src, so scripts are unrestricted");
        else {
            const hasNonce = script.some((s) => /^'(nonce-|sha(256|384|512)-)/.test(s));
            if (script.includes("'unsafe-inline'") && !hasNonce) problems.push("'unsafe-inline' allows inline scripts (defeats most XSS protection)");
            if (script.includes("'unsafe-eval'")) problems.push("'unsafe-eval' allows eval()");
            if (script.some((s) => s === "*" || s === "http:" || s === "https:" || s === "data:") && !script.includes("'strict-dynamic'")) problems.push("wildcard or scheme-only script sources (*, https:, data:)");
        }
        if (!policy!.has("object-src") && !(policy!.get("default-src") ?? []).includes("'none'")) problems.push("no object-src 'none'");
        if ([...policy!.values()].some((v) => v.includes("*"))) problems.push("a * wildcard source in at least one directive");
        out.push({
            title: "Content-Security-Policy",
            status: problems.length ? "warn" : "pass",
            weight: 25,
            detail: problems.length ? `Present, but: ${problems.join("; ")}.` : "Present with no obvious weaknesses.",
            fix: problems.length ? "Replace 'unsafe-inline' with nonces or hashes, drop 'unsafe-eval' and wildcards, add object-src 'none' and base-uri 'self'." : "",
        });
    }
    // HSTS
    const hsts = first("strict-transport-security");
    if (!hsts) out.push({ title: "Strict-Transport-Security", status: "fail", weight: 20, detail: "No HSTS: the first visit or any http:// link can be downgraded or intercepted.", fix: "Strict-Transport-Security: max-age=31536000; includeSubDomains; preload (only over HTTPS)." });
    else {
        const age = Number(/max-age\s*=\s*"?(\d+)/i.exec(hsts)?.[1] ?? 0);
        const sub = /includesubdomains/i.test(hsts);
        const pre = /preload/i.test(hsts);
        const issues: string[] = [];
        if (age < 15_552_000) issues.push(`max-age is ${age} s (${Math.round(age / 86400)} days); at least 6 months (15552000) is recommended`);
        if (!sub) issues.push("no includeSubDomains");
        out.push({
            title: "Strict-Transport-Security",
            status: age < 15_552_000 ? "warn" : !sub ? "warn" : "pass",
            weight: 20,
            detail: issues.length ? `Present, but ${issues.join("; ")}.` : `max-age ${Math.round(age / 86400)} days, includeSubDomains${pre ? ", preload" : " (add preload to join the browser preload list)"}.`,
            fix: issues.length ? "Strict-Transport-Security: max-age=31536000; includeSubDomains; preload" : "",
        });
    }
    // nosniff
    const xcto = first("x-content-type-options");
    out.push({ title: "X-Content-Type-Options", status: xcto?.trim().toLowerCase() === "nosniff" ? "pass" : "fail", weight: 10, detail: xcto ? (xcto.trim().toLowerCase() === "nosniff" ? "nosniff is set." : `Unexpected value "${xcto}".`) : "Missing: browsers may MIME-sniff responses into executable content.", fix: xcto?.trim().toLowerCase() === "nosniff" ? "" : "X-Content-Type-Options: nosniff" });
    // Clickjacking
    const xfo = first("x-frame-options")?.trim().toUpperCase();
    const fa = policy?.get("frame-ancestors");
    if (fa) out.push({ title: "Clickjacking protection", status: fa.includes("*") ? "warn" : "pass", weight: 15, detail: `CSP frame-ancestors ${fa.join(" ")}.`, fix: fa.includes("*") ? "Use frame-ancestors 'self' or 'none'." : "" });
    else if (xfo === "DENY" || xfo === "SAMEORIGIN") out.push({ title: "Clickjacking protection", status: "pass", weight: 15, detail: `X-Frame-Options ${xfo}.`, fix: "Optionally also add CSP frame-ancestors, the modern replacement." });
    else if (xfo) out.push({ title: "Clickjacking protection", status: "warn", weight: 15, detail: `X-Frame-Options ${xfo} is obsolete or invalid (ALLOW-FROM is ignored by modern browsers).`, fix: "Use CSP frame-ancestors with an explicit list of allowed origins." });
    else out.push({ title: "Clickjacking protection", status: "fail", weight: 15, detail: "Neither X-Frame-Options nor CSP frame-ancestors: the page can be framed by any site.", fix: "Content-Security-Policy: frame-ancestors 'self' (and/or X-Frame-Options: DENY)." });
    // Referrer-Policy
    const rp = first("referrer-policy")?.toLowerCase();
    const weakRp = ["unsafe-url", "no-referrer-when-downgrade", "origin-when-cross-origin"];
    out.push({
        title: "Referrer-Policy",
        status: !rp ? "warn" : rp.split(",").some((v) => weakRp.includes(v.trim())) ? "warn" : "pass",
        weight: 10,
        detail: !rp ? "Missing: browsers default to strict-origin-when-cross-origin, but older ones leak full URLs." : rp.split(",").some((v) => weakRp.includes(v.trim())) ? `${rp} sends full URLs (with paths and query strings) to other sites.` : `${rp}.`,
        fix: !rp || rp.split(",").some((v) => weakRp.includes(v.trim())) ? "Referrer-Policy: strict-origin-when-cross-origin (or no-referrer)." : "",
    });
    // Permissions-Policy
    const pp = first("permissions-policy");
    out.push({ title: "Permissions-Policy", status: pp ? "pass" : "warn", weight: 5, detail: pp ? "Present." : first("feature-policy") ? "Only the deprecated Feature-Policy header is set." : "Missing: embedded frames may request camera, microphone, geolocation, etc.", fix: pp ? "" : "Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()" });
    // COOP / COEP / CORP
    const coop = first("cross-origin-opener-policy");
    out.push({ title: "Cross-Origin-Opener-Policy", status: coop ? (/same-origin/i.test(coop) ? "pass" : "warn") : "warn", weight: 5, detail: coop ? `${coop}.` : "Missing: cross-origin windows you open (or that open you) keep a reference to this window.", fix: coop && /same-origin/i.test(coop) ? "" : "Cross-Origin-Opener-Policy: same-origin (or same-origin-allow-popups if you rely on OAuth popups)." });
    const coep = first("cross-origin-embedder-policy");
    out.push({ title: "Cross-Origin-Embedder-Policy", status: coep ? "pass" : "info", weight: 0, detail: coep ? `${coep}.` : "Not set. Only needed for cross-origin isolation (SharedArrayBuffer, precise timers).", fix: coep ? "" : "Cross-Origin-Embedder-Policy: require-corp (or credentialless) if you need cross-origin isolation." });
    const corp = first("cross-origin-resource-policy");
    out.push({ title: "Cross-Origin-Resource-Policy", status: corp ? "pass" : "info", weight: 0, detail: corp ? `${corp}.` : "Not set: other sites may embed this resource (fine for public assets).", fix: corp ? "" : "Cross-Origin-Resource-Policy: same-origin for private resources." });
    // CORS
    const acao = first("access-control-allow-origin");
    const acac = first("access-control-allow-credentials");
    if (acao) {
        if (acao.trim() === "*" && /true/i.test(acac ?? "")) out.push({ title: "CORS", status: "fail", weight: 10, detail: "Allow-Origin * together with Allow-Credentials true: browsers refuse it, and it signals a misconfigured CORS setup.", fix: "Echo a specific allow-listed origin and add Vary: Origin." });
        else if (acao.trim() === "*") out.push({ title: "CORS", status: "info", weight: 0, detail: "Access-Control-Allow-Origin: * lets any site read this response (fine for public, non-personal data).", fix: "Use an allow-list of origins for anything user-specific." });
        else if (/^null$/i.test(acao.trim())) out.push({ title: "CORS", status: "fail", weight: 10, detail: "Allow-Origin: null can be matched by sandboxed iframes and file:// pages.", fix: "Never allow the null origin." });
        else out.push({ title: "CORS", status: "pass", weight: 0, detail: `Restricted to ${acao}${/true/i.test(acac ?? "") ? " with credentials" : ""}.`, fix: /origin/i.test(first("vary") ?? "") ? "" : "Add Vary: Origin when the allowed origin is chosen per request." });
    }
    // Info leaks
    const server = first("server");
    if (server && /\d/.test(server)) out.push({ title: "Server header", status: "warn", weight: 5, detail: `"${server}" reveals the exact software version.`, fix: "nginx: server_tokens off; Apache: ServerTokens Prod; Spring Boot: server.server-header= (empty)." });
    const leaks = ["x-powered-by", "x-aspnet-version", "x-aspnetmvc-version", "x-generator", "x-runtime"].filter((h) => first(h) !== undefined);
    if (leaks.length) out.push({ title: "Technology disclosure", status: "warn", weight: 5, detail: leaks.map((h) => `${headers.value.find((x) => x.name.toLowerCase() === h)?.name}: ${first(h)}`).join(", "), fix: "Express: app.disable('x-powered-by'); ASP.NET: <httpRuntime enableVersionHeader=\"false\"/>; or strip at the proxy." });
    const xxss = first("x-xss-protection");
    if (xxss && !/^\s*0/.test(xxss)) out.push({ title: "X-XSS-Protection", status: "info", weight: 0, detail: `${xxss}: the XSS auditor is gone from browsers and mode=block caused leaks in the past.`, fix: "Set X-XSS-Protection: 0 (or remove it) and rely on CSP." });
    // Cookies
    const cookies = get("set-cookie").map((v) => parseSetCookie(v));
    if (cookies.length) {
        const bad = cookies.map((c) => ({ c, issues: analyzeSetCookie(c).filter((i) => i.level !== "info") })).filter((x) => x.issues.length);
        out.push({
            title: `Cookies (${cookies.length})`,
            status: bad.some((x) => x.issues.some((i) => i.level === "error")) ? "fail" : bad.length ? "warn" : "pass",
            weight: 10,
            detail: bad.length ? bad.map((x) => `${x.c.name}: ${x.issues.map((i) => i.text.split(":")[0]).join("; ")}`).join(" · ") : "All cookies have Secure and sensible flags.",
            fix: bad.length ? "Add Secure, HttpOnly (for session cookies) and SameSite=Lax/Strict. Open the Cookie parser for details." : "",
        });
    }
    return out;
});

const score = computed(() => {
    let s = 100;
    for (const c of checks.value) {
        if (c.status === "fail") s -= c.weight;
        else if (c.status === "warn") s -= c.weight / 2;
    }
    s = Math.max(0, Math.round(s));
    const fails = checks.value.filter((c) => c.status === "fail").length;
    const grade = s >= 95 && !fails ? "A+" : s >= 85 ? "A" : s >= 70 ? "B" : s >= 55 ? "C" : s >= 40 ? "D" : "F";
    return { s, grade };
});
const gradeClass = computed(() => (score.value.grade.startsWith("A") ? "text-success" : score.value.grade === "B" ? "text-info" : score.value.grade === "C" || score.value.grade === "D" ? "text-warn" : "text-danger"));
const statusClass = (s: Status) => (s === "pass" ? "text-success" : s === "warn" ? "text-warn" : s === "fail" ? "text-danger" : "text-info");

async function paste() {
    const t = await readClipboard();
    if (t) input.value = t;
}
</script>

<template>
    <ToolPage>
        <div class="grid gap-4 lg:grid-cols-2">
            <Panel title="Raw headers" flush>
                <template #actions>
                    <Btn size="sm" variant="ghost" @click="input = SAMPLE"><Sparkles /> Sample</Btn>
                    <Btn size="sm" variant="ghost" @click="paste"><ClipboardPaste /> Paste</Btn>
                    <Btn size="sm" variant="ghost" :disabled="!input" @click="input = ''"><Trash2 /> Clear</Btn>
                </template>
                <CodeArea v-model="input" height="22rem" :wrap="false" placeholder="Paste curl -I output, DevTools response headers or a raw HTTP message…" />
            </Panel>

            <Panel title="Security headers" flush>
                <template #actions>
                    <span v-if="headers.length && !isRequest" class="text-xs text-muted">score {{ score.s }}/100</span>
                </template>
                <p v-if="!headers.length" class="p-4 text-sm text-muted">Paste headers to grade them.</p>
                <div v-else-if="isRequest" class="p-4"><Notice type="info">These look like request headers. The security grade applies to response headers; the table below still explains each header.</Notice></div>
                <div v-else>
                    <div class="flex items-center gap-4 border-b border-line px-4 py-3">
                        <div class="grid size-16 shrink-0 place-items-center rounded-2xl bg-subtle font-display text-3xl font-bold ring-1 ring-line" :class="gradeClass">{{ score.grade }}</div>
                        <div class="min-w-0 text-sm">
                            <p v-if="startLine" class="font-mono text-[12px] text-fg">{{ startLine }}</p>
                            <p class="text-muted">
                                {{ checks.filter((c) => c.status === "pass").length }} passed · {{ checks.filter((c) => c.status === "warn").length }} warnings · {{ checks.filter((c) => c.status === "fail").length }} failed
                            </p>
                            <p v-if="parsed.blocks.length > 1" class="text-xs text-muted">{{ parsed.blocks.length }} messages found (redirects?); showing the last one.</p>
                        </div>
                    </div>
                    <ul class="max-h-[22rem] divide-y divide-line overflow-auto">
                        <li v-for="c in checks" :key="c.title" class="flex gap-2.5 px-4 py-2.5 text-sm">
                            <CircleCheck v-if="c.status === 'pass'" class="mt-0.5 size-4 shrink-0" :class="statusClass(c.status)" />
                            <TriangleAlert v-else-if="c.status === 'warn'" class="mt-0.5 size-4 shrink-0" :class="statusClass(c.status)" />
                            <CircleX v-else-if="c.status === 'fail'" class="mt-0.5 size-4 shrink-0" :class="statusClass(c.status)" />
                            <Info v-else class="mt-0.5 size-4 shrink-0" :class="statusClass(c.status)" />
                            <div class="min-w-0">
                                <p class="font-medium text-fg">{{ c.title }}</p>
                                <p class="text-fg-muted">{{ c.detail }}</p>
                                <p v-if="c.fix" class="mt-0.5 font-mono text-[11px] break-words text-muted">Fix: {{ c.fix }}</p>
                            </div>
                        </li>
                    </ul>
                </div>
            </Panel>
        </div>

        <Panel v-if="headers.length" :title="`${headers.length} headers`" flush>
            <template #actions>
                <div class="relative">
                    <Search class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle" />
                    <input v-model="filter" class="input h-8 w-48 py-1 pl-8" placeholder="Filter…" aria-label="Filter headers" />
                </div>
            </template>
            <div class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead class="text-left text-xs text-muted uppercase">
                        <tr><th class="px-4 py-2">Header</th><th class="px-4 py-2">Value</th><th class="px-4 py-2">What it does</th><th class="px-4 py-2">Category</th></tr>
                    </thead>
                    <tbody class="divide-y divide-line border-t border-line">
                        <tr v-for="(r, k) in rows" :key="k" class="align-top">
                            <td class="px-4 py-2 font-mono text-[12px] whitespace-nowrap text-fg">{{ r.name }}</td>
                            <td class="max-w-[24rem] px-4 py-2 font-mono text-[12px] break-all">{{ r.value }}</td>
                            <td class="min-w-[16rem] px-4 py-2 text-fg-muted">{{ r.text }}</td>
                            <td class="px-4 py-2"><span class="chip whitespace-nowrap">{{ r.category }}</span></td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p v-if="parsed.unparsed.length" class="border-t border-line px-4 py-2 text-xs text-warn">Skipped {{ parsed.unparsed.length }} line(s) that are not headers: {{ parsed.unparsed.slice(0, 3).join(" · ") }}</p>
        </Panel>
    </ToolPage>
</template>
