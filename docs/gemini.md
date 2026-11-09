# Gemini subscriptions through Antigravity CLI

Cora uses the official Antigravity CLI with a Google AI Pro or Ultra subscription, independently of Gemini API billing. Consumer Gemini CLI access moved to Antigravity CLI on June 18, 2026.

## Connect an account

Install Antigravity CLI 1.5.3 or newer as the user running Cora, using [Google's installation instructions](https://antigravity.google/docs/getting-started?tab=cli). The `agy` binary and Python 3 must be on the service's PATH. `CORA_GEMINI_BIN` can select another binary path.

In Settings → Gemini / Antigravity, choose Add account, open the official Google authorization page, then paste its authorization code into Cora. Choose that account and an available Gemini model in the agent's Brain tab. Models are discovered from the signed-in account, rather than a fixed catalog. Changing a model or connecting an account does not switch existing agents automatically.

Each managed account uses a private home under `$CORA_HOME/subscriptions/<id>` and a distinct `ANTIGRAVITY_CREDENTIAL_SCOPE`. The official CLI owns credentials and renewal. Cora stores only account metadata in SQLite; authorization URLs and codes stay in the pending authenticated session. Gemini does not borrow the server's resident login. Cancel and reconnect operate on the selected account. The CLI's system keyring must be usable by the Cora service; a successful browser authorization alone does not establish a working service login.

## Agent tools and execution

A turn gets its own workspace, custom `cora` agent, system instructions and MCP configuration. The custom agent has an empty native tool list; Cora's authorized MCP tools are registered eagerly so the model does not need host filesystem tools to discover their schemas. Native shell, file, browser and scheduling tools are unavailable, with additional deny rules for host reads, writes, commands and URLs. Cora's verifier, authorization boundaries and cancellation still govern the work.

Gemini models advertise image understanding. Conversation images are exposed through Cora's scoped `read_attachment` tool as MCP image blocks, including when the agent's desktop is disabled. The model does not need host file access to inspect a chat attachment.

Streaming output supplies the final response, intermediate text and token usage. A non-success result, missing final event, nonzero exit or cancellation fails the turn. The workspace and per-turn bridge configuration are removed afterward. Managed account state remains in its private profile and system keyring.

API keys and cloud-provider overrides are excluded from the subscription environment. API-key mode and automatic use of purchased AI credits are disabled. Subscription capacity remains subject to Google's plan limits.

References: [authentication](https://antigravity.google/docs/install), [headless mode](https://antigravity.google/docs/cli/headless/), [custom agents](https://antigravity.google/docs/subagents/), [MCP](https://antigravity.google/docs/mcp/), [plan limits](https://antigravity.google/docs/plans/).
