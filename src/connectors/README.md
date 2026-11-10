# Connectors

A connector lets Cora's agents work on an outside service (Linear, Asana, Canva, Google
email, …) with a key, an OAuth app or an account that a person connects once, in the
panel under **Connettori**.

The person pastes what the service gives them. Cora checks it against the service,
seals it in the vault and lets the owner choose which agents may use it. Those agents
then get **one Cora tool per connector** (`linear`, `asana`, `canva`, `google_email`) on
the Cora MCP server.
Cora adds the key to every call itself. The agent never sees the key, does not need
`curl` or `secret_import`, and does not have to work out the API on its own. An agent
that is not authorised for a connector does not even see its tool.

## Layout

| File | What it holds |
| --- | --- |
| `index.js` | The registry: the list of connectors, in the order the panel shows them, and the catalogue the panel reads. |
| `key-connectors.js` | `KeyConnectors`: connect, verify, authorise agents, disconnect, and run the agents' tools. |
| `linear.js` | Linear: a personal API key; tool `linear` sends one GraphQL query or mutation. |
| `asana.js` | Asana: a personal access token or an OAuth app; tool `asana` makes one REST call (method + path + body). |
| `canva.js` | Canva: an OAuth integration authorised by the owner; tool `canva` makes one Connect API call. |
| `google.js` | Google: accounts connected through Cora's OAuth broker (`GoogleConnector`); tool `google_email` lists the accounts and sends from one. |

Google is `kind: "google"`: its card has its own flow in the panel (one card, several
accounts, agents chosen per account), and `GoogleConnector` serves its tool, which
`KeyConnectors` hands over to it. The broker grants `gmail.send` only, so `google_email`
sends but cannot read an inbox.

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
     tool: "acme",             // optional: the agent tool's name; leave it out for no tool
     oauth: { /* optional: authorise an app with the owner's account, see below */ },
     card: { /* the catalogue card and the forms, see below */ },
     definition(record) { /* the tool: { name, description, parameters } */ },
     summarize(args) { /* one line for the activity log: never the key, never a body */ },
     async run(args, { token, request, api }) { /* returns { data } or { error } */ },
   };
   ```

2. **List it in `index.js`** in `CONNECTORS`.
3. **Teach `KeyConnectors.connect`** (keys and app credentials) to check the credential with the service before it
   is stored (see `checkLinear` and `checkAsana`): a wrong key is refused at once, with a
   message the person understands, and nothing reaches the vault.
4. **Add the English** for the card's texts in `web/i18n.js`.
5. **Test it** in `test/key-connectors.test.js` against a fake service: connecting it, a
   refused key, and the tool reading and writing for an authorised agent but not appearing
   for the others.

## The card

```js
card: {
  icon: "list",                 // an icon name from web/app.js
  description: "…",             // the catalogue card
  meta: "Acme · Progetti",      // the line under it
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

## Writing the tool

- **One tool per service**, not one per endpoint. Every tool description is sent with
  every turn of every authorised agent, so keep it short and give a few real examples
  of the calls agents need most (read, create, update, comment).
- **Use `request`, never `fetch`.** `request(url, { method, headers, body })` answers
  `{ status, data }` and throws only when the service does not answer. Put the key into
  the headers yourself, from `token`.
- **Take base URLs from `api`**, so tests can point them at a fake service. Add new ones
  to `KeyConnectors` (constructor and `runTool`).
- **Refuse bad input** with `{ error }`: no host in a path, no `..`, only the methods the
  service has.
- **Return the service's own JSON** in `{ data }`. Cora turns it into text, cuts it at
  40,000 characters and removes the key if a service ever echoes it.
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
