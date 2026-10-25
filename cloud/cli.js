#!/usr/bin/env node
// Managing usecora.space by hand while spaces are opened a few at a time.
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { passKeys } from "../src/pass.js";
import { CloudStore } from "./src/store.js";

const USAGE = `usage:
  cloud/cli.js space add <name> --upstream <url> [--owner <account-id>] [--name <person>] [--google <email>]... [--github <login>]...
  cloud/cli.js space list
  cloud/cli.js requests
  cloud/cli.js invite <account-id> --google <email> | --github <login>
  cloud/cli.js public-key          (needs CORA_CLOUD_SEED, e.g. through hush run)`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    upstream: { type: "string" }, owner: { type: "string" }, name: { type: "string" },
    google: { type: "string", multiple: true }, github: { type: "string", multiple: true },
  },
});
const store = new CloudStore(process.env.CORA_CLOUD_HOME || join(homedir(), ".cora-cloud"));
const [command, sub, arg] = positionals;
const invite = (accountId) => {
  for (const email of values.google || []) store.invite(accountId, "google", email);
  for (const login of values.github || []) store.invite(accountId, "github", login);
};

try {
  if (command === "space" && sub === "add" && arg && values.upstream) {
    const owner = values.owner ? store.account(values.owner) : store.createAccount({ name: values.name || "" });
    if (!owner) throw new Error(`no account ${values.owner}`);
    invite(owner.id);
    const space = store.addSpace({ slug: arg, accountId: owner.id, upstream: values.upstream });
    console.log(`space ${space.slug} → ${space.upstream}, owned by ${owner.id}`);
  } else if (command === "space" && sub === "list") {
    for (const space of store.spaces()) console.log(`${space.slug}\t${space.upstream}\t${space.accountId}`);
  } else if (command === "requests") {
    for (const request of store.requests()) console.log(`${request.slug}\t${request.name} <${request.email}>\t${new Date(request.createdAt).toISOString()}\t${request.note}`);
  } else if (command === "invite" && sub && (values.google || values.github)) {
    if (!store.account(sub)) throw new Error(`no account ${sub}`);
    invite(sub);
    console.log("invited");
  } else if (command === "public-key") {
    if (!process.env.CORA_CLOUD_SEED) throw new Error("CORA_CLOUD_SEED is not set");
    console.log(passKeys(process.env.CORA_CLOUD_SEED).publicKey);
  } else {
    console.log(USAGE);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  store.close();
}
