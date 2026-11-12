import { createPasskey } from "./encrypted-crypto.js";

export function passkeyChoice(ui, { existing = [], onCreate, onReuse, initial = "" }) {
  const { h, btn, tr, raw } = ui;
  const name = h("input", { type: "text", maxlength: 80, placeholder: tr("Nome della passkey"), "aria-label": tr("Nome della passkey") });
  const select = h("select", { "aria-label": tr("Passkey salvata") }, existing.map(item => h("option", { value: item.credentialId, selected: initial === item.credentialId }, raw(item.label))));
  const status = h("p", { class: "muted", role: "status" });
  let busy = false;
  const act = async (work) => {
    if (busy) return;
    busy = true; status.textContent = "";
    for (const control of root.querySelectorAll("input,select,button")) control.disabled = true;
    try { await work(); }
    catch (error) { status.textContent = tr(error.message); }
    finally { busy = false; for (const control of root.querySelectorAll("input,select,button")) control.disabled = false; }
  };
  const root = h("div", { class: "stack-sm" }, name,
    h("p", { class: "muted" }, "Il metodo viene scelto automaticamente. Se il gestore non supporta la protezione avanzata, la sicurezza dipende dalla protezione del gestore stesso. Le chiavi non vengono inviate a Cora."),
    btn("Aggiungi passkey", { icon: "plus", onclick: () => act(() => onCreate(name.value.trim() || "Passkey")) }),
    existing.length ? h("div", { class: "stack-sm" }, h("label", {}, "Usa una passkey già salvata", select), btn("Abbina passkey", { icon: "key", onclick: () => act(() => onReuse(existing.find(item => item.credentialId === select.value))) })) : null, status);
  return root;
}

export function encryptedPasskeySettings(ui) {
  const { h, btn, api, panel, tr, raw } = ui;
  const root = h("div", { class: "stack encrypted-passkey-registry" });
  const refresh = async () => {
    const data = await api("/api/encrypted/passkeys");
    const list = h("div", { class: "rows" });
    for (const item of data.passkeys) {
      const available = data.folders.filter(folder => !item.folders.some(used => used.id === folder.id));
      const target = h("select", { "aria-label": tr("Cartella da abbinare a {name}", { name: item.label }) }, available.map(folder => h("option", { value: folder.id }, raw(folder.title || folder.path))));
      list.append(h("div", { class: "set-row encrypted-credential-row" }, h("div", { class: "set-text" }, h("b", {}, raw(item.label)),
        h("small", {}, tr(item.derivation === "handle-v1" ? "Protezione del gestore" : "Protezione avanzata"), raw(" · " + (item.createdAt ? new Date(item.createdAt).toLocaleDateString() : tr("Data di creazione non disponibile")))),
        h("div", { class: "encrypted-used-folders" }, item.folders.length ? item.folders.map(folder => h("a", { href: `#/artefatti/${folder.id}/cifratura/passkeys` }, raw(folder.title || folder.path))) : h("small", {}, "Nessuna cartella abbinata"))),
        available.length ? h("div", { class: "set-control stack-sm" }, target, btn("Abbina cartella", { cls: "sm", icon: "key", onclick: () => { location.hash = `#/artefatti/${target.value}/cifratura/passkeys?passkey=${encodeURIComponent(item.credentialId)}`; } })) : null));
    }
    root.replaceChildren(panel({ icon: "key", title: "Passkeys", hint: "Le tue passkey possono proteggere più cartelle. Ogni cartella conserva chiavi distinte. Qui Cora salva soltanto nomi e associazioni." },
      data.passkeys.length ? list : h("p", { class: "muted" }, "Nessuna passkey salvata."),
      passkeyChoice(ui, { onCreate: async label => { await api("/api/encrypted/passkeys", { method: "POST", body: await createPasskey(label) }); await refresh(); } })));
  };
  refresh().catch(error => root.replaceChildren(h("p", { role: "alert" }, tr(error.message)), btn("Riprova", { onclick: refresh })));
  return root;
}
