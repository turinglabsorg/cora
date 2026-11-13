import assert from "node:assert/strict";
import { test } from "node:test";
import { firecrawlWorld, fakeFirecrawl, FIRECRAWL_KEY, FIRECRAWL_ACCESS, FIRECRAWL_REFRESH } from "./firecrawl-fixtures.js";
import { client, inspect } from "../src/connectors/firecrawl/index.js";
import { rpcAnswer } from "../src/connectors/remote-mcp.js";
import { connectorCatalog } from "../src/connectors/index.js";
import { panelHarness } from "./panel.js";
import { waitFor } from "./helpers.js";

const request = async (url, { body, headers, timeout = 30000 } = {}) => {
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { /* SSE */ }
  return { status: r.status, headers: Object.fromEntries(r.headers), text, data };
};

test("Firecrawl discovers exact server schemas and preserves keyless transport, pagination and session recovery", async (t) => {
  const remote = await fakeFirecrawl(t), ctx = { request, api: { firecrawl: `${remote.base}/mcp` } };
  const read = await inspect(ctx);
  assert.equal(read.remoteTools.length, 3);
  assert.deepEqual(read.remoteTools[0].parameters, remote.definitions[0].inputSchema);
  assert.ok(remote.calls.every((c) => !c.credential), "keyless sends no empty bearer header");
  const c = client(ctx);
  assert.equal((await c.tool("firecrawl_search", { query: "Cora" })).web[0].title, "Cora");
  remote.state.expire = true;
  assert.equal((await c.tool("firecrawl_scrape", { url: "https://example.test" })).markdown, "# Fixture page");
  assert.equal(remote.state.session, 2);
  remote.state.repeatCursor = true;
  await assert.rejects(inspect(ctx), /pagination/);
});

test("Firecrawl checks keys before storage, authorises tools per agent and redacts credentials from output", async (t) => {
  const f = await firecrawlWorld(t);
  const initial = await f.call("/api/connectors");
  assert.ok(initial.data.catalog.some((c) => c.id === "firecrawl"));
  for (const token of ["invalid-fixture", "fc-00000000-0000-0000-0000-000000000000"]) {
    const unchecked = await inspect({ token, request, api: { firecrawl: `${f.remote.base}/mcp` } });
    assert.ok(unchecked.remoteTools.length >= 3, "the actual MCP catalog accepts an invalid key");
    assert.equal((await f.call("/api/connectors/keys/firecrawl", { method: "POST", body: { mode: "key", token } })).status, 400);
  }
  assert.equal(f.app.store.vaultSecret("CORA_FIRECRAWL_TOKEN"), null);
  const made = await f.call("/api/connectors/keys/firecrawl", { method: "POST", body: { mode: "key", token: FIRECRAWL_KEY } });
  assert.equal(made.status, 200);
  assert.doesNotMatch(JSON.stringify(made.data), /fc-fixture/);
  assert.deepEqual(f.connectors.toolsFor(f.agent), []);
  const denied = await f.connectors.runTool(f.agent, "firecrawl_search", { query: "news" });
  assert.match(denied.text, /not authorised/);
  await f.call("/api/connectors/keys/firecrawl", { method: "PUT", body: { agents: [f.agent.id] } });
  const tools = f.connectors.toolsFor(f.agent);
  assert.equal(tools.length, f.remote.definitions.length);
  assert.deepEqual(tools[0].parameters, f.remote.definitions[0].inputSchema);
  assert.match(tools.find((t) => t.name === "firecrawl_monitor_delete").description, /explicit user request/);
  const result = await f.connectors.runTool(f.agent, "firecrawl_search", { query: "echo-credential" });
  assert.doesNotMatch(result.text, /fc-fixture/); assert.match(result.text, /\[key\]/);
  assert.match((await f.connectors.runTool(f.agent, "firecrawl_unknown")).text, /unavailable/);
  const written = [];
  await f.connectors.runTool(f.agent, "firecrawl_parse", {}, { writeFile: async (path, bytes) => written.push({ path, bytes }) });
  assert.match(written[0].path, /^\/home\/agent\/work\/firecrawl\/firecrawl_parse-/);
  await f.call("/api/connectors/keys/firecrawl", { method: "PUT", body: { agents: [] } });
  assert.match((await f.connectors.runTool(f.agent, "firecrawl_search", { query: "news" })).text, /not authorised/);
  await f.call("/api/connectors/keys/firecrawl", { method: "DELETE" });
  assert.equal(f.remote.revocations.length, 0, "an API key is removed locally, not represented as provider-revoked");
  assert.deepEqual(f.connectors.toolsFor(f.agent), []);
});

test("Firecrawl OAuth registers a public callback client, rotates once under concurrent calls and revokes the full grant", async (t) => {
  const f = await firecrawlWorld(t), { record, url } = await f.connectOAuth();
  assert.equal(record.account, "fixture-user"); assert.equal(record.workspace, "fixture-team");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.match(url.searchParams.get("resource"), /mcp-oauth$/);
  assert.equal(f.remote.registrations.length, 1);
  assert.deepEqual(f.remote.registrations[0].redirect_uris, [url.searchParams.get("redirect_uri")]);
  assert.equal(f.remote.registrations[0].token_endpoint_auth_method, "none");
  assert.ok(f.remote.tokens[0].code_verifier); assert.equal(f.remote.tokens[0].client_secret, undefined);
  await assert.rejects(f.connectors.finishOAuth("firecrawl", { state: url.searchParams.get("state"), code: "fixture-code" }, url.searchParams.get("state")), /scaduta/);
  const stored = f.connectors.access.get("CORA_FIRECRAWL_TOKEN"); stored.expires_at = 0;
  await f.call("/api/connectors/keys/firecrawl", { method: "PUT", body: { agents: [f.agent.id] } });
  const answers = await Promise.all([1, 2, 3].map(() => f.connectors.runTool(f.agent, "firecrawl_search", { query: "news" })));
  assert.ok(answers.every((a) => !a.text.startsWith("error:")));
  assert.equal(f.remote.state.refreshCount, 1);
  const serialized = JSON.stringify((await f.call("/api/connectors")).data);
  for (const secret of [FIRECRAWL_ACCESS, FIRECRAWL_REFRESH]) assert.ok(!serialized.includes(secret));
  f.remote.state.revokeRefuse = true;
  const pending = await f.call("/api/connectors/keys/firecrawl", { method: "DELETE" });
  assert.equal(pending.status, 200); assert.equal(pending.data.revocationPending, true);
  assert.equal(f.connectors.record("firecrawl").status, "revocation_pending", "provider revocation stays retryable");
  assert.deepEqual(f.connectors.toolsFor(f.agent), [], "local access is removed before provider revocation");
  assert.deepEqual(f.app.store.vaultSecret("CORA_FIRECRAWL_TOKEN").agents, []);
  assert.match((await f.connectors.runTool(f.agent, "firecrawl_search", { query: "denied" })).text, /not connected/);
  assert.equal((await f.call("/api/connectors/keys/firecrawl", { method: "PUT", body: { agents: [f.agent.id] } })).status, 409);
  assert.equal((await f.call("/api/connectors/keys/firecrawl/authorize", { method: "POST" })).status, 409);
  f.remote.state.revokeRefuse = false;
  assert.equal((await f.call("/api/connectors/keys/firecrawl", { method: "DELETE" })).status, 200);
  assert.equal(f.remote.revocations.at(-1).token, FIRECRAWL_REFRESH + "-rotated");
  assert.equal(f.app.store.vaultSecret("CORA_FIRECRAWL_TOKEN"), null);
  assert.equal(f.app.store.vaultSecret("CORA_FIRECRAWL_TOKEN_CLIENT_ID"), null);
  assert.match((await f.connectors.runTool(f.agent, "firecrawl_search", { query: "news" })).text, /not connected/);
});

test("Firecrawl refuses OAuth cancellation, stale callbacks and switching authentication without disconnecting", async (t) => {
  const f = await firecrawlWorld(t);
  const start = await f.call("/api/connectors/keys/firecrawl/authorize", { method: "POST" });
  const state = new URL(start.data.url).searchParams.get("state");
  await assert.rejects(f.connectors.finishOAuth("firecrawl", { state, code: "fixture-code" }, "wrong-cookie"), /scaduta/);
  await f.call("/api/connectors/keys/firecrawl", { method: "DELETE" });
  await assert.rejects(f.connectors.finishOAuth("firecrawl", { state, code: "fixture-code" }, state), /scaduta/);
  await f.call("/api/connectors/keys/firecrawl", { method: "POST", body: { mode: "key", token: FIRECRAWL_KEY } });
  assert.equal((await f.call("/api/connectors/keys/firecrawl/authorize", { method: "POST" })).status, 409);
});

test("Firecrawl credit and rate refusals are returned once without retrying paid operations", async (t) => {
  const f = await firecrawlWorld(t);
  await f.call("/api/connectors/keys/firecrawl", { method: "POST", body: { mode: "key", token: FIRECRAWL_KEY } });
  await f.call("/api/connectors/keys/firecrawl", { method: "PUT", body: { agents: [f.agent.id] } });
  for (const status of [402, 429]) {
    f.remote.state.refuse = status;
    const before = f.remote.calls.filter((c) => c.method === "tools/call").length;
    const answer = await f.connectors.runTool(f.agent, "firecrawl_crawl", { url: "https://example.test" });
    assert.match(answer.text, /do not retry automatically/);
    assert.equal(f.remote.calls.filter((c) => c.method === "tools/call").length - before, 1);
  }
  f.remote.state.refuse = 0;
  assert.match((await f.connectors.runTool(f.agent, "firecrawl_search", { query: "recovery" })).text, /recovery/);
});

test("Firecrawl account and key setup use the catalog-driven panel with translated labels", async (t) => {
  const f = await firecrawlWorld(t);
  const panel = panelHarness({ hash: "#/settings/connettori/firecrawl", fetch: async (path, options = {}) => {
    const response = await f.call(path, { method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined });
    return { ok: response.status < 400, status: response.status, json: async () => response.data };
  } });
  panel.run('app.append(connectorsPane())');
  await waitFor(() => panel.run('app.textContent.includes("Apri Firecrawl")'));
  assert.equal(panel.run('Array.from(app.querySelectorAll("input")).filter(i=>i.getAttribute("type")==="password").length'), 0);
  panel.run('Array.from(app.querySelectorAll("button")).find(b=>b.textContent==="Chiave API").click()');
  await waitFor(() => panel.run('Array.from(app.querySelectorAll("input")).filter(i=>i.getAttribute("type")==="password").length') === 1);
  assert.ok(connectorCatalog().find((c) => c.id === "firecrawl").oauth);
});


test("shared MCP transport never accepts another request's response", () => {
  assert.equal(rpcAnswer({ data: { id: 2, result: { wrong: true } } }, 1), null);
  assert.equal(rpcAnswer({ data: [{ id: 2, result: {} }] }, 1), null);
  assert.equal(rpcAnswer({ text: 'data: {"id":2,"result":{}}\n\n', headers: { "content-type": "text/event-stream" } }, 1), null);
});


test("Firecrawl removes grants while the provider is still processing revocation", async (t) => {
  const f = await firecrawlWorld(t); await f.connectOAuth();
  await f.call("/api/connectors/keys/firecrawl", { method: "PUT", body: { agents: [f.agent.id] } });
  let release; f.remote.state.revokeBarrier = new Promise((resolve) => { release = resolve; });
  f.remote.state.revokeRefuse = true;
  const pending = f.call("/api/connectors/keys/firecrawl", { method: "DELETE" });
  try {
    await waitFor(() => f.remote.revocations.length === 1);
    assert.deepEqual(f.connectors.toolsFor(f.agent), []);
    assert.deepEqual(f.app.store.vaultSecret("CORA_FIRECRAWL_TOKEN").agents, []);
    assert.match((await f.connectors.runTool(f.agent, "firecrawl_search", { query: "refused" })).text, /not connected/);
  } finally { release(); }
  assert.equal((await pending).data.revocationPending, true);
});
