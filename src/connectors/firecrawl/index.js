import { mcpClient } from "../remote-mcp.js";
import { fail } from "../tooling.js";

const RESOURCE = "https://mcp.firecrawl.dev/v2/mcp-oauth";
const TOOL_NAME = /^firecrawl_[a-z][a-z0-9_]{0,90}$/;
const ENDPOINT = "https://mcp.firecrawl.dev/v2/mcp";

function refusal(status, data) {
  const detail = String(data?.error?.message || data?.error || data?.message || "").slice(0, 1000);
  if (status === 401) fail("Firecrawl refused the credential: the owner reconnects it in Connettori");
  if (status === 402) fail(`Firecrawl has insufficient credits${detail ? `: ${detail}` : ""}; do not retry automatically`);
  if (status === 429) fail(`Firecrawl rate limit reached${detail ? `: ${detail}` : ""}; do not retry automatically`);
  fail(`Firecrawl answered ${status || "nothing"}${detail ? `: ${detail}` : ""}`);
}

export function client({ token = "", request, api = {}, record = {}, writeFile = null }) {
  const endpoint = api.firecrawl || ENDPOINT;
  const oauth = record.mode === "oauth";
  const target = oauth ? (api.firecrawlOAuth || `${endpoint}-oauth`) : endpoint;
  return mcpClient({ name: "Firecrawl", id: "firecrawl", endpoint: target, request, writeFile, refusal,
    headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

export async function inspect(ctx) {
  const remote = client(ctx), tools = [], seen = new Set();
  let cursor;
  for (let page = 0; page < 20; page += 1) {
    const result = await remote.rpc("tools/list", cursor ? { cursor } : {});
    if (!Array.isArray(result.tools)) fail("Firecrawl did not return its tool catalog");
    for (const tool of result.tools) {
      if (!TOOL_NAME.test(tool?.name || "") || tools.some((item) => item.name === tool.name)) continue;
      if (!tool.inputSchema || tool.inputSchema.type !== "object") fail("Firecrawl returned an invalid tool schema");
      tools.push({ name: tool.name, description: String(tool.description || "").slice(0, 6000), parameters: tool.inputSchema });
      if (tools.length > 200) fail("Firecrawl returned too many tools");
    }
    cursor = result.nextCursor;
    if (!cursor) break;
    if (seen.has(cursor) || page === 19) fail("Firecrawl repeated or exceeded catalog pagination");
    seen.add(cursor);
  }
  if (!tools.length || JSON.stringify(tools).length > 500000) fail("Firecrawl returned an empty or oversized tool catalog");
  return { workspace: "Firecrawl", account: "", remoteTools: tools };
}

const guidance = (name) => {
  if (name === "firecrawl_monitor_delete") return " Permanently deletes a monitor: only on an explicit user request.";
  if (/^firecrawl_monitor_(create|update|run)$/.test(name)) return " Creates or changes ongoing work or spends team credits: requires the user's authorization; never start recurring work implicitly.";
  if (["firecrawl_crawl", "firecrawl_agent", "firecrawl_interact"].includes(name)) return " Uses the connected team's credits: stay within the user's request. Close Interact sessions with firecrawl_interact_stop.";
  return "";
};

export function resolveTool(name) {
  if (!TOOL_NAME.test(name)) return null;
  return { name, summarize: () => name, async run(args, ctx) {
    if (!ctx.record.remoteTools?.some((tool) => tool.name === name)) fail("This Firecrawl tool is unavailable on the connected account: reconnect to refresh its catalog");
    return client(ctx).tool(name, args, { timeout: ["firecrawl_crawl", "firecrawl_agent"].includes(name) ? 180000 : 120000 });
  } };
}

export const firecrawl = {
  id: "firecrawl", name: "Firecrawl", secret: "CORA_FIRECRAWL_TOKEN", appSecrets: [], label: "account",
  async checkKey(ctx) {
    const answer = await ctx.request(`${ctx.api.firecrawlRest || "https://api.firecrawl.dev/v2"}/team/credit-usage`, { method: "GET", headers: { Authorization: `Bearer ${ctx.token}` } });
    if (answer.status !== 200 || answer.data?.success !== true || !answer.data?.data) fail("Firecrawl did not authenticate this API key");
    return inspect({ ...ctx, record: { mode: "key" } });
  },
  resolveTool,
  toolsFor(record) {
    return (record.remoteTools || []).filter((tool) => TOOL_NAME.test(tool.name)).map((tool) => ({ ...tool,
      description: `Firecrawl, using the connected team's plan and credits. ${tool.description}${guidance(tool.name)}` }));
  },
  oauth: {
    authorize: "https://www.firecrawl.dev/api/oauth/authorize",
    token: "https://www.firecrawl.dev/api/oauth/token",
    register: "https://www.firecrawl.dev/api/oauth/register",
    revoke: "https://www.firecrawl.dev/api/oauth/revoke",
    dynamicRegistration: true,
    scopes: ["firecrawl:global", "offline_access"], clientAuth: "none",
    params: { resource: RESOURCE }, tokenParams: { resource: RESOURCE },
    async identify(ctx) {
      const checked = await inspect({ ...ctx, token: ctx.access, record: { mode: "oauth" } });
      return { ...checked, account: String(ctx.tokenData?.user_id || "").slice(0, 120), workspace: String(ctx.tokenData?.team_id || "Firecrawl").slice(0, 120) };
    },
  },
  card: {
    icon: "globe", description: "Gli agenti cercano sul web e leggono pagine, siti e documenti.", meta: "Firecrawl · Web",
    intro: "Gli agenti usano Firecrawl con il piano e i crediti del team che colleghi. Gli strumenti disponibili dipendono dal tuo account.",
    writes: { oauth: "Il team Firecrawl scelto durante il consenso.", key: "Il team a cui appartiene la chiave API." },
    modes: [
      { id: "oauth", label: "Collega account", intro: "Accedi a Firecrawl, scegli il team e autorizza Cora. Torni qui automaticamente.",
        notice: "Ricerche, estrazioni e altre azioni usano i crediti del team. I monitoraggi ricorrenti si avviano solo su tua richiesta.",
        rows: [{ title: "Il tuo account Firecrawl", authorize: "Apri Firecrawl" }] },
      { id: "key", label: "Chiave API", body: { mode: "key" },
        intro: "Collega una chiave API del tuo team Firecrawl. Cora la verifica e la conserva nella cassaforte.",
        notice: "Scollegare una chiave da Cora rimuove l'accesso degli agenti. Per revocarla anche su Firecrawl, eliminala dalle impostazioni del servizio.",
        rows: [{ title: "La chiave", steps: [["Crea una chiave nelle ", { href: "https://www.firecrawl.dev/app/api-keys", text: "impostazioni Firecrawl" }, " e inseriscila qui."]],
          field: { name: "token", type: "password", label: "Chiave API di Firecrawl", placeholder: "fc-…" }, submit: "Verifica e collega" }] },
    ],
  },
};
