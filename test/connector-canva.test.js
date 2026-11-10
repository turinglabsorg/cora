import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { canva } from "../src/connectors/canva.js";
import { toolFor } from "../src/connectors/index.js";

const TOKEN = "canva_fixture_access";

/** A small Canva Connect API: designs, folders, assets, templates, comments and jobs that finish on the second poll. */
async function fakeCanva(t) {
  const calls = [], jobs = new Map();
  let serial = 0;
  const design = (id, title) => ({ id, title, urls: { edit_url: `https://www.canva.com/design/${id}/edit`, view_url: `https://www.canva.com/design/${id}/view` }, thumbnail: { url: `https://thumb/${id}` }, page_count: 2 });
  const startJob = (kind, finished) => { const id = `job${++serial}`; jobs.set(id, { kind, polls: 0, finished }); return { job: { id, status: "in_progress" } }; };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url, "http://canva.test");
    const path = url.pathname.replace(/^\/rest\/v1/, "");
    const type = String(req.headers["content-type"] || "");
    const body = type.includes("json") && raw.length ? JSON.parse(raw) : null;
    calls.push({ method: req.method, path, query: Object.fromEntries(url.searchParams), body, headers: req.headers, raw: type.includes("octet") ? raw.toString("latin1") : "" });
    const send = (status, data) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { code: "invalid_access_token", message: "Access token is invalid" });
    let m;
    if (path === "/users/me") return send(200, { team_user: { user_id: "U1", team_id: "T1" } });
    if (path === "/users/me/profile") return send(200, { profile: { display_name: "Seb" } });
    if (path === "/users/me/capabilities") return send(200, { capabilities: ["resize"] });
    if (path === "/designs" && req.method === "GET") return send(200, { items: [design("DAF1", "Reel cover")], continuation: "next1" });
    if (path === "/designs" && req.method === "POST") return send(200, { design: design("DAFNEW", body.title) });
    if ((m = path.match(/^\/designs\/(\w+)\/pages$/))) return send(200, { items: [{ index: 1, thumbnail: { url: "p1" } }, { index: 2, thumbnail: { url: "p2" } }] });
    if ((m = path.match(/^\/designs\/(\w+)\/export-formats$/))) return send(200, { formats: { pdf: {}, png: {}, pptx: {} } });
    if ((m = path.match(/^\/designs\/(\w+)\/comments$/))) return send(200, { thread: { id: "TH1", content: { plaintext: body.message_plain } } });
    if ((m = path.match(/^\/designs\/(\w+)\/comments\/(\w+)\/replies$/)) && req.method === "POST") return send(200, { reply: { id: "R1", content: { plaintext: body.message_plain } } });
    if ((m = path.match(/^\/designs\/(\w+)\/comments\/(\w+)\/replies$/))) return send(200, { items: [{ id: "R1" }] });
    if ((m = path.match(/^\/designs\/(\w+)\/comments\/(\w+)$/))) return send(200, { thread: { id: m[2] } });
    if ((m = path.match(/^\/designs\/(\w+)$/))) return m[1] === "DAF1" ? send(200, { design: design("DAF1", "Reel cover") }) : send(404, { code: "design_not_found", message: `Design ${m[1]} not found` });
    if (path === "/exports") return send(200, startJob("export", body.design_id === "DAFBAD" ? { status: "failed", error: { code: "license_required", message: "Design has premium elements" } } : { status: "success", urls: ["https://export/1.pdf"] }));
    if (path === "/asset-uploads" || path === "/url-asset-uploads") return send(200, startJob("asset", { status: "success", asset: { id: "A1", name: "shot.png", type: "image", thumbnail: { url: "ta" } } }));
    if (path === "/imports" || path === "/url-imports") return send(200, startJob("import", { status: "success", result: { designs: [design("DAFIMP", "Deck")] } }));
    if (path === "/autofills") return send(200, startJob("autofill", { status: "success", result: { type: "create_design", design: design("DAFAUTO", "Filled") } }));
    if (path === "/resizes") return send(200, startJob("resize", { status: "success", result: { design: design("DAFRS", "Story") } }));
    if ((m = path.match(/^\/(exports|asset-uploads|url-asset-uploads|imports|url-imports|autofills|resizes)\/(job\d+)$/))) {
      const job = jobs.get(m[2]);
      job.polls += 1;
      return send(200, { job: job.polls < 2 ? { id: m[2], status: "in_progress" } : { id: m[2], ...job.finished } });
    }
    if ((m = path.match(/^\/assets\/(\w+)$/)) && req.method === "PATCH") return send(200, { asset: { id: m[1], ...body } });
    if ((m = path.match(/^\/assets\/(\w+)$/)) && req.method === "DELETE") return send(204, {});
    if (path === "/folders" && req.method === "POST") return send(200, { folder: { id: "F9", name: body.name } });
    if ((m = path.match(/^\/folders\/(\w+)\/items$/))) return send(200, { items: [{ type: "folder", folder: { id: "F1", name: "Reels" } }, { type: "design", design: design("DAF1", "Reel cover") }, { type: "image", image: { id: "A1", name: "logo" } }] });
    if (path === "/folders/move") return send(200, {});
    if ((m = path.match(/^\/folders\/(\w+)$/)) && req.method === "PATCH") return send(200, { folder: { id: m[1], name: body.name } });
    if ((m = path.match(/^\/folders\/(\w+)$/)) && req.method === "DELETE") return send(204, {});
    if (path === "/brand-templates") return send(403, { code: "permission_denied", message: "Brand templates need Canva Enterprise" });
    return send(404, { code: "not_found", message: `no fixture for ${req.method} ${path}` });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/rest/v1`;
  const request = async (target, { method = "GET", headers = {}, body, raw } = {}) => {
    const response = await fetch(target, { method, headers, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
    let data = null;
    try { data = await response.json(); } catch { data = null; }
    return { status: response.status, data };
  };
  const files = { "/home/agent/work/shot.png": Buffer.from("PNG bytes"), "/home/agent/work/deck.pdf": Buffer.from("%PDF deck") };
  const run = (name, args = {}, token = TOKEN) => toolFor(name).run(args, { ...canva.context({ token, request, api: { canva: base }, record: { account: "Seb" }, readFile: async (path) => { if (!files[path]) throw new Error("missing"); return files[path]; } }), pollMs: 1 });
  const last = (method, path) => [...calls].reverse().find((call) => call.method === method && call.path === path);
  return { run, calls, last, jobs };
}

test("the Canva tools read the account, designs, folders and comments", async (t) => {
  const c = await fakeCanva(t);
  const names = canva.tools.map((tool) => tool.name);
  for (const name of ["canva_me", "canva_list_designs", "canva_get_design", "canva_list_folder", "canva_list_brand_templates", "canva_get_brand_template", "canva_get_comments", "canva_create_design", "canva_export_design", "canva_upload_asset", "canva_import_design", "canva_update_asset", "canva_delete_asset", "canva_create_folder", "canva_update_folder", "canva_delete_folder", "canva_move_item", "canva_autofill", "canva_resize_design", "canva_comment", "canva_api"]) assert.ok(names.includes(name), name);
  assert.equal(names.at(-1), "canva_api", "the generic call comes last, as the fallback");
  assert.match(canva.tools[0].description({ account: "Seb" }), /Canva, account Seb/);

  assert.deepEqual(await c.run("canva_me"), { user_id: "U1", team_id: "T1", name: "Seb", capabilities: ["resize"] });
  const designs = await c.run("canva_list_designs", { query: "reel", ownership: "owned", limit: 500 });
  assert.deepEqual(c.last("GET", "/designs").query, { query: "reel", ownership: "owned", limit: "100" });
  assert.equal(designs.continuation, "next1");
  assert.equal(designs.designs[0].edit_url, "https://www.canva.com/design/DAF1/edit");
  const one = await c.run("canva_get_design", { design: "https://www.canva.com/design/DAF1/abc/edit" });
  assert.deepEqual([one.id, one.pages_detail.length, one.export_formats], ["DAF1", 2, ["pdf", "png", "pptx"]], "the id comes out of the URL");
  assert.match(String(await c.run("canva_get_design", { design: "DAFX" }).catch((error) => error.message)), /Canva answered 404: Design DAFX not found/);
  assert.match(String(await c.run("canva_get_design", { design: "../users" }).catch((error) => error.message)), /design is a design id/);

  const items = await c.run("canva_list_folder", { kinds: ["design", "folder"] });
  assert.equal(c.last("GET", "/folders/root/items").query.item_types, "design,folder", "Projects by default");
  assert.deepEqual(items.items.map((item) => [item.type, item.id]), [["folder", "F1"], ["design", "DAF1"], ["image", "A1"]]);
  assert.match(String(await c.run("canva_list_brand_templates").catch((error) => error.message)), /403: Brand templates need Canva Enterprise.*Enterprise/);
  assert.deepEqual(await c.run("canva_get_comments", { design: "DAF1", thread: "TH1" }), { thread: { id: "TH1" }, replies: [{ id: "R1" }] });
  assert.match(String(await c.run("canva_me", {}, "expired").catch((error) => error.message)), /authorises Canva again/);
});

test("the Canva tools create, export, upload, import and organise, waiting for Canva's jobs", async (t) => {
  const c = await fakeCanva(t);
  const created = await c.run("canva_create_design", { title: "Story", width: 1080, height: 1920, asset: "A1" });
  assert.deepEqual(c.last("POST", "/designs").body, { design_type: { type: "custom", width: 1080, height: 1920 }, title: "Story", asset_id: "A1" });
  assert.equal(created.id, "DAFNEW");
  await c.run("canva_create_design", { title: "Deck" });
  assert.deepEqual(c.last("POST", "/designs").body.design_type, { type: "preset", name: "presentation" });
  assert.match(String(await c.run("canva_create_design", { title: "x", width: 10, height: 10 }).catch((error) => error.message)), /between 40 and 8000/);

  const exported = await c.run("canva_export_design", { design: "DAF1", format: "pdf", pages: [1, 2], quality: "pro", size: "a4" });
  assert.deepEqual(exported, { design: "DAF1", format: "pdf", urls: ["https://export/1.pdf"] }, "waits for the job");
  assert.deepEqual(c.last("POST", "/exports").body, { design_id: "DAF1", format: { type: "pdf", pages: [1, 2], export_quality: "pro", size: "a4" } });
  assert.ok(c.calls.filter((call) => call.path.startsWith("/exports/job")).length >= 2, "it polled until success");
  assert.match(String(await c.run("canva_export_design", { design: "DAFBAD", format: "png" }).catch((error) => error.message)), /could not finish: Design has premium elements/);
  assert.match(String(await c.run("canva_export_design", { design: "DAF1", format: "svg" }).catch((error) => error.message)), /format is one of/);

  const asset = await c.run("canva_upload_asset", { path: "/home/agent/work/shot.png", name: "Café shot" });
  const upload = c.last("POST", "/asset-uploads");
  assert.equal(upload.raw, "PNG bytes");
  assert.equal(upload.headers["content-type"], "application/octet-stream");
  assert.deepEqual(JSON.parse(upload.headers["asset-upload-metadata"]), { name_base64: Buffer.from("Café shot").toString("base64") });
  assert.equal(asset.id, "A1");
  await c.run("canva_upload_asset", { url: "https://example.com/logo.png" });
  assert.deepEqual(c.last("POST", "/url-asset-uploads").body, { name: "logo.png", url: "https://example.com/logo.png" });
  assert.match(String(await c.run("canva_upload_asset", { path: "/home/agent/work/none.png" }).catch((error) => error.message)), /cannot read/);

  const imported = await c.run("canva_import_design", { path: "/home/agent/work/deck.pdf" });
  assert.deepEqual(JSON.parse(c.last("POST", "/imports").headers["import-metadata"]), { title_base64: Buffer.from("deck").toString("base64"), mime_type: "application/pdf" });
  assert.equal(imported.designs[0].id, "DAFIMP");

  assert.deepEqual(await c.run("canva_update_asset", { asset: "A1", name: "Logo", tags: ["brand"] }), { id: "A1", name: "Logo", tags: ["brand"] });
  assert.deepEqual(await c.run("canva_delete_asset", { asset: "A1" }), { deleted: "A1" });
  assert.deepEqual(await c.run("canva_create_folder", { name: "TIA reels" }), { id: "F9", name: "TIA reels" });
  assert.equal(c.last("POST", "/folders").body.parent_folder_id, "root");
  assert.deepEqual(await c.run("canva_update_folder", { folder: "F9", name: "TIA" }), { id: "F9", name: "TIA" });
  assert.deepEqual(await c.run("canva_move_item", { item: "https://www.canva.com/design/DAF1/x/edit", to: "F9" }), { moved: "DAF1", to: "F9" });
  assert.deepEqual(c.last("POST", "/folders/move").body, { item_id: "DAF1", to_folder_id: "F9" });
  assert.deepEqual(await c.run("canva_delete_folder", { folder: "F9" }), { deleted: "F9" });
  assert.match(String(await c.run("canva_delete_folder", { folder: "root" }).catch((error) => error.message)), /Projects cannot be deleted/);

  const filled = await c.run("canva_autofill", { template: "BT1", title: "Filled", fields: { headline: "Ciao", photo: { asset: "A1" } } });
  assert.deepEqual(c.last("POST", "/autofills").body, { brand_template_id: "BT1", title: "Filled", data: { headline: { type: "text", text: "Ciao" }, photo: { type: "image", asset_id: "A1" } } });
  assert.equal(filled.id, "DAFAUTO");
  assert.equal((await c.run("canva_resize_design", { design: "DAF1", width: 1080, height: 1920 })).id, "DAFRS");

  assert.equal((await c.run("canva_comment", { design: "DAF1", message: "Più grande il logo" })).id, "TH1");
  assert.equal((await c.run("canva_comment", { design: "DAF1", thread: "TH1", message: "Fatto" })).id, "R1");
  assert.deepEqual(c.last("POST", "/designs/DAF1/comments/TH1/replies").body, { message_plain: "Fatto" });

  assert.equal((await c.run("canva_api", { path: "/designs?limit=5" })).continuation, "next1");
  assert.equal(c.last("GET", "/designs").query.limit, "5");
  assert.match(String(await c.run("canva_api", { path: "/oauth/token", method: "POST" }).catch((error) => error.message)), /no \/oauth/);
});
