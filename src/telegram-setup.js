import { Telegram } from "./telegram.js";
import { ValidationError } from "./store.js";
import { telegramChannel } from "./channels.js";

export async function telegramSetup({ agent, store, telegram, tgBots, channels, traces = null, chatId = "", probe = "", since = "" }) {
  const groups = [...telegram.chats.values()].filter((chat) => ["group", "supergroup"].includes(chat.type));
  const selected = groups.find((chat) => chat.id === chatId);
  if (chatId && !selected) throw new ValidationError("scegli un gruppo Telegram conosciuto");
  const started = Number(since);
  if (probe && (!/^cora-[a-f0-9]{8,32}$/.test(probe) || !Number.isSafeInteger(started) || started > Date.now() + 5000 || started < Date.now() - 30 * 60000)) {
    throw new ValidationError("avvia una nuova prova Telegram");
  }
  const result = {
    checkedAt: Date.now(),
    groups: groups.map(({ id, title }) => ({ id, title })),
    bot: { state: "missing-token", user: null, privacyDisabled: null },
    group: selected ? { id: selected.id, title: selected.title, member: null, role: "", canSend: null } : null,
    listening: {
      platform: channels.on("telegram"),
      chat: Boolean(chatId && store.settings.telegramChatIds.includes(chatId)),
      agent: agent.enabled && channels.agentOn(agent, "telegram"),
      assigned: Boolean(chatId && channels.listFor(agent).some((chat) => chat.id === telegramChannel(chatId))),
    },
    probe: { state: "not-started", messageAt: null, replyAt: null },
  };
  const token = tgBots.token(agent);
  if (!token) return result;
  const client = new Telegram({ token, apiBase: tgBots.apiBase });
  let user;
  try {
    user = await client.request("getMe", {}, { timeoutMs: 5000 });
    if (!user?.is_bot) { result.bot.state = "invalid-token"; return result; }
    result.bot = { state: "ready", user: { id: String(user.id), username: user.username }, privacyDisabled: user.can_read_all_group_messages === true };
  } catch (error) {
    result.bot.state = [401, 404].includes(error.status) ? "invalid-token" : "unavailable";
    return result;
  }
  if (selected) {
    try {
      const member = await client.request("getChatMember", { chat_id: chatId, user_id: user.id }, { timeoutMs: 5000 });
      const role = member?.status || "";
      const present = ["creator", "administrator", "member"].includes(role) || (role === "restricted" && member.is_member === true);
      result.group = { ...result.group, role, member: present, canSend: present && (role !== "restricted" || member.can_send_messages === true) };
    } catch (error) {
      if ([403, 404].includes(error.status)) result.group = { ...result.group, member: false, canSend: false };
    }
  }
  if (selected && probe) {
    const history = store.recentMessages(telegramChannel(chatId), 100);
    const message = history.find((item) => item.at >= started && ["owner", "human"].includes(item.kind) && item.content.includes(probe));
    const readTrace = (id) => traces?.get(id) || store.trace(id);
    const matches = (trace) => trace?.agentId === agent.id && trace.channelId === telegramChannel(chatId) && trace.kind === "chat"
      && ["done", "running", "pass"].includes(trace.status) && trace.prompt.includes(probe);
    const probeTraces = message ? store.traces(agent.id, 20).filter((trace) => trace.channelId === telegramChannel(chatId)).map((trace) => readTrace(trace.id)).filter(matches) : [];
    const reply = message && history.find((item) => {
      if (item.at < message.at || item.kind !== "agent" || item.agentId !== agent.id || item.passive) return false;
      if (item.traceId) return matches(readTrace(item.traceId));
      const messageId = item.id.slice(`tg_${chatId}_`.length);
      return probeTraces.some((trace) => trace.steps.some((step) => {
        if (step.type !== "tool" || step.name !== "say" || step.ok !== true) return false;
        try {
          const receipt = JSON.parse(/Cora delivery receipt: (\{[^\n]*\})/.exec(step.result)?.[1] || "null");
          return receipt?.channel_id === telegramChannel(chatId) && receipt.message_ids?.includes(messageId);
        } catch { return false; }
      }));
    });
    result.probe = { state: reply ? "complete" : message ? "waiting-reply" : "waiting-message", messageAt: message?.at || null, replyAt: reply?.at || null };
  }
  return result;
}
