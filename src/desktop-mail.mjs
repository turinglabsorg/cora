import { constants, createDecipheriv, privateDecrypt, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

class MailError extends Error {}
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const root = join(homedir(), ".ambox", "agents");
const address = String(request.mailbox || "");
let directory, config;
if (request.action !== "compose") {
  if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]@[a-z0-9.-]+\.[a-z]{2,}$/.test(address)) throw new MailError("Invalid mailbox.");
  directory = resolve(root, address);
  config = JSON.parse(readFileSync(join(directory, "config.json"), "utf8"));
  if (config.email !== address || config.endpoint !== request.endpoint) throw new MailError("Mailbox identity mismatch.");
}
const api = async (path, method = "GET", body) => {
  const response = await fetch(`${config.endpoint}/v1${path}`, { method, headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new MailError(`Email service unavailable (HTTP ${response.status}).`);
  return response.json();
};
const decrypt = (email, full = false) => {
  const key = privateDecrypt({ key: readFileSync(join(directory, "private.pem")), oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(email.wrapped_key, "base64"));
  const open = (value, index) => {
    const nonce = Buffer.alloc(12); nonce[11] = index;
    const data = Buffer.from(value, "base64"), cipher = createDecipheriv("aes-256-gcm", key, nonce);
    cipher.setAuthTag(data.subarray(-16));
    return Buffer.concat([cipher.update(data.subarray(0, -16)), cipher.final()]).toString("utf8");
  };
  return { id: email.id, deliveryId: email.resend_id || "", mailbox: address, from: email.from, to: email.to || [], folder: email.folder, receivedAt: new Date(email.received_at).toISOString(), subject: open(email.subject_encrypted, 1).slice(0, 1000), messageId: email.message_id || "", inReplyTo: email.in_reply_to || "", references: email.references || "", autoSubmitted: email.auto_submitted || "", ...(full ? { body: open(email.body_encrypted, 2).slice(0, 200000), attachments: (email.attachments || []).map(({ filename, content_type, size_bytes }) => ({ filename, type: content_type, bytes: size_bytes })) } : {}) };
};
try {
  let result;
  if (request.action === "poll") {
    const query = new URLSearchParams({ folder: request.folder || "inbox", limit: "50" });
    if (request.since) query.set("since", request.since);
    if (request.cursor) query.set("cursor", request.cursor);
    const response = await api(`/inbox?${query}`);
    const cache = join(directory, "cora-cache");
    mkdirSync(cache, { recursive: true, mode: 0o700 });
    for (const email of response.emails || []) {
      if (!/^msg_[a-zA-Z0-9_-]{1,100}$/.test(email.id || "")) throw new MailError("Invalid email id.");
      const path = join(cache, `${email.id}.json`);
      if (!existsSync(path)) writeFileSync(path, JSON.stringify(email), { mode: 0o600, flag: "wx" });
    }
    result = { emails: (response.emails || []).map((email) => decrypt(email)), hasMore: response.has_more === true, cursor: response.next_cursor || "" };
  } else if (request.action === "read") {
    if (!/^msg_[a-zA-Z0-9_-]{1,100}$/.test(request.id || "")) throw new MailError("Invalid email id.");
    const path = join(directory, "cora-cache", `${request.id}.json`);
    result = decrypt(existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : await api(`/emails/${encodeURIComponent(request.id)}`), true);
  } else if (request.action === "webhook") {
    result = await api("/webhook", "PUT", { url: request.url, secret: request.secret });
  } else if (request.action === "draft" || request.action === "readDraft") {
    const drafts = join(directory, "drafts");
    mkdirSync(drafts, { recursive: true, mode: 0o700 });
    const id = request.action === "draft" ? `draft_${randomBytes(12).toString("hex")}` : String(request.id);
    if (!/^draft_[a-f0-9]{24}$/.test(id)) throw new MailError("Invalid draft.");
    if (request.action === "draft") writeFileSync(join(drafts, `${id}.json`), JSON.stringify(request.message), { mode: 0o600, flag: "wx" });
    result = request.action === "draft" ? { id } : { id, ...JSON.parse(readFileSync(join(drafts, `${id}.json`), "utf8")) };
  } else if (request.action === "send") {
    result = await api("/send", "POST", request.message);
  } else if (request.action === "compose") {
    const library = join(homedir(), ".local", "lib", "cora-mail");
    mkdirSync(join(library, "signature_assets"), { recursive: true, mode: 0o700 });
    for (const [name, data] of Object.entries(request.files || {})) {
      if (!/^(milo_(compose|signature)\.py|signature_assets\/(Geist-(Regular|SemiBold)\.ttf|OFL\.txt))$/.test(name)) throw new MailError("Invalid mail renderer file.");
      writeFileSync(join(library, name), Buffer.from(data, "base64"), { mode: 0o600 });
    }
    const rendered = spawnSync("python3", [join(library, "milo_compose.py")], { input: JSON.stringify(request.compose), maxBuffer: 2 * 1024 * 1024, timeout: 20000 });
    if (rendered.status !== 0) throw new MailError("Email signature renderer unavailable.");
    result = JSON.parse(rendered.stdout.toString("utf8"));
  } else throw new MailError("Unknown email operation.");
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stderr.write(error instanceof MailError ? error.message : "Email operation failed; check the mailbox connection.");
  process.exitCode = 1;
}
