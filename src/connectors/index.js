import { asana } from "./asana.js";
import { canva } from "./canva.js";
import { google } from "./google.js";
import { linear } from "./linear.js";

/**
 * Every connector, in the order the panel's catalogue shows them. The panel draws
 * each card and each form from what the module declares: to add a connector, write
 * its module next to these and list it here (see README.md).
 */
export const CONNECTORS = [google, linear, asana, canva];

/** The connectors that a person connects with a key or an app's credentials. */
export const KEY_SERVICES = Object.fromEntries(CONNECTORS.filter((connector) => (connector.kind || "key") === "key")
  .map(({ id, name, secret, appSecrets, label }) => [id, { name, secret, appSecrets, label }]));

const BY_TOOL = new Map(CONNECTORS.flatMap((connector) => (connector.tools || []).map((tool) => [tool.name, { connector, tool }])));

/** The connector that owns a tool name, or null. */
export function connectorForTool(name) { return BY_TOOL.get(name)?.connector || null; }

/** The action a tool name runs, or null. */
export function toolFor(name) { return BY_TOOL.get(name)?.tool || null; }

/** The agent-facing definition of one action: name, description and JSON Schema. */
export function toolDefinition(tool, record) {
  return { name: tool.name, description: typeof tool.description === "function" ? tool.description(record) : tool.description, parameters: tool.parameters || { type: "object", properties: {} } };
}

const IDS = ["task", "issue", "project", "team", "section", "design", "folder", "asset", "thread", "message", "id", "job"];

/** One line for the activity log: the tool's own summary, or the ids it touches; never a key and never a body. */
export function summarizeTool(name, args = {}) {
  const tool = toolFor(name);
  if (!tool) return "";
  if (tool.summarize) return String(tool.summarize(args) || "").slice(0, 200);
  const parts = IDS.filter((key) => args[key] !== undefined && typeof args[key] !== "object").map((key) => `${key} ${String(args[key]).slice(0, 80)}`);
  const title = args.name || args.title || args.query || args.text_query;
  if (title && typeof title === "string") parts.push(JSON.stringify(title.slice(0, 80)));
  return parts.join(" · ").slice(0, 200);
}

/** What the panel needs to draw the catalogue: names, cards, forms and tool names, never a value. */
export function connectorCatalog({ origin = "" } = {}) {
  return CONNECTORS.map(({ id, name, kind = "key", secret = "", appSecrets = [], tools = [], oauth = null, card }) => ({
    id, name, kind, secret, appSecrets, tools: tools.map((tool) => tool.name), ...card,
    ...(oauth ? { oauth: true, redirect: origin ? `${origin}/connectors/oauth/${id}/callback` : "" } : {}),
  }));
}
