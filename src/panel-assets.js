import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const VERSIONED = /^\/assets\/v\/([0-9a-f]{1,64})\/([\w.-]+)$/;
const IMMUTABLE = "public, max-age=31536000, immutable";

/**
 * The panel's files under a build id that changes whenever any of them changes. The page asks for
 * /assets/v/<build>/<file>, so a deploy gives every file a new address and no browser or proxy cache
 * (Cloudflare rewrites no-cache to hours) can keep serving the previous version. Relative module
 * imports resolve inside the same versioned directory.
 */
export function panelAssets(dir, files) {
  let seen = "", build = "";
  const paths = Object.values(files).map(([file]) => join(dir, file));
  const current = () => {
    const signature = paths.map((path) => { const stat = statSync(path); return `${stat.size}:${stat.mtimeMs}`; }).join("|");
    if (signature !== seen) {
      const hash = createHash("sha256");
      for (const path of paths) hash.update(readFileSync(path)).update("\0");
      build = hash.digest("hex").slice(0, 16);
      seen = signature;
    }
    return build;
  };
  const versioned = (html, id) => html.replace(/(["'])\/assets\/([\w.-]+)\1/g, (match, quote, name) =>
    files[`/assets/${name}`] ? `${quote}/assets/v/${id}/${name}${quote}` : match);
  return {
    build: current,
    /** Resolves a request path to [file, type, cacheControl, body] or null. */
    resolve(pathname) {
      const match = VERSIONED.exec(pathname);
      const key = match ? `/assets/${match[2]}` : pathname;
      const file = files[key];
      if (!file) return null;
      const id = current();
      let body = readFileSync(join(dir, file[0]));
      if (key === "/") body = Buffer.from(versioned(body.toString("utf8"), id));
      const cache = match && match[1] === id ? IMMUTABLE : match ? "no-store" : "no-cache";
      return { type: file[1], cache, body };
    },
  };
}
