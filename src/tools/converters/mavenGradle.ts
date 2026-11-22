// Dependency declarations: Maven pom.xml <-> Gradle Groovy DSL <-> Gradle Kotlin DSL.
import { XMLParser, XMLValidator } from "fast-xml-parser";

export type BuildFmt = "maven" | "groovy" | "kotlin";

export interface Dep {
    group: string;
    artifact: string;
    version?: string;
    /** Gradle configuration (implementation, testImplementation, …). */
    conf: string;
    classifier?: string;
    type?: string;
    optional?: boolean;
    exclusions: { group?: string; module?: string }[];
    platform?: "platform" | "enforcedPlatform";
    /** A dependencyManagement entry that is not a BOM import: becomes a Gradle constraint. */
    constraint?: boolean;
    /** Maven system scope path. */
    systemPath?: string;
}

export interface ConvertOut {
    out: string;
    error?: string;
    notes: string[];
    count: number;
}

// ---------------------------------------------------------------- knowledge

const PROCESSORS = new Set([
    "org.mapstruct:mapstruct-processor",
    "org.springframework.boot:spring-boot-configuration-processor",
    "org.springframework.boot:spring-boot-autoconfigure-processor",
    "org.hibernate.orm:hibernate-jpamodelgen",
    "org.hibernate:hibernate-jpamodelgen",
    "com.querydsl:querydsl-apt",
    "org.immutables:value",
    "com.google.auto.value:auto-value",
    "info.picocli:picocli-codegen",
]);
const LOMBOK = "org.projectlombok:lombok";
const DEVTOOLS = "org.springframework.boot:spring-boot-devtools";

function scopeToConf(scope: string, ga: string, optional: boolean, notes: string[]): string[] {
    const test = scope === "test";
    if (ga === LOMBOK) return test ? ["testCompileOnly", "testAnnotationProcessor"] : ["compileOnly", "annotationProcessor"];
    if (PROCESSORS.has(ga)) return [test ? "testAnnotationProcessor" : "annotationProcessor"];
    if (ga === DEVTOOLS) {
        notes.push(`${ga}: developmentOnly needs the Spring Boot Gradle plugin.`);
        return ["developmentOnly"];
    }
    if (optional && !test) notes.push(`${ga}: Gradle has no optional dependencies; kept as ${scope === "provided" ? "compileOnly" : "implementation"} (consider compileOnly or a feature variant).`);
    switch (scope) {
        case "":
        case "compile":
            return ["implementation"];
        case "runtime":
            return ["runtimeOnly"];
        case "test":
            return ["testImplementation"];
        case "provided":
            return ["compileOnly"];
        case "system":
            notes.push(`${ga}: system scope maps to compileOnly(files(...)); prefer a repository artifact.`);
            return ["compileOnly"];
        default:
            notes.push(`${ga}: unknown scope '${scope}', used implementation.`);
            return ["implementation"];
    }
}

function confToScope(conf: string, notes: string[], ga: string): { scope?: string; optional?: boolean } {
    switch (conf) {
        case "implementation":
        case "api":
        case "compile":
            if (conf === "api") notes.push(`${ga}: api has no Maven equivalent beyond compile scope.`);
            return {};
        case "runtimeOnly":
        case "runtime":
            return { scope: "runtime" };
        case "compileOnly":
        case "providedCompile":
        case "compileOnlyApi":
            return { scope: "provided" };
        case "providedRuntime":
            return { scope: "provided" };
        case "developmentOnly":
            return { scope: "runtime", optional: true };
        case "annotationProcessor":
        case "kapt":
            return { scope: "provided" };
        default:
            if (/^test/.test(conf)) return { scope: "test" };
            notes.push(`${ga}: configuration '${conf}' has no Maven scope; used compile.`);
            return {};
    }
}

// ---------------------------------------------------------------- Maven reader

type XNode = Record<string, unknown>;
const xmlParser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true, isArray: (n) => ["dependency", "exclusion", "plugin"].includes(n) });

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

export function readMaven(text: string, substitute: boolean, notes: string[]): Dep[] {
    const xml = text.replace(/^\s*<\?xml[^>]*\?>/, "");
    const wrapped = `<__root>${xml}</__root>`;
    const valid = XMLValidator.validate(wrapped);
    if (valid !== true) throw new Error(`Line ${valid.err.line}: ${valid.err.msg}`);
    const doc = xmlParser.parse(wrapped) as XNode;
    const root = (doc.__root ?? {}) as XNode;
    const project = (root.project as XNode | undefined) ?? root;
    const props = new Map<string, string>();
    const p = project.properties;
    if (p && typeof p === "object") for (const [k, v] of Object.entries(p as XNode)) props.set(k, str(v));
    const parent = project.parent as XNode | undefined;
    const projVersion = str(project.version) || str(parent?.version);
    if (projVersion) props.set("project.version", projVersion);
    if (str(project.groupId) || str(parent?.groupId)) props.set("project.groupId", str(project.groupId) || str(parent?.groupId));
    if (parent?.version) props.set("project.parent.version", str(parent.version));
    const missing = new Set<string>();
    const subst = (s: string) =>
        substitute
            ? s.replace(/\$\{([^}]+)\}/g, (m, k: string) => {
                  const v = props.get(k);
                  if (v == null) missing.add(k);
                  return v ?? m;
              })
            : s;

    const deps: Dep[] = [];
    const walk = (node: unknown, path: string[]) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) {
            node.forEach((n) => walk(n, path));
            return;
        }
        for (const [k, v] of Object.entries(node as XNode)) {
            if (k === "dependency") {
                if (path.includes("plugin")) {
                    notes.push(`Skipped ${(v as XNode[]).length} plugin dependenc${(v as XNode[]).length === 1 ? "y" : "ies"} (inside <plugin>).`);
                    continue;
                }
                const managed = path.includes("dependencyManagement");
                for (const d of v as XNode[]) {
                    const group = subst(str(d.groupId));
                    const artifact = subst(str(d.artifactId));
                    if (!group || !artifact) {
                        notes.push("Skipped a <dependency> without groupId or artifactId.");
                        continue;
                    }
                    const ga = `${group}:${artifact}`;
                    const scope = str(d.scope);
                    const type = str(d.type) || undefined;
                    const optional = str(d.optional) === "true";
                    const exclusions: Dep["exclusions"] = [];
                    const ex = (d.exclusions as XNode | undefined)?.exclusion as XNode[] | undefined;
                    for (const e of ex ?? []) exclusions.push({ group: str(e.groupId) || undefined, module: str(e.artifactId) || undefined });
                    const base = { group, artifact, version: subst(str(d.version)) || undefined, classifier: subst(str(d.classifier)) || undefined, exclusions };
                    if (scope === "import" || (managed && type === "pom")) {
                        deps.push({ ...base, conf: "implementation", platform: "platform" });
                        continue;
                    }
                    if (managed) {
                        deps.push({ ...base, type: type === "jar" ? undefined : type, conf: "implementation", constraint: true });
                        continue;
                    }
                    for (const conf of scopeToConf(scope, ga, optional, notes))
                        deps.push({ ...base, type: type === "jar" ? undefined : type, conf, optional, systemPath: str(d.systemPath) || undefined });
                }
            } else walk(v, [...path, k]);
        }
    };
    walk(root, []);
    for (const k of missing) notes.push(`Property \${${k}} is not defined in the input; left as is.`);
    return deps;
}

// ---------------------------------------------------------------- Gradle reader

const CONF_RE = /^(implementation|api|compileOnly|compileOnlyApi|runtimeOnly|testImplementation|testCompileOnly|testRuntimeOnly|annotationProcessor|testAnnotationProcessor|kapt|kaptTest|developmentOnly|testFixturesImplementation|testFixturesApi|integrationTestImplementation|compile|testCompile|runtime|testRuntime|providedCompile|providedRuntime|classpath)\b\s*(.*)$/;

function unquote(s: string) {
    return s.trim().replace(/^(['"])(.*)\1$/, "$2");
}

/** Reads `key: 'v'` (Groovy) or `key = "v"` (Kotlin) pairs. */
function namedArgs(s: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const m of s.matchAll(/(\w+)\s*[:=]\s*(['"])(.*?)\2/g)) out[m[1]!] = m[3]!;
    for (const m of s.matchAll(/(\w+)\s*[:=]\s*(true|false)\b/g)) out[m[1]!] = m[2]!;
    return out;
}

function fromCoords(c: string): Omit<Dep, "conf" | "exclusions"> | null {
    let s = c;
    let type: string | undefined;
    const at = s.indexOf("@");
    if (at >= 0) {
        type = s.slice(at + 1);
        s = s.slice(0, at);
    }
    const parts = s.split(":");
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    return { group: parts[0], artifact: parts[1], version: parts[2] || undefined, classifier: parts[3] || undefined, type };
}

function gradleVersion(v: string | undefined) {
    // $springVersion / ${springVersion} / ${property("x")} -> ${x} for Maven
    return v?.replace(/\$\{(?:property|project\.property|findProperty)\(['"]([^'"]+)['"]\)!?\}/g, "${$1}").replace(/\$\{?([A-Za-z_][\w.]*)\}?/g, "${$1}");
}

export function readGradle(text: string, notes: string[]): Dep[] {
    const clean = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
    const lines = clean.split(/\r?\n/);
    const deps: Dep[] = [];
    let inConstraints = 0;
    for (let i = 0; i < lines.length; i++) {
        const lineNo = i + 1;
        let line = lines[i]!.replace(/(^|\s)\/\/.*$/, "").trim();
        if (!line) continue;
        if (/^(dependencies|constraints)\s*\{\s*$/.test(line)) {
            if (line.startsWith("constraints")) inConstraints = 1;
            continue;
        }
        if (line === "}") {
            if (inConstraints) inConstraints = 0;
            continue;
        }
        const m = line.match(CONF_RE);
        if (!m) {
            notes.push(`Line ${lineNo}: not a dependency declaration, skipped: ${line}`);
            continue;
        }
        const conf = m[1]!;
        let rest = m[2]!;
        // Gather a configuration closure { exclude … } that may span lines.
        let closure = "";
        const open = rest.search(/\)\s*\{|['"]\s*\{/);
        const braceAt = open >= 0 ? rest.indexOf("{", open) : -1;
        if (braceAt >= 0) {
            closure = rest.slice(braceAt + 1);
            rest = rest.slice(0, braceAt);
            let depth = 1 + (closure.match(/\{/g)?.length ?? 0) - (closure.match(/\}/g)?.length ?? 0);
            while (depth > 0 && i + 1 < lines.length) {
                const next = lines[++i]!.replace(/(^|\s)\/\/.*$/, "");
                depth += (next.match(/\{/g)?.length ?? 0) - (next.match(/\}/g)?.length ?? 0);
                closure += "\n" + next;
            }
            closure = closure.replace(/\}\s*$/, "");
        }
        rest = rest.trim();
        // Strip one pair of call parentheses: implementation("…") / implementation(platform("…"))
        if (/^\(.*\)$/.test(rest)) rest = rest.slice(1, -1).trim();
        let platform: Dep["platform"];
        const pm = rest.match(/^(platform|enforcedPlatform)\s*\(\s*(.*?)\s*\)$/) ?? rest.match(/^(platform|enforcedPlatform)\s+(.*)$/);
        if (pm) {
            platform = pm[1] as Dep["platform"];
            rest = pm[2]!;
        }
        if (/^(project|files|fileTree|gradleApi|localGroovy|kotlin)\s*\(/.test(rest) || /^libs\./.test(rest)) {
            notes.push(`Line ${lineNo}: ${rest.startsWith("libs.") ? "version catalog references" : rest.split("(")[0] + "(…)"} cannot be converted: ${line}`);
            continue;
        }
        let dep: Omit<Dep, "conf" | "exclusions"> | null = null;
        if (/^(['"]).*\1$/.test(rest)) dep = fromCoords(unquote(rest));
        else if (/\b(group|name)\s*[:=]/.test(rest)) {
            const a = namedArgs(rest);
            if (a.group && a.name) dep = { group: a.group, artifact: a.name, version: a.version, classifier: a.classifier, type: a.ext };
        }
        if (!dep) {
            notes.push(`Line ${lineNo}: could not read the coordinates: ${line}`);
            continue;
        }
        dep.version = gradleVersion(dep.version);
        const exclusions: Dep["exclusions"] = [];
        for (const em of closure.matchAll(/exclude\s*\(?([^)\n]*)\)?/g)) {
            const a = namedArgs(em[1]!);
            if (a.group || a.module) exclusions.push({ group: a.group, module: a.module });
        }
        const other = closure
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l && !/^exclude\b/.test(l));
        if (other.length) notes.push(`Line ${lineNo}: ignored closure content: ${other.join("; ")}`);
        deps.push({ ...dep, conf, exclusions, platform, constraint: inConstraints > 0 || undefined });
    }
    return deps;
}

// ---------------------------------------------------------------- writers

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function writeMaven(deps: Dep[], notes: string[], wrap: boolean): string {
    const managed: string[] = [];
    const normal: string[] = [];
    const seen = new Map<string, Dep>();
    const rank = (s?: string) => (s === undefined ? 0 : s === "provided" ? 1 : s === "runtime" ? 2 : 3);
    const items: { d: Dep; scope?: string; optional?: boolean }[] = [];
    let processorNote = false;
    for (const d of deps) {
        const ga = `${d.group}:${d.artifact}`;
        if (d.platform || d.constraint) {
            if (d.platform === "enforcedPlatform") notes.push(`${ga}: enforcedPlatform written as a regular BOM import.`);
            managed.push(block(d, d.platform ? { scope: "import", type: "pom" } : {}, "        "));
            continue;
        }
        let { scope, optional } = confToScope(d.conf, notes, ga);
        if (ga === LOMBOK) {
            scope = /^test/.test(d.conf) ? "test" : undefined;
            optional = scope ? undefined : true;
        } else if ((d.conf === "annotationProcessor" || d.conf === "kapt") && !processorNote) {
            processorNote = true;
            notes.push("Annotation processors are written as provided dependencies; with Maven you can also list them under maven-compiler-plugin <annotationProcessorPaths>.");
        }
        if (d.optional) optional = true;
        const key = `${ga}:${d.classifier ?? ""}:${d.type ?? ""}`;
        const prev = seen.get(key);
        if (prev) {
            const prevItem = items.find((x) => x.d === prev)!;
            if (rank(scope) < rank(prevItem.scope)) prevItem.scope = scope;
            continue;
        }
        seen.set(key, d);
        items.push({ d, scope, optional });
    }
    for (const it of items) normal.push(block(it.d, { scope: it.scope, optional: it.optional }, wrap ? "    " : ""));
    const parts: string[] = [];
    if (managed.length) parts.push(`<dependencyManagement>\n    <dependencies>\n${managed.join("\n")}\n    </dependencies>\n</dependencyManagement>`);
    if (normal.length) parts.push(wrap ? `<dependencies>\n${normal.join("\n")}\n</dependencies>` : normal.join("\n"));
    return parts.join("\n\n") + (parts.length ? "\n" : "");
}

function block(d: Dep, o: { scope?: string; optional?: boolean; type?: string }, ind: string): string {
    const l: string[] = [`${ind}<dependency>`];
    const t = (tag: string, v?: string) => v && l.push(`${ind}    <${tag}>${esc(v)}</${tag}>`);
    t("groupId", d.group);
    t("artifactId", d.artifact);
    t("version", d.version);
    t("type", o.type ?? d.type);
    t("classifier", d.classifier);
    t("scope", o.scope);
    if (o.optional) t("optional", "true");
    if (d.exclusions.length) {
        l.push(`${ind}    <exclusions>`);
        for (const e of d.exclusions) {
            l.push(`${ind}        <exclusion>`, `${ind}            <groupId>${esc(e.group ?? "*")}</groupId>`, `${ind}            <artifactId>${esc(e.module ?? "*")}</artifactId>`, `${ind}        </exclusion>`);
        }
        l.push(`${ind}    </exclusions>`);
    }
    l.push(`${ind}</dependency>`);
    return l.join("\n");
}

function gradleString(s: string, kotlin: boolean) {
    // ${x} Maven properties become Gradle project properties.
    const interp = /\$\{([^}]+)\}/.test(s);
    if (interp) s = s.replace(/\$\{([^}]+)\}/g, (_m, k: string) => (kotlin ? `\${property("${k}")}` : `\${property('${k}')}`));
    return kotlin || interp ? `"${s}"` : `'${s}'`;
}

export function writeGradle(deps: Dep[], kotlin: boolean, wrap: boolean, notes: string[]): string {
    const ind = wrap ? "    " : "";
    const lines: string[] = [];
    const constraints: string[] = [];
    let propNote = false;
    for (const d of deps) {
        let coords = `${d.group}:${d.artifact}`;
        if (d.version || d.classifier) coords += `:${d.version ?? ""}`;
        if (d.classifier) coords += `:${d.classifier}`;
        if (d.type && d.type !== "jar") coords += `@${d.type}`;
        if (/\$\{/.test(coords) && !propNote) {
            propNote = true;
            notes.push("Unresolved ${…} versions are read with property(…); define them in gradle.properties (or turn on property substitution).");
        }
        let arg = gradleString(coords, kotlin);
        if (d.systemPath) {
            arg = `files(${gradleString(d.systemPath, kotlin)})`;
        }
        if (d.platform) arg = `${d.platform}(${arg})`;
        const conf = d.conf;
        let line: string;
        if (kotlin) line = `${conf}(${arg})`;
        else line = d.exclusions.length || d.platform ? `${conf}${d.exclusions.length ? `(${arg})` : ` ${arg}`}` : `${conf} ${arg}`;
        if (d.exclusions.length) {
            const ex = d.exclusions.map((e) => {
                const parts: string[] = [];
                if (e.group && e.group !== "*") parts.push(kotlin ? `group = "${e.group}"` : `group: '${e.group}'`);
                if (e.module && e.module !== "*") parts.push(kotlin ? `module = "${e.module}"` : `module: '${e.module}'`);
                if (!parts.length) return `${ind}    transitive = false`;
                return kotlin ? `${ind}    exclude(${parts.join(", ")})` : `${ind}    exclude ${parts.join(", ")}`;
            });
            if (kotlin && ex.some((x) => x.includes("transitive"))) ex.splice(0, ex.length, ...ex.map((x) => x.replace("transitive = false", "isTransitive = false")));
            line = `${line} {\n${ex.join("\n")}\n${ind}}`;
        }
        (d.constraint ? constraints : lines).push(ind + line.replace(/\n/g, "\n"));
    }
    const body = [...lines];
    if (constraints.length) {
        body.push(`${ind}constraints {`);
        body.push(...constraints.map((c) => "    " + c.replace(/\n/g, "\n    ")));
        body.push(`${ind}}`);
    }
    if (!wrap) return body.join("\n") + (body.length ? "\n" : "");
    return `dependencies {\n${body.join("\n")}\n}\n`;
}

// ---------------------------------------------------------------- entry point

export function convertBuild(text: string, from: BuildFmt, to: BuildFmt, opts: { substitute: boolean; wrap: boolean }): ConvertOut {
    const notes: string[] = [];
    if (!text.trim()) return { out: "", notes, count: 0 };
    let deps: Dep[];
    try {
        deps = from === "maven" ? readMaven(text, opts.substitute, notes) : readGradle(text, notes);
    } catch (e) {
        return { out: "", error: (e as Error).message, notes, count: 0 };
    }
    if (!deps.length) return { out: "", error: from === "maven" ? "No <dependency> elements found." : "No dependency declarations found.", notes, count: 0 };
    if (to !== "maven") {
        // Maven-to-Gradle: Maven properties referenced from Gradle need property(); Gradle-to-Gradle keeps versions.
        deps = deps.map((d) => ({ ...d, version: from === "maven" ? d.version : d.version?.replace(/\$\{([A-Za-z_][\w.]*)\}/g, "${$1}") }));
    }
    const out = to === "maven" ? writeMaven(deps, notes, opts.wrap) : writeGradle(deps, to === "kotlin", opts.wrap, notes);
    return { out, notes, count: deps.length };
}
