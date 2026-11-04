import { createHash, randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { CONTEXT_LIMITS, ValidationError } from "./store.js";

/** What Cora reads of an instruction file, and so the most the panel writes into one. */
const FILE_CHARS = 60000;

const revisionOf = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);

function instructionFile(path) {
  const unavailable = { available: false, status: "unavailable", content: "", revision: "", editable: false };
  try {
    const resolved = realpathSync(path);
    if (extname(resolved).toLowerCase() !== ".md") return unavailable;
    const stat = statSync(resolved);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return unavailable;
    const content = readFileSync(resolved, "utf8");
    return { available: true, content: content.slice(0, FILE_CHARS), truncated: content.length > FILE_CHARS, updatedAt: stat.mtime.toISOString(),
      revision: revisionOf(content), editable: content.length <= FILE_CHARS };
  } catch (error) {
    if (error.code !== "ENOENT") return unavailable;
    // A link that points nowhere is not a missing file: writing it would follow the link somewhere unknown.
    try { lstatSync(path); return unavailable; } catch {}
    return { available: false, status: "missing", content: "", revision: "", editable: extname(path).toLowerCase() === ".md" };
  }
}

/** The instruction files Cora knows about, and nothing else: the panel never reads or writes a path it is given. */
function knownFiles({ config, store, subscriptions }) {
  const files = [{ id: "owner", path: config.ownerInstructions || "", provider: "cora", scope: "shared", mode: "applied" }];
  for (const provider of ["claude", "codex"]) {
    const directory = subscriptions.residentDirectories[provider];
    const mode = provider === "codex" ? "excluded" : "detected";
    for (const filename of provider === "claude" ? ["CLAUDE.md"] : ["AGENTS.md", "AGENTS.override.md"]) {
      files.push({ id: `resident-${provider}-${filename}`, path: directory ? join(directory, filename) : "", provider, scope: "resident", mode });
    }
    const filename = provider === "claude" ? "CLAUDE.md" : "AGENTS.md";
    files.push({ id: `instance-${provider}`, path: join(store.home, filename), provider, scope: "instance", mode });
    for (const record of store.subscriptions().filter((item) => !item.resident && item.provider === provider && /^sub_[a-f0-9]{12}$/.test(item.id))) {
      files.push({ id: `account-${record.id}`, path: join(store.home, "subscriptions", record.id, filename), provider, scope: "account", mode, accountLabel: record.label, onlyIfPresent: true });
    }
  }
  return files;
}

export function contextSources({ config, store, subscriptions, brain }) {
  const sources = [];
  for (const { id, path, provider, scope, mode, accountLabel, onlyIfPresent } of knownFiles({ config, store, subscriptions })) {
    const file = path ? instructionFile(path) : { available: false, status: "missing", content: "", revision: "", editable: false };
    if (onlyIfPresent && !file.available) continue;
    sources.push({ id, title: path ? basename(path) : "AGENTS.md", path, provider, scope, status: file.available ? mode : file.status, ...file, ...(accountLabel ? { accountLabel } : {}) });
  }
  const owner = sources.find((source) => source.id === "owner");
  if (owner.available) owner.content = brain.ownerInstructions();
  for (const document of store.contextDocuments()) sources.push({
    ...document, title: document.name, path: "", provider: "cora", scope: "database", storage: "database",
    status: document.enabled ? "applied" : "disabled", available: true, truncated: false,
  });
  return { residentEnabled: store.settings.useResidentSubscriptions, sources, limits: { ...CONTEXT_LIMITS, serverFileChars: FILE_CHARS } };
}

/**
 * Writes one of the known instruction files on the server, creating it when it is missing.
 * A link is written through to its target, so a CLAUDE.md that points at the owner's rules stays a link.
 */
export function writeContextFile({ config, store, subscriptions }, id, input) {
  const entry = knownFiles({ config, store, subscriptions }).find((item) => item.id === id);
  if (!entry?.path) throw Object.assign(new ValidationError("file del server non trovato"), { status: 404 });
  const current = instructionFile(entry.path);
  if (entry.onlyIfPresent && !current.available) throw Object.assign(new ValidationError("file del server non trovato"), { status: 404 });
  if (!current.editable) throw new ValidationError(current.available ? "il file supera i 60.000 caratteri: modificalo sul server" : "questo file non si può scrivere dal pannello");
  const content = input?.content;
  if (typeof content !== "string" || !content.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(content)) throw new ValidationError("inserisci un file di testo non vuoto");
  if (content.length > FILE_CHARS) throw new ValidationError("il file supera il limite di 60.000 caratteri");
  if ((input.expectedRevision ?? "") !== current.revision) {
    throw Object.assign(new ValidationError("il file è cambiato sul server: annulla e riaprilo prima di salvare"), { status: 409 });
  }
  const target = current.available ? realpathSync(entry.path) : entry.path;
  mkdirSync(dirname(target), { recursive: true });
  const temporary = join(dirname(target), `.${basename(target)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(temporary, content, { mode: current.available ? statSync(target).mode & 0o777 : 0o644, flag: "wx" });
    renameSync(temporary, target);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
  return entry.id;
}
