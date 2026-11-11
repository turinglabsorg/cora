import { encryptDocument, decryptDocument, proveAccess, to64, from64, documentId } from './encrypted-crypto.js';

export const CHUNK_BYTES = 512 * 1024;
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
const cancelled = (signal) => { if (signal?.aborted) throw new DOMException('Caricamento annullato.', 'AbortError'); };
const digest = async (bytes) => to64(await crypto.subtle.digest('SHA-256', bytes));
export function encryptedFilePath(value) {
  if (typeof value !== 'string' || !value || new TextEncoder().encode(value).length > 1024 || /^[A-Za-z]:/.test(value) || /[\\\u0000-\u001f\u007f]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) throw Error('Percorso del file non valido.');
  return value;
}
export async function uploadEncryptedFile({ api, folder, bundle, method, publicKey, file, previous = null, signal, progress = () => {}, share = null }) {
  cancelled(signal); const path = encryptedFilePath(file.webkitRelativePath || file.name);
  if (file.size > MAX_FILE_BYTES) throw Error('Ogni file può contenere al massimo 64 MiB.');
  const bytes = new Uint8Array(await file.arrayBuffer()); cancelled(signal);
  const chunks = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES)), id = share ? documentId() : previous?.id || documentId(), base = share ? 0 : previous?.version || 0, cipherFolder = share?.target || folder;
  const proof = intent => proveAccess(api, folder, bundle, method, intent);
  let upload, complete = false;
  try {
    upload = share ? await api(`/api/encrypted/folders/${folder}/file-share-start`, { method: 'POST', body: { document: share.document.id, version: share.document.version, target: share.target, targetDocument: id, proof: await proof(`share-file:${share.document.id}:${share.document.version}:${share.target}:${id}`) } }) : await api(`/api/encrypted/folders/${folder}/file-start`, { method: 'POST', body: { id, base, chunks, proof: await proof(`upload:${id}:${base}:${chunks}`) } });
    for (let chunk = 0; chunk < chunks; chunk++) {
      cancelled(signal);
      const envelope = await encryptDocument(publicKey, to64(bytes.subarray(chunk * CHUNK_BYTES, (chunk + 1) * CHUNK_BYTES)), `cora:${cipherFolder}:upload:${upload.id}:${chunk}`);
      cancelled(signal);
      await api(`/api/encrypted/folders/${folder}/file-chunk`, { method: 'PUT', body: { upload: upload.id, chunk, envelope } });
      progress(Math.min(bytes.length, (chunk + 1) * CHUNK_BYTES), bytes.length);
    }
    cancelled(signal);
    const metadata = { format: 'file-v1', path, title: path, mime: String(file.type || 'application/octet-stream').slice(0, 160), size: bytes.length, modified: Number(file.lastModified) || 0, sha256: await digest(bytes) };
    const envelope = await encryptDocument(publicKey, JSON.stringify(metadata), `cora:${cipherFolder}:${id}:${base + 1}`);
    cancelled(signal);
    const doc = await api(`/api/encrypted/folders/${folder}/file-finish`, { method: 'POST', body: { upload: upload.id, envelope, proof: await proof(share ? `share-file-finish:${upload.id}` : `write:${id}:${base}`) } });
    complete = true; return { doc, metadata };
  } finally {
    bytes.fill(0);
    if (upload && !complete) await api(`/api/encrypted/folders/${folder}/file-cancel`, { method: 'POST', body: { upload: upload.id } }).catch(() => {});
  }
}
export async function downloadEncryptedFile({ api, folder, bundle, document, signal }) {
  const metadata = JSON.parse(await decryptDocument(bundle, document.envelope, `cora:${folder}:${document.id}:${document.version}`));
  if (metadata.format !== 'file-v1' || !document.file || !Number.isInteger(metadata.size) || metadata.size < 0 || metadata.size > MAX_FILE_BYTES) throw Error('Metadati del file non validi.');
  encryptedFilePath(metadata.path);
  const parts = []; let total = 0;
  try {
    for (let chunk = 0; chunk < document.file.chunks; chunk++) {
      cancelled(signal);
      const envelope = await api(`/api/encrypted/folders/${folder}/file-chunk?document=${document.id}&version=${document.version}&chunk=${chunk}`);
      const bytes = from64(await decryptDocument(bundle, envelope, `cora:${folder}:upload:${document.file.upload}:${chunk}`));
      parts.push(bytes); total += bytes.length;
      if (total > metadata.size) throw Error('Il file non corrisponde alla dimensione cifrata.');
    }
    cancelled(signal);
    const bytes = new Uint8Array(total); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    cancelled(signal);
    if (total !== metadata.size || await digest(bytes) !== metadata.sha256) { bytes.fill(0); throw Error('Il file non supera la verifica di integrità.'); }
    return { bytes, metadata };
  } finally { for (const part of parts) part.fill(0); }
}
const crc32 = (bytes) => { let crc = -1; for (const byte of bytes) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ -1) >>> 0; };
export function encryptedFilesZip(files) {
  const local = [], central = []; let offset = 0, centralSize = 0;
  const put = (view, values) => { for (const [at, value, bytes] of values) bytes === 2 ? view.setUint16(at, value, true) : view.setUint32(at, value, true); };
  for (const { bytes, metadata } of files) {
    const name = new TextEncoder().encode(encryptedFilePath(metadata.path)), crc = crc32(bytes), size = bytes.length;
    const header = new Uint8Array(30 + name.length); put(new DataView(header.buffer), [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [14, crc, 4], [18, size, 4], [22, size, 4], [26, name.length, 2]]); header.set(name, 30); local.push(header, bytes);
    const entry = new Uint8Array(46 + name.length); put(new DataView(entry.buffer), [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [16, crc, 4], [20, size, 4], [24, size, 4], [28, name.length, 2], [42, offset, 4]]); entry.set(name, 46); central.push(entry); centralSize += entry.length; offset += header.length + size;
  }
  const end = new Uint8Array(22); put(new DataView(end.buffer), [[0, 0x06054b50, 4], [8, files.length, 2], [10, files.length, 2], [12, centralSize, 4], [16, offset, 4]]);
  return new Blob([...local, ...central, end], { type: 'application/zip' });
}
export function encryptedFileControls(ui, options) {
  const { h, btn, panel, tr, raw } = ui;
  const status = h('p', { role: 'status', class: 'muted' }), preview = h('div', { class: 'stack-sm' }), urls = new Set(); let controller = null, previewController = null;
  const download = (blob, name) => { const url = URL.createObjectURL(blob); urls.add(url); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 30000); };
  const clearPreview = () => { previewController?.abort(); preview.replaceChildren(); for (const url of urls) URL.revokeObjectURL(url); urls.clear(); };
  const clear = () => { controller?.abort(); clearPreview(); };
  const files = h('input', { type: 'file', multiple: true, hidden: true, 'aria-label': tr('Scegli file da cifrare') });
  const directory = h('input', { type: 'file', multiple: true, webkitdirectory: '', hidden: true, 'aria-label': tr('Scegli cartella da cifrare') });
  const cancel = btn('Annulla caricamento', { cls: 'ghost', onclick: () => controller?.abort() }); cancel.hidden = true;
  const upload = async (list) => {
    if (controller || !list.length) return; controller = new AbortController(); const signal = controller.signal; cancel.hidden = false;
    uploadFiles.disabled = true; uploadFolder.disabled = true; status.textContent = ''; let saved = 0;
    try {
      const state = options.state(), previous = new Map();
      for (const file of list) { encryptedFilePath(file.webkitRelativePath || file.name); if (file.size > MAX_FILE_BYTES) throw Error('Ogni file può contenere al massimo 64 MiB.'); }
      for (const doc of options.documents()) { const item = JSON.parse(await decryptDocument(state.bundle, doc.envelope, `cora:${options.folder}:${doc.id}:${doc.version}`)); if (item.format === 'file-v1') previous.set(item.path, doc); }
      for (const file of list) {
        const path = file.webkitRelativePath || file.name;
        const result = await uploadEncryptedFile({ ...state, api: options.api, folder: options.folder, file, previous: previous.get(path), signal, progress: (done, size) => { status.textContent = `${path} · ${Math.round(done / (size || 1) * 100)}%`; } });
        previous.set(path, result.doc); saved++;
      }
      await options.refresh(); status.textContent = tr('File cifrati salvati: {count}.', { count: saved });
    } catch (error) { await options.refresh(); status.textContent = (error.name === 'AbortError' ? tr('Caricamento annullato.') : tr(error.message)) + ' ' + tr('File già completati: {count}.', { count: saved }); }
    finally { controller = null; cancel.hidden = true; uploadFiles.disabled = !options.canWrite(); uploadFolder.disabled = !options.canWrite(); files.value = ''; directory.value = ''; }
  };
  files.addEventListener('change', () => upload([...files.files])); directory.addEventListener('change', () => upload([...directory.files]));
  const uploadFiles = btn('Carica file cifrati', { icon: 'upload', onclick: () => files.click() });
  const uploadFolder = btn('Carica cartella cifrata', { icon: 'folder', onclick: () => directory.click() });
  uploadFiles.disabled = !options.canWrite(); uploadFolder.disabled = !options.canWrite();
  const zip = btn('Scarica file come ZIP', { icon: 'download', onclick: async () => {
    if (controller) return; controller = new AbortController(); const signal = controller.signal; const opened = []; zip.disabled = true;
    try {
      for (const document of options.documents().filter(doc => doc.file)) opened.push(await downloadEncryptedFile({ api: options.api, folder: options.folder, bundle: options.state().bundle, document, signal }));
      if (!opened.length) throw Error('Nessun file caricato da scaricare.');
      download(encryptedFilesZip(opened), 'artifacts.zip'); status.textContent = tr('Archivio decifrato nel browser.');
    } catch (error) { status.textContent = tr(error.message); }
    finally { for (const file of opened) file.bytes.fill(0); controller = null; zip.disabled = false; }
  } });
  const open = async (doc, metadata) => {
    clearPreview(); previewController = new AbortController(); const signal = previewController.signal;
    preview.replaceChildren(h('p', {}, raw(metadata.path)), h('p', { class: 'muted' }, raw(`${metadata.size} byte · ${metadata.mime} · v${doc.version}`)), btn('Scarica file', { icon: 'download', onclick: async () => {
      if (controller) return; controller = new AbortController(); const signal = controller.signal;
      try { const file = await downloadEncryptedFile({ api: options.api, folder: options.folder, bundle: options.state().bundle, document: doc, signal }); download(new Blob([file.bytes], { type: file.metadata.mime }), file.metadata.path.split('/').at(-1)); file.bytes.fill(0); }
      catch (error) { status.textContent = tr(error.message); } finally { controller = null; }
    } }));
    if (metadata.size <= 1024 * 1024 && (metadata.mime.startsWith('text/') || /^image\/(png|jpeg|webp|gif)$/.test(metadata.mime))) {
      const file = await downloadEncryptedFile({ api: options.api, folder: options.folder, bundle: options.state().bundle, document: doc, signal });
      try {
        cancelled(signal);
        if (metadata.mime.startsWith('text/')) preview.append(h('pre', { class: 'well encrypted-file-preview' }, raw(new TextDecoder().decode(file.bytes))));
        else { const url = URL.createObjectURL(new Blob([file.bytes], { type: metadata.mime })); urls.add(url); preview.append(h('img', { src: url, alt: metadata.path, class: 'encrypted-file-image' })); }
      } finally { file.bytes.fill(0); }
    } else preview.append(h('p', { class: 'muted' }, 'Anteprima per testo e immagini fino a 1 MiB. Per gli altri file usa Scarica file.'));
  };
  const updateAccess = () => { uploadFiles.disabled = !options.canWrite() || Boolean(controller); uploadFolder.disabled = !options.canWrite() || Boolean(controller); };
  return { clear, clearPreview, open, updateAccess, element: panel({ icon: 'folder', title: 'File e cartelle cifrati', hint: 'Nomi, percorsi e contenuti sono cifrati nel browser. Fino a 64 MiB per file e 128 MiB cifrati per cartella. Un percorso già presente crea una nuova versione; le cartelle vuote non sono incluse.' }, h('div', { class: 'row' }, uploadFiles, uploadFolder, cancel, zip), files, directory, status, preview) };
}
