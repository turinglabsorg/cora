import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import http from "node:http";
import { test } from "node:test";
import { DSH_OFF, dshPatch } from "../src/cli.js";
import { Credentials } from "../src/credentials.js";
import { startCora } from "../src/main.js";
import { Store } from "../src/store.js";
import { GUILD, MAIN_TOKEN, OWNER, fakeCli, fakeDiscord, fakeDocker, fakeOllama, tempHome, waitFor } from "./helpers.js";

/** DeepSeek's model list, the one call that tells a good key from a wrong one. */
async function fakeDeepSeek(...keys) {
  const allowed = new Set(keys.map((key) => `Bearer ${key}`));
  const server = http.createServer((req, res) => {
    const ok = allowed.has(req.headers.authorization);
    res.writeHead(ok ? 200 : 401, { "Content-Type": "application/json" });
    res.end(JSON.stringify(ok ? { object: "list", data: [{ id: "deepseek-v4-flash", object: "model" }] } : { error: { message: "Authentication Fails" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("an agent on DeepSeek Harness runs on the instance's own DeepSeek key, with Cora's tools and none of dsh's", async (t) => {
  const deepseek = await fakeDeepSeek("ds-fixture-key");
  const discord = await fakeDiscord();
  const ollama = await fakeOllama(async (body) => {
    const system = String(body.messages[0]?.content || "");
    if (/^Scrivi la condizione di completamento/.test(system)) return { content: "NESSUNO" };
    if (/^Giudichi se un compito è finito/.test(system)) return { content: JSON.stringify({ met: true, reason: "" }) };
    return { content: "PASS" };
  });
  const cli = fakeCli();
  cli.set({ reply: "Me lo segno.", tool: "remember", args: { fact: "Sam beve il caffè amaro" }, thinking: "Lo salvo in memoria.",
    dshUsages: [{ inputTokens: 90, cacheReadTokens: 900, outputTokens: 11, totalTokens: 1001 }, { inputTokens: 10, cacheReadTokens: 1000, outputTokens: 9, totalTokens: 1019 }] });
  const home = tempHome();
  const seed = new Store(home);
  seed.updateSettings({ guildIds: [GUILD], ownerIds: [OWNER] });
  seed.close();
  const vault = {};
  const app = startCora({ home, host: "127.0.0.1", port: 0, insecureCookies: true, adminPassword: "fixture-password", sessionKey: "fixture-deepseek",
    discordToken: MAIN_TOKEN, discordApi: discord.url, ollamaUrl: ollama.url, ollamaKey: "test-ollama-key", orcaKey: "", cloudUrl: "", cloudKey: "", cloudSpace: "",
    claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes", grokBin: "/missing/grok", museBin: "/missing/muse", botTokenFor: () => "",
    deepseekBin: cli.dsh, deepseekKey: "", deepseekApi: deepseek.url, storeSecret: async (name, value) => { vault[name] = value; },
    docker: fakeDocker().path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys",
  });
  await app.ready;
  t.after(async () => {
    await app.stop();
    await Promise.all([discord.close(), ollama.close(), deepseek.close()]);
  });
  await waitFor(() => app.discord.state === "ready", { what: "gateway ready" });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Cora": "1" }, body: JSON.stringify({ password: "fixture-password" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const call = async (path, { method = "GET", body } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, "X-Cora": "1", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };

  // dsh is on the machine: the harness is there and lists what it runs. The key is the agent's choice.
  let state = (await call("/api/state")).data;
  assert.deepEqual([state.providers.deepseek, state.providers.deepseekInstalled, state.keys.deepseek], [true, true, false]);
  assert.ok(state.models.some((model) => model.id === "deepseek/deepseek-flash"));
  // No key at all, neither the space's nor a person's: an agent cannot be put on it.
  const noKey = await call("/api/agents", { method: "POST", body: { name: "Senza chiave", model: "deepseek/deepseek-flash", chattiness: 0, tools: false } });
  assert.equal(noKey.status, 400);
  assert.match(noKey.data.error, /chiave/);
  assert.equal((await call("/api/providers/deepseek/key", { method: "PUT", body: { key: "not-the-key" } })).status, 400);
  assert.deepEqual(vault, {}, "a key DeepSeek refuses never reaches hush");
  assert.equal((await call("/api/providers/deepseek/key", { method: "PUT", body: { key: "ds-fixture-key" } })).status, 200);
  assert.equal(vault.CORA_DEEPSEEK_API_KEY, "ds-fixture-key", "its own key, not the machine's DEEPSEEK_API_KEY");
  state = (await call("/api/state")).data;
  assert.equal(state.providers.deepseek, true);
  assert.deepEqual(state.models.filter((model) => model.provider === "deepseek").map((model) => model.id), ["deepseek/deepseek-flash", "deepseek/deepseek-v4-pro"]);

  const dee = (await call("/api/agents", { method: "POST", body: { name: "Dee", model: "deepseek/deepseek-flash", effort: "high", chattiness: 0, tools: false } })).data;
  assert.equal(dee.model, "deepseek/deepseek-flash");
  discord.say({ content: "@Dee, ricordati che bevo il caffè amaro" });
  const post = await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Dee"), { what: "Dee's answer" });
  assert.match(post.content, /^Me lo segno\. \[/, "the answer comes from dsh's final event, after the tool ran");
  assert.ok(app.store.memories(dee.id).some((memory) => /caffè amaro/.test(memory.text)), "remember ran through Cora's bridge");
  const trace = (await call(`/api/agents/${dee.id}/traces`)).data[0];
  assert.equal(trace.tokensIn, 2000, "cached input is included exactly once, alongside uncached input");
  assert.equal(trace.tokensOut, 20);
  assert.equal(trace.meter.modelSteps, 2, "one Cora execution contains two native model steps");
  assert.equal(trace.meter.costs[0].estimated, true);
  assert.ok(trace.meter.costs[0].amount > 0);

  const run = cli.calls().find((item) => item.flavor === "dsh");
  const patch = run.argv[run.argv.indexOf("--patch") + 1];
  assert.deepEqual(run.argv.filter((arg) => arg !== patch), ["--profile", "headless", "--patch", "--json", "-"]);
  assert.ok(!existsSync(patch), "the overlay is gone after the run");
  assert.deepEqual([run.env.DEEPSEEK_API_KEY, run.env.DSH_TELEMETRY_MODE], ["set", "DISABLED"]);
  assert.equal(run.providerKeyLast4, "-key", "with no personal key the agent runs on the space key");
  assert.match(run.env.DSH_HOME, /dsh-home$/);
  assert.ok(run.tools.includes("remember"));
  assert.match(run.stdin, /^<istruzioni_di_sistema>\nSei Dee\./);
  assert.match(run.dshPatch, /model: "deepseek-flash"\n    reasoningEffort: max/);
  assert.match(run.dshPatch, /serverName: cora/);
  for (const row of ["tool-bash", "tool-fs", "tool-web", "agent-instructions", "skill-filesystem", "session-persistence-jsonl"]) assert.match(run.dshPatch, new RegExp(`- id: ${row}\\n  disabled: true`));
  assert.equal(run.secretEnv.length, 0);
});

test("an agent on DeepSeek Harness runs on the person's own DeepSeek key, with no space key at all", async (t) => {
  const deepseek = await fakeDeepSeek("sk-mine-DEEPSEEK");
  const discord = await fakeDiscord();
  const ollama = await fakeOllama(async () => ({ content: "PASS" }));
  const cli = fakeCli();
  cli.set({ reply: "Ci sono." });
  const home = tempHome();
  const seed = new Store(home);
  seed.updateSettings({ guildIds: [GUILD], ownerIds: [OWNER] });
  seed.close();
  const vault = {};
  const app = startCora({ home, host: "127.0.0.1", port: 0, insecureCookies: true, adminPassword: "fixture-password", sessionKey: "fixture-deepseek-own",
    discordToken: MAIN_TOKEN, discordApi: discord.url, ollamaUrl: ollama.url, ollamaKey: "test-ollama-key", orcaKey: "", cloudUrl: "", cloudKey: "", cloudSpace: "",
    claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes", grokBin: "/missing/grok", museBin: "/missing/muse", botTokenFor: () => "",
    deepseekBin: cli.dsh, deepseekKey: "", deepseekApi: deepseek.url, hermesEnds: { deepseek: { baseUrl: deepseek.url, modelsUrl: `${deepseek.url}/models` } }, storeSecret: async (name, value) => { vault[name] = value; },
    docker: fakeDocker().path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys",
  });
  await app.ready;
  t.after(async () => {
    await app.stop();
    await Promise.all([discord.close(), ollama.close(), deepseek.close()]);
  });
  await waitFor(() => app.discord.state === "ready", { what: "gateway ready" });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Cora": "1" }, body: JSON.stringify({ password: "fixture-password" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const call = async (path, { method = "GET", body } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, "X-Cora": "1", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };

  const state = (await call("/api/state")).data;
  assert.deepEqual([state.providers.deepseek, state.keys.deepseek], [true, false], "the harness is here, the space key is not");
  const wrong = await call("/api/credentials", { method: "POST", body: { provider: "deepseek", secret: "sk-not-mine", label: "Sbagliata" } });
  assert.equal(wrong.status, 400, "DeepSeek refuses a key that is not its own");
  const own = await call("/api/credentials", { method: "POST", body: { provider: "deepseek", secret: "sk-mine-DEEPSEEK", label: "La mia DeepSeek" } });
  assert.equal(own.status, 201, JSON.stringify(own.data));
  assert.equal(own.data.last4, "SEEK");
  assert.equal(JSON.stringify(own.data).includes("sk-mine"), false);

  const withoutKey = await call("/api/agents", { method: "POST", body: { name: "Senza", model: "deepseek/deepseek-flash", chattiness: 0, tools: false } });
  assert.equal(withoutKey.status, 400, "there is no space key to fall back on");
  const dee = await call("/api/agents", { method: "POST", body: { name: "Dee", model: "deepseek/deepseek-flash", credentialId: own.data.id, chattiness: 0, tools: false } });
  assert.equal(dee.status, 201, JSON.stringify(dee.data));
  assert.equal(dee.data.credential.last4, "SEEK");
  assert.equal(JSON.stringify(dee.data).includes("sk-mine"), false);

  discord.say({ content: "@Dee, ci sei?" });
  const post = await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Dee"), { what: "Dee's answer" });
  assert.equal(post.content, "Ci sono.");
  const run = cli.calls().find((item) => item.flavor === "dsh");
  assert.equal(run.providerKeyLast4, "SEEK", "dsh is handed the person's key");
  assert.equal(app.llm.deepseek.key, "", "the space key is still missing: nothing else could have answered");

  const other = new Credentials({ store: app.store, key: "fixture-deepseek-own" }).create({ provider: "deepseek", secret: "sk-other-PERSON", connectedBy: { id: "ac_other", name: "Other" } });
  const stolen = await call(`/api/agents/${dee.data.id}`, { method: "PUT", body: { credentialId: other.id } });
  assert.equal(stolen.status, 403, "a key of another person is not offered to this agent");
  const cleared = await call(`/api/agents/${dee.data.id}`, { method: "PUT", body: { credentialId: "" } });
  assert.equal(cleared.status, 400, "with no space key an agent cannot be left without one");
  const ollamaOnly = new Credentials({ store: app.store, key: "fixture-deepseek-own" }).create({ provider: "ollama", secret: "sk-ollama-MINE", connectedBy: { id: "local-owner", name: "Owner" } });
  const incompatible = await call(`/api/agents/${dee.data.id}`, { method: "PUT", body: { credentialId: ollamaOnly.id } });
  assert.equal(incompatible.status, 400, "an Ollama key does not open DeepSeek");
});

test("dsh's overlay leaves DeepSeek's effort alone unless asked and carries no tools without a bridge", () => {
  const plain = dshPatch({ model: "deepseek-v4-pro", workDir: "/tmp/w" });
  assert.match(plain, /model: "deepseek-v4-pro"\n- id: system-prompt/);
  assert.doesNotMatch(plain, /reasoningEffort|mcp-client/);
  assert.equal(plain.match(/disabled: true/g).length, DSH_OFF.length);
  assert.match(dshPatch({ model: "deepseek-flash", effort: "low", workDir: "/tmp/w" }), /reasoningEffort: low/);
  assert.match(dshPatch({ model: "deepseek-flash", effort: "medium", workDir: "/tmp/w" }), /reasoningEffort: high/);
});
