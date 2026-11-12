import { decryptDocument, proveAccess, to64 } from "./encrypted-crypto.js";
import { downloadEncryptedFile, CHUNK_BYTES, encryptedFilePath } from "./encrypted-files.js";

const encoder = new TextEncoder();
const cancelled = signal => { if (signal?.aborted) throw new DOMException("Conversione annullata. La cartella cifrata è intatta.", "AbortError"); };
export async function convertEncryptedFolder({ api, folder, bundle, method, signal, progress = () => {}, committing = () => {} }) {
  const proof = intent => proveAccess(api, folder, bundle, method, intent);
  let ticket, sent = false;
  try {
    cancelled(signal);
    ticket = await api(`/api/encrypted/folders/${folder}/decrypt-start`, { method: "POST", body: { confirm: true, proof: await proof("decrypt") } });
    for (let index = 0; index < ticket.sources.length; index++) {
      cancelled(signal);
      const source = ticket.sources[index];
      const doc = await api(`/api/encrypted/folders/${folder}/decrypt-source?conversion=${ticket.id}&item=${index}`);
      let bytes, path, title;
      try {
        if (doc.file) {
          const file = await downloadEncryptedFile({ api, folder, bundle, document: doc, signal });
          bytes = file.bytes; path = file.metadata.path;
        } else {
          const aad = source.type === "result" ? `cora:${folder}:session:${doc.session}` : `cora:${folder}:${doc.id}:${doc.version}`;
          const text = await decryptDocument(bundle, doc.envelope, aad);
          if (source.kind === "artifact" && source.type === "document") {
            const value = JSON.parse(text); title = value.title;
            if (typeof value.content !== "string") throw Error("Documento non valido: la cartella cifrata è intatta.");
            let name = "";
            for (const char of String(value.title || doc.id).normalize("NFC").replace(/[\u0000-\u001f\u007f\\/]/g, "_")) { if (encoder.encode(name + char).length > 200) break; name += char; }
            name ||= doc.id;
            path = `Documents/${doc.id}/${name}${/\.[a-z0-9]{1,8}$/i.test(name) ? "" : ".txt"}`; bytes = encoder.encode(value.content);
          } else {
            path = `${source.type === "result" ? "Sessions" : source.kind === "chat" ? "Conversations" : "Reasoning"}/${doc.id}.json`;
            bytes = encoder.encode(text);
          }
        }
        encryptedFilePath(path);
        const metadata = { path, size: bytes.length, sha256: [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join(""), ...(title ? { title } : {}) };
        for (let chunk = 0; chunk < Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES)); chunk++) {
          cancelled(signal);
          await api(`/api/encrypted/folders/${folder}/decrypt-chunk`, { method: "PUT", signal, body: { conversion: ticket.id, item: index, chunk, metadata, bytes: to64(bytes.subarray(chunk * CHUNK_BYTES, (chunk + 1) * CHUNK_BYTES)) } });
        }
        progress(index + 1, ticket.sources.length);
      } finally { bytes?.fill(0); }
    }
    cancelled(signal);
    const authorization = await proof("decrypt-finish:" + ticket.id);
    cancelled(signal); committing(); sent = true;
    return await api(`/api/encrypted/folders/${folder}/decrypt-finish`, { method: "POST", body: { conversion: ticket.id, proof: authorization } });
  } catch (error) {
    if (ticket) {
      try {
        const recovery = await api(`/api/encrypted/folders/${folder}/decrypt-cancel`, { method: "POST", body: { conversion: ticket.id } });
        if (recovery.versions !== undefined) return recovery;
      } catch { if (sent) throw Error("Verifica lo stato della cartella: il salvataggio finale potrebbe essere già riuscito."); }
    }
    throw error;
  }
}

export function encryptionRemoval(ui, options) {
  const { h, btn, panel, tr } = ui;
  const status = h("p", { class: "muted", role: "status" });
  let controller = null, finishing = false;
  const dialog = h("dialog", { class: "encrypted-confirm", "aria-labelledby": "encryption-removal-title", oncancel: event => { if (controller) { event.preventDefault(); if (!finishing) controller.abort(); } } });
  const cancel = btn("Annulla", { cls: "ghost", onclick: () => { if (controller) { if (!finishing) controller.abort(); } else dialog.close(); } });
  const confirm = btn("Decifra e salva in chiaro", { cls: "danger", icon: "lock", onclick: async () => {
    if (controller) return;
    controller = new AbortController(); confirm.disabled = true; status.textContent = tr("Preparazione della copia in chiaro…");
    try {
      const state = options.state();
      await convertEncryptedFolder({ api: ui.api, folder: options.folder, bundle: state.bundle, method: state.method, signal: controller.signal,
        progress: (n, total) => { status.textContent = tr("Versioni verificate: {n} di {total}", { n, total }); },
        committing: () => { finishing = true; cancel.disabled = true; status.textContent = tr("Salvataggio finale della cartella…"); } });
      dialog.close(); await options.complete();
    } catch (error) { status.textContent = tr(error.message); }
    finally { controller = null; finishing = false; confirm.disabled = false; cancel.disabled = false; }
  } });
  dialog.append(h("h2", { id: "encryption-removal-title" }, "Rimuovere la cifratura?"),
    h("p", {}, "Tutti i file e tutte le versioni vengono decifrati nel browser e salvati in chiaro. Conversazioni e ragionamenti diventano file JSON, senza essere inviati sui canali."),
    h("p", {}, "Si applicheranno i normali permessi della cartella: le persone e gli agenti autorizzati potranno leggere i contenuti senza passkey. Le altre cartelle che usano la stessa passkey restano cifrate."),
    h("p", {}, "Gli originali cifrati vengono rimossi soltanto dopo il salvataggio verificato di tutte le versioni. Se annulli prima del salvataggio finale o si verifica un errore, restano intatti."), status,
    h("div", { class: "row" }, cancel, confirm));
  const root = panel({ icon: "lock", title: "Rimuovi cifratura", hint: "Salva questa cartella in chiaro, conservando contenuti e versioni. L’obbligo generale di cifratura deve essere spento." }, btn("Rimuovi cifratura", { cls: "danger", icon: "lock", onclick: () => { status.textContent = ""; dialog.showModal(); } }), dialog);
  return { element: root, clear: () => { if (!finishing) controller?.abort(); if (dialog.open && !finishing) dialog.close(); } };
}
