import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import http from "node:http";
import { Discord } from "../src/discord.js";
import { Slack } from "../src/slack.js";
import { logTransitions } from "../src/connection-log.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, what, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (check()) return;
    await wait(20);
  }
  assert.fail(`timed out waiting for ${what}`);
}

/**
 * A WebSocket server that can stop answering while keeping TCP open, like a
 * peer or an edge gone deaf: no frames out, and never a closing handshake.
 */
async function socketServer(t, onConnection) {
  const server = http.createServer();
  const connections = [];
  server.on("upgrade", (req, socket) => {
    const accept = crypto.createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const conn = {
      socket,
      deaf: false,
      received: [],
      send(data) {
        if (conn.deaf || socket.destroyed) return;
        const body = Buffer.from(typeof data === "string" ? data : JSON.stringify(data));
        const head = body.length < 126 ? Buffer.from([0x81, body.length]) : Buffer.from([0x81, 126, body.length >> 8, body.length & 255]);
        socket.write(Buffer.concat([head, body]));
      },
      ping() {
        if (!conn.deaf && !socket.destroyed) socket.write(Buffer.from([0x89, 0x00]));
      },
    };
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 15;
        let length = buffer[1] & 127;
        let offset = 2;
        if (length === 126) { length = buffer.readUInt16BE(2); offset = 4; }
        if (buffer.length < offset + 4 + length) return;
        const mask = buffer.subarray(offset, offset + 4);
        const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length).map((byte, index) => byte ^ mask[index % 4]));
        buffer = buffer.subarray(offset + 4 + length);
        // A deaf peer reads nothing and never answers a close.
        if (conn.deaf || opcode !== 1) continue;
        const message = JSON.parse(payload.toString("utf8"));
        conn.received.push(message);
        conn.onMessage?.(message);
      }
    });
    socket.on("error", () => {});
    connections.push(conn);
    onConnection(conn, connections.length, req);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    for (const conn of connections) conn.socket.destroy();
    return new Promise((resolve) => server.close(resolve));
  });
  return { url: `ws://127.0.0.1:${server.address().port}`, connections };
}

function discordGateway(t, { hello = true, interval = 150 } = {}) {
  return socketServer(t, (conn) => {
    if (hello) conn.send({ op: 10, d: { heartbeat_interval: interval } });
    conn.onMessage = (message) => {
      if (message.op === 1) conn.send({ op: 11 });
      if (message.op === 2) conn.send({ op: 0, t: "READY", s: 1, d: { user: { id: "1", username: "bot" }, session_id: "sess" } });
      if (message.op === 6) conn.send({ op: 0, t: "RESUMED", s: 2, d: {} });
    };
  });
}

function discordClient(t, url, options = {}) {
  const client = new Discord({ token: "x", apiBase: "http://127.0.0.1:9", gatewayUrl: url, ...options });
  t.after(() => client.stop());
  return client;
}

test("a Discord connection that stops acknowledging heartbeats is replaced and resumed without waiting for its close", async (t) => {
  const gateway = await discordGateway(t);
  const client = discordClient(t, gateway.url);
  const states = [];
  client.on("status", ({ state }) => states.push(state));
  let resumed = 0;
  client.on("resumed", () => { resumed += 1; });
  client.start();
  await until(() => client.state === "ready" && client.sessionId === "sess", "first session");
  gateway.connections[0].deaf = true;
  await until(() => gateway.connections.length === 2, "a second connection", 3000);
  await until(() => gateway.connections[1].received.some((message) => message.op === 6), "a resume on the new connection");
  assert.equal(gateway.connections[1].received.find((message) => message.op === 6).d.session_id, "sess");
  await until(() => resumed === 1 && client.state === "ready", "the resumed session");
  assert.ok(states.includes("reconnecting"), "the outage is visible as a state");
  assert.equal(gateway.connections[0].socket.destroyed, false, "the old peer never closed: the client did not wait for it");
});

test("a Discord gateway that never says Hello is left and dialled again", async (t) => {
  const gateway = await discordGateway(t, { hello: false });
  const client = discordClient(t, gateway.url, { helloTimeoutMs: 200 });
  client.start();
  await until(() => gateway.connections.length >= 2, "a second connection", 3000);
});

test("op 7 reconnects even when the old connection never finishes closing", async (t) => {
  const gateway = await discordGateway(t);
  const client = discordClient(t, gateway.url);
  client.start();
  await until(() => client.state === "ready", "first session");
  gateway.connections[0].send({ op: 7, d: null });
  gateway.connections[0].deaf = true;
  await until(() => gateway.connections.length === 2, "a second connection", 3000);
  await until(() => gateway.connections[1].received.some((message) => message.op === 6), "a resume");
});

function slackClient(t, url, liveness) {
  const client = new Slack({ botToken: "xoxb-test", appToken: "xapp-test", socketUrl: url, liveness: { everyMs: 25, ...liveness } });
  client.user = { id: "U1", name: "bot" };
  t.after(() => client.stop());
  return client;
}

test("a Slack socket that stops pinging is replaced, and the new hello reports ready again", async (t) => {
  const timers = [];
  t.after(() => timers.forEach(clearInterval));
  const server = await socketServer(t, (conn) => {
    conn.send({ type: "hello" });
    timers.push(setInterval(() => conn.ping(), 40));
  });
  const client = slackClient(t, server.url, { pingSilenceMs: 300, quietSilenceMs: 60000 });
  let ready = 0;
  client.on("ready", () => { ready += 1; });
  client.start();
  await until(() => ready === 1, "first hello");
  await wait(600);
  assert.equal(server.connections.length, 1, "a socket that keeps pinging is kept even with no events");
  server.connections[0].deaf = true;
  await until(() => server.connections.length === 2, "a second socket", 3000);
  await until(() => ready === 2 && client.state === "ready", "ready again");
});

test("each Slack socket hears only its own pings", async (t) => {
  const timers = [];
  t.after(() => timers.forEach(clearInterval));
  const server = await socketServer(t, (conn, _n, req) => {
    conn.send({ type: "hello" });
    if (req.url.includes("alive")) timers.push(setInterval(() => conn.ping(), 40));
  });
  const alive = slackClient(t, `${server.url}/alive`, { pingSilenceMs: 300, quietSilenceMs: 60000 });
  const silent = slackClient(t, `${server.url}/silent`, { pingSilenceMs: 300, quietSilenceMs: 400 });
  alive.start();
  silent.start();
  await until(() => alive.state === "ready" && silent.state === "ready", "both connected");
  await until(() => server.connections.length >= 3, "the silent socket replaced", 3000);
  assert.equal(alive.watch.pinged, true);
  assert.notEqual(silent.watch?.pinged, true, "pings of another socket are not credited to this one");
});

test("a Slack socket that never says hello is dialled again", async (t) => {
  const server = await socketServer(t, () => {});
  const client = slackClient(t, server.url, { helloMs: 150, pingSilenceMs: 60000, quietSilenceMs: 60000 });
  client.start();
  await until(() => server.connections.length >= 2, "a second socket", 3000);
});

test("outages are written down once, with how long they lasted; routine recycles are not warnings", async () => {
  const client = new EventEmitter();
  const entries = [];
  logTransitions(client, (entry) => entries.push(entry), { type: "discord", agentId: "a1", label: "bot Discord" });
  client.emit("status", { state: "ready" });
  client.emit("status", { state: "reconnecting", error: "no heartbeat acknowledgement" });
  client.emit("status", { state: "connecting" });
  client.emit("status", { state: "reconnecting", error: "fetch failed" });
  client.emit("status", { state: "ready" });
  client.emit("status", { state: "reconnecting", error: "Discord asked to reconnect" });
  client.emit("status", { state: "ready" });
  assert.equal(entries.length, 4);
  assert.equal(entries[0].type, "warning");
  assert.match(entries[0].text, /collegamento perso \(no heartbeat acknowledgement\)/);
  assert.match(entries[1].text, /di nuovo in ascolto dopo \d+ s e 2 tentativi/);
  assert.equal(entries[2].type, "discord");
  assert.match(entries[2].text, /rinnovato/);
  assert.ok(entries.every((entry) => entry.agentId === "a1"));
});
