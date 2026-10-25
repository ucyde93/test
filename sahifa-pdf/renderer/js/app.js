'use strict';
/* Documents, commands, sidebar panels and keyboard handling. Layout lives in shell.js. */

const App = { docs: [], active: null, home: true, mode: settingsGet('mode', 'view'), sidebarTab: 'thumbs', sidebarOpen: settingsGet('sidebar', true) };

async function addDoc(doc) {
  App.docs.push(doc);
  activate(doc);
}

async function closeDoc(doc) {
  if (doc.dirty && !(await confirmDialog('Close without saving?', `“${doc.name}” has changes you have not saved.`, 'Close without saving', 'danger'))) return;
  const idx = App.docs.indexOf(doc);
  App.docs.splice(idx, 1);
  try { doc.pdf.destroy(); } catch { /* already gone */ }
  if (App.active === doc) activate(App.docs[Math.min(idx, App.docs.length - 1)] || null);
  else renderDocTabs();
  updateTitle();
}

// ---------- opening ----------
const isPdfBytes = (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
const isImageBytes = (b) => (b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0xff && b[1] === 0xd8);

async function openFiles(files) {
  const images = [];
  for (const f of files) {
    if (!f || !f.data) continue;
    const already = f.path && App.docs.find((d) => d.path === f.path);
    if (already) { activate(already); continue; }
    if (isImageBytes(f.data)) { images.push(f); continue; }
    // Some PDFs have junk before the header; let pdf.js decide.
    try {
      const doc = await busy(`Opening ${f.name}…`, () => loadDocument(f, passwordPrompt));
      if (doc) await addDoc(doc);
    } catch (e) {
      console.error(e);
      toast(`Could not open ${f.name}: ${e.message || e}`, 'error', 6000);
    }
  }
  if (images.length) {
    const bytes = await busy('Creating PDF from images…', () => createPdfFromImages(images));
    const doc = await loadDocument({ name: images.length === 1 ? baseName(images[0].name.replace(/\.\w+$/, '')) + '.pdf' : 'Images.pdf', bytes }, passwordPrompt);
    markDirty(doc);
    await addDoc(doc);
  }
}

async function openPaths(paths) {
  const files = [];
  for (const p of paths) {
    try { files.push(await Host.readFile(p)); } catch (e) { toast(`Could not read ${p}`, 'error'); }
  }
  await openFiles(files);
}

// ---------- saving ----------
function hasRedactions(doc) {
  return doc.allAnnots().some(({ annot }) => annot.type === 'redact');
}

async function saveDoc(doc, { saveAs = false, flatten = false } = {}) {
  if (doc.readOnlyReason) { toast(doc.readOnlyReason, 'error', 6000); return false; }
  if (Annotations.editing) finishTextEdit();
  if (hasRedactions(doc)) {
    if (!(await confirmDialog('Apply redactions?', 'Areas are marked for redaction. They will be permanently removed from the pages before saving. This cannot be undone after you close the file.', 'Apply and save', 'danger'))) return false;
    await busy('Applying redactions…', () => applyRedactions(doc));
    refreshViewer();
  }
  if (doc.hasSignatures && !doc._sigWarned) {
    if (!(await confirmDialog('Document is digitally signed', 'Saving changes rewrites the file, which invalidates the existing digital signatures. Save anyway?', 'Save anyway', 'danger'))) return false;
    doc._sigWarned = true;
  }
  const bytes = await busy('Saving…', () => buildPdf(doc, { flatten }));
  const asNew = saveAs || flatten || !doc.path;
  const suggestedName = flatten ? baseName(doc.name) + '-flattened.pdf' : doc.name;
  const res = await Host.saveFile({ data: bytes, path: doc.path, suggestedName, saveAs: asNew, kind: 'pdf' });
  if (!res) return false;
  if (!flatten) {
    if (res.path) doc.path = res.path;
    doc.name = res.name || doc.name;
    markDirty(doc, false);
  }
  toast(flatten ? `Saved flattened copy ${res.name}` : `Saved ${res.name}`, 'ok');
  renderDocTabs();
  updateTitle();
  return true;
}

// ---------- printing ----------
async function printDoc(doc) {
  const root = $('#printRoot');
  await busy('Preparing pages for printing…', async () => {
    const bytes = await buildPdf(doc, { encrypt: false });
    const tmp = await pdfjsLib.getDocument({ data: bytes, ...PDFJS_OPTS }).promise;
    root.innerHTML = '';
    for (let i = 1; i <= tmp.numPages; i++) {
      const page = await tmp.getPage(i);
      const vp = page.getViewport({ scale: 2 });
      const c = el('canvas', { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE_STORAGE }).promise;
      const url = URL.createObjectURL(new Blob([await canvasToBytes(c, 'image/jpeg', 0.92)], { type: 'image/jpeg' }));
      const img = el('img', { src: url, class: vp.width > vp.height ? 'landscape' : '' });
      root.append(el('div', { class: 'print-page' }, img));
      await img.decode().catch(() => {});
    }
    tmp.destroy();
  });
  const cleanup = () => { $$('img', root).forEach((i) => URL.revokeObjectURL(i.src)); root.innerHTML = ''; };
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
}

// ---------- digital signatures ----------
function cleanIpcError(e) {
  return String(e && e.message ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

async function digitalSignFlow(doc) {
  if (!Host.isDesktop) { toast('Certificate signing is available in the desktop app.', 'error', 5000); return; }
  const opts = await digitalSignDialog();
  if (!opts) return;
  const finish = async (i, box) => {
    const added = [];
    if (box) {
      const lines = [`Digitally signed by ${opts.id.name}`, `Date: ${new Date().toLocaleString()}`];
      if (opts.reason) lines.push(`Reason: ${opts.reason}`);
      if (opts.location) lines.push(`Location: ${opts.location}`);
      const frame = { id: uid(), type: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, stroke: '#1d3fae', fill: '#f2f6ff', width: 1, opacity: 1 };
      const text = { id: uid(), type: 'text', font: 'Helvetica', size: Math.max(5, Math.min(9, box.h / (lines.length * LINE_H) - 0.5)), color: '#1d3fae', bold: false, italic: false, align: 'left', bg: null, text: lines.join('\n'), x: box.x + 2, y: box.y + 2, w: box.w - 4 };
      text.h = textBoxHeight(text);
      added.push(frame, text);
      doc.annotsAt(i).push(...added);
    }
    try {
      const signed = await busy('Signing with your digital ID…', async () => {
        const built = await buildPdf(doc, { encrypt: false });
        return Host.digitalSign({ data: built, id: opts.id.id, password: opts.password, reason: opts.reason, location: opts.location, contactInfo: opts.id.email || '' });
      });
      const res = await Host.saveFile({ data: signed, path: doc.path, suggestedName: baseName(doc.name) + '-signed.pdf', saveAs: true, kind: 'pdf' });
      if (!res) return;
      const signedDoc = await loadDocument({ name: res.name, path: res.path, bytes: new Uint8Array(signed) }, passwordPrompt);
      if (signedDoc) await addDoc(signedDoc);
      toast(`Signed by ${opts.id.name} and saved as ${res.name}`, 'ok', 5000);
      if (doc.protect) toast('Note: the signed copy is not password protected. Encrypting would break the signature.', 'info', 6000);
    } catch (e) {
      toast(cleanIpcError(e), 'error', 6000);
    } finally {
      const list = doc.annotsAt(i ?? 0);
      for (const a of added) { const k = list.indexOf(a); if (k >= 0) list.splice(k, 1); }
      if (App.active === doc) renderAnnotPage(i ?? 0);
    }
  };
  if (opts.visible) {
    setPending({ kind: 'box', label: 'Signature', w: 190, h: 52, hint: 'Click where the visible signature should go. Press Esc to cancel.', onPlace: finish });
  } else {
    await finish(null, null);
  }
}

async function manageIdsDialog() {
  if (!Host.isDesktop) { toast('Digital IDs are available in the desktop app.', 'error'); return; }
  let ids = await Host.idsList();
  const list = el('div', { class: 'id-list' });
  const render = () => {
    list.innerHTML = '';
    if (!ids.length) list.append(el('p', { class: 'muted' }, 'No digital IDs yet.'));
    for (const id of ids) {
      list.append(el('div', { class: 'id-row' },
        el('span', { class: 'id-main' }, el('strong', {}, id.name), el('span', { class: 'muted' }, [id.email, id.org].filter(Boolean).join(' · ') || (id.selfSigned ? 'Self-signed' : `Issued by ${id.issuer}`))),
        el('span', { class: 'muted small' }, 'Valid to ' + new Date(id.notAfter).toLocaleDateString()),
        el('button', { class: 'btn btn-ghost', onclick: () => Host.idsExport(id.id) }, 'Export'),
        el('button', { class: 'btn btn-ghost danger-text', onclick: async () => { if (await confirmDialog('Delete digital ID', `Delete the ID for ${id.name}?`, 'Delete', 'danger')) { await Host.idsDelete(id.id); ids = await Host.idsList(); render(); } } }, 'Delete')));
    }
  };
  render();
  const importPw = el('input', { type: 'password', class: 'inp', placeholder: 'Password of the .pfx file' });
  await dialog({
    title: 'My digital IDs',
    width: 600,
    content: el('div', { class: 'stack' }, list,
      el('div', { class: 'row' },
        el('button', { class: 'btn btn-ghost', onclick: async () => { const c = await createIdDialog(); if (c) { ids = await Host.idsList(); render(); } } }, icon('plus', 16), 'Create new ID'),
        importPw,
        el('button', { class: 'btn btn-ghost', onclick: async () => { try { const c = await Host.idsImport({ password: importPw.value }); if (c) { ids = await Host.idsList(); render(); } } catch (e) { toast(cleanIpcError(e), 'error', 5000); } } }, 'Import .pfx'))),
    buttons: [{ label: 'Close', value: true, kind: 'primary' }],
  });
}

// ---------- read aloud / presentation ----------
let reading = false;
async function readAloud() {
  if (!('speechSynthesis' in window)) { toast('Read aloud is not available on this system.', 'error'); return; }
  if (reading) { reading = false; speechSynthesis.cancel(); toast('Stopped reading'); return; }
  reading = true;
  const doc = Viewer.doc;
  for (let i = Viewer.current; i < doc.pageCount && reading && App.active === doc; i++) {
    const text = (await pagePlainText(doc, i)).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (i !== Viewer.current) goToPage(i);
    await new Promise((res) => {
      const u = new SpeechSynthesisUtterance(text);
      if (isRtl(text)) u.lang = 'ar';
      u.onend = res;
      u.onerror = res;
      speechSynthesis.speak(u);
    });
  }
  reading = false;
}

async function togglePresent() {
  const stage = $('#stage');
  if (document.fullscreenElement) { await document.exitFullscreen(); return; }
  try {
    App._preZoom = { ...Viewer.doc.zoom };
    await stage.requestFullscreen();
    document.body.classList.add('presenting');
    setTimeout(() => { setZoom('page'); goToPage(Viewer.current); }, 150);
  } catch { toast('Full screen is not available.', 'error'); }
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && document.body.classList.contains('presenting')) {
    document.body.classList.remove('presenting');
    if (App._preZoom && Viewer.doc) setTimeout(() => setZoom(App._preZoom.mode, App._preZoom.scale), 100);
  }
});

// ---------- command runner ----------
App.guard = async (fn) => {
  try { return await fn(); } catch (e) { console.error(e); toast(cleanIpcError(e), 'error', 6000); }
};
App.afterStructureChange = () => {
  Annotations.selected = null;
  renderContextBar();
  refreshViewer();
  if (Organizer.open) renderOrganizer();
  renderSidebar();
  renderStatus();
  renderBanner();
};

function opPages() {
  return Organizer.open ? orgTargets() : [Viewer.current];
}

async function askSourcePassword(bytes, name) {
  try { await PDFDocument.load(bytes, { password: '', updateMetadata: false }); return ''; } catch { /* needs a password */ }
  for (let incorrect = false; ; incorrect = true) {
    const pw = await passwordPrompt(name, incorrect);
    if (pw == null) return null;
    try { await PDFDocument.load(bytes, { password: pw, updateMetadata: false }); return pw; } catch { /* retry */ }
  }
}

App.signIntoBox = async (i, box) => {
  const sig = await signatureDialog('signature');
  if (sig) placeImageInBox(i, sig.src, sig.w, sig.h, box, 'signature');
};
App.confirmCrop = async (i, r) => {
  const which = await cropDialog(i);
  if (!which) return;
  const doc = Viewer.doc;
  await App.guard(async () => {
    await busy('Cropping…', () => PageOps.crop(doc, which === 'all' ? doc.pageUids.map((_, k) => k) : [i], r));
    App.afterStructureChange();
    setTool('select');
  });
};
App.addFormField = async (i, kind, r) => {
  const doc = Viewer.doc;
  await App.guard(async () => {
    await PageOps.addField(doc, i, kind, r);
    App.afterStructureChange();
    toast('Form field added. Switch to Select to fill it in.', 'ok');
  });
};

App.run = async (cmd) => {
  const doc = App.active;
  if (NEEDS_DOC(cmd) && !doc) return;
  if (Annotations.editing && !['undo', 'redo'].includes(cmd)) finishTextEdit();
  return App.guard(async () => {
    switch (cmd) {
      case 'open': return openFiles(await Host.openDialog({ multi: true, kind: 'pdfimages' }));
      case 'save': return saveDoc(doc);
      case 'save-as': return saveDoc(doc, { saveAs: true });
      case 'save-flat': return saveDoc(doc, { flatten: true });
      case 'print': return printDoc(doc);
      case 'close-tab': return closeDoc(doc);
      case 'undo':
      case 'redo': {
        const ae = document.activeElement;
        if (ae && (ae.isContentEditable || /^(INPUT|TEXTAREA)$/.test(ae.tagName))) { document.execCommand(cmd); return; }
        const r = cmd === 'undo' ? await undo(doc) : await redo(doc);
        if (!r) return;
        Annotations.selected = null;
        if (r.bytesChanged) App.afterStructureChange();
        else { Viewer.els.forEach((_, i) => renderAnnotPage(i)); renderContextBar(); renderSidebar(); }
        return;
      }
      case 'find': {
        App.sidebarTab = 'search';
        App.sidebarOpen = true;
        renderSidebar();
        const f = $('#findInput');
        f.focus();
        f.select();
        return;
      }
      case 'zoom-in': return zoomBy(1.25);
      case 'zoom-out': return zoomBy(0.8);
      case 'zoom-actual': return setZoom('custom', 1);
      case 'zoom-width': return setZoom('width');
      case 'zoom-page': return setZoom('page');
      case 'toggle-sidebar': App.sidebarOpen = !App.sidebarOpen; settingsSet('sidebar', App.sidebarOpen); renderSidebar(); renderRail(); return;
      case 'organize': return Organizer.open ? closeOrganizer(orgTargets()[0]) : openOrganizer();
      case 'night': Viewer.night = !Viewer.night; viewerEl().classList.toggle('night', Viewer.night); settingsSet('night', Viewer.night); return;
      case 'theme': {
        const cur = document.documentElement.dataset.theme || 'system';
        const next = cur === 'system' ? 'dark' : cur === 'dark' ? 'light' : 'system';
        applyTheme(next);
        toast(`Interface theme: ${next}`);
        return;
      }
      case 'read-aloud': return readAloud();
      case 'present': return togglePresent();
      case 'properties': return propertiesDialog(doc);
      case 'shortcuts': return shortcutsDialog();
      case 'make-default': return makeDefaultFlow();
      case 'home': return showHome();
      case 'about': return aboutDialog();
      case 'sign': return signCommand('signature');
      case 'initials': return signCommand('initials');
      case 'seal': return sealCommand();
      case 'library': return libraryManager();
      case 'library-security': return securityDialog();
      case 'library-lock': return Host.libraryLock();
      case 'design-seal': return sealDesigner();
      case 'stamp': {
        const st = await stampDialog();
        if (st) setPending({ kind: 'stamp', ...st, hint: 'Click on the page to place the stamp.' });
        return;
      }
      case 'image': {
        const [f] = await Host.openDialog({ multi: false, kind: 'images' });
        if (!f) return;
        const src = bytesToDataUrl(f.data, f.data[0] === 0x89 ? 'image/png' : 'image/jpeg');
        const img = await loadImage(src);
        const k = Math.min(1, 240 / img.width, 240 / img.height);
        setPending({ kind: 'image', src, w: img.width * k, h: img.height * k, hint: 'Click on the page to place the image.' });
        return;
      }
      case 'digital-sign': return digitalSignFlow(doc);
      case 'digital-ids': return manageIdsDialog();
      case 'protect': {
        const res = await protectDialog(doc);
        if (!res) return;
        doc.protect = res.remove ? null : res;
        markDirty(doc);
        renderBanner();
        toast(res.remove ? 'Password protection will be removed when you save.' : 'The file will be encrypted with AES-256 when you save.', 'ok', 4500);
        return;
      }
      case 'apply-redactions': {
        if (!hasRedactions(doc)) { setTool('redact'); toast('Mark areas with the redaction tool first.'); return; }
        if (!(await confirmDialog('Apply redactions', 'Marked areas are removed for good: pages with redactions are converted to images so the hidden text, images and drawings cannot be recovered. Text on those pages will no longer be selectable.', 'Apply redactions', 'danger'))) return;
        const n = await busy('Applying redactions…', () => applyRedactions(doc));
        App.afterStructureChange();
        setTool('select');
        toast(`Redacted ${n} page${n === 1 ? '' : 's'}. Save to keep the result.`, 'ok');
        return;
      }
      case 'sanitize': {
        if (!(await confirmDialog('Remove hidden information', 'Removes the title, author and other metadata, document scripts and attached files when you save.', 'Remove on save'))) return;
        pushUndo(doc);
        doc.meta = { strip: true, stripAttachments: true };
        toast('Hidden information will be removed when you save.', 'ok');
        return;
      }
      case 'metadata': {
        const m = await metadataDialog(doc);
        if (m) { pushUndo(doc); doc.meta = m; toast('Document info updated. Save to keep it.', 'ok'); }
        return;
      }
      case 'attach': {
        const [f] = await Host.openDialog({ multi: false, kind: 'any', title: 'Attach a file' });
        if (!f) return;
        await busy('Attaching…', () => PageOps.attach(doc, f));
        App.afterStructureChange();
        toast(`Attached ${f.name}`, 'ok');
        return;
      }
      case 'watermark': {
        const o = await watermarkDialog(doc);
        if (!o) return;
        await busy('Adding watermark…', () => PageOps.watermark(doc, o.pages, o));
        App.afterStructureChange();
        return;
      }
      case 'header-footer': {
        const o = await headerFooterDialog(doc);
        if (!o) return;
        await busy('Adding text to pages…', () => PageOps.headerFooter(doc, o.pages, o));
        App.afterStructureChange();
        return;
      }
      case 'rotate-cw':
      case 'rotate-ccw': {
        const pages = opPages();
        await busy('Rotating…', () => PageOps.rotate(doc, pages, cmd === 'rotate-cw' ? 90 : -90));
        App.afterStructureChange();
        return;
      }
      case 'delete-page': {
        const pages = opPages();
        if (pages.length >= doc.pageCount) { toast('A PDF needs at least one page.', 'error'); return; }
        await busy('Deleting pages…', () => PageOps.remove(doc, pages));
        Organizer.selected.clear();
        App.afterStructureChange();
        toast(`Deleted ${pages.length} page${pages.length === 1 ? '' : 's'}`, 'ok');
        return;
      }
      case 'duplicate-page': {
        const pages = opPages();
        await busy('Duplicating…', () => PageOps.duplicate(doc, pages));
        App.afterStructureChange();
        return;
      }
      case 'insert-blank': {
        const at = Math.max(...opPages()) + 1;
        const s = doc.sizes[at - 1];
        const rot = s.rot === 90 || s.rot === 270;
        await busy('Inserting page…', () => PageOps.insertBlank(doc, at, rot ? { w: s.h, h: s.w } : { w: s.w, h: s.h }));
        Organizer.selected = new Set([at]);
        App.afterStructureChange();
        if (!Organizer.open) goToPage(at);
        return;
      }
      case 'insert-pdf': {
        const files = await Host.openDialog({ multi: true, kind: 'pdf', title: 'Choose PDFs to insert' });
        let at = Math.max(...opPages()) + 1;
        for (const f of files) {
          const pw = await askSourcePassword(f.data, f.name);
          if (pw == null) continue;
          const before = doc.pageCount;
          await busy(`Inserting ${f.name}…`, () => PageOps.insertPdf(doc, at, f.data, pw));
          at += doc.pageCount - before;
        }
        if (files.length) { App.afterStructureChange(); toast(`Inserted ${files.length} file${files.length === 1 ? '' : 's'}`, 'ok'); }
        return;
      }
      case 'insert-images': {
        const files = await Host.openDialog({ multi: true, kind: 'images' });
        if (!files.length) return;
        await busy('Inserting images…', () => PageOps.insertImages(doc, Math.max(...opPages()) + 1, files));
        App.afterStructureChange();
        return;
      }
      case 'extract':
      case 'extract-selected': {
        const pages = cmd === 'extract-selected' ? orgTargets() : await rangeDialog('Extract pages', doc, 'Extract');
        if (!pages) return;
        const bytes = await busy('Extracting…', () => extractPages(doc, pages));
        const res = await Host.saveFile({ data: bytes, path: doc.path, suggestedName: `${baseName(doc.name)}-pages-${pages.length === 1 ? pages[0] + 1 : `${pages[0] + 1}-${pages[pages.length - 1] + 1}`}.pdf`, saveAs: true });
        if (res) toast(`Saved ${res.name}`, 'ok');
        return;
      }
      case 'split': {
        const groups = await splitDialog(doc);
        if (!groups) return;
        const files = await busy('Splitting…', async () => {
          const out = [];
          for (const g of groups) out.push({ name: `${baseName(doc.name)}-${g[0] + 1}${g.length > 1 ? '-' + (g[g.length - 1] + 1) : ''}.pdf`, data: await extractPages(doc, g) });
          return out;
        });
        const res = await Host.saveMany({ files, title: 'Choose a folder for the split files' });
        if (res) toast(`Saved ${res.count} files`, 'ok');
        return;
      }
      case 'compress': {
        const level = await compressDialog(doc);
        if (!level) return;
        const before = doc.bytes.length;
        const res = await busy('Compressing…', async () => compressPdfBytes(await buildPdf(doc, { encrypt: false }), COMPRESS_LEVELS[level], {
          protect: hasProtection(doc) ? doc.protect : null,
          onProgress: (i, n) => { if (n) $('#busyLabel').textContent = `Compressing images… ${Math.min(i + 1, n)} of ${n}`; },
        }));
        if (!(await compressResultDialog(before, res.bytes.length, res.images))) return;
        const saved = await Host.saveFile({ data: res.bytes, path: doc.path, suggestedName: `${baseName(doc.name)}-compressed.pdf`, saveAs: true });
        if (saved) toast(`Saved ${saved.name} (${fmtBytes(res.bytes.length)})`, 'ok');
        return;
      }
      case 'export-images': {
        const o = await exportImagesDialog(doc);
        if (!o) return;
        const files = await busy('Rendering pages…', async () => {
          const bytes = await buildPdf(doc, { encrypt: false });
          const tmp = await pdfjsLib.getDocument({ data: bytes, ...PDFJS_OPTS }).promise;
          const out = [];
          for (const i of o.pages) {
            const page = await tmp.getPage(i + 1);
            const vp = page.getViewport({ scale: o.dpi / 72 });
            const c = el('canvas', { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, c.width, c.height);
            await page.render({ canvasContext: ctx, viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE_STORAGE }).promise;
            out.push({ name: `${baseName(doc.name)}-page-${String(i + 1).padStart(3, '0')}.${o.format === 'png' ? 'png' : 'jpg'}`, data: await canvasToBytes(c, `image/${o.format}`, 0.92) });
          }
          tmp.destroy();
          return out;
        });
        const res = await Host.saveMany({ files, title: 'Choose a folder for the images' });
        if (res) toast(`Exported ${res.count} image${res.count === 1 ? '' : 's'}`, 'ok');
        return;
      }
      case 'export-text': {
        const text = await busy('Reading text…', async () => {
          let out = '';
          for (let i = 0; i < doc.pageCount; i++) out += `--- Page ${i + 1} ---\n${await pagePlainText(doc, i)}\n\n`;
          return out;
        });
        const res = await Host.saveFile({ data: new TextEncoder().encode(text), path: doc.path, suggestedName: baseName(doc.name) + '.txt', saveAs: true, kind: 'txt' });
        if (res) toast(`Saved ${res.name}`, 'ok');
        return;
      }
      case 'new-from-images': {
        const files = await Host.openDialog({ multi: true, kind: 'images', title: 'Choose images' });
        if (files.length) await openFiles(files);
        return;
      }
      case 'new-blank': {
        const d = await loadDocument({ name: 'Untitled.pdf', bytes: await createBlankPdf() }, passwordPrompt);
        markDirty(d);
        return addDoc(d);
      }
      case 'merge-files': {
        const files = (await Host.openDialog({ multi: true, kind: 'pdf', title: 'Choose PDFs to merge (in order)' })).filter((f) => isPdfBytes(f.data));
        if (files.length < 2) { if (files.length) toast('Choose at least two PDFs to merge.'); return; }
        const pw0 = await askSourcePassword(files[0].data, files[0].name);
        if (pw0 == null) return;
        const first = await PDFDocument.load(files[0].data, { password: pw0, updateMetadata: false });
        const d = await loadDocument({ name: 'Merged.pdf', bytes: await first.save() }, passwordPrompt);
        for (const f of files.slice(1)) {
          const pw = await askSourcePassword(f.data, f.name);
          if (pw == null) continue;
          await busy(`Adding ${f.name}…`, () => PageOps.insertPdf(d, d.pageCount, f.data, pw));
        }
        d.undoStack.length = 0;
        markDirty(d);
        await addDoc(d);
        toast(`Merged ${files.length} files`, 'ok');
        return;
      }
    }
  });
};

// ---------- sidebar ----------
const SIDEBAR_TABS = [['thumbs', 'Pages', 'layers'], ['outline', 'Bookmarks', 'bookmark'], ['comments', 'Comments', 'comments'], ['search', 'Search', 'search'], ['attachments', 'Attachments', 'paperclip']];
let thumbIO = null;

function renderSidebar() {
  const side = $('#sidebar');
  side.hidden = !App.sidebarOpen || !App.active;
  document.body.classList.toggle('sidebar-open', !side.hidden);
  const tabs = $('#sideTabs');
  tabs.innerHTML = '';
  for (const [k, label, ic] of SIDEBAR_TABS) {
    tabs.append(el('button', { class: 'side-tab' + (k === App.sidebarTab ? ' on' : ''), title: label, 'aria-label': label, onclick: () => { App.sidebarTab = k; renderSidebar(); } }, icon(ic, 18)));
  }
  if (side.hidden) return;
  const panel = $('#sidePanel');
  panel.innerHTML = '';
  const doc = App.active;
  const head = (t, extra) => el('div', { class: 'side-head' }, el('span', {}, t), extra || null);
  if (App.sidebarTab === 'thumbs') {
    panel.append(head('Pages', el('button', { class: 'icon-btn', title: 'Organize pages', 'aria-label': 'Organize pages', onclick: () => App.run('organize') }, icon('organize', 16))));
    const list = el('div', { class: 'thumbs' });
    if (thumbIO) thumbIO.disconnect();
    thumbIO = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        thumbIO.unobserve(e.target);
        renderThumb(doc, +e.target.dataset.index, e.target.querySelector('canvas'), 120).catch(() => {});
      }
    }, { root: panel, rootMargin: '300px' });
    doc.pageUids.forEach((_, i) => {
      const s = doc.sizes[i];
      const t = el('button', { class: 'thumb' + (i === Viewer.current ? ' on' : ''), dataset: { index: i }, 'aria-label': `Page ${i + 1}`, onclick: () => goToPage(i) },
        el('canvas', { style: { width: '120px', height: Math.round((120 * s.h) / s.w) + 'px' } }), el('span', { class: 'thumb-num' }, String(i + 1)));
      list.append(t);
      thumbIO.observe(t);
    });
    panel.append(list);
  } else if (App.sidebarTab === 'outline') {
    panel.append(head('Bookmarks'));
    const box = el('div', { class: 'outline' }, el('p', { class: 'muted pad' }, 'Loading…'));
    panel.append(box);
    doc.pdf.getOutline().then((outline) => {
      box.innerHTML = '';
      if (!outline || !outline.length) { box.append(el('p', { class: 'muted pad' }, 'This document has no bookmarks.')); return; }
      const build = (items) => el('ul', {}, ...items.map((it) => {
        const li = el('li', {});
        const row = el('div', { class: 'ol-row' });
        if (it.items && it.items.length) {
          const tog = el('button', { class: 'ol-toggle', 'aria-label': 'Expand' }, icon('chevRight', 12));
          tog.addEventListener('click', () => li.classList.toggle('open'));
          row.append(tog);
        } else row.append(el('span', { class: 'ol-spacer' }));
        row.append(el('button', { class: 'ol-link', title: it.title, onclick: () => (it.dest ? goToDest(it.dest) : it.url && Host.openExternal(it.url)) }, it.title));
        li.append(row);
        if (it.items && it.items.length) li.append(build(it.items));
        return li;
      }));
      box.append(build(outline));
    });
  } else if (App.sidebarTab === 'comments') {
    panel.append(head('Comments & edits'));
    const items = doc.allAnnots();
    const box = el('div', { class: 'comments' });
    if (!items.length) box.append(el('p', { class: 'muted pad' }, 'Your comments, highlights, signatures and other edits will be listed here.'));
    const label = { text: 'Text', note: 'Note', highlight: 'Highlight', underline: 'Underline', strike: 'Strikeout', ink: 'Drawing', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', image: 'Image', stamp: 'Stamp', symbol: 'Mark', whiteout: 'White-out', redact: 'Redaction' };
    for (const { page, annot } of items) {
      const desc = annot.text || annot.sub || (annot.role === 'signature' ? 'Signature' : annot.role === 'initials' ? 'Initials' : annot.role === 'seal' ? 'Seal' : '');
      box.append(el('button', { class: 'cmt', onclick: () => { goToPage(page, annotBBox(annot).y - 40, true); setTool('select'); select({ page, id: annot.id }); } },
        el('span', { class: 'cmt-type', style: { '--c': annot.color || annot.stroke || '#5b6472' } }, label[annot.type] || annot.type),
        el('span', { class: 'cmt-page' }, `p. ${page + 1}`),
        desc ? el('span', { class: 'cmt-text' }, desc.length > 120 ? desc.slice(0, 120) + '…' : desc) : null));
    }
    panel.append(box);
    const existing = el('div', { class: 'comments' });
    panel.append(existing);
    (async () => {
      const max = Math.min(doc.pageCount, 300);
      const found = [];
      for (let i = 0; i < max; i++) {
        const data = await pageAnnotationData(doc, i).catch(() => []);
        for (const a of data) if ((a.subtype === 'Text' || a.subtype === 'FreeText' || a.subtype === 'Highlight') && (a.contentsObj?.str)) found.push({ i, a });
      }
      if (!found.length || App.sidebarTab !== 'comments') return;
      existing.append(el('div', { class: 'side-sub' }, 'Already in this PDF'));
      for (const { i, a } of found) {
        existing.append(el('button', { class: 'cmt', onclick: () => goToPage(i) },
          el('span', { class: 'cmt-type' }, a.titleObj?.str || a.subtype), el('span', { class: 'cmt-page' }, `p. ${i + 1}`), el('span', { class: 'cmt-text' }, a.contentsObj.str)));
      }
    })();
  } else if (App.sidebarTab === 'search') {
    const mc = el('input', { type: 'checkbox', checked: Search.opts.matchCase });
    const ww = el('input', { type: 'checkbox', checked: Search.opts.wholeWord });
    const rerun = () => { Search.opts.matchCase = mc.checked; Search.opts.wholeWord = ww.checked; if (Search.query) runSearch(Search.query); };
    mc.addEventListener('change', rerun);
    ww.addEventListener('change', rerun);
    panel.append(head('Search'), el('div', { class: 'search-opts' }, el('label', { class: 'check' }, mc, 'Match case'), el('label', { class: 'check' }, ww, 'Whole words')));
    const list = el('div', { class: 'results', id: 'searchResults' });
    panel.append(list);
    renderSearchResults();
  } else if (App.sidebarTab === 'attachments') {
    panel.append(head('Attachments', el('button', { class: 'icon-btn', title: 'Attach a file', 'aria-label': 'Attach a file', onclick: () => App.run('attach') }, icon('plus', 16))));
    const box = el('div', { class: 'attachments' }, el('p', { class: 'muted pad' }, 'Loading…'));
    panel.append(box);
    doc.pdf.getAttachments().then((att) => {
      box.innerHTML = '';
      const entries = Object.values(att || {});
      if (!entries.length) { box.append(el('p', { class: 'muted pad' }, 'No files are attached to this PDF.')); return; }
      for (const a of entries) {
        box.append(el('div', { class: 'att' }, icon('paperclip', 16), el('span', { class: 'att-name', title: a.filename }, a.filename), el('span', { class: 'muted small' }, fmtBytes(a.content.length)),
          el('button', { class: 'icon-btn', title: 'Save attachment', 'aria-label': 'Save attachment', onclick: async () => { const r = await Host.saveFile({ data: a.content, suggestedName: a.filename, saveAs: true, kind: 'any' }); if (r) toast(`Saved ${r.name}`, 'ok'); } }, icon('download', 16))));
      }
    });
  }
}

function renderSearchResults() {
  const list = $('#searchResults');
  const counter = $('#findCount');
  if (counter) counter.textContent = Search.query ? (Search.hits.length ? `${Search.index + 1} / ${Search.hits.length}` : '0') : '';
  if (!list) return;
  list.innerHTML = '';
  if (!Search.query) { list.append(el('p', { class: 'muted pad' }, 'Type in the search box above to find words in this document.')); return; }
  list.append(el('div', { class: 'side-sub' }, `${Search.hits.length} result${Search.hits.length === 1 ? '' : 's'}`));
  Search.hits.slice(0, 500).forEach((h, n) => {
    list.append(el('button', { class: 'result' + (n === Search.index ? ' on' : ''), onclick: () => focusHit(n) },
      el('span', { class: 'cmt-page' }, `p. ${h.page + 1}`),
      el('span', { class: 'result-text' }, h.snippet.slice(0, h.at), el('mark', {}, h.snippet.slice(h.at, h.at + h.len)), h.snippet.slice(h.at + h.len))));
  });
}

function renderBanner() {
  const b = $('#banner');
  b.innerHTML = '';
  const doc = App.active;
  const msgs = [];
  if (doc) {
    if (doc.readOnlyReason) msgs.push(['warn', doc.readOnlyReason]);
    if (doc.hasSignatures) msgs.push(['info', 'This document contains digital signatures. Saving changes will invalidate them; use Save As to keep the signed original.']);
    if (doc.protect) msgs.push(['info', doc.protect.keep ? 'This file was opened with a password. It will stay password protected when you save.' : 'This file will be encrypted with a password when you save.', ['Change', () => App.run('protect')]]);
    if (doc.hasForm && !doc.hasSignatures) msgs.push(['info', 'This document has fillable form fields. Click a field to type in it.']);
  }
  b.hidden = !msgs.length;
  for (const [kind, text, action] of msgs) {
    b.append(el('div', { class: `banner banner-${kind}` }, icon(kind === 'warn' ? 'warning' : 'info', 16), el('span', {}, text),
      action ? el('button', { class: 'btn btn-ghost', onclick: action[1] }, action[0]) : null));
  }
}

// ---------- keyboard ----------
const TOOL_KEYS = { v: 'select', h: 'hand', t: 'text', e: 'edittext', u: 'highlight', p: 'pen', n: 'note', r: 'rect' };
function onKeyDown(e) {
  if ($('#modalRoot').children.length) return;
  const ae = document.activeElement;
  const typing = ae && (ae.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName));
  const mod = e.ctrlKey || e.metaKey;
  if (typing) return;
  if (mod) {
    const k = e.key.toLowerCase();
    const map = { o: 'open', s: e.shiftKey ? 'save-as' : 'save', p: 'print', f: 'find', z: e.shiftKey ? 'redo' : 'undo', y: 'redo', '=': 'zoom-in', '+': 'zoom-in', '-': 'zoom-out', 0: 'zoom-actual', 1: 'zoom-page', 2: 'zoom-width', w: 'close-tab', l: 'present' };
    if (k === 'd' && selectedAnnot()) { e.preventDefault(); duplicateSelected(); return; }
    if (map[k] !== undefined && !(k === 'c' || k === 'v')) { e.preventDefault(); App.run(map[k]); return; }
  }
  if (!App.active) return;
  if (annotationKeys(e)) { e.preventDefault(); return; }
  if (Organizer.open) return;
  if (!mod && !e.altKey) {
    const k = e.key.toLowerCase();
    if (TOOL_KEYS[k]) { setTool(TOOL_KEYS[k]); return; }
    if (k === 's') { App.run('sign'); return; }
    if (e.key === 'F4') { App.run('toggle-sidebar'); return; }
    if (e.key === 'F1') { App.run('shortcuts'); return; }
    const presenting = document.body.classList.contains('presenting');
    if (e.key === 'PageDown' || (presenting && (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' '))) { e.preventDefault(); goToPage(Viewer.current + 1); return; }
    if (e.key === 'PageUp' || (presenting && (e.key === 'ArrowLeft' || e.key === 'ArrowUp'))) { e.preventDefault(); goToPage(Viewer.current - 1); return; }
    if (e.key === 'Home') { e.preventDefault(); goToPage(0); return; }
    if (e.key === 'End') { e.preventDefault(); goToPage(App.active.pageCount - 1); }
  }
}

function setupDragDrop() {
  const stage = document.body;
  let depth = 0;
  stage.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { depth++; document.body.classList.add('dropping'); } });
  stage.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('dropping'); });
  stage.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
  stage.addEventListener('drop', async (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dropping');
    const files = await Promise.all([...e.dataTransfer.files].map(async (f) => ({ name: f.name, path: null, data: new Uint8Array(await f.arrayBuffer()) })));
    openFiles(files);
  });
}

function wireEvents() {
  const v = viewerEl();
  $('#pages').addEventListener('pointerdown', onPointerDown);
  v.addEventListener('pointerdown', (e) => { if (e.target === v || e.target.id === 'pages') onPointerDown(e); });
  document.addEventListener('pointerup', () => { if (MARKUP_TOOLS.has(Annotations.tool)) setTimeout(applySelectionMarkup, 0); });
  v.addEventListener('scroll', () => { updateCurrentPage(); }, { passive: true });
  v.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey) || !App.active) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0025);
    setZoom('custom', clamp(Viewer.scale * factor, 0.1, 8));
  }, { passive: false });
  v.addEventListener('dblclick', (e) => {
    const annEl = e.target.closest('.ann');
    if (!annEl || Annotations.tool !== 'select') return;
    const hit = Viewer.doc.findAnnot(annEl.dataset.id);
    if (!hit) return;
    if (hit.annot.type === 'text') startTextEdit(hit.page, hit.annot, {});
    if (hit.annot.type === 'note') openNotePopup(hit.page, hit.annot);
  });
  window.addEventListener('resize', debounce(() => { if (App.active && App.active.zoom.mode !== 'custom') setZoom(App.active.zoom.mode); }, 150));
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('copy', (e) => {
    const a = selectedAnnot();
    if (!a || Annotations.editing || window.getSelection()?.toString()) return;
    Annotations.clipboard = structuredClone(a);
    e.preventDefault();
    toast('Copied');
  });
  document.addEventListener('paste', (e) => {
    const ae = document.activeElement;
    if (!App.active || (ae && (ae.isContentEditable || /^(INPUT|TEXTAREA)$/.test(ae.tagName)))) return;
    const item = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith('image/'));
    if (item) {
      e.preventDefault();
      const reader = new FileReader();
      reader.onload = async () => { const img = await loadImage(reader.result); const k = Math.min(1, 240 / img.width, 240 / img.height); setPending({ kind: 'image', src: reader.result, w: img.width * k, h: img.height * k, hint: 'Click on the page to place the pasted image.' }); };
      reader.readAsDataURL(item.getAsFile());
      return;
    }
    if (Annotations.clipboard) { e.preventDefault(); duplicateSelected(Viewer.current, 12); }
  });

  document.addEventListener('page-changed', renderStatus);
  document.addEventListener('zoom-changed', renderStatus);
  document.addEventListener('doc-dirty', (e) => { if (e.detail === App.active) renderStatus(); renderDocTabs(); updateTitle(); });
  document.addEventListener('tool-changed', () => renderRibbon());
  document.addEventListener('annots-changed', () => { if (App.sidebarTab === 'comments') renderSidebar(); });
  document.addEventListener('search-updated', renderSearchResults);
  document.addEventListener('organizer-toggled', () => renderSidebar());

  Host.onMenu((cmd) => App.run(cmd));
  Host.onOpenPaths((paths) => openPaths(paths));
}


