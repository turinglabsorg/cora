import http from "node:http";

export const LOVABLE_TOKEN = "lovable_fixture_access";
export const LOVABLE_PROJECT = "0b7c2d4e-1111-4222-8333-944455556666";

/** A small Lovable: the MCP server (sessions, JSON and SSE answers), its OAuth endpoints and an upload target. */
export async function fakeLovable(t, { token = LOVABLE_TOKEN } = {}) {
  const calls = [], tokens = [], registrations = [], uploads = [];
  const state = { sessions: new Set(), serial: 0, expireNext: false, access: token, refreshed: 0, workspaces: [{ id: "ws1", name: "Dopamina" }] };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url, "http://lovable.test");
    const json = (status, value, headers = {}) => { res.writeHead(status, { "Content-Type": "application/json", ...headers }); res.end(JSON.stringify(value)); };
    if (url.pathname === "/oauth/register" && req.method === "POST") {
      const body = JSON.parse(raw.toString("utf8"));
      registrations.push(body);
      if (!body.redirect_uris.every((uri) => /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(uri))) return json(400, { error: "invalid_redirect_uri", error_description: "Open dynamic client registration is limited to loopback" });
      return json(201, { client_id: "quick-client-fixture", token_endpoint_auth_method: "none", redirect_uris: body.redirect_uris });
    }
    if (url.pathname === "/oauth/token" && req.method === "POST") {
      const body = Object.fromEntries(new URLSearchParams(raw.toString("utf8")));
      tokens.push({ body, authorization: req.headers.authorization || "" });
      const clientOk = (body.client_id === "quick-client-fixture" && !body.client_secret) || (body.client_id === "app-client" && body.client_secret === "app-secret");
      if (!clientOk || body.resource !== "https://mcp.lovable.dev") return json(400, { error: "invalid_client" });
      if (body.grant_type === "authorization_code" && body.code === "good-code" && body.code_verifier) return json(200, { access_token: state.access, refresh_token: "lovable_refresh_fixture", expires_in: 3600, token_type: "Bearer" });
      if (body.grant_type === "refresh_token" && body.refresh_token === "lovable_refresh_fixture") { state.refreshed += 1; return json(200, { access_token: state.access, refresh_token: "lovable_refresh_fixture", expires_in: 3600 }); }
      return json(400, { error: "invalid_grant" });
    }
    if (url.pathname === "/upload" && req.method === "PUT") { uploads.push({ bytes: raw.toString("utf8"), type: req.headers["content-type"], extra: req.headers["x-upload-check"] }); res.writeHead(200); return res.end(); }
    if (url.pathname !== "/mcp/") return json(404, {});
    const keyed = req.headers["lovable-api-key"] === "lov_fixture_key";
    if (keyed) state.keyed = (state.keyed || 0) + 1;
    if (!keyed && req.headers.authorization !== `Bearer ${state.access}`) return json(401, { error: "invalid_token" }, { "WWW-Authenticate": "Bearer resource_metadata=\"https://mcp.lovable.dev/.well-known/oauth-protected-resource\"" });
    if (!String(req.headers.accept || "").includes("text/event-stream")) return json(406, { error: { message: "Accept must include text/event-stream" } });
    const message = JSON.parse(raw.toString("utf8"));
    const session = req.headers["mcp-session-id"];
    calls.push({ method: message.method, name: message.params?.name, args: message.params?.arguments, session, version: req.headers["mcp-protocol-version"] });
    if (message.method === "initialize") {
      const id = `sess-${++state.serial}`;
      state.sessions.add(id);
      return json(200, { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "lovable", version: "0.1.3" } } }, { "Mcp-Session-Id": id });
    }
    if (!state.sessions.has(session)) return json(404, { jsonrpc: "2.0", error: { code: -32001, message: "Session not found" } });
    if (message.method === "notifications/initialized") { res.writeHead(202); return res.end(); }
    if (state.expireNext) { state.expireNext = false; state.sessions.delete(session); return json(404, { jsonrpc: "2.0", error: { code: -32001, message: "Session not found" } }); }
    const sse = (result) => { res.writeHead(200, { "Content-Type": "text/event-stream" }); res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progress: 1 } })}\n\n`); res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n\n`); };
    const ok = (data) => json(200, { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data } });
    if (message.method === "tools/list") return json(200, { jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "grep_files", description: "Search committed files", inputSchema: { type: "object", properties: { project_id: { type: "string" }, query: { type: "string" } }, required: ["project_id", "query"] } }] } });
    if (message.method !== "tools/call") return json(200, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
    const { name, arguments: args = {} } = message.params;
    if (name === "get_me") return ok({ user: { id: "u1", email: "seb@example.test", name: "Seb" }, workspaces: state.workspaces });
    if (name === "list_workspaces") return ok({ workspaces: state.workspaces, pagination: {} });
    if (name === "list_projects") return ok({ projects: [{ id: LOVABLE_PROJECT, workspace_id: args.workspace_id }], pagination: {} });
    if (name === "get_project") return json(200, { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: JSON.stringify({ id: args.project_id, editor_url: `https://lovable.dev/projects/${args.project_id}`, preview_url: "https://preview.lovable.app", latest_commit_sha: "abc123" }) }, { type: "image", mimeType: "image/png", data: Buffer.from("PNGDATA").toString("base64") }] } });
    if (name === "send_message") return sse({ content: [{ type: "text", text: JSON.stringify({ message_id: "m1", status: args.wait === false ? "running" : "completed", plan_mode: Boolean(args.plan_mode) }) }] });
    if (name === "get_diff") return ok({ diff: "--- a/src/App.tsx\n+++ b/src/App.tsx\n+dark mode" });
    if (name === "query_database") return args.sql.startsWith("DROP") ? json(200, { jsonrpc: "2.0", id: message.id, result: { isError: true, content: [{ type: "text", text: "permission denied for schema public" }] } }) : ok({ rows: [{ n: 3 }], row_count: 1 });
    if (name === "get_file_upload_url") return ok({ url: `http://127.0.0.1:${server.address().port}/upload`, file_id: "file-1", headers: { "x-upload-check": "yes" } });
    if (name === "list_workspace_skills") return ok({ skills: [{ name: "brand" }] });
    if (name === "update_workspace_skill" || name === "create_workspace_skill") return ok({ ok: true, name: args.skill_name });
    if (name === "get_project_analytics_trend") return ok({ live: 2 });
    if (name === "deploy_project") return ok({ status: "pending", deployment_id: "d1", url: "https://app.lovable.app" });
    return json(200, { jsonrpc: "2.0", id: message.id, error: { code: -32602, message: `Unknown tool: ${name}` } });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, mcp: `${base}/mcp/`, calls, tokens, registrations, uploads, state, toolCalls: () => calls.filter((call) => call.method === "tools/call") };
}
