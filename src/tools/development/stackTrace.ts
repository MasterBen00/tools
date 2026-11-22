// Parser for Java stack traces (as printed by Throwable.printStackTrace, Logback or Log4j).

export interface Frame {
    raw: string;
    module?: string;
    cls: string;
    method: string;
    location: string; // File.java:42, Native Method, Unknown Source
    jar?: string;
}

export interface Throwable {
    cls: string;
    message: string;
    frames: Frame[];
    more: number;
    cause?: Throwable;
    suppressed: Throwable[];
    indent: number;
    line: number;
}

export interface ParsedTrace {
    root: Throwable;
    /** Text before the exception line (log prefix, thread info). */
    preamble: string;
}

const FRAME_RE = /^\s*at\s+(.+?)\s*$/;
const MORE_RE = /^\s*\.\.\.\s*(\d+)\s+(?:more|common frames omitted)/;
const CAUSED_RE = /^(\s*)Caused by:\s*(.*)$/;
const SUPPRESSED_RE = /^(\s*)Suppressed:\s*(.*)$/;
// A fully qualified class name followed by ": message" or the end of the line.
const CLASS_RE = /((?:[a-zA-Z_$][\w$]*\.)+[A-Za-z_$][\w$]*)(?=:\s|:$|\s*$)/g;

const indentOf = (s: string) => s.match(/^\s*/)![0].replace(/\t/g, "    ").length;

export function parseFrame(body: string): Frame {
    let s = body;
    let jar: string | undefined;
    const jm = s.match(/\)\s*(~?\[[^\]]*\])$/);
    if (jm) {
        jar = jm[1]!.replace(/^~?\[|\]$/g, "");
        s = s.slice(0, s.length - jm[1]!.length).trimEnd();
    }
    const open = s.lastIndexOf("(");
    const location = open >= 0 && s.endsWith(")") ? s.slice(open + 1, -1) : "";
    let qual = open >= 0 ? s.slice(0, open) : s;
    let module: string | undefined;
    const slash = qual.lastIndexOf("/");
    if (slash >= 0) {
        module = qual.slice(0, slash);
        qual = qual.slice(slash + 1);
    }
    const dot = qual.lastIndexOf(".");
    return { raw: body, module, cls: dot > 0 ? qual.slice(0, dot) : qual, method: dot > 0 ? qual.slice(dot + 1) : "", location, jar };
}

function splitHeader(text: string): { cls: string; message: string; prefix: string } {
    const matches = [...text.matchAll(CLASS_RE)];
    // Prefer a name that looks like a throwable; log prefixes contain logger names too.
    const m = matches.find((x) => /(Exception|Error|Throwable|Failure|Fault)(\$\w+)?$/.test(x[1]!)) ?? matches[0];
    if (!m) return { cls: text.trim(), message: "", prefix: "" };
    const after = text.slice(m.index! + m[1]!.length).replace(/^:\s?/, "");
    return { cls: m[1]!, message: after, prefix: text.slice(0, m.index!).trim() };
}

export function parseStackTrace(text: string): ParsedTrace | null {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const firstFrame = lines.findIndex((l) => FRAME_RE.test(l));
    if (firstFrame < 0) return null;
    // Walk up from the first frame to the line that names the exception.
    // The nearest line above that names a throwable; lines in between belong to a multi-line message.
    let start = Math.max(0, firstFrame - 1);
    for (let i = firstFrame - 1; i >= Math.max(0, firstFrame - 40); i--) {
        if (/(Exception|Error|Throwable|Failure|Fault)(\$\w+)?$/.test(splitHeader(lines[i]!).cls)) {
            start = i;
            break;
        }
    }
    const preambleLines = lines.slice(0, start);
    let headerText = lines[start] ?? "";
    headerText = headerText.replace(/^.*?Exception in thread "([^"]*)"\s*/, (m) => {
        preambleLines.push(m.trim());
        return "";
    });
    const h = splitHeader(headerText);
    if (h.prefix) preambleLines.push(h.prefix);

    const mk = (cls: string, message: string, indent: number, line: number): Throwable => ({ cls, message, frames: [], more: 0, suppressed: [], indent, line });
    const root = mk(h.cls, h.message, 0, start + 1);
    let current = root;
    // Last throwable of each chain, by indentation; Caused by attaches there.
    const chainEnd = new Map<number, Throwable>([[0, root]]);
    let inMessage = true;

    for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i]!;
        if (!line.trim()) {
            inMessage = false;
            continue;
        }
        let m: RegExpMatchArray | null;
        if ((m = line.match(FRAME_RE))) {
            current.frames.push(parseFrame(m[1]!));
            inMessage = false;
        } else if ((m = line.match(MORE_RE))) {
            current.more = Number(m[1]);
        } else if ((m = line.match(CAUSED_RE))) {
            const ind = indentOf(m[1]!);
            const hh = splitHeader(m[2]!);
            const t = mk(hh.cls, hh.message, ind, i + 1);
            const parent = chainEnd.get(ind) ?? current;
            parent.cause = t;
            chainEnd.set(ind, t);
            current = t;
            inMessage = true;
        } else if ((m = line.match(SUPPRESSED_RE))) {
            const ind = indentOf(m[1]!);
            const hh = splitHeader(m[2]!);
            const t = mk(hh.cls, hh.message, ind, i + 1);
            let parent: Throwable = root;
            let best = -1;
            for (const [k, v] of chainEnd) if (k < ind && k > best) [best, parent] = [k, v];
            parent.suppressed.push(t);
            for (const k of [...chainEnd.keys()]) if (k >= ind) chainEnd.delete(k);
            chainEnd.set(ind, t);
            current = t;
            inMessage = true;
        } else if (inMessage) {
            current.message += (current.message ? "\n" : "") + line;
        } else if (/^\s/.test(line) === false && /^\d{4}-\d{2}-\d{2}|^\[|^(INFO|WARN|ERROR|DEBUG)\b/.test(line)) {
            break; // the next log entry
        }
    }
    return { root, preamble: preambleLines.join("\n").trim() };
}

export const DEFAULT_PREFIXES = [
    "java.",
    "javax.",
    "jdk.",
    "jakarta.",
    "sun.",
    "com.sun.",
    "org.springframework.",
    "org.apache.",
    "org.hibernate.",
    "com.zaxxer.",
    "io.netty.",
    "reactor.",
    "org.junit.",
    "kotlin.",
];

export function isProxyFrame(f: Frame) {
    return f.cls.includes("$$") || /^jdk\.proxy\d*\./.test(f.cls) || /\$Proxy\d+/.test(f.cls) || f.cls.startsWith("jdk.internal.reflect.Generated");
}

export function isFrameworkFrame(f: Frame, prefixes: string[]) {
    return isProxyFrame(f) || prefixes.some((p) => p && f.cls.startsWith(p));
}

export function causeChain(t: Throwable): Throwable[] {
    const out: Throwable[] = [];
    for (let c: Throwable | undefined = t; c && !out.includes(c); c = c.cause) out.push(c);
    return out;
}

/** Most common non-framework package (3 segments), used to suggest "your package". */
export function guessPackage(t: Throwable, prefixes: string[]): string {
    const counts = new Map<string, number>();
    const visit = (x: Throwable) => {
        for (const f of x.frames) {
            if (isFrameworkFrame(f, prefixes)) continue;
            const pkg = f.cls.split(".").slice(0, 3).join(".");
            if (pkg.split(".").length === 3) counts.set(pkg, (counts.get(pkg) ?? 0) + 1);
        }
        x.suppressed.forEach(visit);
        if (x.cause) visit(x.cause);
    };
    visit(t);
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}
