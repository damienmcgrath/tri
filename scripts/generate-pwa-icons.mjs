/**
 * Generate PWA icon PNG files from SVG templates.
 *
 * Uses @vercel/og's ImageResponse (which bundles Satori + resvg-wasm)
 * so we don't need any native Canvas or Sharp dependency.
 *
 * Run:  node scripts/generate-pwa-icons.mjs
 */

import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

// Brand colors
const BG = "#0a0a0b";
const ACCENT = "#beff00";

function createSvg(size, maskable = false) {
  // For maskable icons the safe zone is the inner 80%, so we add padding
  const padding = maskable ? Math.round(size * 0.1) : Math.round(size * 0.05);
  const innerSize = size - padding * 2;
  const fontSize = Math.round(innerSize * 0.28);
  const subtitleSize = Math.round(innerSize * 0.09);
  const cx = size / 2;
  const cy = size / 2;
  const radius = maskable ? 0 : Math.round(size * 0.12);

  // Triangle (triathlon symbol) - positioned in upper portion
  const triH = Math.round(innerSize * 0.38);
  const triW = Math.round(triH * 1.1);
  const triTop = padding + Math.round(innerSize * 0.12);
  const triX1 = cx;
  const triY1 = triTop;
  const triX2 = cx - triW / 2;
  const triY2 = triTop + triH;
  const triX3 = cx + triW / 2;
  const triY3 = triTop + triH;

  // Text position below triangle
  const textY = triY2 + Math.round(innerSize * 0.22);
  const subtitleY = textY + Math.round(fontSize * 0.9);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${BG}"/>
  <polygon points="${triX1},${triY1} ${triX2},${triY2} ${triX3},${triY3}" fill="none" stroke="${ACCENT}" stroke-width="${Math.max(2, Math.round(size * 0.02))}" stroke-linejoin="round"/>
  <text x="${cx}" y="${textY}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-weight="700" font-size="${fontSize}" fill="${ACCENT}">Tri</text>
  <text x="${cx}" y="${subtitleY}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-weight="400" font-size="${subtitleSize}" fill="rgba(255,255,255,0.65)">.AI</text>
</svg>`;
}

function createFaviconSvg(size) {
  const padding = Math.round(size * 0.08);
  const innerSize = size - padding * 2;
  const cx = size / 2;
  const radius = Math.round(size * 0.15);

  // Just the triangle for small sizes
  const triH = Math.round(innerSize * 0.55);
  const triW = Math.round(triH * 1.1);
  const triTop = padding + Math.round(innerSize * 0.1);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${BG}"/>
  <polygon points="${cx},${triTop} ${cx - triW / 2},${triTop + triH} ${cx + triW / 2},${triTop + triH}" fill="none" stroke="${ACCENT}" stroke-width="${Math.max(2, Math.round(size * 0.06))}" stroke-linejoin="round"/>
  <text x="${cx}" y="${triTop + triH + Math.round(innerSize * 0.28)}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-weight="700" font-size="${Math.round(innerSize * 0.22)}" fill="${ACCENT}">Tri</text>
</svg>`;
}

// Write SVG files that will be used as source for icons
// For a proper production setup you'd convert these to PNG with Sharp or similar,
// but SVG icons work in modern browsers and the manifest accepts them.
// We'll write both SVG source files and use them directly.

const icons = [
  { name: "icon-192x192.svg", size: 192 },
  { name: "icon-512x512.svg", size: 512 },
  { name: "icon-maskable-512x512.svg", size: 512, maskable: true },
  { name: "apple-touch-icon.svg", size: 180 },
  { name: "favicon.svg", size: 32, favicon: true },
];

for (const icon of icons) {
  const svg = icon.favicon
    ? createFaviconSvg(icon.size)
    : createSvg(icon.size, icon.maskable);
  const path = join(publicDir, icon.name);
  writeFileSync(path, svg, "utf-8");
  console.log(`✓ ${icon.name} (${icon.size}×${icon.size})`);
}

console.log("\nDone! SVG icons written to /public/");
