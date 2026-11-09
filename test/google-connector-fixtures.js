import http from "node:http";
import { createCloud } from "../cloud/src/app.js";
import { CloudStore } from "../cloud/src/store.js";
import { tempHome } from "./helpers.js";

export async function googleConnectorFixture(t, instance) {
  const requests = [], sent = [];
  const google = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString("utf8");
    const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    requests.push({ path: req.url, method: req.method, body: text, authorization: req.headers.authorization });
    if (req.url === "/token") {
      const fields = new URLSearchParams(text);
      if (fields.get("client_secret") !== "fixture-google-client-secret") return send(401, {});
      if (fields.get("grant_type") === "authorization_code") return send(200, { access_token: "fixture-google-initial-access", refresh_token: "fixture-google-refresh", scope: "openid email https://www.googleapis.com/auth/gmail.send", expires_in: 3600 });
      if (fields.get("refresh_token") === "fixture-google-refresh") return send(200, { access_token: "fixture-google-access", expires_in: 3600 });
      return send(401, {});
    }
    if (req.url === "/userinfo") return send(200, { sub: "fixture-google-user", email: "robin+google@ambox.dev", email_verified: true });
    if (req.url === "/gmail/messages/send") {
      if (req.headers.authorization !== "Bearer fixture-google-access") return send(401, {});
      sent.push(Buffer.from(JSON.parse(text).raw, "base64url").toString("utf8"));
      return send(200, { id: `gmail_${sent.length}`, threadId: "gmail_thread" });
    }
    return send(404, {});
  });
  await new Promise((resolve) => google.listen(0, "127.0.0.1", resolve));
  const googleBase = `http://127.0.0.1:${google.address().port}`;
  const reservation = http.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const store = new CloudStore(tempHome());
  const owner = store.createAccount({ name: "Fixture" });
  store.addSpace({ slug: "fixture", accountId: owner.id, upstream: instance.base, publicUrl: "https://fixture.usecora.test" });
  const cloud = createCloud({ config: { domain: "127.0.0.1", publicOrigin: base, seed: "fixture cloud connector seed of sufficient length", insecureCookies: true,
    googleConnector: { clientId: "fixture-google-client", clientSecret: "fixture-google-client-secret" },
  }, store, endpoints: { googleConnector: { authorize: `${googleBase}/authorize`, token: `${googleBase}/token`, userinfo: `${googleBase}/userinfo` } } });
  await new Promise((resolve) => cloud.server.listen(port, "127.0.0.1", resolve));
  instance.app.googleConnector.enabled = true;
  instance.app.googleConnector.broker = base;
  instance.app.googleConnector.space = "fixture";
  instance.app.googleConnector.api = `${googleBase}/gmail`;
  t.after(async () => { cloud.server.closeAllConnections(); await new Promise((resolve) => cloud.server.close(resolve)); store.close(); google.closeAllConnections(); await new Promise((resolve) => google.close(resolve)); });
  const connect = async () => {
    const started = await instance.call("/api/connectors/google", { method: "POST" });
    const cookie = started.headers.get("set-cookie").split(";")[0];
    const start = await fetch(started.data.url, { redirect: "manual" });
    const authorize = new URL(start.headers.get("location"));
    const callback = new URL(authorize.searchParams.get("redirect_uri"));
    callback.search = new URLSearchParams({ state: authorize.searchParams.get("state"), code: "fixture-google-code" });
    const back = await fetch(callback, { redirect: "manual" });
    const target = new URL(back.headers.get("location"));
    const response = await fetch(`${instance.base}${target.pathname}${target.search}`, { headers: { Cookie: cookie }, redirect: "manual" });
    return { response, authorize, target, cookie };
  };
  return { base, connect, requests, sent, store };
}
