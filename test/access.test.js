import assert from "node:assert/strict";
import { createHmac, hkdfSync } from "node:crypto";
import http from "node:http";
import { test } from "node:test";
import { startCora } from "../src/main.js";
import { passKeys, signPass, verifyPass } from "../src/pass.js";
import { createCloud } from "../cloud/src/app.js";
import { CloudStore } from "../cloud/src/store.js";
import { fakeDocker, sleep, tempHome } from "./helpers.js";

const SEED = "fixture-access-signing-seed-for-tests-only-0123456789";
const keys = passKeys(SEED);
const owner = { sub: "ac_owner", role: "owner", name: "Owner", email: "owner@example.test", emailVerified: true };
const member = { sub: "ac_member", role: "member", name: "Alice", email: "alice@company.test", emailVerified: true };

async function fixture(t, slug = "alpha") {
  const app = startCora({ home: tempHome(), host: "127.0.0.1", port: 0, insecureCookies: true,
    adminPassword: "fixture-password", sessionKey: `fixture-session-${slug}`, useResidentSubscriptions: false,
    cloudUrl: "https://usecora.test", cloudKey: keys.publicKey, cloudSpace: slug,
    discordToken: "", telegramToken: "", ollamaKey: "", orcaKey: "", claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes",
    botTokenFor: () => "", docker: fakeDocker().path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys",
  });
  await app.ready;
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = async (identity, overrides = {}) => {
    const pass = signPass(keys.privateKey, { aud: `${slug}.usecora.test`, ...identity, ...overrides });
    const response = await fetch(`${base}/auth/cloud?${new URLSearchParams({ pass })}`, { redirect: "manual" });
    return { response, cookie: response.headers.get("set-cookie")?.split(";")[0] || "", pass };
  };
  const signedIn = await login(owner);
  assert.ok(signedIn.cookie);
  const request = async (path, { method = "GET", body, cookie = signedIn.cookie, csrf = true } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, ...(csrf ? { "X-Cora": "1" } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  return { app, base, login, request, ownerCookie: signedIn.cookie };
}

test("verified domain users get separate sessions and equal operational access while policy stays owner-only", async (t) => {
  const { app, login, request, ownerCookie } = await fixture(t);
  const saved = await request("/api/access", { method: "PUT", body: { domains: ["@COMPANY.TEST"] } });
  assert.deepEqual(saved.data.domains, ["company.test"]);
  const alice = await login(member);
  const bob = await login({ ...member, sub: "ac_bob", name: "Bob", email: "bob@company.test" });
  assert.ok(alice.cookie && bob.cookie);
  assert.notEqual(alice.cookie, bob.cookie);
  assert.notEqual(alice.cookie, ownerCookie);
  const state = await request("/api/state", { cookie: alice.cookie });
  assert.equal(state.data.currentUser.id, member.sub);
  assert.equal(state.data.currentUser.role, "member");
  assert.equal(state.data.access.canManage, false);
  for (const method of ["GET", "PUT"]) assert.equal((await request("/api/access", { method, cookie: alice.cookie, ...(method === "PUT" ? { body: { domains: ["other.test"] } } : {}) })).status, 403);
  assert.equal((await request("/api/settings", { method: "PUT", cookie: alice.cookie, body: { historySize: 31 } })).status, 200);
  for (const [identity, session] of [[member, alice], [{ sub: "ac_bob", name: "Bob" }, bob]]) {
    const message = await request("/api/rooms/web/messages", { method: "POST", cookie: session.cookie, body: { text: "Fixture message", user: owner } });
    assert.equal(message.status, 201);
    assert.equal(message.data.authorId, identity.sub);
    assert.equal(message.data.authorName, identity.name);
  }
  const access = (await request("/api/access")).data;
  assert.equal(access.users.length, 3);
  assert.ok(access.users.every((user) => user.createdAt && user.lastSeenAt));
  assert.ok(access.audit.some((entry) => entry.userId === member.sub && entry.action === "settings"));
  assert.ok(access.audit.some((entry) => entry.userId === "ac_bob" && entry.action === "message"));
  assert.equal(app.store.recentMessages("web", 10).filter((item) => item.authorId === member.sub).length, 1);
  await sleep(500);
});

test("unverified, unrelated, lookalike and subdomain email addresses are refused; a single address can be admitted", async (t) => {
  const { login, request } = await fixture(t);
  await request("/api/access", { method: "PUT", body: { domains: ["company.test"] } });
  for (const changes of [{ emailVerified: false }, { email: "alice@company.test.evil.test" }, { email: "alice@sub.company.test" }, { email: "alice@other.test" }]) {
    const denied = await login({ ...member, ...changes });
    assert.equal(denied.cookie, "");
    assert.match(denied.response.headers.get("location"), /signin=refused/);
  }
  for (const domain of ["*.company.test", "company.test/path", "company.test:443", "company..test"]) assert.equal((await request("/api/access", { method: "PUT", body: { domains: [domain] } })).status, 400);
  await request("/api/access", { method: "PUT", body: { emails: ["guest@other.test"] } });
  assert.ok((await login({ ...member, email: "guest@other.test" })).cookie);
  const unverified = await login({ ...member, email: "guest@other.test", emailVerified: false });
  assert.equal(unverified.cookie, "");
});

test("revocation closes existing streams and sessions; re-enabling access requires a new login", async (t) => {
  const { base, login, request } = await fixture(t);
  await request("/api/access", { method: "PUT", body: { domains: ["company.test"] } });
  const alice = await login(member);
  const stream = await fetch(`${base}/api/events`, { headers: { Cookie: alice.cookie } });
  const reader = stream.body.getReader();
  await reader.read();
  const blocked = await request(`/api/access/users/${member.sub}`, { method: "PUT", body: { blocked: true } });
  assert.equal(blocked.status, 200);
  const revoked = await reader.read();
  assert.match(new TextDecoder().decode(revoked.value), /access-revoked/);
  assert.equal((await reader.read()).done, true);
  assert.equal((await request("/api/state", { cookie: alice.cookie })).status, 401);
  assert.equal((await login(member)).cookie, "");
  await request(`/api/access/users/${member.sub}`, { method: "PUT", body: { blocked: false } });
  assert.equal((await request("/api/state", { cookie: alice.cookie })).status, 401);
  const again = await login(member);
  assert.ok(again.cookie);
  await request("/api/access", { method: "PUT", body: { domains: [] } });
  assert.equal((await request("/api/state", { cookie: again.cookie })).status, 401);
  await request("/api/access", { method: "PUT", body: { domains: ["company.test"] } });
  assert.equal((await request("/api/state", { cookie: again.cookie })).status, 401);
  assert.equal((await request(`/api/access/users/${owner.sub}`, { method: "PUT", body: { blocked: true } })).status, 400);
  assert.equal((await request("/api/access", { method: "PUT", body: { domains: [] }, csrf: false })).status, 403);
});

test("passes and policies stay scoped to one instance and session claims cannot be edited", async (t) => {
  const alpha = await fixture(t, "alpha");
  const beta = await fixture(t, "beta");
  await alpha.request("/api/access", { method: "PUT", body: { domains: ["company.test"] } });
  const alice = await alpha.login(member);
  assert.equal((await beta.login(member)).cookie, "");
  assert.equal((await beta.request("/api/state", { cookie: alice.cookie })).status, 401);
  const wrongAudience = await alpha.login(member, { aud: "beta.usecora.test" });
  assert.equal(wrongAudience.cookie, "");
  const [payload, signature] = alice.pass.split(".");
  const fields = JSON.parse(Buffer.from(payload, "base64url"));fields.role = "owner";
  const edited = `${Buffer.from(JSON.stringify(fields)).toString("base64url")}.${signature}`;
  const refused = await fetch(`${alpha.base}/auth/cloud?${new URLSearchParams({ pass: edited })}`, { redirect: "manual" });
  assert.equal(refused.headers.get("set-cookie"), null);
  const replay = await fetch(`${alpha.base}/auth/cloud?${new URLSearchParams({ pass: alice.pass })}`, { redirect: "manual" });
  assert.equal(replay.headers.get("set-cookie"), null);
});

test("cloud entry delegates domain admission to the target instance and remembers separate member accounts", async (t) => {
  const cora = await fixture(t);
  await cora.request("/api/access", { method: "PUT", body: { domains: ["company.test"] } });
  const store = new CloudStore(tempHome());
  const cloudOwner = store.signIn("google", { subject: "google-owner", email: "owner@example.test", emailVerified: true, name: "Owner" });
  store.addSpace({ slug: "alpha", accountId: cloudOwner.id, upstream: cora.base });
  const alice = store.signIn("google", { subject: "google-alice", email: "alice@company.test", emailVerified: true, name: "Alice" });
  const denied = store.signIn("google", { subject: "google-outsider", email: "outsider@other.test", emailVerified: true });
  const unverified = store.signIn("google", { subject: "google-unverified", email: "unverified@company.test", emailVerified: false });
  const cloud = createCloud({ config: { domain: "usecora.test", publicOrigin: "http://usecora.test", insecureCookies: true, seed: SEED, clients: {} }, store });
  await new Promise((resolve) => cloud.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { cloud.server.closeAllConnections();await new Promise((resolve) => cloud.server.close(resolve));store.close(); });
  const sessionKey = Buffer.from(hkdfSync("sha256", Buffer.from(SEED), Buffer.alloc(0), Buffer.from("cora cloud session"), 32));
  const cookie = (account) => { const body = `${account.id}.${account.epoch}.${Date.now() + 60000}`;return `cora_cloud=${body}.${createHmac("sha256", sessionKey).update(`session.${body}`).digest("base64url")}`; };
  const go = (account, path = "/go/alpha") => new Promise((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port: cloud.server.address().port, path, headers: { Host: "usecora.test", Cookie: cookie(account) } }, (res) => {
      let body = "";res.on("data", (chunk) => { body += chunk; });res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });request.on("error",reject);request.end();
  });
  for (const account of [denied, unverified]) assert.equal((await go(account)).status, 403);
  const entered = await go(alice);
  assert.equal(entered.status, 302);
  const pass = new URL(entered.headers.location).searchParams.get("pass");
  const claims = verifyPass(keys.publicKey, pass, { audience: "alpha.usecora.test" });
  assert.equal(claims.role, "member");assert.equal(claims.sub,alice.id);assert.equal(claims.emailVerified,true);
  assert.notEqual(alice.id,cloudOwner.id);
  const accepted = await fetch(`${cora.base}/auth/cloud?${new URLSearchParams({ pass })}`, { redirect:"manual" });
  assert.ok(accepted.headers.get("set-cookie"));
  assert.equal((await go(alice,"/account")).body.includes("alpha"),true);
  store.signIn("google", { subject: "google-alice", email: "alice@other.test", emailVerified: true });
  assert.equal((await go(alice)).status,403,"a historical corporate email cannot confer access after the identity changes");
  assert.equal((await go(cloudOwner)).status,302);
});
