import { encryptDocument, decryptDocument, proveAccess, to64, from64, documentId } from './encrypted-crypto.js';

export const CHUNK_BYTES = 512 * 1024;
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
const cancelled = (signal) => { if (signal?.aborted) throw new DOMException('Caricamento annullato.', 'AbortError'); };
const digest = async (bytes) => to64(await crypto.subtle.digest('SHA-256', bytes));
export function encryptedFilePath(value) {
  if (typeof value !== 'string' || !value || new TextEncoder().encode(value).length > 1024 || /^[A-Za-z]:/.test(value) || /[\\\u0000-\u001f\u007f]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) throw Error('Percorso del file non valido.');
  return value;
}
export async function uploadEncryptedFile({ api, folder, bundle, method, publicKey, file, path: target = '', previous = null, signal, progress = () => {}, share = null }) {
  cancelled(signal); const path = encryptedFilePath(target || file.webkitRelativePath || file.name);
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
const PREVIEW_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', pdf: 'application/pdf' };
export const encryptedPreviewType = (path, mime = '') => PREVIEW_TYPES[String(path).split('.').at(-1).toLowerCase()] || (/^text\//.test(mime) ? 'text/plain' : 'application/octet-stream');
export function encryptedEntries(items, dir = '') {
  const here = dir ? `${dir}/` : '', dirs = new Map(), files = [];
  for (const item of items) {
    if (!item.path.startsWith(here)) continue;
    const rest = item.path.slice(here.length), slash = rest.indexOf('/');
    if (slash === -1) { files.push({ ...item, name: rest }); continue; }
    const name = rest.slice(0, slash), entry = dirs.get(name) || { name, count: 0, size: 0 };
    entry.count += 1; entry.size += item.size; dirs.set(name, entry);
  }
  return { dirs: [...dirs.values()].sort((a, b) => a.name.localeCompare(b.name)), files: files.sort((a, b) => a.name.localeCompare(b.name)) };
}

/**
 * The encrypted Files tab, drawn like the plaintext one: a drop zone that lands where the person stands,
 * folders to walk into, and the shared preview for the file chosen. Bytes are decrypted only in this view.
 */
export function encryptedFileBrowser(ui, options) {
  const { h, btn, panel, tr, raw, icon, skeleton, fmtBytes, fileCount, toast, droppedFiles, textEditor, preview: artifactPreview, artifactKind } = ui;
  const urls = new Set(); let controller = null, previewController = null, items = [], chosen = null, dir = options.dir || '';
  const remember = (blob) => { const url = URL.createObjectURL(blob); urls.add(url); return url; };
  const save = (blob, name) => { const link = document.createElement('a'); link.href = remember(blob); link.download = name; link.click(); };
  const state = () => options.state();
  const pane = h('div', { class: 'art-preview' });
  const idle = () => pane.replaceChildren(h('div', { class: 'art-noview' }, icon('eye'), h('p', {}, tr('Scegli un file per vederlo.'))));
  const clearPreview = () => { previewController?.abort(); previewController = null; chosen = null; delete pane.dataset.path; idle(); for (const url of urls) URL.revokeObjectURL(url); urls.clear(); };
  const clear = () => { controller?.abort(); clearPreview(); items = []; element.replaceChildren(); };
  const element = h('div', { class: 'stack' });
  const busy = () => Boolean(controller);
  async function load() {
    const next = [], { bundle } = state();
    for (const doc of options.documents().filter((d) => d.kind !== 'chat')) {
      try {
        const plain = JSON.parse(await options.decrypt(bundle, doc));
        if (plain.format === 'file-v1') next.push({ doc, file: true, path: encryptedFilePath(plain.path), size: plain.size, mime: plain.mime, meta: plain });
        else { const path = String(plain.title || tr('Senza titolo')).replace(/^\/+|\/+$/g, '') || tr('Senza titolo'); next.push({ doc, file: false, path, size: new TextEncoder().encode(plain.content || '').length, content: plain.content || '', title: plain.title || '' }); }
      } catch { next.push({ doc, broken: true, path: tr('Documento non decifrabile') + ` (${doc.id.slice(-6)})`, size: 0 }); }
    }
    items = next;
  }
  const versionPicker = (item) => {
    const latest = options.documents().find((d) => d.id === item.doc.id)?.version || item.doc.version;
    if (latest < 2) return null;
    return h('select', { class: 'sm', 'aria-label': tr('Versione'), onchange: (event) => open({ ...item }, Number(event.target.value)) },
      Array.from({ length: Math.min(100, latest) }, (_, i) => latest - i).map((n) => h('option', { value: n, selected: item.doc.version === n }, raw('v' + n))));
  };
  async function open(item, version = 0, { scroll = true } = {}) {
    previewController?.abort(); for (const url of urls) URL.revokeObjectURL(url); urls.clear();
    previewController = new AbortController(); const signal = previewController.signal, token = Symbol(); chosen = token;
    for (const row of element.querySelectorAll('.art-file')) row.classList.toggle('on', row.dataset.path === item.path);
    pane.dataset.path = item.path; pane.replaceChildren(skeleton('rows', 2));
    try {
      let doc = item.doc, entry = item;
      if (version && version !== doc.version) {
        doc = await options.api(`/api/encrypted/folders/${options.folder}/documents?document=${doc.id}&version=${version}`);
        const plain = JSON.parse(await options.decrypt(state().bundle, doc));
        entry = plain.format === 'file-v1' ? { ...item, doc, size: plain.size, mime: plain.mime, meta: plain } : { ...item, doc, content: plain.content || '', size: new TextEncoder().encode(plain.content || '').length };
      }
      options.select(doc);
      const kind = artifactKind(entry.path);
      let blob = null;
      if (!entry.file) blob = new Blob([entry.content], { type: 'text/plain' });
      else if (kind !== 'other' || /\.pdf$/i.test(entry.path)) {
        const opened = await downloadEncryptedFile({ api: options.api, folder: options.folder, bundle: state().bundle, document: doc, signal });
        try { blob = new Blob([opened.bytes], { type: encryptedPreviewType(entry.path, entry.mime) }); } finally { opened.bytes.fill(0); }
      }
      if (chosen !== token) return;
      const download = async () => {
        if (blob) return save(blob, entry.path.split('/').at(-1));
        const file = await downloadEncryptedFile({ api: options.api, folder: options.folder, bundle: state().bundle, document: doc });
        try { save(new Blob([file.bytes], { type: file.metadata.mime }), file.metadata.path.split('/').at(-1)); } finally { file.bytes.fill(0); }
      };
      const latest = options.documents().find((d) => d.id === doc.id)?.version || doc.version;
      const writable = options.canWrite() && doc.version === latest && (!entry.file || (entry.size <= 1024 * 1024 && kind === 'text'));
      const shown = await artifactPreview(blob ? remember(blob) : '', entry.path, entry.size, writable ? { canReview: true } : null, {
        blob, download, extra: [versionPicker({ ...entry, doc })], editable: writable,
        save: writable ? async (text) => {
          reopen(entry.path);
          if (entry.file) await uploadEncryptedFile({ ...state(), api: options.api, folder: options.folder, file: new File([text], entry.path.split('/').at(-1), { type: entry.mime || 'text/plain' }), path: entry.path, previous: doc });
          else await options.persist(doc, entry.title || entry.path, text);
          await options.refresh(); return true;
        } : null,
      });
      if (chosen === token) pane.replaceChildren(...shown.flat().filter(Boolean));
      if (scroll && matchMedia('(max-width: 899px)').matches) pane.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch (error) { if (chosen === token && error.name !== 'AbortError') pane.replaceChildren(h('div', { class: 'art-noview' }, icon('alert'), h('p', {}, tr(error.message)))); }
  }
  let reopenPath = '';
  const reopen = (path) => { reopenPath = path; };
  const newDocument = () => {
    if (!options.canWrite()) return;
    clearPreview(); options.select(null);
    const here = dir ? `${dir}/` : '';
    const name = h('input', { type: 'text', class: 'mono', maxlength: 200, placeholder: tr('nome del documento, es. note.md'), 'aria-label': tr('Nome del documento'), autocomplete: 'off', spellcheck: 'false' });
    const editor = textEditor('', 'nuovo.md', { onCancel: idle, onSave: async (text) => {
      const value = name.value.trim().replace(/^\/+|\/+$/g, '');
      if (!value || value.split('/').some((part) => !part.trim() || part === '.' || part === '..')) { toast(tr('Dai un nome al documento.'), true); name.focus(); return false; }
      if (items.some((item) => item.path === `${here}${value}`)) { toast(tr('Esiste già un file con questo nome: aprilo e modificalo.'), true); name.focus(); return false; }
      reopen(`${here}${value}`); await options.persist(null, `${here}${value}`, text); await options.refresh(); toast(tr('Versione cifrata salvata.')); return true;
    } });
    pane.dataset.path = ''; pane.replaceChildren(h('header', { class: 'art-preview-head' }, h('span', { class: 'grow' }, h('b', {}, tr('Nuovo documento')), h('small', {}, raw(`${options.path}/${here}`)))), name, editor);
    name.focus?.();
  };
  const status = h('span', { class: 'art-drop-status', role: 'status' });
  const pick = h('input', { type: 'file', multiple: true, hidden: true, 'aria-label': tr('Scegli file da cifrare') });
  const pickDir = h('input', { type: 'file', multiple: true, webkitdirectory: '', hidden: true, 'aria-label': tr('Scegli cartella da cifrare') });
  async function send(list) {
    if (controller || !list.length || !options.canWrite()) return;
    controller = new AbortController(); const signal = controller.signal; let saved = 0; draw();
    const here = dir ? `${dir}/` : '';
    try {
      for (const { file, path } of list) { encryptedFilePath(here + path); if (file.size > MAX_FILE_BYTES) throw Error('Ogni file può contenere al massimo 64 MiB.'); }
      const previous = new Map(items.filter((item) => item.file).map((item) => [item.path, item.doc]));
      for (const { file, path } of list) {
        const target = here + path;
        const result = await uploadEncryptedFile({ ...state(), api: options.api, folder: options.folder, file, path: target, previous: previous.get(target), signal, progress: (done, size) => { status.textContent = tr('{done} di {count} file · {name} {percent}%', { done: saved, count: list.length, name: target, percent: Math.round(done / (size || 1) * 100) }); } });
        previous.set(target, result.doc); saved++;
      }
      toast(tr('File cifrati salvati: {count}.', { count: saved }));
    } catch (error) { toast((error.name === 'AbortError' ? tr('Caricamento annullato.') : tr(error.message)) + ' ' + tr('File già completati: {count}.', { count: saved }), error.name !== 'AbortError'); }
    finally { controller = null; status.textContent = ''; pick.value = ''; pickDir.value = ''; await options.refresh(); }
  }
  pick.addEventListener('change', () => send([...pick.files].map((file) => ({ file, path: file.name }))));
  pickDir.addEventListener('change', () => send([...pickDir.files].map((file) => ({ file, path: file.webkitRelativePath || file.name }))));
  const zip = async () => {
    if (controller) return; controller = new AbortController(); const signal = controller.signal; const opened = [];
    try {
      for (const document of options.documents().filter((doc) => doc.file)) opened.push(await downloadEncryptedFile({ api: options.api, folder: options.folder, bundle: state().bundle, document, signal }));
      if (!opened.length) throw Error('Nessun file caricato da scaricare.');
      save(encryptedFilesZip(opened), `${options.path.split('/').at(-1) || 'artifacts'}.zip`);
    } catch (error) { toast(tr(error.message), true); }
    finally { for (const file of opened) file.bytes.fill(0); controller = null; }
  };
  function draw() {
    const here = dir ? `${dir}/` : '', parts = dir ? dir.split('/') : [];
    const { dirs, files } = encryptedEntries(items, dir);
    const fresh = Boolean(dir) && !dirs.length && !files.length;
    const rows = [
      parts.length ? h('button', { type: 'button', class: 'art-file art-up', onclick: () => options.go(parts.slice(0, -1).join('/')) }, icon('back'), h('span', { class: 'grow' }, '..'), h('small', {}, tr('su'))) : null,
      ...dirs.map((entry) => h('button', { type: 'button', class: 'art-file art-subdir', onclick: () => options.go(`${here}${entry.name}`) }, icon('folder'), h('span', { class: 'grow' }, raw(`${entry.name}/`)), h('small', {}, raw(fileCount(entry.count))))),
      ...files.map((item) => h('button', { type: 'button', class: 'art-file', 'data-path': item.path, disabled: item.broken, onclick: () => open(item) },
        icon(artifactKind(item.path) === 'image' ? 'eye' : item.file ? 'file' : 'edit'), h('span', { class: 'grow' }, raw(item.name)), h('small', {}, raw(fmtBytes(item.size))))),
    ].filter(Boolean);
    const list = h('div', { class: 'art-tree' }, rows.length && !fresh ? rows : [...(fresh ? rows.slice(0, 1) : []), h('p', { class: 'art-tree-empty' }, fresh ? tr('Cartella nuova: esiste quando ci carichi i primi file.') : tr('Ancora nessun file qui.'))]);
    const where = h('code', { class: 'art-drop-where' }, raw(`${options.path}/${here}`));
    const writable = options.canWrite();
    const drop = h('div', { class: `art-drop${busy() ? ' busy' : ''}` },
      h('span', { class: 'art-drop-ico' }, icon('upload')),
      h('span', { class: 'grow art-drop-text' }, h('b', {}, tr('Trascina qui file o cartelle, oppure')), h('small', {}, tr('finiscono cifrati in'), ' ', where, ' ', status)),
      btn('Carica qui', { icon: 'upload', cls: 'sm primary', disabled: busy(), onclick: () => pick.click() }),
      btn('Una cartella', { icon: 'folder', cls: 'sm ghost', disabled: busy(), onclick: () => pickDir.click() }),
      btn('Nuovo documento', { icon: 'edit', cls: 'sm ghost', disabled: busy(), onclick: newDocument }),
      btn('Nuova cartella', { icon: 'plus', cls: 'sm ghost', disabled: busy(), onclick: () => {
        if (drop.querySelector('.art-newdir')) return drop.querySelector('.art-newdir input').focus();
        const name = h('input', { type: 'text', class: 'mono', maxlength: 120, placeholder: tr('nome della cartella'), autocomplete: 'off', spellcheck: 'false', 'aria-label': tr('Nome della nuova cartella') });
        const form = h('form', { class: 'art-newdir' }, h('span', { class: 'mono faint' }, raw(`${options.path}/${here}`)), name, btn('Entra', { icon: 'next', cls: 'sm primary', type: 'submit' }), btn('Annulla', { cls: 'sm ghost', onclick: () => form.remove() }));
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          const value = name.value.trim().replace(/^\/+|\/+$/g, ''), segments = value.split('/').map((part) => part.trim());
          if (!value || segments.some((part) => !part || part === '.' || part === '..' || /[\\\u0000-\u001f]/.test(part))) return toast(tr('Un nome di cartella: lettere, cifre, spazi, trattini; niente . o ..'), true);
          options.go(`${here}${segments.join('/')}`);
        });
        drop.append(form); name.focus?.();
      } }),
      busy() ? btn('Annulla caricamento', { cls: 'sm ghost', onclick: () => controller?.abort() }) : null,
      pick, pickDir);
    const zone = h('div', { class: 'stack-sm art-zone' }, writable ? drop : h('p', { class: 'notice' }, icon('info'), tr('Hai accesso in lettura: puoi vedere e scaricare i file.')), h('div', { class: 'art-files' }, h('div', { class: 'stack-sm' }, list), pane));
    let depth = 0;
    zone.addEventListener('dragenter', (event) => { if (!writable || ![...(event.dataTransfer?.types || [])].includes('Files')) return; event.preventDefault(); depth += 1; zone.classList.add('over'); });
    zone.addEventListener('dragover', (event) => { if ([...(event.dataTransfer?.types || [])].includes('Files')) event.preventDefault(); });
    zone.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) zone.classList.remove('over'); });
    zone.addEventListener('drop', async (event) => { event.preventDefault(); depth = 0; zone.classList.remove('over'); if (writable) send(await droppedFiles(event.dataTransfer)); });
    const total = items.reduce((sum, item) => sum + item.size, 0);
    element.replaceChildren(panel({ icon: 'file', title: tr('File cifrati'), hint: raw(tr('{count} · {size} · cifrati nel browser', { count: fileCount(items.length), size: fmtBytes(total) })),
      actions: items.some((item) => item.file) ? btn('', { icon: 'download', cls: 'sm ghost', title: tr('Scarica tutto (ZIP)'), disabled: busy(), onclick: zip }) : null }, zone));
    const again = reopenPath && files.find((item) => item.path === reopenPath); reopenPath = '';
    if (again) open(again, 0, { scroll: false });
    else if (!pane.querySelector('.art-preview-head, .art-editor')) {
      const first = files.find((item) => /^index\.html?$/i.test(item.name)) || files.find((item) => /^readme/i.test(item.name)) || (dir ? null : files.find((item) => !item.broken));
      if (first) open(first, 0, { scroll: false }); else idle();
    } else for (const row of element.querySelectorAll('.art-file')) row.classList.toggle('on', row.dataset.path === pane.dataset.path);
  }
  return {
    element, clear, clearPreview,
    count: () => items.length,
    async refresh() { await load(); draw(); },
    setDir(next) { if (next === dir) return; dir = next; clearPreview(); draw(); },
    updateAccess() {},
  };
}
