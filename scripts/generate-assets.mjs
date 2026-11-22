// Generates PWA icons and the Open Graph image from SVG sources.
// Run with: yarn generate:assets  (outputs are committed to public/)
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pub = (f) => fileURLToPath(new URL(`../public/${f}`, import.meta.url));
// "Midnight Signal" design system (baniamin.com): indigo -> cyan signal gradient on ink surfaces.
const ACCENT_FG = "#ffffff";
const GRAD = `<linearGradient id="sig" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c6cff"/><stop offset=".45" stop-color="#5b8cff"/><stop offset="1" stop-color="#22d3ee"/></linearGradient>`;

// Lucide "code-xml" (ISC license), a 24×24 stroke icon, the same one the app header uses.
const GLYPH = "m18 16 4-4-4-4 M6 8l-4 4 4 4 M14.5 4l-5 16";

/** Icon SVG. `pad` shrinks the glyph for maskable/apple icons; `round` keeps rounded corners. */
export const icon = ({ pad = 0, round = true } = {}) => {
    // Glyph box is 18/32 of the tile by default; padding shrinks it toward the center.
    const box = 18 * (1 - pad * 2);
    const scale = box / 24;
    const offset = (32 - box) / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <defs>${GRAD}</defs>
  <rect width="32" height="32" rx="${round ? 9 : 0}" fill="url(#sig)"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})"><path d="${GLYPH}" fill="none" stroke="${ACCENT_FG}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></g>
</svg>`;
};

async function png(svg, size, file) {
    await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(pub(file));
    console.log("✓", file);
}

writeFileSync(pub("favicon.svg"), icon() + "\n");
await png(icon(), 32, "favicon-32x32.png");
await png(icon(), 64, "pwa-64x64.png");
await png(icon(), 192, "pwa-192x192.png");
await png(icon(), 512, "pwa-512x512.png");
// Maskable: full-bleed background, glyph inside the 80% safe zone.
await png(icon({ pad: 0.12, round: false }), 512, "maskable-icon-512x512.png");
// Apple applies its own corner mask, so use a square, slightly padded icon.
await png(icon({ pad: 0.08, round: false }), 180, "apple-touch-icon.png");

// Open Graph / Twitter card image (1200×630).
const registry = readFileSync(fileURLToPath(new URL("../src/tools/registry.ts", import.meta.url)), "utf8");
const count = (registry.match(/\{ id: "[^"]+", name: "[^"]+", category: /g) || []).length;
const chips = ["JSON", "Regex", "Hash", "UUID", "JWT", "Cron", "Base64", "Diff", "Colors"];
let x = 80;
const chipSvg = chips
    .map((c) => {
        const w = c.length * 15 + 36;
        const s = `<g transform="translate(${x} 478)"><rect width="${w}" height="44" rx="22" fill="#161927" stroke="#33374d"/><text x="${w / 2}" y="29" text-anchor="middle" font-family="JetBrains Mono, Consolas, Menlo, monospace" font-size="19" fill="#a4a9c0">${c}</text></g>`;
        x += w + 12;
        return s;
    })
    .join("");

// Ink background with the engineering grid and an aurora glow, a card ringed by `line`.
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#ffffff0d"/></pattern>
    <radialGradient id="glow" cx="0.9" cy="0" r="0.7"><stop offset="0" stop-color="#7c6cff" stop-opacity=".35"/><stop offset="1" stop-color="#7c6cff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#07080d"/>
  <rect width="1200" height="630" fill="url(#grid)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect x="40" y="40" width="1120" height="550" rx="28" fill="#0f111b" fill-opacity=".85" stroke="#232638"/>
  <g transform="translate(80 80) scale(2)">${icon().replace(/<\/?svg[^>]*>/g, "")}</g>
  <text x="160" y="125" font-family="Bricolage Grotesque, Inter, Segoe UI, Arial, sans-serif" font-size="36" font-weight="700" fill="#eef0f8">DevTools</text>
  <text x="80" y="275" font-family="Bricolage Grotesque, Inter, Segoe UI, Arial, sans-serif" font-size="68" font-weight="700" fill="url(#sig)">Developer tools.</text>
  <text x="80" y="355" font-family="Bricolage Grotesque, Inter, Segoe UI, Arial, sans-serif" font-size="68" font-weight="700" fill="#eef0f8">Right in your browser.</text>
  <text x="80" y="428" font-family="Inter, Helvetica, Arial, sans-serif" font-size="26" fill="#a4a9c0">${count} free tools · private · works offline · by Baniamin Shams</text>
  ${chipSvg}
</svg>`;
writeFileSync(pub("og-image.svg"), og);
await sharp(Buffer.from(og)).png({ compressionLevel: 9 }).toFile(pub("og-image.png"));
console.log("✓ og-image.png");
