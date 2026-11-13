import http from "node:http";
import { mailWorld } from "./mail-fixtures.js";

export const FIRECRAWL_KEY = "fc-fixture-cora-team";
export const FIRECRAWL_ACCESS = "fco_fixture_cora_account";
export const FIRECRAWL_REFRESH = "fcr_fixture_cora_refresh";
const schema = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const definitions = [
  { name: "firecrawl_search", description: "Search the web", inputSchema: schema({ query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 10 } }, ["query"]) },
  { name: "firecrawl_scrape", description: "Read a page", inputSchema: schema({ url: { type: "string" }, formats: { type: "array", items: { type: "string" } } }, ["url"]) },
  { name: "firecrawl_parse", description: "Parse a document", inputSchema: schema({ filePath: { type: "string" } }) },
  ...["map", "crawl", "agent", "interact", "interact_stop", "monitor_create", "monitor_delete"].map((name) => ({ name: `firecrawl_${name}`, description: name, inputSchema: schema({ url: { type: "string" }, id: { type: "string" } }) })),
];

export async function fakeFirecrawl(t) {
  const calls = [], registrations = [], tokens = [], revocations = [];
  const state = { session: 0, expire: false, refuse: 0, revokeRefuse: false, repeatCursor: false, refreshCount: 0, revoke: false };
  let base;
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    let body = {}; try { body = JSON.parse(raw); } catch { body = Object.fromEntries(new URLSearchParams(raw)); }
    const url = new URL(req.url, base);
    const send = (status, data, headers = {}) => { res.writeHead(status, { "Content-Type": "application/json", ...headers }); res.end(data === undefined ? "" : JSON.stringify(data)); };
    if (url.pathname === "/register") {
      registrations.push(body); return send(201, { client_id: "fixture-firecrawl-client" });
    }
    if (url.pathname === "/authorize") {
      const target = new URL(url.searchParams.get("redirect_uri"));
      target.searchParams.set("state", url.searchParams.get("state")); target.searchParams.set("code", "fixture-code");
      res.writeHead(200, { "Content-Type": "text/html" }); res.end(`<title>Firecrawl test consent</title><link rel="icon" href="data:,"><a href="${target.href.replaceAll('&', '&amp;')}">Approve fixture team</a>`); return;
    }
    if (url.pathname === "/token") {
      tokens.push(body);
      if (body.client_id !== "fixture-firecrawl-client" || body.client_secret || !body.resource?.includes("mcp-oauth")) return send(400, { error: "invalid_client" });
      if (body.grant_type === "authorization_code") {
        if (body.code !== "fixture-code" || !body.code_verifier || !registrations.some((r) => r.redirect_uris.includes(body.redirect_uri))) return send(400, { error: "invalid_grant" });
        state.revoke = false;
        return send(200, { access_token: FIRECRAWL_ACCESS, refresh_token: FIRECRAWL_REFRESH, expires_in: 3600, user_id: "fixture-user", team_id: "fixture-team" });
      }
      if (body.grant_type === "refresh_token" && body.refresh_token === FIRECRAWL_REFRESH && state.refreshCount++ === 0) return send(200, { access_token: FIRECRAWL_ACCESS + "-renewed", refresh_token: FIRECRAWL_REFRESH + "-rotated", expires_in: 3600 });
      return send(400, { error: "invalid_grant" });
    }
    if (url.pathname === "/revoke") { revocations.push(body); if (state.revokeBarrier) await state.revokeBarrier; if (state.revokeRefuse) return send(503, { error: "unavailable" }); state.revoke = true; return send(200, {}); }
    if (url.pathname === "/v2/team/credit-usage") return send(req.headers.authorization === `Bearer ${FIRECRAWL_KEY}` ? 200 : 401, req.headers.authorization === `Bearer ${FIRECRAWL_KEY}` ? { success: true, data: { remainingCredits: 1000 } } : { success: false });
    if (!["/mcp", "/mcp-oauth"].includes(url.pathname)) return send(404, {});
    const credential = req.headers.authorization || "";
    const authenticated = [FIRECRAWL_KEY, FIRECRAWL_ACCESS, FIRECRAWL_ACCESS + "-renewed"].some((key) => credential === `Bearer ${key}`);
    calls.push({ ...body, credential, session: req.headers["mcp-session-id"], protocol: req.headers["mcp-protocol-version"] });
    if (body.method === "tools/call" && credential && (!authenticated || state.revoke)) return send(401, { error: "invalid credential" });
    if (body.method === "tools/call" && url.pathname === "/mcp-oauth" && !credential.startsWith("Bearer fco_")) return send(401, {});
    if (state.refuse && body.method === "tools/call") return send(state.refuse, { error: "fixture refusal" });
    if (body.method === "initialize") return send(200, { jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } } }, { "Mcp-Session-Id": `firecrawl-${++state.session}` });
    if (body.method === "notifications/initialized") return send(202);
    if (state.expire) { state.expire = false; return send(404, {}); }
    const reply = (result) => send(200, { jsonrpc: "2.0", id: body.id, result });
    if (body.method === "tools/list") {
      const tools = authenticated || credential.startsWith("Bearer fc-") ? definitions : definitions.slice(0, 3);
      return reply(body.params?.cursor ? { tools: tools.slice(2), ...(state.repeatCursor ? { nextCursor: "next" } : {}) } : { tools: tools.slice(0, 2), nextCursor: "next" });
    }
    if (body.method === "tools/call") {
      const { name, arguments: args } = body.params;
      if (!definitions.some((t) => t.name === name)) return reply({ isError: true, content: [{ type: "text", text: "unknown tool" }] });
      if (name === "firecrawl_parse") return reply({ content: [{ type: "image", mimeType: "image/png", data: Buffer.from("fixture-image").toString("base64") }] });
      if (args?.query === "echo-credential") return reply({ content: [{ type: "text", text: JSON.stringify({ credential }) }] });
      if (name === "firecrawl_search") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress" })}\n\nevent: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify({ web: [{ title: args.query, url: "https://example.test/news" }] }) }] } })}\n\n`); return;
      }
      return reply({ structuredContent: { markdown: "# Fixture page", name, args }, content: [] });
    }
    return send(400, {});
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); base = `http://127.0.0.1:${server.address().port}`;
  const close = async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); };
  t?.after(close);
  return { base, calls, registrations, tokens, revocations, state, definitions, close };
}

export async function firecrawlWorld(t = null) {
  const f = await mailWorld(t), remote = await fakeFirecrawl(t), connectors = f.app.keyConnectors;
  connectors.firecrawlRestApi = `${remote.base}/v2`;
  connectors.firecrawlApi = `${remote.base}/mcp`;
  connectors.firecrawlOAuthApi = `${remote.base}/mcp-oauth`;
  connectors.oauthUrls.firecrawl = Object.fromEntries(["authorize", "token", "register", "revoke"].map((name) => [name, `${remote.base}/${name}`]));
  const made = await f.call("/api/agents", { method: "POST", body: { name: "Firecrawl reviewer", tools: false } });
  const agent = f.app.store.agent(made.data.id);
  return { ...f, remote, connectors, agent, async connectOAuth() {
    const start = await f.call("/api/connectors/keys/firecrawl/authorize?mode=oauth", { method: "POST" });
    const url = new URL(start.data.url), state = url.searchParams.get("state");
    const record = await connectors.finishOAuth("firecrawl", { state, code: "fixture-code" }, state);
    return { record, url };
  } };
}
