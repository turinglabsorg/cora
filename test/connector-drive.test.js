import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { accessScopes, GoogleConnectorBroker } from "../cloud/src/google-connector.js";
import { connectorAccess, GMAIL_SCOPES, GoogleConnector } from "../src/connectors/google.js";
import { DRIVE_SCOPES, fileId } from "../src/connectors/google-drive.js";

const DOC = "application/vnd.google-apps.document", SHEET = "application/vnd.google-apps.spreadsheet", FOLDER = "application/vnd.google-apps.folder";
const FILES = {
  doc1: { id: "doc1", name: "Preventivo Acme", mimeType: DOC, parents: ["fold1"], modifiedTime: "2026-11-13T10:00:00Z", webViewLink: "https://docs.google.com/document/d/doc1/edit", owners: [{ emailAddress: "seb@dopamina.it" }], capabilities: { canEdit: true, canShare: true, canComment: true } },
  sheet1: { id: "sheet1", name: "Budget", mimeType: SHEET, parents: ["root"] },
  pdf1: { id: "pdf1", name: "contratto.pdf", mimeType: "application/pdf", size: "8", parents: ["fold1"] },
  txt1: { id: "txt1", name: "note.md", mimeType: "text/markdown", size: "11", parents: ["fold1"] },
  fold1: { id: "fold1", name: "Clienti", mimeType: FOLDER, parents: ["root"] },
  fold2: { id: "fold2", name: "Archivio", mimeType: FOLDER, parents: ["root"] },
  fold3: { id: "fold3", name: "Archivio", mimeType: FOLDER, parents: ["fold1"] },
  "1AbCdEfGhIjKlMnOpQrStUvWxYz012345": { id: "1AbCdEfGhIjKlMnOpQrStUvWxYz012345", name: "Progetti", mimeType: FOLDER, parents: ["root"] },
};

async function world(t) {
  const calls = [];
  let made = 0;
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url, "http://x"), path = url.pathname;
    const type = req.headers["content-type"] || "";
    const body = raw.length && type.startsWith("application/json") ? JSON.parse(raw.toString("utf8")) : raw;
    calls.push({ method: req.method, path, query: url.searchParams, body, type, headers: req.headers, auth: req.headers.authorization });
    const send = (status, data, headers = {}) => { res.writeHead(status, { "Content-Type": "application/json", ...headers }); res.end(JSON.stringify(data)); };
    const bytes = (data, mime) => { res.writeHead(200, { "Content-Type": mime, "Content-Length": Buffer.byteLength(data) }); res.end(data); };
    if (!["Bearer access-drive", "Bearer access-readonly", "Bearer access-mail"].includes(req.headers.authorization)) return send(401, {});
    if (req.headers.authorization === "Bearer access-readonly" && req.method !== "GET") return send(403, { error: { message: "Request had insufficient authentication scopes.", errors: [{ reason: "insufficientPermissions" }] } });
    if (path === "/upload/drive/v3/files" && req.method === "PUT") return send(200, { id: "big1", name: "big.bin", mimeType: "application/octet-stream", size: String(raw.length) });
    if (path === "/upload/drive/v3/files" && url.searchParams.get("uploadType") === "resumable") return send(200, {}, { Location: `http://127.0.0.1:${server.address().port}/upload/drive/v3/files?uploadType=resumable&upload_id=u1` });
    if (path === "/upload/drive/v3/files" && req.method === "POST") {
      const text = raw.toString("utf8"), metadata = JSON.parse(text.match(/\r\n\r\n(\{.*?\})\r\n--/s)[1]);
      return send(200, { id: `new${++made}`, name: metadata.name, mimeType: metadata.mimeType || "text/plain", parents: metadata.parents || ["root"] });
    }
    if (path === "/upload/drive/v3/files/pdf1" && req.method === "PATCH") return send(200, { ...FILES.pdf1, size: "20" });
    if (path === "/drive/v3/files" && req.method === "GET") {
      const q = url.searchParams.get("q");
      if (q.includes("name='Clienti'")) return send(200, { files: [FILES.fold1] });
      if (q.includes("name='Archivio'")) return send(200, { files: [FILES.fold2, FILES.fold3] });
      if (q.includes("name='Nessuna'")) return send(200, { files: [] });
      if (q.includes("name='abcdefghijklmnopqrstuvwxyz'")) return send(200, { files: [FILES.fold2] });
      return send(200, { files: [FILES.doc1, FILES.pdf1], nextPageToken: "p2" });
    }
    if (path === "/drive/v3/files" && req.method === "POST") return send(200, { id: `new${++made}`, name: body.name, mimeType: body.mimeType, parents: body.parents || ["root"] });
    const file = path.match(/^\/drive\/v3\/files\/([^/]+)$/)?.[1];
    if (file && req.method === "GET") {
      if (url.searchParams.get("alt") === "media") return file === "pdf1" ? bytes("%PDF-1.4", "application/pdf") : bytes("# Note\nciao", "text/markdown");
      return FILES[file] ? send(200, FILES[file]) : send(404, { error: { message: `File not found: ${file}.` } });
    }
    if (file && req.method === "PATCH") return send(200, { ...FILES[file], ...body, parents: url.searchParams.get("addParents") ? [url.searchParams.get("addParents")] : FILES[file].parents });
    const exported = path.match(/^\/drive\/v3\/files\/([^/]+)\/export$/)?.[1];
    if (exported) return bytes(url.searchParams.get("mimeType") === "text/csv" ? "a,b\n1,2" : url.searchParams.get("mimeType") === "text/markdown" ? "# Preventivo\n\nTotale 100 €" : "PDF-EXPORT", url.searchParams.get("mimeType"));
    if (/^\/drive\/v3\/files\/[^/]+\/copy$/.test(path)) return send(200, { id: "copy1", name: body.name || "Copia di Preventivo Acme", mimeType: DOC, parents: body.parents || ["fold1"] });
    if (path === "/drive/v3/files/doc1/permissions" && req.method === "GET") return send(200, { permissions: [{ id: "p0", type: "user", role: "owner", emailAddress: "seb@dopamina.it" }, { id: "p1", type: "user", role: "reader", emailAddress: "anna@acme.it" }, { id: "anyoneWithLink", type: "anyone", role: "reader" }] });
    if (path === "/drive/v3/files/doc1/permissions" && req.method === "POST") return send(200, { id: `perm-${body.type}`, type: body.type, role: body.role, emailAddress: body.emailAddress, domain: body.domain });
    if (/^\/drive\/v3\/files\/doc1\/permissions\/[^/]+$/.test(path) && req.method === "DELETE") { res.writeHead(204); return res.end(); }
    if (path === "/drive/v3/files/doc1/comments" && req.method === "GET") return send(200, { comments: [{ id: "c1", content: "Rivedere il totale", author: { displayName: "Anna", emailAddress: "anna@acme.it" }, quotedFileContent: { value: "Totale 100 €" }, replies: [{ id: "r1", content: "Ok", author: { displayName: "Seb" } }] }, { id: "c2", content: "Vecchio", resolved: true, author: { displayName: "Luca" } }] });
    if (path === "/drive/v3/files/doc1/comments" && req.method === "POST") return send(200, { id: "c3", content: body.content });
    if (path === "/drive/v3/files/doc1/comments/c1/replies" && req.method === "POST") return send(200, { id: "r2", content: body.content, action: body.action });
    if (path === "/drive/v3/drives") return send(200, { drives: [{ id: "sd1", name: "Dopamina" }] });
    if (path === "/drive/v3/about") return send(200, { storageQuota: { limit: "100", usage: "10" } });
    return send(404, { error: { message: "not found" } });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const values = { googleConnectors: [
    { id: "gc_drive", email: "seb@dopamina.it", scope: `${GMAIL_SCOPES.send} ${DRIVE_SCOPES.full}`, agents: ["nico", "ada"], disconnected: false },
    { id: "gc_ro", email: "archivio@dopamina.it", scope: DRIVE_SCOPES.readonly, agents: ["ada", "vera"], disconnected: false },
    { id: "gc_mail", email: "info@dopamina.it", scope: GMAIL_SCOPES.send, agents: ["orca"], disconnected: false },
  ] };
  const store = { value: (key, fallback) => values[key] ?? fallback, setValue: (key, value) => { values[key] = value; }, agent: (id) => ({ id }), agents: () => [] };
  const google = new GoogleConnector({ store, broker: "http://broker", space: "s", storeSecret: async () => {}, tokenFor: () => "", api: `${base}/gmail`, driveApi: `${base}/drive/v3` });
  google.token = async (connection) => ({ gc_drive: "access-drive", gc_ro: "access-readonly", gc_mail: "access-mail" })[connection.id];
  const files = new Map([["/home/agent/work/report.docx", Buffer.from("DOCX-BYTES")], ["/home/agent/work/big.bin", Buffer.alloc(6 * 1024 * 1024, 7)], ["/home/agent/work/v2.pdf", Buffer.from("%PDF-1.4 version two")]]), written = new Map();
  const io = { readFile: async (path) => { if (!files.has(path)) throw new Error("missing"); return files.get(path); }, writeFile: async (path, bytes) => { written.set(path, Buffer.from(bytes)); } };
  const run = async (agent, name, args) => {
    const answer = (await google.runTool({ id: agent, name: agent }, name, args, io)).text;
    return answer.startsWith("error:") ? answer : JSON.parse(answer);
  };
  const last = (predicate) => calls.filter(predicate).at(-1);
  return { calls, google, run, written, last };
}

test("Drive tools appear by what each account granted: reading with drive.readonly, changes only with drive", async (t) => {
  const { google } = await world(t);
  const names = (agent) => google.toolsFor({ id: agent }).map((tool) => tool.name);
  const drive = (agent) => names(agent).filter((name) => name.startsWith("drive_"));
  assert.equal(drive("nico").length, 17);
  assert.deepEqual(drive("vera"), ["drive_search", "drive_get_file", "drive_read_file", "drive_download", "drive_list_permissions", "drive_list_comments", "drive_list_shared_drives", "drive_api"]);
  assert.deepEqual(drive("orca"), []);
  assert.ok(names("orca").includes("gmail_send"));
  const upload = google.toolsFor({ id: "ada" }).find((tool) => tool.name === "drive_upload");
  assert.match(upload.description, /Only seb@dopamina\.it allow it/);
  assert.ok(!google.toolsFor({ id: "ada" }).find((tool) => tool.name === "drive_search").description.includes("Only"));
  for (const tool of google.toolsFor({ id: "nico" })) assert.equal(tool.parameters.type, "object");
});

test("drive_search builds the Drive query from what the agent asked and resolves folders by name", async (t) => {
  const w = await world(t);
  const found = await w.run("nico", "drive_search", { query: "preventivo", type: "doc", folder: "Clienti", modified_after: "2026-11-01", limit: 500 });
  assert.equal(found.account, "seb@dopamina.it");
  assert.equal(found.next_page, "p2");
  assert.deepEqual(found.files[0], { id: "doc1", name: "Preventivo Acme", type: "doc", modified: "2026-11-13T10:00:00Z", folder: "fold1", owner: "seb@dopamina.it", link: "https://docs.google.com/document/d/doc1/edit" });
  const call = w.last((item) => item.path === "/drive/v3/files" && item.query.get("q").includes("fullText"));
  assert.equal(call.query.get("q"), "fullText contains 'preventivo' and mimeType='application/vnd.google-apps.document' and 'fold1' in parents and trashed=false and modifiedTime > '2026-11-01T00:00:00.000Z'");
  assert.equal(call.query.get("pageSize"), "100");
  assert.equal(call.query.get("orderBy"), null);
  assert.equal(call.query.get("supportsAllDrives"), "true");
  assert.equal(call.query.get("includeItemsFromAllDrives"), "true");
  await w.run("nico", "drive_search", { name: "l'offerta", type: "image", starred: true, shared_drive: "sd1", q: "'me' in writers" });
  const second = w.last((item) => item.path === "/drive/v3/files" && item.query.get("q").includes("name contains"));
  assert.equal(second.query.get("q"), "name contains 'l\\'offerta' and mimeType contains 'image/' and starred and trashed=false and ('me' in writers)");
  assert.equal(second.query.get("orderBy"), "modifiedTime desc");
  assert.equal(second.query.get("corpora"), "drive");
  assert.equal(second.query.get("driveId"), "sd1");
  assert.match(await w.run("nico", "drive_search", { folder: "Archivio" }), /more than one folder is named "Archivio": fold2 \(in root\), fold3 \(in fold1\)/);
  assert.match(await w.run("nico", "drive_search", { folder: "Nessuna" }), /no folder named "Nessuna"/);
  assert.match(await w.run("nico", "drive_search", { folder: "https://drive.google.com/drive/folders/doc1" }), /"Preventivo Acme" is not a folder/);
  await w.run("nico", "drive_search", { folder: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345?usp=sharing" });
  assert.match(w.last((item) => item.path === "/drive/v3/files").query.get("q"), /'1AbCdEfGhIjKlMnOpQrStUvWxYz012345' in parents/);
  await w.run("nico", "drive_search", { folder: "abcdefghijklmnopqrstuvwxyz" });
  assert.match(w.last((item) => item.path === "/drive/v3/files" && item.query.get("q").includes("in parents")).query.get("q"), /'fold2' in parents/);
  assert.match(await w.run("nico", "drive_search", { modified_after: "ieri" }), /modified_after is YYYY-MM-DD/);
  assert.match(await w.run("nico", "drive_search", { type: "spreadsheet" }), /type is one of/);
});

test("files are read as text, downloaded and exported to the agent's computer", async (t) => {
  const w = await world(t);
  assert.equal(fileId("https://docs.google.com/document/d/doc1abcdefgh/edit?tab=t.0"), "doc1abcdefgh");
  assert.equal(fileId("https://drive.google.com/open?id=pdf1abcdefgh"), "pdf1abcdefgh");
  const info = await w.run("nico", "drive_get_file", { file: "https://docs.google.com/document/d/doc1/edit" });
  assert.equal(info.id, "doc1");
  assert.equal(info.folder_name, "Clienti");
  assert.deepEqual(info.can, ["edit", "share", "comment"]);
  assert.deepEqual(info.exports, ["pdf", "docx", "odt", "rtf", "txt", "md", "html", "epub"]);
  const doc = await w.run("nico", "drive_read_file", { file: "doc1" });
  assert.deepEqual(doc, { id: "doc1", name: "Preventivo Acme", type: "doc", format: "md", text: "# Preventivo\n\nTotale 100 €" });
  assert.equal(w.last((item) => item.path.endsWith("/export")).query.get("mimeType"), "text/markdown");
  const sheet = await w.run("nico", "drive_read_file", { file: "sheet1" });
  assert.equal(sheet.text, "a,b\n1,2");
  assert.match(sheet.note, /first sheet/);
  assert.equal((await w.run("nico", "drive_read_file", { file: "txt1", max_chars: 6 })).text, "# Note\n[cut at 6 of 11 characters]");
  assert.match(await w.run("nico", "drive_read_file", { file: "pdf1" }), /not text: save it with drive_download/);
  assert.match(await w.run("nico", "drive_read_file", { file: "doc1", format: "pdf" }), /a doc reads as md, txt, html/);
  assert.match(await w.run("nico", "drive_read_file", { file: "fold1" }), /is a folder/);
  assert.match(await w.run("nico", "drive_read_file", { file: "missing1" }), /Google Drive answered 404: File not found/);
  const exported = await w.run("nico", "drive_download", { file: "doc1", format: "docx" });
  assert.deepEqual(exported, { saved: "/home/agent/work/drive/doc1/Preventivo Acme.docx", name: "Preventivo Acme", type: "doc", format: "docx", bytes: 10 });
  assert.equal(w.written.get("/home/agent/work/drive/doc1/Preventivo Acme.docx").toString(), "PDF-EXPORT");
  const pdf = await w.run("nico", "drive_download", { file: "pdf1", path: "/home/agent/work/c.pdf" });
  assert.deepEqual(pdf, { saved: "/home/agent/work/c.pdf", name: "contratto.pdf", type: "application/pdf", bytes: 8 });
  assert.equal(w.written.get("/home/agent/work/c.pdf").toString(), "%PDF-1.4");
  assert.match(await w.run("nico", "drive_download", { file: "pdf1", format: "docx" }), /format applies only to Google/);
  assert.match(await w.run("nico", "drive_download", { file: "pdf1", path: "/etc/passwd" }), /inside \/home\/agent\/work/);
  assert.match(await w.run("nico", "drive_download", { file: "../x" }), /Drive id or link/);
});

test("uploads, new files, folders, copies, moves, new versions and trash", async (t) => {
  const w = await world(t);
  const uploaded = await w.run("nico", "drive_upload", { path: "/home/agent/work/report.docx", folder: "Clienti", convert: true });
  assert.deepEqual(uploaded, { id: "new1", name: "report", type: "doc", folder: "fold1" });
  const multipart = w.last((item) => item.path === "/upload/drive/v3/files" && item.method === "POST");
  assert.equal(multipart.query.get("uploadType"), "multipart");
  assert.match(multipart.type, /^multipart\/related; boundary=cora_/);
  assert.match(multipart.body.toString(), /"mimeType":"application\/vnd\.google-apps\.document","parents":\["fold1"\]/);
  assert.match(multipart.body.toString(), /Content-Type: application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document\r\n\r\nDOCX-BYTES\r\n/);
  const big = await w.run("nico", "drive_upload", { path: "/home/agent/work/big.bin" });
  assert.equal(big.bytes, 6 * 1024 * 1024);
  const session = w.last((item) => item.query.get("uploadType") === "resumable" && item.method === "POST");
  assert.equal(session.headers["x-upload-content-length"], String(6 * 1024 * 1024));
  assert.equal(session.headers["x-upload-content-type"], "application/octet-stream");
  assert.deepEqual(session.body, { name: "big.bin" });
  assert.match(await w.run("nico", "drive_upload", { path: "/home/agent/work/big.bin", convert: true }), /cannot turn big\.bin/);
  assert.match(await w.run("nico", "drive_upload", { path: "/home/agent/work/none.txt" }), /cannot read/);

  const docMade = await w.run("nico", "drive_create_file", { name: "Verbale", type: "doc", content: "# Verbale\n- punto", content_format: "markdown", folder: "root" });
  assert.equal(docMade.type, "doc");
  const docUpload = w.last((item) => item.path === "/upload/drive/v3/files" && item.method === "POST");
  assert.match(docUpload.body.toString(), /"name":"Verbale","mimeType":"application\/vnd\.google-apps\.document","parents":\["root"\]/);
  assert.match(docUpload.body.toString(), /Content-Type: text\/markdown; charset=UTF-8\r\n\r\n# Verbale\n- punto/);
  const empty = await w.run("nico", "drive_create_file", { name: "Deck", type: "slides" });
  assert.equal(empty.type, "slides");
  assert.deepEqual(w.last((item) => item.path === "/drive/v3/files" && item.method === "POST").body, { name: "Deck", mimeType: "application/vnd.google-apps.presentation" });
  await w.run("nico", "drive_create_file", { name: "Budget 2027", type: "sheet", content: "voce,importo\nhosting,10" });
  assert.match(w.last((item) => item.path === "/upload/drive/v3/files").body.toString(), /Content-Type: text\/csv; charset=UTF-8/);
  await w.run("nico", "drive_create_file", { name: "dati.json", type: "text", content: "{}" });
  assert.match(w.last((item) => item.path === "/upload/drive/v3/files").body.toString(), /Content-Type: application\/json; charset=UTF-8/);
  assert.match(await w.run("nico", "drive_create_file", { name: "X", type: "slides", content: "testo" }), /Slides start empty/);
  assert.match(await w.run("nico", "drive_create_file", { name: "X", type: "sheet", content: "a", content_format: "markdown" }), /csv/);

  const folder = await w.run("nico", "drive_create_folder", { name: "Acme 2027", folder: "Clienti" });
  assert.equal(folder.type, "folder");
  assert.deepEqual(w.last((item) => item.path === "/drive/v3/files" && item.method === "POST").body, { name: "Acme 2027", mimeType: FOLDER, parents: ["fold1"] });
  assert.deepEqual(await w.run("nico", "drive_copy_file", { file: "doc1", name: "Preventivo Beta" }), { id: "copy1", name: "Preventivo Beta", type: "doc", folder: "fold1" });

  const moved = await w.run("nico", "drive_update_file", { file: "doc1", name: "Preventivo Acme v2", move_to: "1AbCdEfGhIjKlMnOpQrStUvWxYz012345" });
  assert.equal(moved.name, "Preventivo Acme v2");
  const patch = w.last((item) => item.path === "/drive/v3/files/doc1" && item.method === "PATCH");
  assert.equal(patch.query.get("addParents"), "1AbCdEfGhIjKlMnOpQrStUvWxYz012345");
  assert.equal(patch.query.get("removeParents"), "fold1");
  assert.deepEqual(patch.body, { name: "Preventivo Acme v2" });
  const version = await w.run("nico", "drive_update_file", { file: "pdf1", path: "/home/agent/work/v2.pdf" });
  assert.equal(version.bytes, 20);
  const versionCall = w.last((item) => item.path === "/upload/drive/v3/files/pdf1");
  assert.equal(versionCall.method, "PATCH");
  assert.match(versionCall.body.toString(), /%PDF-1\.4 version two/);
  assert.match(await w.run("nico", "drive_update_file", { file: "doc1" }), /say what to change/);
  assert.match(await w.run("nico", "drive_update_file", { file: "1AbCdEfGhIjKlMnOpQrStUvWxYz012345", move_to: "1AbCdEfGhIjKlMnOpQrStUvWxYz012345" }), /cannot go inside itself/);

  assert.deepEqual(await w.run("nico", "drive_trash", { file: "doc1" }), { id: "doc1", name: "Preventivo Acme", trashed: true });
  assert.deepEqual(w.last((item) => item.path === "/drive/v3/files/doc1" && item.method === "PATCH").body, { trashed: true });
  assert.deepEqual(await w.run("nico", "drive_trash", { file: "doc1", restore: true }), { id: "doc1", name: "Preventivo Acme", trashed: false });
});

test("sharing, unsharing and comments carry only what the agent named", async (t) => {
  const w = await world(t);
  const shared = await w.run("nico", "drive_share", { file: "doc1", role: "commenter", emails: ["Anna@Acme.it"], groups: ["team@acme.it"], domain: "acme.it", anyone: true, message: "Ecco il preventivo" });
  assert.deepEqual(shared.shared.map((item) => item.type), ["user", "group", "domain", "anyone"]);
  const grants = w.calls.filter((item) => item.path === "/drive/v3/files/doc1/permissions" && item.method === "POST");
  assert.deepEqual(grants[0].body, { type: "user", role: "commenter", emailAddress: "anna@acme.it" });
  assert.equal(grants[0].query.get("sendNotificationEmail"), "true");
  assert.equal(grants[0].query.get("emailMessage"), "Ecco il preventivo");
  assert.deepEqual(grants[2].body, { type: "domain", role: "commenter", domain: "acme.it", allowFileDiscovery: false });
  assert.equal(grants[3].query.get("sendNotificationEmail"), null);
  await w.run("nico", "drive_share", { file: "doc1", role: "reader", emails: ["luca@acme.it"], notify: false, message: "x" });
  assert.equal(w.last((item) => item.path === "/drive/v3/files/doc1/permissions" && item.method === "POST").query.get("sendNotificationEmail"), "false");
  assert.equal(w.last((item) => item.path === "/drive/v3/files/doc1/permissions" && item.method === "POST").query.get("emailMessage"), null);
  assert.match(await w.run("nico", "drive_share", { file: "doc1", role: "owner", emails: ["a@b.it"] }), /role is reader, commenter or writer/);
  assert.match(await w.run("nico", "drive_share", { file: "doc1", role: "reader" }), /say whom to share with/);
  assert.match(await w.run("nico", "drive_share", { file: "doc1", role: "reader", emails: ["anna"] }), /not an email address/);
  assert.match(await w.run("nico", "drive_share", { file: "doc1", role: "reader", domain: "gmail" }), /company domain/);

  assert.deepEqual((await w.run("nico", "drive_list_permissions", { file: "doc1" })).map((item) => item.role), ["owner", "reader", "reader"]);
  assert.deepEqual(await w.run("nico", "drive_unshare", { file: "doc1", email: "ANNA@acme.it", anyone: true }), { removed: [{ permission: "p1", type: "user", role: "reader", email: "anna@acme.it" }, { permission: "anyoneWithLink", type: "anyone", role: "reader" }] });
  assert.deepEqual(w.calls.filter((item) => item.method === "DELETE").map((item) => item.path), ["/drive/v3/files/doc1/permissions/p1", "/drive/v3/files/doc1/permissions/anyoneWithLink"]);
  assert.match(await w.run("nico", "drive_unshare", { file: "doc1", email: "seb@dopamina.it" }), /owner's access cannot be removed/);
  assert.match(await w.run("nico", "drive_unshare", { file: "doc1", email: "x@y.it" }), /no such access on this file; it has: seb@dopamina\.it \(owner, p0\)/);

  const comments = await w.run("nico", "drive_list_comments", { file: "doc1" });
  assert.deepEqual(comments, [{ id: "c1", author: "anna@acme.it", text: "Rivedere il totale", about: "Totale 100 €", replies: [{ id: "r1", author: "Seb", text: "Ok" }] }]);
  assert.equal((await w.run("nico", "drive_list_comments", { file: "doc1", resolved: true })).length, 2);
  assert.ok(w.last((item) => item.path === "/drive/v3/files/doc1/comments").query.get("fields").startsWith("comments("));
  assert.deepEqual(await w.run("nico", "drive_comment", { file: "doc1", text: "Totale corretto" }), { comment: "c3" });
  assert.deepEqual(await w.run("nico", "drive_comment", { file: "doc1", text: "Fatto", reply_to: "c1", resolve: true }), { reply: "r2", comment: "c1", resolved: true });
  assert.deepEqual(w.last((item) => item.path.endsWith("/replies")).body, { content: "Fatto", action: "resolve" });
  assert.match(await w.run("nico", "drive_comment", { file: "doc1", text: "x", resolve: true }), /resolve needs reply_to/);
  assert.deepEqual(await w.run("nico", "drive_list_shared_drives", {}), [{ id: "sd1", name: "Dopamina" }]);
  assert.deepEqual(await w.run("nico", "drive_api", { path: "/about", query: { fields: "storageQuota" } }), { storageQuota: { limit: "100", usage: "10" } });
  assert.match(await w.run("nico", "drive_api", { path: "https://evil.example/x" }), /Drive API path/);
  assert.match(await w.run("nico", "drive_api", { path: "/files/pdf1", query: { alt: "media" } }), /drive_download/);
  for (const path of ["/files/pdf1", "/files/trash", "/drives/sd1"]) assert.match(await w.run("nico", "drive_api", { method: "DELETE", path }), /deleting for good is not allowed/);
  assert.equal(w.calls.filter((call) => call.method === "DELETE" && !call.path.includes("/permissions/")).length, 0);
});

test("accounts are chosen by address, refused where Google did not grant the action, and a read-only grant cannot write", async (t) => {
  const w = await world(t);
  assert.match(await w.run("ada", "drive_search", {}), /error: account is one of seb@dopamina\.it, archivio@dopamina\.it/);
  assert.equal((await w.run("ada", "drive_search", { account: "archivio@dopamina.it" })).account, "archivio@dopamina.it");
  assert.equal((await w.run("ada", "drive_search", { account: "gc_drive" })).account, "seb@dopamina.it");
  assert.equal((await w.run("ada", "drive_upload", { path: "/home/agent/work/report.docx" })).id, "new1");
  assert.match(await w.run("ada", "drive_upload", { account: "archivio@dopamina.it", path: "/home/agent/work/report.docx" }), /archivio@dopamina\.it cannot change Google Drive: Google granted it only drive/);
  assert.match(await w.run("vera", "drive_api", { method: "POST", path: "/files", body: { name: "x" } }), /archivio@dopamina\.it did not grant this to Cora: Request had insufficient authentication scopes\.: the owner reconnects it in Connettori and allows Google Drive/);
  assert.match(await w.run("orca", "drive_search", {}), /error: account is one of info@dopamina\.it/);
  assert.match(await w.run("orca", "drive_search", { account: "info@dopamina.it" }), /info@dopamina\.it cannot use Google Drive: Google granted it only send/);
  assert.match(await w.run("nobody", "drive_search", {}), /not authorised on a Google account/);
  const accounts = await w.run("ada", "gmail_accounts", {});
  assert.deepEqual(accounts, [{ id: "gc_drive", email: "seb@dopamina.it", can: ["send", "drive", "drive_write"] }, { id: "gc_ro", email: "archivio@dopamina.it", can: ["drive"] }]);
});

test("the broker asks Google for Drive only when the space asks for it, alone or with the mailbox", async (t) => {
  assert.deepEqual(accessScopes("drive"), [DRIVE_SCOPES.full]);
  assert.deepEqual(accessScopes("mail,drive"), [GMAIL_SCOPES.send, GMAIL_SCOPES.compose, GMAIL_SCOPES.modify, DRIVE_SCOPES.full]);
  assert.deepEqual(accessScopes("send,drive"), [GMAIL_SCOPES.send, DRIVE_SCOPES.full]);
  assert.equal(accessScopes("drive,everything"), null);
  assert.equal(accessScopes("drive,drive,drive,drive"), null);
  const google = http.createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.url === "/token") return res.end(JSON.stringify({ access_token: "a", refresh_token: "r", scope: `openid email ${GMAIL_SCOPES.send} ${DRIVE_SCOPES.full} https://www.googleapis.com/auth/calendar` }));
    res.end(JSON.stringify({ sub: "1", email: "seb@dopamina.it", email_verified: true }));
  });
  await new Promise((resolve) => google.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { google.closeAllConnections(); google.close(resolve); }));
  const base = `http://127.0.0.1:${google.address().port}`;
  const broker = new GoogleConnectorBroker({ origin: "https://connect.example", key: "k".repeat(32), clientSecret: "s", spaceOrigin: () => "https://space.example", endpoints: { authorize: `${base}/authorize`, token: `${base}/token`, userinfo: `${base}/userinfo` } });
  const verifier = "v".repeat(43), challenge = createHash("sha256").update(verifier).digest("base64url");
  const start = (access, nonce = "n") => new URL(broker.start({ space: "s", nonce: nonce.repeat(43), challenge, access }));
  assert.equal(start("mail,drive").searchParams.get("scope"), `openid email ${GMAIL_SCOPES.send} ${GMAIL_SCOPES.compose} ${GMAIL_SCOPES.modify} ${DRIVE_SCOPES.full}`);
  assert.equal(start("drive").searchParams.get("scope"), `openid email ${DRIVE_SCOPES.full}`);
  assert.throws(() => start("mail,photos"), /Invalid connector request/);
  assert.equal((await broker.exchange({ state: start("send,drive").searchParams.get("state"), code: "c", verifier })).scope, `${GMAIL_SCOPES.send} ${DRIVE_SCOPES.full}`);
  assert.equal((await broker.exchange({ state: start("drive", "m").searchParams.get("state"), code: "c", verifier })).scope, DRIVE_SCOPES.full);
  assert.equal((await broker.exchange({ state: start("send", "o").searchParams.get("state"), code: "c", verifier })).scope, GMAIL_SCOPES.send);

  assert.equal(connectorAccess("mail,drive"), "mail,drive");
  assert.equal(connectorAccess("drive, mail, send"), "mail,drive");
  assert.equal(connectorAccess("drive"), "drive");
  assert.equal(connectorAccess("everything"), "send");
  assert.equal(connectorAccess(""), "send");
  const store = { value: () => [] };
  const begin = (access) => new URL(new GoogleConnector({ store, broker: "https://broker.test", space: "s", access }).begin({ id: "u" }).url).searchParams.get("access");
  assert.equal(begin("mail,drive"), "mail,drive");
  assert.equal(begin("send,drive"), "send,drive");
  assert.equal(begin("send"), null);
});
