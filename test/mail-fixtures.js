import http from "node:http";
import { constants, createCipheriv, createHash, createHmac, publicEncrypt, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startCora } from "../src/main.js";
import { fakeDocker, fakeOllama, tempHome } from "./helpers.js";

export async function mailWorld(t = null) {
  const previousReply = fakeOllama.current;
  const state = { requests: [], messages: new Map(), clientKeys: new Map(), webhooks: new Map(), sent: [], accounts: new Map(), routes: new Map(), relayAccounts: new Map(), mailboxes: new Map(), dnsReady: new Set(), refuse: false, relayRefuse: false };
  const keyA = "re_fixture_account_alpha", keyB = "re_fixture_account_beta";
  for (const key of [keyA, keyB]) state.accounts.set(key, { domains: [], hooks: [] });
  let serial = 0;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://fixture");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
    const token = String(req.headers.authorization || "").replace(/^Bearer /, "");
    state.requests.push({ path: url.pathname, method: req.method, token, body });
    const send = (status, value) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
    let match;
    const mailbox = state.clientKeys.get(token);
    if (mailbox && url.pathname.startsWith("/v1/")) {
      if (state.relayRefuse) return send(503, { error: "fixture-provider-secret-do-not-expose" });
      if (url.pathname === "/v1/webhook") {
        if (body.url) {
          const ping = await fetch(body.url, { method: "POST", body: JSON.stringify({ type: "ping" }), headers: { "Content-Type": "application/json" } });
          if (!ping.ok) return send(422, {});
        }
        state.webhooks.set(mailbox, body); return send(200, { status: "ok" });
      }
      if (url.pathname === "/v1/inbox") {
        let emails = (state.messages.get(mailbox) || []).filter((email) => email.folder === url.searchParams.get("folder") && (!url.searchParams.get("since") || email.received_at >= url.searchParams.get("since")))
          .sort((a,b) => b.received_at.localeCompare(a.received_at) || b.id.localeCompare(a.id));
        if (url.searchParams.get("cursor")) emails = emails.slice(emails.findIndex((email) => email.id === url.searchParams.get("cursor")) + 1);
        const limit = Number(url.searchParams.get("limit")) || 50, has_more = emails.length > limit;
        emails = emails.slice(0,limit);
        return send(200, { emails, has_more, ...(state.legacy ? {} : { next_cursor: has_more ? emails.at(-1).id : "" }) });
      }
      if (url.pathname.startsWith("/v1/emails/")) {
        const email = (state.messages.get(mailbox) || []).find((item) => item.id === decodeURIComponent(url.pathname.slice(11)));
        return send(email ? 200 : 404, email || {});
      }
      if (url.pathname === "/v1/send") {
        state.sent.push({ mailbox, ...body });
        const email = deliver(mailbox, { from: mailbox, subject: body.subject, body: body.body_html || body.body_text, folder: "sent" });
        return send(200, { message_id: email.id, resend_id: `provider-${email.id}`, email: mailbox });
      }
      return send(404, {});
    }
    if (url.pathname.startsWith("/v1/")) {
      if (token !== "fixture-mail-registration") return send(403, { error: "denied" });
      if (state.relayRefuse) return send(503, { error: "fixture-provider-secret-do-not-expose" });
      if ((match = /^\/v1\/domains\/accounts\/(.+)$/.exec(url.pathname))) {
        state.relayAccounts.set(match[1], body); return send(200, { id: match[1] });
      }
      if ((match = /^\/v1\/domains\/routes\/(.+)$/.exec(url.pathname))) {
        const account = state.relayAccounts.get(body.account_id);
        const domain = state.accounts.get(account?.api_key)?.domains.find((item) => item.id === body.resend_id);
        if (!domain || domain.name !== match[1]) return send(409, { error: "wrong account" });
        const route = { ...body, ready: domain.status === "verified" && domain.capabilities.receiving === "enabled" };
        state.routes.set(match[1], route); return send(200, route);
      }
      if (url.pathname === "/v1/domains/register") {
        if (body.domain !== "usecora.space" && (!state.routes.get(body.domain)?.ready || state.routes.get(body.domain)?.namespace !== body.namespace)) return send(400, { error: "unverified domain" });
        const email = `${body.agent_id}@${body.domain}`, existing = state.mailboxes.get(email);
        if (existing && existing !== body.public_key_pem) return send(409, { error: "taken" });
        state.mailboxes.set(email, body.public_key_pem);
        const key = `fixture-mailbox-client-key:${email}`; state.clientKeys.set(key,email);
        return send(200, { email, agent_id: email, api_key: key });
      }
      return send(404, {});
    }
    const account = state.accounts.get(token);
    if (!account || state.refuse) return send(403, { error: "fixture-provider-secret-do-not-expose" });
    if (url.pathname === "/emails" && req.method === "POST") {
      if (!state.providerSent) state.providerSent = [];
      state.providerSent.push({ account: token === keyA ? "alpha" : "beta", ...body });
      return send(200, { id: `provider-${++serial}` });
    }
    if (url.pathname === "/domains" && req.method === "GET") return send(200, { data: account.domains, has_more: false });
    if (url.pathname === "/domains" && req.method === "POST") {
      const domain = { id: `resend-domain-${++serial}`, name: body.name, status: "not_started", capabilities: { sending: "enabled", receiving: "disabled" }, records: [
        { record: "DKIM", name: "resend._domainkey", type: "TXT", value: "p=fixture-public-key", status: "not_started", ttl: "Auto" },
        { record: "SPF", name: "send", type: "TXT", value: "v=spf1 include:amazonses.com ~all", status: "not_started", ttl: "Auto" },
        { record: "Receiving", name: "@", type: "MX", value: "inbound-smtp.eu-west-1.amazonaws.com", priority: 10, status: "not_started", ttl: "Auto" },
      ] };
      account.domains.push(domain); return send(200, domain);
    }
    if ((match = /^\/domains\/([^/]+)(\/verify)?$/.exec(url.pathname))) {
      const domain = account.domains.find((item) => item.id === match[1]);
      if (!domain) return send(404, {});
      if (req.method === "PATCH") Object.assign(domain.capabilities, body.capabilities);
      if (req.method === "GET" && state.domainCheckRefuse) return send(503, { error: "fixture-provider-secret-do-not-expose" });
      if (state.dnsReady.has(domain.name)) { domain.status = "verified"; for (const record of domain.records) record.status = "verified"; }
      if (state.receivingPending?.has(domain.name)) for (const record of domain.records) if (record.record === "Receiving") record.status = "not_started";
      return send(200, domain);
    }
    if (url.pathname === "/webhooks" && req.method === "GET") return send(200, { data: account.hooks, has_more: false });
    if (url.pathname === "/webhooks" && req.method === "POST") {
      const hook = { id: `hook-${++serial}`, ...body, status: "enabled", signing_secret: "whsec_Zml4dHVyZS13ZWJob29r" };
      account.hooks.push(hook); return send(200, hook);
    }
    if ((match = /^\/webhooks\/(.+)$/.exec(url.pathname))) {
      const hook = account.hooks.find((item) => item.id === match[1]);
      if (!hook) return send(404, {});
      if (req.method === "PATCH") Object.assign(hook, body);
      return send(200, hook);
    }
    return send(404, {});
  });
  const deliver = (mailbox, { from = "robin+sender@ambox.dev", to = [mailbox], subject = "Fixture subject", body = "Fixture body", folder = "inbox", at = new Date().toISOString(), autoSubmitted = "", messageId = "" } = {}) => {
    const key = randomBytes(32);
    const seal = (text, index) => { const iv = Buffer.alloc(12); iv[11] = index; const cipher = createCipheriv("aes-256-gcm", key, iv); return Buffer.concat([cipher.update(text, "utf8"),cipher.final(),cipher.getAuthTag()]).toString("base64"); };
    const email = { id: `msg_${(++serial).toString(16).padStart(8,"0")}`, from, to, folder, received_at: at, message_id: messageId, auto_submitted: autoSubmitted,
      subject_encrypted: seal(subject,1), body_encrypted: seal(body,2), wrapped_key: publicEncrypt({ key: state.mailboxes.get(mailbox), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },key).toString("base64") };
    if (!state.messages.has(mailbox)) state.messages.set(mailbox,[]);
    state.messages.get(mailbox).push(email);
    return email;
  };
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const home = tempHome();
  const ollama = await fakeOllama(() => ({ content: "PASS" }));
  const vault = new Map();
  const app = startCora({ home, host: "127.0.0.1", port: 0, adminPassword: "fixture-password", sessionKey: "fixture-mail-session", insecureCookies: true,
    discordToken: "", telegramToken: "", slackToken: "", slackAppToken: "", ollamaUrl: ollama.url, ollamaKey: "", orcaKey: "", sonioxKey: "", cloudUrl: "", cloudKey: "", cloudSpace: "", brainDatabaseUrl: "",
    useResidentSubscriptions: false, claudeBin: "/missing/claude", codexBin: "/missing/codex", grokBin: "/missing/grok", museBin: "/missing/muse", hermesBin: "/missing/hermes", deepseekBin: "/missing/dsh",
    botTokenFor: (name) => vault.get(name) || "", storeSecret: async (name, value) => { vault.set(name, value); },
    mailEndpoint: endpoint, resendApi: endpoint, mailDomain: "usecora.space", mailNamespace: "fixture", mailRegistrationToken: "fixture-mail-registration",
    docker: fakeDocker().path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys",
  });
  await app.ready;
  const dockerBin = join(home, "mail-docker.cjs");
  writeFileSync(dockerBin, `#!${process.execPath}\nconst {spawnSync}=require('node:child_process');const {readFileSync,mkdirSync}=require('node:fs');const {join}=require('node:path');const args=process.argv.slice(2),index=args.indexOf('node');if(index<0)process.exit(99);const home=join(${JSON.stringify(home)},'desktops',args[index-1].replace(/[^a-z0-9_-]/gi,''));mkdirSync(home,{recursive:true});const result=spawnSync(${JSON.stringify(process.execPath)},args.slice(index+1),{input:readFileSync(0),env:{HOME:home,PATH:process.env.PATH}});process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exit(result.status??1);\n`);
  chmodSync(dockerBin, 0o755);
  app.boxes.docker = dockerBin;
  app.boxes.ensureNow = async () => ({ exists: true, running: true });
  app.boxes.inspect = async () => ({ exists: true, running: true });
  app.boxes.ensureGitAttribution = async () => {};
  app.boxes.ensureMailRenderer = async () => {};
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Cora": "1" }, body: JSON.stringify({ password: "fixture-password" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  app.store.updateAccessPolicy({ domains: ["example.test"], emails: [] });
  const member = app.store.registerPanelUser({ id: "fixture-member", name: "Member", email: "member@example.test", emailVerified: true, role: "member" });
  const session = randomBytes(32).toString("base64url");
  app.store.createPanelSession(createHash("sha256").update(session).digest("hex"), member.id, Date.now() + 3600000);
  const signature = createHmac("sha256", "fixture-mail-session").update(`session.v2.${session}`).digest("base64url");
  const memberCookie = `cora_session=v2.${session}.${signature}`;
  const call = async (path, { method = "GET", body, auth = true, asMember = false } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(auth ? { Cookie: asMember ? memberCookie : cookie } : {}), "X-Cora": "1", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), headers: response.headers };
  };
  const close = async () => { await app.stop(); await ollama.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); fakeOllama.current = previousReply; };
  t?.after(close);
  return { app, state, vault, keyA, keyB, call, base, home, close, deliver };
}
