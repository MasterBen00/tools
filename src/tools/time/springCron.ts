// Spring's CronExpression (6 fields, Quartz-style L / W / #, macros), evaluated in a time zone.
// Unlike Unix cron, Spring requires both day-of-month and day-of-week to match.

export const SPRING_MACROS: Record<string, string> = {
    "@yearly": "0 0 0 1 1 *",
    "@annually": "0 0 0 1 1 *",
    "@monthly": "0 0 0 1 * *",
    "@weekly": "0 0 0 * * 0",
    "@daily": "0 0 0 * * *",
    "@midnight": "0 0 0 * * *",
    "@hourly": "0 0 * * * *",
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

type DomItem = { k: "last"; offset: number } | { k: "lastWeekday" } | { k: "nearestWeekday"; day: number };
type DowItem = { k: "lastOf"; dow: number } | { k: "nth"; dow: number; n: number };

export interface SpringCron {
    seconds: number[];
    minutes: number[];
    hours: number[];
    months: Set<number>;
    dom: { all: boolean; values: Set<number>; special: DomItem[] };
    dow: { all: boolean; values: Set<number>; special: DowItem[] };
}

const FIELD_NAMES = ["second", "minute", "hour", "day-of-month", "month", "day-of-week"];

export function expandMacro(expr: string): string {
    return SPRING_MACROS[expr.trim().toLowerCase()] ?? expr.trim();
}

function replaceNames(v: string, names: string[], base: number) {
    return v.toUpperCase().replace(/[A-Z]{3}/g, (m) => {
        const i = names.indexOf(m);
        if (i < 0) throw new Error(`unknown name '${m}'`);
        return String(i + base);
    });
}

function num(s: string, min: number, max: number): number {
    if (!/^\d+$/.test(s)) throw new Error(`'${s}' is not a number`);
    const n = Number(s);
    if (n < min || n > max) throw new Error(`${n} is outside ${min}–${max}`);
    return n;
}

function parseList(v: string, min: number, max: number): Set<number> {
    const out = new Set<number>();
    for (const part of v.split(",")) {
        if (!part) throw new Error("empty list item");
        const [range, stepStr, extra] = part.split("/");
        if (extra !== undefined) throw new Error(`'${part}' has more than one /`);
        const step = stepStr === undefined ? 1 : num(stepStr, 1, max);
        let a: number;
        let b: number;
        if (range === "*" || range === "?") [a, b] = [min, max];
        else if (range!.includes("-")) {
            const [x, y] = range!.split("-");
            a = num(x!, min, max);
            b = num(y!, min, max);
            if (a > b) throw new Error(`range ${a}-${b} goes backwards`);
        } else {
            a = num(range!, min, max);
            b = stepStr === undefined ? a : max;
        }
        for (let i = a; i <= b; i += step) out.add(i);
    }
    return out;
}

export function parseSpringCron(input: string): SpringCron {
    const expr = expandMacro(input);
    const t = expr.split(/\s+/).filter(Boolean);
    if (t.length !== 6) throw new Error(`Spring cron needs exactly 6 fields (second minute hour day-of-month month day-of-week); found ${t.length}.`);
    const field = <R>(i: number, fn: () => R): R => {
        try {
            return fn();
        } catch (e) {
            throw new Error(`${FIELD_NAMES[i]} field '${t[i]}': ${(e as Error).message}`);
        }
    };
    const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);
    const seconds = field(0, () => sorted(parseList(t[0]!, 0, 59)));
    const minutes = field(1, () => sorted(parseList(t[1]!, 0, 59)));
    const hours = field(2, () => sorted(parseList(t[2]!, 0, 23)));
    const months = field(4, () => parseList(replaceNames(t[4]!, MONTHS, 1), 1, 12));

    const dom = field(3, () => {
        const v = t[3]!.toUpperCase();
        if (v === "*" || v === "?") return { all: true, values: new Set<number>(), special: [] as DomItem[] };
        const values = new Set<number>();
        const special: DomItem[] = [];
        for (const part of v.split(",")) {
            let m: RegExpMatchArray | null;
            if (part === "L") special.push({ k: "last", offset: 0 });
            else if ((m = part.match(/^L-(\d+)$/))) special.push({ k: "last", offset: num(m[1]!, 0, 30) });
            else if (part === "LW") special.push({ k: "lastWeekday" });
            else if ((m = part.match(/^(\d+)W$/))) special.push({ k: "nearestWeekday", day: num(m[1]!, 1, 31) });
            else if (/[LW#]/.test(part)) throw new Error(`'${part}' is not a valid L / W form (use L, L-3, LW or 15W)`);
            else for (const n of parseList(part, 1, 31)) values.add(n);
        }
        return { all: false, values, special };
    });

    const dow = field(5, () => {
        const v = replaceNames(t[5]!, DAYS, 1);
        if (v === "*" || v === "?") return { all: true, values: new Set<number>(), special: [] as DowItem[] };
        const values = new Set<number>();
        const special: DowItem[] = [];
        const norm = (d: number) => (d === 0 ? 7 : d);
        for (const part of v.split(",")) {
            let m: RegExpMatchArray | null;
            if ((m = part.match(/^(\d)L$/))) special.push({ k: "lastOf", dow: norm(num(m[1]!, 0, 7)) });
            else if ((m = part.match(/^(\d)#(\d)$/))) special.push({ k: "nth", dow: norm(num(m[1]!, 0, 7)), n: num(m[2]!, 1, 5) });
            else if (/[L#W]/.test(part)) throw new Error(`'${part}' is not valid (use FRIL / 5L for the last Friday, MON#2 / 1#2 for the second Monday)`);
            else for (const n of parseList(part, 0, 7)) values.add(norm(n));
        }
        return { all: false, values, special };
    });
    return { seconds, minutes, hours, months, dom, dow };
}

// ---------------------------------------------------------------- matching

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** ISO day of week, Monday = 1 … Sunday = 7. */
const isoDow = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;

function nearestWeekday(y: number, m: number, day: number): number {
    const last = daysIn(y, m);
    const d = Math.min(day, last);
    const w = isoDow(y, m, d);
    if (w <= 5) return d;
    if (w === 6) return d === 1 ? 3 : d - 1; // Saturday -> Friday (or Monday the 3rd)
    return d === last ? d - 2 : d + 1; // Sunday -> Monday (or Friday before the end of month)
}

function domMatches(c: SpringCron, y: number, m: number, d: number) {
    if (c.dom.all) return true;
    if (c.dom.values.has(d)) return true;
    const last = daysIn(y, m);
    return c.dom.special.some((s) => {
        if (s.k === "last") return d === last - s.offset;
        if (s.k === "lastWeekday") return d === nearestWeekday(y, m, last);
        return d === nearestWeekday(y, m, s.day);
    });
}

function dowMatches(c: SpringCron, y: number, m: number, d: number) {
    if (c.dow.all) return true;
    const w = isoDow(y, m, d);
    if (c.dow.values.has(w)) return true;
    return c.dow.special.some((s) => {
        if (s.dow !== w) return false;
        if (s.k === "lastOf") return d + 7 > daysIn(y, m);
        return Math.ceil(d / 7) === s.n;
    });
}

// ---------------------------------------------------------------- time zones

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function wallClock(t: number, tz: string) {
    let f = fmtCache.get(tz);
    if (!f) {
        f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
        fmtCache.set(tz, f);
    }
    const p: Record<string, number> = {};
    for (const part of f.formatToParts(new Date(t))) if (part.type !== "literal") p[part.type] = Number(part.value);
    return { y: p.year!, m: p.month!, d: p.day!, h: p.hour! % 24, mi: p.minute!, s: p.second! };
}
function offsetAt(t: number, tz: string) {
    const w = wallClock(t, tz);
    return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(t / 1000) * 1000;
}
/** Wall-clock time in `tz` -> epoch ms. Times in a DST gap move forward, as java.time does. */
function toInstant(y: number, m: number, d: number, h: number, mi: number, s: number, tz: string) {
    const guess = Date.UTC(y, m - 1, d, h, mi, s);
    const o1 = offsetAt(guess - offsetAt(guess, tz), tz);
    const t = guess - o1;
    const o2 = offsetAt(t, tz);
    return o2 === o1 ? t : guess - Math.min(o1, o2);
}

/** Next `count` fire times strictly after `from`. */
export function springNextRuns(c: SpringCron, tz: string, from: Date, count: number): Date[] {
    const out: Date[] = [];
    const startMs = Math.floor(from.getTime() / 1000) * 1000;
    const w = wallClock(startMs, tz);
    let y = w.y;
    let m = w.m;
    let d = w.d;
    const endYear = y + 200;
    let first = true;
    while (out.length < count && y <= endYear) {
        if (!c.months.has(m)) {
            first = false;
            d = 1;
            if (++m > 12) {
                m = 1;
                y++;
            }
            continue;
        }
        if (domMatches(c, y, m, d) && dowMatches(c, y, m, d)) {
            for (const h of c.hours) {
                if (first && h < w.h) continue;
                for (const mi of c.minutes) {
                    if (first && h === w.h && mi < w.mi) continue;
                    for (const s of c.seconds) {
                        const t = toInstant(y, m, d, h, mi, s, tz);
                        if (t <= startMs || (out.length && t <= out[out.length - 1]!.getTime())) continue;
                        out.push(new Date(t));
                        if (out.length >= count) return out;
                    }
                }
            }
        }
        first = false;
        if (++d > daysIn(y, m)) {
            d = 1;
            if (++m > 12) {
                m = 1;
                y++;
            }
        }
    }
    return out;
}
