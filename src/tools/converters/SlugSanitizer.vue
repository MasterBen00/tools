<script setup lang="ts">
import { useHandoff } from "@/composables/handoff";
import { computed } from "vue";
import { useStorage } from "@vueuse/core";
import { Sparkles, Trash2 } from "lucide-vue-next";
import { Btn, CodeArea, CopyButton, Panel, Tabs, ToolPage } from "@/components/ui";

type Mode = "slug" | "filename" | "identifier";
type IdCase = "snake" | "camel" | "pascal" | "constant";

const SAMPLE = `10 Tips for Writing Clean Java Code in 2026!
আমার সোনার বাংলা
বাংলাদেশ
ঢাকা শহরের সেরা খাবার
Crème Brûlée & Café au Lait @ Zürich
Łódź, Kraków — Straße der Æsir
Привет, мир: Spring Boot 3
  Final Report (v2) — FINAL!! <draft>?.PDF
CON.txt`;

const input = useStorage("devtools:slug-generator:input", SAMPLE);
const o = useStorage(
    "devtools:slug-generator:options",
    {
        mode: "slug" as Mode,
        idCase: "snake" as IdCase,
        lowercase: true,
        separator: "-",
        maxLength: 0,
        stopWords: false,
        collapseRepeats: true,
        umlautExpand: false,
        symbols: true,
        asciiOnly: true,
        unique: false,
    },
    undefined,
    { mergeDefaults: true },
);

/* ---------------- Bangla → Latin ---------------- */

const BN_CONS: Record<string, string> = {
    "ক": "k", "খ": "kh", "গ": "g", "ঘ": "gh", "ঙ": "ng",
    "চ": "ch", "ছ": "chh", "জ": "j", "ঝ": "jh", "ঞ": "n",
    "ট": "t", "ঠ": "th", "ড": "d", "ঢ": "dh", "ণ": "n",
    "ত": "t", "থ": "th", "দ": "d", "ধ": "dh", "ন": "n",
    "প": "p", "ফ": "f", "ব": "b", "ভ": "bh", "ম": "m",
    "য": "j", "র": "r", "ল": "l", "শ": "sh", "ষ": "sh", "স": "s", "হ": "h",
    "ড়": "r", "ঢ়": "rh", "য়": "y",
};
// Consonant + nukta (decomposed form) → the precomposed letter.
const BN_NUKTA: Record<string, string> = { "ড": "ড়", "ঢ": "ঢ়", "য": "য়" };
// Second member of a conjunct (after hasanta) that reads differently.
const BN_PHALA: Record<string, string> = { "য": "y", "ব": "w" };
const BN_VOWEL: Record<string, string> = {
    "অ": "o", "আ": "a", "ই": "i", "ঈ": "i", "উ": "u", "ঊ": "u", "ঋ": "ri",
    "এ": "e", "ঐ": "oi", "ও": "o", "ঔ": "ou",
};
const BN_SIGN: Record<string, string> = {
    "া": "a", "ি": "i", "ী": "i", "ু": "u", "ূ": "u", "ৃ": "ri",
    "ে": "e", "ৈ": "oi", "ো": "o", "ৌ": "ou",
};
const BN_OTHER: Record<string, string> = { "ং": "ng", "ঃ": "h", "ঁ": "", "ৎ": "t", "।": ". ", "॥": ". " };
const HASANTA = "্", NUKTA = "়";
const BN_DIGIT = "০১২৩৪৫৬৭৮৯";

const isCons = (c: string | undefined) => c !== undefined && (c in BN_CONS || c in BN_NUKTA);
const isSign = (c: string | undefined) => c !== undefined && c in BN_SIGN;

function bangla(text: string): string {
    if (!/[ঀ-৿]/.test(text)) return text;
    const s = [...text.normalize("NFC")];
    let out = "";
    let prevVowel = false; // last emitted sound was a vowel
    let afterHasanta = false; // current consonant is the second half of a conjunct
    for (let i = 0; i < s.length; i++) {
        let c = s[i];
        if (isCons(c)) {
            if (s[i + 1] === NUKTA && BN_NUKTA[c]) {
                c = BN_NUKTA[c];
                i++;
            }
            out += afterHasanta && BN_PHALA[c] ? BN_PHALA[c] : BN_CONS[c] ?? "";
            const conj = afterHasanta;
            afterHasanta = false;
            const next = s[i + 1];
            if (isSign(next)) {
                out += BN_SIGN[next];
                i++;
                prevVowel = true;
            } else if (next === HASANTA) {
                i++;
                afterHasanta = isCons(s[i + 1]);
                prevVowel = false;
            } else if (isCons(next)) {
                // Schwa deletion: V C(o) C V → drop the inherent vowel ("আমরা" → amra, "রহমান" → rohman).
                let k = i + 1;
                if (s[k + 1] === NUKTA) k++;
                const nextHasVowel = isSign(s[k + 1]);
                if (prevVowel && !conj && nextHasVowel) prevVowel = false;
                else {
                    out += "o";
                    prevVowel = true;
                }
            } else if (next === "ং" || next === "ঃ" || next === "ঁ") {
                out += "o";
                prevVowel = true;
            } else {
                // Word end: inherent vowel is silent ("দেশ" → desh), but conjunct endings keep it ("বিশ্ব" → bishwo).
                if (conj) out += "o";
                prevVowel = false;
            }
            continue;
        }
        afterHasanta = false;
        if (c in BN_VOWEL) {
            out += BN_VOWEL[c];
            prevVowel = true;
        } else if (c in BN_SIGN) {
            out += BN_SIGN[c];
            prevVowel = true;
        } else if (c in BN_OTHER) {
            out += BN_OTHER[c];
            prevVowel = false;
        } else if (BN_DIGIT.includes(c)) {
            out += String(BN_DIGIT.indexOf(c));
            prevVowel = false;
        } else if (c === HASANTA || c === NUKTA || c === "‌" || c === "‍") {
            // stray marks / joiners
        } else {
            out += c;
            prevVowel = false;
        }
    }
    return out;
}

/* ---------------- Latin extended, Cyrillic, symbols ---------------- */

const LATIN: Record<string, string> = {
    "ß": "ss", "ẞ": "SS", "æ": "ae", "Æ": "AE", "œ": "oe", "Œ": "OE", "ø": "o", "Ø": "O",
    "đ": "d", "Đ": "D", "ð": "d", "Ð": "D", "þ": "th", "Þ": "TH", "ł": "l", "Ł": "L",
    "ı": "i", "ħ": "h", "Ħ": "H", "ŧ": "t", "Ŧ": "T", "ŋ": "ng", "Ŋ": "NG", "ĸ": "k", "ſ": "s",
};
const UMLAUT: Record<string, string> = { "ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue" };
const CYR: Record<string, string> = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo", "ж": "zh", "з": "z", "и": "i",
    "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t",
    "у": "u", "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch", "ъ": "", "ы": "y", "ь": "",
    "э": "e", "ю": "yu", "я": "ya", "є": "ye", "і": "i", "ї": "yi", "ґ": "g", "ў": "u", "ђ": "dj", "ј": "j",
    "љ": "lj", "њ": "nj", "ћ": "c", "џ": "dz",
};
const SYMBOLS: Record<string, string> = {
    "&": " and ", "@": " at ", "%": " percent ", "+": " plus ", "=": " equals ",
    "€": " euro ", "$": " dollar ", "£": " pound ", "¥": " yen ", "৳": " taka ", "₹": " rupee ", "#": " number ",
};
const STOP = new Set(
    "a an the and or but nor of to in on at for with by from as is are was were be been it its this that these those into about over than then so if your you our we my i how what why when".split(" "),
);
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function mapChars(s: string, table: Record<string, string>): string {
    let out = "";
    for (const ch of s) {
        const lower = ch.toLowerCase();
        if (table[ch] !== undefined) out += table[ch];
        else if (table[lower] !== undefined) {
            const t = table[lower];
            out += ch !== lower && t ? t[0].toUpperCase() + t.slice(1) : t;
        } else out += ch;
    }
    return out;
}

function transliterate(s: string): string {
    let t = bangla(s);
    if (o.value.umlautExpand) t = mapChars(t, UMLAUT);
    t = mapChars(t, LATIN);
    t = mapChars(t, CYR);
    if (o.value.symbols) t = mapChars(t, SYMBOLS);
    t = t.normalize("NFKD").replace(/\p{M}+/gu, "");
    return t;
}

/** Split into words of allowed characters. */
function words(s: string): string[] {
    const re = o.value.asciiOnly ? /[A-Za-z0-9]+/g : /[\p{L}\p{N}]+/gu;
    let w = (s.replace(/['’]/g, "").match(re) ?? []) as string[];
    if (o.value.stopWords) {
        const kept = w.filter((x) => !STOP.has(x.toLowerCase()));
        if (kept.length) w = kept;
    }
    if (o.value.collapseRepeats) w = w.filter((x, i) => i === 0 || x.toLowerCase() !== w[i - 1].toLowerCase());
    return w;
}

function truncate(s: string, max: number, sep: string): string {
    if (!max || s.length <= max) return s;
    let cut = s.slice(0, max);
    const idx = sep ? cut.lastIndexOf(sep) : -1;
    if (idx > 0 && s[max] !== sep) cut = cut.slice(0, idx);
    return sep ? cut.replace(new RegExp(`${escapeRe(sep)}+$`), "") : cut;
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function toIdentifier(w: string[]): string {
    if (!w.length) return "";
    let id: string;
    switch (o.value.idCase) {
        case "snake": id = w.join("_").toLowerCase(); break;
        case "constant": id = w.join("_").toUpperCase(); break;
        case "camel":
        case "pascal": {
            id = w.map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase()).join("");
            if (o.value.idCase === "camel") id = id[0].toLowerCase() + id.slice(1);
            break;
        }
    }
    if (/^\d/.test(id)) id = "_" + id;
    return o.value.maxLength ? truncate(id, o.value.maxLength, o.value.idCase === "snake" || o.value.idCase === "constant" ? "_" : "") : id;
}

function convert(line: string): { out: string; note?: string } {
    const mode = o.value.mode;
    const sep = o.value.separator;
    if (mode === "identifier") return { out: toIdentifier(words(transliterate(line))) };

    if (mode === "slug") {
        let s = words(transliterate(line)).join(sep);
        if (o.value.lowercase) s = s.toLowerCase();
        return { out: truncate(s, o.value.maxLength, sep) };
    }

    // Filename: keep the extension, strip Windows-reserved and control characters.
    const trimmed = line.trim();
    const m = /^(.+?)\.([A-Za-z0-9]{1,10})$/.exec(trimmed);
    let base = m ? m[1] : trimmed;
    let ext = m ? m[2] : "";
    base = transliterate(base).replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ");
    const allowed = o.value.asciiOnly ? /[^A-Za-z0-9._-]+/g : /[^\p{L}\p{N}._-]+/gu;
    const parts = base.replace(allowed, " ").split(/\s+/).filter(Boolean);
    let w = parts;
    if (o.value.stopWords) {
        const kept = w.filter((x) => !STOP.has(x.toLowerCase()));
        if (kept.length) w = kept;
    }
    if (o.value.collapseRepeats) w = w.filter((x, i) => i === 0 || x.toLowerCase() !== w[i - 1].toLowerCase());
    let name = w.join(sep).replace(new RegExp(`[${escapeRe(sep)}]{2,}`, "g"), sep);
    name = name.replace(/^[.\s]+|[.\s]+$/g, "").replace(/[-_]+$/, "");
    if (o.value.lowercase) {
        name = name.toLowerCase();
        ext = ext.toLowerCase();
    }
    let note: string | undefined;
    if (!name) {
        name = "file";
        note = "empty name";
    }
    if (RESERVED.test(name.split(".")[0])) {
        name = `${name}${sep}file`;
        note = "reserved Windows name";
    }
    const dotExt = ext ? "." + ext : "";
    if (o.value.maxLength) name = truncate(name, Math.max(1, o.value.maxLength - dotExt.length), sep);
    return { out: name.replace(/[. ]+$/, "") + dotExt, note };
}

interface Row { input: string; out: string; note?: string }

const rows = computed<Row[]>(() => {
    const out: Row[] = [];
    const seen = new Map<string, number>();
    for (const line of input.value.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const r = convert(line);
        let res = r.out;
        let note = r.note;
        if (o.value.unique && res) {
            const n = seen.get(res) ?? 0;
            seen.set(res, n + 1);
            if (n) {
                const sep = o.value.mode === "identifier" ? "_" : o.value.separator;
                const dot = o.value.mode === "filename" ? res.lastIndexOf(".") : -1;
                res = dot > 0 ? `${res.slice(0, dot)}${sep}${n + 1}${res.slice(dot)}` : `${res}${sep}${n + 1}`;
                note = "made unique";
            }
        }
        out.push({ input: line, out: res, note });
    }
    return out;
});

const allText = computed(() => rows.value.map((r) => r.out).join("\n"));

const maxModel = computed({
    get: () => o.value.maxLength || "",
    set: (v: number | string) => (o.value.maxLength = Math.max(0, Math.floor(Number(v) || 0))),
});

useHandoff<{ input?: string; mode?: Mode }>("slug-generator", (p) => {
    if (p.input != null) input.value = p.input;
    if (p.mode) o.value.mode = p.mode;
});
</script>

<template>
    <ToolPage>
        <template #actions>
            <Tabs
                v-model="o.mode"
                :options="[
                    { value: 'slug', label: 'Slug (URL)' },
                    { value: 'filename', label: 'Filename' },
                    { value: 'identifier', label: 'Identifier' },
                ]"
            />
        </template>

        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <Tabs
                v-if="o.mode === 'identifier'"
                v-model="o.idCase"
                size="sm"
                :options="[
                    { value: 'snake', label: 'snake_case' },
                    { value: 'camel', label: 'camelCase' },
                    { value: 'pascal', label: 'PascalCase' },
                    { value: 'constant', label: 'CONSTANT_CASE' },
                ]"
            />
            <template v-else>
                <label class="flex items-center gap-2">
                    Separator
                    <select v-model="o.separator" class="select !w-auto !py-1">
                        <option value="-">- hyphen</option>
                        <option value="_">_ underscore</option>
                        <option value=".">. dot</option>
                    </select>
                </label>
                <label class="flex items-center gap-2"><input v-model="o.lowercase" type="checkbox" class="checkbox" /> Lowercase</label>
            </template>
            <label class="flex items-center gap-2">
                Max length
                <input v-model="maxModel" type="number" min="0" placeholder="none" class="input !w-24 !py-1" />
            </label>
            <label class="flex items-center gap-2"><input v-model="o.stopWords" type="checkbox" class="checkbox" /> Remove stop words</label>
            <label class="flex items-center gap-2"><input v-model="o.collapseRepeats" type="checkbox" class="checkbox" /> Collapse repeated words</label>
            <label class="flex items-center gap-2"><input v-model="o.unique" type="checkbox" class="checkbox" /> Make unique</label>
            <label class="flex items-center gap-2"><input v-model="o.symbols" type="checkbox" class="checkbox" /> Symbols as words (&amp; → and)</label>
            <label class="flex items-center gap-2"><input v-model="o.umlautExpand" type="checkbox" class="checkbox" /> German umlauts (ä → ae)</label>
            <label class="flex items-center gap-2"><input v-model="o.asciiOnly" type="checkbox" class="checkbox" /> ASCII only</label>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
            <Panel title="Input (one per line)" flush>
                <template #actions>
                    <Btn size="sm" variant="ghost" @click="input = SAMPLE"><Sparkles /> Sample</Btn>
                    <Btn size="sm" variant="ghost" :disabled="!input" @click="input = ''"><Trash2 /> Clear</Btn>
                </template>
                <CodeArea v-model="input" height="18rem" placeholder="Titles, file names or labels, one per line…" />
            </Panel>
            <Panel flush>
                <template #title>
                    Output <span class="ml-1 text-xs font-normal text-muted">{{ rows.length }} line{{ rows.length === 1 ? "" : "s" }}</span>
                </template>
                <template #actions><CopyButton :text="allText" label="Copy all" /></template>
                <div v-if="!rows.length" class="p-6 text-center text-sm text-muted">Results appear here.</div>
                <div v-else class="max-h-[18rem] overflow-auto">
                    <ul class="divide-y divide-line">
                        <li v-for="(r, i) in rows" :key="i" class="flex items-center gap-2 px-4 py-2">
                            <div class="min-w-0 flex-1">
                                <p class="truncate text-xs text-muted" :title="r.input">{{ r.input.trim() }}</p>
                                <p class="font-mono text-[13px] break-all text-fg">
                                    <span v-if="r.out">{{ r.out }}</span><span v-else class="text-muted italic">(empty)</span>
                                </p>
                            </div>
                            <span v-if="r.note" class="chip !text-warn">{{ r.note }}</span>
                            <span class="font-mono text-[11px] text-muted tabular-nums">{{ r.out.length }}</span>
                            <CopyButton :text="r.out" icon-only label="Copy" />
                        </li>
                    </ul>
                </div>
            </Panel>
        </div>
        <p class="text-xs text-muted">
            Transliterates Bangla (বাংলাদেশ → bangladesh), Cyrillic and accented Latin, then strips remaining diacritics.
            Filename mode keeps the extension, removes the Windows-reserved characters &lt; &gt; : &quot; / \ | ? *, renames reserved names such as CON or LPT1 and trims trailing dots and spaces.
        </p>
    </ToolPage>
</template>
