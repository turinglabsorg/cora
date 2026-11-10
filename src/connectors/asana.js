/**
 * Asana: a personal access token (or, later, the token of an app). Cora calls the
 * Asana REST API with it for the authorised agents: they name the method and the
 * path, Cora adds the host and the key and wraps the body the way Asana wants it.
 */
const METHODS = new Set(["GET", "POST", "PUT", "DELETE"]);

export const asana = {
  id: "asana",
  name: "Asana",
  secret: "CORA_ASANA_TOKEN",
  appSecrets: ["CORA_ASANA_CLIENT_ID", "CORA_ASANA_CLIENT_SECRET"],
  label: "workspace",
  tool: "asana",
  card: {
    icon: "check",
    description: "Gli agenti lavorano sui progetti e sulle attività del tuo Asana.",
    meta: "Asana · Progetti e attività",
    intro: "Gli agenti lavorano sui progetti del tuo Asana. Il token resta nella cassaforte, mai nel pannello.",
    modes: [{
      id: "pat",
      label: "Token personale",
      notice: "Collegare Asana richiede un token personale: il workspace lo ricava Cora dal token.",
      body: { mode: "pat" },
      rows: [
        { title: "Il token personale", steps: [
          ["apri ", { href: "https://developers.asana.com/docs/personal-access-token", text: "Asana → Impostazioni → App" }, " e crea un token di accesso personale;"],
          "copia il token;",
          ["incollalo qui: Cora lo verifica su Asana e lo salva nella cassaforte come ", { code: "CORA_ASANA_TOKEN" }, ", senza mostrarlo più."],
        ], field: { name: "token", type: "password", label: "Token personale di Asana" }, submit: "Verifica e collega" },
      ],
    }, {
      id: "oauth",
      label: "App OAuth",
      ready: "app",
      intro: "Con un'app OAuth l'accesso è dell'app che crei tu su Asana, non di una persona sola.",
      notice: "Creare l'app Asana richiede due dati: client ID e client secret. L'autorizzazione OAuth si completa dopo, quando l'app esiste.",
      body: { mode: "oauth" },
      rows: [
        { title: "L'app Asana", steps: [
          ["apri ", { href: "https://developers.asana.com/docs/authentication", text: "developers.asana.com" }, " → My apps → Create new app;"],
          "copia client ID e client secret dell'app;",
          ["incollali qui: finiscono nella cassaforte come ", { code: "CORA_ASANA_CLIENT_ID" }, " e ", { code: "CORA_ASANA_CLIENT_SECRET" }, ";"],
          "l'autorizzazione OAuth è il passo successivo: appena l'app è pronta la completiamo da qui.",
        ], fields: [
          { name: "clientId", type: "text", title: "Client ID", label: "Client ID dell'app Asana" },
          { name: "clientSecret", type: "password", title: "Client secret", label: "Client secret dell'app Asana" },
        ], submit: "Salva l'app" },
      ],
    }],
  },
  definition(record) {
    const workspace = record.workspace ? `${record.workspace}${record.workspaceId ? ` (gid ${record.workspaceId})` : ""}` : "connected in Connettori";
    return {
      name: "asana",
      description: `Asana, workspace ${workspace}${record.account ? `, acting as ${record.account}` : ""}: one call to the Asana REST API (https://app.asana.com/api/1.0) and its JSON back. Cora adds the token: you never see it, and you need no curl or secret_import. Give method, path and, for writes, body (the fields of the object: Cora wraps them in {data}). Use opt_fields in query to keep answers small. Examples: GET /workspaces · GET /projects?workspace=<gid>&archived=false · GET /projects/<gid>/tasks?opt_fields=name,completed,assignee.name,due_on · GET /tasks/<gid>?opt_fields=name,notes,completed,assignee.name,projects.name · GET /workspaces/<gid>/tasks/search?text=…&completed=false · POST /tasks {"name":"…","notes":"…","projects":["<gid>"],"assignee":"me"} · PUT /tasks/<gid> {"completed":true} · POST /tasks/<gid>/stories {"text":"…"} (a comment) · DELETE /tasks/<gid>.`,
      parameters: {
        type: "object",
        properties: {
          method: { type: "string", enum: [...METHODS], description: "default GET" },
          path: { type: "string", description: "the API path after /api/1.0, e.g. /tasks/123?opt_fields=name" },
          query: { type: "object", description: "optional query parameters, added to the path" },
          body: { type: "object", description: "for POST and PUT: the object's fields" },
        },
        required: ["path"],
      },
    };
  },
  summarize(args) { return `${String(args.method || "GET").toUpperCase()} ${String(args.path || "")}`.slice(0, 200); },
  async run(args, { token, request, api }) {
    const method = String(args.method || "GET").toUpperCase();
    if (!METHODS.has(method)) return { error: "method is GET, POST, PUT or DELETE" };
    const path = String(args.path || "").trim();
    if (!/^\/[\w\-./]*(\?[^#\s]*)?$/.test(path) || path.includes("..") || path.includes("//")) return { error: "path is an Asana API path such as /tasks/123: no host, no ..; see the examples" };
    const url = new URL(`${api.asana}${path}`);
    if (args.query && typeof args.query === "object") for (const [key, value] of Object.entries(args.query)) url.searchParams.set(key, String(value));
    const body = method === "POST" || method === "PUT" ? (args.body && typeof args.body === "object" ? ("data" in args.body && Object.keys(args.body).length === 1 ? args.body : { data: args.body }) : { data: {} }) : undefined;
    const { status, data } = await request(url.href, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body });
    if (status === 401) return { error: "Asana refuses the token: the owner reconnects Asana in Connettori" };
    if (status >= 400) return { error: `Asana answered ${status}${data?.errors?.length ? `: ${data.errors.map((item) => item.message).join("; ").slice(0, 1500)}` : ""}` };
    return { data: data ?? {} };
  },
};
