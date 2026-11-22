/** Small GraphQL tokenizer, minifier and SDL parser for the GraphQL tools page. */

export type TokKind = "punct" | "name" | "number" | "string" | "block" | "comment";
export interface Token {
    kind: TokKind;
    value: string;
    pos: number;
}

const PUNCT = "!$&()[]{}:=@|";

export function tokenize(src: string, keepComments = false): Token[] {
    const out: Token[] = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i]!;
        if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "," || c === "﻿") {
            i++;
            continue;
        }
        const start = i;
        if (c === "#") {
            while (i < n && src[i] !== "\n" && src[i] !== "\r") i++;
            if (keepComments) out.push({ kind: "comment", value: src.slice(start, i), pos: start });
            continue;
        }
        if (src.startsWith('"""', i)) {
            i += 3;
            while (i < n && !src.startsWith('"""', i)) i += src.startsWith('\\"""', i) ? 4 : 1;
            if (i >= n) throw syntax("Unterminated block string", src, start);
            i += 3;
            out.push({ kind: "block", value: src.slice(start, i), pos: start });
            continue;
        }
        if (c === '"') {
            i++;
            while (i < n && src[i] !== '"') {
                if (src[i] === "\n" || src[i] === "\r") throw syntax("Unterminated string", src, start);
                i += src[i] === "\\" ? 2 : 1;
            }
            if (i >= n) throw syntax("Unterminated string", src, start);
            i++;
            out.push({ kind: "string", value: src.slice(start, i), pos: start });
            continue;
        }
        if (src.startsWith("...", i)) {
            i += 3;
            out.push({ kind: "punct", value: "...", pos: start });
            continue;
        }
        if (PUNCT.includes(c)) {
            i++;
            out.push({ kind: "punct", value: c, pos: start });
            continue;
        }
        if (/[_A-Za-z]/.test(c)) {
            while (i < n && /[_0-9A-Za-z]/.test(src[i]!)) i++;
            out.push({ kind: "name", value: src.slice(start, i), pos: start });
            continue;
        }
        if (c === "-" || /\d/.test(c)) {
            const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(src.slice(i));
            if (!m) throw syntax(`Unexpected character "${c}"`, src, i);
            i += m[0].length;
            out.push({ kind: "number", value: m[0], pos: start });
            continue;
        }
        throw syntax(`Unexpected character "${c}"`, src, i);
    }
    return out;
}

export function lineCol(src: string, pos: number) {
    const before = src.slice(0, pos);
    return { line: before.split("\n").length, col: pos - before.lastIndexOf("\n") };
}
function syntax(msg: string, src: string, pos: number) {
    const { line, col } = lineCol(src, pos);
    return new Error(`Line ${line}, column ${col}: ${msg}`);
}

/** Minify: drop comments and insignificant whitespace/commas, keep strings and block strings verbatim. */
export function minify(src: string): string {
    const toks = tokenize(src);
    let out = "";
    let prev: Token | null = null;
    for (const t of toks) {
        const wordy = (k: TokKind) => k === "name" || k === "number";
        if (prev && wordy(prev.kind) && wordy(t.kind)) out += " ";
        out += t.value;
        prev = t;
    }
    return out;
}

// ---------------- SDL ----------------

export interface GqlArg {
    name: string;
    type: string;
    base: string;
    description: string;
    defaultValue?: string;
}
export interface GqlField {
    name: string;
    type: string;
    base: string;
    description: string;
    args: GqlArg[];
    deprecated: boolean;
}
export type GqlKind = "type" | "interface" | "input" | "enum" | "union" | "scalar";
export interface GqlType {
    kind: GqlKind;
    name: string;
    description: string;
    fields: GqlField[];
    values: string[];
    possible: string[];
    interfaces: string[];
}
export interface GqlSchema {
    types: Map<string, GqlType>;
    roots: { query?: string; mutation?: string; subscription?: string };
}

export const BUILTIN_SCALARS = ["Int", "Float", "String", "Boolean", "ID"];

export function parseSdl(src: string): GqlSchema {
    const toks = tokenize(src);
    let i = 0;
    const types = new Map<string, GqlType>();
    const roots: GqlSchema["roots"] = {};

    const peek = (o = 0) => toks[i + o];
    const fail = (msg: string, t = peek()): never => {
        throw t ? syntax(msg, src, t.pos) : new Error(`${msg} at the end of the schema`);
    };
    const isP = (v: string, o = 0) => peek(o)?.kind === "punct" && peek(o)?.value === v;
    const isN = (v?: string, o = 0) => peek(o)?.kind === "name" && (v === undefined || peek(o)?.value === v);
    const expectP = (v: string) => {
        if (!isP(v)) fail(`Expected "${v}" but found ${peek() ? `"${peek()!.value}"` : "end of input"}`);
        i++;
    };
    const name = () => {
        if (!isN()) fail(`Expected a name but found ${peek() ? `"${peek()!.value}"` : "end of input"}`);
        return toks[i++]!.value;
    };
    const desc = () => {
        const t = peek();
        if (t && (t.kind === "string" || t.kind === "block")) {
            i++;
            return t.kind === "block" ? dedent(t.value.slice(3, -3).replace(/\\"""/g, '"""')) : safeJson(t.value);
        }
        return "";
    };
    /** Skip a balanced (...) / [...] / {...} group, or a single token. Returns the source text. */
    const skipValue = (): string => {
        const start = peek();
        if (!start) return "";
        const open = start.kind === "punct" ? { "(": ")", "[": "]", "{": "}" }[start.value] : undefined;
        if (!open) {
            i++;
            if (start.value === "$") i++;
            return start.value;
        }
        let depth = 0;
        const from = start.pos;
        let end = from;
        do {
            const t = toks[i++];
            if (!t) fail("Unbalanced brackets");
            if (t!.kind === "punct" && "([{".includes(t!.value)) depth++;
            if (t!.kind === "punct" && ")]}".includes(t!.value)) depth--;
            end = t!.pos + t!.value.length;
        } while (depth > 0);
        return src.slice(from, end);
    };
    const directives = () => {
        let deprecated = false;
        while (isP("@")) {
            i++;
            if (name() === "deprecated") deprecated = true;
            if (isP("(")) skipValue();
        }
        return deprecated;
    };
    const typeRef = (): { type: string; base: string } => {
        if (isP("[")) {
            i++;
            const inner = typeRef();
            expectP("]");
            let type = `[${inner.type}]`;
            if (isP("!")) {
                i++;
                type += "!";
            }
            return { type, base: inner.base };
        }
        const base = name();
        let type = base;
        if (isP("!")) {
            i++;
            type += "!";
        }
        return { type, base };
    };
    const args = (): GqlArg[] => {
        const out: GqlArg[] = [];
        if (!isP("(")) return out;
        i++;
        while (!isP(")")) {
            if (!peek()) fail("Unterminated argument list");
            const description = desc();
            const n = name();
            expectP(":");
            const t = typeRef();
            let defaultValue: string | undefined;
            if (isP("=")) {
                i++;
                defaultValue = skipValue();
            }
            directives();
            out.push({ name: n, ...t, description, defaultValue });
        }
        i++;
        return out;
    };
    const fieldsBlock = (input: boolean): GqlField[] => {
        const out: GqlField[] = [];
        if (!isP("{")) return out;
        i++;
        while (!isP("}")) {
            if (!peek()) fail("Unterminated field list");
            const description = desc();
            const n = name();
            const a = input ? [] : args();
            expectP(":");
            const t = typeRef();
            if (input && isP("=")) {
                i++;
                skipValue();
            }
            const deprecated = directives();
            out.push({ name: n, ...t, description, args: a, deprecated });
        }
        i++;
        return out;
    };
    const getType = (kind: GqlKind, n: string, description: string): GqlType => {
        let t = types.get(n);
        if (!t) {
            t = { kind, name: n, description, fields: [], values: [], possible: [], interfaces: [] };
            types.set(n, t);
        } else if (description && !t.description) t.description = description;
        return t;
    };

    while (i < toks.length) {
        const description = desc();
        if (isN("extend")) i++;
        const kw = peek();
        if (!kw || kw.kind !== "name") fail("Expected a definition");
        i++;
        switch (kw!.value) {
            case "schema": {
                directives();
                expectP("{");
                while (!isP("}")) {
                    const op = name();
                    expectP(":");
                    const t = name();
                    if (op === "query" || op === "mutation" || op === "subscription") roots[op] = t;
                }
                i++;
                break;
            }
            case "type":
            case "interface":
            case "input": {
                const kind = kw!.value as GqlKind;
                const t = getType(kind, name(), description);
                if (isN("implements")) {
                    i++;
                    if (isP("&")) i++;
                    t.interfaces.push(name());
                    while (isP("&")) {
                        i++;
                        t.interfaces.push(name());
                    }
                }
                directives();
                t.fields.push(...fieldsBlock(kind === "input"));
                break;
            }
            case "enum": {
                const t = getType("enum", name(), description);
                directives();
                if (isP("{")) {
                    i++;
                    while (!isP("}")) {
                        if (!peek()) fail("Unterminated enum");
                        desc();
                        t.values.push(name());
                        directives();
                    }
                    i++;
                }
                break;
            }
            case "union": {
                const t = getType("union", name(), description);
                directives();
                if (isP("=")) {
                    i++;
                    if (isP("|")) i++;
                    t.possible.push(name());
                    while (isP("|")) {
                        i++;
                        t.possible.push(name());
                    }
                }
                break;
            }
            case "scalar":
                getType("scalar", name(), description);
                directives();
                break;
            case "directive": {
                expectP("@");
                name();
                args();
                if (isN("repeatable")) i++;
                if (!isN("on")) fail('Expected "on"');
                i++;
                if (isP("|")) i++;
                name();
                while (isP("|")) {
                    i++;
                    name();
                }
                break;
            }
            default:
                fail(`Unknown definition "${kw!.value}"`, kw);
        }
    }
    roots.query ??= types.has("Query") ? "Query" : undefined;
    roots.mutation ??= types.has("Mutation") ? "Mutation" : undefined;
    roots.subscription ??= types.has("Subscription") ? "Subscription" : undefined;
    // Implementations of each interface (used to offer inline fragments).
    for (const t of types.values()) for (const itf of t.interfaces) types.get(itf)?.possible.push(t.name);
    return { types, roots };
}

function safeJson(s: string) {
    try {
        return JSON.parse(s) as string;
    } catch {
        return s.slice(1, -1);
    }
}
function dedent(s: string) {
    const lines = s.replace(/\r\n?/g, "\n").split("\n");
    const indents = lines.slice(1).filter((l) => l.trim()).map((l) => l.match(/^\s*/)![0].length);
    const min = indents.length ? Math.min(...indents) : 0;
    return lines
        .map((l, k) => (k === 0 ? l : l.slice(min)))
        .join("\n")
        .trim();
}
