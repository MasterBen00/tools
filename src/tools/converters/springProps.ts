// Spring Boot application.properties <-> application.yml conversion.
// Values stay strings: nothing is re-typed, and YAML output is quoted whenever a plain scalar
// would be read back as something else (08, 010, yes, 12:30, 2024-01-01, 1_000, ...).
import { DUMP_SCHEMA, FAILSAFE_SCHEMA, load, loadAll, mergeTag, nullCoreTag, realMapTag } from "js-yaml";

export interface ConvertResult {
    out: string;
    error?: string;
    notes: string[];
    docs: number;
}

class LineError extends Error {}

// ---------------------------------------------------------------- properties reader

interface Entry {
    key: string;
    value: string;
    line: number;
}

function unescapeProps(s: string, line: number): string {
    let out = "";
    for (let i = 0; i < s.length; i++) {
        const c = s[i]!;
        if (c !== "\\") {
            out += c;
            continue;
        }
        const n = s[++i];
        if (n === undefined) break;
        if (n === "u") {
            const hex = s.slice(i + 1, i + 5);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new LineError(`Line ${line}: malformed \\uxxxx escape`);
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
        } else out += n === "t" ? "\t" : n === "n" ? "\n" : n === "r" ? "\r" : n === "f" ? "\f" : n;
    }
    return out;
}

/** Splits a .properties text into Spring documents (separated by `#---` / `!---`). */
export function readProperties(text: string): { docs: Entry[][]; comments: number } {
    const lines = text.split(/\r?\n/);
    const docs: Entry[][] = [[]];
    let comments = 0;
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i]!;
        const trimmed = raw.replace(/^[ \t\f]+/, "");
        if (!trimmed) continue;
        if (trimmed[0] === "#" || trimmed[0] === "!") {
            if (/^[#!]---\s*$/.test(raw)) docs.push([]);
            else comments++;
            continue;
        }
        const start = i + 1;
        let logical = trimmed;
        // A line ending in an odd number of backslashes continues on the next line.
        while (/(^|[^\\])(\\\\)*\\$/.test(logical) && i + 1 < lines.length) {
            logical = logical.slice(0, -1) + lines[++i]!.replace(/^[ \t\f]+/, "");
        }
        if (/(^|[^\\])(\\\\)*\\$/.test(logical)) logical = logical.slice(0, -1);
        let k = 0;
        while (k < logical.length) {
            const c = logical[k]!;
            if (c === "\\") k += 2;
            else if (c === "=" || c === ":" || c === " " || c === "\t" || c === "\f") break;
            else k++;
        }
        const rawKey = logical.slice(0, Math.min(k, logical.length));
        let v = k;
        while (v < logical.length && /[ \t\f]/.test(logical[v]!)) v++;
        if (logical[v] === "=" || logical[v] === ":") v++;
        while (v < logical.length && /[ \t\f]/.test(logical[v]!)) v++;
        docs[docs.length - 1]!.push({ key: unescapeProps(rawKey, start), value: unescapeProps(logical.slice(v), start), line: start });
    }
    return { docs, comments };
}

// ---------------------------------------------------------------- tree

type Seg = { k: "key"; name: string } | { k: "idx"; i: number };
type PNode = { t: "map"; m: Map<string, PNode>; line: number } | { t: "list"; a: Map<number, PNode>; line: number } | { t: "val"; v: string; line: number };

function parsePath(key: string, line: number): Seg[] {
    const segs: Seg[] = [];
    let buf = "";
    let afterBracket = false;
    const bad = (why: string) => new LineError(`Line ${line}: invalid key '${key}' (${why})`);
    for (let i = 0; i < key.length; i++) {
        const c = key[i]!;
        if (c === ".") {
            if (!buf && !afterBracket) throw bad("empty segment");
            if (buf) segs.push({ k: "key", name: buf });
            buf = "";
            afterBracket = false;
        } else if (c === "[") {
            if (buf) segs.push({ k: "key", name: buf });
            buf = "";
            const end = key.indexOf("]", i);
            if (end < 0) throw bad("missing ]");
            const inner = key.slice(i + 1, end);
            if (/^\d+$/.test(inner)) segs.push({ k: "idx", i: Number(inner) });
            else segs.push({ k: "key", name: `[${inner}]` });
            i = end;
            afterBracket = true;
        } else {
            if (afterBracket) throw bad("expected . or [ after ]");
            buf += c;
        }
    }
    if (buf) segs.push({ k: "key", name: buf });
    else if (!afterBracket) throw bad(key ? "ends with ." : "empty key");
    return segs;
}

function describe(segs: Seg[], n: number) {
    return segs
        .slice(0, n)
        .map((s, i) => (s.k === "idx" ? `[${s.i}]` : s.name.startsWith("[") ? s.name : i ? "." + s.name : s.name))
        .join("");
}

function buildTree(entries: Entry[], notes: string[]): PNode {
    const root: PNode = { t: "map", m: new Map(), line: 0 };
    for (const e of entries) {
        const segs = parsePath(e.key, e.line);
        let node: PNode = root;
        for (let s = 0; s < segs.length; s++) {
            const seg = segs[s]!;
            const last = s === segs.length - 1;
            const want = seg.k === "idx" ? "list" : "map";
            if (node.t !== want) {
                const where = describe(segs, s) || "(root)";
                if (node.t === "val")
                    throw new LineError(`Line ${e.line}: '${e.key}' needs '${where}' to be a ${want === "list" ? "list" : "map"}, but line ${node.line} gave it a plain value. YAML cannot hold both.`);
                throw new LineError(`Line ${e.line}: '${where}' is used both as a list and as a map (also on line ${node.line}).`);
            }
            const container: Map<string | number, PNode> = node.t === "map" ? node.m : (node as Extract<PNode, { t: "list" }>).a;
            const id = seg.k === "idx" ? seg.i : seg.name;
            const existing = container.get(id);
            if (last) {
                if (existing && existing.t !== "val")
                    throw new LineError(`Line ${e.line}: '${e.key}' is a plain value, but line ${existing.line} already uses it as a ${existing.t === "list" ? "list" : "map"}. YAML cannot hold both.`);
                if (existing) notes.push(`Line ${e.line}: '${e.key}' repeats line ${existing.line}; the later value wins (as in Spring).`);
                container.set(id, { t: "val", v: e.value, line: e.line });
            } else {
                const nextWant = segs[s + 1]!.k === "idx" ? "list" : "map";
                let child = existing;
                if (!child) {
                    child = nextWant === "list" ? { t: "list", a: new Map(), line: e.line } : { t: "map", m: new Map(), line: e.line };
                    container.set(id, child);
                }
                node = child;
            }
        }
    }
    return root;
}

// ---------------------------------------------------------------- YAML writer

const INT_RE = /^-?(0|[1-9]\d*)$/;

function yamlReadsBackAs(v: string): boolean {
    try {
        const doc = load(`k: ${v}`, { schema: DUMP_SCHEMA }) as Record<string, unknown> | null;
        return !!doc && typeof doc === "object" && Object.keys(doc).length === 1 && doc.k === v;
    } catch {
        return false;
    }
}

export function yamlScalar(v: string): string {
    if (v === "") return '""';
    if (INT_RE.test(v) && v.length < 19) return v;
    if (v === "true" || v === "false") return v;
    const plainOk =
        !/[\n\r\t\0-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v) &&
        v.trim() === v &&
        !/^[-?:,[\]{}#&*!|>'"%@`]/.test(v) &&
        !/(:\s|\s#|:$)/.test(v) &&
        yamlReadsBackAs(v);
    if (plainOk) return v;
    if (/[\n\r\t\0-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v)) return JSON.stringify(v);
    return `'${v.replace(/'/g, "''")}'`;
}

function yamlKey(k: string): string {
    if (/^[A-Za-z0-9_][A-Za-z0-9_\-]*$/.test(k) && yamlReadsBackAs(k)) return k;
    return k.startsWith("[") ? `"${k.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : yamlScalar(k);
}

function renderYaml(node: PNode, indent: number, path: string, notes: string[]): string[] {
    const pad = " ".repeat(indent);
    const out: string[] = [];
    if (node.t === "map") {
        for (const [k, child] of node.m) {
            const key = yamlKey(k);
            const childPath = path ? (k.startsWith("[") ? path + k : `${path}.${k}`) : k;
            if (child.t === "val") out.push(`${pad}${key}: ${yamlScalar(child.v)}`);
            else {
                out.push(`${pad}${key}:`);
                out.push(...renderYaml(child, indent + 2, childPath, notes));
            }
        }
    } else if (node.t === "list") {
        const idx = [...node.a.keys()].sort((a, b) => a - b);
        if (idx.some((n, i) => n !== i)) notes.push(`'${path}' has index gaps (${idx.join(", ")}); the YAML list is written without them.`);
        for (const n of idx) {
            const child = node.a.get(n)!;
            if (child.t === "val") out.push(`${pad}- ${yamlScalar(child.v)}`);
            else {
                const lines = renderYaml(child, indent + 2, `${path}[${n}]`, notes);
                if (lines.length) lines[0] = `${pad}- ${lines[0]!.slice(indent + 2)}`;
                out.push(...lines);
            }
        }
    }
    return out;
}

export function propertiesToYaml(text: string): ConvertResult {
    const notes: string[] = [];
    if (!text.trim()) return { out: "", notes, docs: 0 };
    try {
        const { docs, comments } = readProperties(text);
        const parts: string[] = [];
        docs.forEach((entries, i) => {
            const tree = buildTree(entries, notes);
            const profile = entries.find((e) => e.key === "spring.config.activate.on-profile");
            const legacy = entries.find((e) => e.key === "spring.profiles");
            if (docs.length > 1) notes.push(`Document ${i + 1}: ${entries.length} propert${entries.length === 1 ? "y" : "ies"}${profile ? `, active for profile '${profile.value}'` : i === 0 ? " (default)" : ""}.`);
            if (legacy && i > 0) notes.push(`Line ${legacy.line}: spring.profiles in a profile document is deprecated since Boot 2.4; use spring.config.activate.on-profile.`);
            parts.push(renderYaml(tree, 0, "", notes).join("\n"));
        });
        if (comments) notes.unshift(`${comments} comment line${comments === 1 ? " was" : "s were"} dropped (YAML output carries no comments).`);
        return { out: parts.map((p) => (p ? p + "\n" : "{}\n")).join("---\n"), notes, docs: docs.length };
    } catch (e) {
        return { out: "", error: (e as Error).message, notes, docs: 0 };
    }
}

// ---------------------------------------------------------------- YAML reader -> properties

const YAML_READ_SCHEMA = FAILSAFE_SCHEMA.withTags(nullCoreTag, mergeTag, realMapTag);

const ESC: Record<string, string> = { "\\": "\\\\", " ": "\\ ", ":": "\\:", "=": "\\=", "\t": "\\t", "\n": "\\n", "\r": "\\r", "\f": "\\f" };

function escapeKey(k: string) {
    return k.replace(/[\\ :=\t\n\r\f]/g, (c) => ESC[c]!).replace(/^[#!]/, "\\$&");
}

function escapeValue(v: string, ascii: boolean) {
    let s = v.replace(/[\\\t\n\r\f]/g, (c) => ESC[c]!);
    s = s.replace(/^ /, "\\ ");
    if (ascii) s = s.replace(/[^\x00-\x7f]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
    return s;
}

function flatten(v: unknown, prefix: string, out: [string, string][], notes: string[]) {
    if (v instanceof Map) {
        if (!v.size) {
            if (prefix) {
                out.push([prefix, ""]);
                notes.push(`'${prefix}' is an empty map; written as an empty value.`);
            }
            return;
        }
        for (const [k, child] of v) {
            const key = String(k ?? "");
            const p = !prefix ? key : key.startsWith("[") && key.endsWith("]") ? prefix + key : `${prefix}.${key}`;
            flatten(child, p, out, notes);
        }
    } else if (Array.isArray(v)) {
        if (!v.length) {
            out.push([prefix, ""]);
            notes.push(`'${prefix}' is an empty list; written as an empty value.`);
        }
        v.forEach((item, i) => flatten(item, `${prefix}[${i}]`, out, notes));
    } else out.push([prefix, v == null ? "" : String(v)]);
}

export function yamlToProperties(text: string, opts: { ascii: boolean; group: boolean }): ConvertResult {
    const notes: string[] = [];
    if (!text.trim()) return { out: "", notes, docs: 0 };
    let docs: unknown[];
    try {
        docs = loadAll(text, { schema: YAML_READ_SCHEMA });
    } catch (e) {
        const err = e as { reason?: string; mark?: { line: number; column: number }; message?: string };
        return { out: "", error: err.mark ? `Line ${err.mark.line + 1}, column ${err.mark.column + 1}: ${err.reason}` : String(err.message ?? e), notes, docs: 0 };
    }
    docs = docs.filter((d) => d != null);
    const parts: string[] = [];
    for (let i = 0; i < docs.length; i++) {
        const d = docs[i];
        if (!(d instanceof Map)) return { out: "", error: `Document ${i + 1}: the top level must be a map of keys, not a ${Array.isArray(d) ? "list" : "plain value"}.`, notes, docs: 0 };
        const pairs: [string, string][] = [];
        flatten(d, "", pairs, notes);
        const profile = pairs.find(([k]) => k === "spring.config.activate.on-profile");
        if (docs.length > 1) notes.push(`Document ${i + 1}: ${pairs.length} propert${pairs.length === 1 ? "y" : "ies"}${profile ? `, active for profile '${profile[1]}'` : i === 0 ? " (default)" : ""}.`);
        let lastTop = "";
        const lines: string[] = [];
        for (const [k, v] of pairs) {
            const top = k.split(/[.[]/)[0]!;
            if (opts.group && lines.length && top !== lastTop) lines.push("");
            lastTop = top;
            lines.push(`${escapeKey(k)}=${escapeValue(v, opts.ascii)}`);
        }
        parts.push(lines.join("\n"));
    }
    if (/^\s*#(?!---)/m.test(text)) notes.unshift("Comments were dropped.");
    if (docs.length > 1) notes.push("Documents are separated with #--- (Spring Boot 2.4+ multi-document properties).");
    return { out: parts.map((p) => p + "\n").join("#---\n"), notes, docs: docs.length };
}
