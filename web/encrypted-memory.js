const DB = "cora-encrypted-browser", STORE = "passwords";
const userEpochs = new Map(), scopeEpochs = new Map();
const encoder = new TextEncoder(), decoder = new TextDecoder();
export function canRememberPassword() {
  try { return Boolean(globalThis.isSecureContext && globalThis.indexedDB && globalThis.crypto?.subtle); }
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
async function fingerprint(method) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify([method.id, method.salt, method.iv, method.ciphertext]))))].map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function forgetPassword(user, folder) {
  if (!canRememberPassword() || !user) return;
  const id = scope(user, folder); scopeEpochs.set(id, (scopeEpochs.get(id) || 0) + 1);
  await access("readwrite", store => { store.put(crypto.randomUUID(), generationKey(user, folder)); return store.delete(id); });
}
export async function rememberPassword(user, folder, method, password) {
  if (!canRememberPassword() || !user || method.kind !== "password" || !password) throw Error("Memoria del browser non disponibile.");
  const id = scope(user, folder), userEpoch = userEpochs.get(user), scopeEpoch = scopeEpochs.get(id), revision = await fingerprint(method);
  const userGeneration = await access("readonly", store => store.get(generationKey(user)));
  const folderGeneration = await access("readonly", store => store.get(generationKey(user, folder)));
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = encoder.encode(password);
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(id + revision) }, key, bytes);
    await access("readwrite", store => {
      const userRequest = store.get(generationKey(user));
      userRequest.onsuccess = () => {
        if (userRequest.result !== userGeneration) return;
        const folderRequest = store.get(generationKey(user, folder));
        folderRequest.onsuccess = () => {
          if (folderRequest.result === folderGeneration && userEpochs.get(user) === userEpoch && scopeEpochs.get(id) === scopeEpoch) store.put({ key, iv, ciphertext, method: method.id, revision }, id);
        };
      };
    });
  } finally { bytes.fill(0); }
}
export async function recalledPassword(user, folder, methods) {
  if (!canRememberPassword() || !user) return null;
  const id = scope(user, folder), record = await access("readonly", store => store.get(id));
  if (!record) return null;
  const method = methods.find(m => m.id === record.method && m.kind === "password");
  if (!method || await fingerprint(method) !== record.revision) { await forgetPassword(user, folder); return null; }
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv, additionalData: encoder.encode(id + record.revision) }, record.key, record.ciphertext);
    try { return { method: method.id, password: decoder.decode(plain) }; }
    finally { new Uint8Array(plain).fill(0); }
  } catch { await forgetPassword(user, folder); return null; }
}
export async function forgetUserPasswords(user) {
  if (!canRememberPassword() || !user) return;
  userEpochs.set(user, (userEpochs.get(user) || 0) + 1);
  await access("readwrite", store => {
    const request = store.openCursor();
    request.onsuccess = () => { const cursor = request.result; if (!cursor) { store.put(crypto.randomUUID(), generationKey(user)); return; } try { if (JSON.parse(cursor.key)[0] === user) cursor.delete(); } catch { cursor.delete(); } cursor.continue(); };
  });
}
