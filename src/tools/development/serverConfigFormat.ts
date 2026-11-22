/* Formatters for nginx and Apache httpd configuration files. */

export interface FormatIssue {
    line: number;
    severity: "error" | "warning";
    message: string;
}
export interface FormatOptions {
    indent: string;
    align: boolean;
    minify: boolean;
}
export interface FormatResult {
    output: string;
    issues: FormatIssue[];
}

// ------------------------------------------------------------------------------------------------
// nginx
// ------------------------------------------------------------------------------------------------

interface Word {
    text: string;
    line: number;
    /** Word starts on a new source line (inside a multi-line directive). */
    nl: boolean;
}
interface DirectiveNode {
    type: "directive";
    words: Word[];
    comment?: string;
    blank: boolean;
    line: number;
}
interface BlockNode {
    type: "block";
    words: Word[];
    children: Node[];
    comment?: string;
    closeComment?: string;
    blank: boolean;
    line: number;
}
interface CommentNode {
    type: "comment";
    text: string;
    blank: boolean;
    line: number;
}
interface RawNode {
    type: "raw";
    words: Word[];
    body: string;
    blank: boolean;
    line: number;
    comment?: string;
}
type Node = DirectiveNode | BlockNode | CommentNode | RawNode;

/** Directives that commonly start a line; used to guess a missing semicolon in a multi-line statement. */
const COMMON = new Set([
    "listen", "server_name", "root", "index", "location", "proxy_pass", "return", "rewrite", "include", "try_files",
    "add_header", "proxy_set_header", "ssl_certificate", "ssl_certificate_key", "access_log", "error_log", "server",
    "upstream", "gzip", "expires", "alias", "client_max_body_size", "keepalive_timeout", "worker_processes", "events",
    "http", "sendfile", "default_type", "error_page", "set", "if", "deny", "allow", "limit_req", "proxy_read_timeout",
]);

export function formatNginx(src: string, opts: FormatOptions): FormatResult {
    const issues: FormatIssue[] = [];
    const root: Node[] = [];
    const stack: { node: BlockNode | null; children: Node[] }[] = [{ node: null, children: root }];
    let i = 0;
    let line = 1;
    let newlines = 2; // newlines seen since the last token (start of file counts as fresh line)
    let pending: Word[] = [];
    let pendingBlank = false;
    let lastAttach: ((c: string) => void) | null = null;
    const n = src.length;

    const cur = () => stack[stack.length - 1].children;
    const flushNl = () => {
        const blank = newlines >= 2;
        const nl = newlines >= 1;
        newlines = 0;
        return { blank, nl };
    };

    while (i < n) {
        const c = src[i];
        if (c === "\n") {
            newlines++;
            line++;
            i++;
            continue;
        }
        if (c === " " || c === "\t" || c === "\r") {
            i++;
            continue;
        }
        if (c === "#") {
            let j = i;
            while (j < n && src[j] !== "\n") j++;
            const text = src.slice(i, j).replace(/\s+$/, "");
            const { blank, nl } = flushNl();
            if (!nl && pending.length === 0 && lastAttach) lastAttach(text);
            else if (pending.length) {
                // comment in the middle of a multi-line directive: keep it as a standalone comment before it
                cur().push({ type: "comment", text, blank: false, line });
            } else cur().push({ type: "comment", text, blank: blank && cur().length > 0, line });
            lastAttach = null;
            i = j;
            continue;
        }
        if (c === ";") {
            flushNl();
            if (!pending.length) issues.push({ line, severity: "warning", message: "Empty statement (stray ;)." });
            else {
                const node: DirectiveNode = { type: "directive", words: pending, blank: pendingBlank, line: pending[0].line };
                checkMultiline(pending, issues);
                cur().push(node);
                lastAttach = (t) => (node.comment = t);
            }
            pending = [];
            i++;
            continue;
        }
        if (c === "{") {
            flushNl();
            if (!pending.length) issues.push({ line, severity: "error", message: "Block { without a name." });
            const words = pending.length ? pending : [{ text: "?", line, nl: false }];
            const name = words[0].text;
            if (/_by_lua_block$|_lua_block$/.test(name)) {
                // Capture raw Lua up to the matching brace.
                let depth = 1;
                let j = i + 1;
                let q = "";
                while (j < n && depth > 0) {
                    const ch = src[j];
                    if (q) {
                        if (ch === "\\") j++;
                        else if (ch === q) q = "";
                    } else if (ch === '"' || ch === "'") q = ch;
                    else if (ch === "-" && src[j + 1] === "-") {
                        while (j < n && src[j] !== "\n") j++;
                        continue;
                    } else if (ch === "{") depth++;
                    else if (ch === "}") depth--;
                    if (ch === "\n") line++;
                    j++;
                }
                if (depth > 0) issues.push({ line: words[0].line, severity: "error", message: `Unclosed ${name} { … }.` });
                const node: RawNode = { type: "raw", words, body: src.slice(i + 1, depth > 0 ? j : j - 1), blank: pendingBlank, line: words[0].line };
                cur().push(node);
                lastAttach = (t) => (node.comment = t);
                pending = [];
                i = j;
                continue;
            }
            checkMultiline(words, issues);
            const node: BlockNode = { type: "block", words, children: [], blank: pendingBlank, line: words[0].line };
            cur().push(node);
            stack.push({ node, children: node.children });
            lastAttach = (t) => (node.comment = t);
            pending = [];
            i++;
            continue;
        }
        if (c === "}") {
            flushNl();
            if (pending.length) {
                issues.push({ line: pending[pending.length - 1].line, severity: "error", message: `Missing ; after "${pending.map((w) => w.text).join(" ").slice(0, 60)}".` });
                cur().push({ type: "directive", words: pending, blank: pendingBlank, line: pending[0].line });
                pending = [];
            }
            if (stack.length === 1) {
                issues.push({ line, severity: "error", message: "Unexpected } (no block is open)." });
                lastAttach = null;
            } else {
                const node = stack.pop()!.node!;
                lastAttach = (t) => (node.closeComment = t);
            }
            i++;
            continue;
        }
        // word
        const { blank, nl } = flushNl();
        let j = i;
        const startLine = line;
        while (j < n) {
            const ch = src[j];
            if (ch === '"' || ch === "'") {
                const q = ch;
                j++;
                while (j < n && src[j] !== q) {
                    if (src[j] === "\\") j++;
                    else if (src[j] === "\n") line++;
                    j++;
                }
                if (j >= n) issues.push({ line: startLine, severity: "error", message: "Unterminated quoted string." });
                j++;
                continue;
            }
            if (ch === "$" && src[j + 1] === "{") {
                const close = src.indexOf("}", j);
                j = close < 0 ? n : close + 1;
                continue;
            }
            if (ch === "\\" && j + 1 < n) {
                j += 2;
                continue;
            }
            if (/\s/.test(ch) || ch === ";" || ch === "{" || ch === "}") break;
            j++;
        }
        if (!pending.length) pendingBlank = blank && cur().length > 0;
        pending.push({ text: src.slice(i, j), line: startLine, nl: pending.length > 0 && nl });
        lastAttach = null;
        i = j;
    }
    if (pending.length) {
        issues.push({ line: pending[pending.length - 1].line, severity: "error", message: `Missing ; at end of file after "${pending.map((w) => w.text).join(" ").slice(0, 60)}".` });
        cur().push({ type: "directive", words: pending, blank: pendingBlank, line: pending[0].line });
    }
    for (let s = stack.length - 1; s > 0; s--) {
        const b = stack[s].node!;
        issues.push({ line: b.line, severity: "error", message: `Block "${b.words.map((w) => w.text).join(" ")}" opened here is never closed (missing }).` });
    }

    const output = opts.minify ? minifyNodes(root) : printNodes(root, 0, opts).join("\n") + "\n";
    issues.sort((a, b) => a.line - b.line);
    return { output: root.length ? output : "", issues };
}

function checkMultiline(words: Word[], issues: FormatIssue[]) {
    for (let k = 1; k < words.length; k++) {
        if (words[k].nl && COMMON.has(words[k].text) && !/^(log_format|map|split_clients|geo)$/.test(words[0].text)) {
            issues.push({ line: words[k - 1].line, severity: "error", message: `Probably a missing ; after "${words.slice(0, k).map((w) => w.text).join(" ").slice(0, 60)}" (${words[k].text} on line ${words[k].line} is read as an argument).` });
            return;
        }
    }
}

function wordsText(words: Word[], indent: string, pad?: number): string {
    // Keep multi-line directives multi-line; continuation lines get one extra indent level.
    let out = "";
    words.forEach((w, k) => {
        if (k === 0) out += pad ? w.text.padEnd(pad) : w.text;
        else if (w.nl) out += "\n" + indent + w.text;
        else out += (k === 1 && pad ? " " : " ") + w.text;
    });
    return out;
}

function printNodes(nodes: Node[], depth: number, opts: FormatOptions): string[] {
    const ind = opts.indent.repeat(depth);
    const cont = opts.indent.repeat(depth + 1);
    const out: string[] = [];
    // Alignment: width of directive names among runs of single-line directives.
    const pads = new Map<Node, number>();
    if (opts.align) {
        let run: DirectiveNode[] = [];
        const close = () => {
            if (run.length > 1) {
                const w = Math.max(...run.map((d) => d.words[0].text.length));
                run.forEach((d) => pads.set(d, w));
            }
            run = [];
        };
        for (const nd of nodes) {
            if (nd.type === "directive" && !nd.words.some((w) => w.nl) && nd.words.length > 1) {
                if (nd.blank) close();
                run.push(nd);
            } else close();
        }
        close();
    }
    nodes.forEach((nd, k) => {
        if (nd.blank && k > 0) out.push("");
        if (nd.type === "comment") out.push(ind + nd.text);
        else if (nd.type === "directive") out.push(ind + wordsText(nd.words, cont, pads.get(nd)) + ";" + (nd.comment ? " " + nd.comment : ""));
        else if (nd.type === "block") {
            out.push(ind + wordsText(nd.words, cont) + " {" + (nd.comment ? " " + nd.comment : ""));
            out.push(...printNodes(nd.children, depth + 1, opts));
            out.push(ind + "}" + (nd.closeComment ? " " + nd.closeComment : ""));
        } else {
            out.push(ind + wordsText(nd.words, cont) + " {" + (nd.comment ? " " + nd.comment : ""));
            // When the Lua code starts on the same line as "{", its first line has no meaningful indentation.
            const sameLine = !/^[ \t]*\n/.test(nd.body);
            const lines = nd.body.replace(/^\s*\n/, "").replace(/\s+$/, "").split("\n");
            const measured = (sameLine ? lines.slice(1) : lines).filter((l) => l.trim());
            const common = measured.length ? Math.min(...measured.map((l) => (l.match(/^[ \t]*/) ?? [""])[0].length)) : 0;
            lines.forEach((l, k) => out.push(l.trim() ? cont + (sameLine && k === 0 ? l.trim() : l.slice(common).replace(/\s+$/, "")) : ""));
            out.push(ind + "}");
        }
    });
    return out;
}

function minifyNodes(nodes: Node[]): string {
    const parts: string[] = [];
    for (const nd of nodes) {
        if (nd.type === "comment") continue;
        const head = nd.words.map((w) => w.text).join(" ");
        // A head ending in $ (regex location) needs a space, or "${" would read as a variable.
        const open = head.endsWith("$") ? " {" : "{";
        if (nd.type === "directive") parts.push(head + ";");
        else if (nd.type === "block") parts.push(head + open + minifyNodes(nd.children) + "}");
        else parts.push(head + open + nd.body.trim() + "\n}");
    }
    return parts.join("");
}

// ------------------------------------------------------------------------------------------------
// Apache httpd
// ------------------------------------------------------------------------------------------------

export function formatApache(src: string, opts: FormatOptions): FormatResult {
    const issues: FormatIssue[] = [];
    const lines = src.replace(/\r\n?/g, "\n").split("\n");
    const out: string[] = [];
    const stack: { name: string; line: number }[] = [];
    let blank = 0;
    for (let i = 0; i < lines.length; i++) {
        const lineNo = i + 1;
        let text = lines[i].trim();
        if (!text) {
            blank++;
            continue;
        }
        // Backslash continuations: gather the whole logical line.
        const parts = [text];
        while (/\\$/.test(text) && i + 1 < lines.length) {
            i++;
            text = lines[i].trim();
            parts.push(text);
        }
        const first = parts[0];
        const ind = opts.indent.repeat(stack.length);
        const emitBlank = () => {
            if (blank && out.length && !/^\s*<[^/]/.test(out[out.length - 1] ?? "")) out.push("");
            blank = 0;
        };
        const close = first.match(/^<\/\s*([A-Za-z]+)\s*>(.*)$/);
        const open = first.match(/^<\s*([A-Za-z]+)(\s[^>]*)?>(.*)$/);
        if (close) {
            blank = 0;
            const name = close[1];
            const top = stack[stack.length - 1];
            if (!top) issues.push({ line: lineNo, severity: "error", message: `</${name}> without a matching <${name}>.` });
            else if (top.name.toLowerCase() !== name.toLowerCase()) {
                issues.push({ line: lineNo, severity: "error", message: `</${name}> closes <${top.name}> opened on line ${top.line}.` });
                // Recover: pop to the matching tag if it is further down the stack.
                const idx = stack.map((s) => s.name.toLowerCase()).lastIndexOf(name.toLowerCase());
                if (idx >= 0) stack.length = idx;
            } else stack.pop();
            out.push(opts.indent.repeat(stack.length) + `</${top && top.name.toLowerCase() === name.toLowerCase() ? top.name : name}>` + (close[2].trim() ? " " + close[2].trim() : ""));
            continue;
        }
        if (open && !first.startsWith("#")) {
            emitBlank();
            const args = (open[2] ?? "").trim().replace(/\s+/g, " ");
            if (!args && /^(IfModule|IfDefine|Directory|DirectoryMatch|Files|FilesMatch|Location|LocationMatch|VirtualHost)$/i.test(open[1])) issues.push({ line: lineNo, severity: "warning", message: `<${open[1]}> has no argument.` });
            out.push(ind + `<${open[1]}${args ? " " + args : ""}>`);
            stack.push({ name: open[1], line: lineNo });
            if (open[3].trim()) issues.push({ line: lineNo, severity: "warning", message: `Text after <${open[1]}> on the same line is not allowed by Apache.` });
            continue;
        }
        emitBlank();
        if (first.startsWith("#")) {
            parts.forEach((p, k) => out.push((k ? opts.indent.repeat(stack.length + 1) : ind) + p));
            continue;
        }
        // Directive: normalise the gap between the name and its arguments, keep the rest verbatim.
        const m = first.match(/^(\S+)\s+([\s\S]*)$/);
        const head = m ? `${m[1]} ${m[2]}` : first;
        out.push(ind + head);
        for (let k = 1; k < parts.length; k++) out.push(opts.indent.repeat(stack.length + 1) + parts[k]);
        if (/^\S+>$/.test(first) || /^<\S*$/.test(first)) issues.push({ line: lineNo, severity: "error", message: "Malformed section tag." });
    }
    for (const s of stack.reverse()) issues.push({ line: s.line, severity: "error", message: `<${s.name}> opened here is never closed.` });
    issues.sort((a, b) => a.line - b.line);
    return { output: out.length ? out.join("\n") + "\n" : "", issues };
}

// ------------------------------------------------------------------------------------------------
// samples
// ------------------------------------------------------------------------------------------------

export const NGINX_SAMPLE = `# messy reverse proxy config
upstream app_backend { least_conn; server 10.0.0.11:8080 max_fails=3; server 10.0.0.12:8080 max_fails=3;   keepalive 32; }
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
server {listen 80; server_name example.com www.example.com; return 301 https://$host$request_uri;}
server {
listen 443 ssl http2;     server_name example.com;
    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem; ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem; # TLS
  root /var/www/html; index index.html;


  log_format timed '$remote_addr - $request '
                   '$status $request_time';
location / { try_files $uri $uri/ /index.html; }
location ~* \\.(js|css|png|jpg|svg|woff2)$ { expires 30d; add_header Cache-Control "public, immutable"; access_log off; }
  location /api/ {
proxy_pass http://app_backend; proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection $connection_upgrade;
      proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
if ($request_method = OPTIONS) { return 204; }
  }
location = /lua { content_by_lua_block { local name = ngx.var.arg_name or "world"
ngx.say("hello, ", name) } }
}
`;

export const APACHE_SAMPLE = `# messy Apache virtual host
<VirtualHost *:80>
ServerName example.com
    ServerAlias www.example.com
Redirect permanent / https://example.com/
</VirtualHost>
<IfModule mod_ssl.c>
<VirtualHost *:443>
  ServerName   example.com
DocumentRoot /var/www/html
SSLEngine on
        SSLCertificateFile /etc/letsencrypt/live/example.com/fullchain.pem
SSLCertificateKeyFile /etc/letsencrypt/live/example.com/privkey.pem


# static files
<Directory /var/www/html>
Options -Indexes +FollowSymLinks
AllowOverride None
    Require all granted
</Directory>
<FilesMatch "\\.(js|css|png|svg)$">
Header set Cache-Control "max-age=2592000, public"
</FilesMatch>
<Location /api>
ProxyPass http://127.0.0.1:8080/api \\
retry=0 timeout=30
ProxyPassReverse http://127.0.0.1:8080/api
</Location>
ErrorLog \${APACHE_LOG_DIR}/error.log
    CustomLog \${APACHE_LOG_DIR}/access.log combined
</VirtualHost>
</IfModule>
`;
