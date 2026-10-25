// Draws Cora's app icons (web/*.png) with no dependencies: an amber C open to the
// right with the red on-air light in the gap. Run: node bin/icons.mjs
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
const BG = hex("#14110e");
const GLOW = hex("#2c2218");
const AMBER = hex("#f2a93b");
const AMBER_DEEP = hex("#c47f1e");
const RED = hex("#e5533d");
const RED_GLOW = hex("#5a2016");
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, t))));

/**
 * Cora's mark in unit coordinates: a thick amber C, open to the right, with
 * the red on-air light sitting in the gap — the agent that leaves the circle.
 */
function scene(u, v) {
  const cx = 0.47;
  const cy = 0.5;
  let color = mix(GLOW, BG, Math.hypot(u - 0.5, v - 0.4) * 1.7);
  const dx = u - cx;
  const dy = v - cy;
  const r = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const outer = 0.27;
  const inner = 0.165;
  const gap = 0.62;
  const mid = (outer + inner) / 2;
  const half = (outer - inner) / 2;
  const capA = [cx + mid * Math.cos(gap), cy + mid * Math.sin(gap)];
  const capB = [cx + mid * Math.cos(-gap), cy + mid * Math.sin(-gap)];
  const onRing = r >= inner && r <= outer && Math.abs(angle) >= gap;
  const onCap = Math.hypot(u - capA[0], v - capA[1]) <= half || Math.hypot(u - capB[0], v - capB[1]) <= half;
  if (onRing || onCap) color = mix(AMBER, AMBER_DEEP, (v - 0.2) / 0.7);
  const light = [cx + mid + 0.02, cy];
  const d = Math.hypot(u - light[0], v - light[1]);
  if (d <= 0.12 && !(onRing || onCap)) color = mix(RED_GLOW, color, d / 0.12);
  if (d <= 0.058) color = RED;
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
