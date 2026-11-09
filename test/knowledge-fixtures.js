import { createHash, createHmac, randomBytes } from "node:crypto";
import { startCora } from "../src/main.js";
import { fakeDocker, fakeOllama, tempHome } from "./helpers.js";

export async function knowledgeWorld(overrides = {}) {
  const previousReply = fakeOllama.current;
  const state = { answer: () => ({ content: "PASS" }) };
  const ollama = await fakeOllama((body) => {
    const system = body.messages[0]?.content || "";
    if (system.startsWith("Scrivi la condizione di completamento")) return { content: "NESSUNO" };
    if (system.startsWith("Giudichi se un compito è finito")) return { content: JSON.stringify({ met: true }) };
    if (system.startsWith("Sei il bibliotecario")) return { content: JSON.stringify({ pages: [] }) };
    return state.answer(body);
  });
  const app = startCora({ home: tempHome(), host: "127.0.0.1", port: 0, insecureCookies: true, adminPassword: "fixture-password", sessionKey: "owner-knowledge-fixture",
    ownerMemory: true, brainDatabaseUrl: "pglite:memory", brainEmbedUrl: ollama.url, vapidKey: "fixture-owner-vapid",
    discordToken: "", telegramToken: "", slackToken: "", slackAppToken: "", ollamaUrl: ollama.url, ollamaKey: "", orcaKey: "", deepseekKey: "", sonioxKey: "", cloudUrl: "", cloudKey: "", cloudSpace: "", mailDomain: "", mailRegistrationToken: "",
    claudeBin: "/missing/claude", codexBin: "/missing/codex", grokBin: "/missing/grok", museBin: "/missing/muse", hermesBin: "/missing/hermes", deepseekBin: "/missing/dsh", useResidentSubscriptions: false,
    botTokenFor: () => "", docker: fakeDocker().path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys", storeSecret: async () => {}, ...overrides });
  await app.ready; await app.companyBrain.ready;
  app.librarian.requestRun = () => false;
  const base = "http://127.0.0.1:" + app.server.address().port;
  const login = await fetch(base + "/api/login", { method: "POST", headers: { "X-Cora": "1", "Content-Type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
  const admin = { headers: { Cookie: login.headers.get("set-cookie").split(";")[0] } };
  const policy = app.store.accessPolicy(); app.store.updateAccessPolicy({ emails: [...policy.emails, "alice@owner.test", "bob@owner.test"] });
  const actors = Object.fromEntries(["alice", "bob"].map((name) => {
    const user = app.store.registerPanelUser({ id: "owner-" + name, name, email: name + "@owner.test", emailVerified: true, role: "member", source: "fixture" });
    const token = randomBytes(32).toString("base64url"), hash = createHash("sha256").update(token).digest("hex");
    app.store.createPanelSession(hash, user.id, Date.now() + 3600000);
    const signature = createHmac("sha256", "owner-knowledge-fixture").update("session.v2." + token).digest("base64url");
    return [name, { user, headers: { Cookie: "cora_session=v2." + token + "." + signature } }];
  }));
  const request = async (actor, path, { method = "GET", body } = {}) => {
    const response = await fetch(base + path, { method, headers: { ...actor.headers, "X-Cora": "1", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  return { app, base, state, ollama, admin, ...actors, request, close: async () => { for (const state of app.orchestrator.states.values()) clearTimeout(state.timer); await app.stop(); await ollama.close(); fakeOllama.current = previousReply; } };
}
