import { randomBytes } from "node:crypto";
import { count, defined, fail, FILE_PARAMS, list, localFile, text } from "./tooling.js";

/**
 * Google Drive on the accounts of the Google connector. drive grants everything the account
 * can reach; drive.readonly only reading; drive.file only the files Cora itself created or the
 * person opened with it. Every call works on shared drives too.
 */
export const DRIVE_SCOPES = {
  full: "https://www.googleapis.com/auth/drive",
  readonly: "https://www.googleapis.com/auth/drive.readonly",
  file: "https://www.googleapis.com/auth/drive.file",
};

const FOLDER = "application/vnd.google-apps.folder";
const GOOGLE_TYPES = {
  doc: "application/vnd.google-apps.document", sheet: "application/vnd.google-apps.spreadsheet", slides: "application/vnd.google-apps.presentation",
  drawing: "application/vnd.google-apps.drawing", form: "application/vnd.google-apps.form", folder: FOLDER, shortcut: "application/vnd.google-apps.shortcut",
};
const TYPE_NAMES = Object.fromEntries(Object.entries(GOOGLE_TYPES).map(([name, mime]) => [mime, name]));
const SEARCH_TYPES = { ...GOOGLE_TYPES, pdf: "application/pdf", image: "image/", video: "video/", audio: "audio/", text: "text/" };

const FORMATS = {
  pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf", txt: "text/plain", md: "text/markdown", html: "text/html", epub: "application/epub+zip",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ods: "application/x-vnd.oasis.opendocument.spreadsheet", csv: "text/csv", tsv: "text/tab-separated-values",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", odp: "application/vnd.oasis.opendocument.presentation",
  png: "image/png", jpg: "image/jpeg", svg: "image/svg+xml", zip: "application/zip",
};
/** What each Google file exports to: the first format is the download default, read is the text drive_read_file takes. */
const EXPORTS = {
  doc: { formats: ["pdf", "docx", "odt", "rtf", "txt", "md", "html", "epub"], read: ["md", "txt", "html"] },
  sheet: { formats: ["xlsx", "ods", "csv", "tsv", "pdf", "zip"], read: ["csv", "tsv"] },
  slides: { formats: ["pdf", "pptx", "odp", "txt", "png", "jpg", "svg"], read: ["txt"] },
  drawing: { formats: ["png", "pdf", "jpg", "svg"], read: [] },
};
/** Files Google can turn into its own Docs, Sheets and Slides on upload. */
const CONVERTS = { docx: "doc", doc: "doc", odt: "doc", rtf: "doc", txt: "doc", md: "doc", html: "doc", htm: "doc", xlsx: "sheet", xls: "sheet", ods: "sheet", csv: "sheet", tsv: "sheet", pptx: "slides", ppt: "slides", odp: "slides" };
const TEXTUAL = /^(text\/|application\/(json|xml|javascript|x-yaml|yaml|x-sh|sql|ld\+json))/;

const FILE_FIELDS = "id,name,mimeType,size,modifiedTime,createdTime,parents,owners(emailAddress),shared,starred,trashed,webViewLink,driveId,description,shortcutDetails(targetId,targetMimeType)";
const LIST_FIELDS = `nextPageToken,incompleteSearch,files(${FILE_FIELDS})`;
const ALL = { supportsAllDrives: true };
const MAX_FILE = 50 * 1024 * 1024;

const kind = (mime) => TYPE_NAMES[mime] || mime;
const quote = (value) => String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
export const fileSummary = (file) => defined({
  id: file.id, name: file.name, type: kind(file.mimeType), bytes: file.size ? Number(file.size) : undefined, modified: file.modifiedTime,
  folder: file.parents?.[0], owner: file.owners?.[0]?.emailAddress, shared: file.shared || undefined, starred: file.starred || undefined,
  trashed: file.trashed || undefined, drive: file.driveId, shortcut_to: file.shortcutDetails?.targetId, link: file.webViewLink,
});

/** A Drive id, or the id inside a Drive, Docs, Sheets or Slides link. */
export function fileId(value, what = "file") {
  const raw = text(value, 2000);
  const match = raw.match(/\/(?:d|folders)\/([A-Za-z0-9_-]+)/) || raw.match(/[?&]id=([A-Za-z0-9_-]+)/);
  const id = match ? match[1] : raw;
  if (!id || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) fail(`${what} is a Drive id or link, as drive_search answers it`);
  return id;
}

const getFile = (ctx, id, fields = FILE_FIELDS) => ctx.drive("GET", `/files/${id}`, { query: { ...ALL, fields } });

/** A folder by id, link or exact name ("root" or "My Drive" for the top); a name that is not unique lists the candidates. */
async function folderOf(ctx, value) {
  const raw = text(value, 2000);
  if (!raw) return undefined;
  if (/^(root|my drive|il mio drive)$/i.test(raw)) return "root";
  const looksLikeId = /^https?:\/\//i.test(raw) || /^[A-Za-z0-9_-]{19,}$/.test(raw);
  if (looksLikeId) {
    try {
      const found = await getFile(ctx, fileId(raw, "folder"), "id,name,mimeType");
      if (found.mimeType !== FOLDER) fail(`"${found.name}" is not a folder`);
      return found.id;
    } catch (error) {
      if (/^https?:\/\//i.test(raw) || !/ 404/.test(error.message)) throw error;
    }
  }
  const found = (await ctx.drive("GET", "/files", { query: { ...ALL, includeItemsFromAllDrives: true, q: `mimeType='${FOLDER}' and name='${quote(raw)}' and trashed=false`, fields: "files(id,name,parents,driveId)", pageSize: 10 } })).files || [];
  if (found.length === 1) return found[0].id;
  if (!found.length) fail(`no folder named "${raw}": drive_search with type folder lists them, drive_create_folder makes one`);
  fail(`more than one folder is named "${raw}": ${found.map((item) => `${item.id} (in ${item.parents?.[0] || item.driveId || "?"})`).join(", ")}; give the id`);
}

/** Uploads bytes as a new file or a new version: multipart up to 5 MB, a resumable session above. */
async function upload(ctx, { id, metadata, file }) {
  const method = id ? "PATCH" : "POST", path = id ? `/files/${id}` : "/files", query = { ...ALL, fields: FILE_FIELDS };
  if (file.bytes.length <= 5 * 1024 * 1024) {
    const boundary = `cora_${randomBytes(12).toString("hex")}`;
    const raw = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${file.contentType}\r\n\r\n`), file.bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    return ctx.drive(method, path, { upload: true, query: { ...query, uploadType: "multipart" }, raw, contentType: `multipart/related; boundary=${boundary}` });
  }
  const session = await ctx.drive(method, path, { upload: true, query: { ...query, uploadType: "resumable" }, body: metadata, headers: { "X-Upload-Content-Type": file.contentType, "X-Upload-Content-Length": String(file.bytes.length) }, as: "location" });
  if (!session.location) fail("Google Drive did not open the upload: try again");
  return ctx.drive("PUT", session.location, { session: true, raw: file.bytes, contentType: file.contentType });
}

/** The bytes of a file: exported when it is a Google file, as stored otherwise. */
async function contentOf(ctx, file, format, { reading = false } = {}) {
  const google = EXPORTS[kind(file.mimeType)];
  if (file.mimeType === FOLDER) fail(`"${file.name}" is a folder: drive_search with folder lists what it holds`);
  if (file.mimeType?.startsWith("application/vnd.google-apps.")) {
    const allowed = google ? (reading ? google.read : google.formats) : [];
    if (!allowed.length) fail(`"${file.name}" is a ${kind(file.mimeType)} and cannot be ${reading ? "read as text: use drive_download" : "exported"}`);
    const chosen = text(format, 10).toLowerCase() || allowed[0];
    if (!allowed.includes(chosen)) fail(`a ${kind(file.mimeType)} ${reading ? "reads" : "exports"} as ${allowed.join(", ")}`);
    const out = await ctx.drive("GET", `/files/${file.id}/export`, { query: { mimeType: FORMATS[chosen] }, as: "bytes" });
    return { ...out, format: chosen, exported: true };
  }
  if (format) fail(`format applies only to Google Docs, Sheets, Slides and drawings; "${file.name}" downloads as it is`);
  if (reading && !TEXTUAL.test(file.mimeType || "")) fail(`"${file.name}" is ${file.mimeType}, not text: save it with drive_download and open it on your computer`);
  if (Number(file.size) > MAX_FILE) fail(`"${file.name}" is ${file.size} bytes: at most ${MAX_FILE}`);
  return { ...(await ctx.drive("GET", `/files/${file.id}`, { query: { ...ALL, alt: "media" }, as: "bytes" })), exported: false };
}

const ACCOUNT = { type: "string", description: "the connected Google account to use (its address or id); optional when only one allows this" };
const FILE = { type: "string", description: "the file's Drive id or its link (Drive, Docs, Sheets, Slides)" };
const FOLDER_PARAM = { type: "string", description: "a folder: its id, link or exact name; \"root\" for My Drive" };
const SHARE_RULE = "Share only with whom the person named.";

export const DRIVE_TOOLS = [
  {
    name: "drive_search", needs: "drive",
    description: () => "Google Drive: find files and folders in one of your accounts (My Drive, shared with you, shared drives): by words in the name or content, name, type, folder, owner, star, date, or a raw Drive query. Newest change first; trash left out unless asked.",
    parameters: { type: "object", properties: {
      account: ACCOUNT,
      query: { type: "string", description: "words in the name or the content" },
      name: { type: "string", description: "words in the name only" },
      type: { type: "string", enum: Object.keys(SEARCH_TYPES), description: "only this kind of file" },
      folder: { ...FOLDER_PARAM, description: "only what is directly in this folder (id, link or exact name)" },
      shared_with_me: { type: "boolean" }, owned_by_me: { type: "boolean" }, starred: { type: "boolean" },
      trashed: { type: "boolean", description: "true: search the trash" },
      modified_after: { type: "string", description: "YYYY-MM-DD or ISO date-time" },
      shared_drive: { type: "string", description: "only this shared drive (its id, from drive_list_shared_drives)" },
      q: { type: "string", description: "optional raw Drive query, added to the rest, e.g. \"'me' in writers\"" },
      limit: { type: "number", description: "default 25, at most 100" },
      page_token: { type: "string", description: "next_page from an earlier answer" },
    } },
    summarize: (args) => text(args.query || args.name || args.q || args.folder, 120),
    async run(args, ctx) {
      const terms = [];
      const words = text(args.query, 500), name = text(args.name, 500);
      if (words) terms.push(`fullText contains '${quote(words)}'`);
      if (name) terms.push(`name contains '${quote(name)}'`);
      if (args.type) {
        const mime = SEARCH_TYPES[args.type];
        if (!mime) fail(`type is one of ${Object.keys(SEARCH_TYPES).join(", ")}`);
        terms.push(mime.endsWith("/") ? `mimeType contains '${mime}'` : `mimeType='${mime}'`);
      }
      if (args.folder) terms.push(`'${await folderOf(ctx, args.folder)}' in parents`);
      if (args.shared_with_me) terms.push("sharedWithMe");
      if (args.owned_by_me) terms.push("'me' in owners");
      if (args.starred) terms.push("starred");
      terms.push(`trashed=${args.trashed ? "true" : "false"}`);
      const after = text(args.modified_after, 40);
      if (after) {
        const when = new Date(/^\d{4}-\d{2}-\d{2}$/.test(after) ? `${after}T00:00:00Z` : after);
        if (Number.isNaN(when.getTime())) fail("modified_after is YYYY-MM-DD or an ISO date-time");
        terms.push(`modifiedTime > '${when.toISOString()}'`);
      }
      const raw = text(args.q, 2000);
      if (raw) terms.push(`(${raw})`);
      const drive = text(args.shared_drive, 200);
      const found = await ctx.drive("GET", "/files", { query: defined({
        ...ALL, includeItemsFromAllDrives: true, q: terms.join(" and "), fields: LIST_FIELDS, pageSize: count(args.limit, 25, 100),
        orderBy: words ? undefined : "modifiedTime desc", pageToken: text(args.page_token, 2000) || undefined,
        corpora: drive ? "drive" : undefined, driveId: drive || undefined,
      }) });
      return defined({ account: ctx.connection.email, files: (found.files || []).map(fileSummary), next_page: found.nextPageToken, incomplete: found.incompleteSearch || undefined });
    },
  },
  {
    name: "drive_get_file", needs: "drive",
    description: () => "Google Drive: one file or folder whole: type, size, dates, folder, owner, who last changed it, description, what you may do on it, link.",
    parameters: { type: "object", properties: { account: ACCOUNT, file: FILE }, required: ["file"] },
    async run(args, ctx) {
      const file = await getFile(ctx, fileId(args.file), `${FILE_FIELDS},createdTime,lastModifyingUser(displayName,emailAddress),capabilities(canEdit,canComment,canShare,canTrash,canDownload)`);
      let folderName;
      if (file.parents?.[0]) { try { folderName = (await getFile(ctx, file.parents[0], "name")).name; } catch { folderName = undefined; } }
      const can = Object.entries(file.capabilities || {}).filter(([, yes]) => yes).map(([name]) => name.replace(/^can/, "").toLowerCase());
      return defined({ ...fileSummary(file), folder_name: folderName, created: file.createdTime, modified_by: file.lastModifyingUser?.emailAddress || file.lastModifyingUser?.displayName, description: file.description, can,
        exports: EXPORTS[kind(file.mimeType)]?.formats });
    },
  },
  {
    name: "drive_read_file", needs: "drive",
    description: () => "Google Drive: read a file's text here: a Google Doc as Markdown (or txt, html), a Sheet as CSV of its first sheet (or tsv), Slides as text, or a text file (txt, md, csv, json, …). For PDFs, images and Office files use drive_download.",
    parameters: { type: "object", properties: { account: ACCOUNT, file: FILE, format: { type: "string", description: "optional: md, txt, html for a Doc; csv, tsv for a Sheet" }, max_chars: { type: "number", description: "text kept, default 30000, at most 200000" } }, required: ["file"] },
    async run(args, ctx) {
      const file = await getFile(ctx, fileId(args.file));
      const out = await contentOf(ctx, file, args.format, { reading: true });
      const body = out.bytes.toString("utf8"), max = count(args.max_chars, 30000, 200000);
      return defined({ id: file.id, name: file.name, type: kind(file.mimeType), format: out.exported ? out.format : undefined,
        note: kind(file.mimeType) === "sheet" ? "CSV holds only the first sheet: drive_download as xlsx for all of them" : undefined,
        text: body.length > max ? `${body.slice(0, max)}\n[cut at ${max} of ${body.length} characters]` : body });
    },
  },
  {
    name: "drive_download", needs: "drive",
    description: () => "Google Drive: save a file on your computer, under /home/agent/work/drive/ unless you give a path inside /home/agent/work. Google Docs, Sheets and Slides are exported: format pdf, docx, md, txt (Doc), xlsx, csv (Sheet), pptx, pdf (Slides)…; other files come as they are (at most 50 MB).",
    parameters: { type: "object", properties: { account: ACCOUNT, file: FILE, format: { type: "string", description: "only for Google files; default pdf for Docs and Slides, xlsx for Sheets, png for drawings" }, path: { type: "string", description: "optional absolute path inside /home/agent/work to save it as" } }, required: ["file"] },
    summarize: (args) => text(args.file, 120),
    async run(args, ctx) {
      const file = await getFile(ctx, fileId(args.file));
      const out = await contentOf(ctx, file, args.format);
      let safe = String(file.name || file.id).replace(/[\\/\r\n\0]/g, "_").replace(/^\.+/, "_").slice(-150) || file.id;
      if (out.exported && !safe.toLowerCase().endsWith(`.${out.format}`)) safe = `${safe}.${out.format}`;
      const path = text(args.path, 1000) || `/home/agent/work/drive/${file.id}/${safe}`;
      if (!path.startsWith("/home/agent/work/") || path.includes("\0") || path.split("/").includes("..")) fail("path must be inside /home/agent/work");
      if (!ctx.writeFile) fail("files cannot be saved on your computer in this turn");
      await ctx.writeFile(path, out.bytes);
      return defined({ saved: path, name: file.name, type: kind(file.mimeType), format: out.exported ? out.format : undefined, bytes: out.bytes.length });
    },
  },
  {
    name: "drive_list_permissions", needs: "drive",
    description: () => "Google Drive: who has access to a file or folder, with their role (owner, organizer, writer, commenter, reader) and the permission id drive_unshare takes.",
    parameters: { type: "object", properties: { account: ACCOUNT, file: FILE }, required: ["file"] },
    async run(args, ctx) {
      const found = await ctx.drive("GET", `/files/${fileId(args.file)}/permissions`, { query: { ...ALL, fields: "permissions(id,type,role,emailAddress,domain,displayName,expirationTime,deleted)" } });
      return (found.permissions || []).map((item) => defined({ id: item.id, type: item.type, role: item.role, email: item.emailAddress, domain: item.domain, name: item.displayName, expires: item.expirationTime, deleted: item.deleted || undefined }));
    },
  },
  {
    name: "drive_list_comments", needs: "drive",
    description: () => "Google Drive: the comments on a file (Docs, Sheets, Slides, PDFs…), with the text they point at, their replies and whether they are resolved.",
    parameters: { type: "object", properties: { account: ACCOUNT, file: FILE, resolved: { type: "boolean", description: "also resolved comments (default only open ones)" }, limit: { type: "number", description: "default 50, at most 100" } }, required: ["file"] },
    async run(args, ctx) {
      const found = await ctx.drive("GET", `/files/${fileId(args.file)}/comments`, { query: { pageSize: count(args.limit, 50, 100), fields: "comments(id,content,author(displayName,emailAddress),createdTime,resolved,quotedFileContent(value),replies(id,content,author(displayName,emailAddress),createdTime,action))" } });
      return (found.comments || []).filter((item) => args.resolved || !item.resolved).map((item) => defined({
        id: item.id, author: item.author?.emailAddress || item.author?.displayName, date: item.createdTime, text: item.content, about: item.quotedFileContent?.value, resolved: item.resolved || undefined,
        replies: item.replies?.length ? item.replies.map((reply) => defined({ id: reply.id, author: reply.author?.emailAddress || reply.author?.displayName, date: reply.createdTime, text: reply.content, action: reply.action })) : undefined,
      }));
    },
  },
  {
    name: "drive_list_shared_drives", needs: "drive",
    description: () => "Google Drive: the shared drives one of your accounts belongs to, with the id drive_search and the others take.",
    parameters: { type: "object", properties: { account: ACCOUNT } },
    async run(args, ctx) {
      const found = await ctx.drive("GET", "/drives", { query: { pageSize: 100, fields: "drives(id,name)" } });
      return (found.drives || []).map((item) => ({ id: item.id, name: item.name }));
    },
  },
  {
    name: "drive_upload", needs: "drive_write",
    description: () => "Google Drive: upload a file from your computer into a folder (default My Drive), at most 50 MB. With convert it becomes a Google Doc, Sheet or Slides (from docx, md, txt, html, xlsx, csv, pptx, …). To replace an existing file's content use drive_update_file.",
    parameters: { type: "object", properties: { account: ACCOUNT, ...FILE_PARAMS, path: { ...FILE_PARAMS.path, description: "absolute path of the file on your computer, e.g. /home/agent/work/report.pdf (at most 50 MB)" }, folder: FOLDER_PARAM, name: { type: "string", description: "optional name in Drive; default the file's own" }, convert: { type: "boolean", description: "turn it into a Google Doc, Sheet or Slides" }, description: { type: "string" } }, required: ["path"] },
    summarize: (args) => `${text(args.path, 150)} → ${text(args.folder, 80) || "My Drive"}`,
    async run(args, ctx) {
      const file = await localFile(args, ctx, { max: MAX_FILE });
      const name = text(args.name, 300) || file.filename;
      let mimeType;
      if (args.convert) {
        const target = CONVERTS[file.filename.split(".").pop().toLowerCase()];
        if (!target) fail(`Google cannot turn ${file.filename} into a Doc, Sheet or Slides: upload it without convert`);
        mimeType = GOOGLE_TYPES[target];
      }
      const folder = await folderOf(ctx, args.folder);
      const made = await upload(ctx, { metadata: defined({ name: mimeType ? name.replace(/\.[^.]+$/, "") || name : name, mimeType, parents: folder ? [folder] : undefined, description: text(args.description, 5000) || undefined }), file });
      return fileSummary(made);
    },
  },
  {
    name: "drive_create_file", needs: "drive_write",
    description: () => "Google Drive: create a Google Doc (content as text, markdown or html), a Sheet (content as csv), an empty Slides, or a plain text file, in a folder (default My Drive). For a file you already have on your computer use drive_upload.",
    parameters: { type: "object", properties: {
      account: ACCOUNT, name: { type: "string" }, type: { type: "string", enum: ["doc", "sheet", "slides", "text"] },
      content: { type: "string", description: "optional starting content" },
      content_format: { type: "string", enum: ["text", "markdown", "html", "csv"], description: "how content is written: Docs take text, markdown or html (default text); Sheets csv; text files any" },
      folder: FOLDER_PARAM, description: { type: "string" },
    }, required: ["name", "type"] },
    summarize: (args) => `${text(args.type, 10)} ${text(args.name, 120)}`,
    async run(args, ctx) {
      const name = text(args.name, 300), type = text(args.type, 10), content = args.content === undefined || args.content === null ? "" : String(args.content);
      if (!name) fail("name is required");
      if (!["doc", "sheet", "slides", "text"].includes(type)) fail("type is doc, sheet, slides or text");
      if (content.length > 10 * 1024 * 1024) fail("content is too long: write it to a file and use drive_upload");
      const folder = await folderOf(ctx, args.folder);
      const metadata = defined({ name, mimeType: type === "text" ? undefined : GOOGLE_TYPES[type], parents: folder ? [folder] : undefined, description: text(args.description, 5000) || undefined });
      if (type === "slides" && content) fail("Slides start empty: give no content");
      const sources = { text: "text/plain", markdown: "text/markdown", html: "text/html", csv: "text/csv" };
      const format = text(args.content_format, 10) || (type === "sheet" ? "csv" : "text");
      if (!sources[format]) fail("content_format is text, markdown, html or csv");
      if (type === "sheet" && content && format !== "csv") fail("a Sheet takes its content as csv");
      if (type === "doc" && content && format === "csv") fail("a Doc takes text, markdown or html");
      if (!content && type !== "text") return fileSummary(await ctx.drive("POST", "/files", { query: { ...ALL, fields: FILE_FIELDS }, body: metadata }));
      const contentType = type === "text" ? (/\.md$/i.test(name) ? "text/markdown" : /\.csv$/i.test(name) ? "text/csv" : /\.html?$/i.test(name) ? "text/html" : /\.json$/i.test(name) ? "application/json" : sources[format]) : sources[format];
      return fileSummary(await upload(ctx, { metadata, file: { bytes: Buffer.from(content, "utf8"), contentType: `${contentType}; charset=UTF-8` } }));
    },
  },
  {
    name: "drive_update_file", needs: "drive_write",
    description: () => "Google Drive: change a file or folder: rename it, move it to another folder, change its description, star it, or replace its content with a file from your computer (a new version; the link stays the same). Change only what the person asked for.",
    parameters: { type: "object", properties: {
      account: ACCOUNT, file: FILE, name: { type: "string" }, move_to: { ...FOLDER_PARAM, description: "the folder to move it into (id, link or exact name)" },
      description: { type: "string" }, starred: { type: "boolean" },
      path: { type: "string", description: "absolute path of a file on your computer whose bytes replace the content (at most 50 MB)" },
    }, required: ["file"] },
    summarize: (args) => text(args.file, 120),
    async run(args, ctx) {
      const id = fileId(args.file);
      const metadata = defined({ name: text(args.name, 300) || undefined, description: args.description === undefined ? undefined : text(args.description, 5000), starred: typeof args.starred === "boolean" ? args.starred : undefined });
      const query = { ...ALL, fields: FILE_FIELDS };
      if (args.move_to) {
        const target = await folderOf(ctx, args.move_to);
        const current = await getFile(ctx, id, "parents");
        if (target === id) fail("a folder cannot go inside itself");
        query.addParents = target;
        const old = (current.parents || []).filter((parent) => parent !== target);
        if (old.length) query.removeParents = old.join(",");
      }
      if (!Object.keys(metadata).length && !args.move_to && !args.path) fail("say what to change: name, move_to, description, starred or path");
      let updated;
      if (args.path) {
        const file = await localFile(args, ctx, { max: MAX_FILE });
        updated = await upload(ctx, { id, metadata, file });
        if (query.addParents) updated = await ctx.drive("PATCH", `/files/${id}`, { query, body: {} });
      } else updated = await ctx.drive("PATCH", `/files/${id}`, { query, body: metadata });
      return fileSummary(updated);
    },
  },
  {
    name: "drive_create_folder", needs: "drive_write",
    description: () => "Google Drive: create a folder, inside another folder or in My Drive.",
    parameters: { type: "object", properties: { account: ACCOUNT, name: { type: "string" }, folder: { ...FOLDER_PARAM, description: "the parent folder (id, link or exact name); default My Drive" }, description: { type: "string" } }, required: ["name"] },
    summarize: (args) => text(args.name, 120),
    async run(args, ctx) {
      const name = text(args.name, 300);
      if (!name) fail("name is required");
      const parent = await folderOf(ctx, args.folder);
      return fileSummary(await ctx.drive("POST", "/files", { query: { ...ALL, fields: FILE_FIELDS }, body: defined({ name, mimeType: FOLDER, parents: parent ? [parent] : undefined, description: text(args.description, 5000) || undefined }) }));
    },
  },
  {
    name: "drive_copy_file", needs: "drive_write",
    description: () => "Google Drive: copy a file (not a folder), with a new name and into a folder if you give them; e.g. to start a document from a template.",
    parameters: { type: "object", properties: { account: ACCOUNT, file: FILE, name: { type: "string" }, folder: FOLDER_PARAM }, required: ["file"] },
    summarize: (args) => text(args.file, 120),
    async run(args, ctx) {
      const parent = await folderOf(ctx, args.folder);
      return fileSummary(await ctx.drive("POST", `/files/${fileId(args.file)}/copy`, { query: { ...ALL, fields: FILE_FIELDS }, body: defined({ name: text(args.name, 300) || undefined, parents: parent ? [parent] : undefined }) }));
    },
  },
  {
    name: "drive_trash", needs: "drive_write",
    description: () => "Google Drive: move a file or folder to the trash (Google keeps it 30 days), or take it out with restore. Only when the person asks; deleting for good is not an action here.",
    parameters: { type: "object", properties: { account: ACCOUNT, file: FILE, restore: { type: "boolean", description: "true: take it out of the trash" } }, required: ["file"] },
    summarize: (args) => `${args.restore ? "restore" : "trash"} ${text(args.file, 120)}`,
    async run(args, ctx) {
      const file = await ctx.drive("PATCH", `/files/${fileId(args.file)}`, { query: { ...ALL, fields: "id,name,trashed" }, body: { trashed: !args.restore } });
      return { id: file.id, name: file.name, trashed: Boolean(file.trashed) };
    },
  },
  {
    name: "drive_share", needs: "drive_write",
    description: () => `Google Drive: share a file or folder with people (emails), Google groups, a whole domain, or anyone with the link, as reader, commenter or writer. People get Google's email unless notify is false. ${SHARE_RULE} A domain or anyone-with-the-link only when the person asked for it.`,
    parameters: { type: "object", properties: {
      account: ACCOUNT, file: FILE, role: { type: "string", enum: ["reader", "commenter", "writer"] },
      emails: { type: "array", items: { type: "string" }, description: "people's addresses" }, groups: { type: "array", items: { type: "string" }, description: "Google group addresses" },
      domain: { type: "string", description: "a company domain, e.g. acme.com" }, anyone: { type: "boolean", description: "anyone with the link" },
      notify: { type: "boolean", description: "email the people and groups (default true)" }, message: { type: "string", description: "a note in that email" },
    }, required: ["file", "role"] },
    summarize: (args) => `${text(args.role, 20)} ${[...list(args.emails), ...list(args.groups), text(args.domain, 100), args.anyone ? "anyone" : ""].filter(Boolean).join(", ")}`,
    async run(args, ctx) {
      const id = fileId(args.file), role = text(args.role, 20);
      if (!["reader", "commenter", "writer"].includes(role)) fail("role is reader, commenter or writer");
      const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i;
      const people = list(args.emails).map((value) => value.toLowerCase()), groups = list(args.groups).map((value) => value.toLowerCase()), domain = text(args.domain, 200).toLowerCase();
      for (const address of [...people, ...groups]) if (!EMAIL.test(address)) fail(`"${address.slice(0, 80)}" is not an email address`);
      if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) fail("domain is a company domain, e.g. acme.com");
      const grants = [...people.map((email) => ({ type: "user", role, emailAddress: email })), ...groups.map((email) => ({ type: "group", role, emailAddress: email })),
        ...(domain ? [{ type: "domain", role, domain, allowFileDiscovery: false }] : []), ...(args.anyone ? [{ type: "anyone", role, allowFileDiscovery: false }] : [])];
      if (!grants.length) fail("say whom to share with: emails, groups, domain or anyone");
      if (grants.length > 50) fail("at most 50 grants at a time");
      const notify = args.notify !== false, message = text(args.message, 2000);
      const shared = [];
      for (const grant of grants) {
        const personal = grant.type === "user" || grant.type === "group";
        const made = await ctx.drive("POST", `/files/${id}/permissions`, { query: defined({ ...ALL, fields: "id,type,role,emailAddress,domain", sendNotificationEmail: personal ? notify : undefined, emailMessage: personal && notify && message ? message : undefined }), body: grant });
        shared.push(defined({ permission: made.id, type: made.type, role: made.role, email: made.emailAddress, domain: made.domain }));
      }
      const file = await getFile(ctx, id, "id,name,webViewLink");
      return { id: file.id, name: file.name, link: file.webViewLink, shared };
    },
  },
  {
    name: "drive_unshare", needs: "drive_write",
    description: () => "Google Drive: take away someone's access to a file or folder: by permission id (from drive_list_permissions), email, domain, or anyone to close the link. The owner's access cannot be removed.",
    parameters: { type: "object", properties: { account: ACCOUNT, file: FILE, permission: { type: "string" }, email: { type: "string" }, domain: { type: "string" }, anyone: { type: "boolean" } }, required: ["file"] },
    summarize: (args) => `${text(args.file, 80)} − ${text(args.email || args.domain || args.permission, 100) || (args.anyone ? "anyone" : "")}`,
    async run(args, ctx) {
      const id = fileId(args.file);
      const permissions = (await ctx.drive("GET", `/files/${id}/permissions`, { query: { ...ALL, fields: "permissions(id,type,role,emailAddress,domain)" } })).permissions || [];
      const email = text(args.email, 300).toLowerCase(), domain = text(args.domain, 200).toLowerCase(), wanted = text(args.permission, 200);
      if (!email && !domain && !wanted && !args.anyone) fail("say whose access to remove: permission, email, domain or anyone");
      const found = permissions.filter((item) => (wanted && item.id === wanted) || (email && String(item.emailAddress || "").toLowerCase() === email) || (domain && item.type === "domain" && String(item.domain || "").toLowerCase() === domain) || (args.anyone && item.type === "anyone"));
      if (!found.length) fail(`no such access on this file; it has: ${permissions.map((item) => `${item.emailAddress || item.domain || item.type} (${item.role}, ${item.id})`).join(", ") || "none"}`);
      if (found.some((item) => item.role === "owner")) fail("the owner's access cannot be removed");
      for (const item of found) await ctx.drive("DELETE", `/files/${id}/permissions/${encodeURIComponent(item.id)}`, { query: ALL });
      return { removed: found.map((item) => defined({ permission: item.id, type: item.type, role: item.role, email: item.emailAddress, domain: item.domain })) };
    },
  },
  {
    name: "drive_comment", needs: "drive_write",
    description: () => "Google Drive: comment on a file, or reply to one of its comments (reply_to), optionally resolving it. The comment carries the name of the connected account.",
    parameters: { type: "object", properties: { account: ACCOUNT, file: FILE, text: { type: "string" }, reply_to: { type: "string", description: "a comment id from drive_list_comments" }, resolve: { type: "boolean", description: "with reply_to: also mark the comment resolved" } }, required: ["file", "text"] },
    summarize: (args) => `${text(args.file, 80)}${args.reply_to ? ` ↩ ${text(args.reply_to, 40)}` : ""}`,
    async run(args, ctx) {
      const id = fileId(args.file), content = text(args.text, 30000), reply = text(args.reply_to, 200);
      if (!content) fail("text is required");
      if (args.resolve && !reply) fail("resolve needs reply_to: the comment to resolve");
      if (reply) {
        if (!/^[A-Za-z0-9_-]+$/.test(reply)) fail("reply_to is a comment id from drive_list_comments");
        const made = await ctx.drive("POST", `/files/${id}/comments/${reply}/replies`, { query: { fields: "id,content,createdTime,action" }, body: defined({ content, action: args.resolve ? "resolve" : undefined }) });
        return defined({ reply: made.id, comment: reply, resolved: made.action === "resolve" || undefined });
      }
      const made = await ctx.drive("POST", `/files/${id}/comments`, { query: { fields: "id,content,createdTime" }, body: { content } });
      return { comment: made.id };
    },
  },
  {
    name: "drive_api", needs: "drive",
    description: () => "Google Drive: any other call to the Drive API v3 of one of your accounts, when no drive_ tool does it: method and path under https://www.googleapis.com/drive/v3 (e.g. GET /about with query fields=storageQuota, GET /files/<id>/revisions). The account's scopes still limit it. Prefer the drive_ tools. Deleting files for good or emptying the trash is refused: drive_trash moves them to the trash.",
    parameters: { type: "object", properties: { account: ACCOUNT, method: { type: "string", enum: ["GET", "POST", "PATCH", "DELETE"] }, path: { type: "string", description: "e.g. /about" }, query: { type: "object" }, body: { type: "object" } }, required: ["path"] },
    summarize: (args) => `${text(args.method, 10) || "GET"} ${text(args.path, 150)}`,
    async run(args, ctx) {
      const path = text(args.path, 1000);
      if (!/^\/[A-Za-z0-9/_.-]*$/.test(path) || path.split("/").includes("..")) fail("path is a Drive API path under /drive/v3, e.g. /about");
      const method = text(args.method, 10).toUpperCase() || "GET";
      if (!["GET", "POST", "PATCH", "DELETE"].includes(method)) fail("method is GET, POST, PATCH or DELETE");
      const query = args.query && typeof args.query === "object" ? args.query : {};
      if (query.alt === "media") fail("drive_api answers JSON: use drive_download or drive_read_file for content");
      if (method === "DELETE" && /^\/(files\/[^/]+|files\/trash|drives\/[^/]+)\/?$/.test(path)) fail("deleting for good is not allowed here: drive_trash moves a file to the trash, where Google keeps it 30 days");
      return ctx.drive(method, path, { query, body: method === "GET" || method === "DELETE" ? undefined : args.body || {} });
    },
  },
];
