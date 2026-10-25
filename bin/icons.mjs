// Draws Cora's app icons (web/*.png) with no dependencies: an amber sphere in
// outline (rim and a tilted equator) on black. Run: node bin/icons.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
function png(size, pixel) {
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    rows[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = pixel(x, y);
      rows.set([r, g, b, 255], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
const BG = hex("#050505");
const GLOW = hex("#241c14");
const AMBER = hex("#f2a93b");
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, t))));

/** Distance from a point to an axis-aligned ellipse centred in c, first-order (good for thin strokes). */
function ellipseDistance(x, y, a, b) {
  const f = (x * x) / (a * a) + (y * y) / (b * b) - 1;
  const gx = (2 * x) / (a * a);
  const gy = (2 * y) / (b * b);
  return Math.abs(f) / Math.max(Math.hypot(gx, gy), 1e-6);
}

/**
 * Cora's mark in unit coordinates: a sphere in outline — the rim and one tilted
 * equator, its far half fainter so it reads as depth.
 */
function scene(u, v) {
  const x = u - 0.5;
  const y = v - 0.5;
  const radius = 0.29;
  const stroke = 0.0095;
  const tilt = (-24 * Math.PI) / 180;
  let color = mix(GLOW, BG, Math.hypot(x, y + 0.1) * 1.9);
  if (Math.abs(Math.hypot(x, y) - radius) <= stroke) return AMBER;
  const rx = x * Math.cos(tilt) + y * Math.sin(tilt);
  const ry = -x * Math.sin(tilt) + y * Math.cos(tilt);
  if (ellipseDistance(rx, ry, radius, radius * 0.3) <= stroke) color = ry >= 0 ? AMBER : mix(color, AMBER, 0.38);
  return color;
}

function render(size) {
  const samples = 4;
  return png(size, (x, y) => {
    const sum = [0, 0, 0];
    for (let i = 0; i < samples; i += 1) {
      for (let j = 0; j < samples; j += 1) {
        const c = scene((x + (i + 0.5) / samples) / size, (y + (j + 0.5) / samples) / size);
        sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2];
      }
    }
    return sum.map((value) => Math.round(value / samples / samples));
  });
}

const dir = new URL("../web/", import.meta.url);
writeFileSync(new URL("icon-192.png", dir), render(192));
writeFileSync(new URL("icon-512.png", dir), render(512));
writeFileSync(new URL("apple-touch-icon.png", dir), render(180));
console.log("icons written");
