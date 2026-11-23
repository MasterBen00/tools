// Runs the Regex Tester's user-supplied pattern off the main thread, so a catastrophically
// backtracking pattern can be stopped (the main thread terminates this worker on timeout).

export interface RegexRequest {
    id: number;
    pattern: string;
    flags: string;
    text: string;
    mode: "matches" | "replace";
    replacement: string;
}

export interface RegexMatch {
    index: number;
    text: string;
    end: number;
    groups: (string | undefined)[];
    named: Record<string, string | undefined>;
}

export type RegexResponse =
    | { id: number; ok: true; matches: RegexMatch[]; capped: boolean; replaced?: string }
    | { id: number; ok: false; error: string };

export const MAX_MATCHES = 10_000;

function run(req: RegexRequest): RegexResponse {
    let re: RegExp;
    try {
        re = new RegExp(req.pattern, req.flags);
    } catch (e) {
        return { id: req.id, ok: false, error: (e as Error).message };
    }

    const matches: RegexMatch[] = [];
    let capped = false;
    if (req.text) {
        const g = new RegExp(re.source, re.flags.includes("g") || re.flags.includes("y") ? re.flags : re.flags + "g");
        const unicode = re.unicode || re.flags.includes("v");
        let m: RegExpExecArray | null;
        while ((m = g.exec(req.text))) {
            if (matches.length >= MAX_MATCHES) {
                capped = true;
                break;
            }
            matches.push({
                index: m.index,
                text: m[0],
                end: m.index + m[0].length,
                groups: m.slice(1),
                named: { ...(m.groups ?? {}) },
            });
            if (!re.flags.includes("g")) break;
            // Zero-length match: step past it (a whole code point in unicode mode) so the loop always advances.
            if (m[0] === "") {
                const cp = unicode ? req.text.codePointAt(g.lastIndex) : undefined;
                g.lastIndex += cp !== undefined && cp > 0xffff ? 2 : 1;
                if (g.lastIndex > req.text.length) break;
            }
        }
    }

    let replaced: string | undefined;
    if (req.mode === "replace") {
        try {
            replaced = req.text.replace(re, req.replacement);
        } catch (e) {
            replaced = (e as Error).message;
        }
    }

    return { id: req.id, ok: true, matches, capped, replaced };
}

self.onmessage = (event: MessageEvent<RegexRequest>) => {
    self.postMessage(run(event.data));
};
