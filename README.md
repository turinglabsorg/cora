<p align="center"><img src="web/icon-512.png" width="96" alt="Cora"></p>

# Cora — Computer-Operated Rogue Agents

Always-on AI agents with their own computers. Each agent has a personality, a layered long-term memory, scheduled routines and a Linux desktop (Docker + noVNC) that both the agent and its owner can use. They live where the owner puts them — a Discord server or Telegram chats, one at a time — and in the panel's own chat rooms, where they talk with the owner and with each other.

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
- **Requests.** `ask_owner` sends the owner a question with up to four quick answers: it lands in the agent's private chat and on the phone (Web Push), and the answer comes back to the agent as a new turn. `notify` is a plain heads-up. Pending requests sit on top of the Salotto, the panel room every agent is in.
- **Routines.** Cron-scheduled tasks an agent runs on its own with its computer, then reports. Agents create, change and delete their own routines when the owner asks (`set_routine`, `list_routines`, `delete_routine`).
- **Reasoning you can inspect.** Every turn (chat, routine, sleep) is a trace: the context the agent received, the system prompt, its reasoning, every tool call with arguments and result, and the answer — also when it passes. Traces stream live to the panel.

## Where they live

- **Discord or Telegram, one at a time** (`settings.transport`); switching starts one and stops the other. Only the servers or chats turned on in the panel are heard.
- **Discord:** each agent connects as its own bot (`CORA_BOT_<NAME>`, pasted in the panel and stored in hush). Cora listens through the first agent bot whose app has the Message Content intent, or a dedicated `CORA_DISCORD_LISTENER_TOKEN`. Discord system messages (joins, pins…) are ignored.
- **Telegram:** a main bot long-polls the chats turned on; agents post through their own Telegram bot when it is in the chat, otherwise through the main bot with their name in bold.
- **The panel:** the Salotto and one private chat per agent, always available, archived like the other channels so memory sees them.

## Their computers

- Each agent owns a desktop container (XFCE, Chromium, terminal; passwordless sudo) that the owner can watch and take over from the panel.
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

Each agent picks its model and a reasoning level (automatic, low, medium, high); providers are interchangeable and use the owner's existing subscriptions:

| Prefix | Provider | How |
|---|---|---|
| `claude/` | Claude (Claude Code subscription) | `claude -p --output-format stream-json` with its own tools off (`--tools ""`), `--effort`; Cora's tools over a per-run MCP server |
| `codex/` | ChatGPT (Codex subscription) | `codex exec --json` read-only, shell/unified-exec/browser/computer-use/subagents disabled, `model_reasoning_effort`; Cora's tools over MCP |
| `ollama/` | Ollama Cloud | `https://ollama.com` with `CORA_OLLAMA_API_KEY`, `think`; Cora runs the tool loop |

The MCP server (`src/mcp-server.js`) forwards tool calls to a loopback bridge (`src/bridge.js`) with a random port and token per run. Every agent also receives the owner's personal agent instructions (`~/.agents/AGENTS.md`, override with `CORA_OWNER_INSTRUCTIONS`).

## Run

Requirements: Node ≥ 22.13, Docker, `hush` (agent-blind secrets CLI), and the `claude` / `codex` CLIs logged in for the subscription providers. No npm dependencies.

```bash
docker build -t cora-box:latest box     # the agents' desktop image
bin/run.sh                              # injects the hush secrets that exist, then starts src/main.js
```

Secrets come only from hush: `CORA_ADMIN_PASSWORD` (panel password), `CORA_SESSION_KEY` (cookie signing), `CORA_VAPID_KEY` (Web Push), `CORA_OLLAMA_API_KEY`, `CORA_TELEGRAM_BOT_TOKEN`, an optional `CORA_DISCORD_LISTENER_TOKEN`, and one `CORA_BOT_<NAME>` / `CORA_TG_BOT_<NAME>` per agent bot (bot tokens are pasted in the panel, checked with Discord or Telegram, and stored in hush without touching a command line or a clear file).

Environment: `PORT` (default 4370), `CORA_LISTEN_HOST` (default 127.0.0.1), `CORA_HOME` (default `~/.cora`), `CORA_PUBLIC_URL` (the VAPID subject), `OLLAMA_URL`, `CORA_CLAUDE_BIN`, `CORA_CODEX_BIN`, `CORA_TZ` (default Europe/Rome).

`deploy/macos.sh` deploys to a Mac over SSH (`CORA_DEPLOY_HOST=user@host`) as the LaunchAgent in `deploy/org.turinglabs.cora.plist`; put the panel behind your own HTTPS tunnel or reverse proxy.

## Test

```bash
npm test
```

The integration tests run the whole service against stand-ins for Discord (REST + Gateway WebSocket), Telegram (Bot API), Ollama, the `claude` / `codex` CLIs (driving the real MCP server), `docker`, and a Web Push service that decrypts what it receives.

## License

MIT
