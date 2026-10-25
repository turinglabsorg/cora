import assert from "node:assert/strict";
import { createECDH, createDecipheriv, createPublicKey, hkdfSync, randomBytes, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import { after, before, beforeEach, describe, test } from "node:test";
import { startCora } from "../src/main.js";
import { SHARED, Store } from "../src/store.js";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BOT, CHANNEL, GUILD, MAIN_TOKEN, OTHER_CHANNEL, OTHER_GUILD, OWNER, STRANGER, TG_GROUP, TG_OTHER_GROUP, TG_OWNER, TG_STRANGER, fakeCli, fakeDiscord, fakeDocker, fakeOllama, fakeTelegram, sleep, tempHome, waitFor } from "./helpers.js";

const PASSWORD = "correct horse battery staple";
let discord;
let telegram;
let ollama;
let docker;
let app;
let base;
let cookie = "";
let replies;
let cli;
let home;
const botTokens = {};
const hushVault = {};

function lastUserText(body) {
  const users = body.messages.filter((message) => message.role === "user");
  return users[users.length - 1]?.content || "";
}

function whoAmI(body) {
  for (const message of body.messages) {
    const name = /^Sei (\p{Lu}[^.]*)\./u.exec(String(message.content))?.[1];
    if (name) return name;
  }
  return null;
}

function lastChatLine(body) {
  const chat = /<chat>\n([\s\S]*?)\n<\/chat>/.exec(lastUserText(body))?.[1] || "";
  return chat.split("\n").pop();
}

const quiet = () => waitFor(() => app.orchestrator.quiet(), { what: "agents to stop talking", timeout: 30000 });

async function call(path, { method = "GET", body, headers = {}, auth = true } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "X-Cora": "1", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(auth && cookie ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = text;
  try { data = JSON.parse(text); } catch {}
  return { status: response.status, data, headers: response.headers };
}

before(async () => {
  discord = await fakeDiscord();
  telegram = await fakeTelegram();
  replies = new Map();
  ollama = await fakeOllama(async (body) => {
    const name = whoAmI(body);
    const handler = replies.get(name) || replies.get("*");
    return handler ? handler(body) : { content: "PASS" };
  });
  docker = fakeDocker();
  cli = fakeCli();
  home = tempHome();
  writeFileSync(join(home, "owner-AGENTS.md"), "# Global Agent Instructions\nISTRUZIONI DI PROVA: rispondi sempre in italiano.\n");
  writeFileSync(join(home, "authorized_keys"), [
    `ssh-ed25519 ${"A".repeat(68)} seb@laptop`,
    `from="10.0.0.1",restrict,command="/bin/gate" ssh-ed25519 ${"B".repeat(68)} gate@server`,
    "# a comment",
  ].join("\n"));
  const seed = new Store(home);
  seed.updateSettings({ guildIds: [GUILD] });
  seed.close();
  app = startCora({
    home,
    host: "127.0.0.1",
    port: 0,
    adminPassword: PASSWORD,
    sessionKey: "test-session-key",
    insecureCookies: true,
    discordToken: MAIN_TOKEN,
    discordApi: discord.url,
    telegramApi: telegram.url,
    telegramPollTimeout: 1,
    ollamaUrl: ollama.url,
    ollamaKey: "test-ollama-key",
    claudeBin: cli.claude,
    codexBin: cli.codex,
    codexModelsFile: cli.models,
    ownerInstructions: join(home, "owner-AGENTS.md"),
    sshAuthorizedKeys: join(home, "authorized_keys"),
    vapidKey: "test-vapid-secret",
    sshJump: "sam@host",
    botTokenFor: (name) => botTokens[name] || "",
    storeSecret: async (name, value) => { hushVault[name] = value; },
    docker: docker.path,
    schedulerTickMs: 3600000,
    startBoxes: false,
  });
  await app.ready;
  base = `http://127.0.0.1:${app.server.address().port}`;
  await waitFor(() => app.discord.state === "ready" && app.discord.guilds.size === 2, { what: "gateway ready" });
});

after(async () => {
  await app.stop();
  await discord.close();
  await telegram.close();
  await ollama.close();
});

beforeEach(async () => {
  if (app) await quiet();
  replies.clear();
  discord.state.webhookPosts.length = 0;
  discord.state.botPosts.length = 0;
});

describe("panel auth", () => {
  test("refuses a wrong password and API calls without a session", async () => {
    const wrong = await call("/api/login", { method: "POST", body: { password: "nope" }, auth: false });
    assert.equal(wrong.status, 401);
    const state = await call("/api/state", { auth: false });
    assert.equal(state.status, 401);
  });

  test("refuses mutating requests without the X-Cora header or from another origin", async () => {
    const missing = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: PASSWORD }) });
    assert.equal(missing.status, 403);
    const foreign = await call("/api/login", { method: "POST", body: { password: PASSWORD }, headers: { Origin: "https://evil.example" }, auth: false });
    assert.equal(foreign.status, 403);
  });

  test("logs in with the right password", async () => {
    const ok = await call("/api/login", { method: "POST", body: { password: PASSWORD }, auth: false });
    assert.equal(ok.status, 200);
    const setCookie = ok.headers.get("set-cookie");
    assert.match(setCookie, /cora_session=.+HttpOnly; SameSite=Strict/);
    cookie = setCookie.split(";")[0];
    const me = await call("/api/me");
    assert.equal(me.data.authed, true);
  });

  test("serves the panel with a strict CSP", async () => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
    assert.match(await response.text(), /assets\/app\.js/);
  });
});

describe("agents in Discord", () => {
  let marta;
  let bea;

  test("the owner comes from the allowed server and the client server stays out", async () => {
    const state = await call("/api/state");
    assert.equal(state.status, 200);
    assert.deepEqual(state.data.settings.ownerIds, [OWNER]);
    assert.ok(state.data.channels.some((channel) => channel.id === CHANNEL));
    assert.ok(!state.data.channels.some((channel) => channel.id === OTHER_CHANNEL));
    assert.ok(state.data.models.some((model) => model.id === "ollama/test-model"));
    assert.ok(state.data.models.some((model) => model.id === "claude/claude-opus-5-5"));
    assert.ok(state.data.models.some((model) => model.id === "codex/gpt-6-sol"));
    assert.ok(!state.data.models.some((model) => model.id === "codex/hidden"));
    assert.deepEqual(state.data.providers, { claude: true, codex: true, ollama: true });
  });

  test("creates two agents through the API", async () => {
    const one = await call("/api/agents", { method: "POST", body: { name: "Marta", model: "ollama/test-model", personality: "Cinica e precisa.", chattiness: 1, tools: false } });
    assert.equal(one.status, 201);
    marta = one.data;
    const two = await call("/api/agents", { method: "POST", body: { name: "Bea", model: "ollama/test-model", personality: "Entusiasta.", chattiness: 0, tools: false } });
    assert.equal(two.status, 201);
    bea = two.data;
    const duplicate = await call("/api/agents", { method: "POST", body: { name: "marta" } });
    assert.equal(duplicate.status, 400);
  });

  test("an agent answers the owner through a webhook with its own name", async () => {
    replies.set("Marta", () => ({ content: "Ciao capo, eccomi." }));
    discord.say({ content: "ciao a tutti" });
    const post = await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Marta"), { what: "Marta's reply" });
    assert.equal(post.content, "Ciao capo, eccomi.");
    assert.equal(fakeOllama.lastAuth, "Bearer test-ollama-key");
    assert.equal(post.authorized, false);
    assert.deepEqual(post.allowed_mentions, { parse: ["users"] });
  });

  test("a mention makes a quiet agent answer, and agents talk to each other", async () => {
    replies.set("Bea", (body) => (lastChatLine(body).includes("Marta (agente): Bea, tu che dici?")
      ? { content: "Dico che hai ragione, Marta!" }
      : { content: "Sono Bea, presente. Marta, salutami." }));
    replies.set("Marta", (body) => (lastChatLine(body).includes("Sono Bea, presente.") ? { content: "Bea, tu che dici?" } : { content: "PASS" }));
    discord.say({ content: "Bea ci sei?" });
    await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Bea" && item.content.startsWith("Sono Bea, presente.")), { what: "Bea forced reply" });
    await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Marta" && item.content === "Bea, tu che dici?"), { what: "Marta follow-up" });
    await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Bea" && item.content === "Dico che hai ragione, Marta!"), { what: "Bea answers Marta" });
  });

  test("messages from a server cora does not use are ignored", async () => {
    replies.set("*", () => ({ content: "non dovrei parlare" }));
    discord.say({ content: "Marta ci sei?", channel: OTHER_CHANNEL, guild: OTHER_GUILD, author: STRANGER, username: "Cliente" });
    await sleep(2500);
    assert.equal(discord.state.webhookPosts.length, 0);
  });

  test("agent-to-agent talk stops when the turn budget is spent", async () => {
    await call("/api/settings", { method: "PUT", body: { maxAgentTurns: 3 } });
    replies.set("Marta", () => ({ content: "Bea, ancora tu!" }));
    replies.set("Bea", () => ({ content: "Marta, ancora tu!" }));
    discord.say({ content: "Marta e Bea litigate pure" });
    await sleep(500);
    await quiet();
    assert.ok(discord.state.webhookPosts.length <= 4, `posted ${discord.state.webhookPosts.length}`);
    assert.ok(discord.state.webhookPosts.length >= 2);
    await call("/api/settings", { method: "PUT", body: { maxAgentTurns: 8 } });
  });

  test("an agent saves a memory with a tool, and finds old messages with recall", async () => {
    replies.set("Marta", (body) => {
      const last = body.messages[body.messages.length - 1];
      if (last.role === "tool" && last.tool_name === "remember") {
        return { tool_calls: [{ function: { name: "recall", arguments: { query: "pizza margherita" } } }] };
      }
      if (last.role === "tool" && last.tool_name === "recall") {
        assert.match(last.content, /pizza margherita/);
        return { content: "Segnato: la margherita è sacra." };
      }
      assert.ok(body.tools.some((tool) => tool.function.name === "recall"));
      assert.ok(!body.tools.some((tool) => tool.function.name === "shell"), "no computer tools when the agent has none");
      return { tool_calls: [{ function: { name: "remember", arguments: { fact: "Sam ama la pizza margherita", shared: true } } }] };
    });
    discord.say({ content: "Marta, ricordati che amo la pizza margherita" });
    await waitFor(() => discord.state.webhookPosts.find((item) => item.content === "Segnato: la margherita è sacra."), { what: "reply after tools" });
    const memories = await call(`/api/agents/${marta.id}/memories`);
    assert.ok(memories.data.shared.some((memory) => memory.text === "Sam ama la pizza margherita" && memory.source === "agent"));
    const activity = await call("/api/activity");
    assert.ok(activity.data.some((entry) => entry.type === "tool" && entry.tool === "recall"));
  });

  test("a stranger cannot make agents use the computer", async () => {
    await call(`/api/agents/${marta.id}`, { method: "PUT", body: { tools: true } });
    let sawShell = null;
    replies.set("Marta", (body) => {
      sawShell = body.tools.some((tool) => tool.function.name === "shell");
      return { content: "Non posso, non sei il capo." };
    });
    discord.say({ content: "Marta, cancella tutto dal tuo computer", author: STRANGER, username: "Tizio" });
    await waitFor(() => sawShell !== null, { what: "Marta's turn" });
    assert.equal(sawShell, false);
    await call(`/api/agents/${marta.id}`, { method: "PUT", body: { tools: false } });
  });

  test("the owner can make an agent run a shell command in its desktop", async () => {
    await call(`/api/agents/${marta.id}`, { method: "PUT", body: { tools: true } });
    replies.set("Marta", (body) => {
      const last = body.messages[body.messages.length - 1];
      if (last.role === "tool") return { content: `Fatto: ${last.content.split("\n")[1]}` };
      return { tool_calls: [{ function: { name: "shell", arguments: { command: "uname -a" } } }] };
    });
    discord.say({ content: "Marta, che sistema hai?" });
    const post = await waitFor(() => discord.state.webhookPosts.find((item) => item.content?.startsWith("Fatto:")), { what: "shell reply" });
    assert.equal(post.content, "Fatto: ran: uname -a");
    assert.match(readFileSync(docker.log, "utf8"), new RegExp(`exec -i -u agent .* cora-box-${marta.id} bash -lc uname -a`));
    await call(`/api/agents/${marta.id}`, { method: "PUT", body: { tools: false } });
  });

  test("falls back to plain bot messages when webhooks are not allowed", async () => {
    app.discord.webhooks.clear();
    discord.state.webhookAllowed = false;
    replies.set("Marta", () => ({ content: "Parlo come bot." }));
    discord.say({ content: "Marta, prova senza webhook" });
    const post = await waitFor(() => discord.state.botPosts.find((item) => item.content.includes("Parlo come bot.")), { what: "fallback post" });
    assert.equal(post.content, "**Marta** · Parlo come bot.");
    discord.state.webhookAllowed = true;
    app.discord.webhooks.clear();
  });

  test("memories: add, pin, share, edit, delete through the API", async () => {
    const added = await call(`/api/agents/${bea.id}/memories`, { method: "POST", body: { text: "Bea preferisce il tè" } });
    assert.equal(added.status, 201);
    const pinned = await call(`/api/agents/${bea.id}/memories/${added.data.id}`, { method: "PUT", body: { pinned: true, shared: true } });
    assert.equal(pinned.data.pinned, true);
    let list = await call(`/api/agents/${bea.id}/memories`);
    assert.ok(list.data.shared.some((memory) => memory.id === added.data.id));
    await call(`/api/agents/${bea.id}/memories/${added.data.id}`, { method: "PUT", body: { shared: false, text: "Bea preferisce il tè verde" } });
    list = await call(`/api/agents/${bea.id}/memories`);
    assert.ok(list.data.facts.some((memory) => memory.text === "Bea preferisce il tè verde" && memory.pinned));
    const removed = await call(`/api/agents/${bea.id}/memories/${added.data.id}`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    const core = await call(`/api/agents/${bea.id}/core`, { method: "PUT", body: { text: "Sam è il capo." } });
    assert.equal(core.data.core, "Sam è il capo.");
  });

  test("relevant memories reach the agent, pinned ones always", async () => {
    app.store.addMemory(marta.id, "Il gatto di Sam si chiama Ugo", "manual");
    app.store.addMemory(marta.id, "Odia il caffè americano", "manual", { pinned: true });
    let prompt = "";
    replies.set("Marta", (body) => {
      prompt = lastUserText(body);
      return { content: "Ugo è il re di casa." };
    });
    discord.say({ content: "Marta, come sta il gatto?" });
    await waitFor(() => discord.state.webhookPosts.find((item) => item.content === "Ugo è il re di casa."), { what: "reply" });
    assert.match(prompt, /Il gatto di Sam si chiama Ugo/);
    assert.match(prompt, /Odia il caffè americano \(fissato\)/);
  });

  test("sleep consolidates memory: new facts, merged duplicates, core card, diary", async () => {
    const dup = app.store.addMemory(marta.id, "Sam ha un gatto", "agent");
    replies.set("Marta", (body) => {
      assert.match(lastUserText(body), /pizza margherita/);
      return {
        content: JSON.stringify({
          core: "Sam: ama la margherita, ha un gatto di nome Ugo. Bea è entusiasta.",
          add: [{ text: "Sam usa Discord per parlare con gli agenti", shared: false }],
          update: [],
          remove: [dup.id, "mem_not_mine"],
          diary: "Oggi ho conosciuto Bea e parlato di pizza.",
        }),
      };
    });
    const started = await call(`/api/agents/${marta.id}/sleep`, { method: "POST" });
    assert.equal(started.status, 202);
    const memories = await waitFor(async () => {
      const data = (await call(`/api/agents/${marta.id}/memories`)).data;
      return data.diary.length ? data : null;
    }, { what: "diary page" });
    assert.equal(memories.core, "Sam: ama la margherita, ha un gatto di nome Ugo. Bea è entusiasta.");
    assert.ok(memories.facts.some((memory) => memory.text === "Sam usa Discord per parlare con gli agenti" && memory.source === "sleep"));
    assert.ok(!memories.facts.some((memory) => memory.id === dup.id));
    assert.ok(memories.lastSleepAt);
    assert.ok(app.store.memories(SHARED).length >= 1);
  });

  test("a routine runs on demand and posts in its channel", async () => {
    const bad = await call(`/api/agents/${bea.id}/routines`, { method: "POST", body: { name: "x", schedule: "61 * * * *", channelId: CHANNEL, prompt: "x" } });
    assert.equal(bad.status, 400);
    const created = await call(`/api/agents/${bea.id}/routines`, { method: "POST", body: { name: "Buongiorno", schedule: "0 9 * * *", channelId: CHANNEL, prompt: "Saluta tutti" } });
    assert.equal(created.status, 201);
    assert.ok(created.data.nextRunAt);
    replies.set("Bea", (body) => {
      assert.match(lastUserText(body), /routine "Buongiorno"/);
      return { content: "Buongiorno a tutti!" };
    });
    const run = await call(`/api/routines/${created.data.id}/run`, { method: "POST" });
    assert.equal(run.status, 202);
    await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Bea" && item.content === "Buongiorno a tutti!"), { what: "routine post" });
    const state = await waitFor(async () => {
      const data = (await call("/api/state")).data;
      return data.routines.find((routine) => routine.id === created.data.id && routine.lastStatus === "posted") ? data : null;
    }, { what: "routine status" });
    assert.ok(state);
  });

  test("an agent on Claude Code (subscription) uses cora's memory tools over MCP", async () => {
    const created = await call("/api/agents", { method: "POST", body: { name: "Clara", model: "claude/claude-sonnet-5-5", chattiness: 0, tools: false } });
    assert.equal(created.status, 201);
    cli.set({ tool: "remember", args: { fact: "Il colore preferito di Sam è il verde" }, reply: "Me lo segno." });
    process.env.CORA_BOT_LEAK = "not-for-the-cli";
    discord.say({ content: "Clara, il mio colore preferito è il verde" });
    const post = await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Clara"), { what: "Clara's reply" });
    delete process.env.CORA_BOT_LEAK;
    assert.match(post.content, /^Me lo segno\. \[saved \[mem_/);
    const run = cli.calls().find((item) => item.flavor === "claude");
    assert.equal(run.argv[run.argv.indexOf("--model") + 1], "claude-sonnet-5-5");
    assert.equal(run.argv[run.argv.indexOf("--tools") + 1], "", "Claude Code's own tools are off");
    assert.ok(run.argv.includes("--no-session-persistence"));
    assert.deepEqual(run.secretEnv, [], "no bot token reaches the CLI");
    assert.match(run.argv[run.argv.indexOf("--system-prompt") + 1], /^Sei Clara\./);
    assert.match(run.argv[run.argv.indexOf("--system-prompt") + 1], /<istruzioni_personali>\n# Global Agent Instructions\nISTRUZIONI DI PROVA/);
    assert.deepEqual(run.argv[run.argv.indexOf("--allowedTools") + 1].split(","), ["mcp__cora__say", "mcp__cora__remember", "mcp__cora__forget", "mcp__cora__recall", "mcp__cora__update_core", "mcp__cora__notify", "mcp__cora__ask_owner"]);
    assert.ok(run.tools.includes("recall") && !run.tools.includes("shell"));
    assert.match(run.stdin, /Clara, il mio colore preferito è il verde/);
    const memories = await call(`/api/agents/${created.data.id}/memories`);
    assert.ok(memories.data.facts.some((memory) => memory.text === "Il colore preferito di Sam è il verde"));
    assert.ok(!readdirSync(join(home, "cli-work")).some((name) => name.startsWith("mcp-")), "the MCP config with the run token is deleted");
    assert.ok(run.argv.includes("stream-json") && run.argv.includes("--verbose"), "Claude Code streams its steps");
    const [summary] = (await call(`/api/agents/${created.data.id}/traces`)).data;
    const trace = (await call(`/api/traces/${summary.id}`)).data;
    assert.equal(trace.status, "done");
    assert.match(trace.system, /^Sei Clara\./);
    assert.match(trace.prompt, /Clara, il mio colore preferito è il verde/);
    assert.ok(trace.steps.some((step) => step.type === "thinking" && step.hidden), "Claude's hidden thinking is marked, not invented");
    assert.ok(trace.steps.some((step) => step.type === "text" && step.text === "Prima controllo."), "text between tool calls is kept");
    const tool = trace.steps.find((step) => step.type === "tool");
    assert.equal(tool.name, "remember");
    assert.equal(tool.args.fact, "Il colore preferito di Sam è il verde");
    assert.match(tool.result, /^saved \[mem_/);
    assert.equal(trace.steps.filter((step) => step.type === "text").length, 1, "the answer is not repeated as a step");
    assert.match(trace.output, /^Me lo segno\./);
    await call(`/api/agents/${created.data.id}`, { method: "DELETE" });
  });

  test("an agent on Codex (ChatGPT subscription) gets cora's desktop tools from the owner, never Codex's shell", async () => {
    const created = await call("/api/agents", { method: "POST", body: { name: "Gino", model: "codex/gpt-6-sol", chattiness: 0, tools: true } });
    cli.set({ tool: "shell", args: { command: "date" }, reply: "Ecco la data.", thinking: "**Controllo l'ora** sul mio computer con date." });
    discord.say({ content: "Gino, che ore sono sul tuo computer?" });
    const post = await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Gino"), { what: "Gino's reply" });
    assert.match(post.content, /^Ecco la data\. \[\[exit 0\]/);
    const run = cli.calls().find((item) => item.flavor === "codex");
    assert.match(run.stdin, /ISTRUZIONI DI PROVA/);
    for (const feature of ["shell_tool", "unified_exec", "computer_use", "browser_use", "multi_agent"]) {
      assert.ok(run.argv.some((arg, index) => arg === feature && run.argv[index - 1] === "--disable"), `${feature} is disabled`);
    }
    assert.equal(run.argv[run.argv.indexOf("-m") + 1], "gpt-6-sol");
    assert.ok(run.argv.includes("--ephemeral") && run.argv.includes("read-only"));
    assert.ok(run.argv.includes("mcp_servers.cora.default_tools_approval_mode=\"approve\""), "cora's tools run without an approval prompt");
    assert.ok(run.tools.includes("shell") && run.tools.includes("screenshot"));
    assert.match(run.stdin, /<istruzioni_di_sistema>\nSei Gino\./);
    assert.match(readFileSync(docker.log, "utf8"), new RegExp(`cora-box-${created.data.id} bash -lc date`));
    assert.ok(run.argv.includes("--json") && run.argv.includes("model_reasoning_summary=\"detailed\""), "Codex streams its reasoning summary");
    const [summary] = (await call(`/api/agents/${created.data.id}/traces`)).data;
    const trace = (await call(`/api/traces/${summary.id}`)).data;
    assert.ok(trace.steps.some((step) => step.type === "thinking" && step.text === "**Controllo l'ora** sul mio computer con date."));
    assert.ok(trace.steps.some((step) => step.type === "tool" && step.name === "shell" && step.args.command === "date"));
    assert.deepEqual(summary.tools, ["shell"]);
    await call(`/api/agents/${created.data.id}`, { method: "DELETE" });
  });

  test("a tool call with an unknown run token is refused by the bridge", async () => {
    const response = await fetch(`${app.bridge.url}/tools/call`, { method: "POST", headers: { Authorization: "Bearer nope" }, body: "{}" });
    assert.equal(response.status, 401);
  });

  test("an agent with its own bot token talks as its own Discord user and answers @mentions", async () => {
    const PIA = "600000000000000001";
    botTokens.CORA_BOT_PIA = "pia-token";
    discord.state.botUsers.set("pia-token", { id: PIA, username: "pia-old" });
    const created = await call("/api/agents", { method: "POST", body: { name: "Pia", model: "ollama/test-model", chattiness: 0, tools: false } });
    await waitFor(() => app.bots.client(created.data.id), { what: "Pia's bot online" });
    await waitFor(() => discord.state.profilePatches.some((patch) => patch.token === "pia-token" && patch.username === "Pia"), { what: "profile sync" });
    let prompt = "";
    replies.set("Pia", (body) => {
      prompt = lastUserText(body);
      return { content: "Eccomi, sono Pia." };
    });
    discord.say({ content: `<@${PIA}> ci sei?`, mentions: [{ id: PIA, username: "Pia" }] });
    const post = await waitFor(() => discord.state.botPosts.find((item) => item.token === "pia-token"), { what: "Pia's own post" });
    assert.equal(post.content, "Eccomi, sono Pia.");
    assert.match(prompt, /Sam ★: @Pia ci sei\?/);
    assert.ok(!discord.state.webhookPosts.some((item) => item.username === "Pia"), "no webhook when the agent has its own bot");
    await sleep(3000);
    assert.equal(discord.state.botPosts.filter((item) => item.token === "pia-token").length, 1, "its own echo does not start a new round");
    const agent = await call(`/api/agents/${created.data.id}`);
    assert.equal(agent.data.bot.env, "CORA_BOT_PIA");
    assert.equal(agent.data.bot.user.id, PIA);
    assert.equal(agent.data.bot.inGuild, true);
    assert.match(agent.data.bot.inviteUrl, new RegExp(`client_id=${PIA}&scope=bot&permissions=\\d+&guild_id=`));
    delete botTokens.CORA_BOT_PIA;
    await call(`/api/agents/${created.data.id}`, { method: "DELETE" });
    assert.equal(app.bots.client(created.data.id), null);
  });

  test("a bot token pasted in the panel is checked with Discord, stored in hush and connected at once", async () => {
    const LIA = "600000000000000002";
    const token = (tail) => `MTQ2NzEyMzQ1Njc4OTAxMjM0NQ.Gabcde.${tail.padEnd(27, "x")}`;
    discord.state.botUsers.set(token("lia"), { id: LIA, username: "lia-app" });
    discord.state.botUsers.set(token("human"), { id: "600000000000000003", username: "persona", bot: false });
    discord.state.botUsers.set(token("main"), { id: BOT, username: "GROG" });
    const lia = await call("/api/agents", { method: "POST", body: { name: "Lia", model: "ollama/test-model", chattiness: 0, tools: false } });
    const other = await call("/api/agents", { method: "POST", body: { name: "Leo", model: "ollama/test-model", chattiness: 0, tools: false } });
    const paste = (agent, value) => call(`/api/agents/${agent.data.id}/bot`, { method: "PUT", body: { token: value } });

    assert.match((await paste(lia, "ciao")).data.error, /non sembra un token/);
    assert.match((await paste(lia, token("unknown"))).data.error, /Discord rifiuta/);
    assert.match((await paste(lia, token("human"))).data.error, /non è di un bot/);
    const main = await paste(lia, token("main"));
    assert.equal(main.status, 400);
    assert.match(main.data.error, /bot principale/);
    assert.deepEqual(hushVault, {}, "nothing is stored until Discord accepts the token");

    const saved = await paste(lia, ` Bot ${token("lia")} `);
    assert.equal(saved.status, 200);
    assert.equal(hushVault.CORA_BOT_LIA, token("lia"));
    assert.equal(saved.data.bot.user.id, LIA);
    assert.equal(saved.data.bot.inGuild, true);
    assert.equal(JSON.stringify(saved.data).includes(token("lia")), false, "the token never comes back");
    await waitFor(() => discord.state.profilePatches.some((patch) => patch.token === token("lia") && patch.username === "Lia"), { what: "profile sync" });

    const taken = await paste(other, token("lia"));
    assert.equal(taken.status, 400);
    assert.match(taken.data.error, /già collegato a un altro agente/);
    assert.equal(hushVault.CORA_BOT_LEO, undefined);

    await call(`/api/agents/${lia.data.id}`, { method: "DELETE" });
    await call(`/api/agents/${other.data.id}`, { method: "DELETE" });
    assert.equal(app.bots.client(lia.data.id), null);
  });

  test("the owner talks to one agent from the panel and can read why it answered", async () => {
    const created = await call("/api/agents", { method: "POST", body: { name: "Vale", model: "ollama/test-model", chattiness: 0, tools: false } });
    const room = `web-${created.data.id}`;
    replies.set("Vale", (body) => {
      if (!body.messages.some((message) => message.role === "tool")) {
        return { thinking: "Mi chiede del colore: controllo nei ricordi.", tool_calls: [{ function: { name: "recall", arguments: { query: "colore preferito" } } }] };
      }
      return { thinking: "Trovato, rispondo.", content: "Il verde, me lo ricordo." };
    });
    const sent = await call(`/api/rooms/${room}/messages`, { method: "POST", body: { text: "Qual è il mio colore preferito?" } });
    assert.equal(sent.status, 201);
    assert.equal(sent.data.kind, "owner");
    const reply = await waitFor(async () => (await call(`/api/rooms/${room}/messages`)).data.messages.find((item) => item.agentId === created.data.id), { what: "Vale's reply in the panel" });
    assert.equal(reply.content, "Il verde, me lo ricordo.");
    assert.ok(!discord.state.webhookPosts.some((post) => post.username === "Vale") && !discord.state.botPosts.some((post) => post.content.includes("verde")), "panel chats stay off Discord");

    const trace = (await call(`/api/traces/${reply.traceId}`)).data;
    assert.equal(trace.kind, "chat");
    assert.equal(trace.channelId, room);
    assert.equal(trace.status, "done");
    assert.match(trace.prompt, /Qual è il mio colore preferito\?/);
    assert.match(trace.prompt, /Ultimi messaggi nella chat privata del pannello \(ci siete solo tu e il proprietario/);
    assert.deepEqual(trace.steps.map((step) => step.type), ["thinking", "tool", "thinking"]);
    assert.equal(trace.steps[0].text, "Mi chiede del colore: controllo nei ricordi.");
    assert.deepEqual([trace.steps[1].name, trace.steps[1].args.query, trace.steps[1].ok], ["recall", "colore preferito", true]);
    assert.equal(trace.output, "Il verde, me lo ricordo.");
    assert.equal((await call(`/api/agents/${created.data.id}/traces`)).data[0].id, trace.id);
    assert.ok(app.brain.channelIdsFor(app.store.agent(created.data.id)).includes(room), "the private chat is part of its memory");

    assert.equal((await call(`/api/rooms/${room}/messages`, { method: "POST", body: { text: "  " } })).status, 400);
    assert.equal((await call("/api/rooms/web-nobody/messages")).status, 404);
    assert.equal((await call("/api/traces/tr_0000")).status, 404);
    await call(`/api/agents/${created.data.id}`, { method: "DELETE" });
  });

  test("in the salotto the agent called by name answers, live on the panel's event stream", async () => {
    const created = await call("/api/agents", { method: "POST", body: { name: "Ugo", model: "ollama/test-model", chattiness: 0, tools: false } });
    replies.set("Ugo", () => ({ content: "Ciao dal salotto!" }));
    const abort = new AbortController();
    const stream = await fetch(`${base}/api/events`, { headers: { Cookie: cookie }, signal: abort.signal });
    let events = "";
    const reading = (async () => {
      const decoder = new TextDecoder();
      try { for await (const chunk of stream.body) events += decoder.decode(chunk, { stream: true }); } catch {}
    })();
    const sent = await call("/api/rooms/web/messages", { method: "POST", body: { text: "Ugo, ci sei?" } });
    assert.equal(sent.status, 201);
    const reply = await waitFor(async () => (await call("/api/rooms/web/messages")).data.messages.find((item) => item.agentId === created.data.id), { what: "Ugo's reply" });
    assert.equal(reply.content, "Ciao dal salotto!");
    await waitFor(() => events.includes("Ciao dal salotto!"), { what: "the reply on the event stream" });
    const parsed = events.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
    assert.ok(parsed.some((event) => event.type === "web-message" && event.room === "web" && event.item.content === "Ugo, ci sei?"));
    assert.ok(parsed.some((event) => event.type === "trace" && event.event === "start" && event.trace.agentId === created.data.id && event.trace.channelId === "web"));
    assert.ok(parsed.some((event) => event.type === "trace" && event.event === "end" && event.trace.id === reply.traceId && event.trace.status === "done"));
    const trace = (await call(`/api/traces/${reply.traceId}`)).data;
    assert.match(trace.prompt, /Ultimi messaggi nel salotto del pannello/);
    assert.match(trace.system, /^Sei Ugo\./, "the shared system prompt comes back with the trace");
    abort.abort();
    await reading;
    await quiet();
    await call(`/api/agents/${created.data.id}`, { method: "DELETE" });
  });

  test("desktops get SSH on a fixed port with the host's plain keys, Tailscale SSH after a login link, and upgrades that keep the volumes", async () => {
    const { rmSync } = await import("node:fs");
    const phone = `ssh-ed25519 ${"C".repeat(68)} telefono`;
    const saved = await call("/api/settings", { method: "PUT", body: { sshKeys: [phone, "not a key"] } });
    assert.deepEqual(saved.data.sshKeys, [phone]);
    writeFileSync(join(docker.dir, "inspect"), "MISSING");
    const created = await call("/api/agents", { method: "POST", body: { name: "Sara", model: "ollama/test-model", chattiness: 0, tools: true } });
    const agent = await waitFor(() => app.store.agent(created.data.id)?.sshPort && app.store.agent(created.data.id), { what: "an SSH port" });
    const runs = () => readFileSync(docker.log, "utf8").split("\n").filter((line) => line.startsWith(`run -d --name cora-box-${agent.id} `));
    await waitFor(() => runs().length === 1, { what: "the box to be created" });
    assert.match(runs()[0], new RegExp(`-p 127\\.0\\.0\\.1:${agent.sshPort}:22 `));
    assert.match(runs()[0], new RegExp(`-v cora-home-${agent.id}:/home/agent -v cora-sys-${agent.id}:/var/lib/cora `));
    const keys = await waitFor(() => { try { return readFileSync(join(docker.dir, "authorized_keys"), "utf8"); } catch { return ""; } }, { what: "authorized keys" });
    assert.match(keys, /seb@laptop/);
    assert.match(keys, /telefono/);
    assert.doesNotMatch(keys, /gate@server/, "keys with options (restricted ones) are never copied");

    rmSync(join(docker.dir, "inspect"));
    const access = await call(`/api/agents/${agent.id}/box/access`);
    assert.equal(access.data.ssh.command, "ssh -J sam@host -p 2201 agent@127.0.0.1");
    assert.equal(access.data.tailscale.state, "NeedsLogin");
    const connect = await call(`/api/agents/${agent.id}/box/tailscale`, { method: "POST" });
    assert.equal(connect.data.authUrl, "https://login.tailscale.com/a/test");
    assert.match(readFileSync(docker.log, "utf8"), new RegExp(`exec -i -u root .*cora-box-${agent.id} tailscale up --ssh --hostname=sara --accept-dns=false`));
    writeFileSync(join(docker.dir, "tailscale.json"), JSON.stringify({ BackendState: "Running", Self: { HostName: "sara", DNSName: "sara.tail1234.ts.net.", TailscaleIPs: ["100.64.0.9"], Online: true } }));
    const running = await call(`/api/agents/${agent.id}/box/tailscale`, { method: "POST" });
    assert.deepEqual([running.data.state, running.data.host, running.data.dnsName], ["Running", "sara", "sara.tail1234.ts.net"]);
    assert.match(readFileSync(docker.log, "utf8"), new RegExp(`cora-box-${agent.id} tailscale set --ssh --hostname=sara`));

    writeFileSync(join(docker.dir, "inspect"), '{"Running":true,"Status":"running"}\t{"22/tcp":[{"HostPort":"2201"}]}\tsha256:old\t/home/agent,/var/lib/cora,\n');
    app.boxes.imageCache.at = 0;
    assert.equal((await call(`/api/agents/${agent.id}`)).data.box.outdated, true);
    await app.boxes.ensure(app.store.agent(agent.id));
    assert.equal(runs().length, 1, "a running box is not recreated behind the agent's back");
    const upgraded = await call(`/api/agents/${agent.id}/box/upgrade`, { method: "POST" });
    assert.equal(upgraded.status, 200);
    assert.equal(runs().length, 2, "the upgrade recreates the box from the new image");
    assert.match(readFileSync(docker.log, "utf8"), new RegExp(`rm -f cora-box-${agent.id}\n`));
    assert.doesNotMatch(readFileSync(docker.log, "utf8"), new RegExp(`volume rm .*${agent.id}`), "volumes are kept");

    rmSync(join(docker.dir, "inspect"));
    rmSync(join(docker.dir, "tailscale.json"));
    await call("/api/settings", { method: "PUT", body: { sshKeys: [] } });
    await call(`/api/agents/${agent.id}`, { method: "DELETE" });
  });

  test("the desktop proxy needs a session", async () => {
    const response = await fetch(`${base}/box/${marta.id}/vnc.html`);
    assert.equal(response.status, 401);
  });

  test("deleting an agent removes its desktop container", async () => {
    const removed = await call(`/api/agents/${bea.id}`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    assert.match(readFileSync(docker.log, "utf8"), new RegExp(`rm -f cora-box-${bea.id}`));
    const state = await call("/api/state");
    assert.ok(!state.data.agents.some((agent) => agent.id === bea.id));
    assert.ok(!state.data.routines.some((routine) => routine.agentId === bea.id));
  });
});

/** A phone for Web Push: its own key pair, and a push service that keeps what it receives. */
async function fakePhone() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const received = [];
  let status = 201;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(status);
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const decrypt = ({ body }) => {
    const salt = body.subarray(0, 16);
    const sender = body.subarray(21, 21 + body[20]);
    const shared = ecdh.computeSecret(sender);
    const ikm = Buffer.from(hkdfSync("sha256", shared, auth, Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), sender]), 32));
    const key = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
    const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
    const data = body.subarray(21 + body[20]);
    const decipher = createDecipheriv("aes-128-gcm", key, nonce);
    decipher.setAuthTag(data.subarray(data.length - 16));
    const plain = Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]);
    assert.equal(plain[plain.length - 1], 2, "last record delimiter");
    return JSON.parse(plain.subarray(0, plain.length - 1).toString("utf8"));
  };
  const vapidValid = ({ headers }) => {
    const [, jwt, key] = /^vapid t=([^,]+), k=(\S+)$/.exec(headers.authorization);
    const [head, claims, signature] = jwt.split(".");
    const raw = Buffer.from(key, "base64url");
    const publicKey = createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") } });
    const payload = JSON.parse(Buffer.from(claims, "base64url").toString("utf8"));
    return verify("sha256", Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")) && payload.aud === `http://127.0.0.1:${server.address().port}` ? payload : null;
  };
  return {
    subscription: { endpoint: `http://127.0.0.1:${server.address().port}/push/phone`, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } },
    received, decrypt, vapidValid,
    gone() { status = 410; },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

describe("talking with the agents", () => {
  const posts = (name) => discord.state.webhookPosts.filter((item) => item.username === name).map((item) => item.content);
  let olga;
  let pino;

  before(async () => {
    olga = (await call("/api/agents", { method: "POST", body: { name: "Olga", model: "ollama/test-model", chattiness: 1, tools: true, channelIds: [CHANNEL] } })).data;
    pino = (await call("/api/agents", { method: "POST", body: { name: "Pino", model: "ollama/test-model", chattiness: 1, tools: false, channelIds: [CHANNEL] } })).data;
    for (const agent of app.store.agents()) {
      if (![olga.id, pino.id].includes(agent.id) && agent.enabled) await call(`/api/agents/${agent.id}`, { method: "PUT", body: { enabled: false } });
    }
  });

  test("only the agent you name answers, a follow-up without names goes to it again, and a mention of someone else keeps them quiet", async () => {
    replies.set("Olga", () => ({ content: "Sono Olga, dimmi." }));
    replies.set("Pino", () => ({ content: "Anche io!" }));
    discord.say({ content: "Olga, ci sei?" });
    await waitFor(() => posts("Olga").length === 1, { what: "Olga" });
    discord.say({ content: "allora ascolta" });
    await waitFor(() => posts("Olga").length === 2, { what: "Olga again" });
    await quiet();
    assert.deepEqual(posts("Pino"), [], "Pino stays out even though he is chatty");

    discord.say({ content: "<@700000000000000001> ci sei?", mentions: [{ id: "700000000000000001", username: "GROG" }] });
    await sleep(2500);
    await quiet();
    assert.equal(posts("Olga").length, 2);
    assert.deepEqual(posts("Pino"), []);

    discord.say({ content: "", type: 7, author: "700000000000000002", username: "NuovoBot", bot: true });
    await sleep(1500);
    assert.equal((await call(`/api/rooms/web/messages`)).status, 200);
    assert.ok(!app.store.recentMessages(CHANNEL, 10).some((item) => item.content === "(messaggio vuoto)"), "system messages are not archived");
  });

  test("a busy agent says it is on it, gets the new messages while it works, and a named agent that passes is asked again", async () => {
    app.orchestrator.ackAfterMs = 300;
    let steered = "";
    replies.set("Olga", async (body) => {
      const last = body.messages[body.messages.length - 1];
      if (last.role !== "tool") {
        discord.say({ content: "Olga, anzi controlla anche la cucina" });
        await sleep(1600);
        return { tool_calls: [{ function: { name: "recall", arguments: { query: "cucina" } } }] };
      }
      steered = last.content;
      return { content: "Fatto: ho controllato anche la cucina." };
    });
    discord.say({ content: "Olga, controlla il salotto" });
    await waitFor(() => posts("Olga").includes("Fatto: ho controllato anche la cucina."), { what: "the steered answer", timeout: 20000 });
    assert.match(steered, /\[Nel frattempo nella chat\][\s\S]*controlla anche la cucina/);
    assert.ok(posts("Olga").includes("Ricevuto, ci lavoro: ti aggiorno qui."), "the automatic acknowledgement came first");
    await quiet();
    app.orchestrator.ackAfterMs = 15000;

    let asked = 0;
    replies.set("Pino", (body) => {
      asked += 1;
      return /Hai risposto PASS/.test(lastUserText(body)) ? { content: "Scusa, eccomi." } : { content: "PASS" };
    });
    discord.say({ content: "Pino, ci sei?" });
    await waitFor(() => posts("Pino").includes("Scusa, eccomi."), { what: "Pino after the retry" });
    assert.equal(asked, 2);
    await quiet();
  });

  test("agents post along the way with say, and create, list and delete their own routines when the owner asks", async () => {
    let step = 0;
    replies.set("Olga", () => {
      step += 1;
      if (step === 1) return { tool_calls: [{ function: { name: "say", arguments: { text: "Ci guardo." } } }] };
      if (step === 2) return { tool_calls: [{ function: { name: "set_routine", arguments: { name: "Buongiorno", schedule: "0 9 * * 1-5", prompt: "Saluta tutti." } } }] };
      if (step === 3) return { tool_calls: [{ function: { name: "set_routine", arguments: { name: "Rotta", schedule: "99 * * * *", prompt: "x" } } }] };
      if (step === 4) return { tool_calls: [{ function: { name: "list_routines", arguments: {} } }] };
      return { content: "Routine creata." };
    });
    discord.say({ content: "Olga, fammi una routine di buongiorno nei giorni feriali alle 9" });
    await waitFor(() => posts("Olga").includes("Routine creata."), { what: "the routine reply" });
    assert.ok(posts("Olga").indexOf("Ci guardo.") < posts("Olga").indexOf("Routine creata."));
    const routines = app.store.routines(olga.id);
    assert.deepEqual(routines.map((routine) => [routine.name, routine.schedule, routine.channelId]), [["Buongiorno", "0 9 * * 1-5", CHANNEL]]);
    const [trace] = (await call(`/api/agents/${olga.id}/traces`)).data;
    const full = (await call(`/api/traces/${trace.id}`)).data;
    assert.match(full.steps.find((item) => item.name === "set_routine" && item.args.schedule === "99 * * * *").result, /^error: schedule/);
    assert.match(full.steps.find((item) => item.name === "list_routines").result, /Buongiorno · 0 9 \* \* 1-5/);
    await quiet();
  });

  test("after a restart the first message is answered, messages written while down are picked up, and a bot can call an agent by name", async () => {
    replies.set("Olga", (body) => ({ content: `Ok: ${lastChatLine(body).split(": ").pop()}` }));
    replies.set("Pino", () => ({ content: "Pino qui." }));
    app.orchestrator.states.delete(CHANNEL);
    discord.say({ content: "Olga, primo messaggio dopo il riavvio" });
    await waitFor(() => posts("Olga").includes("Ok: Olga, primo messaggio dopo il riavvio"), { what: "the first message after a restart" });
    await quiet();

    discord.offline = true;
    discord.say({ content: "Olga, ti scrivo mentre sei spenta" });
    discord.offline = false;
    await app.orchestrator.catchUp();
    await waitFor(() => posts("Olga").includes("Ok: Olga, ti scrivo mentre sei spenta"), { what: "the message written while down" });
    await quiet();
    const before = posts("Olga").length;
    await app.orchestrator.catchUp();
    await sleep(1500);
    assert.equal(posts("Olga").length, before, "a message already answered is not answered twice");

    discord.say({ content: "Olga, qui GROG, mi senti?", bot: true, author: "700000000000000009", username: "GROG" });
    await waitFor(() => posts("Olga").includes("Ok: Olga, qui GROG, mi senti?"), { what: "Olga answering a bot" });
    await quiet();
    discord.offline = true;
    discord.say({ content: "Olga, qui GROG di nuovo, mentre eri spenta", bot: true, author: "700000000000000009", username: "GROG" });
    discord.offline = false;
    await app.orchestrator.catchUp();
    await waitFor(() => posts("Olga").includes("Ok: Olga, qui GROG di nuovo, mentre eri spenta"), { what: "a bot's call picked up after a restart" });
    await quiet();
    const pino = posts("Pino").length;
    discord.say({ content: "messaggio di servizio", bot: true, author: "700000000000000009", username: "GROG" });
    await sleep(2000);
    assert.equal(posts("Pino").length, pino, "a bot that names nobody wakes nobody");
  });

  test("the reasoning level reaches Claude Code and Codex", async () => {
    const created = await call("/api/agents", { method: "POST", body: { name: "Ugo2", model: "claude/claude-sonnet-5-5", effort: "high", chattiness: 0, tools: false, channelIds: [CHANNEL] } });
    assert.equal(created.data.effort, "high");
    cli.set({ reply: "Ok." });
    discord.say({ content: "Ugo2, pensaci bene" });
    await waitFor(() => posts("Ugo2").length, { what: "Ugo2" });
    const claude = cli.calls().reverse().find((item) => item.flavor === "claude");
    assert.equal(claude.argv[claude.argv.indexOf("--effort") + 1], "high");
    await quiet();
    await call(`/api/agents/${created.data.id}`, { method: "PUT", body: { model: "codex/gpt-6-sol", effort: "low" } });
    discord.say({ content: "Ugo2, e adesso?" });
    await waitFor(() => posts("Ugo2").length === 2, { what: "Ugo2 on Codex" });
    const codex = cli.calls().reverse().find((item) => item.flavor === "codex");
    assert.ok(codex.argv.includes('model_reasoning_effort="low"'));
    await quiet();
    for (const id of [created.data.id, olga.id, pino.id]) await call(`/api/agents/${id}`, { method: "DELETE" });
  });
});

describe("listening without a dedicated bot", () => {
  test("cora listens through the first agent bot whose app has Message Content, and is deaf until one has it", async () => {
    const fake = await fakeDiscord();
    const ZENO = "600000000000000010";
    fake.state.botUsers.set("zeno-token", { id: ZENO, username: "Zeno", appFlags: 0 });
    const otherHome = tempHome();
    const seed = new Store(otherHome);
    seed.updateSettings({ guildIds: [GUILD] });
    const zeno = seed.createAgent({ name: "Zeno", model: "ollama/test-model", chattiness: 0, tools: false });
    seed.close();
    const other = startCora({
      home: otherHome, host: "127.0.0.1", port: 0, adminPassword: "x", sessionKey: "y", insecureCookies: true,
      discordToken: "", discordApi: fake.url, telegramApi: telegram.url, telegramPollTimeout: 1, ollamaUrl: ollama.url, ollamaKey: "k",
      claudeBin: cli.claude, codexBin: cli.codex, codexModelsFile: cli.models, ownerInstructions: join(home, "owner-AGENTS.md"),
      botTokenFor: (name) => (name === "CORA_BOT_ZENO" ? "zeno-token" : ""), storeSecret: async () => {},
      docker: docker.path, schedulerTickMs: 3600000, startBoxes: false,
    });
    await other.ready;
    await waitFor(() => other.bots.client(zeno.id), { what: "Zeno's own bot online" });
    await sleep(300);
    assert.equal(other.discord.state, "missing-token", "without Message Content nobody listens");

    fake.state.botUsers.get("zeno-token").appFlags = 1 << 19;
    await other.bots.readFlags(zeno.id);
    await waitFor(() => other.discord.state === "ready" && other.discord.user?.id === ZENO, { what: "listening as Zeno" });
    replies.set("Zeno", () => ({ content: "Ti sento." }));
    fake.say({ content: "Zeno, mi senti?" });
    const post = await waitFor(() => fake.state.botPosts.find((item) => item.content === "Ti sento."), { what: "Zeno's reply" });
    assert.equal(post.token, "zeno-token");
    await sleep(1500);
    assert.equal(fake.state.botPosts.filter((item) => item.content === "Ti sento.").length, 1, "its own message is not heard as new");
    await other.stop();
    await fake.close();
  });
});

describe("notifications and requests", () => {
  test("a subscribed phone gets replies while the panel is closed, the agents' notices and their requests, and answering clears the request", async () => {
    const phone = await fakePhone();
    const status = (await call("/api/state")).data.push;
    assert.equal(status.enabled, true);
    assert.match(status.publicKey, /^[\w-]{87}$/);
    assert.equal((await call("/api/push/subscribe", { method: "POST", body: { subscription: phone.subscription, device: "iPhone" } })).status, 200);
    assert.equal((await call("/api/push/test", { method: "POST" })).status, 200);
    const test = phone.decrypt(phone.received[0]);
    assert.equal(test.title, "Cora");
    assert.ok(phone.vapidValid(phone.received[0])?.sub, "signed with the VAPID key the browser subscribed with");
    assert.equal(phone.received[0].headers["content-encoding"], "aes128gcm");

    const created = await call("/api/agents", { method: "POST", body: { name: "Rita", model: "ollama/test-model", chattiness: 0, tools: false } });
    const room = `web-${created.data.id}`;
    let step = 0;
    replies.set("Rita", (body) => {
      step += 1;
      if (step === 1) return { content: "Ci penso io." };
      if (step === 2) return { tool_calls: [{ function: { name: "notify", arguments: { message: "Ho finito il controllo." } } }] };
      if (step === 3) return { tool_calls: [{ function: { name: "notify", arguments: { message: "Ancora io." } } }] };
      if (step === 4) return { content: "Fatto." };
      if (step === 5) return { tool_calls: [{ function: { name: "ask_owner", arguments: { question: "Posso cancellare i file vecchi?", choices: ["Sì", "No"] } } }] };
      if (step === 6) return { content: "Ti ho chiesto il permesso." };
      return { content: lastUserText(body).includes("Sì") ? "Perfetto, procedo." : "Ok." };
    });

    await call(`/api/rooms/${room}/messages`, { method: "POST", body: { text: "Puoi controllare una cosa?" } });
    await waitFor(() => phone.received.length === 2, { what: "the reply on the phone" });
    assert.deepEqual(phone.decrypt(phone.received[1]), { title: "Rita", body: "Ci penso io.", url: `/#/agent/${created.data.id}/chat`, tag: room });

    await call(`/api/rooms/${room}/messages`, { method: "POST", body: { text: "Avvisami quando hai finito" } });
    await waitFor(() => phone.received.some((item) => phone.decrypt(item).body === "Ho finito il controllo."), { what: "the agent's notice" });
    await quiet();
    const notices = phone.received.map((item) => phone.decrypt(item)).filter((item) => item.title === "Rita" && item.body.startsWith("Ho finito"));
    assert.equal(notices.length, 1, "a second notice within a minute is refused");

    await call(`/api/rooms/${room}/messages`, { method: "POST", body: { text: "Fai pulizia" } });
    const asked = await waitFor(() => phone.received.map((item) => phone.decrypt(item)).find((item) => item.title === "Rita ti chiede"), { what: "the request on the phone" });
    assert.equal(asked.body, "Posso cancellare i file vecchi?");
    await quiet();
    const state = (await call("/api/state")).data;
    const pending = state.requests.find((item) => item.agentId === created.data.id);
    assert.deepEqual([pending.content, pending.request.choices], ["Posso cancellare i file vecchi?", ["Sì", "No"]]);

    await call(`/api/rooms/${room}/messages`, { method: "POST", body: { text: "Sì" } });
    await waitFor(async () => (await call(`/api/rooms/${room}/messages`)).data.messages.some((item) => item.content === "Perfetto, procedo."), { what: "the agent acting on the answer" });
    assert.ok(!(await call("/api/state")).data.requests.some((item) => item.agentId === created.data.id), "an answered request is no longer pending");

    phone.gone();
    await call("/api/push/test", { method: "POST" });
    assert.equal(app.store.pushSubscriptions().length, 0, "a subscription the push service dropped is removed");
    await quiet();
    await call(`/api/agents/${created.data.id}`, { method: "DELETE" });
    await phone.close();
  });
});

describe("agents in Telegram", () => {
  const MAIN_TG = "1111111:AAmainmainmainmainmainmainmainmainmain";
  const TINA_TG = "2222222:AAtinatinatinatinatinatinatinatinatina";
  const group = (from, text, extra = {}) => ({ chat: { id: Number(TG_GROUP), type: "supergroup", title: "La banda" }, from, text, ...extra });
  const seb = { id: Number(TG_OWNER), first_name: "Seb", is_bot: false };
  let tina;
  let tgPrompt = "";

  test("the main bot token is checked and stored, and switching to Telegram turns Discord off", async () => {
    telegram.addBot(MAIN_TG, { id: 1111111, username: "cora_main_bot", first_name: "Cora" });
    assert.match((await call("/api/telegram/token", { method: "PUT", body: { token: "nope" } })).data.error, /BotFather/);
    assert.match((await call("/api/telegram/token", { method: "PUT", body: { token: "9999999:AAunknownunknownunknownunknownunknown" } })).data.error, /rifiuta/);
    const saved = await call("/api/telegram/token", { method: "PUT", body: { token: MAIN_TG } });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.bot.username, "cora_main_bot");
    assert.equal(hushVault.CORA_TELEGRAM_BOT_TOKEN, MAIN_TG);
    assert.equal(app.telegram.state, "idle", "Telegram waits until it is the channel in use");

    const switched = await call("/api/settings", { method: "PUT", body: { transport: "telegram" } });
    assert.equal(switched.data.transport, "telegram");
    await waitFor(() => app.telegram.state === "ready", { what: "Telegram polling" });
    await waitFor(() => app.discord.state === "stopped", { what: "Discord off" });
    const state = (await call("/api/state")).data;
    assert.equal(state.transport, "telegram");
    assert.equal(state.telegram.user.username, "cora_main_bot");
    assert.deepEqual(state.channels, [], "no Telegram chat is allowed yet");
  });

  test("chats are heard only once allowed; the group's creator becomes the owner; agents answer through the main bot", async () => {
    tina = (await call("/api/agents", { method: "POST", body: { name: "Tina", model: "ollama/test-model", chattiness: 0, tools: false } })).data;
    replies.set("Tina", (body) => {
      tgPrompt = lastUserText(body);
      return { content: "Ciao da Telegram! <3" };
    });
    telegram.push(group(seb, "Tina, ci sei?"));
    await waitFor(() => app.telegram.chats.has(TG_GROUP), { what: "the chat to be seen" });
    await sleep(1500);
    assert.equal(telegram.state.sent.length, 0, "a chat that is not allowed is ignored");
    assert.equal((await call("/api/state")).data.telegram.chats.find((chat) => chat.id === TG_GROUP).title, "La banda");

    await call("/api/settings", { method: "PUT", body: { telegramChatIds: [TG_GROUP] } });
    const channels = (await call("/api/state")).data.channels;
    assert.deepEqual(channels.map((channel) => [channel.id, channel.name, channel.kind]), [[`tg:${TG_GROUP}`, "La banda", "telegram"]]);
    telegram.push(group(seb, "Tina, ci sei?"));
    const sent = await waitFor(() => telegram.state.sent.find((item) => item.method === "sendMessage"), { what: "Tina's reply" });
    assert.equal(sent.token, MAIN_TG);
    assert.equal(sent.chat_id, TG_GROUP);
    assert.equal(sent.parse_mode, "HTML");
    assert.equal(sent.text, "<b>Tina</b>\nCiao da Telegram! &lt;3");
    assert.deepEqual(app.store.settings.telegramOwnerIds, [TG_OWNER]);
    assert.match(tgPrompt, /Ultimi messaggi nella chat Telegram "La banda"/);
    assert.match(tgPrompt, /Seb ★: Tina, ci sei\?/);
    const [summary] = (await call(`/api/agents/${tina.id}/traces`)).data;
    const trace = (await call(`/api/traces/${summary.id}`)).data;
    assert.match(trace.system, /In questo momento parlate su Telegram, nel gruppo "La banda"\./);
    assert.doesNotMatch(trace.system, /server Discord/);
    await quiet();

    telegram.push({ chat: { id: Number(TG_OTHER_GROUP), type: "group", title: "Altro" }, from: seb, text: "Tina?" });
    await waitFor(() => app.telegram.chats.has(TG_OTHER_GROUP), { what: "the other chat" });
    await sleep(1200);
    assert.equal(telegram.state.sent.filter((item) => item.chat_id === TG_OTHER_GROUP).length, 0);
  });

  test("an agent with its own Telegram bot posts as itself and answers its @username", async () => {
    telegram.state.sent.length = 0;
    telegram.addBot(TINA_TG, { id: 2222222, username: "tina_cora_bot", first_name: "tina-app" });
    assert.match((await call(`/api/agents/${tina.id}/telegram-bot`, { method: "PUT", body: { token: MAIN_TG } })).data.error, /bot principale/);
    const saved = await call(`/api/agents/${tina.id}/telegram-bot`, { method: "PUT", body: { token: TINA_TG } });
    assert.equal(saved.status, 200);
    assert.equal(hushVault.CORA_TG_BOT_TINA, TINA_TG);
    assert.equal(saved.data.telegramBot.user.username, "tina_cora_bot");
    assert.equal(saved.data.telegramBot.inChat, false);
    await waitFor(() => telegram.state.names.some((item) => item.token === TINA_TG && item.name === "Tina"), { what: "bot renamed" });

    telegram.state.members.add(`${TG_GROUP}:2222222`);
    app.tgBots.forgetMembership(tina.id);
    replies.set("Tina", (body) => {
      tgPrompt = lastUserText(body);
      return { content: "Tutto bene, grazie." };
    });
    telegram.push(group({ id: Number(TG_STRANGER), first_name: "Ospite", is_bot: false }, "@tina_cora_bot come va?", { entities: [{ type: "mention", offset: 0, length: 14 }] }));
    const sent = await waitFor(() => telegram.state.sent.find((item) => item.text === "Tutto bene, grazie."), { what: "Tina's own post" });
    assert.equal(sent.token, TINA_TG, "posted by Tina's own bot, without the name header");
    assert.match(tgPrompt, /Ospite: @Tina come va\?/);
    assert.doesNotMatch(tgPrompt, /Ospite ★/, "a stranger is not the owner");
    assert.equal((await call(`/api/agents/${tina.id}`)).data.telegramBot.inChat, true);
  });

  test("a routine on a Discord channel does not run while the cora lives on Telegram; switching back turns Discord on again", async () => {
    const routine = await call(`/api/agents/${tina.id}/routines`, { method: "POST", body: { name: "Discord", schedule: "0 9 * * *", channelId: CHANNEL, prompt: "Saluta." } });
    await call(`/api/routines/${routine.data.id}/run`, { method: "POST" });
    const failed = await waitFor(async () => (await call("/api/state")).data.routines.find((item) => item.id === routine.data.id && item.lastStatus === "error"), { what: "routine refused" });
    assert.match(failed.lastOutput, /ora Cora vive sull'altro/);

    await call("/api/settings", { method: "PUT", body: { transport: "discord" } });
    await waitFor(() => app.discord.state === "ready", { what: "Discord back" });
    assert.equal(app.telegram.state, "stopped");
    await call(`/api/agents/${tina.id}`, { method: "DELETE" });
  });
});
