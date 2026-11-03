/** The hush secret holding Slack's app configuration refresh token (xoxe-…). */
export const SLACK_CONFIG_SECRET = "CORA_SLACK_CONFIG_TOKEN";

// The access token lives twelve hours; it is renewed a little before.
const RENEW_BEFORE_MS = 10 * 60 * 1000;
// A sync that failed is not tried again on every tick: Slack allows these calls about once a minute.
const RETRY_AFTER_ERROR_MS = 30 * 60 * 1000;

const ERRORS = {
  invalid_refresh_token: "Slack non accetta il token di configurazione: generane uno nuovo (Your App Configuration Tokens)",
  invalid_icon_size: "l'immagine dell'agente deve essere quadrata, tra 512 e 2000 pixel",
  error_bad_format: "l'immagine dell'agente non è un'immagine che Slack legge",
  icon_not_accessible: "Slack non riesce a scaricare l'immagine dell'agente: deve essere a un indirizzo pubblico",
  app_not_found: "l'app Slack di questo agente non esiste più",
  invalid_app_id: "l'app Slack di questo agente non esiste più",
  invalid_manifest: "Slack rifiuta il manifest aggiornato",
  no_permission: "il token di configurazione è di qualcuno che non gestisce questa app",
  token_expired: "il token di configurazione è scaduto: generane uno nuovo",
  token_revoked: "il token di configurazione è stato revocato: generane uno nuovo",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Each Slack app follows the panel, with no trip to Slack's site: the name,
 * the description and the bot's name through the app's manifest, the icon from
 * the agent's image. Slack lets an app configuration token do this. It lives
 * twelve hours and is renewed with its refresh token, which changes at every
 * renewal: the newest is written back to hush, so a restart carries on.
 */
export class SlackApps {
  constructor({ store, apiBase, refreshToken = "", storeSecret = async () => {}, log = null }) {
    this.store = store;
    this.apiBase = apiBase;
    this.refreshToken = refreshToken;
    this.storeSecret = storeSecret;
    this.log = log;
    this.access = null;
    this.renewing = null;
    this.queue = Promise.resolve();
    this.appIds = new Map();
    this.team = "";
    this.error = "";
  }

  get configured() {
    return Boolean(this.refreshToken);
  }

  status() {
    return { configured: this.configured, team: this.team, error: this.error };
  }

  /** What was last done for one app (the agent's id, or "main"), as the panel shows it. */
  record(key) {
    return this.store.value("slackApps", {})[key] || null;
  }

  async call(method, params = {}, token = "") {
    const body = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) body.set(name, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(`${this.apiBase}/${method}`, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
        body,
        signal: AbortSignal.timeout(30000),
      });
      const data = await response.json().catch(() => ({}));
      if (data.ok) return data;
      if ((response.status === 429 || data.error === "ratelimited") && attempt < 2) {
        await sleep(Math.min((Number(response.headers.get("retry-after")) || 60) * 1000, 65000));
        continue;
      }
      const error = new Error(ERRORS[data.error] || `Slack ${method}: ${data.error || response.status}`);
      error.slack = data.error || "";
      throw error;
    }
  }

  /** A valid access token, renewed when it is near its end. The old refresh token is spent at once. */
  async token() {
    if (this.access && this.access.exp - Date.now() > RENEW_BEFORE_MS) return this.access.token;
    if (!this.refreshToken) throw new Error("manca il token di configurazione di Slack");
    this.renewing ||= (async () => {
      const data = await this.call("tooling.tokens.rotate", { refresh_token: this.refreshToken });
      this.refreshToken = data.refresh_token;
      try {
        await this.storeSecret(SLACK_CONFIG_SECRET, data.refresh_token);
      } catch (error) {
        this.log?.({ type: "error", text: `token di configurazione Slack non salvato in hush: ${error.message}` });
      }
      this.access = { token: data.token, exp: Number(data.exp) * 1000 || Date.now() + 12 * 3600 * 1000 };
      this.team = data.team_id || "";
      this.error = "";
      return data.token;
    })().catch((error) => {
      this.error = error.message;
      throw error;
    }).finally(() => { this.renewing = null; });
    return this.renewing;
  }

  /** The refresh token from the panel: renewed once at once, which proves it and keeps the new one. */
  async connect(refreshToken) {
    const previous = this.refreshToken;
    this.refreshToken = refreshToken;
    this.access = null;
    try {
      await this.token();
    } catch (error) {
      this.refreshToken = previous;
      throw error;
    }
    return this.status();
  }

  /** The app a bot token belongs to: the bot's id, then the bot's app. */
  async appIdFor(botToken) {
    if (this.appIds.has(botToken)) return this.appIds.get(botToken);
    const auth = await this.call("auth.test", {}, botToken);
    const info = await this.call("bots.info", { bot: auth.bot_id }, botToken);
    const appId = info.bot?.app_id;
    if (!appId) throw new Error("Slack non dice di quale app è questo bot");
    this.appIds.set(botToken, appId);
    return appId;
  }

  /** Bring one app in line with the panel. Calls go one at a time; nothing is sent when nothing changed. */
  sync(job, { force = false } = {}) {
    if (!this.configured || !job.botToken) return Promise.resolve(null);
    const run = this.queue.then(() => this.syncNow(job, force));
    this.queue = run.catch(() => {});
    return run;
  }

  async syncNow({ key, botToken, name, description = "", iconUrl = "" }, force) {
    const previous = this.record(key);
    const wanted = JSON.stringify({ name, description, iconUrl });
    if (!force && previous?.wanted === wanted && (!previous.error || Date.now() - Date.parse(previous.at) < RETRY_AFTER_ERROR_MS)) return previous;
    const record = { wanted, at: new Date().toISOString(), appId: previous?.appId || "", iconUrl: previous?.iconUrl || "", error: "" };
    try {
      const token = await this.token();
      record.appId = await this.appIdFor(botToken);
      const { manifest } = await this.call("apps.manifest.export", { app_id: record.appId }, token);
      const next = JSON.parse(JSON.stringify(manifest));
      next.display_information = { ...next.display_information, name: name.slice(0, 35) };
      if (description) next.display_information.description = description.slice(0, 139);
      if (next.features?.bot_user) next.features.bot_user = { ...next.features.bot_user, display_name: name.slice(0, 80) };
      if (JSON.stringify(next) !== JSON.stringify(manifest)) await this.call("apps.manifest.update", { app_id: record.appId, manifest: next }, token);
      if (iconUrl && (force || iconUrl !== previous?.iconUrl)) {
        await this.call("apps.icon.set", { app_id: record.appId, url: iconUrl }, token);
        record.iconUrl = iconUrl;
      }
    } catch (error) {
      record.error = error.message;
    }
    this.store.setValue("slackApps", { ...this.store.value("slackApps", {}), [key]: record });
    this.log?.(record.error
      ? { type: "warning", text: `app Slack ${name}: ${record.error}` }
      : { type: "slack", text: `app Slack ${name}: nome, descrizione e immagine allineati al pannello` });
    return record;
  }
}
