#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { AgentBots } from "./agent-bots.js";
import { Channels } from "./channels.js";
import { Telegram } from "./telegram.js";
import { TelegramBots } from "./telegram-bots.js";
import { hushStore } from "./secrets.js";
import { Traces } from "./traces.js";
import { Push } from "./push.js";
import { Brain } from "./brain.js";
import { ToolBridge } from "./bridge.js";
import { Boxes, plainKeys } from "./box.js";
import { config, resolveDiscordToken } from "./config.js";
import { Discord } from "./discord.js";
import { LLM } from "./llm.js";
import { Orchestrator } from "./orchestrator.js";
import { Scheduler } from "./scheduler.js";
import { Store } from "./store.js";
import { createWeb } from "./web.js";

export function startCora(overrides = {}) {
  const cfg = { ...config, ...overrides };
  const store = new Store(cfg.home);
  let web = null;
  const activity = (entry) => {
    const record = { at: new Date().toISOString(), ...entry };
    if (record.agentId && !record.agentName) record.agentName = store.agent(record.agentId)?.name;
    store.appendActivity(record);
    web?.broadcast(record);
    if (record.type === "error") console.error(`! ${record.agentName ? `${record.agentName}: ` : ""}${record.text}`);
  };

  // A dedicated listening bot (CORA_DISCORD_LISTENER_TOKEN) is optional: without it cora listens through an agent's own bot.
  const listenerToken = cfg.discordToken ?? resolveDiscordToken();
  const discord = new Discord({ token: listenerToken, apiBase: cfg.discordApi, gatewayUrl: cfg.discordGateway });
  const telegram = new Telegram({ token: cfg.telegramToken, apiBase: cfg.telegramApi, pollTimeout: cfg.telegramPollTimeout, chats: store.value("telegramChats", []) });
  const bridge = new ToolBridge();
  const llm = new LLM({
    ollamaUrl: cfg.ollamaUrl,
    ollamaKey: cfg.ollamaKey,
    orcaUrl: cfg.orcaUrl,
    orcaKey: cfg.orcaKey,
    hermesBin: cfg.hermesBin,
    hermesHome: cfg.hermesHome,
    hermesBaseUrl: cfg.hermesBaseUrl,
    claudeBin: cfg.claudeBin,
    codexBin: cfg.codexBin,
    codexModelsFile: cfg.codexModelsFile,
    cliWorkDir: join(cfg.home, "cli-work"),
    bridge,
  });
  // SSH into a desktop: the keys that already open this machine, plus the ones added in the panel.
  const sshKeys = () => {
    let host = [];
    try { host = plainKeys(readFileSync(cfg.sshAuthorizedKeys, "utf8")); } catch {}
    return [...new Set([...host, ...store.settings.sshKeys])];
  };
  const boxes = new Boxes({ docker: cfg.docker, image: cfg.boxImage, timezone: cfg.timezone, access: (agent) => ({ sshPort: store.sshPort(agent.id), keys: sshKeys() }) });
  const live = (event) => web?.broadcast(event);
  const traces = new Traces({ store, emit: live });
  const push = new Push({ store, secret: cfg.vapidKey, subject: cfg.publicUrl, log: activity });
  const tokenFor = cfg.botTokenFor || ((name) => process.env[name] || process.env[name.replace(/^CORA_/, "CORO_")] || "");
  const bots = new AgentBots({ store, apiBase: cfg.discordApi, gatewayUrl: cfg.discordGateway, tokenFor, log: activity });
  const tgBots = new TelegramBots({ store, apiBase: cfg.telegramApi, tokenFor, log: activity });
  const channels = new Channels({ store, discord, bots, telegram, tgBots });
  const pickListener = () => {
    if (listenerToken) return;
    const listener = bots.listener();
    if (listener?.token === discord.token || (!listener && !discord.token)) return;
    discord.useToken(listener?.token || "");
    activity({ type: "discord", text: listener ? `ascolto Discord con il bot di ${store.agent(listener.agentId)?.name}` : "nessun bot di agente con Message Content: Discord non è ascoltato" });
    if (listener && channels.active === "discord") discord.start();
  };
  bots.onChange = pickListener;
  const brain = new Brain({ store, llm, boxes, channels, timezone: cfg.timezone, log: activity, ownerInstructionsPath: cfg.ownerInstructions, traces, push });
  const filesDir = join(cfg.home, "files");
  const orchestrator = new Orchestrator({ store, discord, brain, log: activity, bots, channels, telegram, tgBots, emit: live, filesDir, notifier: push, watching: () => web?.watching() });
  // DMs to an agent's own bot reach the orchestrator, where that one agent answers.
  bots.onDirect = (agentId, raw) => orchestrator.onDirectMessage(agentId, raw).catch((error) => activity({ type: "error", agentId, text: `dm: ${error.message}` }));
  // Every agent bot that may read content also listens: a private channel is heard if one of them is in it.
  bots.onGuild = (raw) => orchestrator.onMessage(raw).catch((error) => activity({ type: "error", channelId: raw.channel_id, text: error.message }));
  brain.ask = (agent, request, where) => orchestrator.askOwner(agent, request, where);
  const scheduler = new Scheduler({ store, orchestrator, brain, timezone: cfg.timezone, tickMs: cfg.schedulerTickMs, log: activity });
  const storeSecret = cfg.storeSecret || ((name, value) => hushStore(name, value, { bin: cfg.hushBin }));
  web = createWeb({ config: { ...cfg, filesDir }, store, discord, telegram, channels, boxes, llm, orchestrator, brain, bots, tgBots, activity, storeSecret, traces, push });

  discord.on("message", (message) => {
    orchestrator.onMessage(message).catch((error) => activity({ type: "error", channelId: message.channel_id, text: error.message }));
  });
  discord.on("status", (status) => web.broadcast({ type: "discord", state: status.state, error: status.error }));
  discord.on("warning", (text) => activity({ type: "warning", text }));
  // Long tasks a restart cut short start again once: when Discord is up, or after a while if Cora lives elsewhere.
  let resumed = false;
  const resume = () => {
    if (resumed) return;
    resumed = true;
    const ids = orchestrator.resumeInterrupted();
    if (ids.length) activity({ type: "settings", text: `riprendo ${ids.length} lavori interrotti dal riavvio` });
  };
  const resumeFallback = setTimeout(resume, 20000);
  discord.on("ready", () => {
    activity({ type: "discord", text: `connesso come ${discord.user?.username}` });
    // Give the gateway a moment to deliver the servers' channels, then answer what was missed.
    setTimeout(() => {
      orchestrator.catchUp().catch((error) => activity({ type: "error", text: `recupero messaggi: ${error.message}` }));
      resume();
    }, 3000);
  });
  telegram.on("message", (message) => {
    orchestrator.onTelegramMessage(message).catch((error) => activity({ type: "error", text: `telegram: ${error.message}` }));
  });
  telegram.on("status", (status) => web.broadcast({ type: "telegram", state: status.state, error: status.error }));
  telegram.on("ready", () => activity({ type: "telegram", text: `connesso come @${telegram.user?.username}` }));
  telegram.on("chat", () => {
    store.setValue("telegramChats", [...telegram.chats.values()]);
    web.broadcast({ type: "telegram-chats" });
  });
  discord.on("guild", (guild) => {
    if (!store.settings.ownerIds.length && store.settings.guildIds.includes(guild.id) && guild.ownerId) {
      store.updateSettings({ ownerIds: [guild.ownerId] });
      activity({ type: "settings", text: `proprietario impostato: owner di ${guild.name}` });
    }
  });

  const ready = bridge.start().then(() => new Promise((resolve) => web.server.listen(cfg.port, cfg.host, resolve)));
  ready.then(() => {
    console.log(`> cora on http://${cfg.host}:${web.server.address().port}`);
    if (!cfg.adminPassword) console.error("! CORA_ADMIN_PASSWORD is not set: the panel refuses every login");
    channels.apply();
    botTimer = setInterval(() => {
      bots.sync();
      tgBots.sync();
      pickListener();
    }, 60000);
    scheduler.start();
    if (cfg.startBoxes !== false) {
      for (const agent of store.agents()) {
        if (agent.enabled && agent.tools) boxes.ensure(agent, { upgrade: true }).catch((error) => activity({ type: "error", agentId: agent.id, text: `desktop: ${error.message}` }));
      }
    }
  });

  let botTimer = null;
  const stop = async () => {
    clearTimeout(resumeFallback);
    clearInterval(botTimer);
    scheduler.stop();
    discord.stop();
    bots.stop();
    telegram.stop();
    tgBots.stop();
    const closed = new Promise((resolve) => web.server.close(resolve));
    web.server.closeAllConnections?.();
    await closed;
    await bridge.stop();
    store.close();
  };
  return { ready, stop, store, discord, telegram, channels, orchestrator, scheduler, brain, boxes, llm, bridge, bots, tgBots, traces, push, server: web.server };
}

const isMain = (() => {
  try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
})();

if (isMain) {
  const app = startCora();
  const shutdown = () => app.stop().finally(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
