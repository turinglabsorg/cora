import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { mailWorld } from "./mail-fixtures.js";
import { panelHarness } from "./panel.js";
import { waitFor } from "./helpers.js";
import { executeTool, summarizeArgs } from "../src/tools.js";

const LINEAR_KEY = "lin_api_fixture_turinglabs";
const ASANA_TOKEN = "asana_fixture_pat";

async function fakeServices(t) {
  const linear = [], asana = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString("utf8");
    const body = text ? JSON.parse(text) : {};
    const send = (status, value) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
    if (req.url === "/linear") {
      linear.push({ authorization: req.headers.authorization, body });
      const token = String(req.headers.authorization || "").replace(/^Bearer /, "");
      if (token !== LINEAR_KEY) return send(401, { errors: [{ message: "Authentication required" }] });
      if (/issueCreate/.test(body.query)) return send(200, { data: { issueCreate: { success: true, issue: { identifier: "TL-7", title: body.variables?.input?.title } } } });
      if (/broken/.test(body.query)) return send(400, { errors: [{ message: "Cannot query field broken" }] });
      return send(200, { data: { viewer: { name: "Sebastiano", email: "seb@example.test", organization: { name: "Turing Labs", urlKey: "turinglabs" } } } });
    }
    if (req.url === "/asana/users/me") {
      if (req.headers.authorization !== `Bearer ${ASANA_TOKEN}`) return send(401, {});
      return send(200, { data: { gid: "1", name: "Sebastiano" } });
    }
    if (req.url.startsWith("/asana/projects?")) {
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
  return { base: `http://127.0.0.1:${server.address().port}`, linear, asana };
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
  assert.deepEqual(initial.data.keyConnectors.map((item) => [item.service, item.status]), [["linear", "new"], ["asana", "new"], ["canva", "new"]]);

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
  assert.deepEqual(cards.map((card) => card.querySelector(".connector-card-name").textContent), ["Google", "Linear", "Asana", "Canva"]);
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
  assert.match(node.querySelector(".connector-detail").textContent, /app Canva/);
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
  assert.match((await connectors.runTool(f.agent, "linear", { query: "{ viewer { name } }" })).text, /^error: you are not authorised for Linear/);

  await f.call("/api/connectors/keys/linear", { method: "PUT", body: { agents: [f.agent.id] } });
  await f.call("/api/connectors/keys/asana", { method: "PUT", body: { agents: [f.agent.id] } });
  const tools = connectors.toolsFor(f.agent);
  assert.deepEqual(tools.map((tool) => tool.name), ["linear", "asana"]);
  assert.match(tools[0].description, /workspace turinglabs, acting as Sebastiano/);
  assert.match(tools[1].description, /Turing Labs \(gid 2\)/);
  for (const tool of tools) assert.doesNotMatch(JSON.stringify(tool), new RegExp(`${LINEAR_KEY}|${ASANA_TOKEN}`));
  assert.deepEqual(connectors.toolsFor(other), [], "an agent the owner did not pick gets no tool");
  assert.match((await connectors.runTool(other, "asana", { path: "/workspaces" })).text, /^error: you are not authorised for Asana/);

  const viewer = await connectors.runTool(f.agent, "linear", { query: "{ viewer { name } }" });
  assert.equal(JSON.parse(viewer.text).viewer.name, "Sebastiano");
  assert.equal(f.services.linear.at(-1).authorization, LINEAR_KEY, "a personal API key goes bare in the header");
  const created = await connectors.runTool(f.agent, "linear", { query: "mutation($input:IssueCreateInput!){ issueCreate(input:$input){ success issue{ identifier title } } }", variables: { input: { teamId: "t1", title: "Prova" } } });
  assert.deepEqual(JSON.parse(created.text).issueCreate, { success: true, issue: { identifier: "TL-7", title: "Prova" } });
  assert.deepEqual(f.services.linear.at(-1).body.variables, { input: { teamId: "t1", title: "Prova" } });
  assert.match((await connectors.runTool(f.agent, "linear", { query: "{ broken }" })).text, /^error: Linear: Cannot query field broken/);
  assert.match((await connectors.runTool(f.agent, "linear", {})).text, /^error: write the GraphQL query/);

  const projects = await connectors.runTool(f.agent, "asana", { path: "/projects", query: { workspace: "2", archived: false } });
  assert.deepEqual(JSON.parse(projects.text).data[0], { gid: "31", name: "Dopamina", query: "workspace=2&archived=false" });
  const task = await connectors.runTool(f.agent, "asana", { method: "POST", path: "/tasks", body: { name: "Prova", projects: ["31"] } });
  assert.equal(JSON.parse(task.text).data.gid, "77");
  assert.deepEqual(f.services.asana.at(-1).body, { data: { name: "Prova", projects: ["31"] } }, "Cora wraps the fields in data");
  assert.equal((await connectors.runTool(f.agent, "asana", { method: "DELETE", path: "/tasks/77" })).text, '{"data":{}}');
  assert.match((await connectors.runTool(f.agent, "asana", { path: "/tasks/404" })).text, /^error: Asana answered 404: task: Unknown object/);
  for (const path of ["https://evil.test/x", "//evil.test", "/tasks/../../x", "tasks"]) assert.match((await connectors.runTool(f.agent, "asana", { path })).text, /^error: path is an Asana API path/);
  assert.match((await connectors.runTool(f.agent, "asana", { method: "PATCH", path: "/tasks/1" })).text, /^error: method is/);
  const echoed = await connectors.runTool(f.agent, "asana", { path: "/echo" });
  assert.doesNotMatch(echoed.text, new RegExp(ASANA_TOKEN), "a key the service echoes never reaches the agent");
  assert.match(echoed.text, /\[key\]/);

  connectors.asanaApi = "http://127.0.0.1:9/asana";
  assert.match((await connectors.runTool(f.agent, "asana", { path: "/workspaces" })).text, /^error: Asana does not answer/);

  await f.call("/api/connectors/keys/linear", { method: "DELETE" });
  assert.deepEqual(connectors.toolsFor(f.agent).map((tool) => tool.name), ["asana"], "a disconnected service takes its tool away");
});

test("a connector tool runs inside an agent turn only for an authorised request", async (t) => {
  const f = await connectorWorld(t);
  await f.call("/api/connectors/keys/linear", { method: "POST", body: { workspace: "turinglabs", token: LINEAR_KEY } });
  await f.call("/api/connectors/keys/linear", { method: "PUT", body: { agents: [f.agent.id] } });
  const ctx = { agent: f.agent, store: f.app.store, connectors: f.app.keyConnectors, vault: f.app.vault };
  assert.match((await executeTool({ name: "linear", args: { query: "{ viewer { name } }" } }, ctx)).text, /^error: connectors work on the owner's accounts/);
  const answer = await executeTool({ name: "linear", args: { query: "{ viewer { name } }" } }, { ...ctx, requester: { kind: "owner", id: "u1" } });
  assert.equal(JSON.parse(answer.text).viewer.name, "Sebastiano");
  assert.equal(summarizeArgs("linear", { query: "{\n viewer { name } }" }), "{ viewer { name } }");
  assert.equal(summarizeArgs("asana", { method: "post", path: "/tasks" }), "POST /tasks");
  assert.ok(f.app.brain.connectors === f.app.keyConnectors, "the brain hands the connectors to every turn");
  const system = f.app.brain.systemPrompt(f.agent, { place: "", computer: true });
  assert.match(system, /## Connettori\nIl proprietario ti ha autorizzato su linear/);
});

test("the panel draws the catalogue and the forms from src/connectors, so a new module needs no panel code", async (t) => {
  const f = await connectorWorld(t);
  const posted = [];
  const acme = { id: "acme", name: "Acme", kind: "key", secret: "CORA_ACME_KEY", appSecrets: [], tool: "acme", icon: "link", description: "Acme di prova.", meta: "Acme · Prova", intro: "Gli agenti usano Acme.",
    modes: [{ id: "key", notice: "Serve la chiave di Acme.", rows: [{ title: "La chiave", steps: [["apri ", { href: "https://acme.test/keys", text: "acme.test/keys" }, ";"], ["salvala come ", { code: "CORA_ACME_KEY" }]], field: { name: "token", type: "password", label: "Chiave di Acme" }, submit: "Verifica e collega" }] }] };
  const panel = panelHarness({ hash: "#/settings/connettori", fetch: async (path, options = {}) => {
    if (path === "/api/connectors/keys/acme") { posted.push(JSON.parse(options.body)); return { ok: false, status: 400, json: async () => ({ error: "Chiave di prova rifiutata." }) }; }
    const response = await f.call(path, { method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined });
    if (path === "/api/connectors") response.data.catalog.push(acme);
    return { ok: response.status < 400, status: response.status, json: async () => response.data };
  } });
  const served = (await f.call("/api/connectors")).data.catalog;
  assert.deepEqual(served.map((item) => [item.id, item.kind, item.tool]), [["google", "google", ""], ["linear", "key", "linear"], ["asana", "key", "asana"], ["canva", "key", ""]]);
  assert.equal(served.find((item) => item.id === "linear").secret, "CORA_LINEAR_KEY");
  const node = panel.run("(() => {const node = connectorsPane(); app.append(node); return node;})()");
  await node.readyConnectors;
  const cards = node.querySelectorAll(".connector-card");
  assert.deepEqual(cards.map((card) => card.querySelector(".connector-card-name").textContent), ["Google", "Linear", "Asana", "Canva", "Acme"]);
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
