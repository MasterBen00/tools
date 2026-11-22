# DevTools

A collection of 130 free developer tools that run entirely in your browser: JSON, hashes, UUIDs, regex, cron, colors, encoders, AI helpers, productivity timers, and more, plus a chat assistant that runs them for you and a private on-device AI chat. No sign-up and no server. Your data never leaves the tab.

**Live:** https://tools.baniamin.com

## Features

- **130 tools** in 12 categories, each lazy-loaded
- **Chat assistant** that finds tools and runs them from plain-language commands, then opens the tool with your input filled in (see [Chat assistant](#chat-assistant))
- **General Chat**: a private AI chat with an open-source model running in the browser (WebLLM + WebGPU). Pick any model from the WebLLM catalog or add a custom MLC model; also available as a tab in the chatbox
- **Command palette**: press `⌘K` / `Ctrl+K` or `/` to search by name or keyword
- **Tabs**: every tool you open stays in a tab and keeps its input while you switch. Drag to reorder, middle-click or `Alt+W` to close, `Alt+Shift+←/→` to switch.
- **Favorites and recent tools** are stored locally
- **Light, dark and system themes** using the "Midnight Signal" design system from [baniamin.com](https://baniamin.com): indigo → cyan signal accent, Bricolage Grotesque / Inter / JetBrains Mono, engineering-grid page background
- Responsive layout with a collapsible sidebar on mobile
- **Installable PWA** that works fully offline after the first visit (every tool is precached)
- **SEO**: a prerendered page and a generated share image for each tool, with its own title, description, canonical URL, Open Graph/Twitter tags and JSON-LD. The build also writes `sitemap.xml` (with image entries), `robots.txt`, `opensearch.xml` (search tools from the browser address bar), `llms.txt` and a `noindex` 404 page

## Chat assistant

The chat button in the corner finds tools and runs them. Tell it what you want in plain words and it does the work in your browser, shows the result with a Copy button, and opens the tool with your input filled in so you can keep going. Commands are matched by rules, so they work instantly and without downloading the optional on-device model (a small WebGPU LLM that adds conversational answers when you ask a question instead).

Text after a colon, on the next line, in quotes or in a ``` code block is treated as the input, e.g. `base64 encode: hello world`.

| Area             | Try                                                                                                                                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Encode & convert | `convert hello to base64` · `url decode a%20b` · `escape html: <b>` · `yaml to json: a: 1` · `csv to json:` (data on the next line) · `markdown to html: # Hi` · `gzip some text`                                                                                 |
| Hashes & IDs     | `SHA-256 of password123` · `md5 hash of hello` · `bcrypt hash of secret` · `crc32 of hello` · `generate 3 uuids` · `uuid v7` · `generate a 24 character password` · `random hex token 32`                                                                         |
| Code & data      | `format json {"a":1}` · `format sql: select …` · `format css: a{color:red}` · `$.items[*].id on {...}` · `test regex /\d+/g on abc 123` · `json to typescript: {...}` · `html to jsx: <div class="a">`                                                            |
| Text             | `convert user name to camel case` · `count words in: …` · `how many tokens in: …` · `sort lines:` / `dedupe lines:` (list on the next lines) · `compare` with two code blocks · `ascii art hello` · `redact: …`                                                   |
| Time             | `convert 1700000000 to date` · `current unix timestamp` · `explain cron */5 * * * *` · `what time is it in tokyo` · `3pm utc in tokyo` · `days between 2024-01-01 and 2024-03-01` · `30 days from now` · `start stopwatch`                                        |
| Numbers & units  | `255 to hex` · `0xff & 0x0f` · `5 km to miles` · `100 f to c` · `16px to rem` · `1920x1080 aspect ratio` · `chmod 755` · `luhn 4111 1111 1111 1111`                                                                                                               |
| Web & security   | `192.168.1.10/24` · `what is http 418` · `parse user agent Mozilla/5.0 …` · paste a JWT · paste a PEM certificate · `basic auth admin:secret` · `totp JBSWY3DPEHPK3PXP` · `GET https://api.example.com` (opens the request; nothing is sent until you press Send) |
| Color & CSS      | `#ff0000 to rgb` · `random color` · `palette from #3b82f6` · `tailwind theme from #0ea5e9`                                                                                                                                                                        |
| Generators       | `lorem ipsum 2 paragraphs` · `gitignore for node python macos` · `qr code for https://baniamin.com` · paste a `curl …` or `docker run …` command                                                                                                                       |
| Productivity     | `start a pomodoro` · `pause pomodoro` · `set a timer for 10 minutes` · `remind me at 3pm to call Sam` · `start break reminders` · `add todo review PR tomorrow`                                                                                                   |
| Anything else    | `open image converter`, `go to box shadow`, … opens any tool by name                                                                                                                                                                                              |

The chatbox has two tabs: **Tools** (the commands above) and **General chat**, a plain conversation with the on-device model that isn't tied to any tool. Conversations, the system prompt, temperature and reply length are shared with the [General Chat](#ai) tool page, where you also download, switch and delete models. One model is in memory at a time, and the tool finder uses whichever is loaded.

Tools that need a file, a password or a visual editor (image converter, favicon, AES, key pairs, CSS designers, …) open from the chat and take over from there. AES never receives your password through the chat.

## Tools

### Development

- **JSON Formatter**: Format, minify, sort and validate JSON, and convert it to YAML.
- **Regex Tester**: Test a regular expression live with highlighted matches, capture groups and replace.
- **JSON to Code**: Generate TypeScript, Go, Python, Java or JSON Schema types from a JSON sample.
- **JSON to Java**: Generate Java records, Lombok classes or POJOs with Jackson and Bean Validation annotations from a JSON sample.
- **JSON Schema Validator**: Validate JSON against a JSON Schema as you type, with paths to each error.
- **JSON Diff**: Compare two JSON documents by value and list every added, removed and changed path.
- **HTML Preview**: Render HTML in a sandboxed frame that cannot reach the network.
- **Code Playground**: Experiment with HTML, CSS and JavaScript with a live preview and console.
- **Code Formatter**: Beautify HTML, CSS, JavaScript, TypeScript, Markdown, YAML and SQL.
- **Code to Image**: Turn a code snippet into a polished image with themes, backgrounds and window chrome, then export PNG or SVG.
- **Semver Calculator**: Check versions against npm ranges, compare versions and bump them.
- **XML Inspector**: Format, minify and validate XML, convert XML to and from JSON, and query with XPath.
- **JSONPath Evaluator**: Query JSON with JSONPath expressions and see matching values and paths live.
- **SQL Formatter**: Format or minify SQL for any dialect, and turn INSERT statements into JSON or CSV.
- **Mermaid Diagram Editor**: Write Mermaid flowcharts, sequence, ER and Gantt diagrams with a live preview, and export SVG or PNG.
- **Java Stack Trace Beautifier**: Paste a Java stack trace to see the cause chain, the root cause and your own frames, with framework frames collapsed.
- **JVM Memory Flags Calculator**: Size JVM heap, metaspace, thread stacks and direct memory for a container and get the flags, GC choice and Docker or Kubernetes snippets.
- **Kubernetes YAML Validator**: Explain and validate multi-document Kubernetes manifests: required fields, removed apiVersions, selectors and security best practices.
- **Dockerfile Linter**: Lint a Dockerfile for caching, security and size problems with fixes, a score and a suggested .dockerignore.
- **Nginx & Apache Config Formatter**: Format and check nginx and Apache httpd configs: indentation, comments, alignment, minify and brace or tag errors.
- **Git Command Builder**: Pick what you want to do in Git and get the exact commands, with danger level, caveats and how to undo.
- **SQL to ER Diagram**: Turn CREATE TABLE statements into a Mermaid ER diagram with keys and relationships, then export SVG or PNG.
- **Elasticsearch Query Builder**: Build bool queries and aggregations visually, or format and validate query DSL, with Kibana, curl and Spring Data output.
- **MongoDB ↔ SQL Translator**: Translate SQL SELECT queries to MongoDB find or aggregate pipelines and back, with a Spring Data Criteria snippet.
- **OpenAPI Viewer**: Browse OpenAPI 3 and Swagger 2 specs with endpoints, schemas, example JSON and curl commands.
- **GraphQL Formatter & Query Builder**: Format and minify GraphQL, and build typed operations with variables from an SDL schema.

### Generators

- **Hash Generator**: MD5, SHA-1, SHA-2 and SHA-3 hashes and HMAC for text and files.
- **UUID Generator**: Generate v1, v4 and v7 UUIDs and ULIDs in bulk, and inspect existing IDs.
- **Password Generator**: Create strong passwords with custom length, character sets and a strength meter.
- **Lorem Ipsum**: Generate placeholder paragraphs, sentences, words and fake data.
- **QR Code Generator**: Make QR codes for text, URLs, Wi-Fi and contacts, and save as PNG or SVG.
- **Bcrypt Generator**: Generate bcrypt hashes and verify a password against a hash.
- **Random String**: Generate Nano IDs, hex and Base64URL tokens, and strings from a custom alphabet.
- **Gitignore Generator**: Build a .gitignore from templates for languages, frameworks, editors and operating systems.
- **Card Number Generator**: Generate Luhn-valid test card numbers for Visa, Mastercard, Amex and more, with expiry and CVV.
- **License Generator**: Generate an open-source LICENSE file (MIT, GPL, Apache, BSD and more) with your name and year.
- **Meta Tag Generator**: Build SEO, Open Graph and Twitter meta tags with live search and social previews.
- **Robots.txt & Sitemap Generator**: Build robots.txt rules (including AI crawler blocking), test URLs against them, and generate sitemap.xml.
- **Fake Data Generator**: Generate up to 10,000 rows of realistic mock data with a seed, Bangladeshi locale, and JSON, CSV, SQL or NDJSON export.

### Security

- **TOTP / 2FA Generator**: Generate time-based one-time codes from a secret, with an authenticator QR code.
- **AES Encryption**: Encrypt and decrypt text with AES-256-GCM and a password-derived key.
- **SSH / RSA Key Generator**: Generate Ed25519, RSA and ECDSA key pairs as PEM, OpenSSH and JWK.
- **Certificate Decoder**: Decode X.509 certificates and CSRs: subject, validity, SANs, key usage and fingerprints.
- **Basic Auth Generator**: Build or decode an HTTP Basic Authorization header, with ready-to-use snippets.
- **JavaScript Obfuscator**: Minify and obfuscate JavaScript by encoding strings and packing the source, then compare output.
- **CSP Builder**: Build a Content-Security-Policy with presets, warnings and ready-to-paste header, meta, Nginx, Apache, Spring and Express snippets.
- **Webhook Signature Tool**: Sign and verify webhook payloads with HMAC for Stripe, GitHub, Slack, Shopify, Twilio or custom schemes.

### Converters

- **Base64**: Encode and decode Base64 text and files, with a URL-safe mode.
- **Case Converter**: Convert names to camelCase, snake_case, kebab-case and more, and make slugs.
- **Number Base**: Convert numbers between binary, octal, decimal, hex, any base and Roman numerals.
- **Markdown Preview**: Preview Markdown, export HTML or plain text, and convert HTML to Markdown.
- **URL Encoder**: Encode and decode URLs, and parse a URL into parts and query parameters.
- **CSV ↔ JSON**: Convert CSV to JSON, SQL inserts or a Markdown table, and JSON back to CSV.
- **Config Converter**: Convert and validate JSON, JSON5, YAML, TOML and .env files, with error line numbers.
- **Escape Tools**: Escape and unescape HTML entities, JSON strings and Unicode, and convert Punycode.
- **HTML to JSX**: Convert HTML markup into valid React JSX.
- **Compression**: Compress and decompress GZIP, zlib and raw deflate data as Base64 or hex.
- **cURL to Code**: Convert a cURL command to fetch, Node, Python, Go or PHP code.
- **Docker Run to Compose**: Convert docker run commands into a Docker Compose file.
- **Spring Properties to YAML**: Convert Spring Boot application.properties to application.yml and back, with lists, profiles and exact string values.
- **Maven Gradle Converter**: Convert dependencies between Maven pom.xml, Gradle Groovy and Gradle Kotlin DSL, with scopes, exclusions and BOMs.
- **Slug & Filename Sanitizer**: Turn titles into URL slugs, safe filenames or identifiers, with Bangla, Cyrillic and accent transliteration.
- **Env File Diff**: Compare .env against .env.example to find missing, extra, empty and duplicate keys, with secrets masked.
- **SQL INSERT Generator**: Generate batched INSERT statements from CSV, TSV or JSON for MySQL, PostgreSQL, SQLite, SQL Server or Oracle.

### Text

- **Text Compare**: Line, word and character diffs that can ignore whitespace and case.
- **JWT Decoder**: Decode JWTs, check expiry, verify signatures and sign new tokens.
- **String Inspector**: Count characters, words, lines and bytes, and find hidden Unicode characters.
- **Line Tools**: Sort, dedupe, trim, reverse, shuffle and filter lines.
- **ASCII Art Generator**: Turn text into ASCII art banners in 29 FIGlet fonts, ready to paste as a code comment.
- **Prose Diff**: Compare two drafts word by word with tracked changes and side-by-side readability stats.
- **Emoji & Unicode Picker**: Search emoji and Unicode symbols and copy them as characters, code points, entities or language escapes.
- **Markdown Table Generator**: Edit a table in a grid and get an aligned Markdown table, with CSV or Markdown import and HTML and CSV export.

### Time & Date

- **Timestamp Converter**: Convert Unix timestamps and date strings in seconds, milliseconds and more.
- **Date Difference**: Calculate the time between two dates, or add and subtract durations.
- **Cron Calculator**: Explain Unix and Spring cron expressions in plain English and list the next runs.
- **Spring Cron Expression**: Explain and test 6-field Spring @Scheduled cron expressions, with macros, L, W and # and the next run times.
- **Time Zone Converter**: Convert a date and time between time zones, with DST handled.
- **Stopwatch**: Record laps and split times and export them as CSV.
- **Countdown Timer**: Count down to events and dates, or run a timer with a progress ring and alert.
- **World Clock & Meeting Planner**: See the time in cities around the world and find meeting slots that fit everyone's working hours.

### Media & Color

- **Color Palette Generator**: Generate color palettes with harmony rules, accessibility checks and exports.
- **Random Color Generator**: Generate random colors in HEX, RGB and HSL with a single click.
- **Color Converter**: Convert any CSS color to HEX, RGB, HSL, HWB and OKLCH, and check WCAG contrast.
- **QR Reader**: Read a QR code with your camera or from an uploaded, dropped or pasted image.
- **Image Converter**: Resize, compress and convert images to JPEG, PNG or WebP in your browser.
- **SVG Optimizer**: Preview and optimize SVG, export PNG, and get a data URI, CSS or JSX.
- **Favicon Generator**: Make favicon.ico, PNG icons and a web manifest from an image, letter or emoji.
- **Color Blindness Simulator**: See how a palette or image looks with protanopia, deuteranopia, tritanopia and achromatopsia.
- **Image Palette Extractor**: Extract the dominant colors from an image and export them as CSS, Tailwind or JSON.
- **Pixel Art Sprite Studio**: Draw pixel art, animate frames and export PNGs or a sprite sheet.
- **Sound Tool**: Generate tones and noise, keep time with a metronome and measure your mic level and pitch.
- **Whiteboard**: Sketch hand-drawn diagrams and wireframes on an infinite canvas, and export PNG or SVG.

### CSS

- **Box Shadow**: Design layered CSS box shadows visually and copy the CSS or Tailwind class.
- **Gradient Generator**: Build linear, radial and conic CSS gradients with multiple stops.
- **px ↔ rem**: Convert between px, rem, em and pt with a custom root font size.
- **Aspect Ratio**: Calculate aspect ratios and scale dimensions while keeping proportions.
- **Cubic Bezier Editor**: Drag a cubic-bezier easing curve, preview the motion and copy the CSS.
- **Flexbox & Grid Playground**: Experiment with flexbox and CSS grid properties visually and copy the CSS.
- **Border Radius Generator**: Shape corners or organic blobs with border-radius and copy the CSS or Tailwind class.
- **Tailwind & shadcn Theme Generator**: Generate a Tailwind color scale and shadcn/ui light and dark theme from one brand color.

### Network

- **IP / CIDR Calculator**: Get the network, broadcast, host range and masks for an IPv4 block.
- **HTTP Status Codes**: Searchable reference of HTTP status codes and what they mean.
- **User Agent Parser**: Parse a User-Agent string into browser, engine, OS and device, and spot bots.
- **HTTP Request Builder**: Send HTTP requests from your browser and inspect status, headers and body.
- **Server Block Generator**: Generate Nginx server blocks, Apache virtual hosts and Caddyfiles for static sites, PHP apps and reverse proxies.
- **WHOIS Lookup**: Look up a domain, IP or ASN via RDAP: registrar, dates, status and nameservers.
- **Subdomain Explorer**: Find a domain's subdomains from Certificate Transparency logs and check which resolve.
- **Domain Name Finder**: Find a domain name: check availability across TLDs, get prefix and suffix ideas, and see who holds taken names.
- **DNS Lookup**: Query A, MX, TXT, NS and other DNS records over HTTPS, with reverse lookup and SPF/DMARC checks.
- **Cookie Parser**: Parse Cookie and Set-Cookie headers, decode values, flag insecure attributes and build Set-Cookie strings.
- **HTTP Header Inspector**: Explain raw HTTP headers and grade security headers from A+ to F with fix suggestions.
- **URL Parser**: Take a URL apart into editable parts, path segments and query parameters, strip tracking params and rebuild it.

### AI

- **General Chat**: Chat privately with an open-source model that runs in your browser. Download any WebLLM model or add your own.
- **Secret & PII Redactor**: Mask API keys, tokens, emails and other personal data before pasting into an AI chat.
- **Token Counter**: Count GPT tokens exactly, estimate others, check context usage and estimate API cost.
- **AI Text Cleaner**: Remove hidden characters, citation markers and Markdown from AI-written text.
- **Prompt Template Builder**: Write prompts with {{variables}}, fill them in and export as text or code.
- **RAG Text Chunker**: Split text into chunks by tokens, words or characters with overlap, and see every boundary.
- **JSONL Validator**: Validate JSONL line by line for fine-tuning datasets and batch request files.

### Productivity

- **Pomodoro Timer**: Work in focused sessions with short and long breaks, alerts and a daily tally.
- **Alarms & Reminders**: Set countdown timers and alarms that alert you with a sound and a desktop notification.
- **Break Reminder**: Get nudged to rest your eyes, drink water and stretch at intervals you choose.
- **To-Do List**: Keep a quick task list with priorities and due dates, saved in your browser.
- **Typing Speed Test**: Measure your typing speed and accuracy in WPM with words, quotes or code.

### Utilities

- **Unit Converter**: Convert length, weight, temperature, area, speed and data units.
- **chmod Calculator**: Set file permissions with checkboxes, octal or rwx text and get the chmod command.
- **Checksum**: Calculate CRC-32, CRC-16 and Adler-32 checksums and validate Luhn numbers.
- **Programmer Calculator**: Bitwise operations, shifts and two's complement on 8 to 64-bit integers, with a clickable bit grid.
- **Interactive Periodic Table**: Explore all 118 elements by category, state and properties, with electron shells.
- **Decision Wheel & Picker**: Spin a wheel, pick random items, flip coins, roll dice or split a list into teams.

See [docs/PLAN.md](docs/PLAN.md) for the roadmap, including the Phase 2 tools.

## Development

Requires Node 22+ and Yarn 4 (`corepack enable`).

```bash
yarn install
yarn dev
yarn build
```

### Adding a tool

1. Create `src/tools/<category>/<Name>.vue` and wrap it in `<ToolPage>` from `@/components/ui`.
2. Register it in `src/tools/registry.ts`. Routing, the sidebar, search and the home page update automatically.
3. Use only the design-system tokens (`bg-surface`, `text-fg-muted`, `text-fg-subtle`, `border-line`, `text-accent`, `bg-inverse`, …) so both themes work. Use `accent` sparingly; primary buttons use the indigo → cyan signal gradient (`bg-signal`).
4. If the tool adds a global listener (paste, keydown), use `useActiveEventListener` so it pauses while the tool sits in a background tab.
5. To let the chat fill in the tool, call `useHandoff("<tool-id>", (p) => { … })` from `@/composables/handoff` and apply `p.input` (and any other fields) to the tool's state.
6. To run it from the chat, add a rule to `src/chat/actions.ts` (core commands) or `src/chat/actions-more.ts`. A rule gets the message and returns `{ toolId, summary, output?, handoff? }`, or `null` to let the next rule try. Rules run in order and the first match wins; helpers for pulling the input out of a message live in `src/chat/parse.ts`.

### SEO & PWA files

- `src/site.ts` holds the site URL, title and description, shared by the app and the build.
- `plugins/seo.ts` writes `<tool-id>.html`, `og/<tool-id>.png`, `sitemap.xml`, `robots.txt`, `opensearch.xml`, `llms.txt` and `404.html` from the tool registry.
- `vite.config.ts` holds the PWA manifest and service worker settings (`vite-plugin-pwa`).
- `yarn generate:assets` regenerates the icons and `og-image.png` in `public/`. Run it after changing the logo or the tool count.

### Tech stack

Vue 3 · TypeScript · Vite 8 · Vue Router 5 · Tailwind CSS 4 · VueUse · Lucide icons

## Deployment

Deployed on Cloudflare Pages at https://tools.baniamin.com (build command `yarn build`, output directory `dist`). A GitHub Pages workflow is also kept in `.github/workflows/deploy.yml`. Every tool has its own HTML file, so deep links return 200. Unknown paths get the `noindex` 404 page, which boots the app and redirects home.

## Author

Built and maintained by **Baniamin Shams** · [baniamin.com](https://baniamin.com) · [GitHub](https://github.com/MasterBen00) · [LinkedIn](https://www.linkedin.com/in/baniamin-shams-53a243183)
