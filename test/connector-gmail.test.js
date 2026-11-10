import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { GoogleConnectorBroker } from "../cloud/src/google-connector.js";
import { createHash } from "node:crypto";
import { GMAIL_SCOPES, GoogleConnector, htmlText } from "../src/connectors/google.js";

const b64 = (value) => Buffer.from(value).toString("base64url");
const FULL = `${GMAIL_SCOPES.send} ${GMAIL_SCOPES.compose} ${GMAIL_SCOPES.modify}`;

const MESSAGE = {
  id: "m1", threadId: "t1", labelIds: ["INBOX", "UNREAD", "Label_7"], snippet: "Ciao &amp; grazie",
  payload: { mimeType: "multipart/mixed", headers: [
    { name: "From", value: "Anna Rossi <anna@acme.it>" }, { name: "Reply-To", value: "desk@acme.it" }, { name: "To", value: "seb@dopamina.it, luca@acme.it" },
    { name: "Cc", value: "\"Bianchi, Marco\" <marco@acme.it>" }, { name: "Subject", value: "Preventivo" }, { name: "Date", value: "Tue, 10 Nov 2026 10:00:00 +0100" },
    { name: "Message-ID", value: "<abc@acme.it>" }, { name: "References", value: "<root@acme.it>" }],
  parts: [
    { mimeType: "multipart/alternative", parts: [{ mimeType: "text/html", body: { data: b64("<p>Ecco il <b>preventivo</b>.</p><p>Link: <a href=\"https://acme.it/x\">qui</a></p><style>p{}</style>") } }] },
    { mimeType: "application/pdf", filename: "preventivo.pdf", body: { attachmentId: "att1", size: 9 } },
  ] },
};

async function world(t) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url, "http://x"), path = url.pathname.replace(/^\/gmail/, "");
    const body = raw && req.headers["content-type"]?.startsWith("application/json") ? JSON.parse(raw) : raw;
    calls.push({ method: req.method, path, query: url.searchParams, body, auth: req.headers.authorization });
    const send = (status, data) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
    if (req.headers.authorization !== "Bearer access-full" && req.headers.authorization !== "Bearer access-send") return send(401, {});
    if (path === "/messages" && req.method === "GET") return send(200, { messages: [{ id: "m1", threadId: "t1" }], nextPageToken: "p2", resultSizeEstimate: 1 });
    if (path === "/messages/m1" && req.method === "GET") return send(200, MESSAGE);
    if (path === "/messages/forbidden") return send(403, { error: { message: "Request had insufficient authentication scopes." } });
    if (path === "/threads/t1" && req.method === "GET") return send(200, { id: "t1", messages: [MESSAGE] });
    if (path === "/messages/m1/attachments/att1") return send(200, { data: b64("PDF-BYTES"), size: 9 });
    if (path === "/messages/send") return send(200, { id: `sent${calls.length}`, threadId: body.threadId || "tnew" });
    if (path === "/labels" && req.method === "GET") return send(200, { labels: [{ id: "INBOX", name: "INBOX", type: "system" }, { id: "Label_7", name: "Clienti", type: "user" }] });
    if (path === "/labels" && req.method === "POST") return send(200, { id: "Label_9", name: body.name });
    if (/^\/(messages\/batchModify|threads\/t1\/(modify|trash)|messages\/m1\/(trash|untrash))$/.test(path)) return send(path.includes("batchModify") ? 204 : 200, {});
    if (path === "/drafts" && req.method === "POST") return send(200, { id: "d1", message: { id: "md1", threadId: body.message.threadId || "tdraft" } });
    if (path === "/drafts" && req.method === "GET") return send(200, { drafts: [{ id: "d1" }] });
    if (path === "/drafts/d1" && req.method === "GET") return send(200, { id: "d1", message: MESSAGE });
    if (path === "/drafts/d1" && req.method === "DELETE") { res.writeHead(204); return res.end(); }
    if (path === "/drafts/send") return send(200, { id: "msent", threadId: "t1" });
    if (path === "/settings/filters") return send(200, { filter: [] });
    return send(404, { error: { message: "not found" } });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const values = { googleConnectors: [
    { id: "gc_full", email: "seb@dopamina.it", scope: FULL, agents: ["nico"], disconnected: false },
    { id: "gc_send", email: "info@dopamina.it", scope: GMAIL_SCOPES.send, agents: ["nico", "vera"], disconnected: false },
  ] };
  const store = { value: (key, fallback) => values[key] ?? fallback, setValue: (key, value) => { values[key] = value; }, agent: (id) => ({ id }), agents: () => [] };
  const google = new GoogleConnector({ store, broker: "http://broker", space: "s", storeSecret: async () => {}, tokenFor: () => "", api: `http://127.0.0.1:${server.address().port}/gmail` });
  google.token = async (connection) => (connection.id === "gc_full" ? "access-full" : "access-send");
  const files = new Map([["/home/agent/work/report.pdf", Buffer.from("%PDF-1.4 report")]]), written = new Map();
  const io = { readFile: async (path) => { if (!files.has(path)) throw new Error("missing"); return files.get(path); }, writeFile: async (path, bytes) => { written.set(path, Buffer.from(bytes)); } };
  const run = async (agent, name, args) => {
    const answer = (await google.runTool({ id: agent, name: agent === "nico" ? "Nico" : "Vera" }, name, args, io)).text;
    return answer.startsWith("error:") ? answer : JSON.parse(answer);
  };
  const sentRaw = () => Buffer.from(calls.filter((call) => call.path === "/messages/send").at(-1).body.raw, "base64url").toString("utf8");
  return { calls, google, run, written, sentRaw };
}

test("Gmail tools appear by what each account granted: reading only where Google allowed it", async (t) => {
  const { google } = await world(t);
  const names = (agent) => google.toolsFor({ id: agent }).map((tool) => tool.name);
  assert.equal(names("nico").length, 15);
  assert.deepEqual(names("vera"), ["gmail_accounts", "gmail_send", "gmail_reply"]);
  assert.deepEqual(names("orca"), []);
  const search = google.toolsFor({ id: "nico" }).find((tool) => tool.name === "gmail_search");
  assert.match(search.description, /Only seb@dopamina\.it allow it/);
  assert.equal(search.parameters.type, "object");
});

test("gmail_send builds a real MIME message with UTF-8 subject, Bcc and an attachment from the agent's computer", async (t) => {
  const w = await world(t);
  assert.deepEqual(await w.run("nico", "gmail_accounts", {}), [{ id: "gc_full", email: "seb@dopamina.it", can: ["send", "draft", "read", "change"] }, { id: "gc_send", email: "info@dopamina.it", can: ["send"] }]);
  assert.match(await w.run("nico", "gmail_send", { to: ["a@b.it"], subject: "x", body_text: "y" }), /from is one of seb@dopamina\.it, info@dopamina\.it/);
  const sent = await w.run("nico", "gmail_send", { from: "info@dopamina.it", to: ["Anna <anna@acme.it>"], cc: ["luca@acme.it"], bcc: ["archivio@dopamina.it"], subject: "Città è pronta", body_text: "Ciao\nAnna", attachments: ["/home/agent/work/report.pdf"] });
  assert.equal(sent.sent, true);
  assert.equal(w.calls.at(-1).auth, "Bearer access-send");
  const raw = w.sentRaw();
  assert.match(raw, /^From: Nico <info@dopamina\.it>/m);
  assert.match(raw, /^To: Anna <anna@acme\.it>/m);
  assert.match(raw, /^Bcc: archivio@dopamina\.it/m);
  assert.match(raw, new RegExp(`^Subject: =\\?UTF-8\\?B\\?${Buffer.from("Città è pronta").toString("base64").replace(/[+/=]/g, (c) => `\\${c}`)}\\?=`, "m"));
  assert.match(raw, /multipart\/mixed/);
  assert.match(raw, /Content-Disposition: attachment; filename="report\.pdf"/);
  assert.ok(raw.includes(Buffer.from("%PDF-1.4 report").toString("base64")));
  assert.ok(raw.includes(Buffer.from("Ciao<br>Anna").toString("base64")));
  assert.match(await w.run("nico", "gmail_send", { from: "info@dopamina.it", to: ["not an address"], subject: "x", body_text: "y" }), /not an email address/);
  assert.match(await w.run("nico", "gmail_send", { from: "info@dopamina.it", to: ["a@b.it"], subject: "x", body_text: "y", attachments: ["/etc/passwd/../x"] }), /error: path is the absolute path/);
});

test("gmail_search, gmail_read_thread and gmail_read_message give compact, readable mail", async (t) => {
  const w = await world(t);
  const found = await w.run("nico", "gmail_search", { query: "from:anna@acme.it is:unread", label: "Clienti", limit: 5 });
  const list = w.calls.find((call) => call.path === "/messages" && call.method === "GET");
  assert.equal(list.query.get("q"), "from:anna@acme.it is:unread");
  assert.deepEqual(list.query.getAll("labelIds"), ["Label_7"]);
  assert.equal(list.query.get("maxResults"), "5");
  assert.deepEqual(found.messages[0], { id: "m1", thread: "t1", from: "Anna Rossi <anna@acme.it>", to: "seb@dopamina.it, luca@acme.it", cc: "\"Bianchi, Marco\" <marco@acme.it>", subject: "Preventivo", date: "Tue, 10 Nov 2026 10:00:00 +0100", snippet: "Ciao & grazie", unread: true, labels: ["INBOX", "UNREAD", "Label_7"] });
  assert.equal(found.next_page, "p2");
  const thread = await w.run("nico", "gmail_read_thread", { thread: "t1" });
  assert.equal(thread.messages[0].text, "Ecco il preventivo.\nLink: qui (https://acme.it/x)");
  assert.deepEqual(thread.messages[0].attachments, [{ id: "att1", filename: "preventivo.pdf", type: "application/pdf", bytes: 9 }]);
  const message = await w.run("nico", "gmail_read_message", { message: "m1", max_chars: 5 });
  assert.equal(message.message_id, "<abc@acme.it>");
  assert.match(message.text, /^Ecco \n\[cut at 5 of/);
  assert.match(await w.run("nico", "gmail_read_message", { message: "../x" }), /Gmail id/);
  assert.match(await w.run("vera", "gmail_read_message", { message: "m1" }), /from is one of info@dopamina\.it/);
  assert.match(await w.run("vera", "gmail_read_message", { from: "info@dopamina.it", message: "m1" }), /cannot read the mailbox: Google granted it only send; the owner reconnects it/);
  assert.match(await w.run("nico", "gmail_read_message", { message: "forbidden" }), /did not grant this to Cora/);
});

test("gmail_download_attachment saves the attachment on the agent's computer", async (t) => {
  const w = await world(t);
  const saved = await w.run("nico", "gmail_download_attachment", { message: "m1", attachment: "preventivo" });
  assert.deepEqual(saved, { saved: "/home/agent/work/gmail/m1/preventivo.pdf", filename: "preventivo.pdf", type: "application/pdf", bytes: 9 });
  assert.equal(w.written.get(saved.saved).toString(), "PDF-BYTES");
  assert.match(await w.run("nico", "gmail_download_attachment", { message: "m1", attachment: "preventivo.pdf", path: "/etc/x" }), /inside \/home\/agent\/work/);
  assert.match(await w.run("nico", "gmail_download_attachment", { message: "m1", attachment: "fattura" }), /it has: preventivo\.pdf/);
});

test("gmail_reply answers in the thread; reply_all copies the others but never the account itself", async (t) => {
  const w = await world(t);
  const reply = await w.run("nico", "gmail_reply", { message: "m1", reply_all: true, body_text: "Grazie" });
  assert.equal(reply.thread, "t1");
  const send = w.calls.filter((call) => call.path === "/messages/send").at(-1);
  assert.equal(send.body.threadId, "t1");
  const raw = w.sentRaw();
  assert.match(raw, /^To: desk@acme\.it/m);
  assert.match(raw, /^Cc: luca@acme\.it, "Bianchi, Marco" <marco@acme\.it>/m);
  assert.doesNotMatch(raw, /^Cc:.*seb@dopamina\.it/m);
  assert.match(raw, /^Subject: Re: Preventivo/m);
  assert.match(raw, /^In-Reply-To: <abc@acme\.it>/m);
  assert.match(raw, /^References: <root@acme\.it> <abc@acme\.it>/m);
  assert.match(await w.run("vera", "gmail_reply", { message: "m1", body_text: "x" }), /can only send: give to, subject, in_reply_to and thread/);
  const plain = await w.run("vera", "gmail_reply", { in_reply_to: "<abc@acme.it>", thread: "t1", to: ["anna@acme.it"], subject: "Re: Preventivo", body_text: "ok" });
  assert.equal(plain.thread, "t1");
});

test("gmail_modify marks, archives, labels and trashes; labels and drafts work end to end", async (t) => {
  const w = await world(t);
  const changed = await w.run("nico", "gmail_modify", { messages: ["m1"], read: true, archive: true, add_labels: ["Clienti", "starred"] });
  assert.deepEqual(changed, { changed: { messages: 1 }, added: ["Label_7", "STARRED"], removed: ["UNREAD", "INBOX"] });
  assert.deepEqual(w.calls.find((call) => call.path === "/messages/batchModify").body, { ids: ["m1"], addLabelIds: ["Label_7", "STARRED"], removeLabelIds: ["UNREAD", "INBOX"] });
  assert.deepEqual(await w.run("nico", "gmail_modify", { thread: "t1", trash: true }), { changed: { thread: "t1" }, trashed: true });
  assert.match(await w.run("nico", "gmail_modify", { messages: ["m1"], add_labels: ["Fornitori"] }), /no label named "Fornitori"/);
  assert.match(await w.run("nico", "gmail_modify", { messages: ["m1"] }), /say what to change/);
  assert.deepEqual((await w.run("nico", "gmail_list_labels", {})).map((label) => label.name), ["INBOX", "Clienti"]);
  assert.deepEqual(await w.run("nico", "gmail_create_label", { name: "Cora/Test" }), { id: "Label_9", name: "Cora/Test" });
  const draft = await w.run("nico", "gmail_create_draft", { message: "m1", body_html: "<p>Bozza</p>" });
  assert.deepEqual(draft, { draft: "d1", message: "md1", thread: "t1", to: ["desk@acme.it"], subject: "Re: Preventivo" });
  const draftRaw = Buffer.from(w.calls.find((call) => call.path === "/drafts" && call.method === "POST").body.message.raw, "base64url").toString("utf8");
  assert.match(draftRaw, /^In-Reply-To: <abc@acme\.it>/m);
  assert.equal((await w.run("nico", "gmail_list_drafts", {}))[0].draft, "d1");
  assert.deepEqual(await w.run("nico", "gmail_send_draft", { draft: "d1" }), { sent: true, from: "seb@dopamina.it", message: "msent", thread: "t1" });
  assert.deepEqual(await w.run("nico", "gmail_delete_draft", { draft: "d1" }), { deleted: true });
  assert.deepEqual(await w.run("nico", "gmail_api", { path: "/settings/filters" }), { filter: [] });
  assert.match(await w.run("nico", "gmail_api", { path: "https://evil.example/x" }), /Gmail API path/);
});

test("the email channel still sends through a Google account with the same checks", async (t) => {
  const w = await world(t);
  const sent = await w.google.send({ id: "nico", name: "Nico" }, "gc_send", { to: ["anna@acme.it"], subject: "Ciao", body_html: "<p>Ciao</p>", body_text: "Ciao", in_reply_to: "<abc@acme.it>" });
  assert.equal(sent.email, "info@dopamina.it");
  assert.match(w.sentRaw(), /^In-Reply-To: <abc@acme\.it>/m);
  await assert.rejects(w.google.send({ id: "orca", name: "Orca" }, "gc_send", { to: ["a@b.it"], subject: "x", body_text: "y" }), /non è autorizzato/);
  assert.equal(htmlText("a&nbsp;&#232;<br>b"), "a è\nb");
});

test("the broker asks Google for send only, or for the whole mailbox when the space asks; the account keeps what Google granted", async (t) => {
  const google = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.url === "/token") return res.end(JSON.stringify({ access_token: "a", refresh_token: "r", scope: `openid email ${GMAIL_SCOPES.send} ${GMAIL_SCOPES.modify}` }));
    res.end(JSON.stringify({ sub: "1", email: "seb@dopamina.it", email_verified: true }));
  });
  await new Promise((resolve) => google.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { google.closeAllConnections(); google.close(resolve); }));
  const base = `http://127.0.0.1:${google.address().port}`;
  const broker = new GoogleConnectorBroker({ origin: "https://connect.example", key: "k".repeat(32), clientSecret: "s", spaceOrigin: () => "https://space.example", endpoints: { authorize: `${base}/authorize`, token: `${base}/token`, userinfo: `${base}/userinfo` } });
  const verifier = "v".repeat(43), challenge = createHash("sha256").update(verifier).digest("base64url");
  const scopeOf = (access) => new URL(broker.start({ space: "s", nonce: "n".repeat(43), challenge, ...(access ? { access } : {}) })).searchParams.get("scope");
  assert.equal(scopeOf(), `openid email ${GMAIL_SCOPES.send}`);
  assert.equal(scopeOf("mail"), `openid email ${GMAIL_SCOPES.send} ${GMAIL_SCOPES.compose} ${GMAIL_SCOPES.modify}`);
  assert.throws(() => scopeOf("everything"), /Invalid connector request/);
  const mail = new URL(broker.start({ space: "s", nonce: "n".repeat(43), challenge, access: "mail" })).searchParams.get("state");
  assert.equal((await broker.exchange({ state: mail, code: "c", verifier })).scope, `${GMAIL_SCOPES.send} ${GMAIL_SCOPES.modify}`);
  const send = new URL(broker.start({ space: "s", nonce: "m".repeat(43), challenge })).searchParams.get("state");
  assert.equal((await broker.exchange({ state: send, code: "c", verifier })).scope, GMAIL_SCOPES.send);
});

test("a space set to mail access asks the broker for the whole mailbox, a default space for sending only", () => {
  const store = { value: () => [], records: () => [] };
  const begin = (access) => new URL(new GoogleConnector({ store, broker: "https://broker.test", space: "s", access }).begin({ id: "u" }).url).searchParams.get("access");
  assert.equal(begin("mail"), "mail");
  assert.equal(begin(undefined), null);
  assert.equal(begin("everything"), null);
});
