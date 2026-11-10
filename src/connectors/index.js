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

const BY_TOOL = new Map(CONNECTORS.filter((connector) => connector.tool).map((connector) => [connector.tool, connector]));

export function connectorForTool(name) { return BY_TOOL.get(name) || null; }

/** What the panel needs to draw the catalogue: names, cards and forms, never a value. */
export function connectorCatalog({ origin = "" } = {}) {
  return CONNECTORS.map(({ id, name, kind = "key", secret = "", appSecrets = [], tool = "", oauth = null, card }) => ({
    id, name, kind, secret, appSecrets, tool, ...card,
    ...(oauth ? { oauth: true, redirect: origin ? `${origin}/connectors/oauth/${id}/callback` : "" } : {}),
  }));
}
