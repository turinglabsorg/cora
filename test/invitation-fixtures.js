import http from "node:http";
import net from "node:net";
import { createCloud } from "../cloud/src/app.js";
import { CloudStore } from "../cloud/src/store.js";
import { passKeys, signPass } from "../src/pass.js";
import { tempHome } from "./helpers.js";
import { knowledgeWorld } from "./knowledge-fixtures.js";

export async function invitationWorld() {
  const messages = [], state = { fail: false, wait: null };
  const mail = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (state.wait) await state.wait;
    if (state.fail) { res.writeHead(503); return res.end("fixture provider unavailable"); }
    messages.push(message);
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: "fixture-message-" + messages.length }));
  });
  await new Promise((resolve) => mail.listen(0, "127.0.0.1", resolve));
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`, seed = "invitation fixture cloud seed with enough entropy for tests";
  const keys = passKeys(seed), store = new CloudStore(tempHome());
  const owner = store.createAccount({ name: "Fixture space owner" });
  const cloud = createCloud({ store, config: { domain: "127.0.0.1", publicOrigin: base, seed, insecureCookies: true,
    mail: { resendKey: "fixture-mail-key", resendUrl: `http://127.0.0.1:${mail.address().port}` } } });
  await new Promise((resolve) => cloud.server.listen(port, "127.0.0.1", resolve));
  let f;
  const close = async () => {
    if (f) await f.close();
    cloud.server.closeAllConnections(); mail.closeAllConnections();
    await Promise.all([new Promise((resolve) => cloud.server.close(resolve)), new Promise((resolve) => mail.close(resolve))]);
    store.close();
  };
  try {
    f = await knowledgeWorld({ cloudUrl: base, cloudKey: keys.publicKey, cloudSpace: "invitation-test", publicHost: "invitation.test", googleConnectorEnabled: false }, {
    cloudLoginPass: signPass(keys.privateKey, { aud: "invitation.test", sub: "fixture-cloud-owner", role: "owner", name: "Space owner", email: "owner@invite.test", emailVerified: true }),
  });
    store.addSpace({ slug: "invitation-test", accountId: owner.id, upstream: f.base, publicUrl: "https://invitation.test" });
    return { ...f, cloud, cloudBase: base, keys, messages, state, cloudStore: store, close };
  } catch (error) { await close(); throw error; }
}
