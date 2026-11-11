import { count, defined, fail, FILE_PARAMS, list, localFile, text } from "./tooling.js";

/**
 * Canva: the Connect API has no personal tokens, only an integration that the
 * owner registers on canva.com/developers. The card keeps its client ID and
 * secret, then the owner authorises it with their Canva account (OAuth with
 * PKCE). Cora keeps the tokens in the vault, renews the access token when it
 * expires, and gives the authorised agents one tool per action. Long operations
 * (exports, uploads, imports, autofills, resizes) are jobs: the tools wait for them.
 */
const METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);

const SCOPES = [
  "profile:read",
  "design:meta:read", "design:content:read", "design:content:write",
  "asset:read", "asset:write",
  "folder:read", "folder:write",
  "brandtemplate:meta:read", "brandtemplate:content:read",
  "comment:read", "comment:write",
];

const DESIGN = { type: "string", description: "design id, or its Canva edit/view URL" };
const FOLDER = { type: "string", description: "folder id; \"root\" is Projects" };
const PAGE = { continuation: { type: "string", description: "the continuation of the previous answer, for the next page" }, limit: { type: "number", description: "default 25, at most 100" } };
const PRESETS = ["doc", "whiteboard", "presentation"];
const EXPORTS = ["pdf", "jpg", "png", "gif", "pptx", "mp4"];

/** The Canva REST client a tool works with: Cora's token and the API from api. */
function client({ token, request, api }) {
  const call = async (method, path, { query, body, raw, headers = {}, timeout } = {}) => {
    const url = new URL(`${api.canva}${path}`);
    for (const [key, value] of Object.entries(query || {})) if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    const { status, data } = await request(url.href, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body, raw, timeout });
    if (status === 401) fail("Canva refuses the authorisation: the owner authorises Canva again in Connettori");
    const message = data?.message ? `: ${String(data.message).slice(0, 1500)}` : data?.code ? `: ${data.code}` : "";
    if (status === 403) fail(`Canva answered 403${message}: the integration may lack the scope, or the account the plan (brand templates and autofill need Canva Enterprise, resize needs a paid plan)`);
    if (status === 404) fail(`Canva answered 404${message}`);
    if (status === 429) fail("Canva limits the calls: try again in a minute");
    if (status >= 400 || !status) fail(`Canva answered ${status}${message}`);
    return data ?? {};
  };
  return { call };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Starts a Canva job and waits for it: answers the finished job, or explains its failure. */
async function job(ctx, start, poll) {
  let current = (await start()).job || fail("Canva did not start the job");
  const wait = ctx.pollMs ?? 1500, deadline = Date.now() + (ctx.jobTimeout ?? 120000);
  while (current.status === "in_progress") {
    if (Date.now() > deadline) fail(`the Canva job ${current.id} is still running: check it later with canva_api GET ${poll}/${current.id}`);
    await sleep(wait);
    current = (await ctx.canva.call("GET", `${poll}/${encodeURIComponent(current.id)}`)).job || current;
  }
  if (current.status === "failed") fail(`Canva could not finish: ${current.error?.message || current.error?.code || "the job failed"}`);
  return current;
}

const designId = (value) => {
  const raw = text(value, 500);
  if (!raw) fail("design is required");
  const fromUrl = raw.match(/canva\.com\/design\/([A-Za-z0-9_-]+)/);
  const id = fromUrl ? fromUrl[1] : raw;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) fail("design is a design id such as DAFxyz, or its Canva URL");
  return id;
};
const idOf = (value, what) => {
  const id = text(value, 200);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) fail(`${what} is a Canva id`);
  return id;
};
const b64 = (value) => Buffer.from(String(value), "utf8").toString("base64");

const designSummary = (design) => design && defined({ id: design.id, title: design.title, edit_url: design.urls?.edit_url, view_url: design.urls?.view_url, thumbnail: design.thumbnail?.url, pages: design.page_count, owner: design.owner?.user_id, created_at: design.created_at, updated_at: design.updated_at });

/** A design type: a preset (doc, whiteboard, presentation) or a custom size in pixels. */
const designType = (args) => {
  if (args.width || args.height) {
    const width = Math.round(Number(args.width)), height = Math.round(Number(args.height));
    if (!(width >= 40 && width <= 8000 && height >= 40 && height <= 8000)) fail("width and height are pixels between 40 and 8000");
    return { type: "custom", width, height };
  }
  const preset = text(args.preset, 40).toLowerCase() || "presentation";
  if (!PRESETS.includes(preset)) fail("preset is doc, whiteboard or presentation, or give width and height");
  return { type: "preset", name: preset };
};

const TOOLS = [
  {
    name: "canva_me",
    description: (record) => `Canva${record.account ? `, account ${record.account}` : ""}. Start here: who the authorisation acts as, its team and what the plan allows (autofill, brand templates, resize). Cora adds and renews the token for every Canva tool; you never see it.`,
    parameters: { type: "object", properties: {} },
    async run(_args, ctx) {
      const [me, profile, capabilities] = await Promise.all([ctx.canva.call("GET", "/users/me"), ctx.canva.call("GET", "/users/me/profile"), ctx.canva.call("GET", "/users/me/capabilities").catch(() => ({}))]);
      return defined({ user_id: me.team_user?.user_id, team_id: me.team_user?.team_id, name: profile.profile?.display_name, capabilities: capabilities.capabilities });
    },
  },
  {
    name: "canva_list_designs",
    description: "Canva: designs the account can see, by search text, ownership and sort, with edit and view URLs and thumbnails.",
    parameters: { type: "object", properties: { query: { type: "string" }, ownership: { type: "string", enum: ["any", "owned", "shared"] }, sort_by: { type: "string", enum: ["relevance", "modified_descending", "modified_ascending", "title_descending", "title_ascending"] }, ...PAGE } },
    async run(args, ctx) {
      const data = await ctx.canva.call("GET", "/designs", { query: { query: text(args.query, 255) || undefined, ownership: args.ownership, sort_by: args.sort_by, continuation: args.continuation, limit: count(args.limit, 25, 100) } });
      return defined({ designs: (data.items || []).map(designSummary), continuation: data.continuation });
    },
  },
  {
    name: "canva_get_design",
    description: "Canva: one design with its URLs, its pages (thumbnails) and the formats it can be exported to.",
    parameters: { type: "object", properties: { design: DESIGN }, required: ["design"] },
    async run(args, ctx) {
      const id = designId(args.design);
      const [design, pages, formats] = await Promise.all([ctx.canva.call("GET", `/designs/${id}`), ctx.canva.call("GET", `/designs/${id}/pages`, { query: { limit: 200 } }).catch(() => ({})), ctx.canva.call("GET", `/designs/${id}/export-formats`).catch(() => ({}))]);
      return defined({ ...designSummary(design.design), pages_detail: (pages.items || []).map((page) => ({ index: page.index, thumbnail: page.thumbnail?.url })), export_formats: formats.formats ? Object.keys(formats.formats) : undefined });
    },
  },
  {
    name: "canva_list_folder",
    description: "Canva: what a folder holds (\"root\" is Projects): designs, folders and images, with their ids.",
    parameters: { type: "object", properties: { folder: FOLDER, kinds: { type: "array", items: { type: "string", enum: ["design", "folder", "image"] } }, sort_by: { type: "string", enum: ["created_ascending", "created_descending", "modified_ascending", "modified_descending", "title_ascending", "title_descending"] }, ...PAGE } },
    async run(args, ctx) {
      const folder = args.folder ? idOf(args.folder, "folder") : "root";
      const data = await ctx.canva.call("GET", `/folders/${folder}/items`, { query: { item_types: list(args.kinds).join(",") || undefined, sort_by: args.sort_by, continuation: args.continuation, limit: count(args.limit, 25, 100) } });
      const items = (data.items || []).map((item) => {
        if (item.type === "design") return { type: "design", ...designSummary(item.design) };
        if (item.type === "folder") return { type: "folder", id: item.folder?.id, name: item.folder?.name };
        return defined({ type: item.type, id: item.image?.id || item[item.type]?.id, name: item.image?.name || item[item.type]?.name, thumbnail: item.image?.thumbnail?.url });
      });
      return defined({ folder, items, continuation: data.continuation });
    },
  },
  {
    name: "canva_list_brand_templates",
    description: "Canva: the team's brand templates, by search text (Canva Enterprise).",
    parameters: { type: "object", properties: { query: { type: "string" }, ...PAGE } },
    async run(args, ctx) {
      const data = await ctx.canva.call("GET", "/brand-templates", { query: { query: text(args.query, 255) || undefined, continuation: args.continuation, limit: count(args.limit, 25, 100) } });
      return defined({ brand_templates: (data.items || []).map((item) => defined({ id: item.id, title: item.title, view_url: item.view_url, create_url: item.create_url, thumbnail: item.thumbnail?.url })), continuation: data.continuation });
    },
  },
  {
    name: "canva_get_brand_template",
    description: "Canva: one brand template and the fields canva_autofill can fill (Canva Enterprise).",
    parameters: { type: "object", properties: { template: { type: "string", description: "brand template id" } }, required: ["template"] },
    async run(args, ctx) {
      const id = idOf(args.template, "template");
      const [template, dataset] = await Promise.all([ctx.canva.call("GET", `/brand-templates/${id}`), ctx.canva.call("GET", `/brand-templates/${id}/dataset`)]);
      return { ...template.brand_template, fields: dataset.dataset || {} };
    },
  },
  {
    name: "canva_get_comments",
    description: "Canva: one comment thread of a design with its replies.",
    parameters: { type: "object", properties: { design: DESIGN, thread: { type: "string" } }, required: ["design", "thread"] },
    async run(args, ctx) {
      const id = designId(args.design), thread = idOf(args.thread, "thread");
      const [one, replies] = await Promise.all([ctx.canva.call("GET", `/designs/${id}/comments/${thread}`), ctx.canva.call("GET", `/designs/${id}/comments/${thread}/replies`, { query: { limit: 100 } })]);
      return { thread: one.thread, replies: replies.items || [] };
    },
  },
  {
    name: "canva_create_design",
    write: true,
    description: "Canva: create a design: a preset (doc, whiteboard, presentation) or a custom size in pixels, with a title and optionally an image asset to start from. Answers its edit and view URLs.",
    parameters: { type: "object", properties: { title: { type: "string" }, preset: { type: "string", enum: PRESETS }, width: { type: "number" }, height: { type: "number" }, asset: { type: "string", description: "optional image asset id to put in it" } }, required: ["title"] },
    async run(args, ctx) {
      const body = defined({ design_type: designType(args), title: text(args.title, 255) || fail("title is required"), asset_id: args.asset ? idOf(args.asset, "asset") : undefined });
      return designSummary((await ctx.canva.call("POST", "/designs", { body })).design);
    },
  },
  {
    name: "canva_export_design",
    write: true,
    description: "Canva: export a design (pdf, png, jpg, gif, pptx, mp4), optionally only some pages, and wait for it. Answers the download URLs (valid 24 hours: download them with curl if you need the files).",
    parameters: { type: "object", properties: { design: DESIGN, format: { type: "string", enum: EXPORTS }, pages: { type: "array", items: { type: "number" }, description: "page numbers from 1; default all" }, quality: { type: "string", enum: ["regular", "pro"], description: "pdf/pptx: regular or pro; default regular" }, width: { type: "number", description: "png/jpg/gif/mp4: optional width in pixels" }, height: { type: "number" }, size: { type: "string", enum: ["a4", "a3", "letter", "legal"], description: "pdf paper size for docs" } }, required: ["design", "format"] },
    async run(args, ctx) {
      const type = text(args.format, 10).toLowerCase();
      if (!EXPORTS.includes(type)) fail(`format is one of ${EXPORTS.join(", ")}`);
      const format = defined({ type, pages: Array.isArray(args.pages) && args.pages.length ? args.pages.map(Number).filter((page) => Number.isInteger(page) && page > 0) : undefined, export_quality: args.quality, size: type === "pdf" ? args.size : undefined, width: args.width ? Math.round(Number(args.width)) : undefined, height: args.height ? Math.round(Number(args.height)) : undefined, quality: type === "mp4" ? "horizontal_1080p" : type === "jpg" ? 90 : undefined });
      const design = designId(args.design);
      const done = await job(ctx, () => ctx.canva.call("POST", "/exports", { body: { design_id: design, format } }), "/exports");
      return { design, format: type, urls: done.urls || [] };
    },
  },
  {
    name: "canva_upload_asset",
    write: true,
    description: "Canva: upload an image or video to the account's uploads, from your computer (path) or from a public URL, and wait for it. Answers the asset id, to use in canva_create_design or canva_autofill.",
    parameters: { type: "object", properties: { ...FILE_PARAMS, url: { type: "string", description: "a public http(s) URL instead of a file" }, name: { type: "string", description: "the asset's name; default the file name" } } },
    summarize: (args) => String(args.path || args.url || "").slice(0, 160),
    async run(args, ctx) {
      let done;
      if (args.url) {
        const url = text(args.url, 2000);
        if (!/^https?:\/\//i.test(url)) fail("url is an http(s) link");
        const name = text(args.name, 50) || url.split("/").pop().split("?")[0].slice(0, 50) || "asset";
        done = await job(ctx, () => ctx.canva.call("POST", "/url-asset-uploads", { body: { name, url } }), "/url-asset-uploads");
      } else {
        const file = await localFile(args, ctx, { max: 50 * 1024 * 1024 });
        const name = (text(args.name, 50) || file.filename).slice(0, 50);
        done = await job(ctx, () => ctx.canva.call("POST", "/asset-uploads", { raw: file.bytes, headers: { "Content-Type": "application/octet-stream", "Asset-Upload-Metadata": JSON.stringify({ name_base64: b64(name) }) }, timeout: 120000 }), "/asset-uploads");
      }
      const asset = done.asset || {};
      return defined({ id: asset.id, name: asset.name, type: asset.type, thumbnail: asset.thumbnail?.url, tags: asset.tags });
    },
  },
  {
    name: "canva_import_design",
    write: true,
    description: "Canva: turn a file into an editable Canva design (PDF, PPTX, DOCX, XLSX, AI, PSD, Keynote, Pages…), from your computer (path) or a public URL; waits for it and answers the new designs.",
    parameters: { type: "object", properties: { ...FILE_PARAMS, url: { type: "string", description: "a public http(s) URL instead of a file" }, title: { type: "string", description: "the design's title; default the file name" } } },
    summarize: (args) => String(args.path || args.url || "").slice(0, 160),
    async run(args, ctx) {
      let done;
      if (args.url) {
        const url = text(args.url, 2000);
        if (!/^https?:\/\//i.test(url)) fail("url is an http(s) link");
        const title = text(args.title, 50) || url.split("/").pop().split("?")[0].slice(0, 50) || "Import";
        done = await job(ctx, () => ctx.canva.call("POST", "/url-imports", { body: defined({ title, url, mime_type: args.content_type }) }), "/url-imports");
      } else {
        const file = await localFile(args, ctx, { max: 200 * 1024 * 1024 });
        const title = (text(args.title, 50) || file.filename.replace(/\.[^.]+$/, "")).slice(0, 50);
        done = await job(ctx, () => ctx.canva.call("POST", "/imports", { raw: file.bytes, headers: { "Content-Type": "application/octet-stream", "Import-Metadata": JSON.stringify({ title_base64: b64(title), mime_type: file.contentType }) }, timeout: 300000 }), "/imports");
      }
      return { designs: (done.result?.designs || []).map(designSummary) };
    },
  },
  {
    name: "canva_update_asset",
    write: true,
    description: "Canva: rename an uploaded asset or replace its tags.",
    parameters: { type: "object", properties: { asset: { type: "string" }, name: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, required: ["asset"] },
    async run(args, ctx) {
      const body = defined({ name: args.name === undefined ? undefined : text(args.name, 50), tags: args.tags === undefined ? undefined : list(args.tags).slice(0, 50) });
      if (!Object.keys(body).length) fail("name something to change");
      return (await ctx.canva.call("PATCH", `/assets/${idOf(args.asset, "asset")}`, { body })).asset;
    },
  },
  {
    name: "canva_delete_asset",
    write: true,
    description: "Canva: delete an uploaded asset (it goes to the trash). Only when asked.",
    parameters: { type: "object", properties: { asset: { type: "string" } }, required: ["asset"] },
    async run(args, ctx) {
      const id = idOf(args.asset, "asset");
      await ctx.canva.call("DELETE", `/assets/${id}`);
      return { deleted: id };
    },
  },
  {
    name: "canva_create_folder",
    write: true,
    description: "Canva: create a folder inside another (default Projects, \"root\").",
    parameters: { type: "object", properties: { name: { type: "string" }, parent: FOLDER }, required: ["name"] },
    async run(args, ctx) {
      const folder = (await ctx.canva.call("POST", "/folders", { body: { name: text(args.name, 255) || fail("name is required"), parent_folder_id: args.parent ? idOf(args.parent, "parent") : "root" } })).folder;
      return { id: folder?.id, name: folder?.name };
    },
  },
  {
    name: "canva_update_folder",
    write: true,
    description: "Canva: rename a folder.",
    parameters: { type: "object", properties: { folder: FOLDER, name: { type: "string" } }, required: ["folder", "name"] },
    async run(args, ctx) {
      const folder = (await ctx.canva.call("PATCH", `/folders/${idOf(args.folder, "folder")}`, { body: { name: text(args.name, 255) || fail("name is required") } })).folder;
      return { id: folder?.id, name: folder?.name };
    },
  },
  {
    name: "canva_delete_folder",
    write: true,
    description: "Canva: delete a folder; what it holds goes to the trash too. Only when asked.",
    parameters: { type: "object", properties: { folder: FOLDER }, required: ["folder"] },
    async run(args, ctx) {
      const id = idOf(args.folder, "folder");
      if (id === "root") fail("Projects cannot be deleted");
      await ctx.canva.call("DELETE", `/folders/${id}`);
      return { deleted: id };
    },
  },
  {
    name: "canva_move_item",
    write: true,
    description: "Canva: move a design, folder or image into another folder (\"root\" is Projects).",
    parameters: { type: "object", properties: { item: { type: "string", description: "design (id or URL), folder or asset id" }, to: FOLDER }, required: ["item", "to"] },
    async run(args, ctx) {
      const item = /canva\.com\/design\//.test(String(args.item)) ? designId(args.item) : idOf(args.item, "item");
      const to = idOf(args.to, "to");
      await ctx.canva.call("POST", "/folders/move", { body: { item_id: item, to_folder_id: to } });
      return { moved: item, to };
    },
  },
  {
    name: "canva_autofill",
    write: true,
    description: "Canva: make a new design from a brand template, filling its fields with text or image assets (Canva Enterprise); waits for it. See the fields with canva_get_brand_template.",
    parameters: { type: "object", properties: { template: { type: "string" }, title: { type: "string" }, fields: { type: "object", description: "field name → text, or {\"asset\": \"<asset id>\"} for an image field" } }, required: ["template", "fields"] },
    async run(args, ctx) {
      if (!args.fields || typeof args.fields !== "object" || Array.isArray(args.fields) || !Object.keys(args.fields).length) fail("fields maps each field to its text or {asset}");
      const data = Object.fromEntries(Object.entries(args.fields).map(([key, value]) => [key, value && typeof value === "object" ? { type: "image", asset_id: idOf(value.asset || value.asset_id, `asset of ${key}`) } : { type: "text", text: String(value) }]));
      const done = await job(ctx, () => ctx.canva.call("POST", "/autofills", { body: defined({ brand_template_id: idOf(args.template, "template"), title: args.title ? text(args.title, 255) : undefined, data }) }), "/autofills");
      return designSummary(done.result?.design) || done.result || {};
    },
  },
  {
    name: "canva_resize_design",
    write: true,
    description: "Canva: make a copy of a design at another size (preset or width × height in pixels); waits for it. Needs a paid Canva plan.",
    parameters: { type: "object", properties: { design: DESIGN, preset: { type: "string", enum: PRESETS }, width: { type: "number" }, height: { type: "number" } }, required: ["design"] },
    async run(args, ctx) {
      if (!args.preset && !args.width) fail("give a preset or width and height");
      const done = await job(ctx, () => ctx.canva.call("POST", "/resizes", { body: { design_id: designId(args.design), design_type: designType(args) } }), "/resizes");
      return designSummary(done.result?.design) || done.result || {};
    },
  },
  {
    name: "canva_comment",
    write: true,
    description: "Canva: start a comment thread on a design, or reply to a thread. It carries the authorised account's name.",
    parameters: { type: "object", properties: { design: DESIGN, message: { type: "string" }, thread: { type: "string", description: "optional thread id to reply to" } }, required: ["design", "message"] },
    async run(args, ctx) {
      const id = designId(args.design), message_plain = text(args.message, 2048) || fail("message is required");
      if (args.thread) return (await ctx.canva.call("POST", `/designs/${id}/comments/${idOf(args.thread, "thread")}/replies`, { body: { message_plain } })).reply;
      return (await ctx.canva.call("POST", `/designs/${id}/comments`, { body: { message_plain } })).thread;
    },
  },
  {
    name: "canva_api",
    write: true,
    description: "Canva fallback, only for what the other canva_ tools do not cover: one call to the Connect API (https://api.canva.com/rest/v1) with method, path and JSON body.",
    parameters: { type: "object", properties: { method: { type: "string", enum: [...METHODS], description: "default GET" }, path: { type: "string", description: "the API path after /rest/v1, e.g. /designs?limit=10" }, query: { type: "object", description: "optional query parameters" }, body: { type: "object", description: "for POST, PATCH and PUT: the JSON body" } }, required: ["path"] },
    summarize: (args) => `${String(args.method || "GET").toUpperCase()} ${String(args.path || "")}`.slice(0, 200),
    async run(args, ctx) {
      const method = String(args.method || "GET").toUpperCase();
      if (!METHODS.has(method)) fail("method is GET, POST, PATCH, PUT or DELETE");
      const path = String(args.path || "").trim();
      if (!/^\/[\w\-./]*(\?[^#\s]*)?$/.test(path) || path.includes("..") || path.includes("//") || path.startsWith("/oauth")) fail("path is a Canva Connect API path such as /designs/<id>: no host, no .., no /oauth");
      const [route, search] = path.split("?");
      const query = { ...Object.fromEntries(new URLSearchParams(search || "")), ...(args.query && typeof args.query === "object" ? args.query : {}) };
      const body = ["POST", "PATCH", "PUT"].includes(method) ? (args.body && typeof args.body === "object" ? args.body : {}) : undefined;
      return ctx.canva.call(method, route, { query, body });
    },
  },
];

export const canva = {
  id: "canva",
  name: "Canva",
  secret: "CORA_CANVA_TOKEN",
  appSecrets: ["CORA_CANVA_CLIENT_ID", "CORA_CANVA_CLIENT_SECRET"],
  label: "team",
  oauth: {
    authorize: "https://www.canva.com/api/oauth/authorize",
    token: "https://api.canva.com/rest/v1/oauth/token",
    scopes: SCOPES,
    clientAuth: "basic",
    async identify({ access, request, api }) {
      const headers = { Authorization: `Bearer ${access}` };
      const me = await request(`${api.canva}/users/me`, { headers });
      const profile = await request(`${api.canva}/users/me/profile`, { headers });
      return {
        workspace: String(me.data?.team_user?.team_id || "").slice(0, 120),
        account: String(profile.data?.profile?.display_name || me.data?.team_user?.user_id || "").slice(0, 120),
      };
    },
  },
  card: {
    icon: "layers",
    description: "Gli agenti preparano e aggiornano materiali di design.",
    meta: "Canva · Design",
    intro: "Gli agenti preparano materiali di design. Canva si collega con un'integrazione Canva intestata a te, autorizzata con il tuo account.",
    optional: {
      intro: "Canva non ha token personali: si collega solo con un'integrazione Canva intestata a te, con client ID, client secret e autorizzazione OAuth.",
      notice: "Decidi tu: collegare Canva adesso con un'integrazione, oppure lasciarla spenta. Senza integrazione nessun agente può usarla.",
      off: "Canva è esclusa: nessun agente la usa e nessuna chiave è salvata.",
      start: "Collega Canva con un'app",
      restart: "Attiva Canva",
      later: "Per ora no",
      done: "Canva lasciata spenta",
    },
    modes: [{
      id: "app",
      ready: "app",
      intro: "Canva non ha token personali: si collega con un'integrazione Canva intestata a te, poi la autorizzi con il tuo account.",
      notice: "Servono client ID e client secret dell'integrazione; poi autorizzi Canva da qui e Cora salva i token nella cassaforte.",
      rows: [
        { title: "L'integrazione Canva", steps: [
          ["apri ", { href: "https://www.canva.com/developers/integrations", text: "canva.com/developers" }, " → Your integrations → Create an integration;"],
          "in Scopes attiva lettura e scrittura di design, asset, cartelle, commenti, brand template e profilo;",
          ["in Authentication aggiungi l'indirizzo di ritorno di Cora, ", { redirect: true }, ";"],
          ["copia client ID e client secret e incollali qui: finiscono nella cassaforte come ", { code: "CORA_CANVA_CLIENT_ID" }, " e ", { code: "CORA_CANVA_CLIENT_SECRET" }, ";"],
          "poi premi «Autorizza Canva» e accetta con il tuo account.",
        ], fields: [
          { name: "clientId", type: "text", title: "Client ID", label: "Client ID dell'app Canva" },
          { name: "clientSecret", type: "password", title: "Client secret", label: "Client secret dell'app Canva" },
        ], submit: "Salva l'app" },
      ],
    }],
  },
  tools: TOOLS,
  context(ctx) { return { ...ctx, canva: client(ctx) }; },
};
