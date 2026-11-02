import { runProcess } from "./box.js";

/**
 * Soniox: how agents hear voice messages (speech to text) and how they answer in a voice
 * of their own (text to speech). The rule is fixed: a voice message gets a spoken answer.
 * One key per instance; without it agents see a voice message as an attachment, as before.
 */
export const VOICE_LANGUAGES = ["it", "en", "es", "fr", "de", "pt"];
export const AUDIO_LIMIT_BYTES = 25 * 1024 * 1024;
const STT_MODEL = "stt-async-v5";
const TTS_MODEL = "tts-rt-v2";
const SPEECH_LIMIT = 2000;
const CATALOG_MS = 60 * 60 * 1000;

// Soniox's voices speak every language but say their accent only in words: the language a voice sounds native in.
const ACCENTS = [
  ["it", /\bItalian\b/i],
  ["es", /\b(Spanish|Mexican|Argentin\w*|Colombian|Castilian|Latin American|Chilean|Peruvian)\b/i],
  ["fr", /\b(French|Parisian|Qu[ée]b[ée]c\w*)\b/i],
  ["de", /\b(German|Austrian|Bavarian)\b/i],
  ["pt", /\b(Portuguese|Brazilian|Lisbon)\b/i],
  ["en", /\b(English|American|British|Australian|Irish|Scottish|Canadian|Southern|Texan|Californian|London|Cockney)\b/i],
];

export function accentOf(description) {
  return ACCENTS.find(([, words]) => words.test(String(description || "")))?.[0] || "";
}

export class VoiceError extends Error {}

/** What a voice says of a written reply: no markdown, no code, no raw links or mentions. */
export function speakable(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<?https?:\/\/[^\s>]+>?/g, " ")
    .replace(/<[@#][!&]?\d+>/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/[*_~>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SPEECH_LIMIT);
}

/** Length and a 0–255 loudness outline of a 16-bit PCM WAV, the shape Discord draws on a voice message. */
export function wavShape(wav, points = 128) {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF") return { duration: 0, waveform: Buffer.alloc(0) };
  let offset = 12, rate = 24000, channels = 1, bits = 16, data = null;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "fmt ") { channels = wav.readUInt16LE(offset + 10); rate = wav.readUInt32LE(offset + 12); bits = wav.readUInt16LE(offset + 22); }
    if (id === "data") { data = wav.subarray(offset + 8, Math.min(wav.length, offset + 8 + size)); break; }
    offset += 8 + size + (size % 2);
  }
  if (!data || bits !== 16) return { duration: 0, waveform: Buffer.alloc(0) };
  const samples = Math.floor(data.length / 2 / channels);
  const duration = samples / rate;
  const waveform = Buffer.alloc(Math.min(points, Math.max(1, samples)));
  const step = Math.max(1, Math.floor(samples / waveform.length));
  let peak = 1;
  const levels = [];
  for (let point = 0; point < waveform.length; point++) {
    let sum = 0;
    for (let index = point * step; index < Math.min(samples, (point + 1) * step); index++) {
      const value = data.readInt16LE(index * 2 * channels);
      sum += value * value;
    }
    const level = Math.sqrt(sum / step);
    levels.push(level);
    peak = Math.max(peak, level);
  }
  for (let point = 0; point < waveform.length; point++) waveform[point] = Math.round((levels[point] / peak) * 255);
  return { duration, waveform };
}

export class Voice {
  constructor({ key = "", api = "https://api.soniox.com", ttsUrl = "https://tts-rt.soniox.com/tts", ffmpeg = "ffmpeg", timeoutMs = 120000 } = {}) {
    this.key = key;
    this.api = api.replace(/\/$/, "");
    this.ttsUrl = ttsUrl;
    this.ffmpeg = ffmpeg;
    this.timeoutMs = timeoutMs;
    this.catalog = null;
    this.encoder = null;
  }

  get enabled() { return Boolean(this.key); }

  setKey(key) {
    this.key = String(key || "");
    this.catalog = null;
  }

  async request(url, init = {}, key = this.key) {
    if (!key) throw new VoiceError("Soniox non è configurato");
    const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${key}`, ...(init.headers || {}) }, signal: AbortSignal.timeout(init.timeoutMs || 30000) });
    if (!response.ok) {
      let message = "";
      try { message = (await response.json()).message || ""; } catch {}
      throw new VoiceError(`Soniox ${response.status}${message ? `: ${String(message).slice(0, 200)}` : ""}`);
    }
    return response;
  }

  /** Whether a key opens Soniox, before it is stored. */
  async check(key) {
    await this.request(`${this.api}/v1/models`, {}, String(key || ""));
    return true;
  }

  /** Soniox's voices, cached for an hour: id, gender, languages, a line about each. */
  async voices() {
    if (this.catalog && Date.now() - this.catalog.at < CATALOG_MS) return this.catalog.voices;
    const { models = [] } = await (await this.request(`${this.api}/v1/tts-models`)).json();
    const model = models.find((item) => item.id === TTS_MODEL) || models[0] || { voices: [] };
    const voices = (model.voices || []).map((voice) => {
      const accent = accentOf(voice.description);
      return { id: String(voice.id), gender: voice.gender || "", languages: voice.languages?.length ? voice.languages : accent ? [accent] : [], description: String(voice.description || "").slice(0, 200) };
    });
    this.catalog = { at: Date.now(), voices };
    return voices;
  }

  /** The agent's chosen voice, or the first one Soniox has that sounds native in that language. */
  async voiceFor(agent, language) {
    if (agent.voice) return agent.voice;
    const voices = await this.voices();
    return (voices.find((voice) => voice.languages.includes(language)) || voices.find((voice) => !voice.languages.length) || voices[0])?.id || "";
  }

  /**
   * A voice message as text, with the language it was spoken in: upload, transcribe,
   * read, then delete both on Soniox.
   */
  async transcribe(bytes, { filename = "voice.ogg", languages = [], reference = "cora" } = {}) {
    if (!bytes?.length) throw new VoiceError("audio vuoto");
    if (bytes.length > AUDIO_LIMIT_BYTES) throw new VoiceError("audio troppo lungo");
    const form = new FormData();
    form.append("file", new Blob([bytes]), filename.replace(/[^\w.-]/g, "_").slice(-80) || "voice.ogg");
    const file = await (await this.request(`${this.api}/v1/files`, { method: "POST", body: form, timeoutMs: 60000 })).json();
    let transcription = null;
    try {
      const hints = [...new Set(languages.filter(Boolean))];
      transcription = await (await this.request(`${this.api}/v1/transcriptions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: STT_MODEL, file_id: file.id, ...(hints.length ? { language_hints: hints } : {}), enable_language_identification: true, client_reference_id: String(reference).slice(0, 200) }),
      })).json();
      const deadline = Date.now() + this.timeoutMs;
      let state = transcription;
      while (state.status !== "completed") {
        if (state.status === "error") throw new VoiceError(`trascrizione non riuscita${state.error_message ? `: ${state.error_message}` : ""}`);
        if (Date.now() > deadline) throw new VoiceError("trascrizione troppo lenta");
        await new Promise((resolve) => setTimeout(resolve, 700));
        state = await (await this.request(`${this.api}/v1/transcriptions/${transcription.id}`)).json();
      }
      const transcript = await (await this.request(`${this.api}/v1/transcriptions/${transcription.id}/transcript`)).json();
      // Each token carries the language it was heard in: the one spoken most is the message's.
      const spoken = new Map();
      for (const token of transcript.tokens || []) if (token.language) spoken.set(token.language, (spoken.get(token.language) || 0) + String(token.text || "").length);
      const language = [...spoken].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
      return { text: String(transcript.text || "").trim(), language };
    } finally {
      if (transcription?.id) this.request(`${this.api}/v1/transcriptions/${transcription.id}`, { method: "DELETE" }).catch(() => {});
      this.request(`${this.api}/v1/files/${file.id}`, { method: "DELETE" }).catch(() => {});
    }
  }

  async synthesize(text, { voice, language, format = "wav" }) {
    const spoken = speakable(text);
    if (!spoken) throw new VoiceError("niente da dire");
    if (!voice) throw new VoiceError("nessuna voce scelta");
    const response = await this.request(this.ttsUrl, {
      method: "POST", headers: { "Content-Type": "application/json" }, timeoutMs: 120000,
      body: JSON.stringify({ model: TTS_MODEL, language: language || "en", voice, audio_format: format, ...(format === "wav" ? { sample_rate: 24000 } : {}), text: spoken }),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 200) throw new VoiceError("audio vuoto da Soniox");
    return bytes;
  }

  async hasEncoder() {
    if (this.encoder === null) this.encoder = (await runProcess(this.ffmpeg, ["-hide_banner", "-version"], { timeoutMs: 10000 })).code === 0;
    return this.encoder;
  }

  async encode(wav, args) {
    const result = await runProcess(this.ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", ...args, "pipe:1"], { input: wav, timeoutMs: 60000 });
    if (result.code !== 0 || !result.stdout.length) throw new VoiceError(`ffmpeg: ${String(result.stderr).slice(0, 200)}`);
    return result.stdout;
  }

  /**
   * A reply in the agent's voice: Ogg/Opus for Discord and Telegram voice notes, MP3 for the rest,
   * with its length and loudness outline. Soniox's own Opus carries a wrong length, so it is encoded here;
   * without ffmpeg the voice still arrives, as an MP3 from Soniox.
   */
  async voiceNote(text, { voice, language }) {
    if (!(await this.hasEncoder())) {
      const mp3 = await this.synthesize(text, { voice, language, format: "mp3" });
      return { mp3, ogg: null, duration: 0, waveform: Buffer.alloc(0) };
    }
    const wav = await this.synthesize(text, { voice, language, format: "wav" });
    const { duration, waveform } = wavShape(wav);
    const [ogg, mp3] = await Promise.all([
      this.encode(wav, ["-c:a", "libopus", "-b:a", "32k", "-ar", "48000", "-ac", "1", "-f", "ogg"]),
      this.encode(wav, ["-c:a", "libmp3lame", "-b:a", "96k", "-f", "mp3"]),
    ]);
    return { ogg, mp3, duration, waveform };
  }
}
