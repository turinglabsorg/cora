import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { mailWorld } from "./mail-fixtures.js";
import { panelHarness } from "./panel.js";
import { waitFor } from "./helpers.js";
import { executeTool, summarizeArgs } from "../src/tools.js";
import { fakeLovable, LOVABLE_TOKEN } from "./lovable-fixtures.js";
import { LOVABLE_LOOPBACK } from "../src/connectors/lovable.js";

const LINEAR_KEY = "lin_api_fixture_turinglabs";
const ASANA_TOKEN = "asana_fixture_pat";
const LINEAR_APP_TOKEN = "lin_oauth_fixture_app";
const OTHER_APP_TOKEN = "lin_oauth_fixture_other_app";

async function fakeServices(t) {
  const linear = [], asana = [], asanaQueries = [], linearTokens = [];
  const state = { refuseOtherRefresh: false };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString("utf8");
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = Object.fromEntries(new URLSearchParams(text)); }
    const send = (status, value) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
    if (req.url === "/linear") {
      linear.push({ authorization: req.headers.authorization, body });
      const token = String(req.headers.authorization || "").replace(/^Bearer /, "");
      if ([LINEAR_APP_TOKEN, OTHER_APP_TOKEN].includes(token)) {
        const other = token === OTHER_APP_TOKEN;
        if (/viewer \{ name \} organization/.test(body.query)) return send(200, { data: { viewer: { name: "Cora" }, organization: { id: other ? "org-second" : "org-first", name: other ? "Second space" : "Turing Labs", urlKey: other ? "secondspace" : "turinglabs" } } });
        if (/issue\(id: \$id\)/.test(body.query)) return send(200, { data: { issue: { id: "iss-7", identifier: "TL-7", team: { key: "TL" } } } });
        if (/commentCreate/.test(body.query)) return send(200, { data: { commentCreate: { success: true, comment: { id: "c-1", url: "https://linear.app/c", user: { name: "Cora" } } } } });
        return send(200, { data: null, errors: [{ message: "fixture: no answer" }] });
      }
      if (token !== LINEAR_KEY) return send(401, { errors: [{ message: "Authentication required" }] });
      if (/issueCreate/.test(body.query)) return send(200, { data: { issueCreate: { success: true, issue: { identifier: "TL-7", title: body.variables?.input?.title } } } });
      if (/broken/.test(body.query)) return send(400, { errors: [{ message: "Cannot query field broken" }] });
      return send(200, { data: { viewer: { name: "Sebastiano", email: "seb@example.test", organization: { name: "Turing Labs", urlKey: "turinglabs" } } } });
    }
    if (req.url === "/linear-oauth/token" && req.method === "POST") {
      linearTokens.push(body);
      if (body.grant_type === "authorization_code" && body.code === "good-code") {
        if (body.client_id === "second-client" && body.client_secret === "second-secret") return send(200, { access_token: OTHER_APP_TOKEN, refresh_token: "lin_second_refresh_fixture", expires_in: 86399 });
        if (body.client_id === "lin-client" && body.client_secret === "lin-secret") return send(200, { access_token: LINEAR_APP_TOKEN, refresh_token: "lin_refresh_fixture", expires_in: 86399, token_type: "Bearer" });
      }
      if (body.grant_type === "refresh_token") {
        if (body.client_id === "second-client" && body.client_secret === "second-secret" && body.refresh_token === "lin_second_refresh_fixture" && !state.refuseOtherRefresh) return send(200, { access_token: OTHER_APP_TOKEN, refresh_token: "lin_second_refresh_fixture", expires_in: 86399 });
        if (body.client_id === "lin-client" && body.client_secret === "lin-secret" && body.refresh_token === "lin_refresh_fixture") return send(200, { access_token: LINEAR_APP_TOKEN, refresh_token: "lin_refresh_fixture", expires_in: 86399 });
      }
      return send(400, { error: "invalid_grant" });
    }
    if (req.url === "/asana/users/me") {
      if (req.headers.authorization !== `Bearer ${ASANA_TOKEN}`) return send(401, {});
      return send(200, { data: { gid: "1", name: "Sebastiano" } });
    }
    if (req.url.startsWith("/asana/projects?")) {
      asanaQueries.push(req.url.split("?")[1]);
      if (req.headers.authorization !== `Bearer ${ASANA_TOKEN}`) return send(401, {});
      return send(200, { data: [{ gid: "31", name: "Dopamina", query: req.url.split("?")[1] }] });
    }
    if (req.url === "/asana/tasks" && req.method === "POST") {
      asana.push({ method: req.method, body });
      return send(201, { data: { gid: "77", ...body.data } });
    }
    if (req.url === "/asana/tasks/77" && req.method === "DELETE") return send(200, { data: {} });
    if (req.url === "/asana/tasks/404") return send(404, { errors: [{ message: "task: Unknown object: 404" }] });
    if (req.url === "/asana/echo") return send(200, { data: { header: req.headers.authorization } });
    if (req.url === "/asana/workspaces") {
      if (req.headers.authorization !== `Bearer ${ASANA_TOKEN}`) return send(401, {});
      return send(200, { data: [{ gid: "2", name: "Turing Labs" }] });
    }
    return send(404, {});
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return { base: `http://127.0.0.1:${server.address().port}`, linear, asana, asanaQueries, linearTokens, state };
}

async function connectorWorld(t) {
  const f = await mailWorld(t);
  const services = await fakeServices(t);
  f.app.keyConnectors.linearApi = `${services.base}/linear`;
  f.app.keyConnectors.asanaApi = `${services.base}/asana`;
  const created = await f.call("/api/agents", { method: "POST", body: { name: "Connector agent", tools: false } });
  return { ...f, agent: f.app.store.agent(created.data.id), services };
}

test("key connectors verify the service, keep values in the vault and authorise agents per connector", async (t) => {
  const f = await connectorWorld(t);
  const initial = await f.call("/api/connectors");
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.data.keyConnectors.map((item) => [item.service, item.status]), [["linear", "new"], ["asana", "new"], ["canva", "new"], ["lovable", "new"]]);

  assert.equal((await f.call("/api/connectors/keys/linear", { method: "POST", body: { workspace: "turinglabs" } })).status, 400);
  const wrong = await f.call("/api/connectors/keys/linear", { method: "POST", body: { workspace: "otherspace", token: LINEAR_KEY } });
  assert.equal(wrong.status, 400);
  assert.match(wrong.data.error, /turinglabs/);

  const connected = await f.call("/api/connectors/keys/linear", { method: "POST", body: { workspace: "turinglabs", token: LINEAR_KEY } });
  assert.equal(connected.status, 200);
  assert.equal(connected.data.record.status, "connected");
  assert.equal(connected.data.record.workspace, "turinglabs");
  assert.equal(connected.data.record.account, "Sebastiano");
  assert.doesNotMatch(JSON.stringify(connected.data), new RegExp(LINEAR_KEY));
  const secret = f.app.vault.list().find((item) => item.name === "CORA_LINEAR_KEY");
  assert.ok(secret, "the API key is in the vault");
  assert.equal(secret.agents.length, 0);

  const authorised = await f.call("/api/connectors/keys/linear", { method: "PUT", body: { agents: [f.agent.id] } });
  assert.equal(authorised.status, 200);
  assert.deepEqual(f.app.vault.list().find((item) => item.name === "CORA_LINEAR_KEY").agents, [f.agent.id]);
  assert.deepEqual(authorised.data.record.agents, [f.agent.id]);

  const asana = await f.call("/api/connectors/keys/asana", { method: "POST", body: { mode: "pat", token: ASANA_TOKEN } });
  assert.equal(asana.status, 200);
  assert.equal(asana.data.record.status, "connected");
  assert.equal(asana.data.record.workspace, "Turing Labs");
  assert.equal(asana.data.record.account, "Sebastiano");
  assert.ok(f.app.vault.list().some((item) => item.name === "CORA_ASANA_TOKEN"));

  const canva = await f.call("/api/connectors/keys/canva", { method: "POST", body: { decision: "later" } });
  assert.equal(canva.status, 200);
  assert.equal(canva.data.record.status, "later");
  assert.equal(canva.data.keyConnectors.find((item) => item.service === "canva").status, "later");

  const app = await f.call("/api/connectors/keys/canva", { method: "POST", body: { clientId: "canva-client-id", clientSecret: "canva-client-secret" } });
  assert.equal(app.status, 200);
  assert.equal(app.data.record.status, "app");
  assert.ok(f.app.vault.list().some((item) => item.name === "CORA_CANVA_CLIENT_ID"));
  assert.doesNotMatch(JSON.stringify(app.data), /canva-client-secret/);

  const readOnly = await f.call("/api/connectors");
  assert.equal(readOnly.status, 200);
  assert.equal(readOnly.data.canManage, true);
  assert.equal((await f.call("/api/connectors/keys/asana", { method: "POST", body: { token: ASANA_TOKEN }, asMember: true })).status, 403);
  assert.equal((await f.call("/api/connectors", { asMember: true })).status, 200);

  assert.equal((await f.call("/api/connectors/keys/linear", { method: "DELETE" })).status, 200);
  assert.equal(f.app.vault.list().some((item) => item.name === "CORA_LINEAR_KEY"), false);
  assert.equal((await f.call("/api/connectors")).data.keyConnectors.find((item) => item.service === "linear").status, "new");
});

test("key connectors explain a service that refuses the credential and one that does not answer", async (t) => {
  const f = await connectorWorld(t);
  const refused = await f.call("/api/connectors/keys/linear", { method: "POST", body: { workspace: "turinglabs", token: "lin_api_wrong" } });
  assert.equal(refused.status, 400);
  assert.match(refused.data.error, /rifiuta questa credenziale/);
  assert.equal((await f.call("/api/connectors/keys/asana", { method: "POST", body: { mode: "pat", token: "wrong" } })).status, 400);
  f.app.keyConnectors.asanaApi = "http://127.0.0.1:9/asana";
  const down = await f.call("/api/connectors/keys/asana", { method: "POST", body: { mode: "pat", token: ASANA_TOKEN } });
  assert.equal(down.status, 502);
  assert.match(down.data.error, /non risponde/);
});

test("the connectors page shows Linear, Asana and Canva with their instructions and connects Linear from the form", async (t) => {
  const f = await connectorWorld(t);
  const panel = panelHarness({ hash: "#/settings/connettori", fetch: async (path, options = {}) => {
    const response = await f.call(path, { method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined });
    return { ok: response.status < 400, status: response.status, json: async () => response.data };
  } });
  const node = panel.run("(() => {const node = connectorsPane(); app.append(node); return node;})()");
  await node.readyConnectors;
  const cards = node.querySelectorAll(".connector-card");
  assert.deepEqual(cards.map((card) => card.querySelector(".connector-card-name").textContent), ["Google", "Linear", "Asana", "Canva", "Lovable"]);
  cards.find((card) => /Linear/.test(card.textContent)).click();
  assert.match(node.querySelector(".connector-detail").textContent, /workspace/);
  assert.match(node.querySelector(".connector-detail").textContent, /CORA_LINEAR_KEY/);
  assert.match(node.querySelector(".connector-detail").textContent, /linear\.app\/settings/);
  assert.doesNotMatch(node.querySelector(".connector-detail").textContent, /\[object Object\]/);
  assert.ok(node.querySelector(".connector-detail").querySelectorAll(".set-control").some((control) => control.querySelectorAll("input").some((input) => input.getAttribute("type") === "password")), "the secret field sits in the row control");
  const workspace = node.querySelectorAll("input").find((input) => input.getAttribute("type") === "text");
  const key = node.querySelectorAll("input").find((input) => input.getAttribute("type") === "password");
  workspace.value = "turinglabs"; key.value = LINEAR_KEY;
  node.querySelectorAll("button").find((button) => /Verifica e collega/.test(button.textContent)).click();
  await waitFor(() => /turinglabs/.test(node.textContent) && /CORA_LINEAR_KEY/.test(node.textContent) && !/Verifica e collega/.test(node.textContent));
  assert.equal(f.app.keyConnectors.record("linear").status, "connected");
  assert.equal(f.app.keyConnectors.record("linear").workspace, "turinglabs");
  const checkbox = node.querySelectorAll("input").find((input) => input.getAttribute("type") === "checkbox");
  checkbox.checked = true; checkbox.dispatch("change");
  await waitFor(() => f.app.keyConnectors.record("linear").agents.length === 1);
  node.querySelector(".connector-back").click();
  assert.match(node.querySelector(".connector-catalog").textContent, /Linear/);
});

test("the connectors page asks for the Asana choice and the Canva decision with the steps to follow", async (t) => {
  const f = await connectorWorld(t);
  const panel = panelHarness({ hash: "#/settings/connettori/asana", fetch: async (path, options = {}) => {
    const response = await f.call(path, { method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined });
    return { ok: response.status < 400, status: response.status, json: async () => response.data };
  } });
  const node = panel.run("(() => {const node = connectorsPane(); app.append(node); return node;})()");
  await node.readyConnectors;
  assert.match(node.querySelector(".connector-detail").textContent, /Token personale/);
  assert.match(node.querySelector(".connector-detail").textContent, /App OAuth/);
  assert.doesNotMatch(node.querySelector(".connector-detail").textContent, /\[object Object\]/);
  assert.ok(node.querySelector(".connector-detail").querySelectorAll(".set-control").some((control) => control.querySelectorAll("input").some((input) => input.getAttribute("type") === "password")), "the secret field sits in the row control");
  node.querySelectorAll("button").find((button) => button.textContent === "App OAuth").click();
  assert.match(node.querySelector(".connector-detail").textContent, /client ID/);
  assert.doesNotMatch(node.querySelector(".connector-detail").textContent, /\[object Object\]/);
  assert.ok(node.querySelector(".connector-detail").querySelectorAll(".set-control").some((control) => control.querySelectorAll("input").some((input) => input.getAttribute("type") === "password")), "the secret field sits in the row control");
  const clientId = node.querySelectorAll("input").find((input) => /Client ID/.test(input.getAttribute("aria-label") || ""));
  const clientSecret = node.querySelectorAll("input").find((input) => /Client secret/.test(input.getAttribute("aria-label") || ""));
  assert.ok(clientId && clientSecret);
  node.querySelectorAll("button").find((button) => button.textContent === "Catalogo connettori").click();
  node.querySelectorAll(".connector-card").find((card) => /Canva/.test(card.textContent)).click();
  assert.match(node.querySelector(".connector-detail").textContent, /Collega Canva con un.app/);
  assert.doesNotMatch(node.querySelector(".connector-detail").textContent, /\[object Object\]/);
  node.querySelectorAll("button").find((button) => /Per ora no/.test(button.textContent)).click();
  await waitFor(() => f.app.keyConnectors.record("canva")?.status === "later");
});

test("authorised agents work on Linear and Asana through their Cora tools, and nobody else sees them", async (t) => {
  const f = await connectorWorld(t);
  const other = f.app.store.agent((await f.call("/api/agents", { method: "POST", body: { name: "Other agent", tools: false } })).data.id);
  const connectors = f.app.keyConnectors;
  assert.deepEqual(connectors.toolsFor(f.agent), [], "nothing is connected yet");

  await f.call("/api/connectors/keys/linear", { method: "POST", body: { workspace: "turinglabs", token: LINEAR_KEY } });
  await f.call("/api/connectors/keys/asana", { method: "POST", body: { mode: "pat", token: ASANA_TOKEN } });
  assert.deepEqual(connectors.toolsFor(f.agent), [], "connected, but no agent is authorised");
  assert.match((await connectors.runTool(f.agent, "linear_graphql", { query: "{ viewer { name } }" })).text, /^error: you are not authorised for Linear/);

  await f.call("/api/connectors/keys/linear", { method: "PUT", body: { agents: [f.agent.id] } });
  await f.call("/api/connectors/keys/asana", { method: "PUT", body: { agents: [f.agent.id] } });
  const tools = connectors.toolsFor(f.agent);
  const names = tools.map((tool) => tool.name);
  assert.equal(names[0], "linear_teams");
  assert.ok(names.includes("linear_create_issue") && names.includes("linear_comment") && names.includes("linear_graphql"), "Linear gives one tool per action plus the fallback");
  assert.ok(names.includes("asana_create_task") && names.includes("asana_comment") && names.includes("asana_api"), "Asana gives one tool per action plus the fallback");
  assert.ok(names.every((name) => name.startsWith("linear_") || name.startsWith("asana_")));
  assert.match(tools[0].description, /workspace turinglabs, acting as Sebastiano/);
  assert.match(tools.find((tool) => tool.name === "asana_workspaces").description, /Turing Labs \(gid 2\)/);
  for (const tool of tools) assert.equal(tool.parameters.type, "object", `${tool.name} has a JSON Schema`);
  for (const tool of tools) assert.doesNotMatch(JSON.stringify(tool), new RegExp(`${LINEAR_KEY}|${ASANA_TOKEN}`));
  assert.deepEqual(connectors.toolsFor(other), [], "an agent the owner did not pick gets no tool");
  assert.match((await connectors.runTool(other, "asana_api", { path: "/workspaces" })).text, /^error: you are not authorised for Asana/);

  const viewer = await connectors.runTool(f.agent, "linear_graphql", { query: "{ viewer { name } }" });
  assert.equal(JSON.parse(viewer.text).viewer.name, "Sebastiano");
  assert.equal(f.services.linear.at(-1).authorization, LINEAR_KEY, "a personal API key goes bare in the header");
  const created = await connectors.runTool(f.agent, "linear_graphql", { query: "mutation($input:IssueCreateInput!){ issueCreate(input:$input){ success issue{ identifier title } } }", variables: { input: { teamId: "t1", title: "Prova" } } });
  assert.deepEqual(JSON.parse(created.text).issueCreate, { success: true, issue: { identifier: "TL-7", title: "Prova" } });
  assert.deepEqual(f.services.linear.at(-1).body.variables, { input: { teamId: "t1", title: "Prova" } });
  assert.match((await connectors.runTool(f.agent, "linear_graphql", { query: "{ broken }" })).text, /^error: Linear: Cannot query field broken/);
  assert.match((await connectors.runTool(f.agent, "linear_graphql", {})).text, /^error: write the GraphQL query/);

  const projects = await connectors.runTool(f.agent, "asana_api", { path: "/projects", query: { workspace: "2", archived: false } });
  assert.deepEqual(JSON.parse(projects.text).data[0], { gid: "31", name: "Dopamina", query: "workspace=2&archived=false" });
  const task = await connectors.runTool(f.agent, "asana_api", { method: "POST", path: "/tasks", body: { name: "Prova", projects: ["31"] } });
  assert.equal(JSON.parse(task.text).data.gid, "77");
  assert.deepEqual(f.services.asana.at(-1).body, { data: { name: "Prova", projects: ["31"] } }, "Cora wraps the fields in data");
  assert.equal((await connectors.runTool(f.agent, "asana_api", { method: "DELETE", path: "/tasks/77" })).text, '{"data":{}}');
  const listed = await connectors.runTool(f.agent, "asana_list_projects", {});
  assert.deepEqual(JSON.parse(listed.text).map((item) => item.name), ["Dopamina"], "an action tool runs with the connected workspace");
  assert.match(f.services.asanaQueries.at(-1), /workspace=2/);
  assert.match((await connectors.runTool(f.agent, "asana_api", { path: "/tasks/404" })).text, /^error: Asana answered 404: task: Unknown object/);
  for (const path of ["https://evil.test/x", "//evil.test", "/tasks/../../x", "tasks"]) assert.match((await connectors.runTool(f.agent, "asana_api", { path })).text, /^error: path is an Asana API path/);
  assert.match((await connectors.runTool(f.agent, "asana_api", { method: "PATCH", path: "/tasks/1" })).text, /^error: method is/);
  const echoed = await connectors.runTool(f.agent, "asana_api", { path: "/echo" });
  assert.doesNotMatch(echoed.text, new RegExp(ASANA_TOKEN), "a key the service echoes never reaches the agent");
  assert.match(echoed.text, /\[key\]/);

  connectors.asanaApi = "http://127.0.0.1:9/asana";
  assert.match((await connectors.runTool(f.agent, "asana_api", { path: "/workspaces" })).text, /^error: Asana does not answer/);

  await f.call("/api/connectors/keys/linear", { method: "DELETE" });
  assert.ok(connectors.toolsFor(f.agent).every((tool) => tool.name.startsWith("asana_")), "a disconnected service takes its tools away");
});

test("a connector tool runs inside an agent turn only for an authorised request", async (t) => {
  const f = await connectorWorld(t);
  await f.call("/api/connectors/keys/linear", { method: "POST", body: { workspace: "turinglabs", token: LINEAR_KEY } });
  await f.call("/api/connectors/keys/linear", { method: "PUT", body: { agents: [f.agent.id] } });
  const ctx = { agent: f.agent, store: f.app.store, connectors: f.app.keyConnectors, vault: f.app.vault };
  assert.match((await executeTool({ name: "linear_graphql", args: { query: "{ viewer { name } }" } }, ctx)).text, /^error: connectors work on the owner's accounts/);
  const answer = await executeTool({ name: "linear_graphql", args: { query: "{ viewer { name } }" } }, { ...ctx, requester: { kind: "owner", id: "u1" } });
  assert.equal(JSON.parse(answer.text).viewer.name, "Sebastiano");
  assert.equal(summarizeArgs("linear_graphql", { query: "{\n viewer { name } }" }), "{ viewer { name } }");
  assert.equal(summarizeArgs("asana_api", { method: "post", path: "/tasks" }), "POST /tasks");
  assert.equal(summarizeArgs("asana_comment", { task: "77", text: "a private body" }), "task 77", "a summary names the ids, never a body");
  assert.ok(f.app.brain.connectors === f.app.keyConnectors, "the brain hands the connectors to every turn");
  const system = f.app.brain.systemPrompt(f.agent, { place: "", computer: true });
  assert.match(system, /## Connettori\nIl proprietario ti ha autorizzato su linear: per lavorarci usa gli strumenti che iniziano con linear_/);
});

test("the panel draws the catalogue and the forms from src/connectors, so a new module needs no panel code", async (t) => {
  const f = await connectorWorld(t);
  const posted = [];
  const acme = { id: "acme", name: "Acme", kind: "key", secret: "CORA_ACME_KEY", appSecrets: [], tools: ["acme_list"], icon: "link", description: "Acme di prova.", meta: "Acme · Prova", intro: "Gli agenti usano Acme.",
    modes: [{ id: "key", notice: "Serve la chiave di Acme.", rows: [{ title: "La chiave", steps: [["apri ", { href: "https://acme.test/keys", text: "acme.test/keys" }, ";"], ["salvala come ", { code: "CORA_ACME_KEY" }]], field: { name: "token", type: "password", label: "Chiave di Acme" }, submit: "Verifica e collega" }] }] };
  const panel = panelHarness({ hash: "#/settings/connettori", fetch: async (path, options = {}) => {
    if (path === "/api/connectors/keys/acme") { posted.push(JSON.parse(options.body)); return { ok: false, status: 400, json: async () => ({ error: "Chiave di prova rifiutata." }) }; }
    const response = await f.call(path, { method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined });
    if (path === "/api/connectors") response.data.catalog.push(acme);
    return { ok: response.status < 400, status: response.status, json: async () => response.data };
  } });
  const served = (await f.call("/api/connectors")).data.catalog;
  assert.deepEqual(served.map((item) => [item.id, item.kind, item.tools[0]]), [["google", "google", "gmail_accounts"], ["linear", "key", "linear_teams"], ["asana", "key", "asana_workspaces"], ["canva", "key", "canva_me"], ["lovable", "key", "lovable_me"]]);
  assert.ok(served.find((item) => item.id === "asana").tools.length > 10, "the catalogue lists every Asana action");
  assert.equal(served.find((item) => item.id === "linear").secret, "CORA_LINEAR_KEY");
  const node = panel.run("(() => {const node = connectorsPane(); app.append(node); return node;})()");
  await node.readyConnectors;
  const cards = node.querySelectorAll(".connector-card");
  assert.deepEqual(cards.map((card) => card.querySelector(".connector-card-name").textContent), ["Google", "Linear", "Asana", "Canva", "Lovable", "Acme"]);
  cards.find((card) => /Acme/.test(card.textContent)).click();
  const detail = node.querySelector(".connector-detail");
  assert.match(detail.textContent, /Serve la chiave di Acme/);
  assert.match(detail.textContent, /CORA_ACME_KEY/);
  assert.ok(detail.querySelectorAll("a").some((link) => link.getAttribute("href") === "https://acme.test/keys"));
  node.querySelectorAll("input").find((input) => input.getAttribute("type") === "password").value = "acme-key";
  node.querySelectorAll("button").find((button) => /Verifica e collega/.test(button.textContent)).click();
  await waitFor(() => /Chiave di prova rifiutata/.test(detail.textContent));
  assert.deepEqual(posted, [{ token: "acme-key" }]);
});

test("Linear through an OAuth app installs as actor=app and signs each comment with the agent's name and avatar", async (t) => {
  const f = await connectorWorld(t);
  const connectors = f.app.keyConnectors;
  connectors.oauthUrls.linear = { token: `${f.services.base}/linear-oauth/token` };
  f.app.store.setAvatarBase("https://space.example");

  const saved = await f.call("/api/connectors/keys/linear", { method: "POST", body: { mode: "oauth", clientId: "lin-client", clientSecret: "lin-secret" } });
  assert.equal(saved.status, 200);
  assert.deepEqual([saved.data.record.status, saved.data.record.mode], ["app", "oauth"]);
  assert.ok(f.app.store.vaultSecret("CORA_LINEAR_CLIENT_ID") && f.app.store.vaultSecret("CORA_LINEAR_CLIENT_SECRET"), "the app's credentials sit in the vault");
  assert.doesNotMatch(JSON.stringify(saved.data), /lin-secret/);
  const card = saved.data.catalog.find((item) => item.id === "linear");
  assert.deepEqual(card.modes.map((mode) => mode.id), ["key", "oauth"]);
  assert.match(card.redirect, /\/connectors\/oauth\/linear\/callback$/);

  const started = await f.call("/api/connectors/keys/linear/authorize", { method: "POST" });
  assert.equal(started.status, 200);
  const url = new URL(started.data.url);
  assert.equal(`${url.origin}${url.pathname}`, "https://linear.app/oauth/authorize");
  assert.equal(url.searchParams.get("actor"), "app", "the app writes as itself, so Linear accepts createAsUser");
  assert.equal(url.searchParams.get("scope"), "read,write", "Linear takes scopes separated by commas");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("client_id"), "lin-client");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.match(url.searchParams.get("redirect_uri"), /\/connectors\/oauth\/linear\/callback$/);

  const state = url.searchParams.get("state");
  const record = await connectors.finishOAuth("linear", { state, code: "good-code" }, state);
  assert.deepEqual([record.status, record.mode, record.workspace, record.account], ["connected", "oauth", "turinglabs", "Cora"]);
  const exchange = f.services.linearTokens.at(-1);
  assert.equal(exchange.client_secret, "lin-secret");
  assert.ok(exchange.code_verifier, "PKCE verifier sent with the code");

  await f.call("/api/connectors/keys/linear", { method: "PUT", body: { agents: [f.agent.id] } });
  const tools = connectors.toolsFor(f.agent);
  assert.match(tools.find((tool) => tool.name === "linear_teams").description, /through the app Cora: issues and comments you create show your own name and avatar/);
  assert.match(tools.find((tool) => tool.name === "linear_comment").description, /your name and avatar/);

  const comment = JSON.parse((await connectors.runTool(f.agent, "linear_comment", { issue: "TL-7", body: "Verificato" })).text);
  assert.equal(comment.issue, "TL-7");
  const sent = f.services.linear.at(-1);
  assert.equal(sent.authorization, `Bearer ${LINEAR_APP_TOKEN}`);
  assert.equal(sent.body.variables.input.createAsUser, "Connector agent");
  assert.match(sent.body.variables.input.displayIconUrl, new RegExp(`^https://space\\.example/avatars/${f.agent.id}\\.png`));

  await f.call("/api/connectors/keys/linear", { method: "DELETE" });
  assert.equal(f.app.store.vaultSecret("CORA_LINEAR_CLIENT_ID"), null, "disconnecting removes the app too");
  assert.equal(f.app.store.vaultSecret("CORA_LINEAR_KEY"), null);
});


test("Linear workspace connections isolate OAuth apps, grants, routing and token renewal", async (t) => {
  const f = await connectorWorld(t), connectors = f.app.keyConnectors;
  connectors.oauthUrls.linear = { token: `${f.services.base}/linear-oauth/token` };
  const other = f.app.store.createAgent({ name: "Second agent", tools: false });
  const create = async (workspace, clientId, clientSecret) => {
    const reply = await f.call("/api/connectors/keys/linear", { method: "POST", body: { mode: "oauth", workspace, clientId, clientSecret } });
    assert.equal(reply.status, 200);
    return reply.data.record;
  };
  const [firstApp, secondApp] = await Promise.all([create("turinglabs", "lin-client", "lin-secret"), create("secondspace", "second-client", "second-secret")]);
  assert.notEqual(firstApp.id, secondApp.id);
  assert.notEqual(firstApp.secretName, secondApp.secretName);
  assert.ok(firstApp.appSecrets.every(name => !secondApp.appSecrets.includes(name)));
  const records = (await f.call("/api/connectors")).data.keyConnectors.filter(item => item.service === "linear");
  assert.equal(records.length, 2);
  assert.ok(records.every(item => item.appConfigured));
  assert.doesNotMatch(JSON.stringify(records), /lin-secret|second-secret/);
  assert.equal((await f.call("/api/connectors/keys/linear/authorize", { method: "POST" })).status, 400);
  const finish = async (app, clientId) => {
    const started = await f.call(`/api/connectors/keys/linear/authorize?connection=${app.id}`, { method: "POST" });
    assert.equal(started.status, 200);
    const url = new URL(started.data.url);
    assert.equal(url.searchParams.get("client_id"), clientId);
    const state = url.searchParams.get("state");
    return connectors.finishOAuth("linear", { state, code: "good-code" }, state);
  };
  const [first, second] = await Promise.all([finish(firstApp, "lin-client"), finish(secondApp, "second-client")]);
  assert.deepEqual([first.workspace, second.workspace], ["turinglabs", "secondspace"]);
  const grant = (record, agents) => f.call(`/api/connectors/keys/linear?connection=${record.id}`, { method: "PUT", body: { agents } });
  assert.equal((await grant(first, [f.agent.id])).status, 200);
  assert.equal((await grant(second, [other.id])).status, 200);
  assert.deepEqual(f.app.store.vaultSecret(first.secretName).agents, [f.agent.id]);
  assert.deepEqual(f.app.store.vaultSecret(second.secretName).agents, [other.id]);
  const firstTool = connectors.toolsFor(f.agent).find(tool => tool.name === "linear_comment");
  assert.deepEqual(firstTool.parameters.properties.workspace.enum, ["turinglabs"]);
  assert.doesNotMatch(JSON.stringify(firstTool), /secondspace/);
  const calls = f.services.linear.length;
  assert.match((await connectors.runTool(f.agent, "linear_comment", { workspace: "secondspace", issue: "TL-7", body: "Denied" })).text, /^error: you are not authorised/);
  assert.equal(f.services.linear.length, calls);
  await grant(second, [f.agent.id, other.id]);
  const tools = connectors.toolsFor(f.agent);
  assert.equal(new Set(tools.map(tool => tool.name)).size, tools.length, "tools are not duplicated per workspace");
  assert.ok(tools.every(tool => tool.parameters.required.includes("workspace")));
  assert.match((await connectors.runTool(f.agent, "linear_comment", { issue: "TL-7", body: "Ambiguous" })).text, /^error: choose workspace explicitly/);
  assert.match((await connectors.runTool(f.agent, "linear_comment", { workspace: "turinglabs", issue: "https://linear.app/secondspace/issue/TL-7", body: "Wrong URL" })).text, /^error: the Linear URL/);
  assert.equal(f.services.linear.length, calls);
  const comment = (workspace) => connectors.runTool(f.agent, "linear_comment", { workspace, issue: "TL-7", body: "Verified" });
  assert.doesNotMatch((await comment("turinglabs")).text, /^error:/);
  assert.equal(f.services.linear.at(-1).authorization, `Bearer ${LINEAR_APP_TOKEN}`);
  assert.doesNotMatch((await comment("secondspace")).text, /^error:/);
  assert.equal(f.services.linear.at(-1).authorization, `Bearer ${OTHER_APP_TOKEN}`);
  const expire = async (record) => {
    const secret = f.app.store.vaultSecret(record.secretName);
    const bundle = JSON.parse(f.app.vault.value(secret).toString("utf8"));
    bundle.expires_at = 0;
    await f.app.vault.put({ name: record.secretName, value: JSON.stringify(bundle), agents: secret.agents, by: secret.createdBy });
    connectors.access.delete(record.secretName);
  };
  await expire(first); await expire(second);
  const tokenCalls = f.services.linearTokens.length;
  const renewed = await Promise.all([comment("turinglabs"), comment("turinglabs"), comment("secondspace")]);
  assert.ok(renewed.every(reply => !reply.text.startsWith("error:")));
  const refreshes = f.services.linearTokens.slice(tokenCalls);
  assert.equal(refreshes.length, 2, "concurrent calls share renewal within a connection");
  assert.deepEqual(new Set(refreshes.map(body => body.client_id)), new Set(["lin-client", "second-client"]));
  f.services.state.refuseOtherRefresh = true;
  await expire(second);
  assert.match((await comment("secondspace")).text, /did not renew/);
  assert.doesNotMatch((await comment("turinglabs")).text, /^error:/, "a failed renewal is isolated");
  assert.equal((await f.call("/api/connectors/keys/linear", { method: "PUT", body: { agents: [] } })).status, 400);
  assert.equal((await f.call("/api/connectors/keys/linear", { method: "DELETE" })).status, 400);
  assert.equal((await f.call(`/api/connectors/keys/linear?connection=${first.id}`, { method: "PUT", body: { agents: [] }, asMember: true })).status, 403);
  await grant(first, []);
  assert.match((await comment("turinglabs")).text, /^error: you are not authorised/);
  assert.deepEqual(f.app.store.vaultSecret(second.secretName).agents, [f.agent.id, other.id]);
  await grant(first, [f.agent.id]);
  assert.equal((await f.call(`/api/connectors/keys/linear?connection=${second.id}`, { method: "DELETE" })).status, 200);
  assert.ok(f.app.store.vaultSecret(first.secretName));
  assert.ok(first.appSecrets.every(name => f.app.store.vaultSecret(name)));
  assert.equal(f.app.store.vaultSecret(second.secretName), null);
  assert.ok(second.appSecrets.every(name => !f.app.store.vaultSecret(name)));
  assert.doesNotMatch((await connectors.runTool(f.agent, "linear_comment", { issue: "TL-7", body: "Single workspace" })).text, /^error:/);
});

async function lovableWorld(t) {
  const f = await connectorWorld(t);
  const l = await fakeLovable(t);
  f.app.keyConnectors.lovableApi = l.mcp;
  f.app.keyConnectors.oauthUrls.lovable = { token: `${l.base}/oauth/token`, register: `${l.base}/oauth/register` };
  return { ...f, l };
}

test("Lovable quick access registers Cora as a loopback client and connects from the pasted address", async (t) => {
  const f = await lovableWorld(t);
  const connectors = f.app.keyConnectors;
  assert.equal((await f.call("/api/connectors/keys/lovable", { method: "POST", body: { mode: "quick" } })).status, 400, "nothing to paste yet");

  const started = await f.call("/api/connectors/keys/lovable/authorize?mode=quick", { method: "POST" });
  assert.equal(started.status, 200);
  const url = new URL(started.data.url);
  assert.equal(`${url.origin}${url.pathname}`, "https://lovable.dev/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "quick-client-fixture");
  assert.equal(url.searchParams.get("redirect_uri"), LOVABLE_LOOPBACK);
  assert.equal(url.searchParams.get("resource"), "https://mcp.lovable.dev");
  assert.equal(url.searchParams.get("scope"), "offline projects:read projects:write workspaces:read workspaces:write");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.deepEqual(f.l.registrations.map((item) => [item.redirect_uris, item.token_endpoint_auth_method]), [[[LOVABLE_LOOPBACK], "none"]]);
  assert.ok(f.app.store.vaultSecret("CORA_LOVABLE_TOKEN_QUICK_CLIENT_ID"), "the public client id is kept for renewals");
  assert.equal(connectors.record("lovable").status, "quick");
  const state = url.searchParams.get("state");

  const wrongPlace = await f.call("/api/connectors/keys/lovable", { method: "POST", body: { mode: "quick", returned: `https://evil.test/cora/lovable/callback?code=good-code&state=${state}` } });
  assert.equal(wrongPlace.status, 400);
  assert.match(wrongPlace.data.error, /127\.0\.0\.1/);
  const stranger = await f.call("/api/connectors/keys/lovable", { method: "POST", body: { mode: "quick", returned: `${LOVABLE_LOOPBACK}?code=good-code&state=other` } });
  assert.equal(stranger.status, 400);

  const done = await f.call("/api/connectors/keys/lovable", { method: "POST", body: { mode: "quick", returned: `${LOVABLE_LOOPBACK}?code=good-code&state=${state}&iss=https%3A%2F%2Flovable.dev%2Foauth` } });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.deepEqual([done.data.record.status, done.data.record.mode, done.data.record.account, done.data.record.workspace], ["connected", "quick", "seb@example.test", "Dopamina"]);
  assert.doesNotMatch(JSON.stringify(done.data), new RegExp(LOVABLE_TOKEN));
  const exchange = f.l.tokens.at(-1).body;
  assert.deepEqual([exchange.client_id, exchange.client_secret, exchange.redirect_uri, exchange.resource, Boolean(exchange.code_verifier)], ["quick-client-fixture", undefined, LOVABLE_LOOPBACK, "https://mcp.lovable.dev", true]);
  const replay = await f.call("/api/connectors/keys/lovable", { method: "POST", body: { mode: "quick", returned: `${LOVABLE_LOOPBACK}?code=good-code&state=${state}` } });
  assert.equal(replay.status, 400, "a pasted address works once");

  assert.deepEqual(connectors.toolsFor(f.agent), [], "connected, but no agent is authorised");
  await f.call("/api/connectors/keys/lovable", { method: "PUT", body: { agents: [f.agent.id] } });
  const tools = connectors.toolsFor(f.agent);
  assert.equal(tools[0].name, "lovable_me");
  assert.match(tools[0].description, /acting as seb@example\.test/);
  assert.ok(tools.every((tool) => tool.name.startsWith("lovable_")));
  const me = JSON.parse((await connectors.runTool(f.agent, "lovable_me")).text);
  assert.equal(me.user.email, "seb@example.test");

  const stored = JSON.parse(f.app.vault.value(f.app.store.vaultSecret("CORA_LOVABLE_TOKEN")).toString("utf8"));
  await f.app.vault.put({ name: "CORA_LOVABLE_TOKEN", value: JSON.stringify({ ...stored, expires_at: Date.now() - 1000 }), agents: [f.agent.id], by: null, source: "connector" });
  connectors.access.clear();
  const workspaces = JSON.parse((await connectors.runTool(f.agent, "lovable_list_workspaces")).text);
  assert.equal(workspaces.workspaces[0].id, "ws1");
  assert.equal(f.l.state.refreshed, 1, "an expired token is renewed");
  assert.deepEqual([f.l.tokens.at(-1).body.grant_type, f.l.tokens.at(-1).body.client_id, f.l.tokens.at(-1).body.client_secret], ["refresh_token", "quick-client-fixture", undefined], "the public client renews without a secret");

  await f.call("/api/connectors/keys/lovable", { method: "DELETE" });
  assert.equal(f.app.store.vaultSecret("CORA_LOVABLE_TOKEN"), null);
  assert.equal(f.app.store.vaultSecret("CORA_LOVABLE_TOKEN_QUICK_CLIENT_ID"), null);
  assert.deepEqual(connectors.toolsFor(f.agent), []);
});

test("Lovable: the owner picks the default workspace among the account's, agents use it and the list can be read again", async (t) => {
  const f = await lovableWorld(t);
  const connectors = f.app.keyConnectors;
  f.l.state.workspaces = [{ id: "ws1", name: "NoCodeLab", role: "owner" }, { id: "ws2", name: "TheHoost Projects", role: "collaborator" }];
  const state = new URL((await f.call("/api/connectors/keys/lovable/authorize?mode=quick", { method: "POST" })).data.url).searchParams.get("state");
  const done = await f.call("/api/connectors/keys/lovable", { method: "POST", body: { mode: "quick", returned: `${LOVABLE_LOOPBACK}?code=good-code&state=${state}` } });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.deepEqual(done.data.record.workspaces, f.l.state.workspaces);
  assert.equal(done.data.record.defaultWorkspace, "", "two workspaces: no guess");
  await f.call("/api/connectors/keys/lovable", { method: "PUT", body: { agents: [f.agent.id] } });
  assert.deepEqual(connectors.toolsFor(f.agent).find((tool) => tool.name === "lovable_list_projects").parameters.required, ["workspace"]);
  assert.match((await connectors.runTool(f.agent, "lovable_list_projects")).text, /^error: workspace is required/);

  const wrong = await f.call("/api/connectors/keys/lovable", { method: "PUT", body: { defaultWorkspace: "elsewhere" } });
  assert.equal(wrong.status, 400);
  const picked = await f.call("/api/connectors/keys/lovable", { method: "PUT", body: { defaultWorkspace: "ws2" } });
  assert.equal(picked.status, 200);
  assert.deepEqual([picked.data.record.defaultWorkspace, picked.data.record.workspace, picked.data.record.agents], ["ws2", "TheHoost Projects", [f.agent.id]], "picking a workspace leaves the agents alone");
  const tool = connectors.toolsFor(f.agent).find((item) => item.name === "lovable_list_projects");
  assert.equal(tool.parameters.required, undefined);
  assert.match(tool.description, /Default workspace: TheHoost Projects \(ws2\)/);
  assert.equal(JSON.parse((await connectors.runTool(f.agent, "lovable_list_projects")).text).projects[0].workspace_id, "ws2");
  assert.equal(JSON.parse((await connectors.runTool(f.agent, "lovable_list_projects", { workspace: "nocodelab" })).text).projects[0].workspace_id, "ws1");

  f.l.state.workspaces = [...f.l.state.workspaces, { id: "ws3", name: "People Obsessed", role: "member" }];
  const refreshed = await f.call("/api/connectors/keys/lovable", { method: "PUT", body: { refreshWorkspaces: true } });
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed.data));
  assert.deepEqual([refreshed.data.record.workspaces.length, refreshed.data.record.defaultWorkspace], [3, "ws2"]);
  f.l.state.workspaces = f.l.state.workspaces.filter((item) => item.id !== "ws2");
  const gone = await f.call("/api/connectors/keys/lovable", { method: "PUT", body: { refreshWorkspaces: true } });
  assert.deepEqual([gone.data.record.defaultWorkspace, gone.data.record.workspace], ["", "NoCodeLab, People Obsessed"], "a workspace the account left is no longer the default");
  const cleared = await f.call("/api/connectors/keys/lovable", { method: "PUT", body: { defaultWorkspace: "ws3" } });
  assert.equal(cleared.data.record.defaultWorkspace, "ws3");
  assert.equal((await f.call("/api/connectors/keys/lovable", { method: "PUT", body: { defaultWorkspace: "" } })).data.record.defaultWorkspace, "");

  const old = connectors.records().map((item) => item.service === "lovable" ? { ...item, workspaces: undefined, defaultWorkspace: undefined, workspace: "NoCodeLab, People Obsessed" } : item);
  connectors.save(old);
  assert.equal((await f.call("/api/connectors/keys/lovable", { method: "PUT", body: { defaultWorkspace: "ws1" } })).status, 400, "a record from before has to load its list first");
  assert.equal((await f.call("/api/connectors/keys/lovable", { method: "PUT", body: { refreshWorkspaces: true } })).data.record.workspaces.length, 2);
  assert.equal((await f.call("/api/connectors/keys/lovable", { method: "PUT", body: { defaultWorkspace: "ws1" } })).data.record.workspace, "NoCodeLab");
});

test("Lovable through a workspace OAuth client returns to Cora's callback", async (t) => {
  const f = await lovableWorld(t);
  const connectors = f.app.keyConnectors;
  const saved = await f.call("/api/connectors/keys/lovable", { method: "POST", body: { mode: "oauth", clientId: "app-client", clientSecret: "app-secret" } });
  assert.equal(saved.status, 200);
  assert.deepEqual([saved.data.record.status, saved.data.record.mode], ["app", "oauth"]);
  assert.doesNotMatch(JSON.stringify(saved.data), /app-secret/);
  const card = saved.data.catalog.find((item) => item.id === "lovable");
  assert.deepEqual(card.modes.map((mode) => mode.id), ["quick", "key", "oauth"]);
  assert.match(card.redirect, /\/connectors\/oauth\/lovable\/callback$/);
  const started = await f.call("/api/connectors/keys/lovable/authorize", { method: "POST" });
  const url = new URL(started.data.url);
  assert.match(url.searchParams.get("redirect_uri"), /\/connectors\/oauth\/lovable\/callback$/);
  assert.equal(url.searchParams.get("client_id"), "app-client");
  const state = url.searchParams.get("state");
  const record = await connectors.finishOAuth("lovable", { state, code: "good-code" }, state);
  assert.deepEqual([record.status, record.mode], ["connected", "oauth"]);
  const exchange = f.l.tokens.at(-1).body;
  assert.deepEqual([exchange.client_id, exchange.client_secret, exchange.resource], ["app-client", "app-secret", "https://mcp.lovable.dev"]);
  assert.equal(f.l.registrations.length, 0, "no dynamic registration with an app");
});

test("the Lovable card offers quick access with a new tab and a paste field", async (t) => {
  const f = await lovableWorld(t);
  const opened = [];
  const panel = panelHarness({ hash: "#/settings/connettori/lovable", fetch: async (path, options = {}) => {
    const response = await f.call(path, { method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined });
    return { ok: response.status < 400, status: response.status, json: async () => response.data };
  } });
  panel.run("window.open = (url, target) => { const tab = { location: { href: url }, opener: 1, close() {} }; globalThis.__opened = globalThis.__opened || []; globalThis.__opened.push(tab); return tab; }");
  const node = panel.run("(() => {const node = connectorsPane(); app.append(node); return node;})()");
  await node.readyConnectors;
  const detail = node.querySelector(".connector-detail");
  assert.match(detail.textContent, /Accesso rapido/);
  assert.match(detail.textContent, /App OAuth/);
  assert.match(detail.textContent, /Chiave API/);
  assert.match(detail.textContent, /127\.0\.0\.1/);
  assert.doesNotMatch(detail.textContent, /\[object Object\]/);
  node.querySelectorAll("button").find((button) => /Apri Lovable/.test(button.textContent)).click();
  await waitFor(() => panel.run("(globalThis.__opened || []).length") === 1 && /lovable\.dev\/oauth\/authorize/.test(panel.run("globalThis.__opened[0].location.href")));
  opened.push(panel.run("globalThis.__opened[0].location.href"));
  const state = new URL(opened[0]).searchParams.get("state");
  const field = node.querySelectorAll("input").find((input) => /Indirizzo della pagina di arrivo/.test(input.getAttribute("aria-label") || ""));
  field.value = `${LOVABLE_LOOPBACK}?code=good-code&state=${state}`;
  node.querySelectorAll("button").find((button) => /Completa il collegamento/.test(button.textContent)).click();
  await waitFor(() => f.app.keyConnectors.record("lovable")?.status === "connected" && /CORA_LOVABLE_TOKEN/.test(node.textContent));
  assert.match(node.textContent, /scollega e ricollega/);
});

test("the connected Lovable card picks the default workspace from a select and loads the list for older connections", async (t) => {
  const f = await lovableWorld(t);
  f.l.state.workspaces = [{ id: "ws1", name: "NoCodeLab", role: "owner" }, { id: "ws2", name: "TheHoost Projects", role: "collaborator" }];
  const state = new URL((await f.call("/api/connectors/keys/lovable/authorize?mode=quick", { method: "POST" })).data.url).searchParams.get("state");
  await f.call("/api/connectors/keys/lovable", { method: "POST", body: { mode: "quick", returned: `${LOVABLE_LOOPBACK}?code=good-code&state=${state}` } });
  const connectors = f.app.keyConnectors;
  connectors.save(connectors.records().map((item) => item.service === "lovable" ? { ...item, workspaces: undefined } : item));
  const panel = panelHarness({ hash: "#/settings/connettori/lovable", fetch: async (path, options = {}) => {
    const response = await f.call(path, { method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined });
    return { ok: response.status < 400, status: response.status, json: async () => response.data };
  } });
  const node = panel.run("(() => {const node = connectorsPane(); app.append(node); return node;})()");
  await node.readyConnectors;
  assert.match(node.textContent, /Workspace predefinito/);
  assert.match(node.textContent, /seb@example\.test/);
  const pick = () => node.querySelectorAll("select").find((select) => select.getAttribute("aria-label") === "Workspace predefinito");
  const locked = () => pick().getAttribute("disabled") === "" || pick().disabled === true;
  assert.equal(locked(), true, "nothing to pick before the list is loaded");
  node.querySelectorAll("button").find((button) => /Carica i workspace/.test(button.textContent)).click();
  await waitFor(() => pick() && !locked() && pick().querySelectorAll("option").length === 3);
  assert.deepEqual(pick().querySelectorAll("option").map((option) => option.textContent), ["Nessuno: l'agente lo sceglie ogni volta", "NoCodeLab · proprietario", "TheHoost Projects · collaboratore"]);
  assert.match(node.textContent, /L'account vede 2 workspace/);
  pick().value = "ws2";
  pick().dispatch("change");
  await waitFor(() => connectors.record("lovable").defaultWorkspace === "ws2" && pick()?.value === "ws2");
  assert.equal(connectors.record("lovable").workspace, "TheHoost Projects");
});

test("Lovable connects with a workspace API key checked on the MCP server", async (t) => {
  const f = await lovableWorld(t);
  const connectors = f.app.keyConnectors;
  assert.equal((await f.call("/api/connectors/keys/lovable", { method: "POST", body: {} })).status, 400, "a mode is required");
  const wrong = await f.call("/api/connectors/keys/lovable", { method: "POST", body: { mode: "key", token: "lov_wrong" } });
  assert.equal(wrong.status, 400);
  assert.match(wrong.data.error, /non ha riconosciuto la chiave/);
  assert.equal(f.app.store.vaultSecret("CORA_LOVABLE_TOKEN"), null, "a refused key never reaches the vault");
  const done = await f.call("/api/connectors/keys/lovable", { method: "POST", body: { mode: "key", token: "lov_fixture_key" } });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.deepEqual([done.data.record.status, done.data.record.mode, done.data.record.account], ["connected", "key", "seb@example.test"]);
  await f.call("/api/connectors/keys/lovable", { method: "PUT", body: { agents: [f.agent.id] } });
  const project = JSON.parse((await connectors.runTool(f.agent, "lovable_get_project", { project: "0b7c2d4e-1111-4222-8333-944455556666" })).text);
  assert.equal(project.latest_commit_sha, "abc123");
  assert.doesNotMatch(JSON.stringify(project), /lov_fixture_key/);
});
