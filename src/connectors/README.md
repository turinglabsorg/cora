# Connectors

A connector lets Cora's agents work on an outside service (Linear, Asana, Canva, Google
email, …) with a key, an OAuth app or an account that a person connects once, in the
panel under **Connettori**.

The person pastes what the service gives them. Cora checks it against the service,
seals it in the vault and lets the owner choose which agents may use it. Those agents
then get **one Cora tool per action** on the Cora MCP server (`asana_create_task`,
`linear_comment`, `canva_export_design`, `gmail_search`, …), plus one generic call per service
(`asana_api`, `linear_graphql`, `canva_api`, `gmail_api`, `lovable_mcp`) for what no action covers.
Cora adds the key to every call itself. The agent never sees the key, does not need
`curl` or `secret_import`, and does not have to work out the API on its own. An agent
that is not authorised for a connector does not even see its tool.

## Layout

| File | What it holds |
| --- | --- |
| `index.js` | The registry: the list of connectors, in the order the panel shows them, and the catalogue the panel reads. |
| `key-connectors.js` | `KeyConnectors`: connect, verify, authorise agents, disconnect, and run the agents' tools. |
| `tooling.js` | Helpers shared by the actions: `fail` (a refusal the agent reads), `count`, `list`, `pick` (by id or name), `localFile` (a file from the agent's computer). |
| `linear.js` | Linear: a personal API key; 15 `linear_` actions (issues, comments, projects, cycles, labels, states) and `linear_graphql`. |
| `asana.js` | Asana: a personal access token or an OAuth app; 17 `asana_` actions (tasks, subtasks, sections, comments, attachments, projects) and `asana_api`. |
| `canva.js` | Canva: an OAuth integration authorised by the owner; 20 `canva_` actions (designs, exports, uploads, folders, brand templates, comments) and `canva_api`. |
| `lovable.js` | Lovable: the official MCP server (`mcp.lovable.dev`), reached by Cora as an MCP client with the owner's OAuth token; 31 `lovable_` actions (projects, the project agent's messages, diffs and files, knowledge, skills, database, deploy, analytics, uploads) and `lovable_mcp`. The account's workspaces are kept on the record; the owner picks a default one in the card, which tools use when the agent names none (`settle`, `dress`, `prepare` hooks). |
| `google.js` | Google: accounts connected through Cora's OAuth broker (`GoogleConnector`); 14 `gmail_` actions (send, reply, search, read, attachments, labels, archive, drafts) and `gmail_api`. |

Google is `kind: "google"`: its card has its own flow in the panel (one card, several
accounts, agents chosen per account), and `GoogleConnector` serves its tools, which
`KeyConnectors` hands over to it. The broker asks Google for `gmail.send`, `gmail.compose`
and `gmail.modify`; each account keeps the scopes it actually granted, and each `gmail_`
action declares `needs` (send, draft, read, change): an agent sees an action only when one
of its accounts allows it. Accounts connected before keep `gmail.send` only until they are
reconnected.

## The panel reads the catalogue from here

`GET /api/connectors` answers `catalog`: every module's `id`, `name`, `kind`, vault names,
`tool` and `card`, never a value. `web/app.js` draws the catalogue cards and every key
connector's form from it, so **a new key connector needs no panel code**. The card's
texts are Italian. The panel translates them through `web/i18n.js` like the rest of
the UI, so add the English for each new text there.

## Adding a connector

1. **Write `<service>.js`** next to the others and export one object:

   ```js
   export const acme = {
     id: "acme",               // used in /api/connectors/keys/<id> and in the records
     name: "Acme",             // shown in the panel and in errors
     secret: "CORA_ACME_KEY",  // the vault name of the key agents work with
     appSecrets: [],           // optional: vault names for an app's client ID and secret
     label: "workspace",       // what the account is called in the card
     oauth: { /* optional: authorise an app with the owner's account, see below */ },
     card: { /* the catalogue card and the forms, see below */ },
     tools: [{                 // one entry per action an agent may take
       name: "acme_create_item",
       description: "Acme: create an item in a project …",   // or (record) => "…"
       parameters: { type: "object", properties: { /* JSON Schema */ }, required: [] },
       summarize(args) { /* optional: one line for the activity log, never a key or a body */ },
       async run(args, ctx) { /* returns the data the agent reads; fail("…") to refuse */ },
     }],
     context(ctx) { return { ...ctx, acme: client(ctx) }; },  // optional: a client every run shares
     settle(checked, previous) { /* optional: what a (re)connection keeps, e.g. the owner's default workspace */ },
     dress(definition, record) { /* optional: the agent-facing definition for this record, e.g. a default named */ },
     prepare(tool, args, record) { /* optional: args before run, e.g. the default workspace or a name → id */ },
   };
   ```

2. **List it in `index.js`** in `CONNECTORS`.
3. **Teach `KeyConnectors.connect`** (keys and app credentials) to check the credential with the service before it
   is stored (see `checkLinear` and `checkAsana`): a wrong key is refused at once, with a
   message the person understands, and nothing reaches the vault.
4. **Add the English** for the card's texts in `web/i18n.js`.
5. **Test it** in `test/connector-<service>.test.js` against a fake service: every action,
   the refusals, and the tools not appearing for an agent that is not authorised. Then try
   the actions live on a test project of the real service, and remove what the test made.

## The card

```js
card: {
  icon: "list",                 // an icon name from web/app.js
  description: "…",             // the catalogue card
  meta: "Acme · Progetti",      // the line under it
  workspacePicker: true,        // optional: once connected, a «Workspace predefinito» select from record.workspaces
  intro: "…",                   // the first paragraph of the detail, also once connected
  modes: [{                     // one form per way to connect; two or more get a switch
    id: "key",                  // compared with the record's mode to open the right one
    label: "Chiave personale",  // the switch button (only with two or more modes)
    ready: "app",               // optional: the record status that shows «App pronta»
    intro: "…", notice: "…",    // optional: replace the intro, add a warning
    body: { mode: "pat" },      // fixed fields sent with the form
    rows: [{
      title: "1. La chiave", hint: "…",
      steps: ["copia la chiave;", ["apri ", { href: "https://…", text: "…" }, ", poi ", { code: "CORA_ACME_KEY" }]],
      field: { name: "token", type: "password", label: "Chiave di Acme", placeholder: "" },
      fields: [{ name: "clientId", title: "Client ID", label: "…" }],  // stacked fields instead of one
      submit: "Verifica e collega",  // posts every field of the mode to /api/connectors/keys/<id>
      note: "…",                    // a muted line, e.g. for a step that opens later
    }],
  }],
  optional: { intro, notice, off, start, restart, later, done },  // a «not now» choice before the form
}
```

## Writing the actions

- **One tool per action an agent takes**, named `<service>_<verb>_<thing>`, plus one generic
  call (`<service>_api`) for the rest. Let agents name things as people do: resolve a
  project, team, label or state by name (`pick` in `tooling.js`) and refuse an ambiguous
  name with the candidates, so the agent can choose.
- Keep descriptions short and concrete: every description travels with every turn of every
  authorised agent. Say what is final (a send, a delete) and whose name the action carries.
- **Files** come from the agent's computer through `ctx.readFile` (`localFile`), and go to it
  through `ctx.writeFile` (inside `/home/agent/work` only): an agent never pastes bytes.
- `run` gets `ctx` with `token`, `request`, `api`, `record`, `readFile`, `writeFile`, plus what
  `context` adds. It returns plain data; `fail(message)` refuses with a message the agent
  reads as `error: …`.
- **Use `request`, never `fetch`.** `request(url, { method, headers, body })` answers
  `{ status, data }` and throws only when the service does not answer. Put the key into
  the headers yourself, from `token`.
- **Take base URLs from `api`**, so tests can point them at a fake service. Add new ones
  to `KeyConnectors` (constructor and `runTool`).
- **Refuse bad input** with `fail`: no host in a path, no `..`, only the methods the
  service has.
- **Return compact data**: the fields an agent needs, not the service's whole object. Cora
  turns it into text, cuts it at 40,000 characters and removes the key if a service ever
  echoes it.
- Agents act **as the account that made the key**. Say so in the description, so an agent
  knows whose name its comments and tasks will carry.

## OAuth apps

When a service has no personal keys (Canva) or the owner prefers an app (Asana), the module
declares `oauth` and `KeyConnectors` runs the whole authorisation; the module writes no
OAuth code:

```js
oauth: {
  authorize: "https://acme.example/oauth/authorize",  // the page the owner accepts on
  token: "https://api.acme.example/oauth/token",      // code → tokens, refresh → tokens
  scopes: ["read", "write"],                          // joined with spaces; [] for none
  clientAuth: "basic",                                // "basic" header or "body" fields
  async identify({ access, request, api }) {          // who authorised: shown in the card
    return { workspace: "…", account: "…" };
  },
},
```

1. The card's form saves the app's client ID and secret under `appSecrets` (the record's
   status becomes `app`, the mode's `ready`).
2. The panel shows Cora's redirect URL (`<origin>/connectors/oauth/<id>/callback`, from the
   catalogue) to add to the app, and an «Autorizza» button:
   `POST /api/connectors/keys/<id>/authorize` answers the service's page, with PKCE (S256)
   and a nonce in a cookie.
3. The service sends the owner back to the callback; Cora trades the code for tokens,
   calls `identify`, and seals `{ access_token, refresh_token, expires_at }` under the
   module's `secret`. The record becomes `connected` with mode `oauth`.
4. On every tool call Cora renews the access token when it is about to expire and stores a
   rotated refresh token at once (Canva hands out a new one each time). `run` receives the
   access token as `token`, exactly as with a key.

Tests point `authorize` and `token` at a fake service with
`keyConnectors.oauthUrls[<id>] = { token: "http://127.0.0.1:…/token" }`.

### Quick access through a loopback client

Some services (Lovable) register OAuth clients on their own only for loopback redirect
URLs. A module that declares `oauth.register` and `oauth.loopback` gets a second way in,
mode `quick`, on any plan of the service:

1. «Apri Lovable» calls `POST /api/connectors/keys/<id>/authorize?mode=quick`: Cora
   registers itself once as a public client (`token_endpoint_auth_method: none`), keeps
   its client ID in the vault as `<secret>_QUICK_CLIENT_ID`, and answers the consent page,
   which the panel opens in a new tab.
2. After consent the service sends that tab to the loopback address, which does not
   load. The owner pastes the address into the card; `POST /api/connectors/keys/<id>`
   with `{ mode: "quick", returned }` checks its origin, path, state and the person who
   started it, then trades the code (PKCE, no secret) like the callback would.
3. Renewals send only the client ID. Disconnecting removes the token and the client ID.

`oauth.tokenParams` adds fields to every token call (Lovable wants `resource`).

### Services that are MCP servers

When a service offers only an MCP server (Lovable), the module is the MCP client:
`client()` in `lovable.js` opens a Streamable HTTP session (`initialize`, then
`notifications/initialized`), keeps the `Mcp-Session-Id` per endpoint and token, reopens
it once on a 404, and reads the JSON-RPC answer from JSON or from the SSE stream. Each
action is still one Cora tool with its own schema; the generic tool calls any server tool
by name and lists them with `tools/list`. `request` answers `headers` and `text` besides
`status` and `data` for this.
