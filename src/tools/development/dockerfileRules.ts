/* Dockerfile parser and lint rules (hadolint-style codes where an equivalent exists, DX### for our own). */

export type Severity = "error" | "warning" | "info";
export interface Finding {
    code: string;
    severity: Severity;
    /** 1-based line of the instruction (0 = whole file). */
    line: number;
    message: string;
    fix: string;
    why: string;
}
export interface Instruction {
    line: number;
    endLine: number;
    keyword: string;
    /** Arguments with line continuations joined (heredoc bodies appended after a newline). */
    args: string;
    stage: number;
}
export interface Stage {
    index: number;
    line: number;
    image: string;
    alias: string;
    instructions: Instruction[];
}
export interface LintResult {
    instructions: Instruction[];
    stages: Stage[];
    findings: Finding[];
    directives: Record<string, string>;
    ecosystems: Set<"java" | "node" | "python" | "go" | "ruby" | "php" | "dotnet">;
    score: number;
}

const KEYWORDS = new Set([
    "FROM", "RUN", "CMD", "LABEL", "MAINTAINER", "EXPOSE", "ENV", "ADD", "COPY", "ENTRYPOINT",
    "VOLUME", "USER", "WORKDIR", "ARG", "ONBUILD", "STOPSIGNAL", "HEALTHCHECK", "SHELL",
]);

export function parseDockerfile(text: string): { instructions: Instruction[]; directives: Record<string, string>; errors: Finding[] } {
    const lines = text.split(/\r?\n/);
    const directives: Record<string, string> = {};
    const errors: Finding[] = [];
    let i = 0;
    // Parser directives: only at the very top, before any blank line, comment or instruction.
    for (; i < lines.length; i++) {
        const m = lines[i].match(/^#\s*([a-zA-Z]+)\s*=\s*(\S+)\s*$/);
        if (!m || !["syntax", "escape", "check"].includes(m[1].toLowerCase())) break;
        directives[m[1].toLowerCase()] = m[2];
    }
    const esc = directives.escape === "`" ? "`" : "\\";
    const instructions: Instruction[] = [];
    let stage = -1;
    while (i < lines.length) {
        const raw = lines[i];
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith("#")) {
            i++;
            continue;
        }
        const start = i;
        let buf = "";
        let line = raw;
        for (;;) {
            const t = line.replace(/\s+$/, "");
            if (t.endsWith(esc)) {
                buf += t.slice(0, -1) + " ";
                i++;
                // Comment and empty lines inside a continuation are skipped by Docker.
                while (i < lines.length && (/^\s*#/.test(lines[i]) || !lines[i].trim())) i++;
                if (i >= lines.length) break;
                line = lines[i];
            } else {
                buf += t;
                break;
            }
        }
        i++;
        const m = buf.trim().match(/^(\S+)\s*([\s\S]*)$/);
        if (!m) continue;
        const keyword = m[1].toUpperCase();
        let args = m[2].trim();
        // Heredocs (RUN <<EOF … EOF, COPY <<EOF /dst …): best effort.
        const hd = [...args.matchAll(/<<(-?)(["']?)([A-Za-z_][\w]*)\2/g)];
        for (const h of hd) {
            const strip = h[1] === "-";
            const delim = h[3];
            const body: string[] = [];
            while (i < lines.length) {
                const l = strip ? lines[i].replace(/^\t+/, "") : lines[i];
                i++;
                if (l.trim() === delim) break;
                body.push(lines[i - 1]);
            }
            args += "\n" + body.join("\n");
        }
        if (keyword === "FROM") stage++;
        if (!KEYWORDS.has(keyword))
            errors.push({ code: "DX000", severity: "error", line: start + 1, message: `Unknown instruction ${m[1]}.`, fix: "Check the spelling; valid instructions are FROM, RUN, COPY, ADD, CMD, ENTRYPOINT, ENV, ARG, …", why: "Docker refuses to build a Dockerfile with an unknown instruction." });
        instructions.push({ line: start + 1, endLine: i, keyword, args, stage: Math.max(stage, -1) });
    }
    return { instructions, directives, errors };
}

/** Split a shell string into commands on && || ; | and newlines (quotes respected, roughly). */
function splitCommands(s: string): string[] {
    const out: string[] = [];
    let cur = "";
    let q = "";
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (q) {
            if (c === q) q = "";
            cur += c;
            continue;
        }
        if (c === "'" || c === '"') {
            q = c;
            cur += c;
            continue;
        }
        if ((c === "&" && s[i + 1] === "&") || (c === "|" && s[i + 1] === "|")) {
            out.push(cur);
            cur = "";
            i++;
            continue;
        }
        if (c === ";" || c === "\n" || c === "|") {
            out.push(cur + (c === "|" ? " |" : ""));
            cur = c === "|" ? "| " : "";
            continue;
        }
        cur += c;
    }
    out.push(cur);
    return out.map((x) => x.trim()).filter(Boolean);
}

const words = (cmd: string) => cmd.split(/\s+/).filter(Boolean);

function parseFrom(args: string) {
    const toks = words(args).filter((t) => !t.startsWith("--"));
    const image = toks[0] ?? "";
    const asIdx = toks.findIndex((t) => t.toLowerCase() === "as");
    const alias = asIdx >= 0 ? (toks[asIdx + 1] ?? "") : "";
    return { image, alias };
}

function imageParts(image: string) {
    const digest = image.includes("@");
    const noDigest = image.split("@")[0];
    const last = noDigest.slice(noDigest.lastIndexOf("/") + 1);
    const tag = last.includes(":") ? last.slice(last.indexOf(":") + 1) : "";
    const repo = last.includes(":") ? noDigest.slice(0, noDigest.length - tag.length - 1) : noDigest;
    return { repo, tag, digest };
}

const SECRET_NAME = /(pass(word|wd)?|secret|token|api[_-]?key|private[_-]?key|access[_-]?key|credentials?)$/i;
const DEP_MANIFEST = /(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|gradle\/|mvnw|\.mvn|requirements[\w.-]*\.txt|pyproject\.toml|poetry\.lock|Pipfile|go\.(mod|sum)|Gemfile|composer\.(json|lock)|\.csproj|Cargo\.(toml|lock))/;
const DEP_INSTALL = /\b(npm (ci|install|i)\b|yarn( install)?\s*($|&&|--)|pnpm (install|i)\b|pip3? install|python3? -m pip install|poetry install|mvnw?\b|\.\/mvnw|gradlew?\b|\.\/gradlew|go (mod download|build)|bundle install|composer install|dotnet (restore|publish|build)|cargo build)/;

const parseJsonArray = (s: string): string[] | null => {
    try {
        const v = JSON.parse(s);
        return Array.isArray(v) && v.every((x) => typeof x === "string") ? v : null;
    } catch {
        return null;
    }
};

export function lint(text: string): LintResult {
    const { instructions, directives, errors } = parseDockerfile(text);
    const findings: Finding[] = [...errors];
    const add = (f: Finding) => findings.push(f);
    const stages: Stage[] = [];
    const ecosystems: LintResult["ecosystems"] = new Set();

    for (const ins of instructions) {
        if (ins.keyword === "FROM") {
            const { image, alias } = parseFrom(ins.args);
            stages.push({ index: stages.length, line: ins.line, image, alias, instructions: [ins] });
        } else if (stages.length) stages[stages.length - 1].instructions.push(ins);
    }

    if (!instructions.length) return { instructions, stages, findings, directives, ecosystems, score: 100 };
    const firstNonArg = instructions.find((x) => x.keyword !== "ARG");
    if (!stages.length) add({ code: "DL3061", severity: "error", line: 1, message: "No FROM instruction.", fix: "Start the Dockerfile with FROM <image>:<tag> (only ARG may come before it).", why: "Every build stage needs a base image." });
    else if (firstNonArg && firstNonArg.keyword !== "FROM")
        add({ code: "DL3061", severity: "error", line: firstNonArg.line, message: `${firstNonArg.keyword} before the first FROM.`, fix: "Move it after FROM; only ARG (and parser directives) may precede FROM.", why: "Docker rejects instructions other than ARG before the first FROM." });

    const aliases = new Map<string, number>();
    const globalArgs = new Set(instructions.filter((x) => x.keyword === "ARG" && x.stage < 0).map((x) => words(x.args)[0]?.split("=")[0]));
    const all = instructions.map((x) => x.args).join("\n");
    if (/\b(java|jar)\b|\.jar\b|maven|gradle|temurin|openjdk|corretto|spring/i.test(all) || stages.some((s) => /jdk|jre|temurin|corretto|maven|gradle|java/i.test(s.image))) ecosystems.add("java");
    if (/\b(npm|yarn|pnpm|node)\b|package\.json/.test(all) || stages.some((s) => /^node\b|\/node\b/.test(s.image))) ecosystems.add("node");
    if (/\bpip3?\b|requirements|python|poetry/.test(all)) ecosystems.add("python");
    if (/\bgo (build|mod)\b|go\.mod/.test(all) || stages.some((s) => /^golang\b/.test(s.image))) ecosystems.add("go");
    if (/\bbundle\b|Gemfile/.test(all)) ecosystems.add("ruby");
    if (/composer/.test(all)) ecosystems.add("php");
    if (/dotnet|\.csproj/.test(all)) ecosystems.add("dotnet");
    const pipNoCacheEnv = /PIP_NO_CACHE_DIR/.test(all);

    for (const st of stages) {
        const from = st.instructions[0];
        const finalStage = st.index === stages.length - 1;
        // FROM
        if (st.alias) {
            const lower = st.alias.toLowerCase();
            if (aliases.has(lower)) add({ code: "DL3024", severity: "error", line: from.line, message: `Stage name ${st.alias} is already used (line ${aliases.get(lower)}).`, fix: "Give each stage a unique AS name.", why: "COPY --from and --target refer to stages by name; duplicates are ambiguous." });
            else aliases.set(lower, from.line);
        }
        const img = st.image;
        const prevStage = aliases.has(img.toLowerCase()) && img.toLowerCase() !== st.alias.toLowerCase();
        if (img && img !== "scratch" && !prevStage) {
            if (/\$/.test(img)) {
                const v = img.match(/\$\{?(\w+)/)?.[1] ?? "";
                if (!globalArgs.has(v)) add({ code: "DX012", severity: "warning", line: from.line, message: `FROM uses $${v}, but no ARG ${v} is declared before the first FROM.`, fix: `Add ARG ${v}=<default> at the top of the Dockerfile.`, why: "Only ARGs declared before the first FROM can be used in FROM lines." });
            } else {
                const p = imageParts(img);
                if (!p.digest && !p.tag) add({ code: "DL3006", severity: "warning", line: from.line, message: `Base image ${img} has no tag, so it means latest.`, fix: `Pin a version, e.g. FROM ${p.repo}:<version>, or a digest FROM ${p.repo}@sha256:…`, why: "latest changes underneath you; builds stop being reproducible and can break or pick up vulnerabilities without any change in your repo." });
                else if (!p.digest && p.tag === "latest") add({ code: "DL3007", severity: "warning", line: from.line, message: `Base image ${img} uses the latest tag.`, fix: `Use an explicit version tag (e.g. ${p.repo}:<major.minor>) or pin by digest.`, why: "latest is a moving target, so two builds of the same commit can produce different images." });
                if (/^(library\/)?openjdk$/.test(p.repo)) add({ code: "DX013", severity: "info", line: from.line, message: "The openjdk images on Docker Hub are deprecated and no longer updated.", fix: "Switch to eclipse-temurin, amazoncorretto, bellsoft/liberica-runtime-container or a distroless Java image.", why: "Deprecated images stop receiving security patches." });
            }
        }

        let cmdCount = 0;
        let epCount = 0;
        let user = "";
        let manifestCopied = false;
        let contextCopy: Instruction | null = null;
        let contextCopyFlagged = false;
        let workdirSet = false;
        let usesCurl = 0;
        let usesWget = 0;
        for (const ins of st.instructions) {
            const a = ins.args;
            switch (ins.keyword) {
                case "MAINTAINER":
                    add({ code: "DL4000", severity: "warning", line: ins.line, message: "MAINTAINER is deprecated.", fix: `Use LABEL org.opencontainers.image.authors="${a.replace(/"/g, "")}"`, why: "MAINTAINER was deprecated in Docker 1.13; labels are the standard way to store metadata." });
                    break;
                case "WORKDIR":
                    workdirSet = true;
                    if (!/^(\/|\$|[A-Za-z]:[\\/]|["']\/)/.test(a)) add({ code: "DL3000", severity: "warning", line: ins.line, message: `Relative WORKDIR ${a}.`, fix: `Use an absolute path, e.g. WORKDIR /${a.replace(/^\.\//, "")}`, why: "A relative WORKDIR depends on every earlier WORKDIR, which is fragile and hard to read." });
                    break;
                case "USER":
                    user = words(a)[0] ?? "";
                    break;
                case "EXPOSE":
                    for (const t of words(a)) {
                        if (t.includes("$")) continue;
                        const m = t.match(/^(\d+)(?:-(\d+))?(?:\/(tcp|udp|sctp))?$/i);
                        const ok = m && Number(m[1]) <= 65535 && (!m[2] || (Number(m[2]) <= 65535 && Number(m[2]) >= Number(m[1])));
                        if (!ok) add({ code: "DL3011", severity: "error", line: ins.line, message: `EXPOSE ${t} is not a valid port.`, fix: "Use a port number 0-65535, optionally with /tcp or /udp (e.g. EXPOSE 8080/tcp).", why: "Docker rejects invalid port specs; host:container mappings belong to docker run -p, not EXPOSE." });
                    }
                    break;
                case "CMD":
                case "ENTRYPOINT": {
                    if (ins.keyword === "CMD") cmdCount++;
                    else epCount++;
                    if (a.startsWith("[")) {
                        if (!parseJsonArray(a)) add({ code: "DX014", severity: "error", line: ins.line, message: `${ins.keyword} looks like exec form but is not a valid JSON array.`, fix: `Use double quotes: ${ins.keyword} ["java", "-jar", "app.jar"]`, why: "Invalid JSON (e.g. single quotes) silently falls back to shell form, wrapping the command in /bin/sh -c." });
                    } else if (a) add({ code: "DL3025", severity: "warning", line: ins.line, message: `${ins.keyword} uses shell form.`, fix: `Use exec form: ${ins.keyword} ${JSON.stringify(words(a).filter((w) => w !== "exec"))}`, why: "Shell form runs your process as a child of /bin/sh, which does not forward SIGTERM, so docker stop waits 10 s and then kills the app without a graceful shutdown." });
                    break;
                }
                case "ENV":
                case "ARG": {
                    const names: string[] = [];
                    if (ins.keyword === "ARG") names.push(...words(a).map((w) => w.split("=")[0]));
                    else if (/^\S+=/.test(a)) for (const m of a.matchAll(/(?:^|\s)([A-Za-z_][\w.-]*)=/g)) names.push(m[1]);
                    else names.push(words(a)[0] ?? "");
                    for (const n of names) {
                        if (!n || /_(FILE|PATH|DIR|URL|HOST|USER(NAME)?)$/i.test(n) || !SECRET_NAME.test(n)) continue;
                        add({
                            code: "DX005", severity: "warning", line: ins.line,
                            message: `${ins.keyword} ${n} looks like a secret.`,
                            fix: "Pass it at runtime (env var or mounted file), or use a BuildKit secret: RUN --mount=type=secret,id=" + n.toLowerCase() + " … and docker build --secret id=" + n.toLowerCase() + ",src=…",
                            why: ins.keyword === "ENV" ? "ENV values are baked into the image config; anyone who can pull the image can read them with docker inspect." : "ARG values are recorded in the image history (docker history) and in the build cache.",
                        });
                    }
                    break;
                }
                case "ADD": {
                    const toks = words(a).filter((t) => !t.startsWith("--"));
                    const srcs = a.startsWith("[") ? (parseJsonArray(a) ?? []).slice(0, -1) : toks.slice(0, -1);
                    const urls = srcs.filter((s) => /^(https?|git@|git):/.test(s) || s.endsWith(".git"));
                    const tars = srcs.filter((s) => /\.(tar|tar\.(gz|bz2|xz|zst)|tgz|tbz2?|txz)$/i.test(s));
                    if (urls.length) add({ code: "DL3020", severity: "info", line: ins.line, message: `ADD downloads ${urls.join(", ")}.`, fix: /--checksum/.test(a) ? "OK. Keep the --checksum flag up to date." : "Add --checksum=sha256:… or download with curl in a RUN and verify it, so the build fails if the file changes.", why: "Remote ADD is fine but unverified downloads are a supply-chain risk, and the layer cache cannot tell if the remote file changed." });
                    else if (tars.length === srcs.length && srcs.length) add({ code: "DL3020", severity: "info", line: ins.line, message: "ADD auto-extracts the local archive.", fix: "OK if extraction is what you want; otherwise use COPY.", why: "ADD unpacks local tar archives, which COPY does not; that is the one legitimate local use of ADD." });
                    else add({ code: "DL3020", severity: "warning", line: ins.line, message: "Use COPY instead of ADD for local files.", fix: `COPY ${a}`, why: "ADD has hidden behaviour (URL download, tar extraction). COPY does exactly one thing and is easier to reason about." });
                    // fallthrough-ish checks for context copy
                    if (srcs.some((s) => s === "." || s === "./")) contextCopy ??= ins;
                    break;
                }
                case "COPY": {
                    const fromFlag = a.match(/--from=(\S+)/)?.[1];
                    if (fromFlag && !/^\d+$/.test(fromFlag) && !/[:/]/.test(fromFlag) && !aliases.has(fromFlag.toLowerCase()))
                        add({ code: "DL3022", severity: "warning", line: ins.line, message: `COPY --from=${fromFlag} does not refer to an earlier stage.`, fix: `Define FROM … AS ${fromFlag} before this line, or use an image reference (name:tag).`, why: "Docker would try to pull an image called " + fromFlag + " instead of using your build stage." });
                    if (fromFlag) break;
                    const toks = words(a).filter((t) => !t.startsWith("--"));
                    const srcs = a.startsWith("[") ? (parseJsonArray(a) ?? []).slice(0, -1) : toks.slice(0, -1);
                    if (srcs.some((s) => DEP_MANIFEST.test(s))) manifestCopied = true;
                    if (srcs.some((s) => s === "." || s === "./" || s === "*")) contextCopy ??= ins;
                    const dest = toks[toks.length - 1] ?? "";
                    if (!workdirSet && dest && !dest.startsWith("/") && !dest.startsWith("$") && toks.length > 1)
                        add({ code: "DL3045", severity: "info", line: ins.line, message: `COPY to relative destination ${dest} without a WORKDIR.`, fix: "Set WORKDIR /app first, or use an absolute destination.", why: "Without WORKDIR the destination is relative to / of the base image, which may not be where you expect." });
                    break;
                }
                case "RUN": {
                    const body = a.replace(/^(--\S+\s+)+/, "");
                    const cmds = splitCommands(body);
                    const has = (re: RegExp) => cmds.some((c) => re.test(c));
                    for (const c of cmds) {
                        const w = words(c);
                        if (w[0] === "sudo") add({ code: "DL3004", severity: "warning", line: ins.line, message: "Do not use sudo.", fix: "RUN already runs as root (or the current USER). Switch with USER root … USER app around the commands that need root.", why: "sudo has unpredictable TTY and signal behaviour and is usually not even installed in base images." });
                        if (w[0] === "cd") add({ code: "DL3003", severity: "warning", line: ins.line, message: `cd ${w[1] ?? ""} inside RUN.`, fix: `Use WORKDIR ${w[1] ?? "/path"} instead.`, why: "cd only lasts for that RUN; WORKDIR persists for later instructions and is clearer." });
                        if (/^(apt)\s+(install|update|upgrade)/.test(c)) add({ code: "DL3027", severity: "info", line: ins.line, message: "Use apt-get instead of apt in scripts.", fix: "Replace apt with apt-get.", why: "apt is meant for interactive use and warns that its CLI is not stable." });
                    }
                    const aptInstall = cmds.filter((c) => /\bapt(-get)?\s+(\S+\s+)*install\b/.test(c));
                    for (const c of aptInstall) {
                        if (!/(\s|^)(-[a-z]*y[a-z]*|--yes|--assume-yes)(\s|$)/.test(c)) add({ code: "DL3014", severity: "warning", line: ins.line, message: "apt-get install without -y.", fix: "apt-get install -y --no-install-recommends <packages>", why: "Without -y apt waits for a confirmation that never comes, and the build fails." });
                        if (!/--no-install-recommends/.test(c)) add({ code: "DL3015", severity: "info", line: ins.line, message: "apt-get install without --no-install-recommends.", fix: "Add --no-install-recommends.", why: "Recommended packages often add tens of megabytes you never use, and more attack surface." });
                    }
                    const aptUpdate = has(/\bapt(-get)?\s+update\b/);
                    if (aptInstall.length && !/rm\s+-[rf]+\s+\/var\/lib\/apt\/lists/.test(body))
                        add({ code: "DL3009", severity: "warning", line: ins.line, message: "apt lists are not deleted after install.", fix: "End the same RUN with && rm -rf /var/lib/apt/lists/*", why: "The package index (~40 MB) stays in the layer forever; deleting it in a later RUN does not shrink the image." });
                    if (aptUpdate && !aptInstall.length)
                        add({ code: "DX001", severity: "warning", line: ins.line, message: "apt-get update in its own RUN.", fix: "Combine them: RUN apt-get update && apt-get install -y --no-install-recommends … && rm -rf /var/lib/apt/lists/*", why: "The update layer is cached; when you later change the install line, it runs against a stale package index and can fail or install outdated versions." });
                    if (aptInstall.length && !aptUpdate && !st.instructions.some((x) => x.keyword === "RUN" && x.line < ins.line && /apt-get\s+update/.test(x.args)))
                        add({ code: "DX001", severity: "info", line: ins.line, message: "apt-get install without apt-get update in the same RUN.", fix: "Prefix with apt-get update &&.", why: "Base images ship without package lists, so install fails or uses stale lists." });
                    for (const c of cmds.filter((x) => /\bapk\s+(\S+\s+)*add\b/.test(x)))
                        if (!/--no-cache/.test(c) && !/rm\s+-[rf]+\s+\/var\/cache\/apk/.test(body)) add({ code: "DL3019", severity: "warning", line: ins.line, message: "apk add without --no-cache.", fix: "apk add --no-cache <packages>", why: "--no-cache fetches the index on the fly and leaves nothing behind in the layer." });
                    if (!pipNoCacheEnv)
                        for (const c of cmds.filter((x) => /\b(pip3?|python3?\s+-m\s+pip)\s+install\b/.test(x)))
                            if (!/--no-cache-dir/.test(c)) add({ code: "DL3042", severity: "warning", line: ins.line, message: "pip install without --no-cache-dir.", fix: "pip install --no-cache-dir -r requirements.txt", why: "pip keeps downloaded wheels in ~/.cache/pip, which is dead weight inside an image." });
                    for (const c of cmds.filter((x) => /\bnpm\s+(install|i)\b/.test(x))) {
                        const rest = words(c.slice(c.search(/\bnpm\s+(install|i)\b/))).slice(2);
                        if (rest.every((t) => t.startsWith("-") && t !== "-g" && t !== "--global"))
                            add({ code: "DX007", severity: "warning", line: ins.line, message: "npm install instead of npm ci.", fix: rest.some((t) => /prod|omit/.test(t)) ? "npm ci --omit=dev" : "npm ci (add --omit=dev for production images)", why: "npm ci installs exactly what package-lock.json says, fails if it is out of sync, and is faster. npm install can silently upgrade dependencies." });
                    }
                    if (has(/\byarn\s+(install\b|$)/) && !/yarn cache clean|--frozen-lockfile|--immutable/.test(body))
                        add({ code: "DL3060", severity: "info", line: ins.line, message: "yarn install without --frozen-lockfile/--immutable or yarn cache clean.", fix: "yarn install --frozen-lockfile && yarn cache clean (Yarn 1) or yarn install --immutable (Berry).", why: "Keeps installs reproducible and the layer small." });
                    if (has(/\byum\s+(\S+\s+)*install\b/) && !/yum clean all/.test(body)) add({ code: "DL3032", severity: "warning", line: ins.line, message: "yum install without yum clean all.", fix: "Append && yum clean all && rm -rf /var/cache/yum", why: "The yum cache stays in the layer and bloats the image." });
                    if (has(/\b(micro)?dnf\s+(\S+\s+)*install\b/) && !/dnf clean all/.test(body)) add({ code: "DL3040", severity: "warning", line: ins.line, message: "dnf install without dnf clean all.", fix: "Append && dnf clean all", why: "The dnf cache stays in the layer and bloats the image." });
                    if (/\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/.test(body))
                        add({ code: "DX002", severity: "warning", line: ins.line, message: "Piping a download straight into a shell.", fix: "Download to a file, verify its checksum (sha256sum -c), then run it. Pin the script version.", why: "You execute whatever the server returns at build time, with no integrity check; a compromised or changed script ends up in your image." });
                    if (/\bcurl\b/.test(body)) usesCurl = usesCurl || ins.line;
                    if (/\bwget\b/.test(body)) usesWget = usesWget || ins.line;
                    if (contextCopy && !manifestCopied && !contextCopyFlagged && DEP_INSTALL.test(body)) {
                        contextCopyFlagged = true;
                        add({ code: "DX004", severity: "warning", line: contextCopy.line, message: "Whole build context copied before installing dependencies.", fix: suggestManifestCopy(body), why: "Any source change invalidates the COPY . . layer and every layer after it, so dependencies are downloaded again on every build. Copying only the dependency manifests first keeps that layer cached." });
                    }
                    break;
                }
            }
        }
        if (usesCurl && usesWget) add({ code: "DL4001", severity: "info", line: usesWget, message: "Both curl and wget are used in this stage.", fix: "Pick one tool.", why: "Installing both adds size for no benefit." });
        if (cmdCount > 1) add({ code: "DL4003", severity: "warning", line: st.instructions.filter((x) => x.keyword === "CMD").pop()!.line, message: `${cmdCount} CMD instructions in one stage; only the last one takes effect.`, fix: "Keep a single CMD.", why: "Earlier CMDs are silently ignored, which is confusing." });
        if (epCount > 1) add({ code: "DL4004", severity: "warning", line: st.instructions.filter((x) => x.keyword === "ENTRYPOINT").pop()!.line, message: `${epCount} ENTRYPOINT instructions in one stage; only the last one takes effect.`, fix: "Keep a single ENTRYPOINT.", why: "Earlier ENTRYPOINTs are silently ignored." });

        if (finalStage) {
            const nonrootImage = /nonroot|distroless.*:nonroot|chainguard|-unprivileged/.test(img);
            if (!user && !nonrootImage) add({ code: "DX003", severity: "warning", line: from.line, message: "No USER in the final stage, so the container runs as root.", fix: "RUN addgroup --system app && adduser --system --ingroup app app (or useradd -r) and then USER app (Alpine: addgroup -S app && adduser -S app -G app).", why: "If the app is compromised, root inside the container makes container escapes and host damage far easier. Kubernetes runAsNonRoot also rejects it." });
            else if (/^(root|0)(:.*)?$/.test(user)) add({ code: "DL3002", severity: "warning", line: st.instructions.filter((x) => x.keyword === "USER").pop()!.line, message: "The last USER is root.", fix: "Switch back to an unprivileged user at the end: USER app", why: "The container process runs with whatever the last USER is." });
            if (!st.instructions.some((x) => x.keyword === "HEALTHCHECK"))
                add({ code: "DX006", severity: "info", line: from.line, message: "No HEALTHCHECK.", fix: ecosystems.has("java") ? "HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8080/actuator/health || exit 1" : "HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8080/health || exit 1", why: "Docker and Compose use it to report and restart unhealthy containers. On Kubernetes it is ignored, so use liveness/readiness probes there instead." });
            if (ecosystems.has("java")) javaRules(st, add, all);
        }
    }

    const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
    findings.sort((a, b) => order[a.severity] - order[b.severity] || a.line - b.line);
    const penalty = findings.reduce((s, f) => s + (f.severity === "error" ? 15 : f.severity === "warning" ? 7 : 2), 0);
    return { instructions, stages, findings, directives, ecosystems, score: Math.max(0, 100 - penalty) };
}

function suggestManifestCopy(body: string): string {
    if (/\bnpm|yarn|pnpm/.test(body)) return "COPY package.json package-lock.json ./  →  RUN npm ci  →  COPY . .";
    if (/mvnw?|maven/.test(body)) return "COPY mvnw pom.xml ./ and COPY .mvn .mvn  →  RUN ./mvnw dependency:go-offline  →  COPY src src  →  RUN ./mvnw package";
    if (/gradle/.test(body)) return "COPY gradlew settings.gradle* build.gradle* ./ and COPY gradle gradle  →  RUN ./gradlew dependencies  →  COPY src src";
    if (/pip|poetry/.test(body)) return "COPY requirements.txt ./  →  RUN pip install --no-cache-dir -r requirements.txt  →  COPY . .";
    if (/\bgo\b/.test(body)) return "COPY go.mod go.sum ./  →  RUN go mod download  →  COPY . .";
    return "Copy only the dependency manifest(s) first, install, then COPY . .";
}

function javaRules(st: Stage, add: (f: Finding) => void, all: string) {
    const from = st.instructions[0];
    const img = st.image.toLowerCase();
    const { repo, tag } = imageParts(img);
    if (/(^|\/)(maven|gradle)$/.test(repo))
        add({ code: "DX008", severity: "warning", line: from.line, message: `Final image is based on the build tool image ${st.image}.`, fix: "Use a multi-stage build: build in maven/gradle AS build, then FROM eclipse-temurin:21-jre (or gcr.io/distroless/java21-debian12) and COPY --from=build the jar.", why: "Shipping Maven/Gradle, a full JDK and the local repository makes the image several hundred MB larger and gives attackers a compiler." });
    else if ((/temurin|openjdk|liberica|zulu|semeru|corretto|sapmachine|microsoft\/openjdk/.test(repo) && !/jre|distroless|runtime/.test(repo + ":" + tag)) || /jdk/.test(tag))
        add({ code: "DX008", severity: "warning", line: from.line, message: `Final stage runs on a full JDK (${st.image}).`, fix: "Use a JRE or distroless runtime for the final stage, e.g. eclipse-temurin:21-jre-alpine or gcr.io/distroless/java21-debian12, and build in a separate stage.", why: "A JDK adds ~200 MB of compiler and tooling the app never needs at runtime, plus more CVEs to patch." });
    if (!/MaxRAMPercentage|InitialRAMPercentage|-Xmx/.test(all))
        add({ code: "DX009", severity: "info", line: from.line, message: "No container-aware JVM memory setting.", fix: 'ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75.0 -XX:+ExitOnOutOfMemoryError"', why: "By default the JVM uses only 25% of the container memory limit for the heap. MaxRAMPercentage sizes the heap relative to the limit without hard-coding -Xmx." });
    if (/-jar\b|\.jar\b/.test(all) && !/layertools|extract|BOOT-INF|dependencies\/|spring-boot-loader|org\.springframework\.boot\.loader/.test(all))
        add({ code: "DX010", severity: "info", line: from.line, message: "Fat jar copied as a single layer.", fix: "For Spring Boot 3.3+: RUN java -Djarmode=tools -jar app.jar extract --layers --launcher --destination extracted in the build stage, then COPY --from=build extracted/dependencies/ ./, spring-boot-loader/, snapshot-dependencies/, application/ in that order, and ENTRYPOINT [\"java\", \"org.springframework.boot.loader.launch.JarLauncher\"].", why: "With layers, a code change only rebuilds and pushes the small application layer; the ~100 MB of dependencies stay cached in the registry and on nodes." });
}

export function dockerignoreFor(eco: LintResult["ecosystems"]): string {
    const lines = ["# VCS and editor files", ".git", ".gitignore", ".idea", ".vscode", "*.iml", ".DS_Store", "", "# Secrets and local config", ".env", ".env.*", "*.pem", "*.key", "", "# Logs and temp", "*.log", "tmp/", "coverage/", "", "# Docker files themselves", "Dockerfile*", "docker-compose*.yml", ".dockerignore"];
    if (eco.has("java")) lines.push("", "# Java build output", "target/", "build/", ".gradle/", "out/", "!target/*.jar", "!build/libs/*.jar");
    if (eco.has("node") || !eco.size) lines.push("", "# Node", "node_modules/", "npm-debug.log*", "yarn-error.log", ".npm/", "dist/", ".next/");
    if (eco.has("python")) lines.push("", "# Python", "__pycache__/", "*.pyc", ".venv/", "venv/", ".pytest_cache/");
    if (eco.has("go")) lines.push("", "# Go", "bin/", "vendor/");
    if (eco.has("dotnet")) lines.push("", "# .NET", "bin/", "obj/");
    return lines.join("\n") + "\n";
}

export const DOCKERFILE_SAMPLE_BAD = `# Spring Boot service (with a few deliberate problems)
FROM maven:latest
MAINTAINER Jane Dev <jane@example.com>

ENV DB_PASSWORD=changeme
ARG GITHUB_TOKEN

RUN apt-get update
RUN apt-get install curl git
RUN curl -fsSL https://get.example.com/install.sh | sh

ADD . /app
RUN cd /app && mvn -B package -DskipTests

EXPOSE 8080 99999
CMD java -jar /app/target/app.jar
`;

export const DOCKERFILE_SAMPLE_GOOD = `# syntax=docker/dockerfile:1.7
ARG JAVA_VERSION=21

FROM eclipse-temurin:\${JAVA_VERSION}-jdk-alpine AS build
WORKDIR /workspace
COPY mvnw pom.xml ./
COPY .mvn .mvn
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B dependency:go-offline
COPY src src
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B package -DskipTests \\
    && java -Djarmode=tools -jar target/*.jar extract --layers --launcher --destination extracted

FROM eclipse-temurin:\${JAVA_VERSION}-jre-alpine
RUN apk add --no-cache wget \\
    && addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build /workspace/extracted/dependencies/ ./
COPY --from=build /workspace/extracted/spring-boot-loader/ ./
COPY --from=build /workspace/extracted/snapshot-dependencies/ ./
COPY --from=build /workspace/extracted/application/ ./
USER app
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75.0 -XX:+ExitOnOutOfMemoryError"
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \\
  CMD wget -qO- http://localhost:8080/actuator/health || exit 1
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
`;
