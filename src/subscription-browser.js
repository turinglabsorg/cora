// The official CLI launches this instead of opening a browser on the server.
// Its parent reads the authorization URL privately and exposes it only to the signed-in owner.
const value = process.argv.at(-1);
if (value?.startsWith("https://")) process.stdout.write(`${value}\n`);
