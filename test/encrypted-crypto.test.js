import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { protectBundle, unlockBundle } from "../web/encrypted-crypto.js";

const folder = "synthetic-auto-passkey", bundle = { v: 1, folder, synthetic: "PRIVATE_SYNTHETIC_BUNDLE" };
function authenticator(t, prf) {
  const saved = new Map(["navigator", "window", "location"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const state = { createCalls: 0, getCalls: 0, uv: true, missingPrf: false, changedHandle: false, cancelled: false, pending: false, seed: null, prf: randomBytes(32), id: randomBytes(32).toString("base64url") };
  const flags = () => { const data = new Uint8Array(37); data[32] = state.uv ? 5 : 1; return data; };
  const credentials = {
    async create({ publicKey }) {
      state.createCalls++; if (state.pending) return new Promise(() => {});
      if (state.cancelled) throw new DOMException("Cancelled", "NotAllowedError");
      assert.equal(publicKey.authenticatorSelection.userVerification, "required");
      state.seed = Uint8Array.from(publicKey.user.id);
      assert.deepEqual(publicKey.extensions, { prf: {} });
      return { id: state.id, getClientExtensionResults: () => prf === undefined ? {} : { prf: { enabled: prf } }, response: { getAuthenticatorData: () => flags() } };
    },
    async get({ publicKey }) {
      state.getCalls++; if (state.pending) return new Promise(() => {});
      if (state.cancelled) throw new DOMException("Cancelled", "NotAllowedError");
      assert.equal(publicKey.userVerification, "required");
      assert.equal(Buffer.from(publicKey.allowCredentials[0].id).toString("base64url"), state.id);
      const handle = Uint8Array.from(state.seed); if (state.changedHandle) handle[0] ^= 1;
      return { response: { authenticatorData: flags(), userHandle: handle }, getClientExtensionResults: () => state.missingPrf ? {} : { prf: { results: { first: Uint8Array.from(state.prf) } } } };
    },
  };
  for (const [name, value] of [["navigator", { credentials }], ["window", { PublicKeyCredential: true }], ["location", { hostname: "localhost" }]]) Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => { for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } state.seed?.fill(0); state.prf.fill(0); });
  return state;
}
for (const supported of [true, false, undefined]) test(`automatic passkey enrollment and fresh-wrapper recovery: PRF ${supported}`, async t => {
  const a = authenticator(t, supported);
  const method = await protectBundle(folder, bundle, "passkey", "", "Personal passkey");
  assert.equal(method.derivation, supported ? "prf-v1" : "handle-v1");
  const wire = JSON.stringify(method);
  assert.ok(!wire.includes(Buffer.from(a.seed).toString("base64url")));
  assert.ok(!wire.includes(Buffer.from(a.prf).toString("base64url")));
  assert.ok(!wire.includes(bundle.synthetic));
  assert.equal(a.getCalls, supported ? 1 : 0);
  assert.deepEqual(await unlockBundle(folder, JSON.parse(wire)), bundle);
  assert.equal(a.createCalls, 1);
  assert.equal(a.getCalls, supported ? 2 : 1);
});
test("advertised PRF failure never silently creates compatible wrapping", async t => {
  const a = authenticator(t, true); a.missingPrf = true;
  await assert.rejects(protectBundle(folder, bundle, "passkey"), /PRF/);
  assert.equal(a.createCalls, 1); assert.equal(a.getCalls, 1);
});
test("saved PRF and legacy PRF wrappers refuse missing PRF without mutation or new credential", async t => {
  const a = authenticator(t, true);
  const method = await protectBundle(folder, bundle, "passkey");
  const legacy = { ...method }; delete legacy.derivation;
  assert.deepEqual(await unlockBundle(folder, legacy), bundle);
  a.missingPrf = true; const before = JSON.stringify(method);
  await assert.rejects(unlockBundle(folder, method), /PRF/);
  await assert.rejects(unlockBundle(folder, legacy), /PRF/);
  assert.equal(JSON.stringify(method), before); assert.equal(a.createCalls, 1);
});
for (const supported of [true, false]) test(`automatic mode refuses missing user verification: PRF ${supported}`, async t => {
  const a = authenticator(t, supported); a.uv = false;
  await assert.rejects(protectBundle(folder, bundle, "passkey"), /verifica/);
  a.uv = true; const method = await protectBundle(folder, bundle, "passkey");
  a.uv = false; await assert.rejects(unlockBundle(folder, method));
  a.uv = true; assert.deepEqual(await unlockBundle(folder, method), bundle);
});
test("compatible wrapping refuses changed handles and tampered ciphertext, then recovers", async t => {
  const a = authenticator(t, false), method = await protectBundle(folder, bundle, "passkey");
  a.changedHandle = true; await assert.rejects(unlockBundle(folder, method)); a.changedHandle = false;
  const tampered = { ...method, ciphertext: (method.ciphertext[0] === "A" ? "B" : "A") + method.ciphertext.slice(1) };
  await assert.rejects(unlockBundle(folder, tampered));
  assert.deepEqual(await unlockBundle(folder, method), bundle);
});
test("enrollment cancellation never selects a fallback and retry succeeds", async t => {
  const a = authenticator(t, false); a.cancelled = true;
  await assert.rejects(protectBundle(folder, bundle, "passkey"), { name: "NotAllowedError" });
  assert.equal(a.createCalls, 1); assert.equal(a.getCalls, 0);
  a.cancelled = false;
  assert.deepEqual(await unlockBundle(folder, await protectBundle(folder, bundle, "passkey")), bundle);
});
test("explicit abort interrupts pending enrollment without waiting for the manager", async t => {
  const a = authenticator(t, false); a.pending = true;
  const controller = new AbortController(), pending = protectBundle(folder, bundle, "passkey", "", "", "auto", controller.signal);
  controller.abort(); await assert.rejects(pending, { name: "AbortError" });
  assert.equal(a.getCalls, 0); a.pending = false;
  assert.deepEqual(await unlockBundle(folder, await protectBundle(folder, bundle, "passkey")), bundle);
});
