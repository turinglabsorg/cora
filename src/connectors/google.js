import { createHash, randomBytes } from "node:crypto";
import { count, defined, fail, list, localFile, text, ToolError } from "./tooling.js";

/**
 * Google: Gmail and Google Workspace accounts connected through Cora's OAuth
 * broker. Each account is authorised for chosen agents, who get one tool per
 * action. What an account allows depends on what its owner granted Google:
 * gmail.send sends; gmail.compose adds drafts; gmail.modify adds reading,
 * searching, labels, archive and trash. A tool appears only when at least one of
 * the agent's accounts allows it. Cora takes the refresh token from the vault and
 * renews the access token; the agent never holds either.
 */
export const GMAIL_SCOPES = {
  send: "https://www.googleapis.com/auth/gmail.send",
  compose: "https://www.googleapis.com/auth/gmail.compose",
  modify: "https://www.googleapis.com/auth/gmail.modify",
  readonly: "https://www.googleapis.com/auth/gmail.readonly",
};

/** What an account may do, from the scopes Google granted it. */
export function capabilities(connection) {
  const granted = new Set(String(connection?.scope || "").split(/\s+/).filter(Boolean));
  const has = (name) => granted.has(GMAIL_SCOPES[name]);
  const read = has("modify") || has("readonly");
  return { send: has("send") || has("compose") || has("modify"), draft: has("compose") || has("modify"), read, change: has("modify") };
}
const canList = (connection) => Object.entries(capabilities(connection)).filter(([, yes]) => yes).map(([name]) => name);

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i;
const ADDRESS = /^(?:"?([^"<>\r\n]{0,200})"?\s*)?<([^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,})>$/i;
const NEEDS = { send: "send", draft: "compose drafts", read: "read the mailbox", change: "change messages and labels" };

const hash = (value) => createHash("sha256").update(value).digest("base64url");
const SECRET = (id) => `CORA_GOOGLE_${id.toUpperCase()}`;
const header = (value) => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`);

/** One address as the agent wrote it ("a@b.it" or "Name <a@b.it>"), checked and encoded for a header. */
function address(value) {
  const raw = text(value, 400);
  if (EMAIL.test(raw)) return raw;
  const match = raw.match(ADDRESS);
  if (!match) fail(`"${raw.slice(0, 80)}" is not an email address`);
  const name = match[1]?.trim().replace(/"/g, "");
  if (!name) return match[2];
  const shown = /^[\x20-\x7e]*$/.test(name) ? (/[,;:<>@()[\]\\.]/.test(name) ? `"${name.replace(/\\/g, "")}"` : name) : header(name);
  return `${shown} <${match[2]}>`;
}
const addresses = (value, what, { required = false, max = 50 } = {}) => {
  const items = list(value).map(address);
  if (required && !items.length) fail(`${what} needs at least one address`);
  if (items.length > max) fail(`${what} takes at most ${max} addresses`);
  return items;
};
const bare = (value) => (String(value || "").match(/<([^>]+)>/)?.[1] || String(value || "")).trim().toLowerCase();
const splitAddresses = (value) => String(value || "").split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((item) => item.trim()).filter(Boolean);

const escapeHtml = (value) => value.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
/** HTML turned into readable text, for reading a message without its markup. */
export function htmlText(html) {
  return String(html || "")
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n").replace(/<li[^>]*>/gi, "• ")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (all, href, label) => (label.replace(/<[^>]+>/g, "").trim() === href ? href : `${label} (${href})`))
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (all, code) => code[0] === "#" ? String.fromCodePoint(code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1))) : ENTITIES[code.toLowerCase()] ?? all)
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

/** A whole RFC 822 message, base64url as Gmail takes it: text and HTML alternatives, attachments, reply headers. */
export function mime(message) {
  const boundary = () => `cora_${randomBytes(12).toString("hex")}`;
  const wrap = (bytes) => Buffer.from(bytes).toString("base64").match(/.{1,76}/g)?.join("\r\n") || "";
  const headers = ["MIME-Version: 1.0", `From: ${message.from}`, `To: ${message.to.join(", ")}`];
  if (message.cc?.length) headers.push(`Cc: ${message.cc.join(", ")}`);
  if (message.bcc?.length) headers.push(`Bcc: ${message.bcc.join(", ")}`);
  headers.push(`Subject: ${header(message.subject)}`);
  for (const [name, value] of [["In-Reply-To", message.in_reply_to], ["References", message.references], ["Auto-Submitted", message.auto_submitted]]) {
    if (value && !/[\r\n\0]/.test(value) && value.length < 4096) headers.push(`${name}: ${value}`);
  }
  const alternative = boundary();
  const body = `Content-Type: multipart/alternative; boundary="${alternative}"\r\n\r\n` + [["text/plain", message.body_text || ""], ["text/html", message.body_html || ""]]
    .map(([type, content]) => `--${alternative}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(content)}\r\n`).join("") + `--${alternative}--\r\n`;
  let whole;
  if (message.attachments?.length) {
    const mixed = boundary();
    whole = `${headers.join("\r\n")}\r\nContent-Type: multipart/mixed; boundary="${mixed}"\r\n\r\n--${mixed}\r\n${body}`
      + message.attachments.map((file) => `--${mixed}\r\nContent-Type: ${file.contentType}; name="${header(file.filename)}"\r\nContent-Disposition: attachment; filename="${header(file.filename)}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(file.bytes)}\r\n`).join("")
      + `--${mixed}--\r\n`;
  } else whole = `${headers.join("\r\n")}\r\n${body}`;
  return Buffer.from(whole).toString("base64url");
}

const decode = (data) => Buffer.from(String(data || ""), "base64url");
const headerOf = (payload, name) => payload?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value || "";

/** The text of a message: its text/plain part, or its HTML turned into text; and the attachments it carries. */
function contents(payload) {
  let plain = "", html = "";
  const attachments = [];
  const walk = (part) => {
    if (!part) return;
    const filename = part.filename || "";
    if (filename || (part.body?.attachmentId && !/^text\/(plain|html)$/i.test(part.mimeType))) {
      attachments.push(defined({ id: part.body?.attachmentId, filename: filename || "(unnamed)", type: part.mimeType, bytes: part.body?.size, inline: /inline/i.test(headerOf(part, "Content-Disposition")) || undefined }));
      return;
    }
    if (/^text\/plain$/i.test(part.mimeType) && part.body?.data && !plain) plain = decode(part.body.data).toString("utf8");
    else if (/^text\/html$/i.test(part.mimeType) && part.body?.data && !html) html = decode(part.body.data).toString("utf8");
    for (const child of part.parts || []) walk(child);
  };
  walk(payload);
  return { text: (plain.trim() ? plain.replace(/\r\n/g, "\n").trim() : htmlText(html)), attachments };
}

const summary = (message) => {
  const payload = message.payload || {};
  const labels = message.labelIds || [];
  return defined({ id: message.id, thread: message.threadId, from: headerOf(payload, "From"), to: headerOf(payload, "To") || undefined, cc: headerOf(payload, "Cc") || undefined, subject: headerOf(payload, "Subject"), date: headerOf(payload, "Date"), snippet: message.snippet ? htmlText(message.snippet) : undefined, unread: labels.includes("UNREAD"), labels });
};

/** A whole message to read: headers, text (cut at max characters), attachments and the ids a reply needs. */
const readable = (message, max) => {
  const { text: body, attachments } = contents(message.payload);
  return defined({ ...summary(message), snippet: undefined, reply_to: headerOf(message.payload, "Reply-To") || undefined, message_id: headerOf(message.payload, "Message-ID") || undefined,
    text: body.length > max ? `${body.slice(0, max)}\n[cut at ${max} of ${body.length} characters]` : body, attachments: attachments.length ? attachments : undefined });
};

const ID = (value, what) => {
  const id = text(value, 200);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) fail(`${what} is a Gmail id, as gmail_search answers it`);
  return id;
};

const FROM = { type: "string", description: "the connected address to use (or its id); optional when you have one account" };
const COMPOSE = {
  to: { type: "array", items: { type: "string" }, description: "recipients: \"a@b.it\" or \"Name <a@b.it>\"" },
  cc: { type: "array", items: { type: "string" } },
  bcc: { type: "array", items: { type: "string" } },
  subject: { type: "string" },
  body_html: { type: "string", description: "the message as HTML" },
  body_text: { type: "string", description: "the message as plain text; give this, body_html or both" },
  attachments: { type: "array", items: { type: "string" }, description: "absolute paths of files on your computer to attach, e.g. /home/agent/work/report.pdf (at most 25 MB in all)" },
};
const BODY_RULE = "Send only what the person asked for, to the recipients they named; a send is final, so never retry one whose result is uncertain: check the Sent folder or ask first.";

/** The message an agent composed: checked addresses, both bodies, attachments read from its computer. */
async function composed(args, ctx, { needTo = true } = {}) {
  const to = addresses(args.to, "to", { required: needTo }), cc = addresses(args.cc, "cc"), bcc = addresses(args.bcc, "bcc");
  if (to.length + cc.length + bcc.length > 100) fail("at most 100 recipients in all");
  const subject = text(args.subject, 500).replace(/[\r\n]+/g, " ");
  if (!subject && needTo) fail("subject is required");
  const bodyHtml = String(args.body_html || ""), bodyText = String(args.body_text || "");
  if (!bodyHtml && !bodyText) fail("write body_html or body_text");
  if (bodyHtml.length + bodyText.length > 2000000) fail("the message is too long");
  const attachments = [];
  let total = 0;
  for (const path of list(args.attachments).slice(0, 20)) {
    const file = await localFile({ path }, ctx);
    total += file.bytes.length;
    if (total > 25 * 1024 * 1024) fail("attachments exceed 25 MB in all: share a link instead");
    attachments.push(file);
  }
  return {
    to, cc, bcc, subject, attachments,
    body_html: bodyHtml || escapeHtml(bodyText).replace(/\n/g, "<br>"),
    body_text: bodyText || htmlText(bodyHtml),
  };
}

/** The headers a reply needs, from the message it answers. */
async function replyContext(args, ctx, connection) {
  const id = ID(args.message, "message");
  const original = await ctx.gmail("GET", `/messages/${id}`, { query: { format: "metadata", metadataHeaders: ["From", "Reply-To", "To", "Cc", "Subject", "Message-ID", "References"] } });
  const payload = original.payload || {}, own = connection.email.toLowerCase();
  const messageId = headerOf(payload, "Message-ID");
  const subject = headerOf(payload, "Subject");
  const sender = headerOf(payload, "Reply-To") || headerOf(payload, "From");
  let to = list(args.to).length ? list(args.to) : splitAddresses(sender);
  let cc = list(args.cc);
  if (args.reply_all && !list(args.to).length) {
    const others = [...splitAddresses(headerOf(payload, "To")), ...splitAddresses(headerOf(payload, "Cc"))].filter((item) => bare(item) !== own && !to.some((mine) => bare(mine) === bare(item)));
    cc = [...cc, ...others];
  }
  if (to.every((item) => bare(item) === own)) to = splitAddresses(headerOf(payload, "To")).filter((item) => bare(item) !== own);
  return {
    thread: original.threadId, to, cc,
    subject: text(args.subject, 500) || (/^re:/i.test(subject) ? subject : `Re: ${subject}`),
    in_reply_to: messageId, references: [headerOf(payload, "References"), messageId].filter(Boolean).join(" ").slice(-3900),
  };
}

const SYSTEM_LABELS = new Set(["INBOX", "UNREAD", "STARRED", "IMPORTANT", "SPAM", "TRASH", "SENT", "DRAFT", "CATEGORY_PERSONAL", "CATEGORY_SOCIAL", "CATEGORY_PROMOTIONS", "CATEGORY_UPDATES", "CATEGORY_FORUMS"]);
/** Label names or ids into ids: a system label by its name, a user label by its name or id. */
async function labelIds(ctx, names) {
  const wanted = list(names);
  if (!wanted.length) return [];
  const labels = (await ctx.gmail("GET", "/labels")).labels || [];
  return wanted.map((name) => {
    const upper = name.toUpperCase();
    if (SYSTEM_LABELS.has(upper)) return upper;
    const found = labels.find((label) => label.id === name) || labels.find((label) => label.name.toLowerCase() === name.toLowerCase());
    if (!found) fail(`no label named "${name}": gmail_list_labels shows them, gmail_create_label makes one`);
    return found.id;
  });
}

const TOOLS = [
  {
    name: "gmail_accounts", needs: null,
    description: (connections) => `Gmail: the accounts the owner connected in Connettori and authorised you on (${connections.map((item) => item.email).join(", ")}), with what each allows: send, draft, read, change.`,
    async run(args, ctx) { return ctx.connections.map((item) => ({ id: item.id, email: item.email, can: canList(item) })); },
  },
  {
    name: "gmail_send", needs: "send",
    description: () => `Gmail: send a new message from one of your accounts: to, cc, bcc, subject, body_html and/or body_text, and files from your computer as attachments. To answer a message use gmail_reply, which keeps the thread. ${BODY_RULE}`,
    parameters: { type: "object", properties: { from: FROM, ...COMPOSE }, required: ["to", "subject"] },
    summarize: (args) => `from ${text(args.from, 80)} → ${list(args.to).join(", ")}`,
    async run(args, ctx) {
      const message = await composed(args, ctx);
      const sent = await ctx.connector.deliver(ctx.agent, ctx.connection, message);
      return { sent: true, from: ctx.connection.email, to: message.to, message: sent.id, thread: sent.threadId };
    },
  },
  {
    name: "gmail_reply", needs: "send",
    description: () => `Gmail: reply to a message in its thread, from one of your accounts. Give message (its Gmail id from gmail_search or gmail_read_thread): Cora answers the sender (or Reply-To) with "Re:" and the thread's headers; reply_all also copies the other recipients. to, cc and subject override them. Needs an account that can read; on a send-only account give to, subject, in_reply_to (the Message-ID) and thread instead. ${BODY_RULE}`,
    parameters: { type: "object", properties: { from: FROM, message: { type: "string", description: "the Gmail id of the message you answer" }, reply_all: { type: "boolean" }, ...COMPOSE, in_reply_to: { type: "string", description: "send-only accounts: the Message-ID you answer" }, thread: { type: "string", description: "send-only accounts: the Gmail thread id" } } },
    summarize: (args) => `reply ${text(args.message || args.in_reply_to, 80)}${args.reply_all ? " (all)" : ""}`,
    async run(args, ctx) {
      let reply;
      if (args.message) {
        if (!capabilities(ctx.connection).read) fail(`${ctx.connection.email} can only send: give to, subject, in_reply_to and thread, or reconnect it in Connettori so it can read`);
        reply = await replyContext(args, ctx, ctx.connection);
      } else {
        if (!args.in_reply_to) fail("give message (the Gmail id) or in_reply_to (the Message-ID)");
        const inReplyTo = text(args.in_reply_to, 1000);
        reply = { thread: args.thread ? ID(args.thread, "thread") : undefined, to: list(args.to), cc: list(args.cc), subject: text(args.subject, 500), in_reply_to: inReplyTo, references: inReplyTo };
      }
      const message = await composed({ ...args, to: reply.to, cc: reply.cc, subject: reply.subject }, ctx);
      const sent = await ctx.connector.deliver(ctx.agent, ctx.connection, { ...message, in_reply_to: reply.in_reply_to, references: reply.references, thread: reply.thread });
      return { sent: true, from: ctx.connection.email, to: message.to, cc: message.cc.length ? message.cc : undefined, subject: message.subject, message: sent.id, thread: sent.threadId };
    },
  },
  {
    name: "gmail_search", needs: "read",
    description: () => "Gmail: search one of your accounts with Gmail's own syntax (from:, to:, subject:, is:unread, has:attachment, newer_than:2d, after:2026/11/01, label:, in:inbox, \"exact words\"…): the newest first, with sender, subject, date, snippet and labels. Without query it lists the inbox. Read one with gmail_read_thread or gmail_read_message.",
    parameters: { type: "object", properties: { from: FROM, query: { type: "string", description: "Gmail search, e.g. from:anna@acme.it is:unread newer_than:7d" }, label: { type: "string", description: "optional label name or id to search in" }, include_spam_trash: { type: "boolean" }, limit: { type: "number", description: "default 20, at most 50" }, page: { type: "string", description: "the next_page of the previous answer" } } },
    summarize: (args) => `search ${JSON.stringify(text(args.query, 80) || "in:inbox")}`,
    async run(args, ctx) {
      const query = text(args.query, 2000) || (args.label ? "" : "in:inbox");
      const labels = args.label ? await labelIds(ctx, args.label) : [];
      const found = await ctx.gmail("GET", "/messages", { query: { q: query, labelIds: labels, maxResults: count(args.limit, 20, 50), pageToken: text(args.page, 500), includeSpamTrash: args.include_spam_trash ? "true" : "" } });
      const messages = await Promise.all((found.messages || []).map((item) => ctx.gmail("GET", `/messages/${item.id}`, { query: { format: "metadata", metadataHeaders: ["From", "To", "Subject", "Date"] } })));
      return defined({ account: ctx.connection.email, messages: messages.map((message) => summary(message)), next_page: found.nextPageToken, estimate: found.resultSizeEstimate });
    },
  },
  {
    name: "gmail_read_thread", needs: "read",
    description: () => "Gmail: read a whole conversation: every message with sender, recipients, date, text (HTML turned to text) and attachments. Reading does not mark it read: gmail_modify does.",
    parameters: { type: "object", properties: { from: FROM, thread: { type: "string", description: "the thread id from gmail_search" }, max_chars: { type: "number", description: "text kept per message, default 8000" } }, required: ["thread"] },
    async run(args, ctx) {
      const thread = await ctx.gmail("GET", `/threads/${ID(args.thread, "thread")}`, { query: { format: "full" } });
      return { account: ctx.connection.email, thread: thread.id, messages: (thread.messages || []).map((message) => readable(message, count(args.max_chars, 8000, 50000))) };
    },
  },
  {
    name: "gmail_read_message", needs: "read",
    description: () => "Gmail: read one message: headers, text (HTML turned to text), attachments and its Message-ID. Reading does not mark it read: gmail_modify does.",
    parameters: { type: "object", properties: { from: FROM, message: { type: "string", description: "the message id from gmail_search" }, max_chars: { type: "number", description: "text kept, default 30000" } }, required: ["message"] },
    async run(args, ctx) {
      const message = await ctx.gmail("GET", `/messages/${ID(args.message, "message")}`, { query: { format: "full" } });
      return { account: ctx.connection.email, ...readable(message, count(args.max_chars, 30000, 100000)) };
    },
  },
  {
    name: "gmail_download_attachment", needs: "read",
    description: () => "Gmail: save an attachment of a message on your computer, under /home/agent/work/gmail/ unless you give a path inside /home/agent/work. Name the attachment by its id or its filename, as gmail_read_message lists them.",
    parameters: { type: "object", properties: { from: FROM, message: { type: "string" }, attachment: { type: "string", description: "the attachment's id or filename" }, path: { type: "string", description: "optional absolute path inside /home/agent/work to save it as" } }, required: ["message", "attachment"] },
    async run(args, ctx) {
      const id = ID(args.message, "message");
      const { attachments } = contents((await ctx.gmail("GET", `/messages/${id}`, { query: { format: "full" } })).payload);
      const wanted = text(args.attachment, 500);
      const file = attachments.find((item) => item.id === wanted) || attachments.find((item) => item.filename === wanted) || attachments.find((item) => item.filename.toLowerCase().includes(wanted.toLowerCase()));
      if (!file?.id) fail(`no attachment "${wanted}" in this message${attachments.length ? `; it has: ${attachments.map((item) => item.filename).join(", ")}` : ""}`);
      if (file.bytes > 25 * 1024 * 1024) fail("the attachment is larger than 25 MB");
      const data = await ctx.gmail("GET", `/messages/${id}/attachments/${encodeURIComponent(file.id)}`);
      const bytes = decode(data.data);
      const safe = file.filename.replace(/[\\/\r\n\0]/g, "_").replace(/^\.+/, "_").slice(-150) || "attachment";
      const path = text(args.path, 1000) || `/home/agent/work/gmail/${id}/${safe}`;
      if (!path.startsWith("/home/agent/work/") || path.includes("\0") || path.split("/").includes("..")) fail("path must be inside /home/agent/work");
      if (!ctx.writeFile) fail("files cannot be saved on your computer in this turn");
      await ctx.writeFile(path, bytes);
      return { saved: path, filename: file.filename, type: file.type, bytes: bytes.length };
    },
  },
  {
    name: "gmail_modify", needs: "change",
    description: () => "Gmail: change messages or a whole thread: mark read or unread, star, archive (out of the inbox), move back to the inbox, add or remove labels (by name), trash or take out of the trash. Give messages (ids) or thread. Change only what the person asked for.",
    parameters: { type: "object", properties: {
      from: FROM,
      messages: { type: "array", items: { type: "string" }, description: "message ids (at most 1000)" },
      thread: { type: "string", description: "or a thread id: the change applies to all its messages" },
      read: { type: "boolean", description: "true marks read, false unread" },
      star: { type: "boolean" },
      archive: { type: "boolean", description: "true takes it out of the inbox, false puts it back" },
      add_labels: { type: "array", items: { type: "string" }, description: "label names or ids" },
      remove_labels: { type: "array", items: { type: "string" } },
      trash: { type: "boolean", description: "true moves to the trash (Gmail deletes it after 30 days), false restores it" },
    } },
    summarize: (args) => [args.thread ? `thread ${text(args.thread, 40)}` : `${list(args.messages).length} messages`, ...["read", "star", "archive", "trash"].filter((key) => args[key] !== undefined).map((key) => `${key}=${args[key]}`)].join(" · "),
    async run(args, ctx) {
      const messages = list(args.messages).map((id) => ID(id, "message"));
      const thread = args.thread ? ID(args.thread, "thread") : "";
      if (!messages.length && !thread) fail("give messages or thread");
      if (messages.length > 1000) fail("at most 1000 messages at once");
      const add = await labelIds(ctx, args.add_labels), remove = await labelIds(ctx, args.remove_labels);
      if (args.read === true) remove.push("UNREAD"); else if (args.read === false) add.push("UNREAD");
      if (args.star === true) add.push("STARRED"); else if (args.star === false) remove.push("STARRED");
      if (args.archive === true) remove.push("INBOX"); else if (args.archive === false) add.push("INBOX");
      const done = {};
      if (add.length || remove.length) {
        const body = defined({ addLabelIds: add.length ? [...new Set(add)] : undefined, removeLabelIds: remove.length ? [...new Set(remove)] : undefined });
        if (thread) await ctx.gmail("POST", `/threads/${thread}/modify`, { body });
        else await ctx.gmail("POST", "/messages/batchModify", { body: { ids: messages, ...body } });
        Object.assign(done, defined({ added: body.addLabelIds, removed: body.removeLabelIds }));
      }
      if (args.trash !== undefined) {
        const verb = args.trash ? "trash" : "untrash";
        if (thread) await ctx.gmail("POST", `/threads/${thread}/${verb}`);
        else for (const id of messages) await ctx.gmail("POST", `/messages/${id}/${verb}`);
        done[args.trash ? "trashed" : "restored"] = true;
      }
      if (!Object.keys(done).length) fail("say what to change: read, star, archive, add_labels, remove_labels or trash");
      return { changed: thread ? { thread } : { messages: messages.length }, ...done };
    },
  },
  {
    name: "gmail_list_labels", needs: "read",
    description: () => "Gmail: the labels of one of your accounts, system and your own, with unread counts for your own.",
    parameters: { type: "object", properties: { from: FROM, counts: { type: "boolean", description: "also unread and total counts for each label (slower)" } } },
    async run(args, ctx) {
      const labels = (await ctx.gmail("GET", "/labels")).labels || [];
      const detailed = args.counts ? await Promise.all(labels.map((label) => ctx.gmail("GET", `/labels/${encodeURIComponent(label.id)}`))) : labels;
      return detailed.map((label) => defined({ id: label.id, name: label.name, type: label.type, unread: label.messagesUnread, total: label.messagesTotal })).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "system" ? -1 : 1));
    },
  },
  {
    name: "gmail_create_label", needs: "change",
    description: () => "Gmail: create a label in one of your accounts (use \"Parent/Child\" for a nested one). Then apply it with gmail_modify.",
    parameters: { type: "object", properties: { from: FROM, name: { type: "string" } }, required: ["name"] },
    async run(args, ctx) {
      const name = text(args.name, 200);
      if (!name) fail("name is required");
      const label = await ctx.gmail("POST", "/labels", { body: { name, labelListVisibility: "labelShow", messageListVisibility: "show" } });
      return { id: label.id, name: label.name };
    },
  },
  {
    name: "gmail_list_drafts", needs: "draft",
    description: () => "Gmail: the drafts of one of your accounts, newest first, with recipients and subject.",
    parameters: { type: "object", properties: { from: FROM, limit: { type: "number", description: "default 20, at most 50" } } },
    async run(args, ctx) {
      const found = await ctx.gmail("GET", "/drafts", { query: { maxResults: count(args.limit, 20, 50) } });
      const drafts = await Promise.all((found.drafts || []).map((item) => ctx.gmail("GET", `/drafts/${item.id}`, { query: { format: "metadata" } })));
      return drafts.map((draft) => ({ draft: draft.id, ...summary(draft.message || {}) }));
    },
  },
  {
    name: "gmail_create_draft", needs: "draft",
    description: () => "Gmail: save a draft in one of your accounts without sending it, with attachments from your computer. With message (a Gmail id) it is a reply in that thread. The person can review and send it from Gmail, or you send it later with gmail_send_draft when they say so.",
    parameters: { type: "object", properties: { from: FROM, message: { type: "string", description: "optional: the Gmail id of the message this draft answers" }, reply_all: { type: "boolean" }, ...COMPOSE } },
    summarize: (args) => `draft → ${list(args.to).join(", ") || text(args.message, 60)}`,
    async run(args, ctx) {
      let reply = {};
      if (args.message) {
        if (!capabilities(ctx.connection).read) fail(`${ctx.connection.email} cannot read: a reply draft needs the original message`);
        reply = await replyContext(args, ctx, ctx.connection);
      }
      const message = await composed({ ...args, ...(args.message ? { to: reply.to, cc: reply.cc, subject: reply.subject } : {}) }, ctx, { needTo: false });
      const raw = mime({ ...message, from: ctx.connector.fromHeader(ctx.agent, ctx.connection), in_reply_to: reply.in_reply_to, references: reply.references });
      const draft = await ctx.gmail("POST", "/drafts", { body: { message: defined({ raw, threadId: reply.thread }) } });
      return { draft: draft.id, message: draft.message?.id, thread: draft.message?.threadId, to: message.to, subject: message.subject };
    },
  },
  {
    name: "gmail_send_draft", needs: "draft",
    description: () => `Gmail: send a saved draft as it is. ${BODY_RULE}`,
    parameters: { type: "object", properties: { from: FROM, draft: { type: "string", description: "the draft id from gmail_list_drafts or gmail_create_draft" } }, required: ["draft"] },
    async run(args, ctx) {
      const sent = await ctx.gmail("POST", "/drafts/send", { body: { id: ID(args.draft, "draft") } });
      return { sent: true, from: ctx.connection.email, message: sent.id, thread: sent.threadId };
    },
  },
  {
    name: "gmail_delete_draft", needs: "draft",
    description: () => "Gmail: delete a draft for good (it does not go to the trash).",
    parameters: { type: "object", properties: { from: FROM, draft: { type: "string" } }, required: ["draft"] },
    async run(args, ctx) {
      await ctx.gmail("DELETE", `/drafts/${ID(args.draft, "draft")}`);
      return { deleted: true };
    },
  },
  {
    name: "gmail_api", needs: "read",
    description: () => "Gmail: any other call to the Gmail API of one of your accounts, when no gmail_ tool does it: method and path under https://gmail.googleapis.com/gmail/v1/users/me (e.g. GET /settings/filters, POST /settings/filters, GET /history). The account's scopes still limit it. Prefer the gmail_ tools.",
    parameters: { type: "object", properties: { from: FROM, method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] }, path: { type: "string", description: "e.g. /settings/filters" }, query: { type: "object" }, body: { type: "object" } }, required: ["path"] },
    summarize: (args) => `${text(args.method, 10) || "GET"} ${text(args.path, 150)}`,
    async run(args, ctx) {
      const path = text(args.path, 1000);
      if (!/^\/[A-Za-z0-9/_.-]*$/.test(path) || path.split("/").includes("..")) fail("path is a Gmail API path under /users/me, e.g. /settings/filters");
      const method = text(args.method, 10).toUpperCase() || "GET";
      return ctx.gmail(method, path, { query: args.query, body: method === "GET" || method === "DELETE" ? undefined : args.body });
    },
  },
];

export const google = {
  id: "google",
  name: "Google",
  kind: "google",
  tools: TOOLS,
  card: {
    icon: "mail",
    description: "Leggi, cerca, organizza e invia la posta del tuo account Gmail o Google Workspace con gli agenti che scegli.",
    meta: "Gmail · Google Workspace",
  },
};

export class ConnectorError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export class GoogleConnector {
  constructor({ store, broker, space, storeSecret, tokenFor, enabled = true, access = "send", api = "https://gmail.googleapis.com/gmail/v1/users/me" }) {
    Object.assign(this, { store, enabled, mailAccess: access === "mail" ? "mail" : "send", broker: String(broker || "").replace(/\/$/, ""), space, storeSecret, tokenFor, api });
    this.pending = new Map(); this.bundles = new Map(); this.access = new Map();
  }
  records() { return this.store.value("googleConnectors", []); }
  view(user = null) {
    return { available: Boolean(this.enabled && this.broker && this.space), connections: this.records().filter((item) => !item.disconnected && (!this.knowledge?.ownerMemory || item.connectedBy === user?.id)),
      agents: (this.knowledge?.ownerMemory ? this.knowledge.agentsFor(user) : this.store.agents()).map(({ id, name }) => ({ id, name })) };
  }
  forAgent(agent) { return this.records().filter((item) => !item.disconnected && item.agents.includes(agent.id)); }
  identity(agent, id) {
    const connection = this.forAgent(agent).find((item) => item.id === id);
    if (!connection) throw new ConnectorError("Questo account Google non è autorizzato per l'agente.", 403);
    return connection;
  }
  begin(user) {
    if (!this.enabled || !this.broker || !this.space) throw new ConnectorError("Il collegamento Google non è disponibile.", 409);
    for (const [key, value] of this.pending) if (value.expires < Date.now()) this.pending.delete(key);
    const nonce = randomBytes(32).toString("base64url"), verifier = randomBytes(32).toString("base64url");
    this.pending.set(nonce, { userId: user.id, verifier, expires: Date.now() + 900000 });
    const url = new URL(`${this.broker}/connectors/google/start`);
    url.search = new URLSearchParams({ space: this.space, nonce, challenge: hash(verifier), ...(this.mailAccess === "mail" ? { access: "mail" } : {}) });
    return { url: url.href, nonce };
  }
  async relay(path, body) {
    const response = await fetch(`${this.broker}/connectors/google/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new ConnectorError("Google non ha completato il collegamento. Riprova da Connettori.", 502);
    return response.json();
  }
  async finish({ state, code, error, nonce }) {
    let data;
    try { data = JSON.parse(Buffer.from(String(state).split(".")[1], "base64url")); } catch { throw new ConnectorError("Collegamento Google scaduto. Riprova."); }
    const pending = this.pending.get(data.nonce);
    if (!pending || pending.expires < Date.now() || data.space !== this.space || data.nonce !== nonce) throw new ConnectorError("Collegamento Google scaduto. Riprova.");
    this.pending.delete(data.nonce);
    const user = this.store.panelUser(pending.userId);
    if (!user || (!this.knowledge?.ownerMemory && user.role !== "owner") || user.blocked) throw new ConnectorError("Accesso non autorizzato.", 403);
    if (error || !code) throw new ConnectorError("Collegamento Google annullato.");
    const result = await this.relay("exchange", { state, code, verifier: pending.verifier });
    if (!result.refresh_token || !result.grant || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(result.email || "")) throw new ConnectorError("Google non ha confermato l'indirizzo.");
    const old = this.records().find((item) => item.email === result.email && item.connectedBy === user.id);
    const id = old?.id || `gc_${randomBytes(8).toString("hex")}`;
    const bundle = { refresh_token: result.refresh_token, grant: result.grant };
    await this.storeSecret(SECRET(id), JSON.stringify(bundle));
    this.bundles.set(id, bundle); this.access.delete(id);
    const connection = { id, email: result.email, scope: result.scope, agents: old?.agents || [], connectedBy: user.id, connectedAt: new Date().toISOString(), disconnected: false };
    this.store.setValue("googleConnectors", [...this.records().filter((item) => item.id !== id), connection]);
    return connection;
  }
  update(id, { agents }) {
    const records = this.records(), connection = records.find((item) => item.id === id && !item.disconnected);
    if (!connection) throw new ConnectorError("Account Google non trovato.", 404);
    if (!Array.isArray(agents) || agents.some((agentId) => !this.store.agent(agentId))) throw new ConnectorError("Scegli agenti validi.");
    connection.agents = [...new Set(agents)];
    this.store.setValue("googleConnectors", records);
    return this.view();
  }
  disconnect(id) {
    const records = this.records(), connection = records.find((item) => item.id === id);
    if (!connection) throw new ConnectorError("Account Google non trovato.", 404);
    connection.disconnected = true; connection.agents = [];
    this.access.delete(id); this.bundles.delete(id);
    this.store.setValue("googleConnectors", records);
  }
  async token(connection) {
    const cached = this.access.get(connection.id);
    if (cached?.until > Date.now() + 60000) return cached.token;
    let bundle = this.bundles.get(connection.id);
    if (!bundle) { try { bundle = JSON.parse(this.tokenFor(SECRET(connection.id))); } catch { throw new ConnectorError("Ricollega l'account Google da Connettori.", 409); } }
    const result = await this.relay("refresh", bundle);
    if (result.email !== connection.email || !result.access_token) throw new ConnectorError("Ricollega l'account Google da Connettori.", 409);
    this.access.set(connection.id, { token: result.access_token, until: Date.now() + Math.min(3600, Number(result.expires_in) || 300) * 1000 });
    return result.access_token;
  }
  /** The From header: the agent's name and the account's address. */
  fromHeader(agent, connection) { return `${header(agent.name)} <${connection.email}>`; }

  /** One call to the Gmail API of an account, with Cora's access token; a refusal becomes a message the agent can act on. */
  async gmail(connection, method, path, { query, body, raw, contentType, base } = {}) {
    const url = new URL(`${base || this.api}${path}`);
    for (const [key, value] of Object.entries(query || {})) {
      for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined && item !== null && item !== "") url.searchParams.append(key, String(item));
    }
    const access = await this.token(connection);
    let response;
    try {
      response = await fetch(url, { method, headers: { Authorization: `Bearer ${access}`, Accept: "application/json", ...(raw !== undefined ? { "Content-Type": contentType } : body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    } catch {
      throw new ToolError("Gmail does not answer: try again shortly");
    }
    let data = null;
    try { data = response.status === 204 ? {} : await response.json(); } catch { data = null; }
    const reason = data?.error?.message ? `: ${String(data.error.message).slice(0, 800)}` : "";
    if (response.status === 401) { this.access.delete(connection.id); throw new ToolError(`Google refuses ${connection.email}: the owner reconnects it in Connettori`); }
    if (response.status === 403 && /scope|insufficient/i.test(reason)) throw new ToolError(`${connection.email} did not grant this to Cora${reason}: the owner reconnects it in Connettori and allows reading and drafts`);
    if (response.status === 429) throw new ToolError("Gmail limits the calls: try again in a minute");
    if (!response.ok) throw new ToolError(`Gmail answered ${response.status}${reason}`);
    return data ?? {};
  }

  /** Sends a composed message from an account the agent is still authorised on. */
  async deliver(agent, connection, message) {
    const raw = mime({ ...message, from: this.fromHeader(agent, connection) });
    await this.token(connection);
    this.identity(agent, connection.id);
    let result;
    if (raw.length < 3500000) result = await this.gmail(connection, "POST", "/messages/send", { body: defined({ raw, threadId: message.thread }) });
    else {
      const boundary = `cora_${randomBytes(12).toString("hex")}`;
      const payload = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(defined({ threadId: message.thread }))}\r\n--${boundary}\r\nContent-Type: message/rfc822\r\n\r\n`), Buffer.from(raw, "base64url"), Buffer.from(`\r\n--${boundary}--\r\n`)]);
      result = await this.gmail(connection, "POST", "/messages/send", { base: this.api.replace("/gmail/v1/", "/upload/gmail/v1/"), query: { uploadType: "multipart" }, raw: payload, contentType: `multipart/related; boundary=${boundary}` });
    }
    if (!result.id) throw new ToolError("Gmail did not confirm the send: check the Sent folder before trying again");
    return result;
  }

  /** The gmail_ tools an agent sees: those that at least one of its accounts allows. */
  toolsFor(agent) {
    const connections = agent && this.enabled ? this.forAgent(agent) : [];
    if (!connections.length) return [];
    return TOOLS.filter((tool) => !tool.needs || connections.some((item) => capabilities(item)[tool.needs])).map((tool) => {
      const able = tool.needs ? connections.filter((item) => capabilities(item)[tool.needs]) : connections;
      const accounts = tool.needs && able.length < connections.length ? ` Only ${able.map((item) => item.email).join(", ")} allow it.` : "";
      return { name: tool.name, description: `${tool.description(connections)}${accounts}`, parameters: tool.parameters || { type: "object", properties: { from: FROM } } };
    });
  }

  /** Runs a gmail_ tool for an agent on one of its accounts. */
  async runTool(agent, name, args = {}, { readFile = null, writeFile = null } = {}) {
    const connections = this.forAgent(agent), tool = TOOLS.find((item) => item.name === name);
    if (!connections.length) return { text: "error: you are not authorised on a Google account: the owner picks the agents in the Google card in Connettori" };
    if (!tool) return { text: `error: ${name} is not a Gmail tool` };
    const from = String(args.from || "").trim().toLowerCase();
    const able = tool.needs ? connections.filter((item) => capabilities(item)[tool.needs]) : connections;
    const readers = able.filter((item) => capabilities(item).read);
    const guess = !tool.needs ? connections[0] : able.length === 1 ? able[0] : (args.message || args.thread || args.draft) && readers.length === 1 ? readers[0] : null;
    const connection = from ? connections.find((item) => item.id === from || item.email.toLowerCase() === from) : guess;
    if (!connection) return { text: `error: from is one of ${(from ? connections : able.length ? able : connections).map((item) => item.email).join(", ")}` };
    if (tool.needs && !capabilities(connection)[tool.needs]) return { text: `error: ${connection.email} cannot ${NEEDS[tool.needs]}: Google granted it only ${canList(connection).join(", ") || "nothing"}; the owner reconnects it in Connettori to allow more` };
    const ctx = { agent, connection, connections, connector: this, readFile, writeFile, gmail: (method, path, options) => this.gmail(connection, method, path, options) };
    try {
      const out = JSON.stringify(await tool.run(args || {}, ctx) ?? null);
      const LIMIT = 40000;
      return { text: out.length > LIMIT ? `${out.slice(0, LIMIT)}\n[truncated at ${LIMIT} of ${out.length} characters: ask for fewer messages or a lower max_chars]` : out };
    } catch (error) {
      return { text: `error: ${error instanceof ToolError || error instanceof ConnectorError ? error.message : error.message || "Gmail failed"}` };
    }
  }

  /** Sends for the email channel (email_send with a Google sender): same message, same checks. */
  async send(agent, senderId, message) {
    const connection = this.identity(agent, senderId);
    if (!capabilities(connection).send) throw new ConnectorError("Questo account Google non può inviare.", 403);
    const sent = await this.deliver(agent, connection, { to: message.to, cc: message.cc || [], bcc: message.bcc || [], subject: message.subject, body_html: message.body_html || "", body_text: message.body_text || "", in_reply_to: message.in_reply_to, references: message.references, auto_submitted: message.auto_submitted });
    return { message_id: sent.id, email: connection.email };
  }
}
