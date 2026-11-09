#!/usr/bin/env node
// usecora.space: the landing, the sign-in and the router to every space.
import { homedir } from "node:os";
import { join } from "node:path";
import { createCloud } from "./src/app.js";
import { CloudStore } from "./src/store.js";

const env = process.env;
const config = {
  domain: env.CORA_CLOUD_DOMAIN || "usecora.space",
  publicOrigin: env.CORA_CLOUD_ORIGIN || "",
  seed: env.CORA_CLOUD_SEED || "",
  insecureCookies: env.CORA_CLOUD_INSECURE_COOKIES === "1",
  // The space that hears about waitlist sign-ups (its Cora needs CORA_CLOUD_KEY).
  notify: env.CORA_CLOUD_NOTIFY || "",
  waitlistWebhookUrl: env.CORA_WAITLIST_WEBHOOK_URL || "",
  // Sign-in links for shares: Resend from usecora.space, or Cora's ambox mailbox without it.
  mail: {
    resendKey: env.CORA_CLOUD_RESEND_API_KEY || "", from: env.CORA_CLOUD_MAIL_FROM || "Cora <cora@usecora.space>",
    url: env.CORA_CLOUD_AMBOX_URL || "https://ambox.dev", key: env.CORA_CLOUD_AMBOX_API_KEY || "",
  },
  googleConnector: { origin: env.CORA_CONNECTORS_ORIGIN || "https://connect.fluxkit.dev", redirectUri: "https://ubercal.fluxkit.dev/auth/google/callback", clientSecret: env.FLUXKIT_GOOGLE_CLIENT_SECRET || "" },
  clients: {
    google: { id: env.GOOGLE_CLIENT_ID || "", secret: env.GOOGLE_CLIENT_SECRET || "" },
    github: { id: env.GITHUB_CLIENT_ID || "", secret: env.GITHUB_CLIENT_SECRET || "" },
  },
};
const store = new CloudStore(env.CORA_CLOUD_HOME || join(homedir(), ".cora-cloud"));
const log = (event) => console.log(JSON.stringify({ at: new Date().toISOString(), ...event }));
const { server, publicKey } = createCloud({ config, store, log });
const port = Number(env.PORT || env.CORA_CLOUD_PORT || 4380);
server.listen(port, env.CORA_CLOUD_LISTEN_HOST || "127.0.0.1", () => {
  log({ type: "listening", port, domain: config.domain, publicKey, waitlistNotifications: config.waitlistWebhookUrl ? "discord-webhook" : config.notify ? "space" : "off", signIn: { google: Boolean(config.clients.google.secret), github: Boolean(config.clients.github.secret) } });
});
const stop = () => {
  server.close(() => { store.close(); process.exit(0); });
  // Open event streams never end by themselves: without this the old process lingers, no longer listening.
  server.closeAllConnections();
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
