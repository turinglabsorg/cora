import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The subscription CLIs an agent can run on, one entry each, so the store, the
 * accounts and the runs never list them again. `homeVar` moves the CLI's own
 * folder, and with it the login, into an account's folder; `loginHosts` are the
 * only pages a login may send the owner to.
 */
export const HARNESSES = {
  claude: {
    label: "Claude",
    product: "Claude Code",
    homeVar: "CLAUDE_CONFIG_DIR",
    resident: () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
    loginHosts: ["claude.com", "claude.ai", "platform.claude.com", "console.anthropic.com"],
  },
  codex: {
    label: "ChatGPT",
    product: "Codex",
    homeVar: "CODEX_HOME",
    resident: () => process.env.CODEX_HOME || join(homedir(), ".codex"),
    loginHosts: ["auth.openai.com", "chatgpt.com"],
  },
  grok: {
    label: "Grok",
    product: "Grok Build",
    homeVar: "GROK_HOME",
    resident: () => process.env.GROK_HOME || join(homedir(), ".grok"),
    loginHosts: ["accounts.x.ai"],
    // The device page carries the code it asks the owner to confirm.
    deviceParam: "user_code",
  },
  muse: {
    label: "Meta",
    product: "Muse Code",
    homeVar: "XDG_CONFIG_HOME",
    resident: () => process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    loginHosts: ["auth.meta.com"],
    deviceParam: "code",
  },
};

export const SUBSCRIPTION_PROVIDERS = Object.keys(HARNESSES);

export function isSubscriptionProvider(provider) {
  return Object.hasOwn(HARNESSES, provider);
}
