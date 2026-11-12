import { canRememberPassword, rememberPassword, recalledPassword, forgetPassword, rememberAccess, recalledAccess, rememberedAccessMethod } from "./encrypted-memory.js";
import { createFolderKeys, protectBundle, unlockBundle, encryptDocument, decryptDocument, proveAccess, documentId, credentialName } from "./encrypted-crypto.js";
import { encryptedConversations } from "./encrypted-chat.js";
import { encryptedFileBrowser, downloadEncryptedFile, uploadEncryptedFile } from "./encrypted-files.js";
export { createFolderKeys, protectBundle, unlockBundle, encryptDocument, decryptDocument, proveAccess, to64, from64 } from "./encrypted-crypto.js";

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
function credentialAccount(ui, folder) {
  return ui.h("input", { class: "encrypted-credential-name", type: "text", name: "username", autocomplete: "username", readonly: true, value: credentialName(folder.id, folder.title || folder.path), "aria-label": ui.tr("Nome nel gestore password") });
}
export function encryptedSetup(ui, folder, reload) {
  const { h, btn, api, panel, tr } = ui;
  const account = credentialAccount(ui, folder);
  const password = h("input", { name: "password", type: "password", autocomplete: "new-password", minlength: 14, "aria-label": tr("Password della cartella"), placeholder: tr("Almeno 14 caratteri") });
  const again = h("input", { name: "password-confirmation", type: "password", autocomplete: "new-password", "aria-label": tr("Ripeti la password"), placeholder: tr("Ripeti la password") });
  const status = h("p", { role: "status", class: "muted" });
  let setupController = null;
  const cancelSetup = h("button", { class: "btn ghost", hidden: true, onclick: () => setupController?.abort() }, "Annulla");
  const create = async (kind, derivation = "auto") => {
    setupController = new AbortController(); cancelSetup.hidden = false;
    for (const b of root.querySelectorAll("button")) b.disabled = true;
    cancelSetup.disabled = false;
    try {
      if (kind === "password" && password.value !== again.value) throw Error("Le password non coincidono.");
      const payload = await createFolderKeys(folder.id, kind, password.value, kind === "passkey" ? "Passkey" : "", derivation, setupController.signal, folder.title || folder.path);
      if (setupController.signal.aborted) throw new DOMException("", "AbortError");
      password.value = ""; again.value = "";
      await api(`/api/encrypted/folders/${folder.id}/configure`, { method: "POST", body: payload }); reload();
    } catch (error) { status.textContent = tr(error.name === "AbortError" ? "Creazione annullata. Puoi riprovare." : error.message); }
    finally { setupController = null; cancelSetup.hidden = true; for (const b of root.querySelectorAll("button")) b.disabled = false; }
  };
  const root = panel({ icon: "lock", title: "Spazio cifrato", hint: "Solo per cartelle vuote. Ogni cartella ha chiavi proprie; i file esistenti non vengono convertiti." },
    h("p", { class: "muted" }, "Se perdi tutti i metodi di sblocco, i documenti sono irrecuperabili."),
    h("form", { class: "stack-sm encrypted-enrollment", onsubmit: event => { event.preventDefault(); create("password"); } }, account, password, again, h("p", { class: "muted" }, "Il metodo viene scelto automaticamente. Se il gestore non supporta la protezione avanzata, la sicurezza dipende dalla protezione del gestore stesso. Le chiavi non vengono inviate a Cora."), h("div", { class: "row encrypted-enrollment-actions" }, btn("Proteggi con password", { cls: "primary", icon: "lock", type: "submit" }), btn("Crea passkey", { icon: "key", onclick: () => create("passkey") })), cancelSetup), status);
  return root;
}

export async function encryptedFolderPanel(ui, folder, current, agents, reload) {
  const { h, btn, api, panel, sectionWorkspace, tr, raw } = ui;
  const root = h("div", { class: "stack encrypted-space" });
  let unlockController = null, sessionEpoch = 0; const activeRequests = new Set();
  let data = await api(`/api/encrypted/folders/${folder.id}`), bundle = null, chosenMethod = null, selected = null, text = "";
  const status = h("p", { role: "status", class: "muted" });
  const personal = data.accessGrant ? (await api(`/api/encrypted/folders/${data.accessGrant.target}`)).folder : data.folder;
  const personalFolder = data.accessGrant ? (await api(`/api/artifacts/folders/${personal.id}`)).folder : folder;
  const passwordMethods = personal.methods.filter(m => m.kind === "password"), passkeyMethods = personal.methods.filter(m => m.kind === "passkey");
  const user = ui.currentUser?.id;
  const password = h("input", { name: "password", type: "password", autocomplete: "current-password", placeholder: tr("Password della cartella"), "aria-label": tr("Password della cartella") });
  const remember = h("input", { type: "checkbox", "aria-label": tr("Ricorda accesso in questo browser"), "aria-description": tr("Solo su un dispositivo fidato. Resta in questo browser fino al lucchetto o a Esci."), disabled: !canRememberPassword() || !user });
  const rememberRow = h("label", { class: "encrypted-remember", title: tr("Solo su un dispositivo fidato. Resta in questo browser fino al lucchetto o a Esci.") }, h("span", {}, "Ricorda accesso"), remember);
  const rememberHint = h("small", { class: "muted", hidden: true }, "Solo su un dispositivo fidato. Resta in questo browser fino al lucchetto o a Esci.");
  let remembered = null, savedPasskey = null;
  try { remembered = await recalledPassword(user, personal.id, personal.methods); savedPasskey = await rememberedAccessMethod(user, personal.id, personal.methods); }
  catch { status.textContent = tr("Memoria del browser non disponibile. Puoi sbloccare normalmente."); }
  if (remembered) { password.value = remembered.password; remember.checked = true; }
  if (savedPasskey) remember.checked = true;
  remembered = null;
  remember.addEventListener("change", () => { if (!remember.checked) run(async () => { await forgetPassword(user, personal.id); savedPasskey = null; updatePasskeyLabels(); lockButton.hidden = !bundle; ui.changed?.(); }); });
  const files = h("div", { class: "stack-sm" }), methods = h("div", { class: "stack-sm" }), requests = h("div", { class: "stack-sm" }), sharing = h("div", { class: "stack-sm" });
  const lock = () => { sessionEpoch++; for (const id of activeRequests) api(`/api/encrypted/requests/${id}`, { method: "DELETE" }).catch(() => {}); activeRequests.clear(); conversations.clear(); fileControls.clear(); unlockController?.abort(); bundle = null; chosenMethod = null; selected = null; password.value = ""; lockButton.hidden = !remember.checked; ui.changed?.(); methods.replaceChildren(); requests.replaceChildren(); sharing.replaceChildren(); unlock.hidden = false; locked.hidden = true; status.textContent = tr("Cartella bloccata."); };
  const lockButton = btn("", { icon: "lock", cls: "sm art-lock", title: tr("Blocca e dimentica accesso"), onclick: () => run(async () => {
    lock();
    await forgetPassword(user, personal.id);
    remember.checked = false; savedPasskey = null; password.value = ""; updatePasskeyLabels(); lockButton.hidden = true; ui.changed?.();
  }) }); lockButton.hidden = !remember.checked;
  const run = async (fn) => { status.textContent = ""; try { await fn(); } catch (error) { status.textContent = tr(error.message); } };
  const proof = (intent) => proveAccess(api, folder.id, bundle, chosenMethod, intent);
  const refresh = async () => { data = await api(`/api/encrypted/folders/${folder.id}`); await draw(); };
  const fileControls = encryptedFileBrowser(ui, { api, folder: folder.id, path: ui.path || folder.path || folder.title, dir: ui.dir || "", state: () => ({ bundle, method: chosenMethod, publicKey: data.folder.publicKey }), documents: () => data.documents, canWrite: () => data.canWrite, refresh, persist: (doc, name, body) => persist(doc, name, body),
    decrypt: (opened, doc) => decryptDocument(opened, doc.envelope, `cora:${folder.id}:${doc.id}:${doc.version}`), select: (doc) => { selected = doc; drawRequestState(); }, go: (next) => { location.hash = `#/artefatti/${folder.id}/file${next ? `/${next.split("/").map(encodeURIComponent).join("/")}` : ""}`; } });
  const conversations = encryptedConversations(ui, { api, folder: folder.id, agents, defaultModel: ui.defaultModel, state: () => ({ bundle, method: chosenMethod, publicKey: data.folder.publicKey }) });
  const persist = async (doc, name, body) => {
    const version = doc?.version || 0, docId = doc?.id || documentId();
    const cipher = await encryptDocument(data.folder.publicKey, JSON.stringify({ title: name, content: body }), `cora:${folder.id}:${docId}:${version + 1}`);
    selected = await api(`/api/encrypted/folders/${folder.id}/documents`, { method: "POST", body: { id: docId, base: version, envelope: cipher, proof: await proof(`write:${docId}:${version}`) } });
  };
  let drawRequestState = () => {};
  files.append(fileControls.element);
  const cancelUnlock = h("button", { class: "btn ghost", hidden: true, onclick: () => unlockController?.abort() }, "Annulla sblocco");
  const unlockWith = (method = null) => run(async () => {
    if (unlockController) return;
    unlockController = new AbortController(); const signal = unlockController.signal;
    for (const button of unlock.querySelectorAll("button")) button.disabled = true;
    password.disabled = true; remember.disabled = true; cancelUnlock.hidden = false; cancelUnlock.disabled = false;
    let candidate = password.value;
    try {
      let opened, chosenPassword;
      if (method) {
        chosenMethod = method;
        if (remember.checked && savedPasskey === method.id) opened = (await recalledAccess(user, personal.id, personal.methods))?.bundle;
        if (!opened) opened = await unlockBundle(personal.id, method, "", signal);
      }
      else {
        if (!candidate && remember.checked) candidate = (await recalledPassword(user, personal.id, personal.methods))?.password || "";
        let failure;
        for (const item of passwordMethods) {
          if (signal.aborted) throw Error("Sblocco annullato. Puoi riprovare.");
          try { opened = await unlockBundle(personal.id, item, candidate, signal); chosenMethod = item; chosenPassword = item.id; break; }
          catch (error) { failure = error; }
        }
        if (!opened) throw failure || Error("Sblocco non riuscito. Controlla password, passkey e cartella.");
      }
      const personalOpened = opened;
      if (data.accessGrant) {
        const grant = data.accessGrant;
        opened = JSON.parse(await decryptDocument(opened, grant.envelope, `cora:${folder.id}:grant:${grant.id}:${grant.target}`));
        if (opened.folder !== folder.id || opened.v !== 1) throw Error("Accesso condiviso non valido.");
        chosenMethod = { id: grant.id, kind: "grant" }; bundle = opened;
        if (grant.state === "pending") await api(`/api/encrypted/folders/${folder.id}/grants`, { method: "POST", body: { id: grant.id, accept: true, proof: await proof(`grant-accept:${grant.id}`) } });
      }
      if (signal.aborted) throw Error("Sblocco annullato. Puoi riprovare.");
      bundle = opened;
      await api(`/api/encrypted/folders/${folder.id}/read`, { method: "POST", body: { proof: await proof("read") } });
      if (signal.aborted) { bundle = null; throw Error("Sblocco annullato. Puoi riprovare."); }
      await refresh();
      if (signal.aborted) { lock(); throw Error("Sblocco annullato. Puoi riprovare."); }
      try {
        if (remember.checked) {
          if (method) { await rememberAccess(user, personal.id, method, personalOpened); savedPasskey = method.id; }
          else { await rememberPassword(user, personal.id, personal.methods.find(m => m.id === chosenPassword), candidate); savedPasskey = null; }
        } else { await forgetPassword(user, personal.id); savedPasskey = null; }
        updatePasskeyLabels();
      } catch { status.textContent = tr("Cartella sbloccata. Non è stato possibile ricordare l’accesso in questo browser."); }
      if (signal.aborted) { bundle = null; return; }
      password.value = ""; unlock.hidden = true; locked.hidden = false; lockButton.hidden = false; ui.changed?.();
    } catch (error) { bundle = null; chosenMethod = null; throw error; }
    finally {
      candidate = ""; unlockController = null;
      for (const button of unlock.querySelectorAll("button")) button.disabled = false;
      password.disabled = false; remember.disabled = !canRememberPassword() || !user; cancelUnlock.hidden = true;
    }
  });
  const unlockButton = btn("", { cls: "primary encrypted-unlock-submit", icon: "key", title: "Sblocca cartella", type: "submit" });
  const passwordForm = h("form", { class: "stack-sm encrypted-password-form", hidden: !passwordMethods.length, onsubmit: event => { event.preventDefault(); unlockWith(); } },
    credentialAccount(ui, personalFolder), h("div", { class: "encrypted-unlock-field" }, password, unlockButton));
  const passkeyButtons = passkeyMethods.map(method => btn("Sblocca con passkey", { icon: "key", cls: passwordMethods.length ? "" : "primary", onclick: () => unlockWith(method) }));
  function updatePasskeyLabels() {
    passkeyButtons.forEach((button, index) => {
      const method = passkeyMethods[index];
      button.querySelector("span").textContent = savedPasskey === method.id ? tr("Apri cartella") : passkeyMethods.length === 1 ? tr("Sblocca con passkey") : tr("Sblocca con {name}", { name: method.label || "Passkey" });
    });
  }
  updatePasskeyLabels();
  const passkeys = h("div", { class: "stack-sm encrypted-passkey-actions" }, passkeyButtons);
  const unlock = panel({ icon: "lock", title: "Sblocca la cartella", cls: "encrypted-unlock" + (!passwordMethods.length && passkeyMethods.length === 1 ? " encrypted-passkey-only" : ""), hint: data.accessGrant ? "Sblocca la tua cartella personale per accettare e aprire l’accesso condiviso. I permessi restano separati dalle chiavi." : "La chiave viene aperta solo in questo browser. Non viene inviata al server." },
    !passwordMethods.length && passkeyMethods.length ? h("div", { class: "encrypted-passkey-mark", "aria-hidden": true }, ui.icon?.("face")) : null,
    passwordForm, h("div", { class: "stack-sm encrypted-unlock-footer" }, passkeys, rememberRow, rememberHint, h("div", { class: "row encrypted-unlock-options" }, cancelUnlock)));
  const locked = h("div", { class: "stack", hidden: true });
  async function draw() {
    drawAudit(); fileControls.updateAccess();
    if (bundle) await conversations.refresh();
    if (bundle) await fileControls.refresh();
    let requestButton = null, shareButton = null;
    const addPassword = h("input", { name: "password", type: "password", autocomplete: "new-password", placeholder: tr("Nuova password · almeno 14 caratteri"), "aria-label": tr("Nuova password") });
    const methodName = h("input", { type: "text", maxlength: 80, placeholder: tr("Nome, es. telefono personale"), "aria-label": tr("Nome del metodo") });
    const addMethod = async (kind, derivation = "auto") => {
      const label = methodName.value.trim() || (kind === "passkey" ? "Passkey" : "Password") + " " + (data.folder.methods.filter((m) => m.kind === kind).length + 1);
      const item = await protectBundle(folder.id, bundle, kind, addPassword.value, label, derivation, undefined, folder.title || folder.path);
      addPassword.value = "";
      await api(`/api/encrypted/folders/${folder.id}/methods`, { method: "PUT", body: { add: item, proof: await proof("methods") } }); lock(); reload();
    };
    methods.replaceChildren(panel({ icon: "key", title: "Metodi di sblocco", hint: "Password e più passkey possono convivere. Aggiungi il metodo alternativo prima di rimuovere quello precedente." },
      h("div", { class: "rows" }, data.folder.methods.map((item) => h("div", { class: "row-item" }, h("span", { class: "grow" }, raw(item.label), h("small", { class: "muted" }, raw(" · " + (item.kind === "passkey" ? tr(item.derivation === "handle-v1" ? "Protezione del gestore" : "Protezione avanzata") : item.kind)))), btn("Rimuovi", { cls: "ghost danger", disabled: data.folder.methods.length === 1, onclick: () => run(async () => {
        await api(`/api/encrypted/folders/${folder.id}/methods`, { method: "PUT", body: { remove: item.id, proof: await proof("methods") } }); lock(); reload();
      }) })))), h("form", { class: "stack-sm encrypted-add-method", onsubmit: event => { event.preventDefault(); run(() => addMethod("password")); } }, credentialAccount(ui, folder), methodName, addPassword, h("p", { class: "muted" }, "Il metodo viene scelto automaticamente. Se il gestore non supporta la protezione avanzata, la sicurezza dipende dalla protezione del gestore stesso. Le chiavi non vengono inviate a Cora."), h("div", { class: "row" }, btn("Aggiungi password", { icon: "plus", type: "submit" }), btn("Aggiungi passkey", { icon: "key", onclick: () => run(() => addMethod("passkey")) })))));
    const agent = h("select", { "aria-label": tr("Agente") }, agents.map((a) => h("option", { value: a.id }, raw(a.name))));
    const operation = h("select", { "aria-label": tr("Operazione") }, h("option", { value: "read" }, "Lettura e analisi"), h("option", { value: "edit" }, "Proposta di modifica"));
    const instruction = h("textarea", { rows: 3, "aria-label": tr("Istruzione privata"), placeholder: tr("Istruzione privata per questa sessione…") });
    const requestList = h("div", { class: "rows" });
    for (const request of data.requests) {
      const actions = [];
      if (request.state === "pending" && request.expires > Date.now()) actions.push(btn("Sblocca e autorizza", { cls: "primary", icon: "key", onclick: () => run(async () => {
        const document = await api(`/api/encrypted/folders/${folder.id}/documents?document=${request.document}&version=${request.version}`);
        const epoch = sessionEpoch;
        let plain = await decryptDocument(bundle, document.envelope, `cora:${folder.id}:${document.id}:${document.version}`);
        if (document.file) {
          const file = await downloadEncryptedFile({ api, folder: folder.id, bundle, document });
          try {
            if (!file.metadata.mime.startsWith("text/") || file.bytes.length > 1024 * 1024) throw Error("Per l’accesso del modello sono supportati file UTF-8 di testo fino a 1 MiB.");
            plain = JSON.stringify({ title: file.metadata.path, content: new TextDecoder("utf-8", { fatal: true }).decode(file.bytes) });
          } finally { file.bytes.fill(0); }
        }
        if (epoch !== sessionEpoch) return;
        activeRequests.add(request.id);
        const pending = api(`/api/encrypted/requests/${request.id}/approve`, { method: "POST", body: { content: plain, instruction: instruction.value, proof: await proof(`approve:${request.id}`) } });
        status.textContent = tr("Sessione privata in corso. Puoi revocarla; il contenuto non passa in chat.");
        try { await pending; } finally { activeRequests.delete(request.id); }
        if (epoch !== sessionEpoch) return;
        instruction.value = ""; await refresh();
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
      h("p", { class: "muted" }, "Sessione separata, senza strumenti né uscite in chat. Risultato e ragionamento restano cifrati. Modelli Ollama e OrcaRouter; documenti dell’editor e file UTF-8 di testo fino a 1 MiB."),
      h("div", { class: "row" }, agent, operation, requestButton = btn("Richiedi accesso", { icon: "plus", disabled: !selected, onclick: () => run(async () => {
        await api(`/api/encrypted/folders/${folder.id}/requests`, { method: "POST", body: { agent: agent.value, document: selected.id, version: selected.version, operation: operation.value } }); await refresh();
      }) })), instruction, requestList, result));
    const accept = h("input", { type: "checkbox", checked: data.folder.acceptShares, disabled: !data.canManage, onchange: () => run(async () => {
      await api(`/api/encrypted/folders/${folder.id}/methods`, { method: "PUT", body: { acceptShares: accept.checked, proof: await proof("methods") } }); lock(); reload();
    }) });
    if (!data.canManage) for (const control of methods.querySelectorAll("input,button")) control.disabled = true;
    const recipients = await api("/api/encrypted/recipients");
    const recipient = h("select", { "aria-label": tr("Destinatario") }, recipients.map((r) => h("option", { value: r.id }, raw(`${r.name} · ${r.title}`))));
    const grantRecipient = h("select", { "aria-label": tr("Destinatario dell’accesso") }, recipients.map(r => h("option", { value: r.id }, raw(`${r.name} · ${r.title}`))));
    const grantPanel = data.canManage ? panel({ icon: "shield", title: "Accesso alla cartella cifrata", hint: "Prima assegna Lettura o Scrittura nei Permessi, poi consegna la chiave cifrata alla cartella personale. La persona deve accettare. La revoca blocca i nuovi accessi; non ritira chiavi e copie già ottenute." },
      h("div", { class: "row" }, grantRecipient, btn("Consegna accesso cifrato", { disabled: !recipients.length, onclick: () => run(async () => {
        const target = recipients.find(r => r.id === grantRecipient.value), grantId = documentId().replace("ed_", "eg_");
        const cipher = await encryptDocument(target.publicKey, JSON.stringify(bundle), `cora:${folder.id}:grant:${grantId}:${target.id}`);
        await api(`/api/encrypted/folders/${folder.id}/grants`, { method: "POST", body: { id: grantId, target: target.id, envelope: cipher, proof: await proof(`grant:${grantId}:${target.id}`) } }); await refresh();
      }) })), ...(data.grants || []).map(grant => h("div", { class: "row-item" }, h("span", { class: "grow" }, raw(`${recipients.find(r => r.owner === grant.recipient)?.name || grant.recipient} · ${grant.state}`)), btn("Revoca accesso", { cls: "ghost danger", onclick: () => run(async () => {
        await api(`/api/encrypted/folders/${folder.id}/grants`, { method: "POST", body: { remove: grant.id, proof: await proof(`grant-remove:${grant.id}`) } }); await refresh();
      }) })))) : null;
    sharing.replaceChildren(panel({ icon: "link", title: "Condivisione cifrata", hint: "La copia viene ricifrata con una nuova chiave per la cartella del destinatario. La persona deve accettarla." },
      h("label", { class: "row" }, accept, "Accetta proposte cifrate dal team"),
      h("div", { class: "row" }, recipient, shareButton = btn("Proponi copia cifrata", { disabled: !data.canWrite || !selected || !recipients.length, onclick: () => run(async () => {
        const target = recipients.find((r) => r.id === recipient.value);
        if (selected.file) {
          const opened = await downloadEncryptedFile({ api, folder: folder.id, bundle, document: selected });
          try {
            const file = new File([opened.bytes], opened.metadata.path.split("/").at(-1), { type: opened.metadata.mime, lastModified: opened.metadata.modified });
            Object.defineProperty(file, "webkitRelativePath", { value: opened.metadata.path });
            await uploadEncryptedFile({ api, folder: folder.id, bundle, method: chosenMethod, publicKey: target.publicKey, file, share: { target: target.id, document: selected } });
            status.textContent = tr("Copia cifrata proposta al destinatario."); return;
          } finally { opened.bytes.fill(0); }
        }
        const source = await decryptDocument(bundle, selected.envelope, `cora:${folder.id}:${selected.id}:${selected.version}`);
        const targetDocument = documentId();
        const cipher = await encryptDocument(target.publicKey, source, `cora:${target.id}:${targetDocument}:1`);
        await api(`/api/encrypted/folders/${folder.id}/share`, { method: "POST", body: { target: target.id, targetDocument, document: selected.id, version: selected.version, envelope: cipher, proof: await proof(`share:${selected.id}:${selected.version}:${target.id}:${targetDocument}`) } });
        status.textContent = tr("Copia cifrata proposta al destinatario.");
      }) })), ...data.inbox.map((delivery) => h("div", { class: "row-item" }, h("span", { class: "grow" }, "Documento cifrato ricevuto"), btn("Accetta", { onclick: () => run(async () => {
        await decryptDocument(bundle, delivery.envelope, `cora:${folder.id}:${delivery.document}:1`);
        await api(`/api/encrypted/folders/${folder.id}/receive`, { method: "POST", body: { delivery: delivery.id, accept: true, proof: await proof(`accept:${delivery.id}`) } }); await refresh();
      }) }), btn("Rifiuta", { cls: "ghost danger", onclick: () => run(async () => { await api(`/api/encrypted/folders/${folder.id}/receive`, { method: "POST", body: { delivery: delivery.id, accept: false } }); await refresh(); }) })))));
    if (grantPanel) sharing.append(grantPanel);
    drawRequestState = () => { if (requestButton) requestButton.disabled = !selected; if (shareButton) shareButton.disabled = !data.canWrite || !selected || !recipients.length; };
  }
  const audit = h("div", { class: "stack-sm" });
  const AUDIT_ICON = { unlock: "key", read: "eye", configure: "sliders", methods: "key", write: "edit", export: "download", share: "link", incoming: "link", grant: "shield", request: "shield", session: "shield", delete: "trash" };
  const AUDIT_VERB = { unlock: "ha sbloccato la cartella", read: "ha aperto i documenti", configure: "ha attivato la cifratura", methods: "ha cambiato i metodi di sblocco", write: "ha salvato una versione", export: "ha esportato un documento", share: "ha proposto una copia cifrata", incoming: "ha ricevuto una copia cifrata", grant: "ha cambiato un accesso cifrato", request: "ha chiesto un accesso temporaneo", session: "sessione privata", delete: "ha eliminato" };
  const OUTCOME = { success: "", denied: "rifiutato", accepted: "accettato", revoked: "revocato", proposed: "proposto", declined: "rifiutato", interrupted: "interrotta" };
  const methodName = (value) => { const id = String(value || "").split(/[:-]/).at(-1); const method = personal.methods.find((m) => m.id === id) || data.folder.methods?.find((m) => m.id === id); return method ? method.label : ""; };
  function drawAudit() {
    const rows = data.audit.map((entry) => {
      const extra = [methodName(entry.method), entry.agent ? agents.find((a) => a.id === entry.agent)?.name || entry.agent : "", entry.version ? `v${entry.version}` : ""].filter(Boolean).join(" · ");
      const outcome = OUTCOME[entry.outcome] ?? entry.outcome;
      return h("li", { class: `log-row${entry.outcome === "denied" ? " log-denied" : ""}` },
        h("span", { class: "log-ico" }, ui.icon ? ui.icon(AUDIT_ICON[entry.event] || "info") : null),
        h("span", { class: "grow log-text" }, h("span", {}, h("b", {}, tr("Tu")), " ", tr(AUDIT_VERB[entry.event] || entry.event), outcome ? h("span", { class: `badge${entry.outcome === "denied" ? " err" : ""}` }, tr(outcome)) : null), extra ? h("small", {}, raw(extra)) : null),
        h("time", { class: "log-time" }, raw(new Date(entry.at).toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }))));
    });
    audit.replaceChildren(panel({ icon: "clock", title: "Registro", hint: "Chi ha sbloccato, letto, salvato e condiviso, con metodo ed esito. Nessun contenuto né chiave." }, h("ol", { class: "log-list" }, rows.length ? rows : h("li", { class: "log-row" }, h("span", { class: "grow log-text" }, tr("Ancora niente da registrare."))))));
  }
  drawAudit();
  const panes = { file: files, conversazioni: conversations.element, accessi: requests, condivisione: sharing, registro: audit, cifratura: methods,
    ...(ui.permissions ? { permessi: ui.permissions() } : {}), ...(ui.folderSettings && data.canManage ? { impostazioni: ui.folderSettings() } : {}) };
  const pane = h("div", { class: "stack" });
  locked.append(pane);
  root.show = (tab, dir = "") => {
    const key = panes[tab] ? tab : "file";
    pane.replaceChildren(panes[key]);
    if (key === "file") fileControls.setDir(dir);
  };
  root.tabs = () => [["file", "File", "file", data.documents.filter((d) => d.kind !== "chat").length], ["conversazioni", "Conversazioni", "chat"], ["accessi", "Accessi", "spark"], ["condivisione", "Condivisione", "link"], ["registro", "Registro", "clock"],
    ...(panes.permessi ? [["permessi", "Permessi", "shield"]] : []), ["cifratura", "Cifratura", "key"], ...(panes.impostazioni ? [["impostazioni", "Impostazioni", "sliders"]] : [])];
  root.lockButton = lockButton;
  root.show(current, ui.dir || "");
  let idle = null;
  const touch = () => { clearTimeout(idle); idle = setTimeout(lock, 5 * 60000); };
  for (const event of ["pointerdown", "keydown", "input"]) root.addEventListener(event, touch);
  const leave = () => { if (!location.hash.startsWith(`#/artefatti/${folder.id}`)) { lock(); clearTimeout(idle); window.removeEventListener("hashchange", leave); } };
  window.addEventListener("hashchange", leave); touch();
  root.append(unlock, locked, status); return root;
}
