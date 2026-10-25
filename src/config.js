import { existsSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { join } from "node:path";

const env = process.env;

/** CORA_<NAME>, or the name it had before the rename (CORO_<NAME>). */
const setting = (name) => env[`CORA_${name}`] ?? env[`CORO_${name}`];

function firstExisting(paths) {
  return paths.find((path) => existsSync(path)) || paths[paths.length - 1];
}

export const config = {
  home: setting("HOME") || join(homedir(), ".cora"),
  host: setting("LISTEN_HOST") || "127.0.0.1",
  port: Number(env.PORT || setting("PORT") || 4370),
  adminPassword: setting("ADMIN_PASSWORD") || "",
  sessionKey: setting("SESSION_KEY") || "",
  discordApi: setting("DISCORD_API") || "https://discord.com/api/v10",
  discordGateway: setting("DISCORD_GATEWAY") || "",
  telegramToken: env.TELEGRAM_BOT_TOKEN || "",
  telegramApi: setting("TELEGRAM_API") || "https://api.telegram.org",
  docker: setting("DOCKER") || firstExisting(["/usr/local/bin/docker", "/usr/bin/docker", "docker"]),
  boxImage: setting("BOX_IMAGE") || "cora-box:latest",
  ollamaUrl: (env.OLLAMA_URL || "https://ollama.com").replace(/\/$/, ""),
  ollamaKey: env.OLLAMA_API_KEY || "",
  claudeBin: setting("CLAUDE_BIN") || "claude",
  codexBin: setting("CODEX_BIN") || "codex",
  codexModelsFile: setting("CODEX_MODELS") || "",
  hushBin: setting("HUSH_BIN") || "hush",
  vapidKey: env.VAPID_KEY || "",
  publicUrl: setting("PUBLIC_URL") || "https://github.com/turinglabsorg/cora",
  sshAuthorizedKeys: setting("SSH_AUTHORIZED_KEYS") || join(homedir(), ".ssh", "authorized_keys"),
  sshJump: setting("SSH_JUMP") || `${userInfo().username}@${hostname().replace(/\.local$/i, "").toLowerCase()}`,
  ownerInstructions: setting("OWNER_INSTRUCTIONS") || join(homedir(), ".agents", "AGENTS.md"),
  timezone: setting("TZ") || "Europe/Rome",
  insecureCookies: setting("INSECURE_COOKIES") === "1",
  schedulerTickMs: Number(setting("SCHEDULER_TICK_MS") || 20000),
};

/** The Discord bot token comes only from the environment (injected by hush as DISCORD_BOT_TOKEN). */
export function resolveDiscordToken() {
  return env.DISCORD_BOT_TOKEN || "";
}
