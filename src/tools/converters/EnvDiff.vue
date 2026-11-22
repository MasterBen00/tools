<script setup lang="ts">
import { useHandoff } from "@/composables/handoff";
import { computed, ref, watch } from "vue";
import { useStorage } from "@vueuse/core";
import { ArrowLeftRight, Eye, EyeOff, Sparkles, Trash2 } from "lucide-vue-next";
import { Btn, CodeArea, CopyButton, Notice, Panel, ToolPage } from "@/components/ui";

const SAMPLE_EXAMPLE = `# ---- Server ----
SERVER_PORT=8080
SPRING_PROFILES_ACTIVE=dev
NODE_ENV=development

# ---- Database ----
SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:5432/shop
SPRING_DATASOURCE_USERNAME=shop
SPRING_DATASOURCE_PASSWORD=
REDIS_URL=redis://localhost:6379

# ---- Auth ----
JWT_SECRET=change-me
JWT_EXPIRATION_MINUTES=60
OAUTH_GOOGLE_CLIENT_ID=
OAUTH_GOOGLE_CLIENT_SECRET=

# ---- Integrations ----
SMTP_HOST=smtp.mailtrap.io
SMTP_PORT=2525
SENTRY_DSN=
FEATURE_NEW_CHECKOUT=false
PAYMENT_GATEWAY=sslcommerz
`;

const SAMPLE_ENV = `# local overrides
SERVER_PORT=9090
SPRING_PROFILES_ACTIVE=dev
export NODE_ENV=development

SPRING_DATASOURCE_URL=jdbc:postgresql://db.internal:5432/shop
SPRING_DATASOURCE_USERNAME=shop_app
SPRING_DATASOURCE_PASSWORD="s3cr3t-Pa55!"
REDIS_URL=redis://localhost:6379

JWT_SECRET=4f9c2b7e1a0d6e8f3b5c9a2d7e1f4b8c
JWT_EXPIRATION_MINUTES=60
OAUTH_GOOGLE_CLIENT_ID=
SENTRY_DSN=https://a1b2c3d4e5@o12345.ingest.sentry.io/678
JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASC
-----END PRIVATE KEY-----"
FEATURE_NEW_CHECKOUT=true
FEATURE_NEW_CHECKOUT=false
SMTP_HOST smtp.gmail.com
DEBUG_SQL=true
`;

/* ---------------- Inputs ---------------- */

// The example file holds placeholders only, so it may be remembered.
const example = useStorage("devtools:env-diff:example", SAMPLE_EXAMPLE);
// The real .env is NOT persisted unless the user opts in.
const ENV_KEY = "devtools:env-diff:env";
const rememberEnv = useStorage("devtools:env-diff:remember-env", false);
function readSaved(): string | null {
    try {
        return localStorage.getItem(ENV_KEY);
    } catch {
        return null;
    }
}
const env = ref<string>((rememberEnv.value && readSaved()) || SAMPLE_ENV);
watch([env, rememberEnv], ([v, on]) => {
    try {
        if (on) localStorage.setItem(ENV_KEY, v);
        else localStorage.removeItem(ENV_KEY);
    } catch {
        /* storage unavailable */
    }
});

/* ---------------- Parser ---------------- */

interface Entry { key: string; value: string; line: number }
interface Parsed {
    entries: Entry[];
    map: Map<string, Entry>; // last definition wins
    dups: Map<string, number[]>;
    invalid: { line: number; text: string; reason: string }[];
    lines: ({ kind: "blank" } | { kind: "comment"; text: string } | { kind: "entry"; key: string })[];
}

function parseEnv(text: string): Parsed {
    const src = text.replace(/\r\n?/g, "\n").split("\n");
    const entries: Entry[] = [];
    const invalid: Parsed["invalid"] = [];
    const lines: Parsed["lines"] = [];
    for (let i = 0; i < src.length; i++) {
        const raw = src[i];
        const t = raw.trim();
        if (!t) {
            lines.push({ kind: "blank" });
            continue;
        }
        if (t.startsWith("#")) {
            lines.push({ kind: "comment", text: t });
            continue;
        }
        const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(t);
        if (!m) {
            invalid.push({
                line: i + 1,
                text: t,
                reason: /^(?:export\s+)?[A-Za-z_][\w.-]*\s+\S/.test(t) ? "missing =" : /^\s*[^A-Za-z_]/.test(t) ? "invalid key" : "not KEY=value",
            });
            continue;
        }
        const key = m[1];
        let rest = m[2];
        const startLine = i + 1;
        let value: string;
        const q = rest[0];
        if (q === '"' || q === "'" || q === "`") {
            let body = rest.slice(1);
            let end = findClose(body, q);
            // Multi-line quoted value: keep reading lines until the closing quote.
            while (end < 0 && i + 1 < src.length) {
                i++;
                body += "\n" + src[i];
                end = findClose(body, q);
            }
            if (end < 0) {
                invalid.push({ line: startLine, text: t, reason: `unclosed ${q} quote` });
                value = body;
            } else value = body.slice(0, end);
            if (q === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\(["\\])/g, "$1");
        } else {
            rest = rest.replace(/\s+#.*$/, "");
            value = rest.trim();
        }
        entries.push({ key, value, line: startLine });
        lines.push({ kind: "entry", key });
    }
    const map = new Map<string, Entry>();
    const seen = new Map<string, number[]>();
    for (const e of entries) {
        map.set(e.key, e);
        seen.set(e.key, [...(seen.get(e.key) ?? []), e.line]);
    }
    const dups = new Map([...seen].filter(([, l]) => l.length > 1));
    return { entries, map, dups, invalid, lines };
}

function findClose(s: string, q: string): number {
    for (let i = 0; i < s.length; i++) {
        if (s[i] === "\\" && q === '"') {
            i++;
            continue;
        }
        if (s[i] === q) return i;
    }
    return -1;
}

const pa = computed(() => parseEnv(example.value));
const pb = computed(() => parseEnv(env.value));

/* ---------------- Compare ---------------- */

type Status = "missing" | "extra" | "empty" | "same" | "different" | "duplicate";
const STATUS: { value: Status; label: string; cls: string }[] = [
    { value: "missing", label: "Missing in .env", cls: "bg-danger-soft text-danger" },
    { value: "extra", label: "Extra in .env", cls: "bg-info-soft text-info" },
    { value: "empty", label: "Empty in .env", cls: "bg-warn-soft text-warn" },
    { value: "different", label: "Different value", cls: "bg-accent-soft text-accent-strong dark:text-accent" },
    { value: "same", label: "Same", cls: "bg-subtle text-fg-muted" },
    { value: "duplicate", label: "Duplicate", cls: "bg-warn-soft text-warn" },
];
const statusMeta = (s: Status) => STATUS.find((x) => x.value === s)!;

interface Row {
    key: string; status: Status; dup: string;
    a?: Entry; b?: Entry; secret: boolean;
}

const SECRET_RE = /SECRET|TOKEN|KEY|PASSWORD|PASSWD|PASS|PRIVATE|CREDENTIAL|AUTH|SALT|SIGNATURE/i;
const CRED_URL_RE = /^[a-z][\w+.-]*:\/\/[^/\s:@]+(?::[^/\s@]*)?@/i;
const isSecret = (key: string, ...values: (string | undefined)[]) =>
    SECRET_RE.test(key) || values.some((v) => !!v && CRED_URL_RE.test(v));

const rows = computed<Row[]>(() => {
    const keys = [...new Set([...pa.value.map.keys(), ...pb.value.map.keys()])];
    return keys.map((key) => {
        const a = pa.value.map.get(key), b = pb.value.map.get(key);
        let status: Status;
        if (!b) status = "missing";
        else if (!a) status = "extra";
        else if (b.value === "" && a.value !== "") status = "empty";
        else status = a.value === b.value ? "same" : "different";
        const dupParts: string[] = [];
        const da = pa.value.dups.get(key), db = pb.value.dups.get(key);
        if (da) dupParts.push(`.env.example lines ${da.join(", ")}`);
        if (db) dupParts.push(`.env lines ${db.join(", ")}`);
        return { key, status, dup: dupParts.join("; "), a, b, secret: isSecret(key, a?.value, b?.value) };
    });
});

const counts = computed(() => {
    const c: Record<Status, number> = { missing: 0, extra: 0, empty: 0, same: 0, different: 0, duplicate: 0 };
    for (const r of rows.value) {
        c[r.status]++;
        if (r.dup) c.duplicate++;
    }
    return c;
});

const active = useStorage<Status[]>("devtools:env-diff:filter", []);
function toggleFilter(s: Status) {
    active.value = active.value.includes(s) ? active.value.filter((x) => x !== s) : [...active.value, s];
}
const visible = computed(() =>
    active.value.length ? rows.value.filter((r) => active.value.includes(r.status) || (r.dup && active.value.includes("duplicate"))) : rows.value,
);

/* ---------------- Masking ---------------- */

const showValues = ref(false);
const showTail = useStorage("devtools:env-diff:show-tail", false);
const revealed = ref(new Set<string>());
function toggleReveal(key: string) {
    const s = new Set(revealed.value);
    if (s.has(key)) s.delete(key);
    else s.add(key);
    revealed.value = s;
}
const isShown = (r: Row) => revealed.value.has(r.key) || (showValues.value && !r.secret);

function display(r: Row, v: string | undefined): { text: string; muted: boolean } {
    if (v === undefined) return { text: "—", muted: true };
    if (v === "") return { text: "(empty)", muted: true };
    if (isShown(r)) return { text: v, muted: false };
    return { text: "••••" + (showTail.value && v.length > 6 ? v.slice(-2) : ""), muted: true };
}

/* ---------------- Outputs ---------------- */

const missingBlock = computed(() => {
    const miss = rows.value.filter((r) => r.status === "missing");
    if (!miss.length) return "";
    return ["", "# Added from .env.example", ...miss.map((r) => `${r.key}=${quote(r.a?.value ?? "")}`)].join("\n").trimStart();
});

const keepComments = useStorage("devtools:env-diff:keep-comments", true);
const keepExampleDefaults = useStorage("devtools:env-diff:keep-defaults", true);

function quote(v: string): string {
    if (v === "") return "";
    return /[\s#"'\\]/.test(v) ? `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"` : v;
}

const syncedExample = computed(() => {
    const out: string[] = [];
    const done = new Set<string>();
    for (const l of pb.value.lines) {
        if (l.kind === "blank") {
            if (keepComments.value && out.length && out[out.length - 1] !== "") out.push("");
        } else if (l.kind === "comment") {
            if (keepComments.value) out.push(l.text);
        } else if (!done.has(l.key)) {
            done.add(l.key);
            const ex = pa.value.map.get(l.key);
            const keepDefault = keepExampleDefaults.value && ex && !isSecret(l.key, ex.value);
            out.push(`${l.key}=${keepDefault ? quote(ex!.value) : ""}`);
        }
    }
    while (out.length && out[out.length - 1] === "") out.pop();
    return out.join("\n") + (out.length ? "\n" : "");
});

function swap() {
    [example.value, env.value] = [env.value, example.value];
}
function loadSample() {
    example.value = SAMPLE_EXAMPLE;
    env.value = SAMPLE_ENV;
}

useHandoff<{ left?: string; right?: string; input?: string }>("env-diff", (p) => {
    if (p.left != null) example.value = p.left;
    if (p.right != null) env.value = p.right;
    else if (p.input != null) env.value = p.input;
});
</script>

<template>
    <ToolPage>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <label class="flex items-center gap-2" title="Off by default: the .env side is kept in memory only and is cleared when you close the tab.">
                <input v-model="rememberEnv" type="checkbox" class="checkbox" /> Remember .env on this device
            </label>
            <span class="text-xs text-muted">Everything stays in your browser; nothing is uploaded.</span>
            <div class="ml-auto flex flex-wrap items-center gap-1">
                <Btn size="sm" variant="ghost" @click="loadSample"><Sparkles /> Sample</Btn>
                <Btn size="sm" variant="ghost" @click="swap"><ArrowLeftRight /> Swap</Btn>
                <Btn size="sm" variant="ghost" :disabled="!example && !env" @click="example = ''; env = ''"><Trash2 /> Clear</Btn>
            </div>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
            <Panel flush>
                <template #title>.env.example <span class="ml-1 text-xs font-normal text-muted">editable · {{ pa.map.size }} keys</span></template>
                <CodeArea v-model="example" language="ini" height="18rem" placeholder="Paste .env.example…" />
            </Panel>
            <Panel flush>
                <template #title>.env <span class="ml-1 text-xs font-normal text-muted">editable · {{ pb.map.size }} keys{{ rememberEnv ? "" : " · not saved" }}</span></template>
                <CodeArea v-model="env" language="ini" height="18rem" placeholder="Paste your .env…" />
            </Panel>
        </div>

        <Notice v-if="pa.invalid.length || pb.invalid.length" type="warning">
            <p class="font-medium">Lines that could not be parsed</p>
            <ul class="mt-1 space-y-0.5 font-mono text-xs">
                <li v-for="x in pa.invalid" :key="'a' + x.line">.env.example:{{ x.line }} · {{ x.reason }} · {{ x.text.slice(0, 60) }}</li>
                <li v-for="x in pb.invalid" :key="'b' + x.line">.env:{{ x.line }} · {{ x.reason }}</li>
            </ul>
        </Notice>

        <Panel flush>
            <template #title>Comparison</template>
            <template #actions>
                <label class="flex items-center gap-1.5 px-1 text-xs text-fg-muted"><input v-model="showTail" type="checkbox" class="checkbox" /> Show last 2 chars</label>
                <Btn size="sm" variant="ghost" @click="showValues = !showValues">
                    <EyeOff v-if="showValues" /><Eye v-else /> {{ showValues ? "Hide values" : "Show values" }}
                </Btn>
            </template>
            <div class="flex flex-wrap gap-1.5 border-b border-line px-4 py-2">
                <button
                    v-for="s in STATUS"
                    :key="s.value"
                    type="button"
                    class="cursor-pointer rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 transition-opacity ring-inset"
                    :class="[s.cls, active.includes(s.value) ? 'ring-current' : 'ring-transparent', active.length && !active.includes(s.value) ? 'opacity-50' : '']"
                    :aria-pressed="active.includes(s.value)"
                    @click="toggleFilter(s.value)"
                >{{ s.label }} <span class="tabular-nums">{{ counts[s.value] }}</span></button>
                <button v-if="active.length" type="button" class="chip cursor-pointer" @click="active = []">Show all</button>
            </div>
            <div v-if="!rows.length" class="p-6 text-center text-sm text-muted">Paste both files to compare them.</div>
            <div v-else class="max-h-[30rem] overflow-auto">
                <table class="w-full text-sm">
                    <thead class="sticky top-0 bg-surface text-left text-xs text-muted uppercase">
                        <tr>
                            <th class="px-4 py-2 font-medium">Key</th>
                            <th class="px-4 py-2 font-medium">Status</th>
                            <th class="px-4 py-2 font-medium">.env.example</th>
                            <th class="px-4 py-2 font-medium">.env</th>
                            <th class="w-10 px-2 py-2"><span class="sr-only">Reveal</span></th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-line border-t border-line">
                        <tr v-for="r in visible" :key="r.key" class="align-top">
                            <td class="px-4 py-1.5 font-mono text-xs break-all text-fg">
                                {{ r.key }}
                                <span v-if="r.secret" class="ml-1 chip !px-1.5 !text-[10px]">secret</span>
                            </td>
                            <td class="px-4 py-1.5 whitespace-nowrap">
                                <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="statusMeta(r.status).cls">{{ statusMeta(r.status).label }}</span>
                                <span v-if="r.dup" class="mt-1 block text-[11px] text-warn" :title="r.dup">Duplicate: {{ r.dup }}</span>
                            </td>
                            <td class="max-w-[16rem] px-4 py-1.5 font-mono text-xs break-all whitespace-pre-wrap" :class="display(r, r.a?.value).muted ? 'text-muted' : 'text-fg'">{{ display(r, r.a?.value).text }}</td>
                            <td class="max-w-[16rem] px-4 py-1.5 font-mono text-xs break-all whitespace-pre-wrap" :class="display(r, r.b?.value).muted ? 'text-muted' : 'text-fg'">{{ display(r, r.b?.value).text }}</td>
                            <td class="px-2 py-1">
                                <Btn size="sm" variant="ghost" :title="isShown(r) ? 'Hide values' : 'Reveal values'" @click="toggleReveal(r.key)">
                                    <EyeOff v-if="isShown(r)" /><Eye v-else />
                                </Btn>
                            </td>
                        </tr>
                    </tbody>
                </table>
                <p v-if="!visible.length" class="p-4 text-center text-sm text-muted">No keys match the selected filters.</p>
            </div>
        </Panel>

        <div class="grid gap-4 lg:grid-cols-2">
            <Panel title="Missing keys to append to .env" flush>
                <template #actions><CopyButton :text="missingBlock" /></template>
                <div v-if="!missingBlock" class="p-4"><Notice type="success">Your .env has every key from .env.example.</Notice></div>
                <CodeArea v-else :model-value="missingBlock" language="ini" readonly height="12rem" />
            </Panel>
            <Panel title="Synced .env.example" flush>
                <template #actions>
                    <label class="flex items-center gap-1.5 px-1 text-xs text-fg-muted"><input v-model="keepComments" type="checkbox" class="checkbox" /> Comments</label>
                    <label class="flex items-center gap-1.5 px-1 text-xs text-fg-muted" title="Reuse non-secret placeholder values from the current .env.example"><input v-model="keepExampleDefaults" type="checkbox" class="checkbox" /> Keep example defaults</label>
                    <CopyButton :text="syncedExample" />
                </template>
                <CodeArea :model-value="syncedExample" language="ini" readonly height="12rem" placeholder="Keys from .env with values blanked" />
            </Panel>
        </div>
    </ToolPage>
</template>
