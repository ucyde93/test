'use strict';
/* Document model and every operation that writes PDF bytes.
 *
 * Coordinates: annotations are stored in "display units", i.e. PDF points
 * measured from the top-left corner of the page as it is shown (page rotation
 * applied), at zoom 1. They are converted to PDF user space only when the file
 * is written, so drawing tools never need to think about rotation or crop boxes.
 */

const {
  PDFDocument, PDFPage, StandardFonts, rgb, degrees, BlendMode, LineCapStyle,
  PDFName, PDFString, PDFHexString, PDFNumber, PDFDict, PDFArray, PDFRef, PDFStream, PDFBool,
  PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList,
} = PDFLib;

pdfjsLib.GlobalWorkerOptions.workerSrc = '../node_modules/pdfjs-dist/build/pdf.worker.min.js';
const PDFJS_OPTS = {
  cMapUrl: '../node_modules/pdfjs-dist/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '../node_modules/pdfjs-dist/standard_fonts/',
  isEvalSupported: false,
};

// Text box layout constants shared by the on-screen editor and the PDF writer.
const TEXT_PAD = 3;
const LINE_H = 1.2;
const FONT_CSS = {
  Helvetica: "Arial, 'Liberation Sans', Helvetica, sans-serif",
  Times: "'Times New Roman', 'Liberation Serif', Times, serif",
  Courier: "'Courier New', 'Liberation Mono', Courier, monospace",
};
// Ascent/descent of the matching screen fonts, used to put PDF baselines where the
// browser draws them.
const FONT_METRICS = { Helvetica: [0.905, 0.212], Times: [0.891, 0.216], Courier: [0.833, 0.3] };
const NOTE_SIZE = 22;

function baselineOffset(font, size) {
  const [a, d] = FONT_METRICS[font] || FONT_METRICS.Helvetica;
  return ((LINE_H - (a + d)) / 2 + a) * size;
}
function standardFontKey(font, bold, italic) {
  if (font === 'Times') return bold && italic ? 'TimesRomanBoldItalic' : bold ? 'TimesRomanBold' : italic ? 'TimesRomanItalic' : 'TimesRoman';
  if (font === 'Courier') return bold && italic ? 'CourierBoldOblique' : bold ? 'CourierBold' : italic ? 'CourierOblique' : 'Courier';
  return bold && italic ? 'HelveticaBoldOblique' : bold ? 'HelveticaBold' : italic ? 'HelveticaOblique' : 'Helvetica';
}
function cssFont(a, scale = 1) {
  return `${a.italic ? 'italic ' : ''}${a.bold ? '700 ' : '400 '}${a.size * scale}px ${FONT_CSS[a.font] || FONT_CSS.Helvetica}`;
}

/** Greedy word wrap shared by screen and PDF so both break lines identically. */
function wrapText(text, measure, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    if (!para) { lines.push(''); continue; }
    const tokens = para.split(/(\s+)/).filter((t) => t.length);
    let line = '';
    for (const tok of tokens) {
      const cand = line + tok;
      if (!line || measure(cand) <= maxW) { line = cand; continue; }
      if (/^\s+$/.test(tok)) { lines.push(line); line = ''; continue; }
      lines.push(line.replace(/\s+$/, ''));
      line = tok;
      // Break a single word that is wider than the box.
      while (measure(line) > maxW && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && measure(line.slice(0, cut)) > maxW) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line);
  }
  return lines;
}

const _measureCanvas = document.createElement('canvas').getContext('2d');
function measureLinesForScreen(a) {
  _measureCanvas.font = cssFont(a);
  const maxW = Math.max(4, a.w - 2 * TEXT_PAD);
  return wrapText(a.text || '', (s) => _measureCanvas.measureText(s).width, maxW);
}
function textBoxHeight(a) {
  return measureLinesForScreen(a).length * a.size * LINE_H + 2 * TEXT_PAD;
}

// ---------- geometry ----------
function pageGeom(page) {
  const cb = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  return { mx: cb.x, my: cb.y, W: cb.width, H: cb.height, rot };
}
/** Display point (top-left origin, rotation applied) → PDF user space. */
function d2p(g, x, y) {
  switch (g.rot) {
    case 90: return { x: g.mx + y, y: g.my + x };
    case 180: return { x: g.mx + g.W - x, y: g.my + y };
    case 270: return { x: g.mx + g.W - y, y: g.my + g.H - x };
    default: return { x: g.mx + x, y: g.my + g.H - y };
  }
}
function d2pRect(g, x, y, w, h) {
  const a = d2p(g, x, y);
  const b = d2p(g, x + w, y + h);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}
const rgbOf = (hex) => rgb(...hexToRgb01(hex));

// ---------- annotation geometry (display units) ----------
function annotBBox(a) {
  if (a.pts || a.strokes || a.rects) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    if (a.pts) a.pts.forEach(([x, y]) => add(x, y));
    if (a.strokes) a.strokes.forEach((s) => s.forEach(([x, y]) => add(x, y)));
    if (a.rects) a.rects.forEach((r) => { add(r.x, r.y); add(r.x + r.w, r.y + r.h); });
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }
  if (a.type === 'note') return { x: a.x, y: a.y, w: NOTE_SIZE, h: NOTE_SIZE };
  return { x: a.x, y: a.y, w: a.w, h: a.h };
}
/** Moves/scales an annotation so its bounding box becomes `to`. */
function setAnnotBBox(a, to) {
  const from = annotBBox(a);
  const sx = to.w / (from.w || 1);
  const sy = to.h / (from.h || 1);
  const mapX = (x) => to.x + (x - from.x) * sx;
  const mapY = (y) => to.y + (y - from.y) * sy;
  if (a.pts) a.pts = a.pts.map(([x, y]) => [mapX(x), mapY(y)]);
  else if (a.strokes) a.strokes = a.strokes.map((s) => s.map(([x, y]) => [mapX(x), mapY(y)]));
  else if (a.rects) a.rects = a.rects.map((r) => ({ x: mapX(r.x), y: mapY(r.y), w: r.w * sx, h: r.h * sy }));
  else { a.x = to.x; a.y = to.y; if (a.type !== 'note') { a.w = to.w; a.h = to.h; } }
}
function moveAnnot(a, dx, dy) {
  const b = annotBBox(a);
  if (a.pts || a.strokes || a.rects) setAnnotBBox(a, { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h });
  else { a.x += dx; a.y += dy; }
}

// ---------- the document ----------
let pageUidSeq = 0;
const newPageUid = () => 'pg' + ++pageUidSeq;

class SahifaDoc {
  constructor({ name, path, bytes }) {
    this.id = uid('d');
    this.name = name || 'Untitled.pdf';
    this.path = path || null;
    this.bytes = bytes;
    this.pdf = null; // pdf.js document
    this.pageUids = [];
    this.sizes = []; // display size of each page at zoom 1: {w, h, rot}
    this.annots = new Map(); // pageUid -> [annotation]
    this.formValues = {}; // field name -> value
    this.meta = null; // pending document info edits
    this.protect = null; // {userPassword, ownerPassword, permissions}
    this.openPassword = null; // password the file was opened with
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.version = 0; // bumps whenever bytes change
    this.textCache = new Map();
    this.annotDataCache = new Map();
    this.zoom = { mode: 'width', scale: 1 };
    this.scrollTop = 0;
    this.hasSignatures = false;
  }
  get pageCount() { return this.pageUids.length; }
  annotsAt(i) {
    const k = this.pageUids[i];
    if (!this.annots.has(k)) this.annots.set(k, []);
    return this.annots.get(k);
  }
  findAnnot(id) {
    for (let i = 0; i < this.pageUids.length; i++) {
      const list = this.annots.get(this.pageUids[i]);
      const a = list && list.find((x) => x.id === id);
      if (a) return { page: i, annot: a, list };
    }
    return null;
  }
  allAnnots() {
    const out = [];
    this.pageUids.forEach((k, i) => (this.annots.get(k) || []).forEach((a) => out.push({ page: i, annot: a })));
    return out;
  }
}

class PasswordNeeded extends Error {
  constructor(incorrect) { super(incorrect ? 'Incorrect password' : 'Password required'); this.incorrect = incorrect; }
}

async function openPdfjs(bytes, password) {
  try {
    return await pdfjsLib.getDocument({ data: bytes.slice(), password: password ?? undefined, ...PDFJS_OPTS }).promise;
  } catch (e) {
    if (e && e.name === 'PasswordException') throw new PasswordNeeded(e.code === 2);
    throw e;
  }
}

function looksEncrypted(bytes) {
  // Only the trailer area and xref streams can mention /Encrypt; scanning the tail is enough for normal files.
  const tail = bytes.subarray(Math.max(0, bytes.length - 64 * 1024));
  let s = '';
  for (let i = 0; i < tail.length; i++) s += String.fromCharCode(tail[i]);
  if (s.includes('/Encrypt')) return true;
  const head = bytes.subarray(0, Math.min(bytes.length, 4 * 1024 * 1024));
  s = '';
  for (let i = 0; i < head.length; i += 1) s += String.fromCharCode(head[i]);
  return s.includes('/Encrypt');
}

/** Loads bytes into a SahifaDoc. `askPassword(incorrect)` resolves to a password or null. */
async function loadDocument({ name, path, bytes, data }, askPassword) {
  bytes = bytes || data;
  let password = null;
  let pdf;
  for (;;) {
    try { pdf = await openPdfjs(bytes, password); break; } catch (e) {
      if (!(e instanceof PasswordNeeded)) throw e;
      password = await askPassword(e.incorrect && password != null, name);
      if (password == null) return null;
    }
  }
  const doc = new SahifaDoc({ name, path, bytes });
  // Encrypted files are decrypted once so every later edit can work on plain bytes.
  if (looksEncrypted(bytes)) {
    try {
      const dec = await PDFDocument.load(bytes, { password: password ?? '', updateMetadata: false });
      doc.bytes = await dec.save();
      doc.openPassword = password;
      if (password) doc.protect = { userPassword: password, ownerPassword: password, keep: true };
      pdf.destroy();
      pdf = await openPdfjs(doc.bytes);
    } catch (e) {
      console.warn('Could not decrypt for editing', e);
      doc.readOnlyReason = 'This file uses encryption that cannot be edited here. You can still read and print it.';
    }
  }
  doc.pdf = pdf;
  doc.pageUids = Array.from({ length: pdf.numPages }, newPageUid);
  await refreshSizes(doc);
  await initFormValues(doc);
  return doc;
}

async function refreshSizes(doc) {
  const n = doc.pdf.numPages;
  const sizes = new Array(n);
  const batch = 24;
  for (let i = 0; i < n; i += batch) {
    await Promise.all(
      Array.from({ length: Math.min(batch, n - i) }, async (_, k) => {
        const p = await doc.pdf.getPage(i + k + 1);
        const vp = p.getViewport({ scale: 1 });
        sizes[i + k] = { w: vp.width, h: vp.height, rot: vp.rotation };
      })
    );
  }
  doc.sizes = sizes;
}

async function initFormValues(doc) {
  try {
    const fields = await doc.pdf.getFieldObjects();
    doc.hasForm = !!fields && Object.keys(fields).length > 0;
    doc.hasSignatures = !!fields && Object.values(fields).some((arr) => arr.some((f) => f.type === 'signature'));
  } catch { doc.hasForm = false; }
}

/** Replaces the pdf.js document after `doc.bytes` changed. */
async function reloadPdfjs(doc) {
  const old = doc.pdf;
  doc.pdf = await openPdfjs(doc.bytes);
  doc.version++;
  doc.textCache.clear();
  doc.annotDataCache.clear();
  await refreshSizes(doc);
  await initFormValues(doc);
  if (old) old.destroy();
}

// ---------- undo / redo ----------
function snapshot(doc) {
  return {
    bytes: doc.bytes,
    pageUids: doc.pageUids.slice(),
    annots: structuredClone([...doc.annots]),
    formValues: { ...doc.formValues },
    meta: doc.meta ? { ...doc.meta } : null,
  };
}
function pushUndo(doc) {
  doc.undoStack.push(snapshot(doc));
  if (doc.undoStack.length > 80) doc.undoStack.shift();
  doc.redoStack.length = 0;
  markDirty(doc);
}
async function restoreSnapshot(doc, snap) {
  const bytesChanged = snap.bytes !== doc.bytes;
  doc.bytes = snap.bytes;
  doc.pageUids = snap.pageUids.slice();
  doc.annots = new Map(structuredClone(snap.annots));
  doc.formValues = { ...snap.formValues };
  doc.meta = snap.meta;
  if (bytesChanged) await reloadPdfjs(doc);
  return bytesChanged;
}
async function undo(doc) {
  if (!doc.undoStack.length) return null;
  doc.redoStack.push(snapshot(doc));
  const changed = await restoreSnapshot(doc, doc.undoStack.pop());
  markDirty(doc);
  return { bytesChanged: changed };
}
async function redo(doc) {
  if (!doc.redoStack.length) return null;
  doc.undoStack.push(snapshot(doc));
  const changed = await restoreSnapshot(doc, doc.redoStack.pop());
  markDirty(doc);
  return { bytesChanged: changed };
}
function markDirty(doc, dirty = true) {
  doc.dirty = dirty;
  document.dispatchEvent(new CustomEvent('doc-dirty', { detail: doc }));
}

// ---------- low level pdf-lib helpers ----------
async function loadLib(doc) {
  if (doc.readOnlyReason) throw new Error(doc.readOnlyReason);
  return PDFDocument.load(doc.bytes, { updateMetadata: false });
}

/** Rebuilds the page tree as a flat list in the given order. Inherited
 *  attributes are copied onto each page first so nothing is lost. */
function setPageOrder(pdf, refs) {
  const ctx = pdf.context;
  const pagesRef = pdf.catalog.get(PDFName.of('Pages'));
  const root = ctx.lookup(pagesRef, PDFDict);
  const inheritable = ['Resources', 'MediaBox', 'CropBox', 'Rotate'].map((k) => PDFName.of(k));
  for (const ref of refs) {
    const leaf = ctx.lookup(ref, PDFDict);
    for (const key of inheritable) {
      if (leaf.has(key)) continue;
      let p = leaf.get(PDFName.of('Parent'));
      while (p) {
        const node = ctx.lookup(p);
        if (!(node instanceof PDFDict)) break;
        if (node.has(key)) { leaf.set(key, node.get(key)); break; }
        p = node.get(PDFName.of('Parent'));
      }
    }
  }
  for (const ref of refs) ctx.lookup(ref, PDFDict).set(PDFName.of('Parent'), pagesRef);
  root.set(PDFName.of('Kids'), ctx.obj(refs));
  root.set(PDFName.of('Count'), PDFNumber.of(refs.length));
}

/** Deletes every object no longer reachable from the trailer, so removed pages
 *  and redacted content are really gone from the saved file. */
function collectGarbage(pdf) {
  const ctx = pdf.context;
  const seen = new Set();
  const stack = [ctx.trailerInfo.Root, ctx.trailerInfo.Info, ctx.trailerInfo.Encrypt].filter(Boolean);
  while (stack.length) {
    let o = stack.pop();
    if (o instanceof PDFRef) {
      if (seen.has(o)) continue;
      seen.add(o);
      o = ctx.lookup(o);
    }
    if (!o) continue;
    if (o instanceof PDFStream) o = o.dict;
    if (o instanceof PDFDict) for (const [, v] of o.entries()) stack.push(v);
    else if (o instanceof PDFArray) for (const v of o.asArray()) stack.push(v);
  }
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref)) ctx.delete(ref);
}

async function savePdf(pdf, { gc = false, keepAppearances = false } = {}) {
  if (gc) { try { collectGarbage(pdf); } catch (e) { console.warn('gc skipped', e); } }
  if (keepAppearances) return pdf.save({ updateFieldAppearances: false });
  try {
    return await pdf.save();
  } catch (e) {
    // Field text the standard fonts cannot encode (e.g. Arabic): let viewers build appearances.
    try {
      pdf.getForm().acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
      return await pdf.save({ updateFieldAppearances: false });
    } catch {
      throw e;
    }
  }
}

// ---------- drawing annotations into a PDF ----------
class DrawContext {
  constructor(pdf) { this.pdf = pdf; this.fonts = new Map(); this.images = new Map(); }
  async font(key) {
    if (!this.fonts.has(key)) this.fonts.set(key, await this.pdf.embedFont(StandardFonts[key]));
    return this.fonts.get(key);
  }
  async image(src) {
    if (!this.images.has(src)) {
      const bytes = dataUrlToBytes(src);
      this.images.set(src, src.startsWith('data:image/png') ? await this.pdf.embedPng(bytes) : await this.pdf.embedJpg(bytes));
    }
    return this.images.get(src);
  }
}

const _charSets = new WeakMap();
/** True when every character exists in the font (standard fonts only cover Latin-1 style text). */
function fontCanEncode(font, text) {
  let set = _charSets.get(font);
  if (!set) { set = new Set(font.getCharacterSet()); _charSets.set(font, set); }
  for (const ch of text.replace(/[\r\n\t]/g, ' ')) if (!set.has(ch.codePointAt(0))) return false;
  return true;
}

/** Renders a text box to a PNG (used for scripts the standard PDF fonts lack, such as Arabic). */
function rasterizeTextBox(a, factor = 4) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(a.w * factor));
  c.height = Math.max(1, Math.ceil(a.h * factor));
  const ctx = c.getContext('2d');
  ctx.scale(factor, factor);
  if (a.bg) { ctx.fillStyle = a.bg; ctx.fillRect(0, 0, a.w, a.h); }
  ctx.font = cssFont(a);
  ctx.fillStyle = a.color || '#000';
  ctx.textBaseline = 'alphabetic';
  const rtl = isRtl(a.text);
  ctx.direction = rtl ? 'rtl' : 'ltr';
  const lines = measureLinesForScreen(a);
  const align = a.align || (rtl ? 'right' : 'left');
  lines.forEach((ln, i) => {
    const y = TEXT_PAD + i * a.size * LINE_H + baselineOffset(a.font, a.size);
    ctx.textAlign = align;
    const x = align === 'center' ? a.w / 2 : align === 'right' ? a.w - TEXT_PAD : TEXT_PAD;
    ctx.fillText(ln, x, y);
  });
  return c.toDataURL('image/png');
}

async function drawAnnot(dc, page, a) {
  const g = pageGeom(page);
  const rot = degrees(g.rot);
  const opacity = a.opacity ?? 1;
  const P = (x, y) => d2p(g, x, y);

  switch (a.type) {
    case 'text': {
      if (!a.text || !a.text.trim()) return;
      const key = standardFontKey(a.font, a.bold, a.italic);
      const font = await dc.font(key);
      if (!fontCanEncode(font, a.text)) {
        const img = await dc.image(rasterizeTextBox(a));
        const p = P(a.x, a.y + a.h);
        page.drawImage(img, { x: p.x, y: p.y, width: a.w, height: a.h, rotate: rot, opacity });
        return;
      }
      if (a.bg) {
        const p = P(a.x, a.y + a.h);
        page.drawRectangle({ x: p.x, y: p.y, width: a.w, height: a.h, color: rgbOf(a.bg), rotate: rot, opacity });
      }
      const maxW = Math.max(4, a.w - 2 * TEXT_PAD);
      const lines = wrapText(a.text, (s) => font.widthOfTextAtSize(s, a.size), maxW);
      lines.forEach((ln, i) => {
        if (!ln) return;
        const tw = font.widthOfTextAtSize(ln, a.size);
        let dx = TEXT_PAD;
        if (a.align === 'center') dx = (a.w - tw) / 2;
        else if (a.align === 'right') dx = a.w - TEXT_PAD - tw;
        const p = P(a.x + dx, a.y + TEXT_PAD + i * a.size * LINE_H + baselineOffset(a.font, a.size));
        page.drawText(ln, { x: p.x, y: p.y, size: a.size, font, color: rgbOf(a.color), rotate: rot, opacity });
      });
      if (a.underline) {
        lines.forEach((ln, i) => {
          if (!ln) return;
          const tw = font.widthOfTextAtSize(ln, a.size);
          const dx = a.align === 'center' ? (a.w - tw) / 2 : a.align === 'right' ? a.w - TEXT_PAD - tw : TEXT_PAD;
          const yy = a.y + TEXT_PAD + i * a.size * LINE_H + baselineOffset(a.font, a.size) + a.size * 0.12;
          page.drawLine({ start: P(a.x + dx, yy), end: P(a.x + dx + tw, yy), thickness: Math.max(0.6, a.size / 16), color: rgbOf(a.color), opacity });
        });
      }
      return;
    }
    case 'rect':
    case 'whiteout': {
      const p = P(a.x, a.y + a.h);
      const fill = a.type === 'whiteout' ? (a.fill || '#ffffff') : a.fill;
      page.drawRectangle({
        x: p.x, y: p.y, width: a.w, height: a.h, rotate: rot,
        color: fill ? rgbOf(fill) : undefined,
        opacity,
        borderColor: a.type === 'rect' && a.stroke ? rgbOf(a.stroke) : undefined,
        borderWidth: a.type === 'rect' && a.stroke ? a.width : 0,
        borderOpacity: opacity,
      });
      return;
    }
    case 'ellipse': {
      const c = P(a.x + a.w / 2, a.y + a.h / 2);
      const swap = g.rot === 90 || g.rot === 270;
      page.drawEllipse({
        x: c.x, y: c.y,
        xScale: (swap ? a.h : a.w) / 2, yScale: (swap ? a.w : a.h) / 2,
        color: a.fill ? rgbOf(a.fill) : undefined, opacity,
        borderColor: a.stroke ? rgbOf(a.stroke) : undefined, borderWidth: a.stroke ? a.width : 0, borderOpacity: opacity,
      });
      return;
    }
    case 'line': {
      const [[x1, y1], [x2, y2]] = a.pts;
      const color = rgbOf(a.stroke);
      const line = (sx, sy, ex, ey) => page.drawLine({ start: P(sx, sy), end: P(ex, ey), thickness: a.width, color, opacity, lineCap: LineCapStyle.Round });
      line(x1, y1, x2, y2);
      if (a.arrow) {
        const th = Math.atan2(y2 - y1, x2 - x1);
        const L = Math.max(8, a.width * 4);
        for (const s of [-1, 1]) line(x2, y2, x2 - L * Math.cos(th + s * 0.45), y2 - L * Math.sin(th + s * 0.45));
      }
      return;
    }
    case 'ink': {
      for (const stroke of a.strokes) {
        if (stroke.length === 1) {
          const c = P(...stroke[0]);
          page.drawCircle({ x: c.x, y: c.y, size: a.width / 2, color: rgbOf(a.stroke), opacity });
          continue;
        }
        const path = stroke.map(([x, y], i) => { const p = P(x, y); return `${i ? 'L' : 'M'}${p.x.toFixed(2)},${(-p.y).toFixed(2)}`; }).join(' ');
        page.drawSvgPath(path, { x: 0, y: 0, borderColor: rgbOf(a.stroke), borderWidth: a.width, borderOpacity: opacity, borderLineCap: LineCapStyle.Round });
      }
      return;
    }
    case 'highlight':
    case 'underline':
    case 'strike': {
      for (const r of a.rects) {
        if (a.type === 'highlight') {
          const p = P(r.x, r.y + r.h);
          page.drawRectangle({ x: p.x, y: p.y, width: r.w, height: r.h, rotate: rot, color: rgbOf(a.color), opacity: a.opacity ?? 0.4, blendMode: BlendMode.Multiply });
        } else {
          const yy = a.type === 'underline' ? r.y + r.h * 0.94 : r.y + r.h * 0.55;
          page.drawLine({ start: P(r.x, yy), end: P(r.x + r.w, yy), thickness: Math.max(0.8, r.h * 0.07), color: rgbOf(a.color), opacity: a.opacity ?? 1 });
        }
      }
      return;
    }
    case 'image': {
      const img = await dc.image(a.src);
      const p = P(a.x, a.y + a.h);
      page.drawImage(img, { x: p.x, y: p.y, width: a.w, height: a.h, rotate: rot, opacity });
      return;
    }
    case 'stamp': {
      const p = P(a.x, a.y + a.h);
      const color = rgbOf(a.color);
      const bw = Math.max(1.5, Math.min(a.w, a.h) * 0.05);
      page.drawRectangle({ x: p.x, y: p.y, width: a.w, height: a.h, rotate: rot, borderColor: color, borderWidth: bw, borderOpacity: opacity, color: rgb(1, 1, 1), opacity: 0 });
      const font = await dc.font('HelveticaBold');
      const sub = a.sub || '';
      const fit = (s, maxH, maxW) => Math.max(4, Math.min(maxH, maxW / Math.max(1, font.widthOfTextAtSize(s, 1))));
      const mainSize = fit(a.text, sub ? a.h * 0.42 : a.h * 0.55, a.w - 4 * bw - 8);
      const mainW = font.widthOfTextAtSize(a.text, mainSize);
      const mainBase = sub ? a.y + a.h * 0.52 : a.y + a.h / 2 + mainSize * 0.36;
      if (fontCanEncode(font, a.text)) page.drawText(a.text, { ...P(a.x + (a.w - mainW) / 2, mainBase), size: mainSize, font, color, rotate: rot, opacity });
      if (sub) {
        const f2 = await dc.font('Helvetica');
        if (fontCanEncode(f2, sub)) {
          const s2 = Math.max(4, Math.min(a.h * 0.18, (a.w - 4 * bw - 8) / Math.max(1, f2.widthOfTextAtSize(sub, 1))));
          const w2 = f2.widthOfTextAtSize(sub, s2);
          page.drawText(sub, { ...P(a.x + (a.w - w2) / 2, a.y + a.h * 0.82), size: s2, font: f2, color, rotate: rot, opacity });
        }
      }
      return;
    }
    case 'symbol': {
      const color = rgbOf(a.color);
      const t = Math.max(1.2, Math.min(a.w, a.h) * 0.13);
      const at = (fx, fy) => P(a.x + fx * a.w, a.y + fy * a.h);
      const ln = (p, q) => page.drawLine({ start: p, end: q, thickness: t, color, opacity, lineCap: LineCapStyle.Round });
      if (a.sym === 'check') { ln(at(0.12, 0.55), at(0.4, 0.84)); ln(at(0.4, 0.84), at(0.9, 0.16)); }
      else if (a.sym === 'cross') { ln(at(0.15, 0.15), at(0.85, 0.85)); ln(at(0.85, 0.15), at(0.15, 0.85)); }
      else { const c = at(0.5, 0.5); page.drawEllipse({ x: c.x, y: c.y, xScale: a.w * 0.32, yScale: a.h * 0.32, color, opacity }); }
      return;
    }
    case 'note': {
      const r = d2pRect(g, a.x, a.y, NOTE_SIZE, NOTE_SIZE);
      const [cr, cg, cb] = hexToRgb01(a.color || '#f5c400');
      const ctx = dc.pdf.context;
      const annot = ctx.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: [r.x, r.y, r.x + r.width, r.y + r.height],
        Contents: PDFHexString.fromText(a.text || ''),
        T: PDFHexString.fromText(a.author || 'Sahifa PDF'),
        M: PDFString.fromDate(new Date(a.created || Date.now())),
        Name: 'Comment',
        C: [cr, cg, cb],
        F: 4,
        Open: false,
      });
      page.node.addAnnot(ctx.register(annot));
      return;
    }
    case 'redact': {
      // Unapplied redactions are written as plain black boxes. Apply Redactions also removes the content beneath.
      const p = P(a.x, a.y + a.h);
      page.drawRectangle({ x: p.x, y: p.y, width: a.w, height: a.h, rotate: rot, color: rgb(0, 0, 0) });
      return;
    }
  }
}

async function drawPageAnnots(dc, page, list) {
  for (const a of list) await drawAnnot(dc, page, a);
}

/** Writes form values. Returns text fields whose text the standard fonts cannot draw. */
function applyFormValues(pdf, values, latinFont) {
  const names = Object.keys(values);
  const unicodeFields = [];
  if (!names.length) return unicodeFields;
  let form;
  try { form = pdf.getForm(); } catch { return unicodeFields; }
  for (const name of names) {
    const v = values[name];
    let f;
    try { f = form.getField(name); } catch { continue; }
    try {
      if (f instanceof PDFTextField) {
        f.setText(v == null ? '' : String(v));
        if (latinFont && v && !fontCanEncode(latinFont, String(v))) unicodeFields.push(f);
      }
      else if (f instanceof PDFCheckBox) (v && v !== 'Off' ? f.check() : f.uncheck());
      else if (f instanceof PDFRadioGroup) { if (v && v !== 'Off') f.select(String(v)); else f.clear(); }
      else if (f instanceof PDFDropdown) { if (v) f.select(Array.isArray(v) ? v[0] : String(v)); else f.clear(); }
      else if (f instanceof PDFOptionList) { if (v && v.length) f.select(Array.isArray(v) ? v : [String(v)]); else f.clear(); }
    } catch (e) {
      console.warn('Could not set field', name, e);
    }
  }
  return unicodeFields;
}

/** Lets PDF viewers draw fields holding non-Latin text with their own fonts. */
async function finishUnicodeFields(pdf, fields) {
  const form = pdf.getForm();
  form.updateFieldAppearances(await pdf.embedFont(StandardFonts.Helvetica));
  for (const f of fields) for (const w of f.acroField.getWidgets()) w.dict.delete(PDFName.of('AP'));
  form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
}

function applyMeta(pdf, meta) {
  if (!meta) return;
  if (meta.strip) {
    pdf.setTitle(''); pdf.setAuthor(''); pdf.setSubject(''); pdf.setKeywords([]); pdf.setCreator(''); pdf.setProducer('');
    pdf.catalog.delete(PDFName.of('Metadata'));
    // Remove document-level scripts and embedded files as part of "Remove hidden information".
    const names = pdf.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
    if (names) { names.delete(PDFName.of('JavaScript')); if (meta.stripAttachments) names.delete(PDFName.of('EmbeddedFiles')); }
    pdf.catalog.delete(PDFName.of('OpenAction'));
    return;
  }
  if (meta.title != null) pdf.setTitle(meta.title);
  if (meta.author != null) pdf.setAuthor(meta.author);
  if (meta.subject != null) pdf.setSubject(meta.subject);
  if (meta.keywords != null) pdf.setKeywords(meta.keywords.split(',').map((s) => s.trim()).filter(Boolean));
  pdf.setModificationDate(new Date());
}

/** Produces the final PDF bytes: base file + form values + annotations + info (+ password). */
async function buildPdf(doc, { flatten = false, encrypt = true, pages = null } = {}) {
  const pdf = await loadLib(doc);
  const unicodeFields = applyFormValues(pdf, doc.formValues, await pdf.embedFont(StandardFonts.Helvetica));
  const dc = new DrawContext(pdf);
  const libPages = pdf.getPages();
  for (let i = 0; i < libPages.length; i++) {
    const list = doc.annots.get(doc.pageUids[i]);
    if (list && list.length) await drawPageAnnots(dc, libPages[i], list);
  }
  applyMeta(pdf, doc.meta);
  pdf.setProducer('Sahifa PDF by MV Digital Tools');
  if (unicodeFields.length && !flatten) await finishUnicodeFields(pdf, unicodeFields);
  if (flatten) {
    try { pdf.getForm().flatten(); } catch (e) { console.warn('flatten failed', e); }
  }
  if (pages) setPageOrder(pdf, pages.map((i) => libPages[i].ref));
  if (encrypt && hasProtection(doc)) applyProtection(pdf, doc.protect);
  return savePdf(pdf, { gc: true, keepAppearances: unicodeFields.length > 0 && !flatten });
}

const hasProtection = (doc) => !!(doc.protect && (doc.protect.userPassword || doc.protect.ownerPassword));
function applyProtection(pdf, protect) {
  pdf.encrypt({
    userPassword: protect.userPassword || '',
    ownerPassword: protect.ownerPassword || protect.userPassword,
    permissions: protect.permissions || {},
  });
}

// ---------- byte-level operations (all undoable) ----------
/** Runs `mutate(pdf, pages)` and stores the result. mutate returns the new pageUids. */
async function mutatePdf(doc, mutate, { undoable = true } = {}) {
  const pdf = await loadLib(doc);
  if (undoable) pushUndo(doc);
  const pages = pdf.getPages();
  const newUids = await mutate(pdf, pages);
  doc.bytes = await savePdf(pdf);
  if (newUids) doc.pageUids = newUids;
  await reloadPdfjs(doc);
  markDirty(doc);
}

/** Draws a page's annotations into the page content and removes them from the overlay. */
async function bakeInto(doc, pdf, pages, indices) {
  const dc = new DrawContext(pdf);
  for (const i of indices) {
    const list = doc.annots.get(doc.pageUids[i]);
    if (list && list.length) {
      await drawPageAnnots(dc, pages[i], list);
      doc.annots.set(doc.pageUids[i], []);
    }
  }
}

const PageOps = {
  async rotate(doc, indices, delta) {
    await mutatePdf(doc, async (pdf, pages) => {
      await bakeInto(doc, pdf, pages, indices);
      for (const i of indices) {
        const cur = pages[i].getRotation().angle;
        pages[i].setRotation(degrees((((cur + delta) % 360) + 360) % 360));
      }
    });
  },
  async remove(doc, indices) {
    if (indices.length >= doc.pageCount) throw new Error('A PDF needs at least one page.');
    const drop = new Set(indices);
    await mutatePdf(doc, async (pdf, pages) => {
      const keep = pages.filter((_, i) => !drop.has(i));
      setPageOrder(pdf, keep.map((p) => p.ref));
      for (const i of drop) doc.annots.delete(doc.pageUids[i]);
      return doc.pageUids.filter((_, i) => !drop.has(i));
    });
  },
  /** `order` lists old page indices in their new order. */
  async reorder(doc, order) {
    await mutatePdf(doc, async (pdf, pages) => {
      setPageOrder(pdf, order.map((i) => pages[i].ref));
      return order.map((i) => doc.pageUids[i]);
    });
  },
  async duplicate(doc, indices) {
    await mutatePdf(doc, async (pdf, pages) => {
      const copies = await pdf.copyPages(pdf, indices);
      const refs = [];
      const uids = [];
      const dupAt = new Map(indices.map((i, k) => [i, copies[k]]));
      pages.forEach((p, i) => {
        refs.push(p.ref); uids.push(doc.pageUids[i]);
        if (dupAt.has(i)) {
          const nu = newPageUid();
          refs.push(dupAt.get(i).ref); uids.push(nu);
          doc.annots.set(nu, structuredClone(doc.annots.get(doc.pageUids[i]) || []).map((a) => ({ ...a, id: uid() })));
        }
      });
      setPageOrder(pdf, refs);
      return uids;
    });
  },
  async insertBlank(doc, at, size) {
    await mutatePdf(doc, async (pdf, pages) => {
      const blank = PDFPage.create(pdf);
      blank.setSize(size.w, size.h);
      const refs = pages.map((p) => p.ref);
      refs.splice(at, 0, blank.ref);
      setPageOrder(pdf, refs);
      const uids = doc.pageUids.slice();
      uids.splice(at, 0, newPageUid());
      return uids;
    });
  },
  async insertPdf(doc, at, srcBytes, password) {
    const src = await PDFDocument.load(srcBytes, { password: password ?? '', updateMetadata: false, ignoreEncryption: false });
    await mutatePdf(doc, async (pdf, pages) => {
      const copies = await pdf.copyPages(src, src.getPageIndices());
      const refs = pages.map((p) => p.ref);
      refs.splice(at, 0, ...copies.map((c) => c.ref));
      setPageOrder(pdf, refs);
      const uids = doc.pageUids.slice();
      uids.splice(at, 0, ...copies.map(() => newPageUid()));
      return uids;
    });
  },
  async insertImages(doc, at, images) {
    await mutatePdf(doc, async (pdf, pages) => {
      const added = await addImagePages(pdf, images);
      const refs = pages.map((p) => p.ref);
      refs.splice(at, 0, ...added.map((p) => p.ref));
      setPageOrder(pdf, refs);
      const uids = doc.pageUids.slice();
      uids.splice(at, 0, ...added.map(() => newPageUid()));
      return uids;
    });
  },
  /** Crops pages to a display-space rectangle. */
  async crop(doc, indices, rect) {
    await mutatePdf(doc, async (pdf, pages) => {
      await bakeInto(doc, pdf, pages, indices);
      for (const i of indices) {
        const g = pageGeom(pages[i]);
        const s = doc.sizes[i];
        const r = { x: clamp(rect.x, 0, s.w), y: clamp(rect.y, 0, s.h) };
        r.w = clamp(rect.w, 1, s.w - r.x);
        r.h = clamp(rect.h, 1, s.h - r.y);
        const pr = d2pRect(g, r.x, r.y, r.w, r.h);
        pages[i].setCropBox(pr.x, pr.y, pr.width, pr.height);
      }
    });
  },
  async watermark(doc, indices, o) {
    await mutatePdf(doc, async (pdf, pages) => {
      const font = await pdf.embedFont(StandardFonts[o.bold ? 'HelveticaBold' : 'Helvetica']);
      if (!fontCanEncode(font, o.text)) throw new Error('Watermark text must use Latin characters. For other scripts, add it as a text box instead.');
      for (const i of indices) {
        const g = pageGeom(pages[i]);
        const s = doc.sizes[i];
        const size = o.size;
        const tw = font.widthOfTextAtSize(o.text, size);
        const phi = ((g.rot + o.angle) * Math.PI) / 180;
        const c = d2p(g, s.w / 2, s.h / 2);
        const ux = [Math.cos(phi), Math.sin(phi)];
        const uy = [-Math.sin(phi), Math.cos(phi)];
        const capH = size * 0.36;
        pages[i].drawText(o.text, {
          x: c.x - ux[0] * tw / 2 - uy[0] * capH,
          y: c.y - ux[1] * tw / 2 - uy[1] * capH,
          size, font, color: rgbOf(o.color), opacity: o.opacity, rotate: degrees(g.rot + o.angle),
        });
      }
    });
  },
  async headerFooter(doc, indices, o) {
    await mutatePdf(doc, async (pdf, pages) => {
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const total = doc.pageCount;
      indices.forEach((i, k) => {
        const g = pageGeom(pages[i]);
        const s = doc.sizes[i];
        const n = o.start + (o.countAll ? i : k);
        const text = o.format
          .replaceAll('{n}', String(n))
          .replaceAll('{total}', String(o.countAll ? total + o.start - 1 : indices.length + o.start - 1))
          .replaceAll('{date}', todayString())
          .replaceAll('{file}', baseName(doc.name));
        if (!fontCanEncode(font, text)) throw new Error('Header and footer text must use Latin characters.');
        const tw = font.widthOfTextAtSize(text, o.size);
        const [v, h] = o.position.split('-');
        const x = h === 'left' ? o.margin : h === 'right' ? s.w - o.margin - tw : (s.w - tw) / 2;
        const y = v === 'top' ? o.margin + o.size * 0.8 : s.h - o.margin;
        pages[i].drawText(text, { ...d2p(g, x, y), size: o.size, font, color: rgbOf(o.color), rotate: degrees(g.rot) });
      });
    });
  },
  async addField(doc, i, kind, rect) {
    await mutatePdf(doc, async (pdf, pages) => {
      const form = pdf.getForm();
      const g = pageGeom(pages[i]);
      const r = d2pRect(g, rect.x, rect.y, rect.w, rect.h);
      const existing = new Set(form.getFields().map((f) => f.getName()));
      const base = kind === 'check' ? 'Check' : kind === 'dropdown' ? 'Choice' : 'Text';
      let n = 1;
      while (existing.has(base + n)) n++;
      const name = base + n;
      const opts = { x: r.x, y: r.y, width: r.width, height: r.height, borderColor: rgb(0.45, 0.5, 0.55), borderWidth: 1, backgroundColor: rgb(1, 1, 1) };
      if (kind === 'check') form.createCheckBox(name).addToPage(pages[i], opts);
      else if (kind === 'multiline') { const f = form.createTextField(name); f.enableMultiline(); f.addToPage(pages[i], opts); }
      else form.createTextField(name).addToPage(pages[i], opts);
    });
  },
  async attach(doc, file) {
    await mutatePdf(doc, async (pdf) => {
      await pdf.attach(file.data, file.name, { creationDate: new Date(), modificationDate: new Date(), description: file.name });
    });
  },
};

async function addImagePages(pdf, images) {
  const A4 = [595.28, 841.89];
  const pages = [];
  for (const im of images) {
    const isPng = im.data[0] === 0x89 && im.data[1] === 0x50;
    const img = isPng ? await pdf.embedPng(im.data) : await pdf.embedJpg(im.data);
    const landscape = img.width > img.height;
    const [pw, ph] = landscape ? [A4[1], A4[0]] : A4;
    const m = 24;
    const s = Math.min((pw - 2 * m) / img.width, (ph - 2 * m) / img.height);
    const page = PDFPage.create(pdf);
    page.setSize(pw, ph);
    page.drawImage(img, { x: (pw - img.width * s) / 2, y: (ph - img.height * s) / 2, width: img.width * s, height: img.height * s });
    pages.push(page);
  }
  return pages;
}

async function createPdfFromImages(images) {
  const pdf = await PDFDocument.create();
  const pages = await addImagePages(pdf, images);
  pages.forEach((p) => pdf.addPage(p));
  return pdf.save();
}
async function createBlankPdf(size = { w: 595.28, h: 841.89 }) {
  const pdf = await PDFDocument.create();
  pdf.addPage([size.w, size.h]);
  return pdf.save();
}

/** Extracts the given pages (with all edits) into a new file. */
async function extractPages(doc, indices) {
  const full = await PDFDocument.load(await buildPdf(doc, { encrypt: false }));
  const out = await PDFDocument.create();
  const copies = await out.copyPages(full, indices);
  copies.forEach((p) => out.addPage(p));
  return out.save();
}

/** Real redaction: affected pages are re-rendered as images with the boxes burned in,
 *  so no text, vectors or images remain under a redaction. */
async function applyRedactions(doc, dpi = 200) {
  const targets = [];
  doc.pageUids.forEach((k, i) => { if ((doc.annots.get(k) || []).some((a) => a.type === 'redact')) targets.push(i); });
  if (!targets.length) return 0;
  const pdf = await loadLib(doc);
  pushUndo(doc);
  const pages = pdf.getPages();
  const refs = pages.map((p) => p.ref);
  const scale = dpi / 72;
  for (const i of targets) {
    const pjPage = await doc.pdf.getPage(i + 1);
    const vp = pjPage.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pjPage.render({ canvasContext: ctx, viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE }).promise;
    const list = doc.annots.get(doc.pageUids[i]);
    ctx.fillStyle = '#000';
    for (const a of list.filter((x) => x.type === 'redact')) ctx.fillRect(a.x * scale, a.y * scale, a.w * scale, a.h * scale);
    const jpg = await pdf.embedJpg(await canvasToBytes(canvas, 'image/jpeg', 0.92));
    const s = doc.sizes[i];
    const np = PDFPage.create(pdf);
    np.setSize(s.w, s.h);
    np.drawImage(jpg, { x: 0, y: 0, width: s.w, height: s.h });
    refs[i] = np.ref;
    doc.annots.set(doc.pageUids[i], list.filter((x) => x.type !== 'redact'));
    // Drop any form fields whose widgets lived on the old page.
    try {
      const form = pdf.getForm();
      for (const f of form.getFields()) {
        if (f.acroField.getWidgets().some((w) => w.P() === pages[i].ref)) form.removeField(f);
      }
    } catch { /* no form */ }
  }
  setPageOrder(pdf, refs);
  doc.bytes = await savePdf(pdf, { gc: true });
  await reloadPdfjs(doc);
  markDirty(doc);
  return targets.length;
}

/** Full text of a page as pdf.js sees it. */
async function pageTextContent(doc, i) {
  if (!doc.textCache.has(i)) {
    const p = await doc.pdf.getPage(i + 1);
    doc.textCache.set(i, await p.getTextContent());
  }
  return doc.textCache.get(i);
}
async function pagePlainText(doc, i) {
  const tc = await pageTextContent(doc, i);
  return tc.items.map((it) => it.str + (it.hasEOL ? '\n' : '')).join('');
}
async function pageAnnotationData(doc, i) {
  if (!doc.annotDataCache.has(i)) {
    const p = await doc.pdf.getPage(i + 1);
    doc.annotDataCache.set(i, await p.getAnnotations({ intent: 'display' }));
  }
  return doc.annotDataCache.get(i);
}
