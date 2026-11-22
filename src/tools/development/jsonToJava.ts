// JSON -> Java (records, Lombok or plain POJOs) for JsonToCode.vue.

/** Inferred JSON type; the same shape JsonToCode.vue uses for the other languages. */
export type JT =
    | { k: "str"; fmt?: StrFmt }
    | { k: "int"; big?: boolean }
    | { k: "num" | "bool" | "null" | "unk" }
    | { k: "arr"; e: JT }
    | { k: "obj"; f: Map<string, { t: JT; opt: boolean }> }
    | { k: "union"; u: JT[] };

export type StrFmt = "uuid" | "odt" | "ldt" | "date";

export interface JavaOpts {
    style: "record" | "lombok" | "pojo";
    jackson: boolean;
    ignoreUnknown: boolean;
    nonNull: boolean;
    validation: boolean;
    pkg: string;
    nested: boolean;
    ints: "Long" | "Integer" | "auto";
    javaTime: boolean;
}

export function detectFmt(s: string): StrFmt | undefined {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return "uuid";
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return "date";
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/i.test(s)) return "odt";
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?$/.test(s)) return "ldt";
    return undefined;
}

const JAVA_KW = new Set(
    "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record yield sealed permits".split(
        " ",
    ),
);

function words(s: string) {
    return s
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean);
}
function pascal(s: string) {
    let r = words(s)
        .map((x) => x[0]!.toUpperCase() + x.slice(1))
        .join("");
    if (!r) r = "Item";
    return /^\d/.test(r) ? "T" + r : r;
}
function camel(s: string) {
    const w = words(s);
    if (!w.length) return "value";
    let r = w.map((x, i) => (i === 0 ? (/^[A-Z0-9]+$/.test(x) ? x.toLowerCase() : x[0]!.toLowerCase() + x.slice(1)) : x[0]!.toUpperCase() + x.slice(1))).join("");
    if (/^\d/.test(r)) r = "field" + r;
    return JAVA_KW.has(r) ? r + "Value" : r;
}
function singular(s: string) {
    if (/ies$/i.test(s) && s.length > 4) return s.slice(0, -3) + "y";
    if (/(ss|us)$/i.test(s)) return s;
    if (/s$/i.test(s) && s.length > 3) return s.slice(0, -1);
    return s;
}
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

interface Field {
    key: string;
    name: string;
    type: string;
    ann: string[];
    comment?: string;
}
interface Decl {
    name: string;
    fields: Field[];
    imports: Set<string>;
}

const IMP = {
    List: "java.util.List",
    UUID: "java.util.UUID",
    OffsetDateTime: "java.time.OffsetDateTime",
    LocalDateTime: "java.time.LocalDateTime",
    LocalDate: "java.time.LocalDate",
    JsonProperty: "com.fasterxml.jackson.annotation.JsonProperty",
    JsonIgnoreProperties: "com.fasterxml.jackson.annotation.JsonIgnoreProperties",
    JsonInclude: "com.fasterxml.jackson.annotation.JsonInclude",
    Valid: "jakarta.validation.Valid",
    NotNull: "jakarta.validation.constraints.NotNull",
    NotBlank: "jakarta.validation.constraints.NotBlank",
    Email: "jakarta.validation.constraints.Email",
    Data: "lombok.Data",
    Builder: "lombok.Builder",
    NoArgsConstructor: "lombok.NoArgsConstructor",
    AllArgsConstructor: "lombok.AllArgsConstructor",
} as const;

const FMT_TYPE: Record<StrFmt, keyof typeof IMP> = { uuid: "UUID", odt: "OffsetDateTime", ldt: "LocalDateTime", date: "LocalDate" };

function nullable(t: JT) {
    return t.k === "null" || t.k === "unk" || (t.k === "union" && t.u.some((x) => x.k === "null"));
}
function nonNull(t: JT): JT {
    if (t.k !== "union") return t;
    const nn = t.u.filter((x) => x.k !== "null");
    return nn.length === 1 ? nn[0]! : t;
}
function hasObj(t: JT): boolean {
    t = nonNull(t);
    return t.k === "obj" || (t.k === "arr" && hasObj(t.e));
}

export function genJava(root: JT, rootName: string, o: JavaOpts): string {
    const decls: Decl[] = [];
    const used = new Set<string>();
    const uniq = (base: string) => {
        let n = base;
        let i = 2;
        while (used.has(n)) n = base + i++;
        used.add(n);
        return n;
    };

    const typeOf = (t: JT, hint: string, imp: Set<string>): string => {
        switch (t.k) {
            case "str":
                if (o.javaTime && t.fmt) {
                    const n = FMT_TYPE[t.fmt];
                    imp.add(IMP[n]);
                    return n;
                }
                return "String";
            case "int":
                return o.ints === "auto" ? (t.big ? "Long" : "Integer") : o.ints;
            case "num":
                return "Double";
            case "bool":
                return "Boolean";
            case "null":
            case "unk":
                return "Object";
            case "arr":
                imp.add(IMP.List);
                return `List<${typeOf(t.e, singular(hint), imp)}>`;
            case "union": {
                const nn = t.u.filter((x) => x.k !== "null");
                return nn.length === 1 ? typeOf(nn[0]!, hint, imp) : "Object";
            }
            case "obj":
                return declare(t, uniq(pascal(hint)));
        }
    };

    function declare(t: Extract<JT, { k: "obj" }>, name: string): string {
        const d: Decl = { name, fields: [], imports: new Set() };
        decls.push(d);
        const names = new Set<string>();
        for (const [key, f] of t.f) {
            let name = camel(key);
            while (names.has(name)) name += "_";
            names.add(name);
            const type = typeOf(f.t, key, d.imports);
            const ann: string[] = [];
            const field: Field = { key, name, type, ann };
            if (key !== name) {
                if (o.jackson) {
                    ann.push(`@JsonProperty(${JSON.stringify(key)})`);
                    d.imports.add(IMP.JsonProperty);
                } else field.comment = `JSON key: ${key}`;
            }
            if (o.validation) {
                const required = !f.opt && !nullable(f.t);
                const base = nonNull(f.t);
                const isStr = type === "String";
                if (required) {
                    const a = isStr ? "NotBlank" : "NotNull";
                    ann.push("@" + a);
                    d.imports.add(IMP[a]);
                }
                if (isStr && /e-?mail/i.test(key) && base.k === "str") {
                    ann.push("@Email");
                    d.imports.add(IMP.Email);
                }
                if (hasObj(f.t)) {
                    ann.push("@Valid");
                    d.imports.add(IMP.Valid);
                }
            }
            d.fields.push(field);
        }
        return name;
    }

    const rn = pascal(rootName || "Root");
    let preamble = "";
    const rootT = nonNull(root);
    if (rootT.k === "obj") {
        used.add(rn);
        declare(rootT, rn);
    } else if (rootT.k === "arr" && nonNull(rootT.e).k === "obj") {
        used.add(rn);
        declare(nonNull(rootT.e) as Extract<JT, { k: "obj" }>, rn);
        preamble = `// The JSON is a top-level array: read it as List<${rn}>, e.g.\n// objectMapper.readValue(json, new TypeReference<List<${rn}>>() {});\n`;
    } else {
        const imp = new Set<string>();
        return `// The JSON is a top-level ${rootT.k === "arr" ? "array" : "value"}; it maps to ${typeOf(root, rn, imp)}, so no class is needed.\n`;
    }

    const classAnn = (d: Decl): string[] => {
        const a: string[] = [];
        if (o.style === "lombok") {
            a.push("@Data", "@Builder", "@NoArgsConstructor", "@AllArgsConstructor");
            d.imports.add(IMP.Data).add(IMP.Builder).add(IMP.NoArgsConstructor).add(IMP.AllArgsConstructor);
        }
        if (o.jackson && o.ignoreUnknown) {
            a.push("@JsonIgnoreProperties(ignoreUnknown = true)");
            d.imports.add(IMP.JsonIgnoreProperties);
        }
        if (o.jackson && o.nonNull) {
            a.push("@JsonInclude(JsonInclude.Include.NON_NULL)");
            d.imports.add(IMP.JsonInclude);
        }
        return a;
    };

    const render = (d: Decl, ind: string, isNested: boolean, inner: string[]): string => {
        const lines = classAnn(d).map((a) => ind + a);
        const i1 = ind + "    ";
        const innerBlock = inner.length ? inner.map((x) => "\n" + x).join("\n") : "";
        if (o.style === "record") {
            if (!d.fields.length) lines.push(`${ind}public record ${d.name}() {${innerBlock ? innerBlock + "\n" + ind : ""}}`);
            else {
                lines.push(`${ind}public record ${d.name}(`);
                d.fields.forEach((f, i) => {
                    const comma = i < d.fields.length - 1 ? "," : "";
                    const comment = f.comment ? ` // ${f.comment}` : "";
                    lines.push(`${ind}        ${[...f.ann, f.type, f.name].join(" ")}${comma}${comment}`);
                });
                lines.push(`${ind}) {${innerBlock ? innerBlock + "\n" + ind : ""}}`);
            }
            return lines.join("\n");
        }
        lines.push(`${ind}public ${isNested ? "static " : ""}class ${d.name} {`);
        const spaced = d.fields.some((f) => f.ann.length);
        const body: string[] = [];
        d.fields.forEach((f, i) => {
            if (spaced && i) body.push("");
            for (const a of f.ann) body.push(i1 + a);
            body.push(`${i1}private ${f.type} ${f.name};${f.comment ? ` // ${f.comment}` : ""}`);
        });
        if (o.style === "pojo") {
            for (const f of d.fields) {
                const getter = (f.type === "boolean" ? "is" : "get") + cap(f.name);
                body.push("", `${i1}public ${f.type} ${getter}() {`, `${i1}    return ${f.name};`, `${i1}}`);
                body.push("", `${i1}public void set${cap(f.name)}(${f.type} ${f.name}) {`, `${i1}    this.${f.name} = ${f.name};`, `${i1}}`);
            }
        }
        lines.push(...body);
        if (innerBlock) lines.push(innerBlock);
        lines.push(`${ind}}`);
        return lines.join("\n");
    };

    const importBlock = (set: Set<string>) => {
        const all = [...set].sort();
        const other = all.filter((x) => !x.startsWith("java."));
        const java = all.filter((x) => x.startsWith("java."));
        const parts = [other, java].filter((g) => g.length).map((g) => g.map((x) => `import ${x};`).join("\n"));
        return parts.join("\n\n");
    };
    const pkg = o.pkg.trim() ? `package ${o.pkg.trim().replace(/;$/, "")};\n\n` : "";

    if (o.nested || decls.length === 1) {
        const [rootDecl, ...rest] = decls;
        const inner = rest.map((d) => render(d, "    ", true, []));
        const text = render(rootDecl!, "", false, inner);
        const imports = new Set<string>();
        for (const d of decls) for (const x of d.imports) imports.add(x);
        const ib = importBlock(imports);
        return `${preamble}${pkg}${ib ? ib + "\n\n" : ""}${text}\n`;
    }
    return decls
        .map((d) => {
            const text = render(d, "", false, []);
            const ib = importBlock(d.imports);
            return `// ${d.name}.java\n${pkg}${ib ? ib + "\n\n" : ""}${text}\n`;
        })
        .join("\n")
        .replace(/^/, preamble);
}
