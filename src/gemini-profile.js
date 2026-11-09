import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const GEMINI_DENY = ["command(*)", "read_file(*)", "write_file(*)", "read_url(*)", "execute_url(*)"];

export function geminiSettings(toolNames = []) {
  return {
    modelProvider: "", useG1Credits: false, allowNonWorkspaceAccess: false,
    toolPermission: "request-review", artifactReviewPolicy: "always-proceed",
    disableSlashCommands: true, historySize: 0, showTips: false, showFeedbackSurvey: false,
    statusLine: { enabled: false }, title: { enabled: false },
    permissions: { deny: GEMINI_DENY, allow: toolNames.map((name) => `mcp(cora/${name})`) },
  };
}

export function geminiScope(directory) {
  return `cora-${createHash("sha256").update(directory).digest("hex").slice(0, 32)}`;
}

export function prepareGeminiProfile(directory) {
  const config = join(directory, ".gemini", "config");
  const cli = join(directory, ".gemini", "antigravity-cli");
  mkdirSync(config, { recursive: true, mode: 0o700 });
  mkdirSync(cli, { recursive: true, mode: 0o700 });
  writeFileSync(join(cli, "settings.json"), JSON.stringify(geminiSettings()), { mode: 0o600 });
  writeFileSync(join(config, "mcp_config.json"), JSON.stringify({ mcpServers: {} }), { mode: 0o600 });
}
