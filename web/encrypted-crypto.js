const encoder = new TextEncoder(), decoder = new TextDecoder();
export const to64 = (value) => { let out = ""; for (const c of new Uint8Array(value)) out += String.fromCharCode(c); return btoa(out).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); };
export const from64 = (value) => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
const random = (n) => crypto.getRandomValues(new Uint8Array(n));
export const documentId = () => "ed_" + [...random(12)].map((n) => n.toString(16).padStart(2, "0")).join("");
export const credentialName = (folder, name = "") => `Cora · ${name || "Spazio cifrato"} · ${folder}`;
const wrapAad = (folder, item) => encoder.encode(`cora:${folder}:method:${item.kind}:${item.salt}`);
async function credentialRequest(operation, options, signal) {
  if (signal?.aborted) throw new DOMException("", "AbortError");
  const pending = navigator.credentials[operation]({ ...options, signal });
  if (!signal) return pending;
  let abort;
  const cancelled = new Promise((resolve, reject) => { abort = () => reject(new DOMException("", "AbortError")); signal.addEventListener("abort", abort, { once: true }); });
  try { return await Promise.race([pending, cancelled]); }
  finally { signal.removeEventListener("abort", abort); }
}
async function wrappingKey(folder, item, password = "", create = false, signal, name = "") {
  if (item.kind === "password") {
    if (create && password.length < 14) throw Error("Usa almeno 14 caratteri per la password.");
    const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", iterations: 600000, salt: from64(item.salt) }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  if (!navigator.credentials || !window.PublicKeyCredential) throw Error("Questo browser non supporta le passkey.");
  let seed, credential;
  try {
    if (create) {
      seed = random(32);
      credential = await credentialRequest("create", { publicKey: { challenge: random(32), rp: { name: name ? "Cora · " + name : "Cora · Spazio cifrato", id: location.hostname }, user: { id: seed, name: `${credentialName(folder, name)} · ${item.label || "Passkey"} · ${item.salt.slice(0, 8)}`, displayName: `${name || folder} · ${item.label || "Passkey"}` }, pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }], authenticatorSelection: { residentKey: "required", userVerification: "required" }, attestation: "none", ...(item.derivation === "handle-v1" ? {} : { extensions: { prf: {} } }) } }, signal);
      if (!credential) throw Error("Creazione della passkey annullata.");
      item.credentialId = credential.id;
      if (item.derivation === "auto") item.derivation = credential.getClientExtensionResults?.().prf?.enabled === true ? "prf-v1" : "handle-v1";
    }
    const compatible = item.derivation === "handle-v1";
    let output, authenticatorData;
    if (compatible && create) {
      output = seed;
      authenticatorData = credential.response.getAuthenticatorData();
    } else {
      const assertion = await credentialRequest("get", { publicKey: { challenge: random(32), rpId: location.hostname, allowCredentials: [{ type: "public-key", id: from64(item.credentialId) }], userVerification: "required", ...(compatible ? {} : { extensions: { prf: { eval: { first: from64(item.salt) } } } }) } }, signal);
      authenticatorData = assertion?.response?.authenticatorData;
      output = compatible ? assertion?.response?.userHandle : assertion?.getClientExtensionResults().prf?.results?.first;
    }
    const flags = new Uint8Array(authenticatorData || []);
    if (flags.length < 37 || !(flags[32] & 1) || !(flags[32] & 4)) throw Error("La passkey non conferma la verifica dell’utente. Riprova sbloccando il gestore.");
    if (!output || new Uint8Array(output).byteLength !== 32) throw Error(compatible ? "Il gestore non restituisce il dato necessario alla passkey. Usa un altro metodo." : "La passkey non restituisce PRF. Riprova con il gestore originale o usa un altro metodo già configurato.");
    try {
      const material = await crypto.subtle.importKey("raw", output, "HKDF", false, ["deriveKey"]);
      return await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: compatible ? from64(item.salt) : encoder.encode("cora:encrypted-space:v1"), info: encoder.encode(compatible ? `cora:encrypted-space:handle-v1:${folder}` : folder) }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    } finally { new Uint8Array(output).fill(0); }
  } finally { seed?.fill(0); }
}
export async function protectBundle(folder, bundle, kind, password = "", label = "", derivation = "auto", signal, name = "") {
  const method = { kind, label, ...(kind === "passkey" ? { derivation } : {}), salt: to64(random(32)), iv: to64(random(12)), ...(kind === "password" ? { iterations: 600000 } : {}) };
  const key = await wrappingKey(folder, method, password, true, signal, name);
  method.ciphertext = to64(await crypto.subtle.encrypt({ name: "AES-GCM", iv: from64(method.iv), additionalData: wrapAad(folder, method) }, key, encoder.encode(JSON.stringify(bundle))));
  return method;
}
export async function createFolderKeys(folder, kind, password, label = "", derivation = "auto", signal, name = "") {
  const rsa = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
  const signing = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const bundle = { v: 1, folder, privateKey: await crypto.subtle.exportKey("jwk", rsa.privateKey), signingKey: await crypto.subtle.exportKey("jwk", signing.privateKey) };
  return { publicKey: await crypto.subtle.exportKey("jwk", rsa.publicKey), signingKey: await crypto.subtle.exportKey("jwk", signing.publicKey), methods: [await protectBundle(folder, bundle, kind, password, label, derivation, signal, name)] };
}
export async function unlockBundle(folder, method, password = "", signal) {
  try {
    const key = await wrappingKey(folder, method, password, false, signal);
    const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: from64(method.iv), additionalData: wrapAad(folder, method) }, key, from64(method.ciphertext));
    const bundle = JSON.parse(decoder.decode(bytes)); new Uint8Array(bytes).fill(0);
    if (bundle.folder !== folder || bundle.v !== 1) throw Error("wrong folder");
    return bundle;
  } catch (error) {
    if (error.name === "AbortError") throw Error("Sblocco annullato. Puoi riprovare.");
    if (error.name === "NotAllowedError" || error.message.includes("PRF")) throw error;
    throw Error("Sblocco non riuscito. Controlla password, passkey e cartella.");
  }
}
export async function encryptDocument(publicKey, content, aad) {
  const key = random(32), iv = random(12);
  try {
    const aes = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
    const rsa = await crypto.subtle.importKey("jwk", publicKey, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
    return { v: 1, iv: to64(iv), aad: to64(encoder.encode(aad)), ciphertext: to64(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(aad) }, aes, encoder.encode(content))), key: to64(await crypto.subtle.encrypt("RSA-OAEP", rsa, key)) };
  } finally { key.fill(0); }
}
export async function decryptDocument(bundle, envelope, expectedAad = "") {
  if (expectedAad && decoder.decode(from64(envelope.aad)) !== expectedAad) throw Error("Il documento cifrato non corrisponde alla versione richiesta.");
  const rsa = await crypto.subtle.importKey("jwk", bundle.privateKey, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
  const raw = await crypto.subtle.decrypt("RSA-OAEP", rsa, from64(envelope.key));
  try {
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    return decoder.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: from64(envelope.iv), additionalData: from64(envelope.aad) }, key, from64(envelope.ciphertext)));
  } finally { new Uint8Array(raw).fill(0); }
}
export async function proveAccess(api, folder, bundle, method, intent) {
  const challenge = await api(`/api/encrypted/folders/${folder}/challenge`, { method: "POST", body: { method: method.id, intent } });
  const key = await crypto.subtle.importKey("jwk", bundle.signingKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  return { id: challenge.id, signature: to64(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(JSON.stringify(challenge)))) };
}

