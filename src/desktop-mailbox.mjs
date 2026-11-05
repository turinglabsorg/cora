import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

class MailboxError extends Error {}

async function provision() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const { endpoint, domain, local, token, displayName } = request;
  if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(local) || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new MailboxError("invalid mailbox address");
  const root = join(homedir(), ".ambox");
  const directory = join(root, "agents", `${local}@${domain}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const configPath = join(directory, "config.json");
  const keyPath = join(directory, "private.pem");
  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    if (config.email !== `${local}@${domain}` || config.endpoint !== endpoint || !config.apiKey || !existsSync(keyPath)) throw new MailboxError("existing mailbox configuration needs owner review");
    createPrivateKey(readFileSync(keyPath));
    writeFileSync(join(root, "default"), config.agentId, { mode: 0o600 });
    return { email: config.email, agentId: config.agentId, endpoint };
  }
  let privateKey;
  if (existsSync(keyPath)) privateKey = readFileSync(keyPath, "utf8");
  else {
    privateKey = generateKeyPairSync("rsa", { modulusLength: 4096, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } }).privateKey;
    writeFileSync(keyPath, privateKey, { mode: 0o600, flag: "wx" });
  }
  const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" });
  const response = await fetch(`${endpoint}/v1/domains/register`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ agent_id: local, domain, display_name: displayName, public_key_pem: publicKey, recover: true }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new MailboxError(`mailbox registration refused (HTTP ${response.status})`);
  const data = await response.json();
  if (data.email !== `${local}@${domain}` || data.agent_id !== data.email || !data.api_key) throw new MailboxError("invalid mailbox registration response");
  for (const folder of ["inbox", "sent", "important", "transactional", "notification", "spam"]) mkdirSync(join(directory, folder), { recursive: true, mode: 0o700 });
  writeFileSync(`${configPath}.new`, JSON.stringify({ apiKey: data.api_key, agentId: data.agent_id, email: data.email, endpoint }), { mode: 0o600 });
  renameSync(`${configPath}.new`, configPath);
  writeFileSync(join(root, "default"), data.agent_id, { mode: 0o600 });
  return { email: data.email, agentId: data.agent_id, endpoint };
}

try { console.log(JSON.stringify(await provision())); }
catch (error) { console.error(error instanceof MailboxError ? error.message : "Mailbox provisioning failed; check the client configuration and connection."); process.exitCode = 1; }
