import { basename } from "node:path";
import { bm25 } from "./memory.js";
import { SHARED } from "./store.js";

const XDOTOOL_BUTTON = { click: "1", double_click: "1", right_click: "3", middle_click: "2" };

/** Tools every agent has, also without its computer. */
export const MEMORY_TOOLS = new Set(["say", "list_channels", "remember", "forget", "recall", "update_core", "notify", "ask_owner", "brain_search", "brain_page", "brain_note"]);

/**
 * What an agent may do about its own life without the owner's computer: speak,
 * remember, and run its own routines. Its routines are its own — creating,
 * changing, pausing or deleting one touches nothing else — so they are not
 * locked behind the computer, which only opens when the owner is the one asking.
 */
export const OWN_TOOLS = new Set([...MEMORY_TOOLS, "list_routines", "set_routine", "set_reminder", "delete_routine", "routine_history", "artifact_folders", "artifact_log", "secret_list", "secret_request"]);

export const TOOL_DEFS = [
  {
    name: "shell",
    description: "Run a bash command on your own Linux computer (Debian, user 'agent' with passwordless sudo, home /home/agent, DISPLAY=:1 so GUI apps open on your desktop). This Cora MCP tool runs on your separate desktop: it can write files and call authorized remote connectors even when the local Codex CLI host is read-only. Respect the current task's authorization and actual connector permissions. Use it to browse with curl, write and run scripts (node, python3), manage files, install packages. Long-running GUI apps must be started in the background (nohup ... &).",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The bash command to run" },
        timeout_seconds: { type: "number", description: "Max seconds to wait (default 120, max 600)" },
      },
      required: ["command"],
    },
  },
  {
    name: "screenshot",
    description: "Look at your desktop screen (1280x800). Returns an image when your model can see images.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "computer",
    description: "Use mouse and keyboard on your desktop (1280x800 pixels, origin top-left). Take a screenshot first to find coordinates.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["click", "double_click", "right_click", "middle_click", "move", "drag", "type", "key", "scroll"] },
        x: { type: "number" },
        y: { type: "number" },
        to_x: { type: "number", description: "drag destination x" },
        to_y: { type: "number", description: "drag destination y" },
        text: { type: "string", description: "text to type (action=type)" },
        keys: { type: "string", description: "xdotool key combo for action=key, e.g. 'ctrl+l', 'Return', 'ctrl+shift+t'" },
        direction: { type: "string", enum: ["up", "down"], description: "scroll direction" },
        amount: { type: "number", description: "scroll clicks (default 5)" },
      },
      required: ["action"],
    },
  },
  {
    name: "browser",
    description: "Read the Chromium on your desktop: the page's text or elements, what it fetched, which sessions it holds. The screenshot shows you the pixels; this tells you the page. Values of cookies and storage are never returned.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["text", "query", "html", "eval", "cookies", "storage", "network", "targets", "goto"] },
        argument: { type: "string", description: "CSS selector (query, html), JavaScript (eval), url (goto)" },
      },
      required: ["action"],
    },
  },
  {
    name: "open_url",
    description: "Open a URL in Chromium on your desktop (the owner can watch and take over from the desktop).",
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "say",
    description: "Write directly through Cora. Without channel_id, post in this conversation; with channel_id, post in an authorized channel from list_channels. Address a colleague or a person as @Name, with the name the chat shows: Cora turns it into their real mention (an agent's when its bot can read that channel, a person's when they wrote or were tagged on this server). No grog CLI, shell command, installation or extra login is needed. Your final reply is posted in this conversation anyway: here, use say only for a short first note before working and for progress; with channel_id, for replies and reports in another channel. Check the returned delivery result; do not post the same result again in your final reply.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        channel_id: { type: "string", description: "optional destination id from list_channels; omit for this conversation" },
        voice: { type: "boolean", description: "true: the same words also go out as a voice message in your own voice (Soniox), after the text. A voice message you received is already answered out loud: use this when someone asks for a voice message or when hearing it helps" },
      },
      required: ["text"],
    },
  },
  {
    name: "brain_search",
    description: "Search the company brain: the pages on clients, projects, people, decisions and procedures that the librarian keeps with their sources, and what was said in the chats, by words and by meaning. Look here before asking the owner something the company may already know.",
    parameters: { type: "object", properties: { query: { type: "string", description: "what you want to know, in plain words" } }, required: ["query"] },
  },
  {
    name: "brain_page",
    description: "Read one company brain page whole: its text, when it last changed, whether the owner has reviewed it, and the sources of its latest change.",
    parameters: { type: "object", properties: { slug: { type: "string", description: "the page's slug, as brain_search or the turn's context give it" } }, required: ["slug"] },
  },
  {
    name: "brain_note",
    description: "Tell the librarian something the whole company should know: a decision, a client's preference, who does what, a deadline. It goes into the company brain tonight, with you as its source. Your own memory stays remember.",
    parameters: { type: "object", properties: { text: { type: "string", description: "the fact, short and specific, with who decided and when if you know" } }, required: ["text"] },
  },
  {
    name: "list_channels",
    description: "List the channels you can write to directly with say(text, channel_id): id, name and platform. Use this to find #social or another destination instead of looking for grog or asking for credentials. The current conversation works with say(text).",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "remember",
    description: "Save a durable fact to your long-term memory (about the owner, the others, yourself, ongoing projects, decisions). One short, specific fact per call. Use shared=true for facts every agent should know (about the owner, the house rules, common projects). Do not save trivia or things already in your memory.",
    parameters: {
      type: "object",
      properties: {
        fact: { type: "string" },
        shared: { type: "boolean", description: "true = every agent will know it (with a company brain it becomes a note for the librarian, like brain_note)" },
      },
      required: ["fact"],
    },
  },
  {
    name: "forget",
    description: "Delete a memory by its id (shown in brackets) when it is wrong or obsolete.",
    parameters: {
      type: "object",
      properties: { memory_id: { type: "string" } },
      required: ["memory_id"],
    },
  },
  {
    name: "recall",
    description: "Search everything you know beyond what you currently see: all your memories, past conversations in the channels (also months ago) and your diary. Use it when someone refers to something said before, or when you are not sure you know something.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "keywords to look for" } },
      required: ["query"],
    },
  },
  {
    name: "update_core",
    description: "Rewrite your core card: the compact notes that are always in your mind (who the owner is, your relationships, what is going on). Max 3000 characters. Keep everything that is still true from the current card; this replaces it entirely.",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "list_routines",
    description: "List your active or paused routines and one-time reminders: id, kind, cron or due date, where you post, last result and the start of each prompt. Pass id to read one of them whole, with its full prompt, before you change it: edit that text and send it back with set_routine or set_reminder, keeping everything you are not asked to change. Use routine_history for past runs and archived tasks.",
    parameters: { type: "object", properties: { id: { type: "string", description: "one routine or reminder to read in full" } } },
  },
  {
    name: "set_routine",
    description: "Create one of your routines, or change it when you pass its id. A routine is a task you run on your own on a cron schedule (minute hour day month weekday, Europe/Rome), with your computer, posting the result. Without a channel it posts where you are talking now. Do it when the owner asks; describe the task in prompt as instructions to yourself.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "the routine to change; leave out to create one" },
        name: { type: "string" },
        schedule: { type: "string", description: "cron, e.g. \"0 9 * * 1-5\" = weekdays at 9:00" },
        prompt: { type: "string", description: "what to do each time" },
        channel_id: { type: "string", description: "where to post; default: this conversation" },
        enabled: { type: "boolean" },
      },
    },
  },
  {
    name: "set_reminder",
    description: "Create or change your own one-time reminder. It runs once at run_at, verifies success and archives itself only on success. Failed or blocked attempts stay visible and are never blindly repeated. Use an ISO 8601 timestamp with timezone, e.g. 2026-12-10T09:00:00+01:00. Defaults to this conversation. Check routine_history before repeating an action that may already have succeeded.",
    parameters: { type: "object", properties: {
      id: { type: "string", description: "existing reminder id; omit to create" }, name: { type: "string" },
      run_at: { type: "string", description: "one exact ISO 8601 date/time with timezone" }, prompt: { type: "string", description: "task and how to check success" },
      channel_id: { type: "string" }, enabled: { type: "boolean" },
    } },
  },
  {
    name: "routine_history",
    description: "Read your persistent routine/reminder execution history or archived task definitions. Includes results, verification, dates and trace ids, even after a task was archived. Each run keeps the prompt it ran with, so an older version of a prompt can be read back. Search before repeating past work. Paginate with offset.",
    parameters: { type: "object", properties: {
      query: { type: "string" }, kind: { type: "string", enum: ["routine", "reminder"] }, archived: { type: "boolean", description: "true for archived definitions, false for execution history" },
      routine_id: { type: "string", description: "only this routine or reminder" },
      full: { type: "boolean", description: "whole prompts and results instead of their first part (at most 3 items)" },
      limit: { type: "integer", minimum: 1, maximum: 50 }, offset: { type: "integer", minimum: 0 },
    } },
  },
  {
    name: "delete_routine",
    description: "Cancel and archive one of your routines or reminders by id, preserving its history.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "notify",
    description: "Send a push notification to the owner's phone (the cora app). Only for things that deserve attention now: a long task you finished, something urgent, a reminder they asked for. Never for normal replies, which they read anyway. At most one a minute.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "what to tell them, one or two short sentences" },
        title: { type: "string", description: "optional short title" },
      },
      required: ["message"],
    },
  },
  {
    name: "ask_owner",
    description: "Ask the owner something that needs their answer or decision: permission, a choice, missing information. The question is posted in this conversation, addressed to the owner (it reaches their phone), and their answer comes back to you here later: do not wait for it and do not repeat the question, just stop. Write the question so it makes sense on its own, and offer up to 4 short choices when they fit.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string" },
        choices: { type: "array", items: { type: "string" }, description: "optional quick answers, e.g. [\"Sì\", \"No\"]" },
      },
      required: ["question"],
    },
  },
  {
    name: "share_file",
    description: "Deliver an authorized file from /home/agent/work on your desktop directly to another Cora agent's desktop. Supply the colleague's name or agent id. No SSH, Tailscale or login is required. Max 8 MB; creates a separate immutable copy in their work/shared folder and verifies SHA-256. Only share files and recipients authorized by the current task. The receipt contains the recipient's path, hash and size, never the contents; use say with @Name to tell them where the file is.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "absolute file path within /home/agent/work" }, agent: { type: "string", description: "recipient agent name or id" } },
      required: ["path", "agent"],
    },
  },
  {
    name: "artifact_folders",
    description: "List the artifact folders on the Cora server: where the files, sites and anything else you make on your computer are kept, versioned and served from; what goes in each, whether each push waits for a review, and whether you may push there. Look here (and in the brain) before pushing anything.",
    parameters: { type: "object", properties: { query: { type: "string", description: "optional words to filter by path, title or what goes in the folder" } } },
  },
  {
    name: "artifact_log",
    description: "The history of one artifact folder, like git log: its commits, who made them, which one is served, which wait for review, and a reviewer's notes on a rejected one.",
    parameters: { type: "object", properties: { folder: { type: "string", description: "the folder path, e.g. clienti/acme/report-q3" }, limit: { type: "number" } }, required: ["folder"] },
  },
  {
    name: "artifact_push",
    description: "Upload a file or a folder from /home/agent/work to an artifact folder on the Cora server as a commit, like git: only files the server does not have yet travel. In most folders the commit is PROPOSED and is served only after the owner or a reviewer approves it: never say it is published unless the receipt says PUBLISHED. If the folder does not exist yet, do not choose one yourself: ask the person who asked you which folder to use, proposing a path (e.g. clienti/acme/sito) and what goes in it, and push with create only after they confirm. Files that look like secrets (.env, keys, tokens) are refused.",
    parameters: {
      type: "object",
      properties: {
        folder: { type: "string", description: "artifact folder path: lowercase words and dashes separated by /, e.g. clienti/acme/report-q3" },
        path: { type: "string", description: "absolute path of the file or folder on your computer, inside /home/agent/work" },
        message: { type: "string", description: "the commit message: what changed and why, in one line" },
        to: { type: "string", description: "optional subfolder inside the artifact folder to put it in" },
        mirror: { type: "boolean", description: "also delete the files under `to` that are not in what you push (default false: add and overwrite only)" },
        create: {
          type: "object",
          description: "only when the person confirmed a new folder: its title, what goes in it, and kind (files or site)",
          properties: { title: { type: "string" }, description: { type: "string" }, kind: { type: "string", enum: ["files", "site"] } },
          required: ["description"],
        },
      },
      required: ["folder", "path", "message"],
    },
  },
  {
    name: "artifact_pull",
    description: "Copy an artifact folder (the version it serves, or a given commit) onto your computer under /home/agent/work/artifacts/<folder>, to continue that work; push that directory back with artifact_push when you are done.",
    parameters: {
      type: "object",
      properties: { folder: { type: "string" }, commit: { type: "string", description: "optional commit id; default the served version" }, overwrite: { type: "boolean", description: "replace what is already in that directory" } },
      required: ["folder"],
    },
  },
  {
    name: "artifact_share_request",
    description: "Ask the owner for a link that opens an artifact folder to specific people (their emails, or a company domain): it is created switched off, and only the owner or a folder reviewer turns it on. You can only ask for a link for named people: making a link public or putting a password on it is the owner's choice, in the panel. Use it when someone asked you to share a folder, and tell them the owner has to approve it.",
    parameters: {
      type: "object",
      properties: {
        folder: { type: "string" },
        label: { type: "string", description: "the link's name: lowercase letters, digits and dashes, e.g. report-acme" },
        emails: { type: "array", items: { type: "string" } },
        domains: { type: "array", items: { type: "string" }, description: "company domains, e.g. acme.com (never gmail.com and the like)" },
        reason: { type: "string", description: "who asked for it and why, in one line" },
      },
      required: ["folder", "label", "reason"],
    },
  },
  {
    name: "secret_list",
    description: "List the secrets in Cora's vault by name: what each is for and whether you may use it. You never see a value. To use one on your computer, put it in your hush with secret_import, then run commands with `hush run --name NAME --env VAR --redact -- command`.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "secret_request",
    description: "Get a one-time link where a person puts in a secret you need (an API key, a password, a token), so it never passes through the chat: send them the link and say so. When they submit it, it is stored in Cora's vault under the name you chose and you may use it with secret_import. Never ask anyone to paste a secret in a message.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "the secret's name: capitals, digits and underscores, e.g. ACME_STRIPE_KEY" },
        description: { type: "string", description: "what it is and what it is for, in one line: the person reads it on the page" },
      },
      required: ["name", "description"],
    },
  },
  {
    name: "secret_import",
    description: "Put a secret from Cora's vault into the hush on your computer, by name, without seeing it. Then use it only through `hush run --name NAME --env VAR --redact -- command` in shell. Never print it, never write it to a file, never pass it on.",
    parameters: { type: "object", properties: { name: { type: "string" }, as: { type: "string", description: "optional name in your hush, if a tool expects another" } }, required: ["name"] },
  },
  {
    name: "secret_send",
    description: "Ask the owner to send a secret from the vault to someone, through a link that opens a set number of times. It is created switched off: only the owner approves it and forwards the link. Use it only when someone authorized asked for it, and say the owner has to approve.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" }, to: { type: "string", description: "who should receive it" }, reason: { type: "string" }, views: { type: "number" }, days: { type: "number" } },
      required: ["name", "to", "reason"],
    },
  },
  {
    name: "send_file",
    description: "Post a file from your computer to the current Discord channel (an image, a PDF, a CSV, ...). Max 8 MB.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "absolute path on your computer" },
        caption: { type: "string" },
      },
      required: ["path"],
    },
  },
];

const MIME = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  pdf: "application/pdf", csv: "text/csv", txt: "text/plain", md: "text/markdown", json: "application/json",
  html: "text/html", zip: "application/zip", mp4: "video/mp4", mp3: "audio/mpeg",
};

function num(value, fallback = 0) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? number : fallback;
}

export function summarizeArgs(name, args) {
  if (name === "shell") return String(args.command || "").slice(0, 300);
  if (name === "computer") return [args.action, args.x, args.y, args.text ? JSON.stringify(String(args.text).slice(0, 60)) : "", args.keys || ""].filter((part) => part !== undefined && part !== "").join(" ");
  if (name === "open_url") return String(args.url || "").slice(0, 300);
  if (name === "remember") return `${args.shared ? "(condiviso) " : ""}${String(args.fact || "").slice(0, 300)}`;
  if (name === "recall") return String(args.query || "").slice(0, 200);
  if (name === "update_core") return `${String(args.text || "").length} caratteri`;
  if (name === "forget") return String(args.memory_id || "");
  if (name === "send_file") return String(args.path || "");
  if (name === "share_file") return `${String(args.path || "")} → ${String(args.agent || "")}`;
  if (name === "artifact_push") return `${String(args.path || "")} → ${String(args.folder || "")}${args.create ? " (nuova)" : ""}`;
  if (name === "artifact_pull" || name === "artifact_log") return String(args.folder || "");
  if (name === "artifact_folders") return String(args.query || "");
  if (name === "artifact_share_request") return `${String(args.folder || "")} → ${String(args.label || "")}`;
  if (name === "secret_import" || name === "secret_request" || name === "secret_send") return String(args.name || "");
  if (name === "notify") return String(args.message || "").slice(0, 200);
  if (name === "say") return String(args.text || "").slice(0, 200);
  if (name === "brain_search") return String(args.query || "").slice(0, 200);
  if (name === "brain_page") return String(args.slug || "");
  if (name === "brain_note") return String(args.text || "").slice(0, 200);
  if (name === "set_routine" || name === "set_reminder") return `${args.id ? `${args.id} ` : ""}${args.name || ""} ${args.schedule || args.run_at || ""}`.trim();
  if (name === "routine_history") return String(args.query || "").slice(0, 200);
  if (name === "delete_routine") return String(args.id || "");
  if (name === "ask_owner") return String(args.question || "").slice(0, 200);
  return "";
}

/** Execute one tool call for an agent. Returns {text, image?}. Errors come back as text for the model. */
export async function executeTool(call, ctx) {
  const { agent, boxes, store, channelId, postFile } = ctx;
  const args = call.args || {};
  try {
    switch (call.name) {
      case "shell": {
        if (!String(args.command || "").trim()) return { text: "error: empty command" };
        await boxes.ensure(agent);
        const timeoutMs = Math.min(600, Math.max(1, Number(args.timeout_seconds) || 120)) * 1000;
        const result = await boxes.shell(agent.id, String(args.command), { timeoutMs });
        const status = result.timedOut ? `timed out after ${timeoutMs / 1000}s` : `exit ${result.code}`;
        return { text: `[${status}]\n${result.output || "(no output)"}` };
      }
      case "screenshot": {
        await boxes.ensure(agent);
        const image = await boxes.screenshot(agent.id);
        return { text: "Screenshot of your desktop (1280x800).", image: image.toString("base64"), raw: image };
      }
      case "computer": {
        await boxes.ensure(agent);
        const action = String(args.action || "");
        const x = num(args.x);
        const y = num(args.y);
        let argv;
        if (XDOTOOL_BUTTON[action]) {
          argv = ["xdotool", "mousemove", String(x), String(y), "click"];
          if (action === "double_click") argv.push("--repeat", "2", "--delay", "120");
          argv.push(XDOTOOL_BUTTON[action]);
        } else if (action === "move") {
          argv = ["xdotool", "mousemove", String(x), String(y)];
        } else if (action === "drag") {
          argv = ["xdotool", "mousemove", String(x), String(y), "mousedown", "1", "mousemove", String(num(args.to_x)), String(num(args.to_y)), "mouseup", "1"];
        } else if (action === "type") {
          argv = ["xdotool", "type", "--delay", "25", "--", String(args.text || "")];
        } else if (action === "key") {
          const keys = String(args.keys || "").split(/\s+/).filter(Boolean);
          if (!keys.length) return { text: "error: keys is required" };
          argv = ["xdotool", "key", "--", ...keys];
        } else if (action === "scroll") {
          const button = args.direction === "up" ? "4" : "5";
          argv = ["xdotool", "mousemove", String(x), String(y), "click", "--repeat", String(Math.min(30, Math.max(1, num(args.amount, 5)))), button];
        } else {
          return { text: `error: unknown action ${action}` };
        }
        const result = await boxes.run(agent.id, argv);
        return { text: result.code === 0 ? `ok (${action})` : `error: ${result.output}` };
      }
      case "browser": {
        await boxes.ensure(agent);
        const action = String(args.action || "");
        try {
          const result = await boxes.browser(agent.id, action, String(args.argument || ""));
          return { text: JSON.stringify(result).slice(0, 60000) };
        } catch (error) {
          return { text: `error: ${error.message}` };
        }
      }
      case "open_url": {
        const url = String(args.url || "");
        if (!/^https?:\/\//i.test(url)) return { text: "error: url must start with http:// or https://" };
        await boxes.ensure(agent);
        const quoted = `'${url.replace(/'/g, "'\\''")}'`;
        await boxes.shell(agent.id, `nohup chromium ${quoted} >/tmp/chromium.log 2>&1 &`, { timeoutMs: 15000 });
        return { text: `opened ${url} in Chromium. Take a screenshot in a few seconds to see it.` };
      }
      case "remember": {
        // What everyone should know belongs to the company brain, when the instance has one.
        if (args.shared && ctx.companyBrain?.enabled) {
          const text = String(args.fact || "").trim();
          if (!text) return { text: "error: empty fact" };
          await ctx.companyBrain.note({ text, agentId: agent.id, author: agent.name, channelId });
          ctx.log?.({ type: "memory", agentId: agent.id, text: `(per il brain) ${text.slice(0, 300)}` });
          return { text: "noted for the company brain (shared facts go there): the librarian adds it at its next run" };
        }
        const key = args.shared ? SHARED : agent.id;
        const memory = store.addMemory(key, String(args.fact || ""), "agent", { by: agent.name });
        ctx.log?.({ type: "memory", agentId: agent.id, text: `${args.shared ? "(condiviso) " : ""}${memory.text}` });
        return { text: `saved [${memory.id}]${args.shared ? " (shared)" : ""}` };
      }
      case "forget": {
        const found = store.findMemory(String(args.memory_id || ""));
        if (!found || (found.key !== agent.id && found.key !== SHARED)) return { text: "error: no memory with that id" };
        store.deleteMemory(found.key, found.memory.id);
        ctx.log?.({ type: "memory", agentId: agent.id, text: `dimenticato: ${found.memory.text}` });
        return { text: "deleted" };
      }
      case "recall": {
        const query = String(args.query || "");
        if (!query.trim()) return { text: "error: empty query" };
        const facts = ctx.memory.searchFacts(agent.id, query, 10).map((doc) => ({ doc }));
        const messages = ctx.memory.searchArchive(ctx.channelIds || [], query, { limit: 12 });
        const diary = bm25(store.diary(agent.id), query, (item) => item.text, { limit: 3 });
        const lines = [];
        lines.push("Memories:", ...(facts.length ? facts.map(({ doc }) => `- [${doc.id}] ${doc.text}${doc.scope === "shared" ? " (shared)" : ""}`) : ["- none"]));
        lines.push("Past messages:", ...(messages.length ? messages.map((item) => `- [${ctx.formatWhen(item.at)} ${ctx.channelLabel(item.channelId)}] ${item.authorName}: ${item.content.slice(0, 400)}`) : ["- none"]));
        if (diary.length) lines.push("Diary:", ...diary.map(({ doc }) => `- ${ctx.formatWhen(Date.parse(doc.createdAt))}: ${doc.text.slice(0, 600)}`));
        return { text: lines.join("\n") };
      }
      case "update_core": {
        const text = String(args.text || "").trim();
        if (!text) return { text: "error: empty card" };
        if (text.length > 3000) return { text: `error: the card is ${text.length} characters, max 3000` };
        store.setCore(agent.id, text, "agent");
        ctx.log?.({ type: "memory", agentId: agent.id, text: "ha aggiornato la sua scheda" });
        return { text: "core card updated" };
      }
      case "notify": {
        const message = String(args.message || "").trim();
        if (!message) return { text: "error: empty message" };
        if (!ctx.push) return { text: "error: notifications are not available" };
        const result = await ctx.push.fromAgent(agent, { title: String(args.title || "").trim(), message });
        if (result.error) return { text: `error: ${result.error}` };
        ctx.log?.({ type: "notify", agentId: agent.id, text: message.slice(0, 200) });
        return { text: `notification sent to ${result.sent} device(s)` };
      }
      case "list_routines": {
        const routines = store.routines(agent.id);
        const line = (routine) => `[${routine.id}] ${routine.kind === "reminder" ? "reminder · " : ""}${routine.name} · ${routine.runAt || routine.schedule} · ${ctx.channelLabel(routine.channelId)} · ${routine.enabled ? "on" : "paused"}${routine.lastRunAt ? ` · last ${ctx.formatWhen(Date.parse(routine.lastRunAt))} ${routine.lastStatus}` : ""}`;
        // One task asked by id comes back whole: an agent rewriting a prompt it has only partly seen loses the rest.
        const id = String(args.id || "").trim();
        if (id) {
          const routine = routines.find((item) => item.id === id);
          if (!routine) return { text: "error: you have no routine with that id" };
          return { text: `${line(routine)}\nprompt (${routine.prompt.length} characters, complete):\n${routine.prompt}` };
        }
        if (!routines.length) return { text: "you have no routines" };
        const PREVIEW = 300;
        return { text: routines.map((routine) => `- ${line(routine)}\n  ${routine.prompt.slice(0, PREVIEW)}${routine.prompt.length > PREVIEW ? ` … (+${routine.prompt.length - PREVIEW} characters: list_routines with id "${routine.id}" shows all of it)` : ""}`).join("\n") };
      }
      case "routine_history": {
        const full = Boolean(args.full);
        const options = { agentId: agent.id, routineId: String(args.routine_id || "").trim(), kind: ["routine", "reminder"].includes(args.kind) ? args.kind : "", query: String(args.query || ""), limit: full ? Math.min(Number(args.limit) || 3, 3) : args.limit || 10, offset: args.offset || 0 };
        const page = args.archived ? store.routineArchive(options) : store.routineHistory(options);
        const cut = (text, max) => (full || !text || text.length <= max ? text : `${text.slice(0, max)} … (+${text.length - max} characters: ask again with full)`);
        return { text: JSON.stringify({ ...page, items: page.items.map((item) => ({ ...item, prompt: cut(item.prompt, 500), output: cut(item.output, 2000), lastOutput: cut(item.lastOutput, 2000) })) }) };
      }
      case "set_routine":
      case "set_reminder": {
        const kind = call.name === "set_reminder" ? "reminder" : "routine";
        const id = String(args.id || "").trim();
        const existing = id ? store.routine(id) : null;
        if (id && (!existing || existing.agentId !== agent.id)) return { text: "error: you have no routine with that id" };
        if (existing && (existing.kind || "routine") !== kind) return { text: `error: use set_${existing.kind || "routine"} to change this task` };
        const input = { kind };
        for (const key of ["name", "schedule", "prompt"]) if (args[key] !== undefined) input[key] = String(args[key]);
        if (args.enabled !== undefined) input.enabled = Boolean(args.enabled);
        if (kind === "reminder" && args.run_at !== undefined) input.runAt = String(args.run_at);
        input.channelId = String(args.channel_id || existing?.channelId || channelId || "");
        if (input.schedule !== undefined) {
          const problem = ctx.checkSchedule?.(input.schedule);
          if (problem) return { text: `error: schedule: ${problem}` };
        }
        const routine = existing ? store.updateRoutine(existing.id, input) : store.createRoutine(agent.id, input);
        ctx.log?.({ type: "routine", agentId: agent.id, text: `${existing ? "ha cambiato" : "ha creato"} ${kind} «${routine.name}» (${routine.runAt || routine.schedule})` });
        return { text: `${existing ? "updated" : "created"} [${routine.id}] ${routine.name} · ${routine.runAt || routine.schedule} · ${ctx.channelLabel(routine.channelId)} · ${routine.enabled ? "on" : "paused"}` };
      }
      case "delete_routine": {
        const routine = store.routine(String(args.id || ""));
        if (!routine || routine.agentId !== agent.id) return { text: "error: you have no routine with that id" };
        store.deleteRoutine(routine.id);
        ctx.log?.({ type: "routine", agentId: agent.id, text: `ha eliminato la routine «${routine.name}»` });
        return { text: "archived; its execution history remains available with routine_history" };
      }
      case "list_channels": return { text: JSON.stringify(ctx.postingChannels || []) };
      case "brain_search": {
        if (!ctx.companyBrain?.enabled) return { text: "error: this instance has no company brain" };
        const query = String(args.query || "").trim();
        if (!query) return { text: "error: say what to look for" };
        const [pages, chats] = await Promise.all([ctx.companyBrain.search(query, { limit: 6 }), ctx.companyBrain.searchArchive(query, { limit: 5 })]);
        return { text: JSON.stringify({
          pages: pages.map((page) => ({ slug: page.slug, title: page.title, kind: page.kind, summary: page.summary, updatedAt: page.updatedAt, reviewed: !page.pending })),
          chats: chats.map((chat) => ({ at: chat.at, author: chat.author, channel: ctx.channelLabel ? ctx.channelLabel(chat.channelId) : chat.channelId, text: chat.text.slice(0, 500) })),
        }) };
      }
      case "brain_page": {
        if (!ctx.companyBrain?.enabled) return { text: "error: this instance has no company brain" };
        const page = await ctx.companyBrain.page(String(args.slug || ""));
        if (!page || page.status !== "live") return { text: "error: no such page; find it with brain_search" };
        const latest = page.revisions[0];
        return { text: JSON.stringify({
          slug: page.slug, title: page.title, kind: page.kind, summary: page.summary, body: page.body, updatedAt: page.updatedAt, reviewed: !page.pending,
          sources: (latest?.sources || []).slice(0, 6).map((source) => ({ type: source.type, author: source.author, channel: source.channel, at: source.at, quote: source.quote })),
        }) };
      }
      case "brain_note": {
        if (!ctx.companyBrain?.enabled) return { text: "error: this instance has no company brain" };
        const text = String(args.text || "").trim();
        if (!text) return { text: "error: empty note" };
        await ctx.companyBrain.note({ text, agentId: agent.id, author: agent.name, channelId });
        return { text: "noted for the librarian: it goes into the company brain at its next run, and the owner sees it in the morning review" };
      }
      case "say": {
        const text = String(args.text || "").trim();
        if (!text) return { text: "error: empty message" };
        if (!ctx.say) return { text: "error: there is no conversation to post to right now" };
        const target = String(args.channel_id || channelId || "");
        if (target !== channelId && !ctx.postingChannels?.some((channel) => channel.id === target)) return { text: "error: destination not authorized; choose a channel from list_channels" };
        const sent = await ctx.say(text.slice(0, 4000), target, { voice: args.voice === true });
        const messages = Array.isArray(sent) ? sent : [];
        const receipt = {
          channel_id: target,
          channel_name: ctx.postingChannels?.find((channel) => channel.id === target)?.name || "",
          message_ids: messages.map((item) => String(item.id || item.message_id || "")).filter(Boolean),
          mentions: [...new Set(messages.flatMap((item) => [...String(item.content || "").matchAll(/<@!?(\d+)>/g)].map((match) => match[1])))],
        };
        if (args.voice === true) receipt.voice = sent?.voice?.messages ? "sent" : `not sent: ${sent?.voice?.error || "unavailable"}`;
        const status = target === channelId ? "posted in this conversation. Your final reply is posted here too: if there is work left, keep working and write only what is new; if this message already says it all, end with just PASS" : `posted directly to ${target}; do not duplicate this report in your final reply`;
        return { text: `${status}\nCora delivery receipt: ${JSON.stringify(receipt)}` };
      }
      case "ask_owner": {
        if (!ctx.ask) return { text: "error: requests are not available" };
        const posted = await ctx.ask({ question: args.question, choices: args.choices });
        return {
          text: posted.here
            ? `question posted in this chat (${posted.where}), addressed to the owner; their next message here is the answer and comes back to you. Do not repeat it: end your turn (answer PASS unless you have something else to add)`
            : `question posted in ${posted.where}, addressed to the owner; their answer will reach you there`,
        };
      }
      case "share_file": {
        const wanted = String(args.agent || "").trim().toLowerCase();
        const recipient = store.agents().find((other) => other.id === wanted || other.name.toLowerCase() === wanted);
        if (!recipient || recipient.id === agent.id || !recipient.enabled || !recipient.tools) return { text: "error: recipient must be another enabled Cora agent with a desktop" };
        await boxes.ensure(agent);
        await boxes.ensure(recipient);
        const receipt = await boxes.shareFile(agent.id, recipient.id, String(args.path || ""));
        return { text: JSON.stringify({ recipient: recipient.name, ...receipt }) };
      }
      case "artifact_folders": {
        if (!ctx.artifacts) return { text: "error: artifacts are not available here" };
        const folders = ctx.artifacts.foldersFor(agent, args.query);
        return { text: JSON.stringify(folders.length ? { folders } : { folders, note: "no folder yet: ask the person which folder to use before pushing" }) };
      }
      case "artifact_log": {
        if (!ctx.artifacts) return { text: "error: artifacts are not available here" };
        return { text: JSON.stringify(ctx.artifacts.history(args.folder, args.limit)) };
      }
      case "artifact_push": {
        if (!ctx.artifacts) return { text: "error: artifacts are not available here" };
        await boxes.ensure(agent);
        const result = await ctx.artifacts.push({
          agent, folder: args.folder, path: String(args.path || ""), to: args.to, message: args.message, mirror: args.mirror === true,
          create: args.create && typeof args.create === "object" ? args.create : null, requester: ctx.requester || null, channelId, traceId: ctx.traceId || "",
        });
        return { text: ctx.artifacts.pushReceipt(result) };
      }
      case "artifact_pull": {
        if (!ctx.artifacts) return { text: "error: artifacts are not available here" };
        await boxes.ensure(agent);
        return { text: await ctx.artifacts.pull({ agent, folder: args.folder, commit: args.commit, overwrite: args.overwrite === true }) };
      }
      case "artifact_share_request": {
        if (!ctx.artifacts) return { text: "error: artifacts are not available here" };
        const folder = ctx.artifacts.findFolder(args.folder);
        if (!folder) return { text: "error: no such folder: list them with artifact_folders" };
        const share = ctx.artifacts.createShare(folder.id, {
          label: args.label, access: { emails: args.emails || [], domains: args.domains || [] }, status: "proposed",
          createdBy: { kind: "agent", id: agent.id, name: agent.name }, requestedBy: ctx.requester || null, reason: args.reason,
        });
        ctx.artifacts.announceShare?.(folder, share, { agent, channelId });
        return { text: `REQUESTED, NOT ACTIVE: the link ${share.url || share.label} opens only after the owner or a reviewer of ${folder.path} turns it on in the panel. Say so; do not send the link as if it worked.` };
      }
      case "secret_list": {
        if (!ctx.vault?.enabled) return { text: "error: this Cora has no vault" };
        const secrets = ctx.vault.list().map((secret) => ({ name: secret.name, what: secret.description, you_may_use: ctx.vault.canUse(ctx.store.vaultSecret(secret.name), agent), updated: new Date(secret.updatedAt).toISOString() }));
        return { text: JSON.stringify(secrets.length ? { secrets } : { secrets, note: "the vault is empty: to get a secret, send the person a link with secret_request" }) };
      }
      case "secret_request": {
        if (!ctx.vault?.enabled) return { text: "error: this Cora has no vault" };
        const request = ctx.vault.requestLink({ name: args.name, description: args.description, agents: [agent.id], by: { kind: "agent", id: agent.id, name: agent.name }, channelId });
        return { text: `link ready: ${request.url}\nIt opens a page where the person types ${request.name} in, once, within 72 hours; send them the link and tell them so. You will be able to use it with secret_import once they submit it (Cora posts a note here). Never ask for the value in a message.` };
      }
      case "secret_import": {
        if (!ctx.vault?.enabled) return { text: "error: this Cora has no vault" };
        await boxes.ensure(agent);
        const stored = await ctx.vault.importInto(agent, args.name, { as: args.as });
        return { text: `${stored} is in your hush. Use it only like this: hush run --name ${stored} --env THE_VARIABLE_THE_TOOL_READS --redact -- your command. Do not print it or write it anywhere.` };
      }
      case "secret_send": {
        if (!ctx.vault?.enabled) return { text: "error: this Cora has no vault" };
        const secret = ctx.store.vaultSecret(String(args.name || "").toUpperCase());
        if (!secret || !ctx.vault.canUse(secret, agent)) return { text: "error: no such secret you may use" };
        ctx.vault.createSend({ name: secret.name, views: args.views, days: args.days, note: `${String(args.to || "").slice(0, 120)}: ${String(args.reason || "").slice(0, 160)}`, by: { kind: "agent", id: agent.id, name: agent.name }, status: "proposed", channelId });
        return { text: "REQUESTED, NOT SENT: the owner approves it in the panel and sends the link. Say so; you never get the link or the value." };
      }
      case "send_file": {
        if (!postFile || !channelId) return { text: "error: there is no channel to post to right now" };
        await boxes.ensure(agent);
        const path = String(args.path || "");
        if (!path.startsWith("/")) return { text: "error: path must be absolute" };
        const data = await boxes.readFile(agent.id, path);
        const name = basename(path).replace(/[^\w.-]/g, "_") || "file";
        const extension = name.split(".").pop().toLowerCase();
        await postFile({ name, data, type: MIME[extension] || "application/octet-stream" }, String(args.caption || ""));
        return { text: `posted ${name} (${Math.round(data.length / 1024)} KB)` };
      }
      default:
        return { text: `error: unknown tool ${call.name}` };
    }
  } catch (error) {
    return { text: `error: ${error.message}` };
  }
}
