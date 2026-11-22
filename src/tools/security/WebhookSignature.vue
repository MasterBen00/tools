<script setup lang="ts">
import { computed, ref, watchEffect } from "vue";
import { useStorage } from "@vueuse/core";
import { CircleCheck, CircleX, Clock, ShieldCheck, Sparkles } from "lucide-vue-next";
import { Btn, CodeArea, CodeBlock, CopyButton, Field, Notice, Panel, Tabs, ToolPage } from "@/components/ui";
import { useHandoff } from "@/composables/handoff";

type Algo = "SHA-256" | "SHA-1" | "SHA-512";
type Enc = "hex" | "base64";
type PresetId = "generic" | "stripe" | "github" | "slack" | "shopify" | "twilio";
interface Preset {
    id: PresetId;
    label: string;
    algo: Algo;
    enc: Enc;
    ts: boolean;
    tolerance?: number;
    secret: string;
    target: string;
    note: string;
}
const PRESETS: Preset[] = [
    { id: "generic", label: "Generic", algo: "SHA-256", enc: "hex", ts: false, secret: "test_secret_do_not_use", target: "http://localhost:8080/webhooks", note: "HMAC over the raw request body. Pick the hash, output encoding, header name and prefix your provider uses." },
    { id: "stripe", label: "Stripe", algo: "SHA-256", enc: "hex", ts: true, tolerance: 300, secret: "whsec_test_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c", target: "http://localhost:8080/webhooks/stripe", note: "Stripe-Signature: t=<unix ts>,v1=<hex HMAC-SHA256 of `${t}.${body}`>. The whole whsec_… string is the key. Default tolerance 5 minutes." },
    { id: "github", label: "GitHub", algo: "SHA-256", enc: "hex", ts: false, secret: "gh_test_webhook_secret", target: "http://localhost:8080/webhooks/github", note: "X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body>. The legacy X-Hub-Signature uses sha1=." },
    { id: "slack", label: "Slack", algo: "SHA-256", enc: "hex", ts: true, tolerance: 300, secret: "8f742231b10e8888abcd99yyyzzz85a5", target: "http://localhost:8080/slack/events", note: "X-Slack-Signature: v0=<hex HMAC-SHA256 of `v0:${timestamp}:${body}`>, with X-Slack-Request-Timestamp. Reject requests older than 5 minutes." },
    { id: "shopify", label: "Shopify", algo: "SHA-256", enc: "base64", ts: false, secret: "shpss_test_00000000000000000000000000", target: "http://localhost:8080/webhooks/shopify", note: "X-Shopify-Hmac-Sha256: base64 HMAC-SHA256 of the raw body, keyed with the app's client secret." },
    { id: "twilio", label: "Twilio", algo: "SHA-1", enc: "base64", ts: false, secret: "twilio_test_auth_token_000000000000", target: "https://example.com/twilio/sms", note: "X-Twilio-Signature: base64 HMAC-SHA1 of the full URL followed by every POST parameter (sorted by name) as name+value. The payload here is the form-encoded body." },
];
const PRESET = new Map(PRESETS.map((p) => [p.id, p]));

const SAMPLE_PAYLOAD = `{"id":"evt_test_1Q2w3E4r5T6y","type":"payment_intent.succeeded","created":1763805600,"data":{"object":{"id":"pi_test_3Kx9","amount":4999,"currency":"eur","status":"succeeded"}}}`;
const TWILIO_PAYLOAD = "AccountSid=ACtest000000000000000000000000000&Body=Hello+there&From=%2B15005550006&MessageSid=SMtest00000000000000000000000000&To=%2B15005550001";

interface St {
    preset: PresetId;
    secret: string;
    secretEnc: "utf8" | "hex" | "base64";
    payload: string;
    ts: string;
    target: string;
    algo: Algo;
    enc: Enc;
    headerName: string;
    prefix: string;
    tolerance: number;
    received: string;
    receivedTs: string;
}
const nowTs = () => String(Math.floor(Date.now() / 1000));
const defaults = (id: PresetId = "stripe"): St => {
    const p = PRESET.get(id)!;
    return {
        preset: id,
        secret: p.secret,
        secretEnc: "utf8",
        payload: id === "twilio" ? TWILIO_PAYLOAD : SAMPLE_PAYLOAD,
        ts: nowTs(),
        target: p.target,
        algo: p.algo,
        enc: p.enc,
        headerName: "X-Signature",
        prefix: "sha256=",
        tolerance: p.tolerance ?? 300,
        received: "",
        receivedTs: "",
    };
};
const s = useStorage<St>("devtools:webhook-signature:state", defaults(), undefined, { mergeDefaults: true });
const mode = useStorage<"sign" | "verify">("devtools:webhook-signature:mode", "sign");
const preset = computed(() => PRESET.get(s.value.preset) ?? PRESETS[0]!);
const algo = computed<Algo>(() => (s.value.preset === "generic" ? s.value.algo : preset.value.algo));
const enc = computed<Enc>(() => (s.value.preset === "generic" ? s.value.enc : preset.value.enc));

useHandoff<{ input?: string }>("webhook-signature", (p) => {
    if (p.input != null) s.value.payload = p.input;
});

function choosePreset(id: PresetId) {
    const keepPayload = s.value.payload && s.value.payload !== SAMPLE_PAYLOAD && s.value.payload !== TWILIO_PAYLOAD;
    const next = defaults(id);
    if (keepPayload) next.payload = s.value.payload;
    next.received = "";
    s.value = next;
}

// ---------- crypto ----------
function secretBytes(): Uint8Array {
    const v = s.value.secret;
    if (s.value.secretEnc === "hex") {
        const clean = v.replace(/\s+/g, "");
        if (!/^([0-9a-f]{2})*$/i.test(clean)) throw new Error("Secret is not valid hex.");
        return Uint8Array.from(clean.match(/../g) ?? [], (h) => parseInt(h, 16));
    }
    if (s.value.secretEnc === "base64") {
        const raw = atob(v.replace(/^whsec_/, "").replace(/-/g, "+").replace(/_/g, "/").trim());
        return Uint8Array.from(raw, (c) => c.charCodeAt(0));
    }
    return new TextEncoder().encode(v);
}
function toHex(b: Uint8Array) {
    return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function toB64(b: Uint8Array) {
    let bin = "";
    for (const x of b) bin += String.fromCharCode(x);
    return btoa(bin);
}
async function hmac(message: string): Promise<string> {
    if (!crypto?.subtle) throw new Error("WebCrypto is only available on https:// or localhost.");
    const key = await crypto.subtle.importKey("raw", secretBytes() as BufferSource, { name: "HMAC", hash: algo.value }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
    return enc.value === "hex" ? toHex(sig) : toB64(sig);
}
/** Constant-time string comparison (length is not secret). */
function safeEqual(a: string, b: string) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

function signedMessage(ts: string): string {
    const body = s.value.payload;
    switch (s.value.preset) {
        case "stripe": return `${ts}.${body}`;
        case "slack": return `v0:${ts}:${body}`;
        case "twilio": {
            const params = [...new URLSearchParams(body).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
            return s.value.target + params.map(([k, v]) => k + v).join("");
        }
        default: return body;
    }
}
function headersFor(sig: string, ts: string): [string, string][] {
    switch (s.value.preset) {
        case "stripe": return [["Stripe-Signature", `t=${ts},v1=${sig}`]];
        case "github": return [["X-Hub-Signature-256", `sha256=${sig}`]];
        case "slack": return [["X-Slack-Request-Timestamp", ts], ["X-Slack-Signature", `v0=${sig}`]];
        case "shopify": return [["X-Shopify-Hmac-Sha256", sig]];
        case "twilio": return [["X-Twilio-Signature", sig]];
        default: return [[s.value.headerName || "X-Signature", `${s.value.prefix}${sig}`]];
    }
}

// ---------- sign ----------
const signature = ref("");
const signError = ref("");
let seq = 0;
watchEffect(async () => {
    const my = ++seq;
    const msg = signedMessage(s.value.ts);
    void algo.value;
    void enc.value;
    void s.value.secret;
    void s.value.secretEnc;
    try {
        if (!s.value.secret) throw new Error("Enter a secret.");
        const sig = await hmac(msg);
        if (my !== seq) return;
        signature.value = sig;
        signError.value = "";
    } catch (e) {
        if (my !== seq) return;
        signature.value = "";
        signError.value = (e as Error).message;
    }
});
const headers = computed(() => (signature.value ? headersFor(signature.value, s.value.ts) : []));
const headerText = computed(() => headers.value.map(([k, v]) => `${k}: ${v}`).join("\n"));
const shq = (x: string) => `'${x.replace(/'/g, `'\\''`)}'`;
const curl = computed(() => {
    if (!signature.value) return "";
    const ct = s.value.preset === "twilio" ? "application/x-www-form-urlencoded" : "application/json";
    return [`curl -X POST ${shq(s.value.target)}`, `  -H ${shq(`Content-Type: ${ct}`)}`, ...headers.value.map(([k, v]) => `  -H ${shq(`${k}: ${v}`)}`), `  --data-raw ${shq(s.value.payload)}`].join(" \\\n");
});

// ---------- verify ----------
interface Verdict {
    valid: boolean;
    expected: string;
    received: string[];
    ts?: string;
    age?: number;
    stale?: boolean;
    error?: string;
}
const verdict = ref<Verdict | null>(null);
let vseq = 0;
watchEffect(async () => {
    const my = ++vseq;
    const raw = s.value.received.trim();
    void s.value.payload;
    void s.value.secret;
    void s.value.secretEnc;
    void s.value.tolerance;
    void algo.value;
    void enc.value;
    if (!raw) {
        verdict.value = null;
        return;
    }
    try {
        let value = raw.replace(/^[A-Za-z0-9-]+:\s*/, "");
        let ts: string | undefined;
        let candidates: string[];
        switch (s.value.preset) {
            case "stripe": {
                const items = value.split(",").map((p) => p.trim().split("=") as [string, string]);
                ts = items.find(([k]) => k === "t")?.[1];
                candidates = items.filter(([k]) => k === "v1").map(([, v]) => v);
                if (!ts) throw new Error("No t= timestamp found in the Stripe-Signature header.");
                if (!candidates.length) throw new Error("No v1= signature found in the Stripe-Signature header.");
                break;
            }
            case "slack":
                ts = s.value.receivedTs.trim() || undefined;
                if (!ts) throw new Error("Enter the X-Slack-Request-Timestamp value.");
                candidates = [value.replace(/^v0=/, "")];
                break;
            case "github":
                candidates = [value.replace(/^sha256=/, "")];
                break;
            case "generic":
                if (s.value.prefix && value.startsWith(s.value.prefix)) value = value.slice(s.value.prefix.length);
                candidates = [value];
                break;
            default:
                candidates = [value];
        }
        const expected = await hmac(signedMessage(ts ?? ""));
        if (my !== vseq) return;
        const norm = (x: string) => (enc.value === "hex" ? x.toLowerCase() : x);
        const valid = candidates.some((c) => safeEqual(norm(c), norm(expected)));
        const v: Verdict = { valid, expected, received: candidates, ts };
        if (ts && /^\d+$/.test(ts)) {
            v.age = Math.floor(Date.now() / 1000) - Number(ts);
            v.stale = Math.abs(v.age) > s.value.tolerance;
        }
        verdict.value = v;
    } catch (e) {
        if (my !== vseq) return;
        verdict.value = { valid: false, expected: "", received: [], error: (e as Error).message };
    }
});
function verifySigned() {
    s.value.received = headers.value.find(([k]) => k !== "X-Slack-Request-Timestamp")?.join(": ") ?? "";
    s.value.receivedTs = s.value.ts;
    mode.value = "verify";
}
const ageText = (age: number) => (Math.abs(age) < 120 ? `${age} s` : Math.abs(age) < 7200 ? `${Math.round(age / 60)} min` : Math.abs(age) < 172800 ? `${Math.round(age / 3600)} h` : `${Math.round(age / 86400)} days`);
</script>

<template>
    <ToolPage>
        <template #actions>
            <Tabs
                v-model="mode"
                :options="[
                    { value: 'sign', label: 'Sign' },
                    { value: 'verify', label: 'Verify' },
                ]"
            />
        </template>

        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <Tabs :model-value="s.preset" :options="PRESETS.map((p) => ({ value: p.id, label: p.label }))" @update:model-value="choosePreset" />
            <span class="flex items-center gap-1.5 text-xs text-muted"><ShieldCheck class="size-4 text-success" /> Secrets never leave your browser (WebCrypto).</span>
        </div>
        <Notice type="info">{{ preset.note }}</Notice>

        <div class="grid gap-4 lg:grid-cols-2">
            <Panel title="Payload (raw body)" flush>
                <template #actions>
                    <Btn size="sm" variant="ghost" @click="choosePreset(s.preset); s.payload = s.preset === 'twilio' ? TWILIO_PAYLOAD : SAMPLE_PAYLOAD"><Sparkles /> Sample</Btn>
                </template>
                <CodeArea v-model="s.payload" height="14rem" :language="s.preset === 'twilio' ? undefined : 'json'" placeholder="The exact raw request body, byte for byte" />
                <p class="border-t border-line px-4 py-2 text-xs text-muted">Signatures cover the exact bytes: re-serialising JSON (spacing, key order) breaks verification. In Spring, read the body as a String or byte[] before mapping it.</p>
            </Panel>

            <Panel title="Settings">
                <div class="grid gap-3 sm:grid-cols-2">
                    <Field label="Secret" class="sm:col-span-2">
                        <input v-model="s.secret" class="input font-mono" spellcheck="false" autocomplete="off" />
                    </Field>
                    <Field label="Secret encoding" hint="How the key bytes are derived from the text.">
                        <select v-model="s.secretEnc" class="select">
                            <option value="utf8">UTF-8 text (most providers)</option>
                            <option value="hex">Hex</option>
                            <option value="base64">Base64 (e.g. Svix whsec_)</option>
                        </select>
                    </Field>
                    <template v-if="s.preset === 'generic'">
                        <Field label="Algorithm">
                            <select v-model="s.algo" class="select">
                                <option>SHA-256</option>
                                <option>SHA-1</option>
                                <option>SHA-512</option>
                            </select>
                        </Field>
                        <Field label="Output">
                            <select v-model="s.enc" class="select">
                                <option value="hex">Hex</option>
                                <option value="base64">Base64</option>
                            </select>
                        </Field>
                        <Field label="Header name"><input v-model="s.headerName" class="input font-mono" /></Field>
                        <Field label="Value prefix" hint="e.g. sha256= or empty"><input v-model="s.prefix" class="input font-mono" /></Field>
                    </template>
                    <Field v-else label="Algorithm"><div class="input bg-subtle font-mono">HMAC-{{ algo }} · {{ enc }}</div></Field>
                    <Field v-if="preset.ts && mode === 'sign'" label="Timestamp (unix seconds)">
                        <div class="flex gap-2">
                            <input v-model="s.ts" class="input font-mono" inputmode="numeric" />
                            <Btn size="md" variant="secondary" @click="s.ts = nowTs()"><Clock /> Now</Btn>
                        </div>
                    </Field>
                    <Field v-if="preset.ts" label="Tolerance (seconds)"><input v-model.number="s.tolerance" type="number" min="0" class="input font-mono" /></Field>
                    <Field :label="s.preset === 'twilio' ? 'Webhook URL (signed)' : 'Target URL (for curl)'" class="sm:col-span-2"><input v-model="s.target" class="input font-mono" /></Field>
                </div>
            </Panel>
        </div>

        <template v-if="mode === 'sign'">
            <Notice v-if="signError" type="error">{{ signError }}</Notice>
            <div v-else class="grid gap-4 lg:grid-cols-2">
                <Panel title="Signature headers" flush>
                    <template #actions>
                        <Btn size="sm" variant="ghost" :disabled="!signature" @click="verifySigned">Verify this</Btn>
                        <CopyButton :text="headerText" />
                    </template>
                    <div class="space-y-3 p-4">
                        <div v-for="[k, v] in headers" :key="k">
                            <div class="flex items-center justify-between gap-2">
                                <span class="label mb-0">{{ k }}</span>
                                <CopyButton :text="v" icon-only label="Copy value" />
                            </div>
                            <p class="font-mono text-[12px] break-all text-fg">{{ v }}</p>
                        </div>
                        <details class="text-xs text-muted">
                            <summary class="cursor-pointer">Signed string</summary>
                            <pre class="mt-1 max-h-40 overflow-auto rounded bg-subtle p-2 whitespace-pre-wrap">{{ signedMessage(s.ts) }}</pre>
                        </details>
                    </div>
                </Panel>
                <Panel title="curl" flush>
                    <template #actions><CopyButton :text="curl" /></template>
                    <div class="overflow-x-auto p-4"><CodeBlock :code="curl" language="bash" /></div>
                </Panel>
            </div>
        </template>

        <template v-else>
            <div class="grid gap-4 lg:grid-cols-2">
                <Panel title="Received signature">
                    <div class="space-y-3">
                        <Field :label="headersFor('<sig>', '<ts>').filter(([k]) => k !== 'X-Slack-Request-Timestamp')[0]?.[0] ?? 'Header'" hint="Paste the header value (the header name is optional).">
                            <input v-model="s.received" class="input font-mono" spellcheck="false" :placeholder="headersFor('…', '1763805600').filter(([k]) => k !== 'X-Slack-Request-Timestamp')[0]?.[1]" />
                        </Field>
                        <Field v-if="s.preset === 'slack'" label="X-Slack-Request-Timestamp">
                            <input v-model="s.receivedTs" class="input font-mono" inputmode="numeric" />
                        </Field>
                    </div>
                </Panel>
                <Panel title="Result">
                    <p v-if="!verdict" class="text-sm text-muted">Paste a signature to check it against the payload and secret.</p>
                    <Notice v-else-if="verdict.error" type="error">{{ verdict.error }}</Notice>
                    <div v-else class="space-y-3 text-sm">
                        <p class="flex items-center gap-2 text-base font-semibold" :class="verdict.valid ? 'text-success' : 'text-danger'">
                            <CircleCheck v-if="verdict.valid" class="size-5" />
                            <CircleX v-else class="size-5" />
                            {{ verdict.valid ? "Signature is valid" : "Signature does not match" }}
                        </p>
                        <Notice v-if="verdict.age !== undefined && verdict.stale" type="warning">
                            Timestamp is {{ ageText(verdict.age) }} {{ verdict.age >= 0 ? "old" : "in the future" }}, outside the {{ s.tolerance }} s tolerance: reject it to prevent replay attacks.
                        </Notice>
                        <p v-else-if="verdict.age !== undefined" class="text-xs text-muted">Timestamp age {{ ageText(verdict.age) }} (within {{ s.tolerance }} s).</p>
                        <dl class="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5">
                            <dt class="text-muted">Expected</dt>
                            <dd class="font-mono text-[12px] break-all text-fg">{{ verdict.expected }}</dd>
                            <dt class="text-muted">Received</dt>
                            <dd class="font-mono text-[12px] break-all" :class="verdict.valid ? 'text-success' : 'text-danger'">{{ verdict.received.join(", ") }}</dd>
                        </dl>
                        <p v-if="!verdict.valid" class="text-xs text-muted">Common causes: wrong secret (test vs live), body re-serialised or trimmed, wrong encoding, or a proxy that changed the body.</p>
                        <p class="text-xs text-muted">Compared in constant time. In Java use <code class="code">MessageDigest.isEqual</code>, never <code class="code">String.equals</code>.</p>
                    </div>
                </Panel>
            </div>
        </template>
    </ToolPage>
</template>
