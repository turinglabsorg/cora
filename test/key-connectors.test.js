import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { mailWorld } from "./mail-fixtures.js";
import { panelHarness } from "./panel.js";
import { waitFor } from "./helpers.js";

const LINEAR_KEY = "lin_api_fixture_turinglabs";
const ASANA_TOKEN = "asana_fixture_pat";

async function fakeServices(t) {
  const linear = [];
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
      return send(200, { data: { viewer: { name: "Sebastiano", email: "seb@example.test", organization: { name: "Turing Labs", urlKey: "turinglabs" } } } });
    }
    if (req.url === "/asana/users/me") {
      if (req.headers.authorization !== `Bearer ${ASANA_TOKEN}`) return send(401, {});
      return send(200, { data: { gid: "1", name: "Sebastiano" } });
    }
    if (req.url === "/asana/workspaces") {
      if (req.headers.authorization !== `Bearer ${ASANA_TOKEN}`) return send(401, {});
      return send(200, { data: [{ gid: "2", name: "Turing Labs" }] });
    }
    return send(404, {});
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return { base: `http://127.0.0.1:${server.address().port}`, linear };
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
  node.querySelectorAll("button").find((button) => button.textContent === "App OAuth").click();
  assert.match(node.querySelector(".connector-detail").textContent, /client ID/);
  const clientId = node.querySelectorAll("input").find((input) => /Client ID/.test(input.getAttribute("aria-label") || ""));
  const clientSecret = node.querySelectorAll("input").find((input) => /Client secret/.test(input.getAttribute("aria-label") || ""));
  assert.ok(clientId && clientSecret);
  node.querySelectorAll("button").find((button) => button.textContent === "Catalogo connettori").click();
  node.querySelectorAll(".connector-card").find((card) => /Canva/.test(card.textContent)).click();
  assert.match(node.querySelector(".connector-detail").textContent, /app Canva/);
  node.querySelectorAll("button").find((button) => /Per ora no/.test(button.textContent)).click();
  await waitFor(() => f.app.keyConnectors.record("canva")?.status === "later");
});
