import { createPrivateKey, createPublicKey, hkdfSync, randomBytes, sign, verify } from "node:crypto";

/**
 * Passes from the cloud (usecora.space) into a space: a short-lived token the
 * cloud signs with its Ed25519 key and the space checks with the public key
 * alone, so no secret ever travels between the two.
 */
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const CONTEXT = "cora-pass.v1.";
export const PASS_TTL_MS = 60 * 1000;

/** The cloud's signing key, derived from a stored seed (any length, at least 32 bytes of entropy). */
export function passKeys(seed) {
  const raw = Buffer.from(hkdfSync("sha256", Buffer.from(String(seed)), Buffer.alloc(0), Buffer.from("cora cloud pass key"), 32));
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, raw]), format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(SPKI_PREFIX.length).toString("base64url");
  return { privateKey, publicKey };
}

export function signPass(privateKey, fields, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ ...fields, iat: now, exp: now + PASS_TTL_MS, jti: randomBytes(12).toString("base64url") })).toString("base64url");
  return `${payload}.${sign(null, Buffer.from(CONTEXT + payload), privateKey).toString("base64url")}`;
}

/** The pass's fields when it is genuine, meant for `audience` and still fresh; otherwise null. */
export function verifyPass(publicKey, token, { audience, now = Date.now() }) {
  const [payload, signature, extra] = String(token || "").split(".");
  if (!payload || !signature || extra !== undefined) return null;
  let key;
  try {
    key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(String(publicKey), "base64url")]), format: "der", type: "spki" });
  } catch {
    return null;
  }
  let ok = false;
  try {
    ok = verify(null, Buffer.from(CONTEXT + payload), key, Buffer.from(signature, "base64url"));
  } catch {}
  if (!ok) return null;
  let fields;
  try {
    fields = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (fields.aud !== audience || typeof fields.exp !== "number" || fields.exp < now || typeof fields.jti !== "string") return null;
  return fields;
}

/** Remembers the passes already used until they expire, so each one opens a session once. */
export function passLedger() {
  const used = new Map();
  return (fields, now = Date.now()) => {
    for (const [id, exp] of used) if (exp < now) used.delete(id);
    if (used.has(fields.jti)) return false;
    used.set(fields.jti, fields.exp);
    return true;
  };
}
