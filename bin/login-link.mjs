#!/usr/bin/env node
// A one-time link into the panel for when usecora.space cannot be reached (valid 10 minutes).
// Run it on the host with the session key, e.g.:
//   hush run --name CORA_SESSION_KEY --env CORA_SESSION_KEY --redact -- node bin/login-link.mjs [base-url]
import { loginLinkToken } from "../src/web.js";

const key = process.env.CORA_SESSION_KEY || process.env.CORO_SESSION_KEY;
if (!key) {
  console.error("CORA_SESSION_KEY is not set");
  process.exit(1);
}
const base = (process.argv[2] || `http://127.0.0.1:${process.env.CORA_PORT || 4370}`).replace(/\/$/, "");
console.log(`${base}/auth/link?token=${encodeURIComponent(loginLinkToken(key))}`);
