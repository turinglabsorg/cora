<p align="center"><img src="web/icon-512.png" width="96" alt="Cora"></p>

# Cora — Computer-Operating Resident Agents

Always-on AI agents that live on their own computers. Each agent has a personality, a layered long-term memory, scheduled routines and a Linux desktop (Docker + noVNC) that both the agent and its owner can use. They live where the owner puts them — a Discord server or Telegram chats, one at a time — and in the panel's own chat rooms, where they talk with the owner and with each other.

A password-protected web panel, installable on the phone as an app (Italian and English), manages personalities, memory, routines and desktops, shows every turn's reasoning, and delivers the agents' requests as push notifications.

## How it works

```
Discord / Telegram / panel rooms ──► orchestrator ──► brain (LLM + tools) ──► the agent's own bot, or the panel
                                          │                 │
                                          │                 ├── memory: core card · facts (FTS5) · archive · diary
                                          │                 └── desktop: docker exec in cora-box-<agent>
                                          └── scheduler: cron routines · nightly sleep (memory consolidation)
web panel (password, PWA) ──► REST API + live events (SSE) + noVNC proxy + Web Push
```

## Talking with the agents

- **Name someone and they answer alone.** A human message that names agents goes to them; follow-ups without names keep going to them for a few minutes, and the others stay quiet unless called by name. A message that mentions someone who is not an agent wakes nobody. A message for no one in particular gets at least one answer.
- **They answer at once and keep you posted.** An agent that has to work first says so (`say`), posts what it is doing along the way, and ends with the result; if it stays silent for a while it acknowledges on its own. New messages written while it works reach it with its next tool result, so you can steer it mid-task.
- **One conversation, many places.** Every turn includes the agent's latest exchanges in its other places (Discord or Telegram, the panel), so what the owner said in one carries over to the other.
- **Requests.** `ask_owner` sends the owner a question with up to four quick answers, where the conversation is happening. On Discord or Telegram the question is posted in the channel (on Discord it mentions the owner), with the answers as text. On the panel it gets tap-to-answer buttons and a phone notification (Web Push). The owner's next message there is the answer: it goes to the agent who asked, even without its name. `notify` is a plain heads-up. Pending panel requests sit on top of the Salotto, the panel room every agent is in.
- **Routines.** Cron-scheduled tasks an agent runs on its own with its computer, then reports. Agents create, change and delete their own routines when the owner asks (`set_routine`, `list_routines`, `delete_routine`).
- **doc checks what they say and publish.** The Cora harness runs [doc](https://github.com/turinglabsorg/doc)'s checks for every model, the same ones the owner's coding agents run as hooks. A `shell` command that would post a GitHub or Linear comment is checked first, its body file read from the agent's computer: a comment with local paths, an attribution line or unpushed state is refused with the reasons, and a borderline one runs only when the agent sends the same command again. A `say`, `ask_owner` or `notify` that gives an effort estimate or asks someone to paste a secret into the chat is stopped once per turn with the reason, and so is the final reply, which the agent writes again. TypeSafe's Jev judges what needs reading, with the key from **Settings → Connections → API keys**; without a key only doc's exact rules apply, and without doc on the machine nothing is checked and nothing fails. The same card shows doc's checks of the last day and proves on demand that doc answers and Jev judges. **Settings → Controls** lists doc's Jev checks for chat messages and for published comments: each can be switched off, and the owner adds checks of their own (a yes/no question for Jev, what to tell the agent, optional keywords). A new or changed check is tried before it is saved on every brain the agents run on: each writes a text that breaks it (once more, plainly, if its first one does not), Jev must stop it, the brain gets doc's reason as an agent would and writes it again, and Jev must let the rewrite through. Cora keeps them in `doc-rules.json` in its home, which doc reads through `DOC_RULES`; doc's exact rules stay on. Claude Code runs with the owner's own hooks turned off, so nothing is checked twice.
- **Reasoning you can inspect.** Every turn (chat, routine, sleep) is a trace: the context the agent received, the system prompt, its reasoning, every tool call with arguments and result, and the answer — also when it passes. Traces stream live to the panel.

## Where they live

- **Discord, Telegram or Slack, one at a time** (`settings.transport`); switching starts one and stops the others. Only the servers, chats or channels turned on in the panel are heard.
- **Discord:** each agent connects as its own bot (`CORA_BOT_<NAME>`, pasted in the panel and stored in hush). Cora listens through the first agent bot whose app has the Message Content intent, or a dedicated `CORA_DISCORD_LISTENER_TOKEN`. Discord system messages (joins, pins…) are ignored.
- **Telegram:** a main bot long-polls the chats turned on; agents post through their own Telegram bot when it is in the chat, otherwise through the main bot with their name in bold.
- **Slack:** one Slack app per agent, so each is a real user people mention and write to; every app listens on its own Socket Mode socket, which needs no public address. The main app keeps the channel list and posts notices. Channel ids are `sl:<channel>`, a thread is `sl:<channel>:<thread ts>`, and an agent without an app of its own posts through the main one with its name and picture (`chat:write.customize`). Slack has no typing indicator for bots, so none is sent.
- **The panel:** the Salotto and one private chat per agent, always available, archived like the other channels so memory sees them.
- **Threads and DMs.** In a Discord or Slack thread agents only speak when summoned by name. A direct message to an agent's own bot is a private conversation that only that agent answers, even if it is assigned to no channel.
- **Shared listening.** Every agent bot listens to the channels it can see — each one switches on Discord's limited Message Content intent for its own app — so a private channel is heard as long as one agent is in it, and the same message arriving from several bots is answered once. In a channel the main bot cannot see, only the agents whose bot is really in it answer.
- **One voice at a time.** A message that names agents is answered by them; a message that names nobody gets a single answer, never a chorus.
- **Reports finish; conversations continue.** Routine results stay in the archive without starting another agent conversation. New human messages get an answer even when they arrive during final delivery. Status and side questions can receive an immediate reply while the same task continues.
- **Agents post directly.** `list_channels` finds authorized destinations; `say({text, channel_id})` posts there, or in the current conversation when the id is omitted. These tools are available without a desktop, grog or another login. Delivery respects the active transport, channel assignments and actual access.
- **Its routines are its own.** Creating, changing, pausing or deleting a routine touches nothing but that agent, so those tools are always within reach — not locked behind the owner's computer, which only opens when the owner is the one asking.
- **One task per thread, many threads at once.** An agent is multi-threaded: asked in three threads, it runs three instances side by side, each with its own computer, goal and steering, even on one subscription account. A thread admits only one active task and goal, even across different agents: a routine landing on a thread already at work is skipped with a note saying what it was on, and waits for its next turn. Someone writing to a working agent still gets an answer, just without a second computer task.
- **Harness and model are two choices.** Who drives the loop — Cora's own harness, Claude Code, Codex, Grok Build, Muse Code or Hermes — is chosen apart from which model thinks and where it runs, so "Hermes on a local model" is something you can say. Each agent can also be put on a card: Ollama decides its card when it starts and never per request, so one Ollama per card is what a card choice means, and the agent's address is the choice (`agent.ollamaHost`).
- **A model is installed from the panel.** The list shows what is on the machine with its size, whether it fits the free memory of the chosen card, and whether it can use tools at all — a model without tools is shown but cannot be picked, because an agent without tools can do nothing. Anything else is installed on request (`POST /api/ollama/pull`), with the progress in the panel and, when Ollama is too old for that model, those words instead of a number.
- **No "got it, working on it".** An agent at work shows it the way a person does: the typing indicator, refreshed while the turn runs. Slack gives bots no indicator, so there the app marks the message it took with 👀 and takes the mark back when it answers. Nothing is posted in the channel either way.
- **Where a model runs is on the badge.** An Ollama on the instance's own machine is told apart from the cloud one it proxies (`local` on each model, and the list groups them), with the model's size next to its name. The agent's profile shows what the machine has to run it with: which cards are in it, how much of their memory is in use and under what load (`nvidia-smi`, nothing when there is none), which models are loaded right now and how much of each sits in VRAM (`GET /api/hardware`).
- **As much context as the model really has.** Ollama does not refuse a prompt that is too long: it drops the oldest part in silence, and its default window is small unless asked otherwise. Cora asks each model what it can hold (`/api/show`), requests that window (up to 32k), and makes an agent on a long task summarise itself at 70% of it instead of at a fixed number of characters.
- **What it costs is on the record.** Every model call a turn makes is counted (the answer, the goal, the goal check, the summaries) and kept on the trace; the Agents page draws the available history from the first recorded use through today (up to a year) as a GitHub-style heatmap, one globally and one per agent. The panel opens on Agents, with global usage above the roster and individual usage below it. The scale is relative to the busiest day, because providers count tokens too differently for an absolute one to mean anything. Hermes reports nothing, so it stays at zero.
- **Passing failures are retried, not reported.** A model at capacity, a rate limit, a dropped connection or an empty answer is tried again by itself; only a failure that keeps failing reaches the chat. A CLI turn is retried only while the agent has used no tool, so nothing is done twice.
- **A routine says what it is checking** the moment it starts, unless its instructions explicitly require silence. Pausing, deleting or rescheduling it cancels the active invocation and prevents stale writes from restoring its old configuration.
- **No repeated "got it".** The automatic acknowledgement answers silence: an agent that has spoken in the channel in the last five minutes never sends it again to someone it is already talking to.

## Their computers

- Each agent owns a desktop container (XFCE, Chromium, terminal; passwordless sudo) that the owner can watch and take over from the panel.
- **Two ways to use that browser, one window.** The `computer` tool sees pixels (`import -window root`) and sends real X events (`xdotool`), which is how a site sees a person and not a script. The `browser` tool asks the same Chromium what the pixels cannot say — the page's text and elements, what it fetched, which sessions it holds (`text`, `query`, `html`, `eval`, `cookies`, `storage`, `network`, `goto`). The debugging port is opened on the ordinary browser the owner watches, never with `--enable-automation` and never by a driver, so `navigator.webdriver` stays false; it listens only inside the container. Values of cookies and storage never come back — only names, scope and size.
- **SSH** into every desktop: sshd (keys only, user `agent`) on a fixed host port, `ssh -J <user>@<host> -p <port> agent@127.0.0.1`, with the host's plain `authorized_keys` plus keys added in the panel. A desktop can also join the owner's tailnet with Tailscale SSH (`ssh agent@<name>`) after the owner approves the login link shown in the panel.
- **Upgrades:** the deploy rebuilds the desktop image only when `box/` changes, and Cora recreates outdated desktops when it starts. The home (`cora-home-<id>`) and system (`cora-sys-<id>`: Tailscale state, SSH host keys) volumes survive.
- Desktop tools (`shell`, `screenshot`, `computer`, `open_url`, `send_file`, routine tools) are available only when the owner started the conversation, or inside a routine.

## Memory

| Layer | What | When it is used |
|---|---|---|
| Core card | Compact notes per agent (max 4000 chars), edited by the owner and by the agent (`update_core`) | Always in the system prompt |
| Facts | Unlimited private or shared facts, optionally pinned (`remember` / `forget`) | Pinned always; the others are retrieved by full-text relevance plus the newest ones |
| Archive | Every message in the heard channels and panel rooms | Searchable with `recall` |
| Diary | A page written each night | The last two pages come back every turn |
| Sleep | Nightly consolidation at `sleepHour` (default 04:00) or on demand | Rereads the day, adds/merges/removes facts, rewrites the core card, writes the diary |

Everything lives in one SQLite file, `~/.cora/cora.db` (Node's built-in `node:sqlite`, FTS5).

## Models

Each agent picks its model, subscription and reasoning level (automatic, low, medium, high). Several agents can reuse one subscription, or select separate accounts:

| Prefix | Provider | How |
|---|---|---|
| `claude/` | Claude (Claude Code subscription) | `claude -p --output-format stream-json` with its own tools off (`--tools ""`), `--effort`; Cora's tools over a per-run MCP server |
| `codex/` | ChatGPT (Codex subscription) | `codex exec --json` read-only, shell/unified-exec/browser/computer-use/subagents disabled, `model_reasoning_effort`; Cora's tools over MCP |
| `grok/` | Grok (Grok Build subscription) | `grok --prompt-file … --output-format streaming-messages-json` with only `search_tool`/`use_tool`, in a Grok home of Cora's own whose `config.toml` holds Cora's MCP server; the owner's Claude/Cursor setup is kept out and the sessions Grok keeps are deleted after each turn |
| `muse/` | Meta (Muse Code subscription) | `muse exec --json --preset empty` (no built-in tools), Cora's system prompt (`run.system_prompt`) and MCP server (`mcpServers.cora`) passed for the run only, `--contributor-mode off`, no session log |
| `ollama/` | Ollama Cloud | `https://ollama.com` with `CORA_OLLAMA_API_KEY`, `think`; the Cora harness runs the tool loop |
| `orcarouter/` | OrcaRouter (every model behind one key) | `https://api.orcarouter.ai/v1`, OpenAI chat format, with `CORA_ORCAROUTER_API_KEY`; models from `/v1/models` plus `orcarouter/auto`; the Cora harness runs the tool loop |
| `hermes/` | Hermes Agent | `hermes -z` one-shot with only Cora's tools (`-t cora`), `--ignore-rules`, in its own home (`~/.cora/hermes-home`, override `CORA_HERMES_HOME`); models of its endpoint, by default the local Ollama (`CORA_HERMES_BASE_URL`) |

The MCP server (`src/mcp-server.js`) forwards tool calls to a loopback bridge (`src/bridge.js`) with a random port and token per run. Every agent also receives the owner's personal agent instructions (`~/.agents/AGENTS.md`, override with `CORA_OWNER_INSTRUCTIONS`).

## Run

Requirements: Node ≥ 22.13, Docker, `hush` (agent-blind secrets CLI), and the official `claude` / `codex` / `grok` / `muse` CLIs installed on the server for the subscription providers you use (Grok: `curl -fsSL https://x.ai/cli/install.sh | bash`; Muse: `curl -fsSL https://dev.meta.ai/install.sh | bash`, then `CORA_MUSE_BIN` or `PATH` must reach `~/.local/bin/muse`). Connect their accounts from the panel. No npm dependencies.

```bash
docker build -t cora-box:latest box     # the agents' desktop image
bin/run.sh                              # injects the hush secrets that exist, then starts src/main.js
```

Secrets come only from hush: `CORA_ADMIN_PASSWORD` (panel password), `CORA_SESSION_KEY` (cookie signing), `CORA_VAPID_KEY` (Web Push), `CORA_OLLAMA_API_KEY`, `CORA_TELEGRAM_BOT_TOKEN`, `CORA_SLACK_BOT_TOKEN` / `CORA_SLACK_APP_TOKEN` (the main Slack app), `CORA_TYPESAFE_API_KEY` (doc's Jev; where it is missing, the `TYPESAFE_API_KEY` doc itself uses on this machine), an optional `CORA_DISCORD_LISTENER_TOKEN`, and one `CORA_BOT_<NAME>` / `CORA_TG_BOT_<NAME>` / `CORA_SK_BOT_<NAME>` + `CORA_SK_APP_<NAME>` per agent (tokens are pasted in the panel, checked with Discord, Telegram or Slack, and stored in hush without touching a command line or a clear file).

Environment: `PORT` (default 4370), `CORA_LISTEN_HOST` (default 127.0.0.1), `CORA_HOME` (default `~/.cora`), `CORA_PUBLIC_URL` (the VAPID subject), `CORA_PUBLIC_HOST` (the domain an on-premise install answers on, which the cloud's passes are signed for), `OLLAMA_URL` (an address on this machine or this network needs no `OLLAMA_API_KEY`: the GPU in the room answers without one), `CORA_CLAUDE_BIN`, `CORA_CODEX_BIN`, `CORA_DOC_DIR` (the folder holding doc's `doc` package; found from the `doc` CLI on `PATH`, `~/.fluxkit/src/doc` or `~/doc`, and `off` turns the checks off), `CORA_TZ` (default Europe/Rome).

`deploy/macos.sh` deploys to a Mac over SSH (`CORA_DEPLOY_HOST=user@host`) as the LaunchAgent in `deploy/org.turinglabs.cora.plist`; `deploy/linux.sh` does the same on Linux as the systemd user service in `deploy/cora.service`, needing no root. Put the panel behind your own HTTPS tunnel or reverse proxy — `deploy/ON-PREM.md` is the whole installation on someone else's machine.

### Subscription accounts and remote sign-in

Open **Settings → Connections** to manage provider access. **Use resident subscriptions** is enabled by default: Cora detects the Claude and ChatGPT/Codex accounts already available on its server, and the Grok and Meta (Muse Code) ones where those CLIs are installed, and shows their email, plan and status. Agents without an explicit account use the matching resident subscription. Turn the setting off to require separately connected accounts.

Choose **Connect Claude**, **Connect ChatGPT**, **Connect Grok** or **Connect Meta** to add another account. When creating or editing an agent, **Change account** selects a resident or separately connected subscription, or starts a new connection. The official authorization page opens in the browser of the person using the panel; no browser or interactive desktop is needed on the server. Codex, Grok and Muse use a device-code flow: the panel shows the code and the official page to confirm it on (for Codex, enable device-code sign-in in ChatGPT security/workspace settings if required). For Claude, complete the official page and enter its returned authorization code in the panel when the browser cannot reach the server's loopback callback.

The local SQLite `subscriptions` table stores account labels, provider, connection status, email and plan; each agent stores its `subscriptionId`. Tokens are never returned by the panel API or stored in that table. The official CLIs keep and renew their credentials in separate, private profiles under `$CORA_HOME/subscriptions/<id>`: `CLAUDE_CONFIG_DIR` for Claude, `CODEX_HOME` for Codex, `GROK_HOME` for Grok and `XDG_CONFIG_HOME` for Muse (always in a file: Cora sets `TBH_CREDENTIAL_BACKEND=file`, so a machine login made for Cora on a Mac needs `TBH_CREDENTIAL_BACKEND=file muse login`). Claude may use its profile-specific macOS Keychain entry instead of a file. Back up these profiles securely together with the database; restore the corresponding Keychain separately when applicable. Old rotated tokens can still require sign-in again after a restore.

Use Claude Code 2.1.268 or newer: Cora checks `auth status --json` and refuses login/execution when the CLI cannot confirm the requested profile directory. Configure `CORA_CLAUDE_BIN` / `CORA_CODEX_BIN` / `CORA_GROK_BIN` / `CORA_MUSE_BIN` to the official executables. Wrappers must preserve profile isolation; a wrapper that silently uses the host's global Claude profile is refused. Provider/API-key environment variables from the host cannot override a selected account.

Separately connected subscriptions start disconnected and require browser authorization. An explicit account selection always takes priority and never falls back to a resident account if its login fails. Resident discovery reads only the official CLI account metadata; Cora does not import or copy those credentials, and the panel cannot log out or remove a resident account. Removing an agent keeps its managed subscription available for reuse; removing an unused managed subscription logs out and deletes only that private profile.

Ollama and OrcaRouter API keys are configured in **Settings → Connections → API keys**. Each key is shared by that Cora instance, saved through hush and applied immediately. The panel returns only configured/not-configured status and never reveals a stored value. Keys saved in the panel survive restarts through `bin/run.sh`. Other settings are organized into **Channels**, **Agents**, **Preferences** and **Access** tabs.

Login sessions expire after ten minutes and are cancelled on restart. Runs sharing one subscription are serialized so rotating credentials cannot race; different subscriptions can work concurrently. Cancellation and task deadlines also apply while waiting for that account. A lost/revoked login is reported as disconnected and requires a new provider sign-in.

These flows are intended for the customer's own Cora instance using official CLIs. They do not imply permission to broker subscription tokens or resell provider usage. Review [Claude's conditions](https://code.claude.com/docs/en/legal-and-compliance) and [OpenAI's supported integration models](https://developers.openai.com/siwc/token-sharing-open-source) before offering a hosted commercial service.

### Instance access and users

In **Settings → Access**, the owner can authorize verified email domains or individual addresses and see who has entered this Cora instance. Members keep separate accounts and sessions. For now, all admitted users share the same operational permissions; only the owner manages admission and revocation. Removing a domain or revoking a person invalidates their sessions and closes their open event streams and desktop connections. The owner always retains access.

Google/GitHub sign-in remains on usecora.space. Membership is checked by the target instance using signed identity claims, and permissions never carry across instances. Messages to agents retain the authenticated person's name and identity. The user list records first visit and last activity, with a recent activity history for the owner.

### Reminders and history

Open an agent’s **Routines and reminders** tab to create a recurring routine or a one-time reminder. A reminder uses an exact date/time rather than cron. It runs once when due; an independent, tool-free verification checks the actual tool results and delivered reply before Cora automatically archives it. This verification also works with Claude and Codex subscriptions and remains active when goal mode is off.

A failed, blocked or interrupted reminder stays visible. Busy agents and threads defer due reminders; unsuccessful attempts are not automatically repeated. Use **Retry** or reschedule explicitly after checking any effects of the previous attempt. Pausing, archiving or rescheduling cancels stale work. After a restart, unfinished attempts resume from their saved evidence instead of starting a new occurrence.

**Archive** shows searchable execution history and archived task definitions, with timestamps, output, verification and reasoning links. Find it within each agent or open the global archive from **Desk**. Archiving a task preserves its history. Existing routine traces and last results are imported as historical records without inventing a success verification. Agents can create reminders with `set_reminder` and consult their own past work with `routine_history`, even without computer tools.

### Context

Open **Context** in the main navigation to inspect server instruction files and shared memory. Each source shows its path, update time and whether Cora applies it, a CLI may load it, or the runtime excludes it. The common owner instructions match the text injected into agent prompts. Codex runs with automatic local instruction loading disabled; Claude files are shown as available because loading depends on the profile and turn runtime. Server files remain read-only and come from a fixed instruction-file inventory, never arbitrary server paths or credential stores.

Choose **New file** to write instructions or **Upload file** to import UTF-8 Markdown or text (`.md`, `.txt`, `.markdown`). Review and save the file in the instance database. Enabled files become shared context for all agents from their next turn, including agents on separately connected subscriptions. Edit, disable or delete them from the same page. The limits are 20 files, 30,000 characters each and 60,000 active characters in total; oversized content is refused rather than silently truncated. Concurrent edits are checked by revision so a stale save cannot replace another person's changes.

## The Cora harness

Browser progress is judged using the observed screen: repeated screenshots or clicks at the same coordinates remain valid when the page changes. Repeated observations with no new result are still stopped. If an agent’s personal Discord bot cannot send in an otherwise authorized shared channel, Cora can deliver the attributed reply through the main bot after checking read access. Private channels and DMs keep their identity boundary, and partially sent messages are never resent through another bot.

Agents on `ollama/` run on Cora's own agent loop, the Cora harness; agents on Claude Code, Codex, Grok Build, Muse Code or Hermes get the same checks around their CLI.

- **Goal mode** (`settings.goalMode`, off by default) assigns one active goal per thread. The task reserves its thread before writing the goal, and releases it when finished or stopped. Different threads can work independently; concurrent routines in the same thread are skipped.
- **The current request defines the goal.** Memories and prior conversations remain context for the agent, but never become the goal writer's request. A routine's goal covers its current invocation: check once and report (or stay silent), leaving future scheduled events to later invocations.
- **Cora checks every provider's goal.** A separate model reads the current condition, actual tool results and the answer. Unmet goals return the agent to work, up to 12 rounds; a future deadline, missing access or another person's required intervention ends the invocation as blocked instead of polling. Claude receives the same current condition as other providers, without a competing native `/goal`.
- **Messages are evaluated in context.** A separate model distinguishes a status question, a task change, an explicit stop and an acknowledgement. Status questions receive a recap from actual results while the same goal and worker keep running. Only a task change revises the condition; a recap or acknowledgement never drops it. Tool calls wait for pending evaluations before acting. CLI retries carry the updated condition, intervening messages and prior tool results, so they continue the task instead of restarting its old instructions.
- **A stop cancels execution.** Orders including “stoppa tutto” abort pending model requests or CLI processes, reject subsequent tool calls and end the trace as stopped. A restart does not revive stopped work or paused/deleted routines.
- A task (a turn where the agent has its computer, or a routine) runs until it is done, for hours if needed: no fixed number of steps per turn.
- Without a goal (the writer is unavailable, or the request is not a task) an agent that stops with nothing, with "shall I continue?", or with what it is about to do instead of doing it is sent back to work; its announcement still reaches the chat as an update. A finished agent confirms once before its result is posted.
- Repeating the same action without new results is a loop: the call is refused and the agent writes what blocks it. Visual observations compare actual screen contents, so changing pages remain valid even when screenshot arguments or click coordinates repeat.
- New messages reach a working agent with its next tool result; the channel stays open to the other agents meanwhile.
- Long conversations are summarised by the agent and carried on; a silent agent is reminded to send an update every 15 minutes.
- A task cut short by a restart of Cora is picked up again where it was.

## Hosted: usecora.space

`cloud/` is the hosted side: a small service (Node, no dependencies, SQLite in `~/.cora-cloud`) for a domain where each space is one Cora.

- The apex (`usecora.space`) is the landing and the only place people sign in, with Google (OpenID Connect) or GitHub (OAuth), both with PKCE and a state bound to the browser. One account can have both identities.
- `<space>.usecora.space` is routed by its Host to that space's Cora (requests, event streams and the desktop's WebSockets pass through).
- Entering a space goes through `/go/<space>`: the cloud signs a one-minute, single-use pass with its Ed25519 key, and the space's Cora (`/auth/cloud`) checks it with the public key alone, then opens its usual session. With `CORA_CLOUD_URL`, `CORA_CLOUD_KEY` (the public key, `cloud/cli.js public-key`) and `CORA_CLOUD_SPACE` set, a Cora has no password login; `bin/login-link.mjs` makes a one-time link on the host for when the cloud cannot be reached.
- Before sign-in opens, the landing takes waitlist emails (`cloud/cli.js waitlist` lists them). People without a space can ask for one from their account page; spaces are added by hand: `cloud/cli.js space add <name> --upstream <url> --google <email> --github <login>`.
- A space installed on the customer's own machine keeps its own address (`--public https://cora.example.com`): the cloud signs the pass for that host and sends people straight there, so their traffic never passes through usecora.space, and `<name>.usecora.space` only redirects. `deploy/ON-PREM.md` is the whole procedure.

Waitlist sign-ups post directly to Discord when `CORA_WAITLIST_WEBHOOK_URL` is stored in hush; `cloud/bin/start.sh` injects it at startup. Without a webhook, `CORA_CLOUD_NOTIFY` selects an operator space for the existing signed-notice route. Delivery failures are logged without webhook credentials and do not discard registrations.

Secrets in hush: `CORA_CLOUD_SEED` (sessions and the signing key), `CORA_CLOUD_GOOGLE_SECRET`, `CORA_CLOUD_GITHUB_SECRET`; the client ids go in `GOOGLE_CLIENT_ID` and `GITHUB_CLIENT_ID`. Start it with `cloud/bin/start.sh` (port 4380). The OAuth callbacks are `https://usecora.space/auth/google/callback` and `https://usecora.space/auth/github/callback`.

## Test

```bash
npm test
```

The integration tests run the whole service against stand-ins for Discord (REST + Gateway WebSocket), Telegram (Bot API), Slack (Web API + Socket Mode), Ollama, the `claude` / `codex` CLIs (driving the real MCP server), `docker`, and a Web Push service that decrypts what it receives. `test/cloud.test.js` runs usecora.space against stand-ins for Google, GitHub and a space.

## License

MIT
