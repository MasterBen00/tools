/** Plain-English explanations of common HTTP headers, keyed by lower-case name. */

export type HeaderCategory = "Security" | "Caching" | "CORS" | "Content" | "Cookies" | "Auth" | "Connection" | "Request context" | "Redirects" | "Server info" | "Conditional" | "Proxy" | "Reporting";

export interface HeaderInfo {
    name: string;
    category: HeaderCategory;
    kind: "request" | "response" | "both";
    text: string;
}

const list: HeaderInfo[] = [
    // Security
    { name: "Content-Security-Policy", category: "Security", kind: "response", text: "Allow-list of where scripts, styles, images, frames and connections may come from. The main defence against XSS." },
    { name: "Content-Security-Policy-Report-Only", category: "Security", kind: "response", text: "Same as CSP but only reports violations without blocking. Used to trial a policy." },
    { name: "Strict-Transport-Security", category: "Security", kind: "response", text: "HSTS: tells the browser to use HTTPS only for this host for max-age seconds, so http links and downgrade attacks stop working." },
    { name: "X-Content-Type-Options", category: "Security", kind: "response", text: "nosniff stops the browser from guessing a different content type than Content-Type says (MIME sniffing)." },
    { name: "X-Frame-Options", category: "Security", kind: "response", text: "Whether this page may be shown in a frame (DENY / SAMEORIGIN). Protects against clickjacking; superseded by CSP frame-ancestors." },
    { name: "Referrer-Policy", category: "Security", kind: "response", text: "How much of the current URL is sent in the Referer header when following links or loading resources." },
    { name: "Permissions-Policy", category: "Security", kind: "response", text: "Turns browser features (camera, geolocation, microphone, payment…) on or off for this page and its frames." },
    { name: "Feature-Policy", category: "Security", kind: "response", text: "Older name of Permissions-Policy. Deprecated." },
    { name: "Cross-Origin-Opener-Policy", category: "Security", kind: "response", text: "COOP: isolates this window from cross-origin popups/openers (same-origin), blocking cross-window attacks like XS-Leaks." },
    { name: "Cross-Origin-Embedder-Policy", category: "Security", kind: "response", text: "COEP: requires every embedded resource to opt in (CORP/CORS). Together with COOP enables cross-origin isolation (SharedArrayBuffer)." },
    { name: "Cross-Origin-Resource-Policy", category: "Security", kind: "response", text: "CORP: which origins may embed this resource (same-origin, same-site, cross-origin)." },
    { name: "X-XSS-Protection", category: "Security", kind: "response", text: "Controlled the old XSS auditor in IE/Chrome. Obsolete; best set to 0 or removed and replaced by CSP." },
    { name: "X-Permitted-Cross-Domain-Policies", category: "Security", kind: "response", text: "Policy for Adobe Flash/Acrobat cross-domain requests. Mostly legacy; none is the safe value." },
    { name: "X-DNS-Prefetch-Control", category: "Security", kind: "response", text: "Enables or disables DNS prefetching of links on the page." },
    { name: "Origin-Agent-Cluster", category: "Security", kind: "response", text: "Asks the browser to put this origin in its own agent cluster (process) instead of sharing with same-site pages." },
    // Caching
    { name: "Cache-Control", category: "Caching", kind: "both", text: "Caching rules: max-age, no-store, no-cache (revalidate), private/public, immutable, s-maxage for shared caches." },
    { name: "Expires", category: "Caching", kind: "response", text: "Date after which the response is stale. Ignored when Cache-Control max-age is present." },
    { name: "Pragma", category: "Caching", kind: "both", text: "HTTP/1.0 cache directive (no-cache). Only for very old caches." },
    { name: "Age", category: "Caching", kind: "response", text: "Seconds the response has been sitting in a proxy/CDN cache." },
    { name: "ETag", category: "Conditional", kind: "response", text: "Version identifier of the resource. The browser sends it back in If-None-Match to get a cheap 304 Not Modified." },
    { name: "Last-Modified", category: "Conditional", kind: "response", text: "When the resource last changed; used with If-Modified-Since for revalidation." },
    { name: "If-None-Match", category: "Conditional", kind: "request", text: "Sends the cached ETag; the server answers 304 if it still matches." },
    { name: "If-Modified-Since", category: "Conditional", kind: "request", text: "Sends the cached Last-Modified date; the server answers 304 if unchanged." },
    { name: "Vary", category: "Caching", kind: "response", text: "Request headers that change the response (e.g. Accept-Encoding, Origin). Caches keep a separate copy per value." },
    { name: "X-Cache", category: "Caching", kind: "response", text: "CDN/proxy note on whether this was a cache HIT or MISS (non-standard)." },
    { name: "CF-Cache-Status", category: "Caching", kind: "response", text: "Cloudflare cache result: HIT, MISS, DYNAMIC, BYPASS, EXPIRED…" },
    // CORS
    { name: "Access-Control-Allow-Origin", category: "CORS", kind: "response", text: "Which origin may read this response from JavaScript (* = any, but then credentials are not allowed)." },
    { name: "Access-Control-Allow-Credentials", category: "CORS", kind: "response", text: "true lets cross-origin JavaScript read the response when cookies/auth were sent. Requires a specific origin, not *." },
    { name: "Access-Control-Allow-Methods", category: "CORS", kind: "response", text: "Methods allowed for the actual request (preflight answer)." },
    { name: "Access-Control-Allow-Headers", category: "CORS", kind: "response", text: "Request headers allowed for the actual request (preflight answer)." },
    { name: "Access-Control-Expose-Headers", category: "CORS", kind: "response", text: "Response headers that cross-origin JavaScript may read beyond the safe default set." },
    { name: "Access-Control-Max-Age", category: "CORS", kind: "response", text: "How long (seconds) the preflight result can be cached." },
    { name: "Access-Control-Request-Method", category: "CORS", kind: "request", text: "Sent in a preflight: the method the real request will use." },
    { name: "Access-Control-Request-Headers", category: "CORS", kind: "request", text: "Sent in a preflight: the headers the real request will carry." },
    { name: "Origin", category: "CORS", kind: "request", text: "Scheme + host + port of the page that made the request. Used for CORS and CSRF checks." },
    { name: "Timing-Allow-Origin", category: "CORS", kind: "response", text: "Origins allowed to see detailed resource timing for this response." },
    // Content
    { name: "Content-Type", category: "Content", kind: "both", text: "Media type of the body (and charset), e.g. application/json; charset=utf-8." },
    { name: "Content-Length", category: "Content", kind: "both", text: "Size of the body in bytes." },
    { name: "Content-Encoding", category: "Content", kind: "both", text: "Compression applied to the body (gzip, br, zstd)." },
    { name: "Content-Language", category: "Content", kind: "response", text: "Language of the content for the audience." },
    { name: "Content-Disposition", category: "Content", kind: "response", text: "inline or attachment (download), with the suggested filename." },
    { name: "Content-Range", category: "Content", kind: "response", text: "Which byte range of the full resource this partial response contains." },
    { name: "Accept", category: "Content", kind: "request", text: "Media types the client can handle, in order of preference." },
    { name: "Accept-Encoding", category: "Content", kind: "request", text: "Compression formats the client supports." },
    { name: "Accept-Language", category: "Content", kind: "request", text: "Preferred natural languages of the user." },
    { name: "Accept-Ranges", category: "Content", kind: "response", text: "bytes means the server supports partial (range) requests, e.g. for resuming downloads or video seeking." },
    { name: "Range", category: "Content", kind: "request", text: "Asks for only part of the resource (byte range)." },
    { name: "Transfer-Encoding", category: "Connection", kind: "both", text: "How the body is framed on the wire, usually chunked when the length is not known up front (HTTP/1.1)." },
    // Cookies / auth
    { name: "Set-Cookie", category: "Cookies", kind: "response", text: "Stores a cookie in the browser, with its scope (Domain, Path), lifetime and flags (Secure, HttpOnly, SameSite)." },
    { name: "Cookie", category: "Cookies", kind: "request", text: "Cookies the browser sends back for this host and path." },
    { name: "Authorization", category: "Auth", kind: "request", text: "Credentials for the request: Bearer token, Basic user:password (base64), etc." },
    { name: "WWW-Authenticate", category: "Auth", kind: "response", text: "Sent with 401: which authentication scheme the client should use." },
    { name: "Proxy-Authorization", category: "Auth", kind: "request", text: "Credentials for an intermediate proxy." },
    // Connection
    { name: "Connection", category: "Connection", kind: "both", text: "keep-alive or close for the TCP connection (HTTP/1.1 only, forbidden in HTTP/2)." },
    { name: "Keep-Alive", category: "Connection", kind: "both", text: "Timeout and max requests for a persistent HTTP/1.1 connection." },
    { name: "Upgrade", category: "Connection", kind: "both", text: "Switch protocols on the same connection, e.g. to websocket." },
    { name: "Alt-Svc", category: "Connection", kind: "response", text: "Advertises the same service on another protocol/port, typically HTTP/3 (h3) over QUIC." },
    { name: "Host", category: "Request context", kind: "request", text: "Host name (and port) the request is for. Required in HTTP/1.1." },
    { name: "Date", category: "Server info", kind: "both", text: "When the message was generated." },
    // Request context
    { name: "User-Agent", category: "Request context", kind: "request", text: "Browser / client name and version." },
    { name: "Referer", category: "Request context", kind: "request", text: "URL of the page that linked to or loaded this resource (amount controlled by Referrer-Policy)." },
    { name: "Sec-Fetch-Site", category: "Request context", kind: "request", text: "Fetch metadata: same-origin, same-site, cross-site or none. Lets servers reject unexpected cross-site requests." },
    { name: "Sec-Fetch-Mode", category: "Request context", kind: "request", text: "Fetch metadata: navigate, cors, no-cors, same-origin, websocket." },
    { name: "Sec-Fetch-Dest", category: "Request context", kind: "request", text: "Fetch metadata: what the response will be used for (document, script, image, empty…)." },
    { name: "Sec-Fetch-User", category: "Request context", kind: "request", text: "?1 when the navigation was triggered by a user action." },
    { name: "Sec-CH-UA", category: "Request context", kind: "request", text: "Client hint with the browser brand and major version (low-entropy User-Agent replacement)." },
    { name: "Upgrade-Insecure-Requests", category: "Request context", kind: "request", text: "The browser prefers an HTTPS version of the page if available." },
    { name: "X-Requested-With", category: "Request context", kind: "request", text: "Commonly XMLHttpRequest, set by some JS libraries to mark AJAX requests (non-standard)." },
    { name: "DNT", category: "Request context", kind: "request", text: "Do Not Track preference. Deprecated and widely ignored." },
    // Proxy
    { name: "X-Forwarded-For", category: "Proxy", kind: "request", text: "Client IP chain added by proxies/load balancers. Only trust it from your own proxies." },
    { name: "X-Forwarded-Proto", category: "Proxy", kind: "request", text: "Original protocol (http/https) seen by the proxy. Spring uses it with server.forward-headers-strategy." },
    { name: "X-Forwarded-Host", category: "Proxy", kind: "request", text: "Original Host header seen by the proxy." },
    { name: "Forwarded", category: "Proxy", kind: "request", text: "Standard (RFC 7239) version of the X-Forwarded-* headers." },
    { name: "Via", category: "Proxy", kind: "both", text: "Proxies and gateways the message passed through." },
    { name: "X-Request-Id", category: "Proxy", kind: "both", text: "Correlation id for tracing a request through logs (non-standard)." },
    { name: "Traceparent", category: "Proxy", kind: "both", text: "W3C Trace Context: distributed-tracing id propagated between services." },
    // Redirects / server
    { name: "Location", category: "Redirects", kind: "response", text: "Target URL of a redirect (3xx) or the URL of a newly created resource (201)." },
    { name: "Refresh", category: "Redirects", kind: "response", text: "Reload or redirect after N seconds (non-standard but widely supported)." },
    { name: "Retry-After", category: "Server info", kind: "response", text: "How long to wait before retrying (with 429 or 503)." },
    { name: "Server", category: "Server info", kind: "response", text: "Software that served the response. Version numbers here help attackers pick exploits." },
    { name: "X-Powered-By", category: "Server info", kind: "response", text: "Framework behind the server (Express, PHP, ASP.NET). Pure information leak; safe to remove." },
    { name: "X-AspNet-Version", category: "Server info", kind: "response", text: "Exact ASP.NET version. Information leak; disable it in web.config." },
    { name: "X-AspNetMvc-Version", category: "Server info", kind: "response", text: "Exact ASP.NET MVC version. Information leak." },
    { name: "Link", category: "Content", kind: "response", text: "Related resources: preload hints, pagination (rel=next), canonical URL." },
    { name: "Allow", category: "Server info", kind: "response", text: "Methods supported by the resource (sent with 405 or OPTIONS)." },
    { name: "Server-Timing", category: "Server info", kind: "response", text: "Backend timing metrics shown in DevTools (db;dur=53). Can leak internals in production." },
    { name: "X-RateLimit-Limit", category: "Server info", kind: "response", text: "Requests allowed in the current rate-limit window (non-standard)." },
    { name: "X-RateLimit-Remaining", category: "Server info", kind: "response", text: "Requests left in the current window (non-standard)." },
    { name: "X-Robots-Tag", category: "Server info", kind: "response", text: "Search-engine indexing rules for this response (noindex, nofollow)." },
    // Reporting
    { name: "Reporting-Endpoints", category: "Reporting", kind: "response", text: "Named URLs where the browser sends CSP, COOP and other reports (used by report-to)." },
    { name: "Report-To", category: "Reporting", kind: "response", text: "Older JSON form of Reporting-Endpoints. Deprecated." },
    { name: "NEL", category: "Reporting", kind: "response", text: "Network Error Logging: asks the browser to report network failures to a Report-To group." },
];

export const HEADER_INFO = new Map(list.map((h) => [h.name.toLowerCase(), h]));
