const DB = "cora-encrypted-browser", STORE = "passwords";
const userEpochs = new Map(), scopeEpochs = new Map();
const encoder = new TextEncoder(), decoder = new TextDecoder();
export function canRememberPassword() {
  try { return Boolean(globalThis.isSecureContext && globalThis.indexedDB && globalThis.crypto?.subtle && globalThis.localStorage); }
  catch { return false; }
}
function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error("Memoria del browser non disponibile."));
  });
}
async function access(mode, action) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode), result = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || Error("Memoria del browser non disponibile."));
    });
  } finally { db.close(); }
}
const scope = (user, folder) => JSON.stringify([user, folder]);
const generationKey = (user, folder) => JSON.stringify(folder ? [user, folder, "generation"] : [user]);
const revocationKey = (user, folder) => "cora.encrypted.revocation." + generationKey(user, folder);
const revocations = (user, folder) => [localStorage.getItem(revocationKey(user)), localStorage.getItem(revocationKey(user, folder))];
const revoke = (user, folder) => { try { localStorage.setItem(revocationKey(user, folder), crypto.randomUUID()); return true; } catch { return false; } };
const currentRecord = (user, folder, record) => JSON.stringify(record.revocations || [null, null]) === JSON.stringify(revocations(user, folder));

async function fingerprint(method) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify([method.id, method.salt, method.iv, method.ciphertext]))))].map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function forgetPassword(user, folder) {
  if (!canRememberPassword() || !user) return;
  const id = scope(user, folder); scopeEpochs.set(id, (scopeEpochs.get(id) || 0) + 1);
  const revoked = revoke(user, folder);
  try { await access("readwrite", store => { store.put(crypto.randomUUID(), generationKey(user, folder)); return store.delete(id); }); }
  catch (error) { if (!revoked) throw Error("Cartella bloccata in questa pagina, ma la memoria del browser non è stata cancellata. Riprova il lucchetto prima di ricaricare."); throw error; }
}
async function storeRemembered(user, folder, method, password, mode) {
  if (!canRememberPassword() || !user || !["password", "passkey"].includes(method.kind) || !password) throw Error("Memoria del browser non disponibile.");
  const id = scope(user, folder), userEpoch = userEpochs.get(user), scopeEpoch = scopeEpochs.get(id), savedRevocations = revocations(user, folder), revision = await fingerprint(method);
  const userGeneration = await access("readonly", store => store.get(generationKey(user)));
  const folderGeneration = await access("readonly", store => store.get(generationKey(user, folder)));
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = encoder.encode(password);
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(id + revision + mode) }, key, bytes);
    await access("readwrite", store => {
      const userRequest = store.get(generationKey(user));
      userRequest.onsuccess = () => {
        if (userRequest.result !== userGeneration) return;
        const folderRequest = store.get(generationKey(user, folder));
        folderRequest.onsuccess = () => {
          if (folderRequest.result === folderGeneration && userEpochs.get(user) === userEpoch && scopeEpochs.get(id) === scopeEpoch && JSON.stringify(savedRevocations) === JSON.stringify(revocations(user, folder))) store.put({ key, iv, ciphertext, method: method.id, revision, mode, revocations: savedRevocations }, id);
        };
      };
    });
  } finally { bytes.fill(0); }
}
async function recalledValue(user, folder, methods, mode) {
  if (!canRememberPassword() || !user) return null;
  const id = scope(user, folder), record = await access("readonly", store => store.get(id));
  if (!record || record.mode !== mode || !currentRecord(user, folder, record)) return null;
  const method = methods.find(m => m.id === record.method);
  if (!method || await fingerprint(method) !== record.revision) { await forgetPassword(user, folder); return null; }
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv, additionalData: encoder.encode(id + record.revision + mode) }, record.key, record.ciphertext);
    try { return currentRecord(user, folder, record) ? { method: method.id, password: decoder.decode(plain) } : null; }
    finally { new Uint8Array(plain).fill(0); }
  } catch { await forgetPassword(user, folder); return null; }
}
export const rememberPassword = (user, folder, method, password) => storeRemembered(user, folder, method, password, "password");
export const recalledPassword = (user, folder, methods) => recalledValue(user, folder, methods, "password");
export const rememberAccess = (user, folder, method, bundle) => storeRemembered(user, folder, method, JSON.stringify(bundle), "access");
export async function recalledAccess(user, folder, methods) {
  const saved = await recalledValue(user, folder, methods, "access");
  if (!saved) return null;
  try {
    const bundle = JSON.parse(saved.password);
    if (bundle.folder !== folder || bundle.v !== 1) throw Error("Invalid remembered access");
    return { method: saved.method, bundle };
  } catch { await forgetPassword(user, folder); return null; }
}
export async function rememberedAccessMethod(user, folder, methods) {
  if (!canRememberPassword() || !user) return null;
  const record = await access("readonly", store => store.get(scope(user, folder)));
  if (!record || record.mode !== "access" || !currentRecord(user, folder, record)) return null;
  const method = methods.find(m => m.id === record.method);
  if (!method || await fingerprint(method) !== record.revision) { await forgetPassword(user, folder); return null; }
  return currentRecord(user, folder, record) ? record.method : null;
}
export async function forgetUserPasswords(user) {
  if (!canRememberPassword() || !user) return;
  userEpochs.set(user, (userEpochs.get(user) || 0) + 1);
  const revoked = revoke(user);
  try { await access("readwrite", store => {
    const request = store.openCursor();
    request.onsuccess = () => { const cursor = request.result; if (!cursor) { store.put(crypto.randomUUID(), generationKey(user)); return; } try { if (JSON.parse(cursor.key)[0] === user) cursor.delete(); } catch { cursor.delete(); } cursor.continue(); };
  }); }
  catch (error) { if (!revoked) throw Error("La memoria del browser non è stata cancellata. Riprova Esci prima di chiudere la pagina."); throw error; }
}
