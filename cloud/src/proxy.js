import http from "node:http";
import net from "node:net";

/**
 * A space's address answers with that space's Cora: requests, event streams
 * and WebSockets (the desktop) pass through as they are, Host included, so
 * the space sees its own public name.
 */
const HOP = new Set(["connection", "keep-alive", "proxy-connection", "te", "trailer", "upgrade"]);

function forwardHeaders(req) {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) if (!HOP.has(name)) headers[name] = value;
  headers["x-forwarded-proto"] = "https";
  headers["x-forwarded-host"] = req.headers.host || "";
  return headers;
}

export function proxyRequest(req, res, upstream, { onError }) {
  const target = new URL(upstream);
  const outgoing = http.request({
    host: target.hostname, port: target.port || 80, method: req.method, path: req.url, headers: forwardHeaders(req),
  }, (incoming) => {
    const headers = {};
    for (const [name, value] of Object.entries(incoming.headers)) if (!HOP.has(name)) headers[name] = value;
    res.writeHead(incoming.statusCode, incoming.statusMessage, headers);
    res.flushHeaders();
    incoming.pipe(res);
    res.on("close", () => incoming.destroy());
  });
  outgoing.on("error", (error) => {
    if (!res.headersSent) onError(error);
    else res.destroy();
  });
  req.pipe(outgoing);
  req.on("aborted", () => outgoing.destroy());
}

export function proxyUpgrade(req, socket, head, upstream) {
  const target = new URL(upstream);
  const peer = net.connect(Number(target.port || 80), target.hostname, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    lines.push(`X-Forwarded-Proto: https`, `X-Forwarded-Host: ${req.headers.host || ""}`);
    peer.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head?.length) peer.write(head);
    peer.pipe(socket);
    socket.pipe(peer);
  });
  const close = () => { peer.destroy(); socket.destroy(); };
  peer.on("error", close);
  socket.on("error", close);
  peer.on("close", () => socket.destroy());
  socket.on("close", () => peer.destroy());
}
