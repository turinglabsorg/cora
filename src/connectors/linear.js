/**
 * Linear: a personal API key made by the person who connects it. Cora sends the
 * agents' GraphQL to Linear with that key, so every authorised agent works the same
 * way and none of them ever holds the key.
 */
export const linear = {
  id: "linear",
  name: "Linear",
  secret: "CORA_LINEAR_KEY",
  label: "workspace",
  card: {
    icon: "list",
    description: "Gli agenti leggono e creano issue nel workspace che colleghi.",
    meta: "Linear · Issue e progetti",
    intro: "Gli agenti leggono e creano issue nel workspace che colleghi. La chiave resta nella cassaforte, mai nel pannello.",
    modes: [{
      id: "key",
      notice: "Servono due dati, che si trovano in Linear: il workspace e una chiave API personale.",
      rows: [
        { title: "1. Il workspace", hint: "Il nome che compare in linear.app/<workspace>, per esempio turinglabs.", field: { name: "workspace", type: "text", placeholder: "turinglabs", label: "Workspace di Linear" } },
        { title: "2. La chiave API", steps: [
          ["apri ", { href: "https://linear.app/settings/security", text: "linear.app/settings/security" }, " → Sicurezza → Chiavi API e crea una chiave personale;"],
          "copia la chiave;",
          ["incollala qui: Cora la verifica su Linear e la salva nella cassaforte come ", { code: "CORA_LINEAR_KEY" }, ", senza mostrarla più."],
        ], field: { name: "token", type: "password", label: "Chiave API di Linear" }, submit: "Verifica e collega" },
        { title: "3. Gli agenti", hint: "Dopo il collegamento scegli quali agenti possono usare la chiave.", note: "Il passo si sblocca appena il workspace è collegato." },
      ],
    }],
  },
  definition(record) {
    return {
      name: "linear_graphql",
      description: `Linear, workspace ${record.workspace || "connected in Connettori"}${record.account ? `, acting as ${record.account}` : ""}: send one GraphQL query or mutation to the Linear API and get its JSON back. Cora adds the key: you never see it, and you need no curl or secret_import. Ask only for the fields you need. Examples: { teams { nodes { id key name states { nodes { id name type } } } } } · query($id:String!){ issue(id:$id){ id identifier title description url state{name} assignee{name} comments{nodes{body user{name}}} } } with variables {"id":"REF-62"} · { issues(first:20, filter:{team:{key:{eq:"REF"}}, state:{type:{nin:["completed","canceled"]}}}){ nodes{ identifier title state{name} } } } · mutation($input:IssueCreateInput!){ issueCreate(input:$input){ success issue{ identifier url } } } with {"input":{"teamId":"…","title":"…","description":"…"}} · mutation{ commentCreate(input:{issueId:"…", body:"…"}){ success } } · mutation{ issueUpdate(id:"REF-62", input:{stateId:"…"}){ success } }.`,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "the GraphQL query or mutation" },
          variables: { type: "object", description: "optional GraphQL variables" },
        },
        required: ["query"],
      },
    };
  },
  summarize(args) { return String(args.query || "").replace(/\s+/g, " ").slice(0, 200); },
  async run(args, { token, request, api }) {
    const query = String(args.query || "").trim();
    if (!query) return { error: "write the GraphQL query or mutation in query" };
    const variables = args.variables && typeof args.variables === "object" && !Array.isArray(args.variables) ? args.variables : undefined;
    // A personal API key goes bare in the header; an OAuth token goes as a bearer.
    const authorization = token.startsWith("lin_api_") ? token : `Bearer ${token}`;
    const { status, data } = await request(api.linear, { method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body: { query, variables } });
    if (status === 401 || status === 403) return { error: "Linear refuses the key: the owner reconnects Linear in Connettori" };
    if (data?.errors?.length && !data?.data) return { error: `Linear: ${data.errors.map((item) => item.message).join("; ").slice(0, 1500)}` };
    if (status >= 400) return { error: `Linear answered ${status}${data?.errors?.length ? `: ${data.errors.map((item) => item.message).join("; ").slice(0, 1500)}` : ""}` };
    return { data: data?.errors?.length ? { data: data.data, errors: data.errors.map((item) => item.message) } : data?.data ?? null };
  },
  get tools() {
    const self = this;
    return [{
      name: "linear_graphql",
      description: (record) => self.definition(record).description,
      get parameters() { return self.definition({}).parameters; },
      summarize: (args) => self.summarize(args),
      async run(args, ctx) {
        const result = await self.run(args, ctx);
        if (result.error !== undefined) throw new Error(result.error);
        return result.data;
      },
    }];
  },
};
