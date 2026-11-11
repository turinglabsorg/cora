# Owner-scoped knowledge and platform privacy

Set `CORA_OWNER_MEMORY=1` on an instance that should isolate each person's agents and knowledge. The default keeps the existing shared-space behavior. Enable this on a fresh instance or explicitly assign existing resources before rollout; Cora never copies a legacy global Brain into every user's memory.

## Ownership and access

A panel user owns the agents they create. That user's internal agents share a stable owner memory pool and a private Brain containing clients, projects, people, procedures, decisions and topics. Agent core and diary stay specific to the agent. Replacing an agent does not delete the owner's facts or Brain pages.

The space administrator manages infrastructure and admission, but does not receive automatic access to another user's private agents or content. Agent rosters, private chat, each user's Salotto, desktops, files, email, traces, live events, routines, subscription accounts, Google connections, artifact folders and vault capabilities enforce ownership on the server. Direct URLs and guessed ids do not bypass those checks. Other owners' agents are also excluded from model rosters and file-transfer recipients.

Common server instructions, configured transport channels and instance infrastructure remain space settings. A conversation deliberately held in a shared Discord, Slack or Telegram channel is visible to that channel's participants; moving private material there is a separate publication action. Bind an agent's chat contact in Agent → Settings → Permissions. An ambiguous chat identity is not mapped to another panel owner.

Explicit operational permissions for a person's Discord, Slack or Telegram identity also let that person invoke the selected agents in their configured conversations. They do not change the agent's owner or grant access to the panel, private Brain pages, files, email, desktops or traces through the panel API. The space administrator receives no implicit cross-owner chat permission; revoked and other-agent grants remain refused, as do bot messages that impersonate a human permission.

Manage each agent's operational grants in Agent → Settings → Permissions. `GET|PUT /api/agents/:id/permissions` is restricted to that agent's owner in owner-memory mode. A write accepts `{id, allowed}` for a contact from the agent's conversations or its existing grants. It preserves other agents' permissions, including future-agent wildcard access through optional per-agent exclusions. Operational grants can expose the agent's memory in its chat replies; they do not make private panel resources accessible.

## Explicit sharing

Every Brain page starts private. The Sharing section offers only the owner and their agents, the whole team, or selected admitted people. Recipients see the shared page through an opaque alias and can read it with their agents. They receive no source transcript, revision history, write permission or authority to re-share it. Unshared linked pages are not made accessible. Revocation removes subsequent access, listing and retrieval; it cannot erase content already read or copied.

Artifact folders also start private in this mode. Folder owners may explicitly grant member read/upload access, reviewer access or named-agent capabilities. A wildcard agent capability applies only to the folder owner's agents. Vault wildcard grants likewise stay within the secret owner's agents. An explicit recipient grant remains a separate permission.

Internal file visibility and external share links use independent permissions. Creating a link never grants panel access to its recipients. Granting or revoking internal access does not change an existing link's recipients, limits or expiration. The internal listing, file/preview/download routes and underlying object routes all check the folder permission.

## External source

An agent may select an external Brain instead of internal knowledge. Configure it in Agent → Memory → Source using an HTTPS link serving one of these representations:

```json
{
  "pages": [
    {
      "slug": "support-policy",
      "kind": "procedure",
      "title": "Support policy",
      "summary": "How to handle a support request",
      "body": "The complete procedure."
    }
  ]
}
```

A top-level page array is also accepted. Markdown or plain text becomes one page named `knowledge`; an initial Markdown heading supplies its title. Limits are 500 pages, 2 MiB per response and 8,000 body characters per page. The reader accepts only GET responses, verifies public destinations on every redirect and pins the resolved destination. Private, loopback, link-local and local-network addresses are refused.

The full link is stored in hush, never returned to the panel or a model. The panel shows only its public host. A replacement uses a separate credential version and becomes active only after the source-change guard succeeds. A connection check fetches the selected source without sending data or modifying it.

External-source agents read only that source for memory and knowledge. Internal facts, core, diary, chat archives and context documents are excluded. `remember`, `forget`, `update_core`, `brain_note`, nightly consolidation and internal-memory API mutations are unavailable. The current conversation, personality and owner instructions still describe the current task. An unavailable source produces an explicit failure and never falls back to internal knowledge. Returning to internal mode restores the original internal data.

After a deliberate reset, an operator may set the existing settings value `knowledgeResetAt` to its ISO timestamp. Older transport history is refused before admission, and older archived messages stay outside prompts, recall and consolidation. This also prevents a transport reconnect from rebuilding discarded memory from its server-side history.

## API and persistence

- `GET|PUT /api/agents/:id/permissions`: agent-specific operational contact grants; writes accept `id` and boolean `allowed`.
- `GET|PUT /api/agents/:id/knowledge`: source, saved-host status and owner; writes accept `source`, an optional `url`, and an authorized ownership assignment.
- `POST /api/agents/:id/knowledge/check`: refresh the external source and return a read-only page count.
- `/api/brain`, its page/search/graph routes, reviews and manual librarian runs select the signed-in user's namespace.
- `GET /api/brain/sharing`: admitted recipients for explicit page sharing.
- `PUT /api/brain/pages/:slug/sharing`: `visibility` is `private`, `team` or `people`; `users` contains panel user ids for selected people.

Owners have separate Postgres schemas over the existing Brain connection, including independent revision queues and librarian checkpoints. Chat messages are filtered by owner before the ingestion limit. Unknown and external-agent sources do not enter an internal owner's archive. Shared SQLite facts from the previous global mode are not imported. Private notifications are delivered only to the owner's registered devices or configured chat contact, with no fallback to another administrator.

The scheduled backup includes all known owner namespaces. Integration coverage exercises real PGlite namespaces, separate owners with identical client slugs, explicit sharing and revocation, denied direct access, live-event filtering, owner-only notifications, stable memory after agent replacement, external-source failure and concurrent source changes.

Sealed isolation is configured in Agent → Settings → Security, with its own save action. Memory → Source continues to configure only the knowledge source.
