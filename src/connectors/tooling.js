/** Small helpers shared by the connectors' action tools. */

/** A refusal an agent can act on: the message reaches it as "error: …". */
export class ToolError extends Error {}

export const fail = (message) => { throw new ToolError(message); };

export const text = (value, max = 100000) => (value === undefined || value === null ? "" : String(value).trim().slice(0, max));

/** A positive whole number within bounds, or the fallback. */
export const count = (value, fallback, max) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? Math.min(number, max) : fallback;
};

export const list = (value) => (Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value]).map((item) => String(item).trim()).filter(Boolean);

/** Drops undefined fields, so an update sends only what the agent named. */
export const defined = (object) => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));

/** Picks one item by id or name: exact name first, then a unique partial match; ambiguity lists the candidates. */
export function pick(items, wanted, { what, id = "id", name = "name" } = {}) {
  const needle = String(wanted || "").trim();
  if (!needle) fail(`name the ${what}`);
  const byId = items.find((item) => String(item[id]) === needle);
  if (byId) return byId;
  const lower = needle.toLowerCase();
  const exact = items.filter((item) => String(item[name] || "").toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  const partial = exact.length ? exact : items.filter((item) => String(item[name] || "").toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  const shown = (partial.length ? partial : items).slice(0, 25).map((item) => `${item[name]} (${item[id]})`).join(", ");
  fail(partial.length ? `more than one ${what} matches "${needle}": ${shown}; give the id` : `no ${what} named "${needle}"${shown ? `; there are: ${shown}` : ""}`);
}

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json", html: "text/html", zip: "application/zip", mp4: "video/mp4", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };

/** Reads a file from the agent's own computer, which Cora reaches for it: the agent never pastes bytes into a call. */
export async function localFile(args, ctx, { max = 25 * 1024 * 1024 } = {}) {
  const path = text(args.path, 1000);
  if (!path.startsWith("/") || path.includes("\0") || path.split("/").includes("..")) fail("path is the absolute path of the file on your computer, e.g. /home/agent/work/shot.png");
  if (!ctx.readFile) fail("files cannot be read from your computer in this turn");
  let bytes;
  try { bytes = await ctx.readFile(path); } catch { fail(`cannot read ${path} on your computer`); }
  if (!bytes?.length) fail(`${path} is empty`);
  if (bytes.length > max) fail(`${path} is ${bytes.length} bytes: at most ${max}`);
  const filename = (text(args.filename, 200) || path.split("/").pop()).replace(/[\\/\r\n\0"]/g, "_") || "file";
  const extension = filename.split(".").pop().toLowerCase();
  return { filename, bytes: Buffer.from(bytes), contentType: text(args.content_type, 120) || MIME[extension] || "application/octet-stream" };
}

export const FILE_PARAMS = {
  path: { type: "string", description: "absolute path of the file on your computer, e.g. /home/agent/work/shot.png (at most 25 MB)" },
  filename: { type: "string", description: "optional name to give it; default the file's own name" },
  content_type: { type: "string", description: "optional MIME type; guessed from the extension" },
};
