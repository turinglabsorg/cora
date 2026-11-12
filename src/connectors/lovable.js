import { createHash } from "node:crypto";
import { count, defined, fail, list, localFile, FILE_PARAMS, text } from "./tooling.js";

/**
 * Lovable: the app builder exposes itself only as an MCP server (mcp.lovable.dev,
 * Streamable HTTP, OAuth 2.1). Cora is that MCP client: it holds the OAuth token in
 * the vault, opens the MCP session and turns every Lovable action into one Cora tool,
 * so an agent creates, edits, inspects and deploys Lovable projects without seeing the
 * token. The tools follow the official Cursor plugin's rules: read the diff before
 * saying a change is done, a pending deploy is not a live site, SQL runs with full rights.
 *
 * Two ways to authorise: an OAuth client registered in the Lovable workspace (it
 * returns to Cora's callback; project scopes need Business or Enterprise), or quick
 * access on any plan, where Cora registers itself as a loopback client and the owner
 * pastes back the address Lovable sent the browser to.
 */
const PROTOCOL = "2025-06-18";
const SCOPES = ["offline", "projects:read", "projects:write", "workspaces:read", "workspaces:write"];
const RESOURCE = "https://mcp.lovable.dev";
export const LOVABLE_LOOPBACK = "http://127.0.0.1:53682/cora/lovable/callback";

/** MCP sessions per token: initialised once, reused until they expire. */
const sessions = new Map();
const SESSION_MS = 10 * 60000;

const PROJECT = { type: "string", description: "project id, or its lovable.dev/projects URL" };
const WORKSPACE = { type: "string", description: "workspace id from lovable_list_workspaces" };
const CURSOR = { cursor: { type: "string", description: "pagination.next_cursor of the previous answer" }, limit: { type: "number", description: "default 25, at most 100" } };
const FILES = { type: "array", items: { type: "string" }, description: "file_id values from lovable_upload_file (images, mockups, data)" };

/** Uploaded files as Lovable wants them: objects with file_id (an id alone is enough). */
const fileRefs = (value) => {
  const items = (Array.isArray(value) ? value : value ? [value] : []).map((item) => typeof item === "string" ? { file_id: item.trim() } : item && typeof item === "object" ? defined({ file_id: text(item.file_id, 200), file_name: text(item.file_name, 200) || undefined, mime_type: text(item.mime_type, 120) || undefined, type: text(item.type, 40) || undefined }) : null).filter((item) => item?.file_id);
  return items.length ? items : undefined;
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** A project id from an id or any Lovable URL that carries it. */
const projectId = (value) => {
  const raw = text(value, 500);
  if (!raw) fail("project is required");
  const found = raw.match(UUID);
  if (found) return found[0].toLowerCase();
  if (/^[A-Za-z0-9_-]{6,80}$/.test(raw)) return raw;
  fail("project is a Lovable project id, or its lovable.dev/projects/<id> URL");
};
const idOf = (value, what) => {
  const id = text(value, 200);
  if (!id) fail(`${what} is required`);
  if (!/^[A-Za-z0-9_.:-]+$/.test(id)) fail(`${what} is a Lovable id`);
  return id;
};
const header = (headers, name) => {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name);
  return key ? String(headers[key]) : "";
};

/** The JSON-RPC answer inside a Streamable HTTP response: plain JSON, or the matching event of an SSE stream. */
export function rpcAnswer({ data, text: body, headers }, id) {
  if (data && typeof data === "object") return Array.isArray(data) ? data.find((item) => item?.id === id) || data[0] : data;
  const raw = typeof body === "string" ? body : "";
  if (!raw || !/event-stream/i.test(header(headers, "content-type")) && !/^\s*(event|data|id|:)/m.test(raw)) return null;
  let found = null;
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const payload = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join("\n");
    if (!payload) continue;
    let message;
    try { message = JSON.parse(payload); } catch { continue; }
    if (message && (message.id === id || (found === null && ("result" in message || "error" in message)))) found = message;
    if (message?.id === id) break;
  }
  return found;
}

const refusal = (status, data) => {
  const said = data?.error_description || data?.error?.message || data?.message || (typeof data?.error === "string" ? data.error : "");
  const detail = said ? `: ${String(said).slice(0, 1200)}` : "";
  if (status === 401) fail("Lovable refuses the authorisation: the owner connects Lovable again in Connettori");
  if (status === 403) fail(`Lovable answered 403${detail}: the authorisation may lack the scope, or the workspace blocks third-party MCP clients (Enterprise: Workspace settings → Privacy & security)`);
  if (status === 429) fail("Lovable limits the calls: try again in a minute");
  fail(`Lovable answered ${status || "nothing"}${detail}`);
};

/** The MCP client a tool works with: Cora's token, a session per token, one tools/call per action. */
export function client({ token, request, api, writeFile = null, record = null }) {
  const endpoint = api.lovable;
  const key = createHash("sha256").update(`${endpoint}\n${token}`).digest("hex").slice(0, 32);
  let serial = 0;
  const post = (message, session = "", timeout = 30000) => request(endpoint, {
    method: "POST",
    headers: { ...(record?.mode === "key" ? { "Lovable-API-Key": token } : { Authorization: `Bearer ${token}` }), "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": PROTOCOL, ...(session ? { "Mcp-Session-Id": session } : {}) },
    body: message, timeout,
  });
  const open = async () => {
    const cached = sessions.get(key);
    if (cached && cached.expires > Date.now()) return cached.id;
    const id = ++serial;
    const answer = await post({ jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "Cora", version: "1.0.0" } } });
    if (answer.status < 200 || answer.status >= 300) refusal(answer.status, answer.data);
    const reply = rpcAnswer(answer, id);
    if (!reply?.result) fail(`Lovable did not open the MCP session${reply?.error?.message ? `: ${reply.error.message}` : ""}`);
    const session = header(answer.headers, "mcp-session-id");
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }, session);
    for (const [name, item] of sessions) if (item.expires < Date.now()) sessions.delete(name);
    sessions.set(key, { id: session, expires: Date.now() + SESSION_MS });
    return session;
  };
  const rpc = async (method, params, timeout) => {
    for (let attempt = 0; ; attempt += 1) {
      const session = await open();
      const id = ++serial;
      const answer = await post({ jsonrpc: "2.0", id, method, params }, session, timeout);
      // An expired session answers 404: open a new one once.
      if (answer.status === 404 && session && attempt === 0) { sessions.delete(key); continue; }
      if (answer.status < 200 || answer.status >= 300) { if (answer.status === 401) sessions.delete(key); refusal(answer.status, answer.data); }
      const reply = rpcAnswer(answer, id);
      if (!reply) fail("Lovable gave no answer to the call");
      if (reply.error) fail(`Lovable: ${String(reply.error.message || reply.error.code || "error").slice(0, 1500)}`);
      sessions.set(key, { id: session, expires: Date.now() + SESSION_MS });
      return reply.result ?? {};
    }
  };
  /** Calls one Lovable tool and answers its structured result; images go to the agent's computer. */
  const tool = async (name, args = {}, { timeout = 60000 } = {}) => {
    const result = await rpc("tools/call", { name, arguments: defined(args) }, timeout);
    const content = Array.isArray(result.content) ? result.content : [];
    const words = content.filter((part) => part.type === "text").map((part) => part.text).join("\n").trim();
    if (result.isError) fail(`Lovable: ${words.slice(0, 2000) || "the tool failed"}`);
    let data = result.structuredContent;
    if (data === undefined && words) { try { data = JSON.parse(words); } catch { data = { text: words }; } }
    const images = content.filter((part) => part.type === "image" && part.data);
    if (images.length) {
      const saved = [];
      for (const [index, image] of images.entries()) {
        if (!writeFile) break;
        const extension = (String(image.mimeType || "image/png").split("/")[1] || "png").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "png";
        const path = `/home/agent/work/lovable/${name}-${Date.now()}-${index + 1}.${extension}`;
        try { await writeFile(path, Buffer.from(image.data, "base64")); saved.push(path); } catch { /* the text answer is still useful */ }
      }
      data = { ...(data && typeof data === "object" && !Array.isArray(data) ? data : { result: data }), images: saved.length ? saved : `${images.length} image(s) not saved` };
    }
    for (const part of content.filter((item) => item.type === "resource_link" || item.type === "resource")) {
      data = { ...(data && typeof data === "object" && !Array.isArray(data) ? data : { result: data }), resources: [...(data?.resources || []), defined({ uri: part.uri || part.resource?.uri, name: part.name, text: part.resource?.text?.slice(0, 20000) })] };
    }
    return data ?? {};
  };
  return { rpc, tool };
}

const waitTimeout = (args, fallback = 180) => {
  const seconds = count(args.timeout_seconds, fallback, 600);
  return { seconds, ms: (seconds + 30) * 1000 };
};

const TOOLS = [
  {
    name: "lovable_me",
    description: (record) => `Lovable${record.account ? `, acting as ${record.account}` : ""}. Start here: the connected account and its workspaces. Cora adds and renews the token for every Lovable tool; you never see it. Lovable's own agent writes the code: you send it instructions and verify the diff.`,
    parameters: { type: "object", properties: {} },
    run: (_args, ctx) => ctx.lovable.tool("get_me"),
  },
  {
    name: "lovable_list_workspaces",
    description: "Lovable: workspaces you belong to, with their ids (most tools need one).",
    parameters: { type: "object", properties: { ...CURSOR } },
    run: (args, ctx) => ctx.lovable.tool("list_workspaces", { limit: count(args.limit, 25, 100), cursor: text(args.cursor, 500) || undefined }),
  },
  {
    name: "lovable_get_workspace",
    description: "Lovable: one workspace: plan, credit balance, project count and your role.",
    parameters: { type: "object", properties: { workspace: WORKSPACE }, required: ["workspace"] },
    run: (args, ctx) => ctx.lovable.tool("get_workspace", { workspace_id: idOf(args.workspace, "workspace") }),
  },
  {
    name: "lovable_list_projects",
    description: "Lovable: search and list projects of a workspace, with editor and preview URLs.",
    parameters: { type: "object", properties: { workspace: WORKSPACE, query: { type: "string", description: "full-text search" }, publish_status: { type: "string" }, folder_id: { type: "string" }, viewed_by_me: { type: "boolean" }, ...CURSOR }, required: ["workspace"] },
    run: (args, ctx) => ctx.lovable.tool("list_projects", { workspace_id: idOf(args.workspace, "workspace"), query: text(args.query, 300) || undefined, publish_status: text(args.publish_status, 40) || undefined, folder_id: text(args.folder_id, 120) || undefined, viewed_by_me: typeof args.viewed_by_me === "boolean" ? args.viewed_by_me : undefined, limit: count(args.limit, 25, 100), cursor: text(args.cursor, 500) || undefined }),
  },
  {
    name: "lovable_get_project",
    description: "Lovable: one project: editor URL, preview URL, latest commit, whether its agent finished, and a screenshot saved on your computer when Lovable sends one.",
    parameters: { type: "object", properties: { project: PROJECT }, required: ["project"] },
    run: (args, ctx) => ctx.lovable.tool("get_project", { project_id: projectId(args.project) }),
  },
  {
    name: "lovable_create_project",
    description: "Lovable: create a project from a build brief (uses build credits). Describe the app, its first screen and main action; name integrations up front. Without workspace and with several eligible ones it answers available_workspaces instead. Identical retries within minutes are deduplicated: after a timeout look with lovable_list_projects, do not resend.",
    parameters: { type: "object", properties: { workspace: WORKSPACE, initial_message: { type: "string", description: "the build brief, the first message to Lovable's agent" }, template_project_id: { type: "string" }, design_systems: { type: "array", items: { type: "string" }, description: "ids from lovable_list_design_systems" }, files: FILES, wait: { type: "boolean", description: "default true: wait for the first build" }, timeout_seconds: { type: "number", description: "default 180, at most 600" } }, required: ["initial_message"] },
    summarize: (args) => `create ${JSON.stringify(text(args.initial_message, 80))}`,
    run(args, ctx) {
      const brief = text(args.initial_message, 100000);
      if (!brief) fail("initial_message is the build brief");
      const wait = waitTimeout(args);
      return ctx.lovable.tool("create_project", { workspace_id: text(args.workspace, 120) || undefined, initial_message: brief, template_project_id: text(args.template_project_id, 120) || undefined, design_systems: list(args.design_systems).length ? list(args.design_systems).map((id) => ({ project_id: id })) : undefined, files: fileRefs(args.files), wait: args.wait === false ? false : true, timeout_seconds: wait.seconds }, { timeout: wait.ms });
    },
  },
  {
    name: "lovable_send_message",
    description: "Lovable: send one change request to a project's agent, which edits the code and rebuilds the preview (uses build credits). One focused change per message; plan_mode=true discusses before editing. A reply saying it is done is not proof: check lovable_get_diff. status awaiting_input means it waits for a human approval (lovable_respond_to_approval).",
    parameters: { type: "object", properties: { project: PROJECT, message: { type: "string" }, plan_mode: { type: "boolean" }, files: FILES, wait: { type: "boolean", description: "default true; false answers at once, then poll lovable_get_message" }, timeout_seconds: { type: "number", description: "default 180, at most 600" } }, required: ["project", "message"] },
    summarize: (args) => `project ${text(args.project, 60)}${args.plan_mode ? " · plan" : ""}`,
    run(args, ctx) {
      const message = text(args.message, 100000);
      if (!message) fail("message is the change to request");
      const wait = waitTimeout(args);
      return ctx.lovable.tool("send_message", { project_id: projectId(args.project), message, plan_mode: args.plan_mode === true ? true : undefined, files: fileRefs(args.files), wait: args.wait === false ? false : true, timeout_seconds: wait.seconds }, { timeout: wait.ms });
    },
  },
  {
    name: "lovable_get_message",
    description: "Lovable: status and content of a message, waiting up to 55 s for it to finish, stop or pause. Use the ids lovable_send_message answered.",
    parameters: { type: "object", properties: { project: PROJECT, message_id: { type: "string" }, thread_id: { type: "string" }, wait_seconds: { type: "number", description: "0 to 55, default 30" } }, required: ["project", "message_id"] },
    run(args, ctx) {
      const seconds = Math.min(55, Math.max(0, Math.floor(Number(args.wait_seconds ?? 30)) || 0));
      return ctx.lovable.tool("get_message", { project_id: projectId(args.project), message_id: idOf(args.message_id, "message_id"), thread_id: text(args.thread_id, 120) || undefined, wait_seconds: seconds }, { timeout: (seconds + 30) * 1000 });
    },
  },
  {
    name: "lovable_list_messages",
    description: "Lovable: recent messages of a project, newest first, to find message ids.",
    parameters: { type: "object", properties: { project: PROJECT, ...CURSOR }, required: ["project"] },
    run: (args, ctx) => ctx.lovable.tool("list_messages", { project_id: projectId(args.project), limit: count(args.limit, 25, 100), cursor: text(args.cursor, 500) || undefined }),
  },
  {
    name: "lovable_respond_to_approval",
    description: "Lovable: answer a tool approval the project's agent paused on (awaiting_input). Show the person the tool and its params first and pass their decision: never decide for them.",
    parameters: { type: "object", properties: { project: PROJECT, message_id: { type: "string", description: "the user message the pause was reported on" }, event_id: { type: "string" }, decision: { type: "string", enum: ["approved", "rejected"] }, user_input: { type: "string" }, wait: { type: "boolean" }, timeout_seconds: { type: "number" } }, required: ["project", "message_id", "event_id", "decision"] },
    run(args, ctx) {
      if (!["approved", "rejected"].includes(args.decision)) fail("decision is approved or rejected");
      const wait = waitTimeout(args);
      return ctx.lovable.tool("respond_to_approval", { project_id: projectId(args.project), message_id: idOf(args.message_id, "message_id"), event_id: idOf(args.event_id, "event_id"), decision: args.decision, user_input: text(args.user_input, 10000) || undefined, wait: args.wait === false ? false : true, timeout_seconds: wait.seconds }, { timeout: wait.ms });
    },
  },
  {
    name: "lovable_get_diff",
    description: "Lovable: the unified diff of a message, of a commit, or between two commits. Read it before saying a change is done.",
    parameters: { type: "object", properties: { project: PROJECT, message_id: { type: "string" }, sha: { type: "string" }, base_sha: { type: "string" } }, required: ["project"] },
    run(args, ctx) {
      if (!args.message_id && !args.sha) fail("give message_id or sha");
      return ctx.lovable.tool("get_diff", { project_id: projectId(args.project), message_id: text(args.message_id, 120) || undefined, sha: text(args.sha, 80) || undefined, base_sha: text(args.base_sha, 80) || undefined });
    },
  },
  {
    name: "lovable_list_files",
    description: "Lovable: a page of the project's files at a git ref (default the latest).",
    parameters: { type: "object", properties: { project: PROJECT, ref: { type: "string" }, ...CURSOR }, required: ["project"] },
    run: (args, ctx) => ctx.lovable.tool("list_files", { project_id: projectId(args.project), ref: text(args.ref, 120) || undefined, limit: count(args.limit, 100, 100), cursor: text(args.cursor, 500) || undefined }),
  },
  {
    name: "lovable_read_file",
    description: "Lovable: one file of the project at a git ref (latest_commit_sha from lovable_get_project). Read only: changes go through lovable_send_message.",
    parameters: { type: "object", properties: { project: PROJECT, path: { type: "string", description: "e.g. src/App.tsx" }, ref: { type: "string" } }, required: ["project", "path"] },
    run(args, ctx) {
      const path = text(args.path, 500).replace(/^\/+/, "");
      if (!path || path.split("/").includes("..")) fail("path is a file path inside the project, e.g. src/App.tsx");
      return ctx.lovable.tool("read_file", { project_id: projectId(args.project), path, ref: text(args.ref, 120) || undefined });
    },
  },
  {
    name: "lovable_list_edits",
    description: "Lovable: the project's edit history with commit SHAs, newest first.",
    parameters: { type: "object", properties: { project: PROJECT, ...CURSOR }, required: ["project"] },
    run: (args, ctx) => ctx.lovable.tool("list_edits", { project_id: projectId(args.project), limit: count(args.limit, 20, 50), cursor: text(args.cursor, 500) || undefined }),
  },
  {
    name: "lovable_deploy_project",
    description: "Lovable: publish the project on lovable.app (final: a public URL unless the workspace restricts it). Verify the change in the diff first. The answer is pending: a URL does not prove the site is live, open it before saying so.",
    parameters: { type: "object", properties: { project: PROJECT, name: { type: "string", description: "optional subdomain name" } }, required: ["project"] },
    run: (args, ctx) => ctx.lovable.tool("deploy_project", { project_id: projectId(args.project), name: text(args.name, 80) || undefined }, { timeout: 120000 }),
  },
  {
    name: "lovable_remix_project",
    description: "Lovable: copy a project into a workspace, e.g. to experiment without touching a live app. After a timeout look for the copy with lovable_list_projects instead of retrying.",
    parameters: { type: "object", properties: { project: PROJECT, workspace: WORKSPACE, project_name: { type: "string" }, include_history: { type: "boolean" }, include_custom_knowledge: { type: "boolean" }, timeout_seconds: { type: "number" } }, required: ["project", "workspace"] },
    run(args, ctx) {
      const wait = waitTimeout(args, 120);
      return ctx.lovable.tool("remix_project", { project_id: projectId(args.project), workspace_id: idOf(args.workspace, "workspace"), project_name: text(args.project_name, 120) || undefined, include_history: typeof args.include_history === "boolean" ? args.include_history : undefined, include_custom_knowledge: typeof args.include_custom_knowledge === "boolean" ? args.include_custom_knowledge : undefined, timeout_seconds: wait.seconds }, { timeout: wait.ms });
    },
  },
  {
    name: "lovable_set_project_visibility",
    description: "Lovable: who can open the project in the editor (not who visits the published app): restricted, workspace_edit or workspace_view.",
    parameters: { type: "object", properties: { project: PROJECT, visibility: { type: "string", enum: ["restricted", "workspace_edit", "workspace_view"] } }, required: ["project", "visibility"] },
    run(args, ctx) {
      if (!["restricted", "workspace_edit", "workspace_view"].includes(args.visibility)) fail("visibility is restricted, workspace_edit or workspace_view");
      return ctx.lovable.tool("set_project_visibility", { project_id: projectId(args.project), visibility: args.visibility });
    },
  },
  {
    name: "lovable_move_projects",
    description: "Lovable: move up to 30 projects into a workspace folder.",
    parameters: { type: "object", properties: { workspace: WORKSPACE, folder_id: { type: "string" }, projects: { type: "array", items: { type: "string" } } }, required: ["workspace", "folder_id", "projects"] },
    run(args, ctx) {
      const ids = list(args.projects).map(projectId);
      if (!ids.length || ids.length > 30) fail("projects is 1 to 30 project ids");
      return ctx.lovable.tool("move_projects_to_folder", { workspace_id: idOf(args.workspace, "workspace"), folder_id: idOf(args.folder_id, "folder_id"), project_ids: ids });
    },
  },
  {
    name: "lovable_set_folder_visibility",
    description: "Lovable: make a folder personal or shared with the workspace; it applies to every project in it.",
    parameters: { type: "object", properties: { workspace: WORKSPACE, folder_id: { type: "string" }, visibility: { type: "string", enum: ["personal", "workspace"] } }, required: ["workspace", "folder_id", "visibility"] },
    run(args, ctx) {
      if (!["personal", "workspace"].includes(args.visibility)) fail("visibility is personal or workspace");
      return ctx.lovable.tool("set_folder_visibility", { workspace_id: idOf(args.workspace, "workspace"), folder_id: idOf(args.folder_id, "folder_id"), visibility: args.visibility });
    },
  },
  {
    name: "lovable_list_templates",
    description: "Lovable: project templates (template_project_id for lovable_create_project) and the workspace's design systems.",
    parameters: { type: "object", properties: { workspace: WORKSPACE }, required: ["workspace"] },
    async run(args, ctx) {
      const workspace_id = idOf(args.workspace, "workspace");
      const [templates, designSystems] = await Promise.all([ctx.lovable.tool("list_template_projects", { workspace_id }), ctx.lovable.tool("list_design_systems", { workspace_id }).catch((error) => ({ error: error.message }))]);
      return { templates, design_systems: designSystems };
    },
  },
  {
    name: "lovable_get_knowledge",
    description: "Lovable: the standing instructions Lovable's agent follows, of one project or of a whole workspace.",
    parameters: { type: "object", properties: { project: PROJECT, workspace: WORKSPACE } },
    run(args, ctx) {
      if (args.project) return ctx.lovable.tool("get_project_knowledge", { project_id: projectId(args.project) });
      if (args.workspace) return ctx.lovable.tool("get_workspace_knowledge", { workspace_id: idOf(args.workspace, "workspace") });
      fail("give project or workspace");
    },
  },
  {
    name: "lovable_set_knowledge",
    description: "Lovable: replace the standing instructions of one project or of a workspace (at most 10,000 characters). It replaces everything: read them with lovable_get_knowledge first and keep what still holds; clear=true empties them.",
    parameters: { type: "object", properties: { project: PROJECT, workspace: WORKSPACE, content: { type: "string" }, clear: { type: "boolean" } } },
    run(args, ctx) {
      const content = args.clear === true ? "" : String(args.content ?? "");
      if (!content.trim() && args.clear !== true) fail("content is the whole new text of the instructions; clear=true empties them");
      if (content.length > 10000) fail("content is at most 10,000 characters");
      if (args.project && args.workspace) fail("give project or workspace, not both");
      if (args.project) return ctx.lovable.tool("set_project_knowledge", { project_id: projectId(args.project), content });
      if (args.workspace) return ctx.lovable.tool("set_workspace_knowledge", { workspace_id: idOf(args.workspace, "workspace"), content });
      fail("give project or workspace");
    },
  },
  {
    name: "lovable_list_skills",
    description: "Lovable: the workspace's skills, reusable instructions for Lovable's agent; with include_markdown their full text.",
    parameters: { type: "object", properties: { workspace: WORKSPACE, include_markdown: { type: "boolean" } }, required: ["workspace"] },
    run: (args, ctx) => ctx.lovable.tool("list_workspace_skills", { workspace_id: idOf(args.workspace, "workspace"), include_markdown: args.include_markdown === true ? true : undefined }),
  },
  {
    name: "lovable_save_skill",
    description: "Lovable: create a workspace skill, or replace it when it exists (admins and owners). markdown is the whole SKILL.md with name and description frontmatter matching skill_name.",
    parameters: { type: "object", properties: { workspace: WORKSPACE, skill_name: { type: "string" }, markdown: { type: "string" } }, required: ["workspace", "skill_name", "markdown"] },
    async run(args, ctx) {
      const workspace_id = idOf(args.workspace, "workspace"), skill_name = text(args.skill_name, 120), markdown = String(args.markdown ?? "");
      if (!skill_name || !markdown.trim()) fail("skill_name and markdown are required");
      const listed = await ctx.lovable.tool("list_workspace_skills", { workspace_id });
      const skills = Array.isArray(listed) ? listed : listed?.skills || listed?.items || [];
      const exists = skills.some((item) => String(item?.name || item?.skill_name || "").toLowerCase() === skill_name.toLowerCase());
      return { [exists ? "updated" : "created"]: skill_name, result: await ctx.lovable.tool(exists ? "update_workspace_skill" : "create_workspace_skill", { workspace_id, skill_name, markdown }) };
    },
  },
  {
    name: "lovable_delete_skill",
    description: "Lovable: delete a workspace skill (final; admins and owners). Only when asked.",
    parameters: { type: "object", properties: { workspace: WORKSPACE, skill_name: { type: "string" } }, required: ["workspace", "skill_name"] },
    run: (args, ctx) => ctx.lovable.tool("delete_workspace_skill", { workspace_id: idOf(args.workspace, "workspace"), skill_name: text(args.skill_name, 120) || fail("skill_name is required") }),
  },
  {
    name: "lovable_database_status",
    description: "Lovable: whether the project's Lovable Cloud database (Postgres) is enabled.",
    parameters: { type: "object", properties: { project: PROJECT }, required: ["project"] },
    run: (args, ctx) => ctx.lovable.tool("get_database_status", { project_id: projectId(args.project) }),
  },
  {
    name: "lovable_enable_database",
    description: "Lovable: provision the project's Lovable Cloud database (30 to 60 s). For tables the app uses, ask Lovable's agent with lovable_send_message so code and schema move together.",
    parameters: { type: "object", properties: { project: PROJECT }, required: ["project"] },
    run: (args, ctx) => ctx.lovable.tool("enable_database", { project_id: projectId(args.project) }, { timeout: 150000 }),
  },
  {
    name: "lovable_query_database",
    description: "Lovable: run SQL on the project's real database with full rights (read, write, schema). Explore with SELECT of the columns you need and a LIMIT. Run DELETE, DROP, TRUNCATE, ALTER or any write only when the person asked for exactly that, after showing them the SQL; report the rows affected.",
    parameters: { type: "object", properties: { project: PROJECT, sql: { type: "string" } }, required: ["project", "sql"] },
    summarize: (args) => `project ${text(args.project, 60)} · ${text(args.sql, 60).split(/\s+/)[0]?.toUpperCase() || "SQL"}`,
    run(args, ctx) {
      const sql = text(args.sql, 200000);
      if (!sql) fail("sql is required");
      return ctx.lovable.tool("query_database", { project_id: projectId(args.project), sql }, { timeout: 120000 });
    },
  },
  {
    name: "lovable_list_connectors",
    description: "Lovable: the integrations Lovable's agent can use in a workspace (standard, seamless and MCP), with what is enabled, plus the MCP connectors already added. Adding one happens in the Lovable dashboard: lovable_mcp add_connector answers its URL for the person.",
    parameters: { type: "object", properties: { workspace: WORKSPACE }, required: ["workspace"] },
    async run(args, ctx) {
      const workspace_id = idOf(args.workspace, "workspace");
      const [available, added] = await Promise.all([ctx.lovable.tool("list_connectors", { workspace_id }), ctx.lovable.tool("list_custom_connectors", { workspace_id }).catch((error) => ({ error: error.message }))]);
      return { connectors: available, added };
    },
  },
  {
    name: "lovable_analytics",
    description: "Lovable: traffic of a published project. With start_date and end_date (RFC 3339) the history: visits, page views, bounce rate, pages, sources, devices, countries; without them the live visitors of the last 30 minutes.",
    parameters: { type: "object", properties: { project: PROJECT, start_date: { type: "string" }, end_date: { type: "string" }, granularity: { type: "string", enum: ["hourly", "daily"] } }, required: ["project"] },
    run(args, ctx) {
      const project_id = projectId(args.project);
      if (!args.start_date && !args.end_date) return ctx.lovable.tool("get_project_analytics_trend", { project_id });
      if (!args.start_date || !args.end_date) fail("give both start_date and end_date, or neither for live traffic");
      return ctx.lovable.tool("get_project_analytics", { project_id, start_date: text(args.start_date, 40), end_date: text(args.end_date, 40), granularity: args.granularity });
    },
  },
  {
    name: "lovable_upload_file",
    description: "Lovable: upload a file from your computer (screenshot, mockup, wireframe, data) and answer its file_id, to pass in files of lovable_send_message or lovable_create_project.",
    parameters: { type: "object", properties: { ...FILE_PARAMS }, required: ["path"] },
    summarize: (args) => text(args.path, 120).split("/").pop(),
    async run(args, ctx) {
      const file = await localFile(args, ctx);
      const slot = await ctx.lovable.tool("get_file_upload_url", { file_name: file.filename, content_type: file.contentType });
      const url = slot?.url || slot?.upload_url;
      const fileId = slot?.file_id || slot?.fileId || slot?.id;
      if (!url || !fileId) fail("Lovable did not give an upload address");
      let target;
      try { target = new URL(url); } catch { fail("Lovable gave an invalid upload address"); }
      if (target.protocol !== "https:" && !ctx.allowHttpUpload) fail("Lovable gave an upload address that is not https");
      const headers = { ...(slot.headers && typeof slot.headers === "object" ? slot.headers : {}), "Content-Type": file.contentType };
      const answer = await ctx.request(url, { method: "PUT", headers, raw: file.bytes, timeout: 120000 });
      if (answer.status < 200 || answer.status >= 300) fail(`the upload to Lovable answered ${answer.status}`);
      return { file_id: fileId, name: file.filename, bytes: file.bytes.length, content_type: file.contentType };
    },
  },
  {
    name: "lovable_mcp",
    description: "Lovable fallback, only for what the other lovable_ tools do not cover: call any tool of the Lovable MCP server by name (e.g. grep_files, send_feedback, add_connector, remove_connector, list_connections) with its arguments; name \"tools/list\" lists the server's tools with their parameters.",
    parameters: { type: "object", properties: { name: { type: "string", description: "a Lovable MCP tool name, or tools/list" }, arguments: { type: "object" } }, required: ["name"] },
    summarize: (args) => text(args.name, 80),
    async run(args, ctx) {
      const name = text(args.name, 80);
      if (name === "tools/list") {
        const tools = [];
        let cursor;
        do {
          const page = await ctx.lovable.rpc("tools/list", cursor ? { cursor } : {});
          for (const item of page.tools || []) tools.push(defined({ name: item.name, description: String(item.description || "").slice(0, 400), parameters: item.inputSchema?.properties ? Object.fromEntries(Object.entries(item.inputSchema.properties).map(([key, value]) => [key, value?.type || "any"])) : undefined, required: item.inputSchema?.required }));
          cursor = page.nextCursor;
        } while (cursor && tools.length < 500);
        return { tools };
      }
      if (!/^[A-Za-z0-9_.:-]{2,80}$/.test(name)) fail("name is a Lovable MCP tool name, e.g. grep_files, or tools/list");
      const params = args.arguments && typeof args.arguments === "object" && !Array.isArray(args.arguments) ? args.arguments : {};
      return ctx.lovable.tool(name, params, { timeout: ["send_message", "create_project", "remix_project", "respond_to_approval"].includes(name) ? 630000 : 120000 });
    },
  },
];

export const lovable = {
  id: "lovable",
  name: "Lovable",
  secret: "CORA_LOVABLE_TOKEN",
  appSecrets: ["CORA_LOVABLE_CLIENT_ID", "CORA_LOVABLE_CLIENT_SECRET"],
  label: "account",
  oauth: {
    authorize: "https://lovable.dev/oauth/authorize",
    token: "https://lovable.dev/oauth/token",
    register: "https://lovable.dev/oauth/register",
    scopes: SCOPES,
    clientAuth: "body",
    params: { resource: RESOURCE },
    tokenParams: { resource: RESOURCE },
    // Quick access: Lovable registers clients on its own only with a loopback address.
    loopback: LOVABLE_LOOPBACK,
    async identify({ access, request, api, mode }) {
      const me = await client({ token: access, request, api, record: { mode } }).tool("get_me");
      const user = me?.user || me?.profile || me;
      const workspaces = Array.isArray(me?.workspaces) ? me.workspaces : [];
      return {
        workspace: String(workspaces.map((item) => item?.name).filter(Boolean).join(", ") || "").slice(0, 120),
        account: String(user?.email || user?.name || user?.display_name || user?.username || "").slice(0, 120),
      };
    },
  },
  card: {
    icon: "spark",
    description: "Gli agenti creano, modificano e pubblicano app su Lovable.",
    meta: "Lovable · App",
    intro: "Gli agenti creano progetti Lovable, chiedono modifiche al suo agente, ne leggono il codice e le differenze, gestiscono il database e pubblicano. Lavorano con il tuo account Lovable e usano i tuoi crediti.",
    writes: { oauth: "Il tuo account Lovable: progetti, messaggi e pubblicazioni risultano fatti da te.", key: "Il tuo account Lovable: progetti, messaggi e pubblicazioni risultano fatti da te." },
    modes: [
      {
        id: "quick",
        label: "Accesso rapido",
        intro: "Funziona con ogni piano Lovable. Cora si registra su Lovable come client locale: dopo il consenso Lovable apre una pagina su 127.0.0.1 che non si carica, ed è normale. Incolla qui il suo indirizzo e Cora completa il collegamento.",
        notice: "Gli agenti agiscono con il tuo account: creare progetti e mandare messaggi consuma crediti Lovable, e la pubblicazione rende l'app raggiungibile.",
        body: { mode: "quick" },
        rows: [
          { title: "1. Autorizza su Lovable", steps: [
            "premi «Apri Lovable»: si apre una nuova scheda con la pagina di consenso;",
            "accedi con il tuo account Lovable e accetta;",
            "la scheda finisce su un indirizzo che inizia con http://127.0.0.1 e mostra un errore di connessione: copia tutto l'indirizzo dalla barra.",
          ], authorize: "Apri Lovable" },
          { title: "2. Incolla l'indirizzo", hint: "Vale 15 minuti. Cora ne usa solo il codice monouso, poi salva i token nella cassaforte come CORA_LOVABLE_TOKEN.", field: { name: "returned", type: "text", label: "Indirizzo della pagina di arrivo", placeholder: "http://127.0.0.1:53682/cora/lovable/callback?code=…" }, submit: "Completa il collegamento" },
        ],
      },
      {
        id: "key",
        label: "Chiave API",
        intro: "Una chiave API del workspace Lovable: la più semplice, se il piano la offre. Vale per un solo workspace.",
        notice: "Le chiavi API esistono sui piani Business ed Enterprise e le crea un admin o il proprietario del workspace.",
        body: { mode: "key" },
        rows: [
          { title: "La chiave", steps: [
            ["apri ", { href: "https://lovable.dev/settings/api-keys", text: "Impostazioni del workspace → API keys & OAuth" }, " → API keys → nuova chiave con permesso Read & write;"],
            ["incollala qui: Cora la prova su Lovable e la salva nella cassaforte come ", { code: "CORA_LOVABLE_TOKEN" }, "."],
          ], field: { name: "token", type: "password", label: "Chiave API di Lovable", placeholder: "lov_…" }, submit: "Verifica e collega" },
        ],
      },
      {
        id: "oauth",
        label: "App OAuth",
        ready: "app",
        intro: "Un client OAuth registrato nel tuo workspace Lovable: dopo il consenso Lovable torna direttamente su Cora.",
        notice: "Lo registra un admin o il proprietario del workspace. Gli scope progetti e workspace richiedono un piano Business o Enterprise.",
        body: { mode: "oauth" },
        rows: [
          { title: "Il client OAuth", steps: [
            ["apri ", { href: "https://lovable.dev/settings/api-keys", text: "Impostazioni del workspace → API keys & OAuth" }, " → OAuth clients → nuovo client di tipo Web server;"],
            ["come indirizzo di ritorno aggiungi ", { redirect: true }, ";"],
            ["scegli gli scope ", { code: "offline" }, ", ", { code: "projects:read" }, ", ", { code: "projects:write" }, ", ", { code: "workspaces:read" }, " e ", { code: "workspaces:write" }, ";"],
            ["incolla qui client ID e client secret: finiscono nella cassaforte come ", { code: "CORA_LOVABLE_CLIENT_ID" }, " e ", { code: "CORA_LOVABLE_CLIENT_SECRET" }, ";"],
            "poi premi «Autorizza Lovable» e accetta con il tuo account.",
          ], fields: [
            { name: "clientId", type: "text", title: "Client ID", label: "Client ID del client OAuth Lovable" },
            { name: "clientSecret", type: "password", title: "Client secret", label: "Client secret del client OAuth Lovable" },
          ], submit: "Salva il client" },
        ],
      },
    ],
  },
  tools: TOOLS,
  context(ctx) { return { ...ctx, lovable: client(ctx) }; },
};
