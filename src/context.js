import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";

function instructionFile(path) {
  try {
    const resolved = realpathSync(path);
    if (extname(resolved).toLowerCase() !== ".md") return { available: false, status: "unavailable", content: "" };
    const stat = statSync(resolved);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return { available: false, status: "unavailable", content: "" };
    const content = readFileSync(resolved, "utf8");
    return { available: true, content: content.slice(0, 60000), truncated: content.length > 60000, updatedAt: stat.mtime.toISOString() };
  } catch (error) {
    return { available: false, status: error.code === "ENOENT" ? "missing" : "unavailable", content: "" };
  }
}

/** Only known instruction files are inspected; this is never a general filesystem reader. */
export function contextSources({ config, store, subscriptions, brain }) {
  const sources = [];
  const add = (id, path, provider, scope, mode) => {
    const file = path ? instructionFile(path) : { available: false, status: "missing", content: "" };
    sources.push({ id, title: path ? basename(path) : "AGENTS.md", path: path || "", provider, scope,
      status: file.available ? mode : file.status, ...file });
    return sources.at(-1);
  };
  const owner = add("owner", config.ownerInstructions, "cora", "shared", "applied");
  if (owner.available) owner.content = brain.ownerInstructions();
  for (const provider of ["claude", "codex"]) {
    const directory = subscriptions.residentDirectories[provider];
    for (const filename of provider === "claude" ? ["CLAUDE.md"] : ["AGENTS.md", "AGENTS.override.md"]) {
      add(`resident-${provider}-${filename}`, join(directory, filename), provider, "resident", provider === "codex" ? "excluded" : "detected");
    }
    const filename = provider === "claude" ? "CLAUDE.md" : "AGENTS.md";
    add(`instance-${provider}`, join(store.home, filename), provider, "instance", provider === "codex" ? "excluded" : "detected");
    for (const record of store.subscriptions().filter((item) => !item.resident && item.provider === provider && /^sub_[a-f0-9]{12}$/.test(item.id))) {
      const source = add(`account-${record.id}`, join(store.home, "subscriptions", record.id, filename), provider, "account", provider === "codex" ? "excluded" : "detected");
      source.accountLabel = record.label;
      if (!source.available) sources.pop();
    }
  }
  sources.push({ id: "shared-memory", title: "Memoria condivisa", path: "", provider: "cora", scope: "shared", status: "applied", available: true, content: store.settings.sharedMemory, truncated: false });
  return { residentEnabled: store.settings.useResidentSubscriptions, sources };
}
