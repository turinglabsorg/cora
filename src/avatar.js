import { encodePng } from "./png.js";

/** Bumped when the drawing changes: every picture gets a new address, so apps and bots fetch it again. */
export const AVATAR_STYLE = 3;

/** A number from a string, the same every time (FNV-1a), then a small generator from it. */
function generator(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  let state = hash >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgb(hex) {
  const value = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""))?.[1] || "e8a33d";
  return [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16));
}

const mix = (a, b, t) => a.map((value, index) => value + (b[index] - value) * t);
const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));

/** Distance from a point to a segment, for capsule shapes. */
function segment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/**
 * An agent's picture, drawn by Cora like Cora's mark: a circle and a ring on it,
 * drawn as lines in the agent's colour on black, the far half of the ring faint
 * behind, and two eyes. The seed picks everything else, so every agent has its own
 * face and keeps it: where the ring sits (across the eyes like a visor, above them
 * like a cap, below them like a collar), how flat it looks, which way the head
 * leans, and the eyes (tall, round or smiling shut) and where they look. Lines are
 * thick and everything stays inside the circle chat apps cut avatars to, so a face
 * still reads at 40 pixels. A square PNG, 512 pixels by default: what Slack and
 * Discord ask of an app's icon.
 */
export function drawAvatar({ seed = "cora", color = "#e8a33d", size = 512 } = {}) {
  const random = generator(seed);
  // A colour too dark to see on black becomes graphite with a hint of itself.
  const chosen = rgb(color);
  const luma = 0.2126 * chosen[0] + 0.7152 * chosen[1] + 0.0722 * chosen[2];
  const base = luma < 60 ? mix(chosen, [150, 150, 156], 0.75) : chosen;
  const ground = [7, 7, 7];
  const faint = mix(ground, base, 0.38);
  const white = [250, 249, 246];
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.36;
  const line = size * 0.045;
  // The head leans one way or the other; the ring and the eyes lean with it.
  const tilt = (random() < 0.5 ? -1 : 1) * (0.06 + random() * 0.3);
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  // A ring on a sphere seen from a little above: the equator, or a parallel above or below it.
  const layout = ["visor", "cap", "collar"][Math.floor(random() * 3)];
  const flat = layout === "visor" ? 0.42 + random() * 0.06 : 0.26 + random() * 0.1;
  const height = layout === "visor" ? 0 : (layout === "cap" ? -1 : 1) * (0.3 + random() * 0.15);
  const ring = { c: height * r * Math.sqrt(1 - flat * flat), rx: r * Math.sqrt(1 - height * height) };
  ring.ry = ring.rx * flat;
  const arcAt = (x) => ring.ry * Math.sqrt(Math.max(0, 1 - (x / ring.rx) ** 2));

  const eyeKind = random() < 0.45 ? "tall" : random() < 0.6 ? "round" : "smile";
  const spread = r * (layout === "visor" ? 0.31 + random() * 0.03 : 0.36 + random() * 0.05);
  const lookX = (random() - 0.5) * r * 0.1;
  // Room between the eyes and the ring; more under a collar, whose faint half runs just below them.
  const gap = r * (layout === "collar" ? 0.13 : 0.08);
  // Each kind of eye at full size, big on purpose: its half width and half height.
  const full = { tall: [0.115, 0.25], round: [0.22, 0.22], smile: [0.17 + 0.0625, 0.1475] }[eyeKind].map((value) => value * r);
  const innerX = spread - full[0];
  let scale = 1;
  let eyeY;
  if (layout === "visor") {
    // Between the two halves of the ring, as large as the band lets them be.
    scale = Math.min(1, (arcAt(spread + full[0]) - line / 2 - gap) / full[1]);
    eyeY = ring.c;
  } else if (layout === "cap") eyeY = ring.c + arcAt(innerX) + line / 2 + gap + full[1];
  else eyeY = ring.c - arcAt(innerX) - line / 2 - gap - full[1];
  const k = r * scale;
  const smile = { y: eyeY + 0.085 * k, radius: 0.17 * k };

  /** What of an eye is at a point of the leaning face ("eye", "glint", or "" for none), with the eyes made `grow` larger. */
  const eye = (x, y, grow = 0) => {
    for (const side of [-1, 1]) {
      const ex = side * spread + lookX;
      if (eyeKind === "smile") {
        // Shut and happy: an arch, its ends rounded like the mark's lines.
        const arc = Math.abs(Math.hypot(x - ex, y - smile.y) - smile.radius) < line / 2 + grow && y < smile.y;
        const ends = Math.min(Math.hypot(x - (ex - smile.radius), y - smile.y), Math.hypot(x - (ex + smile.radius), y - smile.y)) < line / 2 + grow;
        if (arc || ends) return "eye";
        continue;
      }
      const inside = eyeKind === "tall"
        ? segment(x, y, ex, eyeY - 0.135 * k, ex, eyeY + 0.135 * k) < 0.115 * k + grow
        : Math.hypot(x - ex, y - eyeY) < 0.22 * k + grow;
      if (!inside) continue;
      return Math.hypot(x - (ex - 0.05 * k), y - (eyeY - (eyeKind === "tall" ? 0.13 : 0.08) * k)) < 0.065 * k ? "glint" : "eye";
    }
    return "";
  };

  const sample = (px, py) => {
    const dx = px - cx;
    const dy = py - cy;
    if (Math.abs(Math.hypot(dx, dy) - r) < line / 2) return base;
    // The face leans: everything else is drawn upright and turned.
    const x = dx * cos + dy * sin;
    const y = -dx * sin + dy * cos;
    const part = eye(x, y);
    if (part) return part === "glint" ? white : base;
    // The ring: the near half in front, the far half seen through, stopping short of the eyes.
    const v = y - ring.c;
    const f = (x / ring.rx) ** 2 + (v / ring.ry) ** 2 - 1;
    const gradient = Math.hypot((2 * x) / ring.rx ** 2, (2 * v) / ring.ry ** 2) || 1;
    if (Math.abs(f) / gradient < line / 2) {
      if (v >= 0) return base;
      if (!eye(x, y, line)) return faint;
    }
    return ground;
  };

  // One sample at every pixel corner. Shapes are flat, so a pixel whose four corners
  // agree is that colour; only the pixels on an edge take three by three samples.
  const side = size + 1;
  const corners = new Array(side * side);
  for (let y = 0; y <= size; y += 1) for (let x = 0; x <= size; x += 1) corners[y * side + x] = sample(x, y);
  const steps = 3;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const at = (y * size + x) * 4;
      const corner = corners[y * side + x];
      if (corner === corners[y * side + x + 1] && corner === corners[(y + 1) * side + x] && corner === corners[(y + 1) * side + x + 1]) {
        pixels[at] = Math.round(corner[0]);
        pixels[at + 1] = Math.round(corner[1]);
        pixels[at + 2] = Math.round(corner[2]);
      } else {
        const sum = [0, 0, 0];
        for (let sy = 0; sy < steps; sy += 1) {
          for (let sx = 0; sx < steps; sx += 1) {
            const colour = sample(x + (sx + 0.5) / steps, y + (sy + 0.5) / steps);
            sum[0] += colour[0];
            sum[1] += colour[1];
            sum[2] += colour[2];
          }
        }
        for (let channel = 0; channel < 3; channel += 1) pixels[at + channel] = Math.round(sum[channel] / (steps * steps));
      }
      pixels[at + 3] = 255;
    }
  }
  return encodePng(size, size, pixels);
}

const drawn = new Map();

/** A drawn picture, kept by what it is drawn from: drawing one takes a fraction of a second. */
export function drawnAvatar(seed, color) {
  const key = `${seed}|${color}`;
  let image = drawn.get(key);
  if (!image) {
    image = drawAvatar({ seed, color });
    drawn.set(key, image);
    if (drawn.size > 64) drawn.delete(drawn.keys().next().value);
  }
  return image;
}

/** A short tag for one agent's picture: it changes whenever what the picture is made of changes. */
export function avatarVersion({ id = "", avatarSeed = "", color = "", avatarUpload = "" }) {
  let hash = 2166136261;
  for (const char of `${AVATAR_STYLE}|${avatarSeed || id}|${color}|${avatarUpload}`) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  return (hash >>> 0).toString(36);
}
