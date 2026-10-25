# cora — agent notes

Always-on Discord agents with personalities, layered memory, routines and their own Docker desktops. See `README.md` for the architecture and `DESIGN.md` for the panel's design system (read it before any UI change).

## Layout

- `src/main.js` wires everything; `startCora(overrides)` is what the tests start.
- `src/discord.js` persistent Gateway (heartbeat, resume, reconnect) + REST + per-channel `cora` webhooks; the same class runs each agent's own bot (presence-only intents, `say`, `syncProfile`).
- `src/agent-bots.js` one connection per agent with a `CORA_BOT_<NAME>` token: posting, typing, mentions and profile sync as that agent; listening stays on the main bot.
- `src/channels.js` where the cora lives: Discord or Telegram (`settings.transport`), one at a time, plus the panel rooms; `info(id)` gives prompts the `where`/`place` of a channel. Telegram channel ids are `tg:<chat id>`.
- `src/telegram.js` Bot API client (getUpdates long polling, HTML messages, files); `src/telegram-bots.js` agents' own Telegram bots (`CORA_TG_BOT_<NAME>`, send only).
- `src/secrets.js` writes a token pasted in the panel into hush (`hush box seal` to the machine's own key piped into `hush box open`). The CLIs never inherit `CORA_BOT_*`.
- `src/orchestrator.js` who answers and when: mentions force a reply, chattiness gates the rest, `maxAgentTurns` budget stops agent-to-agent loops, only `settings.guildIds` are heard.
- `src/brain.js` prompts and the tool loop; `sleep()` is the nightly memory consolidation.
- `src/rooms.js` the panel's chat rooms (`web` salotto, `web-<agentId>` private); `src/traces.js` records each turn's reasoning (steps streamed over SSE, saved in the `traces` table).
- `src/memory.js` retrieval (pinned + FTS5 relevance + recent). `src/store.js` is the only place that touches SQLite (`~/.cora/cora.db`).
- `src/llm.js` providers: `claude/` and `codex/` run the owner's subscription CLIs (`src/cli.js`), which call cora's tools through `src/mcp-server.js` → `src/bridge.js`; `ollama/` is Ollama Cloud with a key and uses cora's own tool loop. No API-key providers for Claude/ChatGPT: the owner wants the subscriptions.
- `src/tools.js` agent tools. Desktop tools only when an owner started the conversation or in routines; memory tools always.
- `src/box.js` docker CLI for the desktops (`cora-box-<agentId>`, volumes `cora-home-<agentId>` and `cora-sys-<agentId>` for Tailscale state and SSH host keys, noVNC on a random 127.0.0.1 port, sshd on the agent's fixed `sshPort`); outdated boxes are recreated when cora starts or from «Aggiorna».
- `src/push.js` Web Push (VAPID + aes128gcm) to the owner's devices; agents' `notify` and `ask_owner` tools, requests live in the private panel rooms.
- `src/web.js` panel API, SSE, password login (HMAC cookie, `X-Cora` header + Origin check on writes), authenticated noVNC proxy at `/box/<agentId>/`.
- `web/` vanilla JS panel, no build. `box/` the desktop image (Debian, XFCE, Chromium, x11vnc, noVNC).

## Rules

- Secrets only through hush (`bin/run.sh`). Discord: cora listens through an agent's own bot with the Message Content intent, or an optional dedicated `CORA_DISCORD_LISTENER_TOKEN`; it never borrows another tool's bot. Telegram: `CORA_TELEGRAM_BOT_TOKEN` and `CORA_TG_BOT_<NAME>`, stored from the panel through `src/secrets.js`. Bot API URLs carry the token: never log them.
- The agents are not tied to a platform (the owner asked): prompts say where they are right now, never that they "live on Discord".
- Bots can be in servers the agents must not hear: only `settings.guildIds` are heard, keep everything else out of it.
- No runtime dependencies; add any through the mcaifee gate.
- The CLIs must never get tools that act on the host: Claude runs with `--tools ""`, Codex with `-s read-only` and shell/unified_exec/browser/computer-use/multi_agent disabled (its code mode stays on because MCP calls go through it; verified it cannot read host files). Re-verify with a live probe after CLI upgrades.
- Agents get the owner's `~/.agents/AGENTS.md` in their system prompt (the owner asked for it explicitly). Do not strip it.
- Every behaviour change needs an integration test in `test/cora.test.js` (stand-in Discord, Ollama and docker in `test/helpers.js`).
- UI copy is written in Italian and translated through `web/i18n.js` (English); content written by people or agents is wrapped in `raw()` and never translated. Code, comments and docs are English.

## Deployment

Runs on a macOS host as the LaunchAgent `org.turinglabs.cora` from `~/Services/cora`, listening on 127.0.0.1:4370; put it behind your own HTTPS tunnel or reverse proxy. Deploy with `CORA_DEPLOY_HOST=user@host deploy/macos.sh` (it rebuilds the desktop image only when `box/` changed).
