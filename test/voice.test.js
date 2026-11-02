import assert from "node:assert/strict";
import { test } from "node:test";
import { startCora } from "../src/main.js";
import { Store } from "../src/store.js";
import { Voice, accentOf, speakable, wavShape } from "../src/voice.js";
import { CHANNEL, GUILD, MAIN_TOKEN, SLACK_CHANNEL, TG_GROUP, TG_OWNER, fakeDiscord, fakeDocker, fakeOllama, fakeSlack, fakeSoniox, fakeTelegram, sleep, tempHome, toneWav, waitFor } from "./helpers.js";

async function fixture(t, { sonioxKey = "", stored = new Map() } = {}) {
  const soniox = await fakeSoniox();
  t.after(soniox.close);
  const app = startCora({ home: tempHome(), host: "127.0.0.1", port: 0, insecureCookies: true,
    adminPassword: "fixture-password", sessionKey: "voice-session", discordToken: "", telegramToken: "", ollamaKey: "", orcaKey: "",
    cloudUrl: "", cloudKey: "", cloudSpace: "", claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes",
    botTokenFor: () => "", docker: fakeDocker().path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys",
    sonioxKey, sonioxApi: soniox.url, sonioxTtsUrl: soniox.ttsUrl, storeSecret: async (name, value) => stored.set(name, value),
  });
  await app.ready;
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Cora": "1" }, body: JSON.stringify({ password: "fixture-password" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const request = async (path, { method = "GET", body } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, "X-Cora": "1", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const type = response.headers.get("content-type") || "";
    return { status: response.status, type, data: type.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer()) };
  };
  return { app, soniox, request, stored };
}

test("a Soniox key is tried before it is kept, then the agents' voices can be chosen and heard", async (t) => {
  const { app, soniox, request, stored } = await fixture(t);
  assert.deepEqual((await request("/api/voices")).data, { configured: false, languages: ["it", "en", "es", "fr", "de", "pt"], voices: [] });
  assert.equal((await request("/api/state")).data.keys.soniox, false);
  assert.equal((await request("/api/providers/soniox/key", { method: "PUT", body: { key: "not-the-key" } })).status, 400);
  assert.equal(stored.size, 0, "a key Soniox refuses never reaches hush");
  assert.equal((await request("/api/providers/soniox/key", { method: "PUT", body: { key: soniox.key } })).status, 200);
  assert.equal(stored.get("CORA_SONIOX_API_KEY"), soniox.key);
  assert.equal((await request("/api/state")).data.keys.soniox, true);
  const voices = (await request("/api/voices")).data;
  assert.equal(voices.configured, true);
  assert.deepEqual(voices.voices.map((voice) => voice.id), ["Grace", "Giulia", "Marco"]);
  const sample = await request("/api/voices/preview", { method: "POST", body: { voice: "Giulia", language: "it" } });
  assert.equal(sample.status, 200);
  assert.equal(sample.type, "audio/mpeg");
  assert.deepEqual(soniox.state.speech.at(-1), { model: "tts-rt-v2", language: "it", voice: "Giulia", audio_format: "mp3", text: "Ciao, questa è la mia voce. Ti rispondo così quando mi parli." });
  const created = await request("/api/agents", { method: "POST", body: { name: "Ada", model: "ollama/test-model", voice: "Giulia", voiceLanguage: "it" } });
  assert.equal(created.status, 201);
  assert.deepEqual([created.data.voice, created.data.voiceLanguage], ["Giulia", "it"]);
  const changed = await request(`/api/agents/${created.data.id}`, { method: "PUT", body: { voiceLanguage: "klingon", voice: "Giulia<script>" } });
  assert.deepEqual([changed.data.voiceLanguage, changed.data.voice], ["", "Giuliascript"], "an unknown language falls back to the instance's, a voice id keeps only its characters");
  assert.equal(app.voice.enabled, true);
});

test("a Soniox voice's language is the accent its description names", () => {
  assert.deepEqual([
    "Low British baritone that sits still and lets the facts do the work.",
    "A young Italian female voice.",
    "Warm Brazilian storyteller.",
    "Spanish-born speaker with relaxed English.",
    "A deep, focused male voice with crisp articulation.",
  ].map(accentOf), ["en", "it", "pt", "es", ""]);
});

test("speech keeps the words and drops what a voice cannot say; a WAV gives its length and outline", () => {
  assert.equal(speakable("**Fatto!** Il PR è qui: https://github.com/x/y/pull/1 e `npm test` passa.\n```js\nconsole.log(1)\n```\n- ultima cosa <@123456789012345678>"),
    "Fatto! Il PR è qui: e npm test passa. ultima cosa");
  const shape = wavShape(toneWav(0.5));
  assert.ok(Math.abs(shape.duration - 0.5) < 0.001);
  assert.equal(shape.waveform.length, 128);
  assert.equal(Math.max(...shape.waveform), 255);
  assert.deepEqual(wavShape(Buffer.from("not a wav")), { duration: 0, waveform: Buffer.alloc(0) });
});

test("a voice note is Ogg/Opus and MP3 when ffmpeg is there, and an MP3 from Soniox when it is not", async (t) => {
  const soniox = await fakeSoniox();
  t.after(soniox.close);
  const withFfmpeg = new Voice({ key: soniox.key, api: soniox.url, ttsUrl: soniox.ttsUrl, ffmpeg: "ffmpeg" });
  const note = await withFfmpeg.voiceNote("Ciao Sam, ho finito.", { voice: "Giulia", language: "it" });
  assert.equal(note.ogg.subarray(0, 4).toString("ascii"), "OggS");
  assert.ok(note.mp3.length > 100);
  assert.ok(Math.abs(note.duration - 0.6) < 0.01);
  assert.equal(soniox.state.speech.at(-1).audio_format, "wav");
  const without = new Voice({ key: soniox.key, api: soniox.url, ttsUrl: soniox.ttsUrl, ffmpeg: "/missing/ffmpeg" });
  const plain = await without.voiceNote("Ciao Sam.", { voice: "Giulia", language: "it" });
  assert.equal(plain.ogg, null);
  assert.equal(soniox.state.speech.at(-1).audio_format, "mp3");
  soniox.state.transcripts.push("domani alle nove c'è la riunione");
  assert.deepEqual(await withFfmpeg.transcribe(note.ogg, { filename: "voice-message.ogg", languages: ["it", "it", "en"] }), { text: "domani alle nove c'è la riunione", language: "it" });
  const asked = soniox.state.transcriptions.at(-1);
  assert.equal(asked.model, "stt-async-v5");
  assert.deepEqual(asked.language_hints, ["it", "en"]);
  assert.equal(asked.enable_language_identification, true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(soniox.state.deleted.includes(asked.id) && soniox.state.deleted.includes(asked.file_id), "the transcription and the file are deleted on Soniox");
});

/**
 * A whole Cora on stand-ins (Discord, Telegram, Slack, Ollama, Soniox) for the voice journeys.
 * `replies` answers per agent name; every prompt an agent got is in `prompts`.
 */
async function world(t) {
  const discord = await fakeDiscord();
  const telegram = await fakeTelegram();
  const slack = await fakeSlack();
  const soniox = await fakeSoniox();
  const replies = new Map();
  const prompts = [];
  const ollama = await fakeOllama(async (body) => {
    const system = String(body.messages[0]?.content || "");
    if (/^Scrivi la condizione di completamento/.test(system)) return { content: "NESSUNO" };
    if (/^Giudichi se un compito è finito/.test(system)) return { content: JSON.stringify({ met: true, reason: "" }) };
    if (/^Valuti l'intenzione/.test(system)) return { content: JSON.stringify({ intent: "update" }) };
    const name = /^Sei (\p{Lu}[^.]*)\./u.exec(system)?.[1];
    const users = body.messages.filter((message) => message.role === "user");
    prompts.push({ name, text: String(users.at(-1)?.content || ""), all: body.messages.map((message) => String(message.content || "")).join("\n") });
    const handler = replies.get(name);
    return handler ? handler(body) : { content: "PASS" };
  });
  const home = tempHome();
  const seed = new Store(home);
  seed.updateSettings({ guildIds: [GUILD] });
  seed.close();
  const botTokens = {};
  const vault = {};
  const app = startCora({ home, host: "127.0.0.1", port: 0, insecureCookies: true, adminPassword: "fixture-password", sessionKey: "voice-world",
    discordToken: MAIN_TOKEN, discordApi: discord.url, telegramApi: telegram.url, telegramPollTimeout: 1, slackApi: slack.url,
    ollamaUrl: ollama.url, ollamaKey: "test-ollama-key", orcaKey: "", cloudUrl: "", cloudKey: "", cloudSpace: "",
    claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes", botTokenFor: (name) => botTokens[name] || "",
    docker: fakeDocker().path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys",
    sonioxKey: soniox.key, sonioxApi: soniox.url, sonioxTtsUrl: soniox.ttsUrl, ffmpeg: "ffmpeg", storeSecret: async (name, value) => { vault[name] = value; },
  });
  await app.ready;
  t.after(async () => {
    await app.stop();
    await Promise.all([discord.close(), telegram.close(), slack.close(), soniox.close(), ollama.close()]);
  });
  await waitFor(() => app.discord.state === "ready", { what: "gateway ready" });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Cora": "1" }, body: JSON.stringify({ password: "fixture-password" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const call = async (path, { method = "GET", body } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, "X-Cora": "1", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const quiet = () => waitFor(() => app.orchestrator.quiet(), { what: "agents to stop talking", timeout: 30000 });
  return { app, discord, telegram, slack, soniox, replies, prompts, botTokens, call, quiet };
}

// What a person's phone records: the stand-in Soniox only counts the bytes.
const RECORDING = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(3000, 7)]);

test("on Discord a voice message is heard as words and answered out loud: a voice message from the agent's own bot", async (t) => {
  const { app, discord, soniox, replies, prompts, botTokens, call, quiet } = await world(t);
  const ADA = "600000000000000077";
  botTokens.CORA_BOT_ADA = "ada-token";
  discord.state.botUsers.set("ada-token", { id: ADA, username: "Ada" });
  const ada = (await call("/api/agents", { method: "POST", body: { name: "Ada", model: "ollama/test-model", chattiness: 0, tools: false, voice: "Giulia", voiceLanguage: "it" } })).data;
  await waitFor(() => app.bots.client(ada.id), { what: "Ada's bot online" });
  replies.set("Ada", () => ({ content: "Sì Sam, alle **nove** in sala grande: https://example.test/riunione" }));
  soniox.state.transcripts.push("Ada, domani alle nove c'è la riunione?");
  const sent = discord.say({ content: "", flags: 1 << 13, attachments: [discord.attachment("voice-message.ogg", RECORDING, "audio/ogg")] });

  const spoken = await waitFor(() => discord.state.botPosts.find((post) => post.token === "ada-token" && post.flags === 1 << 13), { what: "Ada's voice message" });
  const written = discord.state.botPosts.find((post) => post.token === "ada-token" && !post.flags);
  assert.equal(written.content, "Sì Sam, alle **nove** in sala grande: https://example.test/riunione", "the written answer goes out as always");
  assert.ok(discord.state.botPosts.indexOf(written) < discord.state.botPosts.indexOf(spoken), "words first, then the voice");
  assert.equal(spoken.file, "voice-message.ogg");
  assert.equal(spoken.fileType, "audio/ogg");
  assert.equal(spoken.fileBytes.subarray(0, 4).toString("ascii"), "OggS");
  assert.equal(spoken.content, undefined, "a Discord voice message carries no text");
  assert.ok(Math.abs(spoken.attachments[0].duration_secs - 0.6) < 0.05);
  assert.equal(Buffer.from(spoken.attachments[0].waveform, "base64").length, 128);

  assert.equal(soniox.state.uploads.at(-1).bytes > RECORDING.length, true, "the recording itself went to Soniox");
  assert.deepEqual(soniox.state.transcriptions.at(-1).language_hints, ["it"]);
  assert.equal(soniox.state.transcriptions.at(-1).client_reference_id, sent.id);
  assert.deepEqual(soniox.state.speech.at(-1), { model: "tts-rt-v2", language: "it", voice: "Giulia", audio_format: "wav", sample_rate: 24000, text: "Sì Sam, alle nove in sala grande:" });
  const prompt = prompts.find((item) => item.name === "Ada").text;
  assert.match(prompt, /Sam ★: \[messaggio vocale: «Ada, domani alle nove c'è la riunione\?»\]/);
  assert.match(prompt, /Sam ti ha mandato un messaggio vocale: la tua risposta finale gli arriva scritta e anche a voce/);
  const archived = app.store.recentMessages(CHANNEL).find((item) => item.id === sent.id);
  assert.equal(archived.voice, true);
  assert.equal(archived.content, "[messaggio vocale: «Ada, domani alle nove c'è la riunione?»]");
  await waitFor(() => soniox.state.deleted.length >= 2, { what: "the recording deleted on Soniox" });
  await quiet();

  // Written to, it writes back: no voice.
  const before = discord.state.botPosts.length;
  replies.set("Ada", () => ({ content: "Te lo scrivo e basta." }));
  discord.say({ content: "Ada, e per iscritto?" });
  await waitFor(() => discord.state.botPosts.some((post) => post.content === "Te lo scrivo e basta."), { what: "Ada's written answer" });
  await quiet();
  await sleep(300);
  assert.equal(discord.state.botPosts.length, before + 1, "a written message gets only a written answer");

  // Without Soniox a voice message is an attachment again, and the answer is written.
  app.voice.setKey("");
  replies.set("Ada", () => ({ content: "Non posso ascoltarlo." }));
  discord.say({ content: "Ada?", flags: 1 << 13, attachments: [discord.attachment("voice-message-2.ogg", RECORDING, "audio/ogg")] });
  await waitFor(() => discord.state.botPosts.some((post) => post.content === "Non posso ascoltarlo."), { what: "Ada's answer without Soniox" });
  await quiet();
  assert.match(prompts.filter((item) => item.name === "Ada").at(-1).text, /\[allegato: voice-message-2\.ogg http:\/\/127\.0\.0\.1:\d+\/attachments\/voice-message-2\.ogg\]/);
  assert.equal(discord.state.botPosts.filter((post) => post.flags === 1 << 13).length, 1);
});

test("an agent with no bot of its own and no voice picked answers in the speaker's language, as an audio file through the webhook", async (t) => {
  const { discord, soniox, replies, call, quiet } = await world(t);
  await call("/api/agents", { method: "POST", body: { name: "Bea", model: "ollama/test-model", chattiness: 0, tools: false } });
  replies.set("Bea", () => ({ content: "Sure, I'll be there." }));
  soniox.state.language = "en";
  soniox.state.transcripts.push("Bea, are you coming tomorrow?");
  discord.say({ content: "", attachments: [discord.attachment("memo.m4a", RECORDING, "audio/mp4")] });
  const clip = await waitFor(() => discord.state.webhookPosts.find((post) => post.username === "Bea" && post.file), { what: "Bea's audio" });
  assert.equal(discord.state.webhookPosts.find((post) => post.username === "Bea" && !post.file).content, "Sure, I'll be there.");
  assert.equal(clip.file, "messaggio-vocale.mp3");
  assert.equal(clip.fileType, "audio/mpeg");
  assert.equal(clip.content, "");
  const speech = soniox.state.speech.at(-1);
  assert.deepEqual([speech.voice, speech.language], ["Grace", "en"], "the first voice Soniox has for the language it was spoken in");
  await quiet();
});

test("say with voice sends a voice message even when nobody spoke, and its receipt says so", async (t) => {
  const { discord, soniox, replies, prompts, call, quiet } = await world(t);
  await call("/api/agents", { method: "POST", body: { name: "Cleo", model: "ollama/test-model", chattiness: 0, tools: false, voice: "Marco" } });
  let step = 0;
  replies.set("Cleo", () => (++step === 1 ? { tool_calls: [{ function: { name: "say", arguments: { text: "Ecco il vocale che mi hai chiesto.", voice: true } } }] } : { content: "PASS" }));
  discord.say({ content: "Cleo, mandami un vocale" });
  const clip = await waitFor(() => discord.state.webhookPosts.find((post) => post.username === "Cleo" && post.file), { what: "Cleo's voice" });
  assert.equal(clip.fileType, "audio/mpeg");
  assert.deepEqual([soniox.state.speech.at(-1).voice, soniox.state.speech.at(-1).text], ["Marco", "Ecco il vocale che mi hai chiesto."]);
  await quiet();
  const receipt = prompts.filter((item) => item.name === "Cleo").map((item) => item.all).find((text) => text.includes("Cora delivery receipt")) || "";
  assert.match(receipt, /"voice":"sent"/);
  assert.equal(discord.state.webhookPosts.filter((post) => post.username === "Cleo" && post.file).length, 1, "spoken once");
});

test("on Telegram a voice note is heard and answered with a voice note", async (t) => {
  const { app, telegram, soniox, replies, prompts, call, quiet } = await world(t);
  const MAIN_TG = "1111111:AAmainmainmainmainmainmainmainmainmain";
  telegram.addBot(MAIN_TG, { id: 1111111, username: "cora_main_bot", first_name: "Cora" });
  await call("/api/telegram/token", { method: "PUT", body: { token: MAIN_TG } });
  await call("/api/settings", { method: "PUT", body: { transport: "telegram", telegramChatIds: [TG_GROUP] } });
  await waitFor(() => app.telegram.state === "ready", { what: "Telegram polling" });
  await call("/api/agents", { method: "POST", body: { name: "Tina", model: "ollama/test-model", chattiness: 0, tools: false, voice: "Giulia" } });
  replies.set("Tina", () => ({ content: "Ricevuto, ci penso io." }));
  soniox.state.transcripts.push("Tina, mi ricordi di chiamare Luca?");
  const seb = { id: Number(TG_OWNER), first_name: "Seb", is_bot: false };
  telegram.push({ chat: { id: Number(TG_GROUP), type: "supergroup", title: "La banda" }, from: seb, voice: { file_id: telegram.file("voice-1", RECORDING), duration: 3, mime_type: "audio/ogg", file_size: RECORDING.length } });
  const note = await waitFor(() => telegram.state.sent.find((item) => item.method === "sendVoice"), { what: "Tina's voice note" });
  assert.equal(telegram.state.sent.find((item) => item.method === "sendMessage").text, "<b>Tina</b>\nRicevuto, ci penso io.");
  assert.deepEqual(note.file, ["voice", "voice.ogg"]);
  assert.equal(note.caption, "<b>Tina</b>", "the main bot says whose voice it is");
  assert.equal(note.duration, "1");
  assert.equal(soniox.state.uploads.at(-1).bytes > RECORDING.length, true);
  assert.match(prompts.find((item) => item.name === "Tina").text, /Seb ★: \[messaggio vocale: «Tina, mi ricordi di chiamare Luca\?»\]/);
  await quiet();
});

test("on Slack an audio clip is heard with the app's token and answered with an audio clip in the agent's own app", async (t) => {
  const { app, slack, soniox, replies, prompts, call, quiet } = await world(t);
  slack.addApp({ botToken: "xoxb-main-000000000001", appToken: "xapp-main-000000000001", id: "U0000000100", name: "cora", channels: [SLACK_CHANNEL] });
  await call("/api/slack/token", { method: "PUT", body: { botToken: "xoxb-main-000000000001", appToken: "xapp-main-000000000001" } });
  await call("/api/settings", { method: "PUT", body: { transport: "slack", slackChannelIds: [SLACK_CHANNEL] } });
  await waitFor(() => app.slack.state === "ready", { what: "the Slack socket" });
  const silvia = (await call("/api/agents", { method: "POST", body: { name: "Silvia", model: "ollama/test-model", chattiness: 0, tools: false, voice: "Giulia" } })).data;
  slack.addApp({ botToken: "xoxb-silvia-00000000001", appToken: "xapp-silvia-00000000001", id: "U0000000101", name: "silvia", channels: [SLACK_CHANNEL] });
  await call(`/api/agents/${silvia.id}/slack-bot`, { method: "PUT", body: { botToken: "xoxb-silvia-00000000001", appToken: "xapp-silvia-00000000001" } });
  await waitFor(() => app.skBots.client(silvia.id)?.state === "ready", { what: "Silvia's app" });
  replies.set("Silvia", () => ({ content: "Va bene, lo preparo." }));
  soniox.state.transcripts.push("Silvia, mi prepari il preventivo per domani?");
  slack.say({ text: "", files: [slack.file("audio_message.m4a", RECORDING, "audio/mp4", { subtype: "slack_audio" })] });
  const clip = await waitFor(() => slack.state.posts.find((post) => post.file), { what: "Silvia's audio clip" });
  assert.equal(clip.app, "silvia", "shared by her own app");
  assert.equal(slack.state.posts.find((post) => !post.file).text, "Va bene, lo preparo.");
  assert.deepEqual([slack.state.slots.at(-1).filename, slack.state.slots.at(-1).app], ["messaggio-vocale.mp3", "silvia"]);
  assert.equal(slack.state.uploads.at(-1).type, "audio/mpeg");
  assert.equal(soniox.state.uploads.length, 1, "two apps heard it, it was transcribed once");
  assert.match(prompts.find((item) => item.name === "Silvia").text, /Sam ★: \[messaggio vocale: «Silvia, mi prepari il preventivo per domani\?»\]/);
  await quiet();
});
