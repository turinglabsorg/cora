import { existsSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { join } from "node:path";
import { CORA_GIT_COAUTHOR_EMAIL } from "./git-attribution.js";

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
  // The vault's own key when set (hush CORA_VAULT_KEY); otherwise one derived from the session key.
  vaultKey: setting("VAULT_KEY") || "",
  discordApi: setting("DISCORD_API") || "https://discord.com/api/v10",
  discordGateway: setting("DISCORD_GATEWAY") || "",
  telegramToken: env.TELEGRAM_BOT_TOKEN || "",
  telegramApi: setting("TELEGRAM_API") || "https://api.telegram.org",
  slackToken: env.SLACK_BOT_TOKEN || "",
  slackAppToken: env.SLACK_APP_TOKEN || "",
  // Slack's app configuration refresh token: the apps' name, description and icon follow the panel.
  slackConfigToken: env.SLACK_CONFIG_TOKEN || "",
  slackApi: setting("SLACK_API") || "https://slack.com/api",
  docker: setting("DOCKER") || firstExisting(["/usr/local/bin/docker", "/usr/bin/docker", "docker"]),
  boxImage: setting("BOX_IMAGE") || "cora-box:latest",
  gitAttribution: setting("GIT_ATTRIBUTION") !== "0",
  gitCoauthorEmail: setting("GIT_COAUTHOR_EMAIL") || CORA_GIT_COAUTHOR_EMAIL,
  mailEndpoint: (setting("MAIL_ENDPOINT") || "https://ambox.dev").replace(/\/$/, ""),
  mailDomain: setting("MAIL_DOMAIN") || "",
  mailNamespace: setting("MAIL_NAMESPACE") || "",
  mailRegistrationToken: setting("MAIL_REGISTRATION_TOKEN") || "",
  ollamaUrl: (env.OLLAMA_URL || "https://ollama.com").replace(/\/$/, ""),
  ollamaKey: env.OLLAMA_API_KEY || "",
  orcaUrl: (setting("ORCAROUTER_URL") || "https://api.orcarouter.ai/v1").replace(/\/$/, ""),
  orcaKey: env.ORCAROUTER_API_KEY || "",
  // The company brain: Postgres with pgvector (hush CORA_BRAIN_DATABASE_URL), embeddings from this machine's Ollama.
  brainDatabaseUrl: env.BRAIN_DATABASE_URL || "",
  brainEmbedUrl: (setting("BRAIN_EMBED_URL") || "http://127.0.0.1:11434").replace(/\/$/, ""),
  // DeepSeek Harness (dsh) on the instance's own DeepSeek key, in a DSH_HOME of Cora's.
  deepseekKey: env.DEEPSEEK_API_KEY || "",
  deepseekBin: setting("DSH_BIN") || "dsh",
  deepseekHome: setting("DSH_HOME") || "",
  deepseekApi: (setting("DEEPSEEK_API") || "https://api.deepseek.com").replace(/\/$/, ""),
  // Soniox: agents hear voice messages and answer in a voice of their own. ffmpeg makes the voice notes.
  sonioxKey: env.SONIOX_API_KEY || "",
  sonioxApi: setting("SONIOX_API") || "https://api.soniox.com",
  githubApi: setting("GITHUB_API") || "https://api.github.com",
  githubWeb: setting("GITHUB_WEB") || "https://github.com",
  sonioxTtsUrl: setting("SONIOX_TTS_URL") || "https://tts-rt.soniox.com/tts",
  ffmpeg: setting("FFMPEG") || firstExisting(["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg", "ffmpeg"]),
  // doc's checks on what agents publish and say; Jev judges with this instance's TypeSafe key.
  docDir: setting("DOC_DIR") || "",
  typesafeKey: env.TYPESAFE_API_KEY || "",
  hermesBin: setting("HERMES_BIN") || "hermes",
  hermesHome: setting("HERMES_HOME") || join(homedir(), ".cora", "hermes-home"),
  hermesBaseUrl: setting("HERMES_BASE_URL") || "http://127.0.0.1:11434/v1",
  claudeBin: setting("CLAUDE_BIN") || "claude",
  codexBin: setting("CODEX_BIN") || "codex",
  grokBin: setting("GROK_BIN") || "grok",
  museBin: setting("MUSE_BIN") || "muse",
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
  // Hosted on usecora.space: people sign in there and arrive with a signed pass. None of these is secret.
  cloudUrl: setting("CLOUD_URL") || "",
  cloudKey: setting("CLOUD_KEY") || "",
  cloudSpace: setting("CLOUD_SPACE") || "",
  // An on-premise install answers on its own domain: the passes are signed for that host.
  publicHost: (setting("PUBLIC_HOST") || "").replace(/^https?:\/\//, "").replace(/\/.*$/, ""),
};

/** The Discord bot token comes only from the environment (injected by hush as DISCORD_BOT_TOKEN). */
export function resolveDiscordToken() {
  return env.DISCORD_BOT_TOKEN || "";
}
