// SQL ↔ MongoDB query translation (single-table SELECT ↔ find / aggregate). Pure functions, no DOM.
import JSON5 from "json5";

export interface Translation {
    output: string;
    java?: string;
    unsupported: string[];
    notes: string[];
    error?: string;
}

export class Unsupported extends Error {}

// ============================================================ shell printer
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

export function shell(v: unknown, indent = 0): string {
    const flat = shellFlat(v);
    if (flat.length + indent <= 90 || (!isObj(v) && !Array.isArray(v))) return flat;
    const pad = "  ".repeat(indent / 2 + 1);
    const end = "  ".repeat(indent / 2);
    if (Array.isArray(v)) return "[\n" + v.map((x) => pad + shell(x, indent + 2)).join(",\n") + "\n" + end + "]";
    return "{\n" + Object.entries(v).map(([k, x]) => `${pad}${key(k)}: ${shell(x, indent + 2)}`).join(",\n") + "\n" + end + "}";
}
function key(k: string) {
    return /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
}
function shellFlat(v: unknown): string {
    if (Array.isArray(v)) return "[" + v.map(shellFlat).join(", ") + "]";
    if (isObj(v)) {
        const e = Object.entries(v);
        return e.length ? "{ " + e.map(([k, x]) => `${key(k)}: ${shellFlat(x)}`).join(", ") + " }" : "{}";
    }
    return v === undefined ? "null" : JSON.stringify(v);
}

// ============================================================ SQL tokenizer + parser
interface Tok {
    k: "id" | "qid" | "str" | "num" | "op";
    v: string;
}
function tokenize(sql: string): Tok[] {
    const out: Tok[] = [];
    let i = 0;
    while (i < sql.length) {
        const c = sql[i];
        if (/\s/.test(c)) { i++; continue; }
        if (c === "-" && sql[i + 1] === "-") { while (i < sql.length && sql[i] !== "\n") i++; continue; }
        if (c === "/" && sql[i + 1] === "*") { const e = sql.indexOf("*/", i + 2); i = e < 0 ? sql.length : e + 2; continue; }
        if (c === "'") {
            let s = "";
            i++;
            while (i < sql.length) {
                if (sql[i] === "'" && sql[i + 1] === "'") { s += "'"; i += 2; continue; }
                if (sql[i] === "\\" && sql[i + 1] === "'") { s += "'"; i += 2; continue; }
                if (sql[i] === "'") break;
                s += sql[i++];
            }
            if (i >= sql.length) throw new Error("Unterminated string literal.");
            i++;
            out.push({ k: "str", v: s });
            continue;
        }
        if (c === '"' || c === "`" || c === "[") {
            const close = c === "[" ? "]" : c;
            const e = sql.indexOf(close, i + 1);
            if (e < 0) throw new Error("Unterminated quoted identifier.");
            out.push({ k: "qid", v: sql.slice(i + 1, e) });
            i = e + 1;
            continue;
        }
        const num = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(sql.slice(i, i + 40));
        if (num) { out.push({ k: "num", v: num[0] }); i += num[0].length; continue; }
        const w = /^[A-Za-z_][\w$]*/.exec(sql.slice(i, i + 200));
        if (w) { out.push({ k: "id", v: w[0] }); i += w[0].length; continue; }
        const op = /^(<>|!=|<=|>=|=|<|>|\(|\)|,|\.|\*|;|-|\+|\/|%|\|\|)/.exec(sql.slice(i, i + 2));
        if (op) { out.push({ k: "op", v: op[0] }); i += op[0].length; continue; }
        throw new Error(`Unexpected character "${c}".`);
    }
    return out;
}

type Lit = string | number | boolean | null;
type AggFn = "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";
interface AggCall {
    fn: AggFn;
    arg: string; // "*" for COUNT(*)
}
type Operand = { col: string } | { lit: Lit } | { agg: AggCall };
type CmpOp = "=" | "!=" | "<" | "<=" | ">" | ">=";
type Expr =
    | { t: "and" | "or"; items: Expr[] }
    | { t: "not"; e: Expr }
    | { t: "cmp"; op: CmpOp; left: Operand; right: Operand }
    | { t: "in"; x: Operand; values: Lit[]; neg: boolean }
    | { t: "like"; x: Operand; pattern: string; neg: boolean; ci: boolean }
    | { t: "null"; x: Operand; neg: boolean }
    | { t: "between"; x: Operand; lo: Lit; hi: Lit; neg: boolean };
type SelItem = { kind: "col"; col: string; alias?: string } | { kind: "agg"; agg: AggCall; alias?: string };
interface OrderItem {
    x: Operand;
    dir: 1 | -1;
}
interface SelectAst {
    distinct: boolean;
    star: boolean;
    items: SelItem[];
    table: string;
    where?: Expr;
    groupBy: string[];
    having?: Expr;
    orderBy: OrderItem[];
    limit?: number;
    offset?: number;
    skipped: string[];
}

const AGGS = new Set(["COUNT", "SUM", "AVG", "MIN", "MAX"]);
const CLAUSE_KW = new Set(["FROM", "WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET", "FETCH", "AS", "ON", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "UNION", "AND", "OR", "NOT"]);

class Parser {
    i = 0;
    tableNames = new Set<string>();
    toks: Tok[];
    constructor(toks: Tok[]) {
        this.toks = toks;
    }
    peek(o = 0) { return this.toks[this.i + o]; }
    up(o = 0) { const t = this.peek(o); return t && t.k === "id" ? t.v.toUpperCase() : ""; }
    isOp(v: string, o = 0) { const t = this.peek(o); return !!t && t.k === "op" && t.v === v; }
    eatKw(...kws: string[]) {
        for (let j = 0; j < kws.length; j++) if (this.up(j) !== kws[j]) return false;
        this.i += kws.length;
        return true;
    }
    expectKw(kw: string) { if (!this.eatKw(kw)) throw new Error(`Expected ${kw}${this.peek() ? ` near "${this.peek().v}"` : " but the query ended"}.`); }
    expectOp(v: string) { if (!this.isOp(v)) throw new Error(`Expected "${v}"${this.peek() ? ` near "${this.peek().v}"` : " but the query ended"}.`); this.i++; }

    ident(): string {
        const t = this.peek();
        if (!t || (t.k !== "id" && t.k !== "qid")) throw new Error(`Expected a name${t ? ` near "${t.v}"` : ""}.`);
        this.i++;
        return t.v;
    }
    /** column reference; a leading table name or alias is dropped, other dots become a nested path. */
    colRef(): string {
        const parts = [this.ident()];
        while (this.isOp(".") && (this.peek(1)?.k === "id" || this.peek(1)?.k === "qid")) { this.i++; parts.push(this.ident()); }
        if (parts.length > 1 && this.tableNames.has(parts[0].toLowerCase())) parts.shift();
        return parts.join(".");
    }
    literal(): Lit | undefined {
        const t = this.peek();
        if (!t) return undefined;
        if (t.k === "str") { this.i++; return t.v; }
        if (t.k === "num") { this.i++; return Number(t.v); }
        if (t.k === "op" && t.v === "-" && this.peek(1)?.k === "num") { this.i += 2; return -Number(this.toks[this.i - 1].v); }
        const u = this.up();
        if (u === "TRUE" || u === "FALSE") { this.i++; return u === "TRUE"; }
        if (u === "NULL") { this.i++; return null; }
        return undefined;
    }
    aggCall(): AggCall | null {
        const u = this.up();
        if (!AGGS.has(u) || !this.isOp("(", 1)) return null;
        this.i += 2;
        if (this.up() === "DISTINCT") throw new Unsupported(`${u}(DISTINCT …)`);
        let arg: string;
        if (this.isOp("*")) { this.i++; arg = "*"; }
        else arg = this.colRef();
        if (!this.isOp(")")) throw new Unsupported(`expressions inside ${u}()`);
        this.i++;
        return { fn: u as AggFn, arg };
    }
    operand(): Operand {
        const lit = this.literal();
        if (lit !== undefined) return { lit };
        const agg = this.aggCall();
        if (agg) return { agg };
        const t = this.peek();
        if (!t) throw new Error("The query ended unexpectedly.");
        if ((t.k === "id" || t.k === "qid") && this.isOp("(", 1)) throw new Unsupported(`function ${t.v}()`);
        if (t.k === "op" && t.v === "(" && this.up(1) === "SELECT") throw new Unsupported("subqueries");
        if (t.k !== "id" && t.k !== "qid") throw new Error(`Unexpected "${t.v}".`);
        const col = this.colRef();
        if (this.peek()?.k === "op" && ["+", "-", "*", "/", "%", "||"].includes(this.peek().v)) throw new Unsupported("arithmetic expressions");
        return { col };
    }

    expr(): Expr {
        const items = [this.andExpr()];
        while (this.eatKw("OR")) items.push(this.andExpr());
        return items.length === 1 ? items[0] : { t: "or", items };
    }
    andExpr(): Expr {
        const items = [this.notExpr()];
        while (this.eatKw("AND")) items.push(this.notExpr());
        return items.length === 1 ? items[0] : { t: "and", items };
    }
    notExpr(): Expr {
        if (this.eatKw("NOT")) return { t: "not", e: this.notExpr() };
        if (this.up() === "EXISTS") throw new Unsupported("EXISTS subqueries");
        if (this.isOp("(") && this.up(1) !== "SELECT") {
            this.i++;
            const e = this.expr();
            this.expectOp(")");
            return e;
        }
        return this.predicate();
    }
    predicate(): Expr {
        const x = this.operand();
        if (this.eatKw("IS")) {
            const neg = this.eatKw("NOT");
            this.expectKw("NULL");
            return { t: "null", x, neg };
        }
        const neg = this.eatKw("NOT");
        if (this.eatKw("IN")) {
            this.expectOp("(");
            if (this.up() === "SELECT") throw new Unsupported("subqueries");
            const values: Lit[] = [];
            do {
                const v = this.literal();
                if (v === undefined) throw new Unsupported("non-literal values in IN (…)");
                values.push(v);
            } while (this.isOp(",") && ++this.i);
            this.expectOp(")");
            return { t: "in", x, values, neg };
        }
        if (this.up() === "LIKE" || this.up() === "ILIKE") {
            const ci = this.up() === "ILIKE";
            this.i++;
            const p = this.literal();
            if (typeof p !== "string") throw new Unsupported("LIKE with a non-string pattern");
            if (this.up() === "ESCAPE") throw new Unsupported("LIKE … ESCAPE");
            return { t: "like", x, pattern: p, neg, ci };
        }
        if (this.eatKw("BETWEEN")) {
            const lo = this.literal();
            this.expectKw("AND");
            const hi = this.literal();
            if (lo === undefined || hi === undefined) throw new Unsupported("BETWEEN with non-literal bounds");
            return { t: "between", x, lo, hi, neg };
        }
        if (neg) throw new Error("Expected IN, LIKE or BETWEEN after NOT.");
        const t = this.peek();
        if (t?.k === "op" && ["=", "!=", "<>", "<", "<=", ">", ">="].includes(t.v)) {
            this.i++;
            if (this.isOp("(") && this.up(1) === "SELECT") throw new Unsupported("subqueries");
            const op = (t.v === "<>" ? "!=" : t.v) as CmpOp;
            return { t: "cmp", op, left: x, right: this.operand() };
        }
        throw new Error(`Expected a comparison${t ? ` near "${t.v}"` : ""}.`);
    }

    alias(): string | undefined {
        if (this.eatKw("AS")) return this.ident();
        const t = this.peek();
        if (t && (t.k === "qid" || (t.k === "id" && !CLAUSE_KW.has(t.v.toUpperCase())))) { this.i++; return t.v; }
        return undefined;
    }

    select(): SelectAst {
        const ast: SelectAst = { distinct: false, star: false, items: [], table: "", groupBy: [], orderBy: [], skipped: [] };
        // Collect table names/aliases first so qualified columns can be resolved.
        for (let j = 0; j < this.toks.length; j++) {
            const u = this.toks[j].k === "id" ? this.toks[j].v.toUpperCase() : "";
            if (u === "FROM") {
                const t = this.toks[j + 1];
                if (t) this.tableNames.add(t.v.toLowerCase());
                let k = j + 2;
                while (this.toks[k]?.k === "op" && this.toks[k].v === "." && this.toks[k + 1]) { this.tableNames.add(this.toks[k + 1].v.toLowerCase()); k += 2; }
                if (this.toks[k]?.k === "id" && this.toks[k].v.toUpperCase() === "AS") k++;
                const a = this.toks[k];
                if (a && (a.k === "qid" || (a.k === "id" && !CLAUSE_KW.has(a.v.toUpperCase())))) this.tableNames.add(a.v.toLowerCase());
            }
        }
        this.expectKw("SELECT");
        if (this.eatKw("DISTINCT")) ast.distinct = true;
        if (this.eatKw("TOP")) {
            const n = this.literal();
            if (typeof n !== "number") throw new Unsupported("TOP with an expression");
            ast.limit = n;
        }
        do {
            if (this.isOp("*")) { this.i++; ast.star = true; continue; }
            if ((this.peek()?.k === "id" || this.peek()?.k === "qid") && this.isOp(".", 1) && this.isOp("*", 2)) { this.i += 3; ast.star = true; continue; }
            const start = this.i;
            try {
                const agg = this.aggCall();
                if (agg) { ast.items.push({ kind: "agg", agg, alias: this.alias() }); }
                else {
                    const lit = this.literal();
                    if (lit !== undefined) throw new Unsupported("literal values");
                    const t = this.peek();
                    if ((t?.k === "id" || t?.k === "qid") && this.isOp("(", 1)) throw new Unsupported(`function ${t.v}()`);
                    if (this.up() === "CASE") throw new Unsupported("CASE expressions");
                    const col = this.colRef();
                    if (this.up() === "OVER") throw new Unsupported("window functions");
                    if (this.peek()?.k === "op" && ["+", "-", "*", "/", "%", "||"].includes(this.peek().v)) throw new Unsupported("arithmetic expressions");
                    ast.items.push({ kind: "col", col, alias: this.alias() });
                }
            } catch (e) {
                if (!(e instanceof Unsupported)) throw e;
                // Skip this select item up to the next top-level comma or FROM.
                let depth = 0;
                this.i = start;
                const from = this.i;
                while (this.peek()) {
                    if (this.isOp("(")) depth++;
                    else if (this.isOp(")")) depth--;
                    else if (depth === 0 && (this.isOp(",") || this.up() === "FROM")) break;
                    this.i++;
                }
                ast.skipped.push(`select item ${this.toks.slice(from, this.i).map((t) => (t.k === "str" ? `'${t.v}'` : t.v)).join(" ")} (${e.message})`);
            }
        } while (this.isOp(",") && ++this.i);
        this.expectKw("FROM");
        if (this.isOp("(")) throw new Unsupported("subqueries in FROM");
        const tparts = [this.ident()];
        while (this.isOp(".")) { this.i++; tparts.push(this.ident()); }
        ast.table = tparts[tparts.length - 1];
        this.alias();
        if (this.isOp(",")) throw new Unsupported("multiple tables in FROM (implicit joins)");
        if (["JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "NATURAL"].includes(this.up())) throw new Unsupported("JOINs");
        if (this.eatKw("WHERE")) ast.where = this.expr();
        if (this.eatKw("GROUP", "BY")) {
            do {
                const t = this.peek();
                if ((t?.k === "id" || t?.k === "qid") && this.isOp("(", 1)) throw new Unsupported(`GROUP BY ${t.v}()`);
                if (t?.k === "num") throw new Unsupported("GROUP BY position numbers");
                ast.groupBy.push(this.colRef());
            } while (this.isOp(",") && ++this.i);
        }
        if (this.eatKw("HAVING")) ast.having = this.expr();
        if (this.eatKw("ORDER", "BY")) {
            do {
                if (this.peek()?.k === "num") throw new Unsupported("ORDER BY position numbers");
                const x = this.operand();
                let dir: 1 | -1 = 1;
                if (this.eatKw("DESC")) dir = -1;
                else this.eatKw("ASC");
                if (this.eatKw("NULLS")) { this.i++; ast.skipped.push("NULLS FIRST/LAST (MongoDB always sorts null first ascending)"); }
                ast.orderBy.push({ x, dir });
            } while (this.isOp(",") && ++this.i);
        }
        if (this.eatKw("LIMIT")) {
            const a = this.literal();
            if (typeof a !== "number") throw new Error("LIMIT needs a number.");
            if (this.isOp(",")) {
                this.i++;
                const b = this.literal();
                if (typeof b !== "number") throw new Error("LIMIT needs a number.");
                ast.offset = a;
                ast.limit = b;
            } else ast.limit = a;
        }
        if (this.eatKw("OFFSET")) {
            const n = this.literal();
            if (typeof n !== "number") throw new Error("OFFSET needs a number.");
            ast.offset = n;
            this.eatKw("ROWS") || this.eatKw("ROW");
        }
        if (this.eatKw("FETCH")) {
            this.eatKw("FIRST") || this.eatKw("NEXT");
            const n = this.literal();
            if (typeof n !== "number") throw new Error("FETCH needs a number.");
            ast.limit = n;
            this.eatKw("ROWS") || this.eatKw("ROW");
            this.eatKw("ONLY");
        }
        if (this.isOp(";")) this.i++;
        const rest = this.peek();
        if (rest) {
            const u = this.up();
            if (u === "UNION" || u === "INTERSECT" || u === "EXCEPT") throw new Unsupported(u);
            throw new Error(`Unexpected "${rest.v}" after the query.`);
        }
        return ast;
    }
}

// ============================================================ SQL → Mongo
function likeToRegex(p: string): string {
    let r = "";
    for (const ch of p) {
        if (ch === "%") r += ".*";
        else if (ch === "_") r += ".";
        else r += ch.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    }
    r = "^" + r + "$";
    if (r.startsWith("^.*")) r = r.slice(3);
    if (r.endsWith(".*$")) r = r.slice(0, -3);
    return r;
}

const FLIP: Record<CmpOp, CmpOp> = { "=": "=", "!=": "!=", "<": ">", "<=": ">=", ">": "<", ">=": "<=" };
const MOP: Record<CmpOp, string> = { "=": "$eq", "!=": "$ne", "<": "$lt", "<=": "$lte", ">": "$gt", ">=": "$gte" };

type Resolver = (x: Operand) => string; // returns a field path

function fieldOf(x: Operand, resolve: Resolver): string {
    if ("lit" in x) throw new Unsupported("a literal on the left of IN / LIKE / IS / BETWEEN");
    return resolve(x);
}

function filterOf(e: Expr, resolve: Resolver): Record<string, unknown> {
    switch (e.t) {
        case "cmp": {
            let { left, right, op } = e;
            if ("lit" in left && !("lit" in right)) { [left, right] = [right, left]; op = FLIP[op]; }
            if ("lit" in left) throw new Unsupported("comparisons between two literals");
            const f = resolve(left);
            if (!("lit" in right)) return { $expr: { [MOP[op]]: ["$" + f, "$" + resolve(right)] } };
            const v = right.lit;
            if (op === "=") return { [f]: v };
            return { [f]: { [MOP[op]]: v } };
        }
        case "in": return { [fieldOf(e.x, resolve)]: { [e.neg ? "$nin" : "$in"]: e.values } };
        case "like": {
            const r: Record<string, unknown> = { $regex: likeToRegex(e.pattern) };
            if (e.ci) r.$options = "i";
            return { [fieldOf(e.x, resolve)]: e.neg ? { $not: r } : r };
        }
        case "null": return { [fieldOf(e.x, resolve)]: e.neg ? { $ne: null } : null };
        case "between": {
            const f = fieldOf(e.x, resolve);
            return e.neg ? { $or: [{ [f]: { $lt: e.lo } }, { [f]: { $gt: e.hi } }] } : { [f]: { $gte: e.lo, $lte: e.hi } };
        }
        case "or": {
            const items = e.items.map((x) => filterOf(x, resolve)).flatMap((o) => (Object.keys(o).length === 1 && Array.isArray(o.$or) ? (o.$or as Record<string, unknown>[]) : [o]));
            return { $or: items };
        }
        case "and": return mergeAnd(e.items.map((x) => filterOf(x, resolve)));
        case "not": {
            const inner = filterOf(e.e, resolve);
            const keys = Object.keys(inner);
            if (keys.length === 1 && !keys[0].startsWith("$")) {
                const v = inner[keys[0]];
                if (isObj(v) && Object.keys(v).every((k) => k.startsWith("$")) && !("$not" in v)) {
                    if (Object.keys(v).length === 1 && "$eq" in v) return { [keys[0]]: { $ne: v.$eq } };
                    if (Object.keys(v).length === 1 && "$ne" in v) return { [keys[0]]: v.$ne };
                    if (Object.keys(v).length === 1 && "$in" in v) return { [keys[0]]: { $nin: v.$in } };
                    if (Object.keys(v).length === 1 && "$nin" in v) return { [keys[0]]: { $in: v.$nin } };
                    return { [keys[0]]: { $not: v } };
                }
                if (!isObj(v)) return { [keys[0]]: { $ne: v } };
            }
            return { $nor: [inner] };
        }
    }
}

function mergeAnd(parts: Record<string, unknown>[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const rest: Record<string, unknown>[] = [];
    const flat = parts.flatMap((p) => (Object.keys(p).length === 1 && Array.isArray(p.$and) ? (p.$and as Record<string, unknown>[]) : [p]));
    for (const p of flat) {
        let ok = true;
        for (const [k, v] of Object.entries(p)) {
            if (!(k in out)) continue;
            const cur = out[k];
            const opDoc = (x: unknown) => isObj(x) && Object.keys(x).every((y) => y.startsWith("$"));
            if (!k.startsWith("$") && opDoc(cur) && opDoc(v) && Object.keys(v as object).every((y) => !(y in (cur as object)))) continue;
            ok = false;
        }
        if (!ok) { rest.push(p); continue; }
        for (const [k, v] of Object.entries(p)) {
            if (k in out) out[k] = { ...(out[k] as object), ...(v as object) };
            else out[k] = v;
        }
    }
    if (!rest.length) return out;
    return { $and: [...(Object.keys(out).length ? [out] : []), ...rest] };
}

// ---- Java (Spring Data MongoDB Criteria)
function jLit(v: Lit): string {
    if (v === null) return "null";
    if (typeof v === "string") return JSON.stringify(v);
    if (typeof v === "number") return Number.isInteger(v) && Math.abs(v) > 2147483647 ? `${v}L` : String(v);
    return String(v);
}
interface JCrit {
    field?: string;
    chain?: string;
    expr: string;
}
function jCrit(e: Expr, resolve: Resolver): JCrit {
    const simple = (field: string, chain: string): JCrit => ({ field, chain, expr: `Criteria.where(${JSON.stringify(field)})${chain}` });
    switch (e.t) {
        case "cmp": {
            let { left, right, op } = e;
            if ("lit" in left && !("lit" in right)) { [left, right] = [right, left]; op = FLIP[op]; }
            if ("lit" in left || !("lit" in right)) return { expr: "/* column-to-column comparison: use Criteria.expr(ComparisonOperators…) */ new Criteria()" };
            const m = { "=": "is", "!=": "ne", "<": "lt", "<=": "lte", ">": "gt", ">=": "gte" }[op];
            return simple(resolve(left), `.${m}(${jLit(right.lit)})`);
        }
        case "in": return simple(fieldOf(e.x, resolve), `.${e.neg ? "nin" : "in"}(${e.values.map(jLit).join(", ")})`);
        case "like": {
            const args = JSON.stringify(likeToRegex(e.pattern)) + (e.ci ? ', "i"' : "");
            return simple(fieldOf(e.x, resolve), `${e.neg ? ".not()" : ""}.regex(${args})`);
        }
        case "null": return simple(fieldOf(e.x, resolve), e.neg ? ".ne(null)" : ".is(null)");
        case "between": {
            const f = fieldOf(e.x, resolve);
            if (!e.neg) return simple(f, `.gte(${jLit(e.lo)}).lte(${jLit(e.hi)})`);
            return { expr: `new Criteria().orOperator(Criteria.where(${JSON.stringify(f)}).lt(${jLit(e.lo)}), Criteria.where(${JSON.stringify(f)}).gt(${jLit(e.hi)}))` };
        }
        case "and": {
            const parts = e.items.map((x) => jCrit(x, resolve));
            const fields = parts.map((p) => p.field);
            if (parts.every((p) => p.field) && new Set(fields).size === fields.length)
                return { expr: parts.map((p, i) => (i === 0 ? p.expr : `.and(${JSON.stringify(p.field)})${p.chain}`)).join("\n        ") };
            return { expr: `new Criteria().andOperator(\n        ${parts.map((p) => p.expr).join(",\n        ")})` };
        }
        case "or": return { expr: `new Criteria().orOperator(\n        ${e.items.map((x) => jCrit(x, resolve).expr).join(",\n        ")})` };
        case "not": return { expr: `new Criteria().norOperator(${jCrit(e.e, resolve).expr})` };
    }
}

const aggKey = (a: AggCall) => `${a.fn}(${a.arg})`;
const defaultAggName = (a: AggCall) => (a.arg === "*" ? a.fn.toLowerCase() : `${a.fn.toLowerCase()}_${a.arg.replace(/\./g, "_")}`);

export function sqlToMongo(sql: string): Translation {
    const notes: string[] = [];
    const toks = tokenize(sql.trim());
    if (!toks.length) return { output: "", unsupported: [], notes };
    const first = toks[0].v.toUpperCase();
    if (first === "WITH") throw new Unsupported("common table expressions (WITH)");
    if (first !== "SELECT") throw new Unsupported(`${first} statements (only SELECT is translated)`);
    const p = new Parser(toks);
    const ast = p.select();
    const unsupported = [...ast.skipped];
    const coll = ast.table;
    const db = `db.${/^[A-Za-z_$][\w$]*$/.test(coll) ? coll : `getCollection(${JSON.stringify(coll)})`}`;
    const plain: Resolver = (x) => {
        if ("col" in x) return x.col;
        if ("agg" in x) throw new Unsupported("aggregate functions in WHERE (use HAVING)");
        throw new Unsupported("literal operands");
    };
    const filter = ast.where ? filterOf(ast.where, plain) : {};
    const crit = ast.where ? jCrit(ast.where, plain).expr : "";
    const hasAgg = ast.items.some((i) => i.kind === "agg");
    const groupCols = ast.distinct ? ast.items.filter((i) => i.kind === "col").map((i) => (i as { col: string }).col) : ast.groupBy;
    if (ast.distinct && ast.groupBy.length) throw new Unsupported("DISTINCT together with GROUP BY");
    if (ast.distinct && ast.star) throw new Unsupported("SELECT DISTINCT *");

    // COUNT(*) only
    if (!groupCols.length && !ast.having && ast.items.length === 1 && !ast.star && ast.items[0].kind === "agg" && ast.items[0].agg.fn === "COUNT" && ast.items[0].agg.arg === "*" && ast.limit === undefined && !ast.offset) {
        const java = `long count = mongoTemplate.count(${crit ? `new Query(${crit})` : "new Query()"}, ${JSON.stringify(coll)});`;
        return { output: `${db}.countDocuments(${shell(filter)})`, java, unsupported, notes };
    }

    // SELECT DISTINCT col
    if (ast.distinct && groupCols.length === 1 && !hasAgg && !ast.orderBy.length && ast.limit === undefined) {
        const java = `List<Object> values = mongoTemplate.query(Document.class).inCollection(${JSON.stringify(coll)})\n    .distinct(${JSON.stringify(groupCols[0])})${crit ? `.matching(new Query(${crit}))` : ""}.all();`;
        return { output: `${db}.distinct(${JSON.stringify(groupCols[0])}, ${shell(filter)})`, java, unsupported, notes };
    }

    if (!groupCols.length && !hasAgg && !ast.having) {
        // ---- find()
        const aliasOf = new Map<string, string>();
        for (const it of ast.items) if (it.kind === "col" && it.alias) aliasOf.set(it.alias.toLowerCase(), it.col);
        let projection: Record<string, unknown> | null = null;
        if (!ast.star && ast.items.length) {
            projection = {};
            for (const it of ast.items) if (it.kind === "col") projection[it.alias ?? it.col] = it.alias && it.alias !== it.col ? "$" + it.col : 1;
            if (!ast.items.some((it) => it.kind === "col" && (it.alias ?? it.col) === "_id")) projection._id = 0;
            if (ast.items.some((it) => it.kind === "col" && it.alias && it.alias !== it.col)) notes.push("Aliases use find() projection expressions, which need MongoDB 4.4 or newer.");
        }
        const sort: Record<string, 1 | -1> = {};
        for (const o of ast.orderBy) {
            if (!("col" in o.x)) throw new Unsupported("ORDER BY on an expression");
            sort[aliasOf.get(o.x.col.toLowerCase()) ?? o.x.col] = o.dir;
        }
        let out = `${db}.find(${shell(filter)}${projection ? ", " + shell(projection) : ""})`;
        if (Object.keys(sort).length) out += `.sort(${shell(sort)})`;
        if (ast.offset) out += `.skip(${ast.offset})`;
        if (ast.limit !== undefined) out += `.limit(${ast.limit})`;
        const j: string[] = [`Query query = new Query(${crit ? crit : ""});`];
        if (projection) {
            const inc = Object.entries(projection).filter(([k, v]) => v === 1 && k !== "_id").map(([k]) => JSON.stringify(k));
            if (inc.length) j.push(`query.fields().include(${inc.join(", ")})${projection._id === 0 ? '.exclude("_id")' : ""};`);
        }
        if (Object.keys(sort).length) j.push(`query.with(Sort.by(${Object.entries(sort).map(([k, d]) => `Sort.Order.${d === 1 ? "asc" : "desc"}(${JSON.stringify(k)})`).join(", ")}));`);
        if (ast.offset) j.push(`query.skip(${ast.offset});`);
        if (ast.limit !== undefined) j.push(`query.limit(${ast.limit});`);
        j.push(`List<Document> result = mongoTemplate.find(query, Document.class, ${JSON.stringify(coll)});`);
        return { output: out, java: j.join("\n"), unsupported, notes };
    }

    // ---- aggregate()
    if (ast.star) throw new Unsupported("SELECT * with GROUP BY or aggregate functions");
    const keyName = (c: string) => c.replace(/\./g, "_");
    const groupLower = groupCols.map((c) => c.toLowerCase());
    const accs = new Map<string, { name: string; agg: AggCall; hidden: boolean }>();
    const outNames: { name: string; from: string }[] = [];
    const used = new Set<string>();
    const addAcc = (a: AggCall, alias: string | undefined, hidden: boolean) => {
        const k = aggKey(a);
        const existing = accs.get(k);
        if (existing) { if (!hidden) existing.hidden = false; return existing.name; }
        let name = keyName(alias ?? defaultAggName(a));
        while (used.has(name)) name += "_";
        used.add(name);
        accs.set(k, { name, agg: a, hidden });
        return name;
    };
    const idPath = (col: string) => (groupCols.length === 1 ? "_id" : `_id.${keyName(col)}`);
    for (const it of ast.items) {
        if (it.kind === "agg") {
            const name = addAcc(it.agg, it.alias, false);
            outNames.push({ name, from: name });
        } else {
            const gi = groupLower.indexOf(it.col.toLowerCase());
            if (gi < 0) throw new Error(`Column ${it.col} must appear in GROUP BY or inside an aggregate function.`);
            const name = keyName(it.alias ?? it.col);
            used.add(name);
            outNames.push({ name, from: idPath(groupCols[gi]) });
        }
    }
    const aliasMap = new Map<string, string>(); // select alias → internal field
    for (const it of ast.items) if (it.alias) aliasMap.set(it.alias.toLowerCase(), it.kind === "agg" ? accs.get(aggKey(it.agg))!.name : idPath(it.col));
    const groupResolver: Resolver = (x) => {
        if ("agg" in x) return addAcc(x.agg, undefined, true);
        if ("col" in x) {
            const a = aliasMap.get(x.col.toLowerCase());
            if (a) return a;
            const gi = groupLower.indexOf(x.col.toLowerCase());
            if (gi >= 0) return idPath(groupCols[gi]);
            throw new Error(`${x.col} is neither a GROUP BY column nor a select alias.`);
        }
        throw new Unsupported("literal operands");
    };
    const having = ast.having ? filterOf(ast.having, groupResolver) : null;
    const havingJava = ast.having ? jCrit(ast.having, groupResolver).expr : "";
    const sort: Record<string, 1 | -1> = {};
    for (const o of ast.orderBy) sort[groupResolver(o.x)] = o.dir;

    const accExpr = (a: AggCall): unknown => {
        if (a.fn === "COUNT") return a.arg === "*" ? { $sum: 1 } : { $sum: { $cond: [{ $gt: ["$" + a.arg, null] }, 1, 0] } };
        return { ["$" + a.fn.toLowerCase()]: "$" + a.arg };
    };
    const group: Record<string, unknown> = {
        _id: groupCols.length === 0 ? null : groupCols.length === 1 ? "$" + groupCols[0] : Object.fromEntries(groupCols.map((c) => [keyName(c), "$" + c])),
    };
    for (const a of accs.values()) group[a.name] = accExpr(a.agg);
    const pipeline: unknown[] = [];
    if (ast.where) pipeline.push({ $match: filter });
    pipeline.push({ $group: group });
    if (having) pipeline.push({ $match: having });
    if (Object.keys(sort).length) pipeline.push({ $sort: sort });
    if (ast.offset) pipeline.push({ $skip: ast.offset });
    if (ast.limit !== undefined) pipeline.push({ $limit: ast.limit });
    const project: Record<string, unknown> = { _id: 0 };
    for (const o of outNames) project[o.name] = o.from === o.name ? 1 : "$" + o.from;
    pipeline.push({ $project: project });
    const output = `${db}.aggregate([\n${pipeline.map((s) => "  " + shell(s, 2)).join(",\n")}\n])`;

    // Spring Data aggregation
    const j: string[] = [];
    if (crit) j.push(`    Aggregation.match(${crit})`);
    let g = groupCols.length ? `Aggregation.group(${groupCols.map((c) => JSON.stringify(c)).join(", ")})` : "Aggregation.group()";
    for (const a of accs.values()) {
        const ag = a.agg;
        if (ag.fn === "COUNT") g += ag.arg === "*" ? `.count().as(${JSON.stringify(a.name)})` : `.count().as(${JSON.stringify(a.name)}) /* COUNT(${ag.arg}) counts non-null only in SQL */`;
        else g += `.${ag.fn.toLowerCase()}(${JSON.stringify(ag.arg)}).as(${JSON.stringify(a.name)})`;
    }
    j.push("    " + g);
    if (havingJava) j.push(`    Aggregation.match(${havingJava})`);
    if (Object.keys(sort).length) j.push(`    Aggregation.sort(Sort.by(${Object.entries(sort).map(([k, d]) => `Sort.Order.${d === 1 ? "asc" : "desc"}(${JSON.stringify(k)})`).join(", ")}))`);
    if (ast.offset) j.push(`    Aggregation.skip(${ast.offset}L)`);
    if (ast.limit !== undefined) j.push(`    Aggregation.limit(${ast.limit})`);
    const projAccs = outNames.filter((o) => o.from === o.name).map((o) => JSON.stringify(o.name));
    const keys = outNames.filter((o) => o.from !== o.name);
    let proj = `Aggregation.project(${projAccs.join(", ")})`;
    if (groupCols.length === 1 && keys.length) proj += `.and(${JSON.stringify(groupCols[0])}).previousOperation()`;
    else for (const k of keys) proj += `.and(${JSON.stringify(k.from)}).as(${JSON.stringify(k.name)})`;
    j.push("    " + proj);
    const java = `Aggregation agg = Aggregation.newAggregation(\n${j.join(",\n")}\n);\nList<Document> result = mongoTemplate.aggregate(agg, ${JSON.stringify(coll)}, Document.class).getMappedResults();`;
    if (ast.having) notes.push("HAVING became a $match stage after $group.");
    return { output, java, unsupported, notes };
}

// ============================================================ Mongo shell → SQL
function findClose(s: string, open: number): number {
    const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
    const stack: string[] = [];
    for (let i = open; i < s.length; i++) {
        const c = s[i];
        if (c === '"' || c === "'" || c === "`") {
            i++;
            while (i < s.length && s[i] !== c) { if (s[i] === "\\") i++; i++; }
            continue;
        }
        if (c === "/" && /[:,([{]\s*$/.test(s.slice(Math.max(0, i - 20), i))) {
            i++;
            let inClass = false;
            while (i < s.length && (s[i] !== "/" || inClass)) {
                if (s[i] === "\\") i++;
                else if (s[i] === "[") inClass = true;
                else if (s[i] === "]") inClass = false;
                i++;
            }
            continue;
        }
        if (pairs[c]) stack.push(pairs[c]);
        else if (c === ")" || c === "]" || c === "}") {
            if (stack.pop() !== c) throw new Error("Unbalanced brackets.");
            if (!stack.length) return i;
        }
    }
    throw new Error("Unbalanced brackets.");
}

/** Turns mongo shell helpers and regex literals into JSON5-compatible text. */
function preprocess(src: string): string {
    let out = "";
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (c === '"' || c === "'") {
            let j = i + 1;
            while (j < src.length && src[j] !== c) { if (src[j] === "\\") j++; j++; }
            out += src.slice(i, j + 1);
            i = j + 1;
            continue;
        }
        if (c === "/" && /[:,([{]\s*$/.test(out.slice(-20)) ) {
            let j = i + 1;
            let inClass = false;
            let pat = "";
            while (j < src.length && (src[j] !== "/" || inClass)) {
                if (src[j] === "\\") { pat += src[j] + src[j + 1]; j += 2; continue; }
                if (src[j] === "[") inClass = true;
                else if (src[j] === "]") inClass = false;
                pat += src[j++];
            }
            j++;
            const flags = /^[gimsuxy]*/.exec(src.slice(j))![0];
            j += flags.length;
            out += JSON.stringify(flags ? { $regex: pat, $options: flags } : { $regex: pat });
            i = j;
            continue;
        }
        const w = /^(new\s+)?(ObjectId|ISODate|Date|NumberLong|NumberInt|NumberDecimal|UUID|Timestamp)\s*\(/.exec(src.slice(i, i + 40));
        if (w && !/[\w$]/.test(src[i - 1] ?? "")) {
            const open = i + w[0].length - 1;
            const close = findClose(src, open);
            const argText = src.slice(open + 1, close).trim();
            let arg: unknown = undefined;
            if (argText) {
                try { arg = JSON5.parse(argText); } catch { throw new Unsupported(`${w[2]}(${argText})`); }
            }
            const name = w[2];
            let rep: unknown;
            if (name === "ObjectId") rep = { $oid: String(arg ?? "") };
            else if (name === "ISODate" || name === "Date") rep = { $date: arg === undefined ? "now" : String(arg) };
            else if (name === "NumberLong" || name === "NumberInt" || name === "NumberDecimal") rep = Number(arg);
            else if (name === "UUID") rep = String(arg ?? "");
            else throw new Unsupported(`${name}()`);
            out += JSON.stringify(rep);
            i = close + 1;
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

function parseArgs(text: string): unknown[] {
    const t = text.trim();
    if (!t) return [];
    try {
        return JSON5.parse("[" + preprocess(t) + "]") as unknown[];
    } catch (e) {
        if (e instanceof Unsupported) throw e;
        throw new Error(`Could not parse the arguments: ${(e as Error).message}`);
    }
}

const RESERVED = new Set(["order", "group", "select", "from", "where", "user", "key", "desc", "asc", "limit", "table", "index", "by", "count", "date", "time", "timestamp", "value", "values", "name", "type", "status", "level", "range"]);
function ident(p: string): string {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(p) && !RESERVED.has(p.toLowerCase()) ? p : `"${p.replace(/"/g, '""')}"`;
}
function sqlLit(v: unknown): string {
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
    if (typeof v === "number") return String(v);
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (isObj(v) && "$oid" in v) return sqlLit(v.$oid);
    if (isObj(v) && "$date" in v) return v.$date === "now" ? "CURRENT_TIMESTAMP" : `TIMESTAMP ${sqlLit(String(v.$date).replace("T", " ").replace(/Z$/, ""))}`;
    if (Array.isArray(v)) throw new Unsupported("array values (MongoDB array matching)");
    throw new Unsupported("embedded document values");
}
const isOpDoc = (v: unknown): v is Record<string, unknown> => isObj(v) && Object.keys(v).length > 0 && Object.keys(v).every((k) => k.startsWith("$")) && !("$oid" in v) && !("$date" in v);

function regexToLike(pattern: string): string | null {
    let p = pattern;
    const start = p.startsWith("^");
    if (start) p = p.slice(1);
    const end = /(^|[^\\])\$$/.test(p);
    if (end) p = p.slice(0, -1);
    let out = "";
    for (let i = 0; i < p.length; i++) {
        const c = p[i];
        if (c === "\\") {
            const n = p[i + 1];
            if (n === undefined || /[A-Za-z0-9]/.test(n)) return null; // \d, \w…
            if (n === "%" || n === "_") return null;
            out += n;
            i++;
        } else if (c === "." && p[i + 1] === "*") { out += "%"; i++; }
        else if (c === ".") out += "_";
        else if (/[*+?()[\]{}|^$]/.test(c)) return null;
        else if (c === "%" || c === "_" || c === "'") { if (c === "'") out += "''"; else return null; }
        else out += c;
    }
    return (start ? "" : "%") + out + (end ? "" : "%");
}

interface Ctx {
    notes: Set<string>;
    resolve: (field: string) => string;
}

function regexCond(col: string, pattern: string, options: string, ctx: Ctx): string {
    const like = regexToLike(pattern);
    const ci = options.includes("i");
    if (like !== null) {
        const l = like.replace(/%%+/g, "%");
        if (l === "%") return `${col} IS NOT NULL`;
        return ci ? `LOWER(${col}) LIKE '${l.toLowerCase()}'` : `${col} LIKE '${l}'`;
    }
    ctx.notes.add("Regular expressions that do not fit LIKE use REGEXP (MySQL); PostgreSQL uses ~ (or ~* for case-insensitive).");
    return `${col} REGEXP ${sqlLit(ci ? `(?i)${pattern}` : pattern)}`;
}

function opCond(col: string, ops: Record<string, unknown>, ctx: Ctx): string {
    const parts: string[] = [];
    for (const [op, v] of Object.entries(ops)) {
        switch (op) {
            case "$eq": parts.push(v === null ? `${col} IS NULL` : `${col} = ${sqlLit(v)}`); break;
            case "$ne": parts.push(v === null ? `${col} IS NOT NULL` : `${col} <> ${sqlLit(v)}`); break;
            case "$gt": parts.push(`${col} > ${sqlLit(v)}`); break;
            case "$gte": parts.push(`${col} >= ${sqlLit(v)}`); break;
            case "$lt": parts.push(`${col} < ${sqlLit(v)}`); break;
            case "$lte": parts.push(`${col} <= ${sqlLit(v)}`); break;
            case "$in":
            case "$nin": {
                if (!Array.isArray(v)) throw new Error(`${op} needs an array.`);
                const vals = v.filter((x) => x !== null);
                const hasNull = vals.length !== v.length;
                if (vals.some((x) => isObj(x) && "$regex" in x)) throw new Unsupported(`regular expressions inside ${op}`);
                const list = vals.length ? `${col} ${op === "$in" ? "IN" : "NOT IN"} (${vals.map(sqlLit).join(", ")})` : "";
                if (op === "$in") parts.push(hasNull ? `(${[list, `${col} IS NULL`].filter(Boolean).join(" OR ")})` : list || "1 = 0");
                else parts.push(hasNull ? [list, `${col} IS NOT NULL`].filter(Boolean).join(" AND ") : list || "1 = 1");
                break;
            }
            case "$exists":
                ctx.notes.add("$exists maps to IS NULL / IS NOT NULL; SQL cannot tell a missing field from a null one.");
                parts.push(v ? `${col} IS NOT NULL` : `${col} IS NULL`);
                break;
            case "$regex": parts.push(regexCond(col, String(v), String(ops.$options ?? ""), ctx)); break;
            case "$options": break;
            case "$not": {
                if (!isObj(v)) throw new Error("$not needs an operator document or a regex.");
                parts.push(`NOT (${opCond(col, v, ctx)})`);
                break;
            }
            default: throw new Unsupported(`${op} operator`);
        }
    }
    return parts.join(" AND ");
}

function cond(filter: unknown, ctx: Ctx): string {
    if (!isObj(filter)) throw new Error("A filter must be an object.");
    const parts: string[] = [];
    for (const [k, v] of Object.entries(filter)) {
        if (k === "$and" || k === "$or" || k === "$nor") {
            if (!Array.isArray(v)) throw new Error(`${k} needs an array.`);
            const subs = v.map((x) => cond(x, ctx)).filter(Boolean).map((s) => (/ (AND|OR) /.test(s) ? `(${s})` : s));
            if (!subs.length) continue;
            if (k === "$and") parts.push(subs.join(" AND "));
            else if (k === "$or") parts.push(subs.length > 1 ? `(${subs.join(" OR ")})` : subs[0]);
            else parts.push(`NOT (${subs.join(" OR ")})`);
            continue;
        }
        if (k.startsWith("$")) throw new Unsupported(`${k} in a filter`);
        const col = ctx.resolve(k);
        if (isOpDoc(v)) parts.push(opCond(col, v, ctx));
        else if (v === null) parts.push(`${col} IS NULL`);
        else parts.push(`${col} = ${sqlLit(v)}`);
    }
    return parts.join(" AND ");
}

interface Call {
    name: string;
    args: unknown[];
}

function parseShellQuery(text: string): { coll: string; calls: Call[] } {
    let s = text.trim().replace(/;\s*$/, "");
    const m = /^db\s*\.\s*(?:getCollection\(\s*(['"])(.+?)\1\s*\)|([A-Za-z_$][\w$-]*))/.exec(s);
    if (!m) throw new Error("Expected a query starting with db.<collection>.find(…) or db.<collection>.aggregate([…]).");
    const coll = m[2] ?? m[3];
    s = s.slice(m[0].length);
    const calls: Call[] = [];
    while (s.trim()) {
        const c = /^\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(s);
        if (!c) throw new Error(`Unexpected text: ${s.trim().slice(0, 30)}`);
        const open = c[0].length - 1;
        const close = findClose(s, open);
        calls.push({ name: c[1], args: parseArgs(s.slice(open + 1, close)) });
        s = s.slice(close + 1);
    }
    if (!calls.length) throw new Error("No method call found after the collection name.");
    return { coll, calls };
}

const UNSUPPORTED_STAGES = new Set(["$lookup", "$unwind", "$facet", "$bucket", "$bucketAuto", "$addFields", "$set", "$unset", "$replaceRoot", "$replaceWith", "$out", "$merge", "$sample", "$graphLookup", "$unionWith", "$geoNear", "$densify", "$fill", "$setWindowFields", "$redact", "$search", "$vectorSearch", "$documents", "$changeStream", "$collStats", "$indexStats"]);

export function mongoToSql(text: string): Translation {
    if (!text.trim()) return { output: "", unsupported: [], notes: [] };
    const { coll, calls } = parseShellQuery(text);
    const notes = new Set<string>();
    const unsupported: string[] = [];
    const plainCtx: Ctx = { notes, resolve: (f) => { if (f.includes(".")) notes.add("Dotted MongoDB paths were kept as quoted column names; map them to your actual columns or JSON accessors."); return ident(f); } };
    let select: string[] | null = null;
    const where: string[] = [];
    const groupBy: string[] = [];
    const having: string[] = [];
    let orderBy: string[] = [];
    let limit: number | undefined;
    let offset = 0;
    let distinct = false;
    const head = calls[0];

    const applySkip = (n: number) => {
        if (limit !== undefined) limit = Math.max(0, limit - n);
        offset += n;
    };
    const applyLimit = (n: number) => { limit = limit === undefined ? n : Math.min(limit, n); };

    if (["find", "findOne", "count", "countDocuments", "distinct", "estimatedDocumentCount"].includes(head.name)) {
        let filterArg: unknown = {};
        if (head.name === "distinct") {
            if (typeof head.args[0] !== "string") throw new Error("distinct() needs a field name.");
            select = [ident(head.args[0])];
            distinct = true;
            filterArg = head.args[1] ?? {};
        } else filterArg = head.args[0] ?? {};
        const w = cond(filterArg, plainCtx);
        if (w) where.push(w);
        if (head.name === "count" || head.name === "countDocuments" || head.name === "estimatedDocumentCount") select = ["COUNT(*)"];
        if (head.name === "findOne") limit = 1;
        const proj = head.name === "find" || head.name === "findOne" ? head.args[1] : undefined;
        const applyProjection = (p: unknown) => {
            if (!isObj(p) || !Object.keys(p).length) return;
            const cols: string[] = [];
            let includeId = true;
            let exclusion = false;
            for (const [k, v] of Object.entries(p)) {
                if (v === 0 || v === false) { if (k === "_id") includeId = false; else exclusion = true; continue; }
                if (v === 1 || v === true) cols.push(ident(k));
                else if (typeof v === "string" && v.startsWith("$")) cols.push(`${ident(v.slice(1))} AS ${ident(k)}`);
                else unsupported.push(`projection expression for ${k}`);
            }
            if (exclusion && !cols.length) { notes.add("Exclusion projections cannot be expressed in SQL; SELECT * was used. List the wanted columns instead."); return; }
            select = includeId && !cols.includes("_id") ? ["_id", ...cols] : cols;
        };
        applyProjection(proj);
        for (const c of calls.slice(1)) {
            const a = c.args[0];
            switch (c.name) {
                case "sort":
                    if (!isObj(a)) throw new Error("sort() needs an object.");
                    orderBy = Object.entries(a).map(([k, d]) => `${ident(k)} ${Number(d) < 0 ? "DESC" : "ASC"}`);
                    break;
                case "limit": applyLimit(Number(a)); break;
                case "skip": applySkip(Number(a)); break;
                case "projection": case "project": applyProjection(a); break;
                case "count": select = ["COUNT(*)"]; break;
                case "pretty": case "toArray": case "hint": case "maxTimeMS": case "batchSize": case "comment": case "allowDiskUse": break;
                case "collation": notes.add("collation() was ignored; use a COLLATE clause if needed."); break;
                default: unsupported.push(`.${c.name}()`);
            }
        }
    } else if (head.name === "aggregate") {
        const pipeline = head.args[0];
        if (!Array.isArray(pipeline)) throw new Error("aggregate() needs an array pipeline.");
        let grouped = false;
        let paged = false;
        const names = new Map<string, string>(); // output field → SQL expression after $group / $project
        const groupResolve = (f: string) => {
            const e = names.get(f);
            if (e === undefined) throw new Unsupported(`a reference to ${f}, which is not produced by the previous stage`);
            return e;
        };
        for (const [idx, stage] of pipeline.entries()) {
            if (!isObj(stage) || Object.keys(stage).length !== 1) throw new Error(`Stage ${idx + 1} must be an object with one $operator.`);
            const [op, body] = Object.entries(stage)[0];
            if (UNSUPPORTED_STAGES.has(op)) { unsupported.push(`${op} stage`); continue; }
            switch (op) {
                case "$match": {
                    if (paged) { unsupported.push("$match after $skip/$limit (needs a subquery)"); break; }
                    if (!grouped) {
                        const w = cond(body, plainCtx);
                        if (w) where.push(w);
                    } else {
                        const h = cond(body, { notes, resolve: groupResolve });
                        if (h) having.push(h);
                    }
                    break;
                }
                case "$group": {
                    if (grouped) { unsupported.push("a second $group (needs a subquery)"); break; }
                    if (paged) { unsupported.push("$group after $skip/$limit (needs a subquery)"); break; }
                    if (!isObj(body)) throw new Error("$group needs an object.");
                    grouped = true;
                    select = [];
                    const id = body._id;
                    if (typeof id === "string" && id.startsWith("$")) {
                        const col = ident(id.slice(1));
                        groupBy.push(col);
                        select.push(`${col} AS _id`);
                        names.set("_id", col);
                    } else if (isObj(id)) {
                        for (const [k, v] of Object.entries(id)) {
                            if (typeof v !== "string" || !v.startsWith("$")) throw new Unsupported(`$group _id expression for ${k}`);
                            const col = ident(v.slice(1));
                            groupBy.push(col);
                            select.push(col === ident(k) ? col : `${col} AS ${ident(k)}`);
                            names.set(`_id.${k}`, col);
                        }
                    } else if (id !== null && id !== undefined && typeof id !== "number" && typeof id !== "string") {
                        throw new Unsupported("$group _id expressions");
                    }
                    for (const [k, v] of Object.entries(body)) {
                        if (k === "_id") continue;
                        if (!isObj(v) || Object.keys(v).length !== 1) { unsupported.push(`accumulator ${k}`); continue; }
                        const [acc, arg] = Object.entries(v)[0];
                        let expr: string | null = null;
                        const field = typeof arg === "string" && arg.startsWith("$") ? ident(arg.slice(1)) : null;
                        if (acc === "$sum" && typeof arg === "number") expr = arg === 1 ? "COUNT(*)" : `COUNT(*) * ${arg}`;
                        else if (acc === "$count") expr = "COUNT(*)";
                        else if (["$sum", "$avg", "$min", "$max"].includes(acc) && field) expr = `${acc.slice(1).toUpperCase()}(${field})`;
                        if (!expr) { unsupported.push(`accumulator ${k}: ${acc}`); continue; }
                        select.push(`${expr} AS ${ident(k)}`);
                        names.set(k, expr);
                    }
                    break;
                }
                case "$sortByCount": {
                    if (grouped || paged) { unsupported.push("$sortByCount after $group/$limit"); break; }
                    if (typeof body !== "string" || !body.startsWith("$")) throw new Unsupported("$sortByCount with an expression");
                    const col = ident(body.slice(1));
                    grouped = true;
                    groupBy.push(col);
                    select = [`${col} AS _id`, "COUNT(*) AS count"];
                    names.set("_id", col).set("count", "COUNT(*)");
                    orderBy = ["count DESC"];
                    break;
                }
                case "$sort": {
                    if (paged) { unsupported.push("$sort after $skip/$limit (needs a subquery)"); break; }
                    if (!isObj(body)) throw new Error("$sort needs an object.");
                    orderBy = Object.entries(body).map(([k, d]) => {
                        let col: string;
                        if (grouped) {
                            groupResolve(k);
                            col = k === "_id" ? "_id" : k.startsWith("_id.") ? ident(k.slice(4)) : ident(k);
                        } else col = ident(k);
                        return `${col} ${Number(d) < 0 ? "DESC" : "ASC"}`;
                    });
                    break;
                }
                case "$skip": applySkip(Number(body)); paged = true; break;
                case "$limit": applyLimit(Number(body)); paged = true; break;
                case "$count": {
                    if (grouped || paged) { unsupported.push("$count after $group/$limit (needs a subquery)"); break; }
                    select = [`COUNT(*) AS ${ident(String(body))}`];
                    break;
                }
                case "$project": {
                    if (!isObj(body)) throw new Error("$project needs an object.");
                    const cols: string[] = [];
                    let includeId = true;
                    const newNames = new Map<string, string>();
                    for (const [k, v] of Object.entries(body)) {
                        if (v === 0 || v === false) { if (k === "_id") includeId = false; else unsupported.push(`exclusion of ${k} in $project`); continue; }
                        let expr: string;
                        if (v === 1 || v === true) expr = grouped ? groupResolve(k) : ident(k);
                        else if (typeof v === "string" && v.startsWith("$")) expr = grouped ? groupResolve(v.slice(1)) : ident(v.slice(1));
                        else { unsupported.push(`$project expression for ${k}`); continue; }
                        cols.push(expr === ident(k) ? expr : `${expr} AS ${ident(k)}`);
                        newNames.set(k, expr);
                    }
                    if (includeId && !("_id" in body)) {
                        if (grouped) { if (names.has("_id")) { cols.unshift(`${names.get("_id")} AS _id`); newNames.set("_id", names.get("_id")!); } }
                        else cols.unshift("_id");
                    }
                    if (grouped) { names.clear(); newNames.forEach((v, k) => names.set(k, v)); }
                    if (cols.length) select = cols;
                    break;
                }
                default: unsupported.push(`${op} stage`);
            }
        }
        if (grouped && orderBy.length) notes.add("ORDER BY uses the output column names (aliases).");
    } else {
        throw new Unsupported(`db.collection.${head.name}()`);
    }

    const lines = [`SELECT ${distinct ? "DISTINCT " : ""}${select && (select as string[]).length ? (select as string[]).join(", ") : "*"}`, `FROM ${ident(coll)}`];
    if (where.length) lines.push(`WHERE ${where.join(" AND ")}`);
    if (groupBy.length) lines.push(`GROUP BY ${groupBy.join(", ")}`);
    if (having.length) lines.push(`HAVING ${having.join(" AND ")}`);
    if (orderBy.length) lines.push(`ORDER BY ${orderBy.join(", ")}`);
    if (limit !== undefined) lines.push(`LIMIT ${limit}`);
    if (offset) lines.push(`OFFSET ${offset}`);
    return { output: lines.join("\n") + ";", unsupported, notes: [...notes] };
}

export function translate(dir: "sql2mongo" | "mongo2sql", text: string): Translation {
    try {
        return dir === "sql2mongo" ? sqlToMongo(text) : mongoToSql(text);
    } catch (e) {
        if (e instanceof Unsupported) return { output: "", unsupported: [e.message], notes: [], error: `Not supported: ${e.message}.` };
        return { output: "", unsupported: [], notes: [], error: (e as Error).message };
    }
}
