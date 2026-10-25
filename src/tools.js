import { basename } from "node:path";
import { bm25 } from "./memory.js";
import { SHARED } from "./store.js";

const XDOTOOL_BUTTON = { click: "1", double_click: "1", right_click: "3", middle_click: "2" };

/** Tools every agent has, also without its computer. */
export const MEMORY_TOOLS = new Set(["say", "remember", "forget", "recall", "update_core", "notify", "ask_owner"]);

export const TOOL_DEFS = [
  {
    name: "shell",
    description: "Run a bash command on your own Linux computer (Debian, user 'agent' with passwordless sudo, home /home/agent, DISPLAY=:1 so GUI apps open on your desktop). Use it to browse with curl, write and run scripts (node, python3), manage files, install packages. Long-running GUI apps must be started in the background (nohup ... &).",
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
    description: "Post a message in the current conversation right now and keep working. Use it to answer at once (\"ci guardo\") before something that takes time, or to share progress. Your final reply is posted too, so do not repeat yourself.",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "remember",
    description: "Save a durable fact to your long-term memory (about the owner, the others, yourself, ongoing projects, decisions). One short, specific fact per call. Use shared=true for facts every agent should know (about the owner, the house rules, common projects). Do not save trivia or things already in your memory.",
    parameters: {
      type: "object",
      properties: {
        fact: { type: "string" },
        shared: { type: "boolean", description: "true = every agent will know it" },
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
    description: "List your routines (scheduled tasks you run on your own): id, name, schedule, where you post, whether it is on, next and last run.",
    parameters: { type: "object", properties: {} },
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
    name: "delete_routine",
    description: "Delete one of your routines by id.",
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
    description: "Ask the owner something that needs their answer or decision: permission, a choice, missing information. It reaches their phone and your private chat with them; the answer comes back to you there later, so do not wait for it: say you asked and stop. Write the question so it makes sense on its own, and offer up to 4 short choices when they fit.",
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
  if (name === "notify") return String(args.message || "").slice(0, 200);
  if (name === "say") return String(args.text || "").slice(0, 200);
  if (name === "set_routine") return `${args.id ? `${args.id} ` : ""}${args.name || ""} ${args.schedule || ""}`.trim();
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
      case "open_url": {
        const url = String(args.url || "");
        if (!/^https?:\/\//i.test(url)) return { text: "error: url must start with http:// or https://" };
        await boxes.ensure(agent);
        const quoted = `'${url.replace(/'/g, "'\\''")}'`;
        await boxes.shell(agent.id, `nohup chromium ${quoted} >/tmp/chromium.log 2>&1 &`, { timeoutMs: 15000 });
        return { text: `opened ${url} in Chromium. Take a screenshot in a few seconds to see it.` };
      }
      case "remember": {
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
        if (!routines.length) return { text: "you have no routines" };
        return { text: routines.map((routine) => `- [${routine.id}] ${routine.name} · ${routine.schedule} · ${ctx.channelLabel(routine.channelId)} · ${routine.enabled ? "on" : "paused"}${routine.lastRunAt ? ` · last ${ctx.formatWhen(Date.parse(routine.lastRunAt))} ${routine.lastStatus}` : ""}\n  ${routine.prompt.slice(0, 300)}`).join("\n") };
      }
      case "set_routine": {
        const id = String(args.id || "").trim();
        const existing = id ? store.routine(id) : null;
        if (id && (!existing || existing.agentId !== agent.id)) return { text: "error: you have no routine with that id" };
        const input = {};
        for (const key of ["name", "schedule", "prompt"]) if (args[key] !== undefined) input[key] = String(args[key]);
        if (args.enabled !== undefined) input.enabled = Boolean(args.enabled);
        input.channelId = String(args.channel_id || existing?.channelId || channelId || "");
        if (input.schedule !== undefined) {
          const problem = ctx.checkSchedule?.(input.schedule);
          if (problem) return { text: `error: schedule: ${problem}` };
        }
        const routine = existing ? store.updateRoutine(existing.id, input) : store.createRoutine(agent.id, input);
        ctx.log?.({ type: "routine", agentId: agent.id, text: `${existing ? "ha cambiato" : "ha creato"} la routine «${routine.name}» (${routine.schedule})` });
        return { text: `${existing ? "updated" : "created"} [${routine.id}] ${routine.name} · ${routine.schedule} · ${ctx.channelLabel(routine.channelId)} · ${routine.enabled ? "on" : "paused"}` };
      }
      case "delete_routine": {
        const routine = store.routine(String(args.id || ""));
        if (!routine || routine.agentId !== agent.id) return { text: "error: you have no routine with that id" };
        store.deleteRoutine(routine.id);
        ctx.log?.({ type: "routine", agentId: agent.id, text: `ha eliminato la routine «${routine.name}»` });
        return { text: "deleted" };
      }
      case "say": {
        const text = String(args.text || "").trim();
        if (!text) return { text: "error: empty message" };
        if (!ctx.say) return { text: "error: there is no conversation to post to right now" };
        await ctx.say(text.slice(0, 4000));
        return { text: "posted; keep working" };
      }
      case "ask_owner": {
        if (!ctx.ask) return { text: "error: requests are not available" };
        const item = await ctx.ask({ question: args.question, choices: args.choices });
        return { text: `asked the owner in your private chat (request ${item.id}); their answer will reach you there` };
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
