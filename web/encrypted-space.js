const encoder = new TextEncoder(), decoder = new TextDecoder();
export const to64 = (value) => { let out = ""; for (const c of new Uint8Array(value)) out += String.fromCharCode(c); return btoa(out).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); };
export const from64 = (value) => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
const random = (n) => crypto.getRandomValues(new Uint8Array(n));
const documentId = () => "ed_" + [...random(12)].map((n) => n.toString(16).padStart(2, "0")).join("");
const wrapAad = (folder, item) => encoder.encode(`cora:${folder}:method:${item.kind}:${item.salt}`);
async function wrappingKey(folder, item, password = "", create = false) {
  if (item.kind === "password") {
    if (create && password.length < 14) throw Error("Usa almeno 14 caratteri per la password.");
    const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", iterations: 600000, salt: from64(item.salt) }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  if (!navigator.credentials || !window.PublicKeyCredential) throw Error("Questo browser non supporta le passkey.");
  if (create) {
    const credential = await navigator.credentials.create({ publicKey: { challenge: random(32), rp: { name: "Cora · Spazio cifrato", id: location.hostname }, user: { id: random(32), name: folder, displayName: "Spazio cifrato · " + folder }, pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }], authenticatorSelection: { residentKey: "required", userVerification: "required" }, attestation: "none", extensions: { prf: {} } } });
    if (!credential?.getClientExtensionResults().prf?.enabled) throw Error("La passkey non supporta PRF. Usa una password o un autenticatore compatibile.");
    item.credentialId = credential.id;
  }
  const assertion = await navigator.credentials.get({ publicKey: { challenge: random(32), rpId: location.hostname, allowCredentials: [{ type: "public-key", id: from64(item.credentialId) }], userVerification: "required", extensions: { prf: { eval: { first: from64(item.salt) } } } } });
  const output = assertion?.getClientExtensionResults().prf?.results?.first;
  if (!output) throw Error("La passkey non restituisce PRF. Scegli un altro metodo di sblocco.");
  try {
    const material = await crypto.subtle.importKey("raw", output, "HKDF", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: encoder.encode("cora:encrypted-space:v1"), info: encoder.encode(folder) }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  } finally { new Uint8Array(output).fill(0); }
}
export async function protectBundle(folder, bundle, kind, password = "", label = "") {
  const method = { kind, label, salt: to64(random(32)), iv: to64(random(12)), ...(kind === "password" ? { iterations: 600000 } : {}) };
  const key = await wrappingKey(folder, method, password, true);
  method.ciphertext = to64(await crypto.subtle.encrypt({ name: "AES-GCM", iv: from64(method.iv), additionalData: wrapAad(folder, method) }, key, encoder.encode(JSON.stringify(bundle))));
  return method;
}
export async function createFolderKeys(folder, kind, password, label = "") {
  const rsa = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
  const signing = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const bundle = { v: 1, folder, privateKey: await crypto.subtle.exportKey("jwk", rsa.privateKey), signingKey: await crypto.subtle.exportKey("jwk", signing.privateKey) };
  return { publicKey: await crypto.subtle.exportKey("jwk", rsa.publicKey), signingKey: await crypto.subtle.exportKey("jwk", signing.publicKey), methods: [await protectBundle(folder, bundle, kind, password, label)] };
}
export async function unlockBundle(folder, method, password = "") {
  try {
    const key = await wrappingKey(folder, method, password);
    const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: from64(method.iv), additionalData: wrapAad(folder, method) }, key, from64(method.ciphertext));
    const bundle = JSON.parse(decoder.decode(bytes)); new Uint8Array(bytes).fill(0);
    if (bundle.folder !== folder || bundle.v !== 1) throw Error("wrong folder");
    return bundle;
  } catch (error) {
    if (["NotAllowedError", "AbortError"].includes(error.name) || error.message.includes("PRF")) throw error;
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

export function encryptedSetting(ui, agent = null) {
  const { h, btn, api, panel, switchInput, setRows, setRow, tr } = ui;
  const box = h("div", { class: "stack-sm" });
  const url = agent ? `/api/encrypted/agents/${agent.id}` : "/api/encrypted/settings";
  api(url).then((state) => {
    const name = agent ? "encryptedOnly" : "enabled";
    const toggle = switchInput(name, agent ? "Solo sessioni cifrate" : "Cifratura obbligatoria", state[name], agent ? (state.requiredBySpace ? "Obbligatoria per tutto lo spazio. Questo agente non può lavorare su file in chiaro." : "Solo sessioni cifrate. Shell, memoria e connettori esclusi.") : "Da quando è attiva, tutti i nuovi contenuti devono essere cifrati. Lo storico resta accessibile e non viene convertito. Quando è spenta, la cifratura personale resta disponibile.");
    const input = toggle.querySelector("input"); input.disabled = agent ? state.requiredBySpace : !state.canManage;
    const status = h("p", { class: "muted", role: "status" });
    input.addEventListener("change", async () => {
      input.disabled = true;
      try { await api(url, { method: "PUT", body: { [name]: input.checked } }); if (!agent) ui.policyChanged?.(input.checked); status.textContent = tr("Salvato. Lo storico resta accessibile. Disattivare l’obbligo non decifra i documenti."); migration.hidden = !input.checked || !Object.keys(state.plaintext || {}).length; }
      catch (error) { input.checked = !input.checked; status.textContent = tr(error.message); }
      finally { input.disabled = agent ? state.requiredBySpace : !state.canManage; }
    });
    const migration = h("div", { class: "encryption-warning", hidden: Boolean(agent) || !state.required || !Object.keys(state.plaintext || {}).length, role: "note" }, h("div", { class: "stack-sm" }, h("strong", {}, "Cifratura obbligatoria attiva: lo storico contiene ancora dati in chiaro."), h("p", {}, "Lo storico resta accessibile. I nuovi contenuti devono essere cifrati; nessun dato precedente viene convertito automaticamente."), btn("Apri gli artefatti", { href: "#/artefatti", cls: "sm ghost" })));
    box.replaceChildren(...(migration ? [migration] : []), setRows(setRow(agent ? "Documenti" : "Documenti e sessioni", agent ? "Sblocco temporaneo dal pannello, indipendente da Sigillato." : "La cifratura personale è sempre disponibile. L’obbligo generale non può essere aggirato dalle impostazioni degli utenti o degli agenti.", toggle, { stack: true })), status);
  }).catch((error) => box.replaceChildren(h("p", { role: "alert" }, error.message), btn("Riprova", { onclick: () => box.replaceChildren(encryptedSetting(ui, agent)) })));
  return agent ? box : panel({ icon: "lock", title: "Spazio cifrato" }, box);
}
export function encryptedSetup(ui, folder, reload) {
  const { h, btn, api, panel, tr } = ui;
  const password = h("input", { type: "password", autocomplete: "new-password", minlength: 14, "aria-label": tr("Password della cartella"), placeholder: tr("Almeno 14 caratteri") });
  const again = h("input", { type: "password", autocomplete: "new-password", "aria-label": tr("Ripeti la password"), placeholder: tr("Ripeti la password") });
  const status = h("p", { role: "status", class: "muted" });
  const create = async (kind) => {
    for (const b of root.querySelectorAll("button")) b.disabled = true;
    try {
      if (kind === "password" && password.value !== again.value) throw Error("Le password non coincidono.");
      const payload = await createFolderKeys(folder.id, kind, password.value);
      password.value = ""; again.value = "";
      await api(`/api/encrypted/folders/${folder.id}/configure`, { method: "POST", body: payload }); reload();
    } catch (error) { status.textContent = tr(error.message); }
    finally { for (const b of root.querySelectorAll("button")) b.disabled = false; }
  };
  const root = panel({ icon: "lock", title: "Spazio cifrato", hint: "Solo per cartelle vuote. Ogni cartella ha chiavi proprie; i file esistenti non vengono convertiti." },
    h("p", { class: "muted" }, "Se perdi tutti i metodi di sblocco, i documenti sono irrecuperabili."),
    h("div", { class: "stack-sm" }, password, again, h("div", { class: "row" }, btn("Proteggi con password", { cls: "primary", icon: "lock", onclick: () => create("password") }), btn("Crea passkey", { icon: "key", onclick: () => create("passkey") }))), status);
  return root;
}

export async function encryptedFolderPanel(ui, folder, current, agents, reload) {
  const { h, btn, api, panel, sectionWorkspace, tr, raw } = ui;
  const root = h("div", { class: "stack encrypted-space" });
  let data = await api(`/api/encrypted/folders/${folder.id}`), bundle = null, chosenMethod = null, selected = null, text = "";
  const status = h("p", { role: "status", class: "muted" });
  const methodSelect = h("select", { "aria-label": tr("Metodo di sblocco") }, data.folder.methods.map((m) => h("option", { value: m.id }, raw(m.label + " · " + m.kind))));
  const password = h("input", { type: "password", autocomplete: "current-password", placeholder: tr("Password della cartella"), "aria-label": tr("Password della cartella") });
  const changeMethod = () => { password.hidden = data.folder.methods.find((m) => m.id === methodSelect.value)?.kind !== "password"; password.value = ""; };
  methodSelect.addEventListener("change", changeMethod); changeMethod();
  const files = h("div", { class: "stack-sm" }), methods = h("div", { class: "stack-sm" }), requests = h("div", { class: "stack-sm" }), sharing = h("div", { class: "stack-sm" });
  const lock = () => { bundle = null; selected = null; text = ""; password.value = ""; content.value = ""; title.value = ""; files.replaceChildren(); methods.replaceChildren(); requests.replaceChildren(); sharing.replaceChildren(); unlock.hidden = false; locked.hidden = true; status.textContent = tr("Cartella bloccata."); };
  const run = async (fn) => { status.textContent = ""; try { await fn(); } catch (error) { status.textContent = tr(error.message); } };
  const proof = (intent) => proveAccess(api, folder.id, bundle, chosenMethod, intent);
  const refresh = async () => { data = await api(`/api/encrypted/folders/${folder.id}`); await draw(); };
  const title = h("input", { type: "text", "aria-label": tr("Titolo del documento"), placeholder: tr("Titolo del documento"), maxlength: 200 });
  const content = h("textarea", { rows: 14, "aria-label": tr("Documento"), placeholder: tr("Scrivi un documento da conservare cifrato…") });
  const persist = async () => {
    const version = selected?.version || 0, docId = selected?.id || documentId();
    const cipher = await encryptDocument(data.folder.publicKey, JSON.stringify({ title: title.value, content: content.value }), `cora:${folder.id}:${docId}:${version + 1}`);
    selected = await api(`/api/encrypted/folders/${folder.id}/documents`, { method: "POST", body: { id: docId, base: version, envelope: cipher, proof: await proof(`write:${docId}:${version}`) } });
    await refresh(); status.textContent = tr("Versione cifrata salvata.");
  };
  const unlock = panel({ icon: "lock", title: "Sblocca la cartella", hint: "La chiave viene aperta solo in questo browser. Non viene inviata al server." }, methodSelect, password,
    btn("Sblocca cartella", { cls: "primary", icon: "key", onclick: () => run(async () => {
      chosenMethod = data.folder.methods.find((m) => m.id === methodSelect.value);
      bundle = await unlockBundle(folder.id, chosenMethod, password.value); password.value = "";
      await api(`/api/encrypted/folders/${folder.id}/read`, { method: "POST", body: { proof: await proof("read") } });
      await refresh(); unlock.hidden = true; locked.hidden = false;
    }) }));
  const locked = h("div", { class: "stack", hidden: true });
  const readDoc = async (doc) => {
    const plain = JSON.parse(await decryptDocument(bundle, doc.envelope, `cora:${folder.id}:${doc.id}:${doc.version}`));
    selected = doc; text = plain.content || ""; title.value = plain.title || ""; content.value = text; await draw();
  };
  async function draw() {
    drawAudit();
    const rows = h("div", { class: "rows" });
    for (const doc of data.documents) {
      let name;
      try { name = JSON.parse(await decryptDocument(bundle, doc.envelope, `cora:${folder.id}:${doc.id}:${doc.version}`)).title || tr("Senza titolo"); }
      catch { name = tr("Documento non decifrabile"); }
      rows.append(h("div", { class: "row-item" }, h("span", { class: "grow" }, raw(name), h("small", { class: "muted" }, raw(` · v${doc.version} · ${doc.kind}`))), btn("Apri", { icon: "file", onclick: () => run(() => readDoc(doc)) })));
    }
    const versions = h("select", { "aria-label": tr("Versione"), onchange: (event) => run(async () => {
      if (!selected) return; const doc = await api(`/api/encrypted/folders/${folder.id}/documents?document=${selected.id}&version=${event.target.value}`); await readDoc(doc);
    }) }, [1, ...(selected ? Array.from({ length: Math.min(100, selected.version - 1) }, (_, i) => i + 2) : [])].map((n) => h("option", { value: n, selected: selected?.version === n }, raw("v" + n))));
    files.replaceChildren(panel({ icon: "file", title: "Documenti cifrati" }, rows, btn("Nuovo documento", { icon: "plus", onclick: () => { selected = null; title.value = ""; content.value = ""; draw(); } })),
      panel({ icon: "file", title: "Documento", hint: "Titolo e contenuto sono salvati cifrati. Le versioni precedenti restano disponibili." }, title, content, h("div", { class: "row" }, versions, btn("Salva cifrato", { cls: "primary", icon: "check", onclick: () => run(persist) }), btn("Esporta", { icon: "download", disabled: !selected, onclick: () => run(async () => {
        await api(`/api/encrypted/folders/${folder.id}/export`, { method: "POST", body: { document: selected.id, version: selected.version, proof: await proof(`export:${selected.id}:${selected.version}`) } });
        const url = URL.createObjectURL(new Blob([content.value], { type: "text/plain" })); const link = document.createElement("a"); link.href = url; link.download = (title.value || "document") + ".txt"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }) }))));
    const addPassword = h("input", { type: "password", autocomplete: "new-password", placeholder: tr("Nuova password · almeno 14 caratteri"), "aria-label": tr("Nuova password") });
    const methodName = h("input", { type: "text", maxlength: 80, placeholder: tr("Nome, es. telefono personale"), "aria-label": tr("Nome del metodo") });
    const addMethod = async (kind) => {
      const label = methodName.value.trim() || (kind === "passkey" ? "Passkey" : "Password") + " " + (data.folder.methods.filter((m) => m.kind === kind).length + 1);
      const item = await protectBundle(folder.id, bundle, kind, addPassword.value, label);
      addPassword.value = "";
      await api(`/api/encrypted/folders/${folder.id}/methods`, { method: "PUT", body: { add: item, proof: await proof("methods") } }); lock(); reload();
    };
    methods.replaceChildren(panel({ icon: "key", title: "Metodi di sblocco", hint: "Password e più passkey possono convivere. Aggiungi il metodo alternativo prima di rimuovere quello precedente." },
      h("div", { class: "rows" }, data.folder.methods.map((item) => h("div", { class: "row-item" }, h("span", { class: "grow" }, raw(item.label), h("small", { class: "muted" }, raw(" · " + item.kind))), btn("Rimuovi", { cls: "ghost danger", disabled: data.folder.methods.length === 1, onclick: () => run(async () => {
        await api(`/api/encrypted/folders/${folder.id}/methods`, { method: "PUT", body: { remove: item.id, proof: await proof("methods") } }); lock(); reload();
      }) })))), methodName, addPassword, h("div", { class: "row" }, btn("Aggiungi password", { icon: "plus", onclick: () => run(() => addMethod("password")) }), btn("Aggiungi passkey", { icon: "key", onclick: () => run(() => addMethod("passkey")) }))));
    const agent = h("select", { "aria-label": tr("Agente") }, agents.map((a) => h("option", { value: a.id }, raw(a.name))));
    const operation = h("select", { "aria-label": tr("Operazione") }, h("option", { value: "read" }, "Lettura e analisi"), h("option", { value: "edit" }, "Proposta di modifica"));
    const instruction = h("textarea", { rows: 3, "aria-label": tr("Istruzione privata"), placeholder: tr("Istruzione privata per questa sessione…") });
    const requestList = h("div", { class: "rows" });
    for (const request of data.requests) {
      const actions = [];
      if (request.state === "pending" && request.expires > Date.now()) actions.push(btn("Sblocca e autorizza", { cls: "primary", icon: "key", onclick: () => run(async () => {
        const document = await api(`/api/encrypted/folders/${folder.id}/documents?document=${request.document}&version=${request.version}`);
        const plain = await decryptDocument(bundle, document.envelope, `cora:${folder.id}:${document.id}:${document.version}`);
        const pending = api(`/api/encrypted/requests/${request.id}/approve`, { method: "POST", body: { content: plain, instruction: instruction.value, proof: await proof(`approve:${request.id}`) } });
        status.textContent = tr("Sessione privata in corso. Puoi revocarla; il contenuto non passa in chat.");
        await pending; instruction.value = ""; await refresh();
      }) }));
      if (["pending", "running"].includes(request.state)) actions.push(btn("Revoca", { cls: "ghost danger", onclick: () => run(async () => { await api(`/api/encrypted/requests/${request.id}`, { method: "DELETE" }); await refresh(); }) }));
      if (request.result) actions.push(btn("Apri risultato", { icon: "file", onclick: () => run(async () => {
        const plain = JSON.parse(await decryptDocument(bundle, request.result, `cora:${folder.id}:session:${request.session}`));
        answer.value = plain.answer || ""; reasoning.value = plain.reasoning || "";
      }) }));
      requestList.append(h("div", { class: "row-item encrypted-request" }, h("span", { class: "grow" }, raw(`${agents.find((a) => a.id === request.agent)?.name || request.agent} · ${request.operation} · ${request.state}`), h("small", { class: "muted" }, raw(` · v${request.version} · ${new Date(request.expires).toLocaleTimeString()}`))), ...actions));
    }
    const answer = h("textarea", { rows: 6, readonly: true, "aria-label": tr("Risultato e ragionamento cifrati") });
    const reasoning = h("textarea", { rows: 6, readonly: true, "aria-label": tr("Ragionamento cifrato") });
    const result = h("div", { class: "stack-sm" }, h("h3", { class: "label" }, "Risultato privato"), answer, h("details", {}, h("summary", {}, "Ragionamento"), reasoning));
    requests.replaceChildren(panel({ icon: "shield", title: "Accessi temporanei", hint: "Durante l’accesso autorizzato worker e modello ricevono il contenuto selezionato in chiaro. La revoca impedisce gli accessi futuri, ma non ritira ciò che hanno già ricevuto." },
      h("p", { class: "muted" }, "Sessione separata, senza strumenti né uscite in chat. Risultato e ragionamento restano cifrati. Sono supportati i modelli Ollama e OrcaRouter."),
      h("div", { class: "row" }, agent, operation, btn("Richiedi accesso", { icon: "plus", disabled: !selected, onclick: () => run(async () => {
        await api(`/api/encrypted/folders/${folder.id}/requests`, { method: "POST", body: { agent: agent.value, document: selected.id, version: selected.version, operation: operation.value } }); await refresh();
      }) })), instruction, requestList, result));
    const accept = h("input", { type: "checkbox", checked: data.folder.acceptShares, onchange: () => run(async () => {
      await api(`/api/encrypted/folders/${folder.id}/methods`, { method: "PUT", body: { acceptShares: accept.checked, proof: await proof("methods") } }); lock(); reload();
    }) });
    const recipients = await api("/api/encrypted/recipients");
    const recipient = h("select", { "aria-label": tr("Destinatario") }, recipients.map((r) => h("option", { value: r.id }, raw(`${r.name} · ${r.title}`))));
    sharing.replaceChildren(panel({ icon: "link", title: "Condivisione cifrata", hint: "La copia viene ricifrata con una nuova chiave per la cartella del destinatario. La persona deve accettarla." },
      h("label", { class: "row" }, accept, "Accetta proposte cifrate dal team"),
      h("div", { class: "row" }, recipient, btn("Proponi copia cifrata", { disabled: !selected || !recipients.length, onclick: () => run(async () => {
        const target = recipients.find((r) => r.id === recipient.value);
        const source = await decryptDocument(bundle, selected.envelope, `cora:${folder.id}:${selected.id}:${selected.version}`);
        const targetDocument = documentId();
        const cipher = await encryptDocument(target.publicKey, source, `cora:${target.id}:${targetDocument}:1`);
        await api(`/api/encrypted/folders/${folder.id}/share`, { method: "POST", body: { target: target.id, targetDocument, document: selected.id, version: selected.version, envelope: cipher, proof: await proof(`share:${selected.id}:${selected.version}:${target.id}:${targetDocument}`) } });
        status.textContent = tr("Copia cifrata proposta al destinatario.");
      }) })), ...data.inbox.map((delivery) => h("div", { class: "row-item" }, h("span", { class: "grow" }, "Documento cifrato ricevuto"), btn("Accetta", { onclick: () => run(async () => {
        await decryptDocument(bundle, delivery.envelope, `cora:${folder.id}:${delivery.document}:1`);
        await api(`/api/encrypted/folders/${folder.id}/receive`, { method: "POST", body: { delivery: delivery.id, accept: true, proof: await proof(`accept:${delivery.id}`) } }); await refresh();
      }) }), btn("Rifiuta", { cls: "ghost danger", onclick: () => run(async () => { await api(`/api/encrypted/folders/${folder.id}/receive`, { method: "POST", body: { delivery: delivery.id, accept: false } }); await refresh(); }) })))));
  }
  const audit = h("div", { class: "stack-sm" });
  function drawAudit() { audit.replaceChildren(panel({ icon: "clock", title: "Registro degli accessi", hint: "Persona, metodo, agente, operazione ed esito. Nessun contenuto o chiave." }, h("div", { class: "rows" }, data.audit.map((entry) => h("div", { class: "row-item" }, h("span", { class: "grow" }, raw(`${entry.event} · ${entry.outcome}`), h("small", { class: "muted" }, raw(`${new Date(entry.at).toLocaleString()} · ${entry.actor} · ${entry.method || "—"} · ${entry.agent || "—"}`)))))))); }
  drawAudit();
  locked.append(h("div", { class: "row end" }, btn("Blocca cartella", { icon: "lock", onclick: lock })), sectionWorkspace({ title: "Spazio cifrato", base: `#/artefatti/${folder.id}`, current, entries: [
    ["file", "Documenti", "file", "File e versioni cifrate", [files]], ["accessi", "Accessi", "shield", "Autorizzazioni temporanee", [requests]], ["condivisione", "Condivisione", "link", "Copie per i destinatari", [sharing]], ["cifratura", "Cifratura", "key", "Password e passkey", [methods]], ["registro", "Registro", "clock", "Accessi e operazioni", [audit]],
  ] }));
  let idle = null;
  const touch = () => { clearTimeout(idle); idle = setTimeout(lock, 5 * 60000); };
  for (const event of ["pointerdown", "keydown", "input"]) root.addEventListener(event, touch);
  const leave = () => { if (!location.hash.startsWith(`#/artefatti/${folder.id}`)) { lock(); clearTimeout(idle); window.removeEventListener("hashchange", leave); } };
  window.addEventListener("hashchange", leave); touch();
  root.append(unlock, locked, status); return root;
}
