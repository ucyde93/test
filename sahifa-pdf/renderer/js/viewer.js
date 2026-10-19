'use strict';
/* Continuous page viewer: canvas, text selection, links, form fields, search hits,
   and the overlay layer where Annotations draws. */

const Viewer = {
  doc: null,
  scale: 1,
  els: [],
  current: 0,
  visible: new Set(),
  io: null,
  pumping: false,
  night: false,
  vp1: new Map(), // page index -> scale-1 viewport (per doc version)
};

const viewerEl = () => $('#viewer');
const pagesEl = () => $('#pages');

function renderKey() {
  return `${Viewer.doc.version}|${Viewer.scale.toFixed(4)}`;
}

function mountDoc(doc) {
  Viewer.doc = doc;
  Viewer.vp1.clear();
  const root = pagesEl();
  root.innerHTML = '';
  Viewer.els = [];
  Viewer.visible.clear();
  if (Viewer.io) Viewer.io.disconnect();
  Viewer.io = new IntersectionObserver(onIntersect, { root: viewerEl(), rootMargin: '900px 0px' });
  doc.pageUids.forEach((_, i) => {
    const pe = el('div', { class: 'page', dataset: { index: i } },
      el('canvas', { class: 'page-canvas' }),
      el('div', { class: 'textLayer' }),
      el('div', { class: 'searchLayer' }),
      el('div', { class: 'linkLayer' }),
      el('div', { class: 'formLayer' }),
      el('div', { class: 'annotLayer' }));
    pe._key = null;
    root.append(pe);
    Viewer.els.push(pe);
    Viewer.io.observe(pe);
  });
  applyScale(computeScale(doc.zoom.mode, doc.zoom.scale), false);
  viewerEl().scrollTop = doc.scrollTop || 0;
  updateCurrentPage();
}

/** Remount after page structure or bytes changed, keeping the reading position. */
function refreshViewer() {
  const doc = Viewer.doc;
  if (!doc) return;
  const pos = viewerEl().scrollTop;
  doc.scrollTop = pos;
  mountDoc(doc);
  viewerEl().scrollTop = pos;
  updateCurrentPage();
  document.dispatchEvent(new CustomEvent('doc-structure', { detail: doc }));
}

function onIntersect(entries) {
  for (const e of entries) {
    const i = +e.target.dataset.index;
    if (e.isIntersecting) Viewer.visible.add(i);
    else Viewer.visible.delete(i);
  }
  pump();
}

async function pump() {
  if (Viewer.pumping) return;
  Viewer.pumping = true;
  try {
    for (;;) {
      const doc = Viewer.doc;
      if (!doc) break;
      const key = renderKey();
      const todo = [...Viewer.visible].filter((i) => Viewer.els[i] && Viewer.els[i]._key !== key)
        .sort((a, b) => Math.abs(a - Viewer.current) - Math.abs(b - Viewer.current));
      if (!todo.length) break;
      await renderPage(todo[0], key).catch((e) => console.warn('render failed', e));
    }
  } finally {
    Viewer.pumping = false;
  }
}

async function scale1Viewport(i) {
  const doc = Viewer.doc;
  const k = `${doc.version}:${i}`;
  if (!Viewer.vp1.has(k)) {
    const p = await doc.pdf.getPage(i + 1);
    Viewer.vp1.set(k, p.getViewport({ scale: 1 }));
  }
  return Viewer.vp1.get(k);
}

async function renderPage(i, key) {
  const doc = Viewer.doc;
  const pe = Viewer.els[i];
  pe._key = key;
  const page = await doc.pdf.getPage(i + 1);
  if (doc !== Viewer.doc || pe._key !== key) return;
  const vp = page.getViewport({ scale: Viewer.scale });
  const dpr = window.devicePixelRatio || 1;
  let out = dpr;
  const maxPixels = 16e6;
  if (vp.width * vp.height * out * out > maxPixels) out = Math.sqrt(maxPixels / (vp.width * vp.height));
  const canvas = el('canvas', { class: 'page-canvas' });
  canvas.width = Math.floor(vp.width * out);
  canvas.height = Math.floor(vp.height * out);
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvasContext: ctx,
    viewport: vp,
    transform: out !== 1 ? [out, 0, 0, out, 0, 0] : null,
    annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS,
  }).promise;
  if (doc !== Viewer.doc || pe._key !== key) return;
  pe.querySelector('.page-canvas').replaceWith(canvas);
  pe._canvasScale = Viewer.scale * out;
  await renderTextLayer(pe, doc, i, vp);
  await renderLinksAndForms(pe, doc, i, vp);
  renderSearchHits(i);
  if (typeof Annotations !== 'undefined') Annotations.onPageRendered(i);
}

async function renderTextLayer(pe, doc, i, vp) {
  const tl = pe.querySelector('.textLayer');
  tl.innerHTML = '';
  const tc = await pageTextContent(doc, i);
  if (doc !== Viewer.doc) return;
  try {
    const task = pdfjsLib.renderTextLayer({ textContentSource: tc, container: tl, viewport: vp, textDivs: [] });
    await task.promise;
  } catch (e) { console.warn('text layer', e); }
  tl.append(el('div', { class: 'endOfContent' }));
}

function rectToBox(vp, rect) {
  const [x1, y1, x2, y2] = pdfjsLib.Util.normalizeRect(vp.convertToViewportRectangle(rect));
  return { left: x1, top: y1, width: x2 - x1, height: y2 - y1 };
}
const boxStyle = (b) => ({ left: b.left + 'px', top: b.top + 'px', width: b.width + 'px', height: b.height + 'px' });

async function renderLinksAndForms(pe, doc, i, vp) {
  const links = pe.querySelector('.linkLayer');
  const forms = pe.querySelector('.formLayer');
  links.innerHTML = '';
  forms.innerHTML = '';
  let data = [];
  try { data = await pageAnnotationData(doc, i); } catch { return; }
  for (const a of data) {
    const box = rectToBox(vp, a.rect);
    if (a.subtype === 'Link') {
      const link = el('a', { class: 'pdf-link', style: boxStyle(box), href: a.url || '#', title: a.url || 'Go to destination' });
      link.addEventListener('click', (e) => {
        e.preventDefault();
        if (a.url) Host.openExternal(a.url);
        else if (a.dest) goToDest(a.dest);
      });
      links.append(link);
    } else if (a.subtype === 'Text' || (a.subtype === 'FreeText' && !a.hasAppearance)) {
      const text = a.contentsObj?.str || '';
      const author = a.titleObj?.str || '';
      const pin = el('button', { class: 'pdf-comment', style: { left: box.left + 'px', top: box.top + 'px' }, title: (author ? author + ': ' : '') + text }, icon('note', 14));
      pin.addEventListener('click', () => showPdfComment(pin, author, text));
      links.append(pin);
    } else if (a.subtype === 'Widget') {
      const input = buildFormInput(doc, a, box, i);
      if (input) forms.append(input);
    }
  }
}

function showPdfComment(anchor, author, text) {
  $$('.pdf-comment-pop').forEach((p) => p.remove());
  const pop = el('div', { class: 'pdf-comment-pop' },
    el('div', { class: 'pop-head' }, author || 'Comment', el('button', { class: 'icon-btn', onclick: () => pop.remove(), 'aria-label': 'Close' }, icon('close', 14))),
    el('div', { class: 'pop-body' }, text || '(empty)'));
  pop.style.left = anchor.offsetLeft + 24 + 'px';
  pop.style.top = anchor.offsetTop + 'px';
  anchor.parentElement.append(pop);
}

function fieldValue(doc, a) {
  return Object.prototype.hasOwnProperty.call(doc.formValues, a.fieldName) ? doc.formValues[a.fieldName] : a.fieldValue;
}

function setFieldValue(doc, name, value, source) {
  if (!doc._formEditing) { pushUndo(doc); doc._formEditing = true; }
  doc.formValues[name] = value;
  markDirty(doc);
  // Keep other widgets of the same field in sync.
  $$('.formLayer [data-field]').forEach((n) => {
    if (n === source || n.dataset.field !== name) return;
    if (n.type === 'checkbox') n.checked = value && value !== 'Off' && (!n.dataset.export || n.dataset.export === value);
    else if (n.type === 'radio') n.checked = n.value === value;
    else if (n.tagName !== 'BUTTON') n.value = value ?? '';
  });
}

function buildFormInput(doc, a, box, pageIndex) {
  const name = a.fieldName;
  if (!name || a.hidden) return null;
  const s = Viewer.scale;
  const style = boxStyle(box);
  const fs = a.defaultAppearanceData?.fontSize;
  style.fontSize = (fs ? fs * s : Math.min(box.height * 0.62, 11 * s)) + 'px';
  const val = fieldValue(doc, a);
  let node = null;
  const endEdit = () => { doc._formEditing = false; };

  if (a.fieldType === 'Tx') {
    node = a.multiLine ? el('textarea', { class: 'field field-text' }) : el('input', { class: 'field field-text', type: a.password ? 'password' : 'text' });
    node.value = val ?? '';
    if (a.maxLen) node.maxLength = a.maxLen;
    if (a.textAlignment === 1) style.textAlign = 'center';
    if (a.textAlignment === 2) style.textAlign = 'right';
    if (a.comb && a.maxLen) style.letterSpacing = (box.width / a.maxLen - (fs || 10) * s * 0.6) + 'px';
    node.addEventListener('input', () => setFieldValue(doc, name, node.value, node));
    node.addEventListener('blur', endEdit);
  } else if (a.fieldType === 'Btn' && a.checkBox) {
    node = el('input', { class: 'field field-check', type: 'checkbox' });
    node.dataset.export = a.exportValue || 'Yes';
    node.checked = !!val && val !== 'Off' && (typeof val !== 'string' || val === node.dataset.export || !a.exportValue);
    node.addEventListener('change', () => { setFieldValue(doc, name, node.checked ? node.dataset.export : 'Off', node); endEdit(); });
  } else if (a.fieldType === 'Btn' && a.radioButton) {
    node = el('input', { class: 'field field-radio', type: 'radio', name: doc.id + ':' + name, value: a.buttonValue });
    node.checked = val === a.buttonValue;
    node.addEventListener('change', () => { if (node.checked) setFieldValue(doc, name, a.buttonValue, node); endEdit(); });
  } else if (a.fieldType === 'Ch') {
    node = el('select', { class: 'field field-choice', multiple: !a.combo && a.multiSelect });
    if (a.combo) node.append(el('option', { value: '' }, ''));
    for (const o of a.options || []) node.append(el('option', { value: o.exportValue }, o.displayValue ?? o.exportValue));
    const cur = Array.isArray(val) ? val : [val];
    [...node.options].forEach((o) => { o.selected = cur.includes(o.value); });
    node.addEventListener('change', () => {
      const v = node.multiple ? [...node.selectedOptions].map((o) => o.value) : node.value;
      setFieldValue(doc, name, v, node);
      endEdit();
    });
  } else if (a.fieldType === 'Sig') {
    if (a.fieldValue) return null; // already signed: the canvas shows its appearance
    node = el('button', { class: 'field field-sig', title: 'Click to sign here' }, icon('sign', 16), ' Sign here');
    node.addEventListener('click', () => App.signIntoBox(pageIndex, {
      x: box.left / s, y: box.top / s, w: box.width / s, h: box.height / s,
    }));
    Object.assign(node.style, style);
    return node;
  } else {
    return null;
  }
  node.dataset.field = name;
  if (a.readOnly) node.disabled = true;
  if (a.required) node.classList.add('required');
  node.title = a.alternativeText || name;
  Object.assign(node.style, style);
  return node;
}

// ---------- zoom ----------
function computeScale(mode, scale) {
  const doc = Viewer.doc;
  if (!doc || !doc.sizes.length) return 1;
  const v = viewerEl();
  if (!v.clientWidth) return Viewer.scale || 1; // hidden (organizer open): keep the current zoom
  const cw = Math.max(200, v.clientWidth - 48);
  const ch = Math.max(200, v.clientHeight - 32);
  const s = doc.sizes[clamp(Viewer.current, 0, doc.sizes.length - 1)];
  if (mode === 'width') return clamp(cw / Math.max(...doc.sizes.slice(0, 50).map((x) => x.w)), 0.1, 8);
  if (mode === 'page') return clamp(Math.min(cw / s.w, ch / s.h), 0.1, 8);
  return clamp(scale || 1, 0.1, 8);
}

function applyScale(scale, keepPosition = true) {
  const doc = Viewer.doc;
  const v = viewerEl();
  let anchor = null;
  if (keepPosition && Viewer.els[Viewer.current]) {
    const pe = Viewer.els[Viewer.current];
    anchor = { i: Viewer.current, f: (v.scrollTop - pe.offsetTop) / Math.max(1, pe.offsetHeight) };
  }
  Viewer.scale = scale;
  pagesEl().style.setProperty('--scale-factor', scale);
  Viewer.els.forEach((pe, i) => {
    const s = doc.sizes[i];
    pe.style.width = Math.floor(s.w * scale) + 'px';
    pe.style.height = Math.floor(s.h * scale) + 'px';
    pe.style.setProperty('--scale-factor', scale);
  });
  if (anchor) {
    const pe = Viewer.els[anchor.i];
    v.scrollTop = pe.offsetTop + anchor.f * pe.offsetHeight;
  }
  // The overlay is cheap to rebuild immediately; canvases follow via pump().
  Viewer.els.forEach((pe, i) => {
    pe.querySelector('.linkLayer').innerHTML = '';
    pe.querySelector('.formLayer').innerHTML = '';
    pe.querySelector('.textLayer').innerHTML = '';
    if (typeof Annotations !== 'undefined') Annotations.renderPage(i);
    renderSearchHits(i);
  });
  document.dispatchEvent(new CustomEvent('zoom-changed'));
  pump();
}

function setZoom(mode, scale) {
  const doc = Viewer.doc;
  if (!doc) return;
  doc.zoom = { mode, scale };
  applyScale(computeScale(mode, scale));
}
function zoomBy(factor) {
  const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8];
  const cur = Viewer.scale;
  let next;
  if (factor > 1) next = steps.find((s) => s > cur + 0.001) || 8;
  else next = [...steps].reverse().find((s) => s < cur - 0.001) || 0.25;
  setZoom('custom', next);
}

// ---------- navigation ----------
function updateCurrentPage() {
  const v = viewerEl();
  const line = v.scrollTop + v.clientHeight * 0.35;
  let lo = 0, hi = Viewer.els.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (Viewer.els[mid].offsetTop <= line) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (ans !== Viewer.current) {
    Viewer.current = ans;
    document.dispatchEvent(new CustomEvent('page-changed', { detail: ans }));
  }
}

function goToPage(i, topDisplay = null, smooth = false) {
  const pe = Viewer.els[clamp(i, 0, Viewer.els.length - 1)];
  if (!pe) return;
  const top = pe.offsetTop - 10 + (topDisplay != null ? topDisplay * Viewer.scale : 0);
  viewerEl().scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
  Viewer.current = +pe.dataset.index;
  document.dispatchEvent(new CustomEvent('page-changed', { detail: Viewer.current }));
}

async function goToDest(dest) {
  const doc = Viewer.doc;
  try {
    const explicit = typeof dest === 'string' ? await doc.pdf.getDestination(dest) : dest;
    if (!explicit) return;
    const ref = explicit[0];
    const idx = typeof ref === 'object' && ref !== null ? await doc.pdf.getPageIndex(ref) : ref;
    let top = null;
    if (explicit[1] && explicit[1].name === 'XYZ' && explicit[3] != null) {
      const vp = await scale1Viewport(idx);
      top = Math.max(0, vp.convertToViewportPoint(explicit[2] || 0, explicit[3])[1] - 12);
    }
    goToPage(idx, top);
  } catch (e) {
    console.warn('bad destination', e);
  }
}

// ---------- search ----------
const Search = { query: '', hits: [], index: -1, running: 0, opts: { matchCase: false, wholeWord: false } };

function itemBox(vp, item) {
  const tx = pdfjsLib.Util.transform(vp.transform, item.transform);
  const fontH = Math.hypot(tx[2], tx[3]) || Math.abs(item.height) || 10;
  const w = item.width * vp.scale;
  return { x: tx[4], y: tx[5] - fontH * 0.88, w: Math.max(1, w), h: fontH * 1.12, baseline: tx[5], fontH };
}

async function runSearch(query) {
  const doc = Viewer.doc;
  const run = ++Search.running;
  Search.query = query;
  Search.hits = [];
  Search.index = -1;
  Viewer.els.forEach((_, i) => renderSearchHits(i));
  document.dispatchEvent(new CustomEvent('search-updated', { detail: { done: false } }));
  if (!doc || !query.trim()) { document.dispatchEvent(new CustomEvent('search-updated', { detail: { done: true } })); return; }
  const norm = (s) => (Search.opts.matchCase ? s : s.toLocaleLowerCase());
  const q = norm(query);
  const isWordChar = (c) => /[\p{L}\p{N}_]/u.test(c || '');
  for (let i = 0; i < doc.pageCount; i++) {
    if (run !== Search.running || doc !== Viewer.doc) return;
    const tc = await pageTextContent(doc, i);
    const vp = await scale1Viewport(i);
    let text = '';
    const map = [];
    tc.items.forEach((it, idx) => {
      if (!('str' in it)) return;
      for (let k = 0; k < it.str.length; k++) { text += it.str[k]; map.push([idx, k]); }
      if (it.hasEOL) { text += ' '; map.push(null); }
    });
    const hay = norm(text);
    let from = 0;
    for (;;) {
      const at = hay.indexOf(q, from);
      if (at < 0) break;
      from = at + Math.max(1, q.length);
      if (Search.opts.wholeWord && (isWordChar(hay[at - 1]) || isWordChar(hay[at + q.length]))) continue;
      const rects = [];
      let k = at;
      while (k < at + q.length) {
        const m = map[k];
        if (!m) { k++; continue; }
        const [idx, start] = m;
        let end = start;
        while (k + 1 < at + q.length && map[k + 1] && map[k + 1][0] === idx) { k++; end = map[k][1]; }
        const it = tc.items[idx];
        const b = itemBox(vp, it);
        const len = Math.max(1, it.str.length);
        rects.push({ x: b.x + (b.w * start) / len, y: b.y, w: (b.w * (end - start + 1)) / len, h: b.h });
        k++;
      }
      const snippet = text.slice(Math.max(0, at - 30), at + q.length + 40);
      Search.hits.push({ page: i, rects, snippet, at: at - Math.max(0, at - 30), len: q.length });
    }
    renderSearchHits(i);
    if (i % 8 === 7) document.dispatchEvent(new CustomEvent('search-updated', { detail: { done: false } }));
  }
  if (Search.hits.length) {
    const next = Search.hits.findIndex((h) => h.page >= Viewer.current);
    focusHit(next < 0 ? 0 : next);
  }
  document.dispatchEvent(new CustomEvent('search-updated', { detail: { done: true } }));
}

function renderSearchHits(i) {
  const pe = Viewer.els[i];
  if (!pe) return;
  const layer = pe.querySelector('.searchLayer');
  layer.innerHTML = '';
  const s = Viewer.scale;
  Search.hits.forEach((h, n) => {
    if (h.page !== i) return;
    for (const r of h.rects) {
      layer.append(el('div', {
        class: 'search-hit' + (n === Search.index ? ' current' : ''),
        style: { left: r.x * s + 'px', top: r.y * s + 'px', width: r.w * s + 'px', height: r.h * s + 'px' },
      }));
    }
  });
}

function focusHit(n) {
  if (!Search.hits.length) return;
  const prev = Search.hits[Search.index];
  Search.index = ((n % Search.hits.length) + Search.hits.length) % Search.hits.length;
  const h = Search.hits[Search.index];
  if (prev) renderSearchHits(prev.page);
  renderSearchHits(h.page);
  const r = h.rects[0];
  const v = viewerEl();
  const pe = Viewer.els[h.page];
  const y = pe.offsetTop + (r ? r.y * Viewer.scale : 0);
  if (y < v.scrollTop + 40 || y > v.scrollTop + v.clientHeight - 80) v.scrollTop = y - v.clientHeight / 3;
  const x = pe.offsetLeft + (r ? r.x * Viewer.scale : 0);
  if (x < v.scrollLeft || x > v.scrollLeft + v.clientWidth - 60) v.scrollLeft = x - v.clientWidth / 3;
  document.dispatchEvent(new CustomEvent('search-updated', { detail: { done: true } }));
}

// ---------- thumbnails ----------
async function renderThumb(doc, i, canvas, width) {
  const page = await doc.pdf.getPage(i + 1);
  const vp1 = page.getViewport({ scale: 1 });
  const dpr = window.devicePixelRatio || 1;
  const scale = (width / vp1.width) * dpr;
  const vp = page.getViewport({ scale });
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  canvas.style.width = width + 'px';
  canvas.style.height = Math.floor(vp.height / dpr) + 'px';
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE }).promise;
  // Draw a rough preview of overlay annotations so edits show in thumbnails too.
  const list = doc.annots.get(doc.pageUids[i]) || [];
  const s = vp.width / vp1.width;
  for (const a of list) {
    const b = annotBBox(a);
    ctx.globalAlpha = a.type === 'highlight' ? 0.4 : 1;
    ctx.fillStyle = a.type === 'whiteout' ? (a.fill || '#fff') : a.type === 'redact' ? '#000' : (a.color || a.stroke || '#1f4fd1');
    if (['whiteout', 'redact', 'highlight'].includes(a.type)) ctx.fillRect(b.x * s, b.y * s, b.w * s, b.h * s);
    else { ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = Math.max(1, s); ctx.strokeRect(b.x * s, b.y * s, b.w * s, b.h * s); }
  }
  ctx.globalAlpha = 1;
}
