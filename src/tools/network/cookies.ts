/** Cookie parsing and checks shared by the Cookie parser and the HTTP header inspector. */

export interface CookieAttr {
    key: string;
    value: string | null;
}
export interface SetCookie {
    raw: string;
    name: string;
    value: string;
    attrs: CookieAttr[];
    domain?: string;
    path?: string;
    expires?: string;
    expiresDate?: Date | null;
    maxAge?: number | null;
    secure: boolean;
    httpOnly: boolean;
    sameSite?: string;
    partitioned: boolean;
    priority?: string;
    size: number;
}
export type IssueLevel = "error" | "warn" | "info";
export interface Issue {
    level: IssueLevel;
    text: string;
}

const enc = new TextEncoder();
export const byteSize = (s: string) => enc.encode(s).length;

/** Strip an optional "Set-Cookie:" / "Cookie:" header name. */
export function stripHeaderName(line: string, header: "set-cookie" | "cookie"): string {
    const re = header === "set-cookie" ? /^\s*set-cookie\s*:\s*/i : /^\s*cookie\s*:\s*/i;
    return line.replace(re, "");
}

export function parseCookieDate(s: string): Date | null {
    const t = Date.parse(s.replace(/(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/, "$1 $2 $3"));
    return Number.isNaN(t) ? null : new Date(t);
}

export function parseSetCookie(line: string): SetCookie {
    const raw = stripHeaderName(line, "set-cookie").trim();
    const [pair = "", ...rest] = raw.split(";");
    const eq = pair.indexOf("=");
    const name = eq < 0 ? "" : pair.slice(0, eq).trim();
    const value = (eq < 0 ? pair : pair.slice(eq + 1)).trim();
    const c: SetCookie = { raw, name, value, attrs: [], secure: false, httpOnly: false, partitioned: false, size: byteSize(name) + byteSize(value) };
    for (const part of rest) {
        const p = part.trim();
        if (!p) continue;
        const i = p.indexOf("=");
        const key = (i < 0 ? p : p.slice(0, i)).trim();
        const val = i < 0 ? null : p.slice(i + 1).trim();
        c.attrs.push({ key, value: val });
        switch (key.toLowerCase()) {
            case "domain": c.domain = val ?? ""; break;
            case "path": c.path = val ?? ""; break;
            case "expires":
                c.expires = val ?? "";
                c.expiresDate = parseCookieDate(val ?? "");
                break;
            case "max-age": {
                const n = Number(val);
                c.maxAge = val !== null && /^-?\d+$/.test(val) ? n : null;
                break;
            }
            case "secure": c.secure = true; break;
            case "httponly": c.httpOnly = true; break;
            case "samesite": c.sameSite = val ?? ""; break;
            case "partitioned": c.partitioned = true; break;
            case "priority": c.priority = val ?? ""; break;
        }
    }
    return c;
}

/** Names that usually carry a session or credential (CSRF tokens are left out: SPAs often need to read them). */
export function isSessionLike(name: string) {
    const n = name.replace(/^__(Secure|Host)-/i, "");
    if (/csrf|xsrf/i.test(n)) return false;
    return /sess|^sid$|[._-]sid$|jsessionid|token|auth|jwt|login|remember|^connect\.sid$|identity|access|refresh/i.test(n);
}

const DAY = 86_400;
export function analyzeSetCookie(c: SetCookie, now = Date.now()): Issue[] {
    const out: Issue[] = [];
    const ss = c.sameSite?.toLowerCase();
    if (!c.name && c.value) out.push({ level: "warn", text: "No name: the cookie is stored with an empty name, which many servers ignore." });
    if (c.name && /[()<>@,;:\\"/[\]?={}\s]/.test(c.name)) out.push({ level: "error", text: "The name contains characters that are not allowed in a cookie name." });
    if (ss === "none" && !c.secure) out.push({ level: "error", text: "SameSite=None without Secure: modern browsers reject this cookie." });
    else if (!c.secure) out.push({ level: "warn", text: "Missing Secure: the cookie is also sent over plain http and can be intercepted." });
    if (!c.httpOnly && isSessionLike(c.name)) out.push({ level: "warn", text: "Looks like a session or auth cookie but has no HttpOnly: any script (including injected XSS) can read it." });
    if (c.sameSite === undefined) out.push({ level: "info", text: "No SameSite: browsers treat it as Lax (Chrome, Edge), so it is not sent on cross-site subrequests." });
    else if (!["lax", "strict", "none"].includes(ss ?? "")) out.push({ level: "warn", text: `SameSite=${c.sameSite} is not a valid value (use Strict, Lax or None).` });
    if (c.partitioned && !c.secure) out.push({ level: "error", text: "Partitioned cookies must also be Secure." });
    if (/^__Secure-/.test(c.name) && !c.secure) out.push({ level: "error", text: "__Secure- prefix requires the Secure attribute: the browser rejects this cookie." });
    if (/^__Host-/.test(c.name)) {
        if (!c.secure) out.push({ level: "error", text: "__Host- prefix requires Secure: the browser rejects this cookie." });
        if (c.domain !== undefined) out.push({ level: "error", text: "__Host- prefix forbids a Domain attribute: the browser rejects this cookie." });
        if (c.path !== "/") out.push({ level: "error", text: "__Host- prefix requires Path=/: the browser rejects this cookie." });
    }
    if (/^__(secure|host)-/i.test(c.name) && !/^__(Secure|Host)-/.test(c.name)) out.push({ level: "info", text: "Cookie prefixes are matched case-sensitively in some browsers: write them as __Secure- or __Host-." });
    if (c.domain?.startsWith(".")) out.push({ level: "info", text: "The leading dot in Domain is ignored: the cookie applies to the domain and all its subdomains." });
    if (c.domain !== undefined && c.domain !== "" && !c.domain.includes(".") && c.domain.replace(/^\./, "") !== "localhost") out.push({ level: "warn", text: "Domain looks like a public suffix or bare host; browsers reject cookies scoped to a public suffix." });
    if (c.expires !== undefined && !c.expiresDate) out.push({ level: "warn", text: `Expires value "${c.expires}" could not be parsed as a date; browsers will treat this as a session cookie.` });
    if (c.maxAge === null) out.push({ level: "warn", text: "Max-Age is not an integer number of seconds and is ignored." });
    if (c.maxAge !== undefined && c.maxAge !== null && c.expiresDate) out.push({ level: "info", text: "Both Max-Age and Expires are set: Max-Age wins in browsers that support it." });
    const lifetime = lifetimeSeconds(c, now);
    if (lifetime !== null && lifetime <= 0) out.push({ level: "info", text: "Already expired: this header deletes the cookie." });
    else if (lifetime !== null && lifetime > 400 * DAY) out.push({ level: "warn", text: `Lifetime is ${Math.round(lifetime / DAY)} days; Chrome caps cookie lifetimes at 400 days.` });
    if (c.size > 4096) out.push({ level: "error", text: `Name + value is ${c.size} bytes; browsers drop cookies over 4096 bytes.` });
    else if (c.size > 3500) out.push({ level: "warn", text: `Name + value is ${c.size} bytes, close to the 4096-byte limit.` });
    if (c.priority && !["low", "medium", "high"].includes(c.priority.toLowerCase())) out.push({ level: "warn", text: `Priority=${c.priority} is not valid (Low, Medium or High).` });
    if (c.path !== undefined && c.path !== "" && !c.path.startsWith("/")) out.push({ level: "warn", text: "Path must start with /; otherwise the browser uses the default path of the request URL." });
    return out;
}

/** Seconds until expiry (Max-Age wins over Expires); null for a session cookie. */
export function lifetimeSeconds(c: SetCookie, now = Date.now()): number | null {
    if (c.maxAge !== undefined && c.maxAge !== null) return c.maxAge;
    if (c.expiresDate) return Math.round((c.expiresDate.getTime() - now) / 1000);
    return null;
}

export function parseCookieHeader(text: string): { name: string; value: string }[] {
    return stripHeaderName(text, "cookie")
        .split(/;\s*|\r?\n/)
        .map((s) => s.replace(/^\s*cookie\s*:\s*/i, "").trim())
        .filter(Boolean)
        .map((p) => {
            const i = p.indexOf("=");
            return i < 0 ? { name: "", value: p } : { name: p.slice(0, i).trim(), value: p.slice(i + 1).trim() };
        });
}

export interface DecodedValue {
    decoded: string;
    hint: string;
    detail?: string;
}
function b64decode(s: string): string | null {
    try {
        let b = s.replace(/-/g, "+").replace(/_/g, "/");
        while (b.length % 4) b += "=";
        const bin = atob(b);
        const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        const printable = [...text].filter((ch) => ch >= " " || ch === "\n" || ch === "\t").length;
        return printable / Math.max(1, text.length) > 0.95 ? text : null;
    } catch {
        return null;
    }
}
export function decodeValue(value: string): DecodedValue {
    let v = value;
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    let decoded = v;
    let hint = "";
    if (/%[0-9a-f]{2}/i.test(v)) {
        try {
            decoded = decodeURIComponent(v);
            hint = "URL-encoded";
        } catch {
            hint = "Malformed percent-encoding";
        }
    }
    const jwt = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)$/.exec(decoded);
    if (jwt) {
        const header = b64decode(jwt[1]!);
        const payload = b64decode(jwt[2]!);
        try {
            const h = JSON.parse(header ?? "") as { alg?: string };
            if (h && h.alg) {
                let detail = payload ?? "";
                try {
                    const p = JSON.parse(payload ?? "") as { exp?: number };
                    detail = JSON.stringify(p, null, 2);
                    if (typeof p.exp === "number") hint = `JWT (${h.alg}), exp ${new Date(p.exp * 1000).toISOString()}`;
                } catch {
                    /* payload not JSON */
                }
                return { decoded, hint: hint.startsWith("JWT") ? hint : `JWT (${h.alg})`, detail };
            }
        } catch {
            /* not a JWT */
        }
    }
    if (/^s:/.test(decoded) && decoded.includes(".")) return { decoded, hint: "Signed cookie (Express cookie-signature: s:<value>.<signature>)" };
    if (/^[[{]/.test(decoded)) {
        try {
            return { decoded, hint: "JSON", detail: JSON.stringify(JSON.parse(decoded), null, 2) };
        } catch {
            /* not JSON */
        }
    }
    if (decoded.length >= 12 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(decoded) && !/^\d+$/.test(decoded) && !/^[0-9a-f]+$/i.test(decoded)) {
        const text = b64decode(decoded);
        if (text) return { decoded, hint: "Looks like Base64", detail: text };
    }
    if (/^[0-9a-f]{32,}$/i.test(decoded)) return { decoded, hint: hint || `Hex string (${decoded.length / 2} bytes), probably a random id` };
    return { decoded, hint };
}

export function relative(ms: number): string {
    const abs = Math.abs(ms);
    const units: [number, string][] = [
        [365 * DAY * 1000, "year"],
        [30 * DAY * 1000, "month"],
        [DAY * 1000, "day"],
        [3_600_000, "hour"],
        [60_000, "minute"],
        [1000, "second"],
    ];
    for (const [size, unit] of units) {
        if (abs >= size || unit === "second") {
            const n = Math.round(abs / size);
            const s = `${n} ${unit}${n === 1 ? "" : "s"}`;
            return ms >= 0 ? `in ${s}` : `${s} ago`;
        }
    }
    return "now";
}
export function duration(seconds: number): string {
    if (seconds <= 0) return `${seconds} s (expires immediately)`;
    const parts: string[] = [];
    let s = seconds;
    for (const [size, unit] of [[DAY, "d"], [3600, "h"], [60, "m"], [1, "s"]] as [number, string][]) {
        const n = Math.floor(s / size);
        if (n) parts.push(`${n}${unit}`);
        s -= n * size;
    }
    return `${parts.join(" ")} (${seconds.toLocaleString()} s)`;
}
