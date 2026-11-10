/**
 * Canva: the Connect API has no personal tokens, only an integration that the
 * owner registers on canva.com/developers. The card keeps its client ID and
 * secret, then the owner authorises it with their Canva account (OAuth with
 * PKCE). Cora keeps the tokens in the vault, renews the access token when it
 * expires and calls the Connect API for the authorised agents.
 */
const METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);

const SCOPES = [
  "profile:read",
  "design:meta:read", "design:content:read", "design:content:write",
  "asset:read", "asset:write",
  "folder:read", "folder:write",
  "brandtemplate:meta:read", "brandtemplate:content:read",
  "comment:read", "comment:write",
];

export const canva = {
  id: "canva",
  name: "Canva",
  secret: "CORA_CANVA_TOKEN",
  appSecrets: ["CORA_CANVA_CLIENT_ID", "CORA_CANVA_CLIENT_SECRET"],
  label: "team",
  tool: "canva",
  oauth: {
    authorize: "https://www.canva.com/api/oauth/authorize",
    token: "https://api.canva.com/rest/v1/oauth/token",
    scopes: SCOPES,
    clientAuth: "basic",
    async identify({ access, request, api }) {
      const headers = { Authorization: `Bearer ${access}` };
      const me = await request(`${api.canva}/users/me`, { headers });
      const profile = await request(`${api.canva}/users/me/profile`, { headers });
      return {
        workspace: String(me.data?.team_user?.team_id || "").slice(0, 120),
        account: String(profile.data?.profile?.display_name || me.data?.team_user?.user_id || "").slice(0, 120),
      };
    },
  },
  card: {
    icon: "layers",
    description: "Gli agenti preparano e aggiornano materiali di design.",
    meta: "Canva · Design",
    intro: "Gli agenti preparano materiali di design. Canva si collega con un'integrazione Canva intestata a te, autorizzata con il tuo account.",
    optional: {
      intro: "Canva non ha token personali: si collega solo con un'integrazione Canva intestata a te, con client ID, client secret e autorizzazione OAuth.",
      notice: "Decidi tu: collegare Canva adesso con un'integrazione, oppure lasciarla spenta. Senza integrazione nessun agente può usarla.",
      off: "Canva è esclusa: nessun agente la usa e nessuna chiave è salvata.",
      start: "Collega Canva con un'app",
      restart: "Attiva Canva",
      later: "Per ora no",
      done: "Canva lasciata spenta",
    },
    modes: [{
      id: "app",
      ready: "app",
      intro: "Canva non ha token personali: si collega con un'integrazione Canva intestata a te, poi la autorizzi con il tuo account.",
      notice: "Servono client ID e client secret dell'integrazione; poi autorizzi Canva da qui e Cora salva i token nella cassaforte.",
      rows: [
        { title: "L'integrazione Canva", steps: [
          ["apri ", { href: "https://www.canva.com/developers/integrations", text: "canva.com/developers" }, " → Your integrations → Create an integration;"],
          "in Scopes attiva lettura e scrittura di design, asset, cartelle, commenti, brand template e profilo;",
          ["in Authentication aggiungi l'indirizzo di ritorno di Cora mostrato qui sotto, ", { code: "…/connectors/oauth/canva/callback" }, ";"],
          ["copia client ID e client secret e incollali qui: finiscono nella cassaforte come ", { code: "CORA_CANVA_CLIENT_ID" }, " e ", { code: "CORA_CANVA_CLIENT_SECRET" }, ";"],
          "poi premi «Autorizza Canva» e accetta con il tuo account.",
        ], fields: [
          { name: "clientId", type: "text", title: "Client ID", label: "Client ID dell'app Canva" },
          { name: "clientSecret", type: "password", title: "Client secret", label: "Client secret dell'app Canva" },
        ], submit: "Salva l'app" },
      ],
    }],
  },
  definition(record) {
    return {
      name: "canva",
      description: `Canva${record.account ? `, account ${record.account}` : ""}: one call to the Canva Connect API (https://api.canva.com/rest/v1) and its JSON back. Cora adds and renews the token: you never see it, and you need no curl or secret_import. Give method, path and, for writes, body (sent as JSON as it is). Examples: GET /users/me/profile · GET /designs?query=…&limit=20 · GET /designs/<id> · POST /designs {"design_type":{"type":"preset","name":"presentation"},"title":"…"} · GET /folders/root/items · POST /folders {"name":"…","parent_folder_id":"root"} · GET /brand-templates · POST /autofills {"brand_template_id":"…","data":{…}} then GET /autofills/<job id> · POST /exports {"design_id":"…","format":{"type":"pdf"}} then GET /exports/<job id> (the urls to download) · POST /url-asset-uploads {"name":"…","url":"https://…"} then GET /url-asset-uploads/<job id> · GET /designs/<id>/comments … Jobs are asynchronous: poll the GET until status is success or failed.`,
      parameters: {
        type: "object",
        properties: {
          method: { type: "string", enum: [...METHODS], description: "default GET" },
          path: { type: "string", description: "the API path after /rest/v1, e.g. /designs?limit=10" },
          query: { type: "object", description: "optional query parameters, added to the path" },
          body: { type: "object", description: "for POST, PATCH and PUT: the JSON body" },
        },
        required: ["path"],
      },
    };
  },
  summarize(args) { return `${String(args.method || "GET").toUpperCase()} ${String(args.path || "")}`.slice(0, 200); },
  async run(args, { token, request, api }) {
    const method = String(args.method || "GET").toUpperCase();
    if (!METHODS.has(method)) return { error: "method is GET, POST, PATCH, PUT or DELETE" };
    const path = String(args.path || "").trim();
    if (!/^\/[\w\-./]*(\?[^#\s]*)?$/.test(path) || path.includes("..") || path.includes("//") || path.startsWith("/oauth")) return { error: "path is a Canva Connect API path such as /designs/<id>: no host, no .., no /oauth; see the examples" };
    const url = new URL(`${api.canva}${path}`);
    if (args.query && typeof args.query === "object") for (const [key, value] of Object.entries(args.query)) url.searchParams.set(key, String(value));
    const body = ["POST", "PATCH", "PUT"].includes(method) ? (args.body && typeof args.body === "object" ? args.body : {}) : undefined;
    const { status, data } = await request(url.href, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body });
    if (status === 401) return { error: "Canva refuses the authorisation: the owner authorises Canva again in Connettori" };
    if (status === 403) return { error: `Canva answered 403${data?.message ? `: ${String(data.message).slice(0, 500)}` : ""}: the integration may lack the scope for this call` };
    if (status >= 400) return { error: `Canva answered ${status}${data?.message ? `: ${String(data.message).slice(0, 1500)}` : data?.code ? `: ${data.code}` : ""}` };
    return { data: data ?? {} };
  },
};
