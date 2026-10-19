'use strict';
/* Annotation tools: creating, selecting, moving, resizing and editing the
   overlay items drawn on top of PDF pages. */

const SWATCHES = ['#111111', '#d92d20', '#e8730c', '#f5c400', '#1f7a4d', '#0b6e5c', '#1f4fd1', '#7a3fd1', '#ffffff'];
const DEFAULT_PROPS = {
  text: { font: 'Helvetica', size: 14, color: '#111111', bold: false, italic: false, underline: false, align: 'left', bg: null },
  shape: { stroke: '#d92d20', fill: null, width: 2, opacity: 1 },
  pen: { stroke: '#1f4fd1', width: 2.5, opacity: 1 },
  highlight: { color: '#ffe14d', opacity: 0.4 },
  underline: { color: '#1f7a4d', opacity: 1 },
  strike: { color: '#d92d20', opacity: 1 },
  note: { color: '#f5c400' },
  symbol: { color: '#1f4fd1', size: 16 },
  stamp: { color: '#1f7a4d' },
  image: { opacity: 1 },
  whiteout: { fill: '#ffffff' },
};

function loadProps() {
  const saved = settingsGet('props', {});
  const out = structuredClone(DEFAULT_PROPS);
  for (const k of Object.keys(out)) Object.assign(out[k], saved[k] || {});
  return out;
}

const TOOL_GROUP = {
  text: 'text', date: 'text', rect: 'shape', ellipse: 'shape', line: 'shape', arrow: 'shape', pen: 'pen',
  highlight: 'highlight', underline: 'underline', strike: 'strike', note: 'note',
  check: 'symbol', cross: 'symbol', dot: 'symbol', whiteout: 'whiteout',
};
const TYPE_GROUP = {
  text: 'text', rect: 'shape', ellipse: 'shape', line: 'shape', ink: 'pen', highlight: 'highlight', underline: 'underline',
  strike: 'strike', note: 'note', symbol: 'symbol', stamp: 'stamp', image: 'image', whiteout: 'whiteout',
};
const DRAG_TOOLS = new Set(['rect', 'ellipse', 'line', 'arrow', 'pen', 'whiteout', 'redact', 'crop', 'field-text', 'field-multiline', 'field-check']);
const CLICK_TOOLS = new Set(['text', 'note', 'check', 'cross', 'dot', 'date']);
const MARKUP_TOOLS = new Set(['highlight', 'underline', 'strike']);
const STICKY_TOOLS = new Set(['pen', 'highlight', 'underline', 'strike', 'whiteout', 'redact', 'check', 'cross', 'dot']);

const TOOL_HINTS = {
  select: 'Click an item to select it, drag to move, use the corner handles to resize. Double-click text to edit.',
  hand: 'Drag to move around the page.',
  text: 'Click where you want to type.',
  edittext: 'Click any line of existing text to change it. The old text is covered and your new text is written in its place.',
  highlight: 'Select text to highlight it, or drag across any area.',
  underline: 'Select text to underline it.',
  strike: 'Select text to strike it through.',
  pen: 'Draw freely on the page.',
  rect: 'Drag to draw a rectangle.',
  ellipse: 'Drag to draw an ellipse.',
  line: 'Drag to draw a line. Hold Shift to snap to 45°.',
  arrow: 'Drag to draw an arrow. Hold Shift to snap to 45°.',
  note: 'Click to pin a sticky note comment.',
  whiteout: 'Drag over anything you want to hide. The box matches the page color.',
  redact: 'Drag over sensitive content to mark it. Apply Redactions permanently removes it.',
  check: 'Click to place a check mark.',
  cross: 'Click to place a cross.',
  dot: 'Click to place a dot.',
  date: 'Click to stamp today’s date.',
  crop: 'Drag the area of the page you want to keep.',
  'field-text': 'Drag to add a fillable text field.',
  'field-multiline': 'Drag to add a multi-line text field.',
  'field-check': 'Drag (or click) to add a checkbox field.',
};

const Annotations = {
  tool: 'select',
  pending: null,
  selected: null, // {page, id}
  editing: null,
  clipboard: null,
  props: loadProps(),
};

const ns = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}) {
  const n = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  return n;
}
const notify = () => document.dispatchEvent(new CustomEvent('annots-changed'));
function pushUndoSnap(doc, snap) {
  doc.undoStack.push(snap);
  if (doc.undoStack.length > 80) doc.undoStack.shift();
  doc.redoStack.length = 0;
  markDirty(doc);
}

// ---------- tool state ----------
function setTool(t) {
  if (Annotations.editing) finishTextEdit();
  Annotations.tool = t;
  Annotations.pending = null;
  hideGhost();
  const v = viewerEl();
  v.dataset.tool = t;
  v.dataset.mode = t === 'select' ? 'select' : t === 'hand' ? 'hand' : t === 'edittext' ? 'edittext'
    : MARKUP_TOOLS.has(t) ? 'markup' : 'draw';
  if (t !== 'select') select(null);
  Viewer.els.forEach((_, i) => renderEditCandidates(i));
  renderContextBar();
  document.dispatchEvent(new CustomEvent('tool-changed', { detail: t }));
}

function setPending(p) {
  setTool('select');
  Annotations.pending = p;
  viewerEl().dataset.mode = 'place';
  showGhost(p);
  renderContextBar();
}

// ---------- coordinates ----------
function pagePoint(pe, e, clampToPage = true) {
  const r = pe.getBoundingClientRect();
  const s = Viewer.scale;
  const sz = Viewer.doc.sizes[+pe.dataset.index];
  const x = (e.clientX - r.left) / s;
  const y = (e.clientY - r.top) / s;
  return clampToPage ? { x: clamp(x, 0, sz.w), y: clamp(y, 0, sz.h) } : { x, y };
}
function normRect(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}
function pageAtClientPoint(x, y) {
  for (const i of Viewer.visible) {
    const pe = Viewer.els[i];
    const r = pe.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return pe;
  }
  return null;
}

// ---------- rendering ----------
function annElement(i, id) {
  return Viewer.els[i]?.querySelector(`.ann[data-id="${id}"]`);
}

function strokePad(a) {
  if (a.type === 'line') return (a.width || 2) / 2 + (a.arrow ? Math.max(8, (a.width || 2) * 4) : 0) + 2;
  if (['rect', 'ellipse', 'ink'].includes(a.type)) return (a.width || 2) / 2 + 2;
  if (a.type === 'symbol') return 2;
  return 0;
}

function buildAnnEl(a, i) {
  const s = Viewer.scale;
  const b = annotBBox(a);
  const pad = strokePad(a);
  const wrap = el('div', { class: `ann ann-${a.type}`, dataset: { id: a.id } });
  Object.assign(wrap.style, {
    left: (b.x - pad) * s + 'px', top: (b.y - pad) * s + 'px',
    width: (b.w + 2 * pad) * s + 'px', height: (b.h + 2 * pad) * s + 'px',
  });
  const vb = `${b.x - pad} ${b.y - pad} ${b.w + 2 * pad} ${b.h + 2 * pad}`;
  const svg = () => { const n = svgEl('svg', { viewBox: vb, preserveAspectRatio: 'none', width: '100%', height: '100%' }); wrap.append(n); return n; };
  const op = a.opacity ?? 1;

  switch (a.type) {
    case 'text': {
      const body = el('div', { class: 'ann-text-body', dir: 'auto' });
      Object.assign(body.style, {
        font: cssFont(a, s), color: a.color, lineHeight: LINE_H, padding: TEXT_PAD * s + 'px',
        textAlign: a.align || (isRtl(a.text) ? 'right' : 'left'), background: a.bg || 'transparent',
        textDecoration: a.underline ? 'underline' : 'none', opacity: op,
      });
      body.textContent = measureLinesForScreen(a).join('\n');
      wrap.append(body);
      break;
    }
    case 'rect':
      svg().append(svgEl('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: a.fill || 'none', stroke: a.stroke || 'none', 'stroke-width': a.width, opacity: op }));
      break;
    case 'whiteout':
      svg().append(svgEl('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: a.fill || '#ffffff' }));
      break;
    case 'redact': {
      const n = svg();
      n.append(svgEl('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: '#000', 'fill-opacity': 0.45, stroke: '#d92d20', 'stroke-width': 1.2 / s * 1.5, 'stroke-dasharray': `${4 / s} ${3 / s}` }));
      break;
    }
    case 'ellipse':
      svg().append(svgEl('ellipse', { cx: a.x + a.w / 2, cy: a.y + a.h / 2, rx: a.w / 2, ry: a.h / 2, fill: a.fill || 'none', stroke: a.stroke || 'none', 'stroke-width': a.width, opacity: op }));
      break;
    case 'line': {
      const n = svg();
      const [[x1, y1], [x2, y2]] = a.pts;
      const attrs = { stroke: a.stroke, 'stroke-width': a.width, 'stroke-linecap': 'round', opacity: op };
      n.append(svgEl('line', { x1, y1, x2, y2, ...attrs }));
      if (a.arrow) {
        const th = Math.atan2(y2 - y1, x2 - x1);
        const L = Math.max(8, a.width * 4);
        for (const sg of [-1, 1]) n.append(svgEl('line', { x1: x2, y1: y2, x2: x2 - L * Math.cos(th + sg * 0.45), y2: y2 - L * Math.sin(th + sg * 0.45), ...attrs }));
      }
      break;
    }
    case 'ink': {
      const n = svg();
      for (const st of a.strokes) {
        if (st.length === 1) n.append(svgEl('circle', { cx: st[0][0], cy: st[0][1], r: a.width / 2, fill: a.stroke, opacity: op }));
        else n.append(svgEl('path', { d: st.map(([x, y], k) => `${k ? 'L' : 'M'}${x} ${y}`).join(' '), fill: 'none', stroke: a.stroke, 'stroke-width': a.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: op }));
      }
      break;
    }
    case 'symbol': {
      const n = svg();
      const t = Math.max(1.2, Math.min(a.w, a.h) * 0.13);
      const at = (fx, fy) => [a.x + fx * a.w, a.y + fy * a.h];
      const attrs = { stroke: a.color, 'stroke-width': t, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none', opacity: op };
      if (a.sym === 'check') n.append(svgEl('polyline', { points: [at(0.12, 0.55), at(0.4, 0.84), at(0.9, 0.16)].map((p) => p.join(',')).join(' '), ...attrs }));
      else if (a.sym === 'cross') {
        n.append(svgEl('line', { x1: at(0.15, 0.15)[0], y1: at(0.15, 0.15)[1], x2: at(0.85, 0.85)[0], y2: at(0.85, 0.85)[1], ...attrs }));
        n.append(svgEl('line', { x1: at(0.85, 0.15)[0], y1: at(0.85, 0.15)[1], x2: at(0.15, 0.85)[0], y2: at(0.15, 0.85)[1], ...attrs }));
      } else n.append(svgEl('ellipse', { cx: a.x + a.w / 2, cy: a.y + a.h / 2, rx: a.w * 0.32, ry: a.h * 0.32, fill: a.color, opacity: op }));
      break;
    }
    case 'highlight':
    case 'underline':
    case 'strike':
      for (const r of a.rects) {
        const d = el('div', { class: `mk mk-${a.type}` });
        Object.assign(d.style, { left: (r.x - b.x) * s + 'px', top: (r.y - b.y) * s + 'px', width: r.w * s + 'px', height: r.h * s + 'px', opacity: a.opacity ?? (a.type === 'highlight' ? 0.4 : 1) });
        d.style.setProperty('--mk', a.color);
        if (a.type !== 'highlight') d.style.setProperty('--mk-t', Math.max(0.8, r.h * 0.07) * s + 'px');
        wrap.append(d);
      }
      break;
    case 'image':
      wrap.append(el('img', { src: a.src, draggable: 'false', alt: '', style: { opacity: op } }));
      break;
    case 'stamp': {
      const bw = Math.max(1.5, Math.min(a.w, a.h) * 0.05) * s;
      const box = el('div', { class: 'stamp-box', style: { borderWidth: bw + 'px', color: a.color, borderColor: a.color, opacity: op } });
      _measureCanvas.font = `700 100px ${FONT_CSS.Helvetica}`;
      const fit = (str, maxH, maxW) => Math.max(4, Math.min(maxH, (maxW * 100) / Math.max(1, _measureCanvas.measureText(str).width)));
      const inner = a.w - (4 * bw) / s - 8;
      const main = el('div', { class: 'stamp-main' }, a.text);
      main.style.fontSize = fit(a.text, a.sub ? a.h * 0.42 : a.h * 0.55, inner) * s + 'px';
      box.append(main);
      if (a.sub) {
        _measureCanvas.font = `400 100px ${FONT_CSS.Helvetica}`;
        const sub = el('div', { class: 'stamp-sub' }, a.sub);
        sub.style.fontSize = Math.max(4, Math.min(a.h * 0.18, (inner * 100) / Math.max(1, _measureCanvas.measureText(a.sub).width))) * s + 'px';
        box.append(sub);
      }
      wrap.append(box);
      break;
    }
    case 'note': {
      wrap.style.setProperty('--note', a.color || '#f5c400');
      wrap.title = a.text || 'Empty note';
      wrap.append(icon('note', Math.max(12, NOTE_SIZE * s * 0.7)));
      break;
    }
  }

  const sel = Annotations.selected;
  if (sel && sel.id === a.id) {
    wrap.classList.add('selected');
    if (a.type === 'line') {
      const bb = annotBBox(a);
      a.pts.forEach(([x, y], k) => {
        wrap.append(el('div', { class: 'handle', dataset: { h: 'p' + k }, style: { left: (x - bb.x + pad) * s + 'px', top: (y - bb.y + pad) * s + 'px' } }));
      });
    } else if (a.type !== 'note') {
      for (const h of ['nw', 'ne', 'sw', 'se']) wrap.append(el('div', { class: `handle h-${h}`, dataset: { h } }));
    }
  }
  return wrap;
}

function renderAnnotPage(i) {
  const pe = Viewer.els[i];
  const doc = Viewer.doc;
  if (!pe || !doc) return;
  if (Annotations.editing && Annotations.editing.page === i) return;
  const layer = pe.querySelector('.annotLayer');
  layer.querySelectorAll('.ann').forEach((n) => n.remove());
  for (const a of doc.annotsAt(i)) layer.append(buildAnnEl(a, i));
}

function refreshAnnEl(i, a) {
  const old = annElement(i, a.id);
  const fresh = buildAnnEl(a, i);
  if (old) old.replaceWith(fresh);
  else Viewer.els[i]?.querySelector('.annotLayer').append(fresh);
}

// ---------- selection ----------
function select(sel) {
  const prev = Annotations.selected;
  Annotations.selected = sel;
  if (prev && Viewer.doc && Viewer.doc.findAnnot(prev.id)) renderAnnotPage(prev.page);
  if (sel) renderAnnotPage(sel.page);
  renderContextBar();
  document.dispatchEvent(new CustomEvent('selection-changed'));
}
function selectedAnnot() {
  const s = Annotations.selected;
  if (!s || !Viewer.doc) return null;
  const hit = Viewer.doc.findAnnot(s.id);
  return hit ? hit.annot : null;
}

function addAnnot(i, a, { selectIt = true } = {}) {
  const doc = Viewer.doc;
  a.id = a.id || uid();
  a.created = a.created || Date.now();
  pushUndo(doc);
  doc.annotsAt(i).push(a);
  renderAnnotPage(i);
  if (selectIt) select({ page: i, id: a.id });
  notify();
  return a;
}

function deleteSelected() {
  const s = Annotations.selected;
  const doc = Viewer.doc;
  if (!s || !doc) return;
  const hit = doc.findAnnot(s.id);
  if (!hit) return;
  pushUndo(doc);
  hit.list.splice(hit.list.indexOf(hit.annot), 1);
  Annotations.selected = null;
  renderAnnotPage(hit.page);
  renderContextBar();
  notify();
}

function duplicateSelected(toPage = null, offset = 12) {
  const doc = Viewer.doc;
  const src = Annotations.clipboard && toPage != null ? Annotations.clipboard : selectedAnnot();
  if (!src) return;
  const page = toPage ?? Annotations.selected.page;
  const copy = structuredClone(src);
  copy.id = uid();
  moveAnnot(copy, offset, offset);
  const b = annotBBox(copy);
  const sz = doc.sizes[page];
  if (b.x + b.w > sz.w || b.y + b.h > sz.h) moveAnnot(copy, Math.min(0, sz.w - b.x - b.w), Math.min(0, sz.h - b.y - b.h));
  addAnnot(page, copy);
}

// ---------- pointer handling ----------
function onPointerDown(e) {
  if (e.button !== 0 || !Viewer.doc) return;
  const t = Annotations.tool;
  if (Annotations.pending) {
    const pe = e.target.closest('.page');
    if (!pe) return;
    e.preventDefault();
    placePending(+pe.dataset.index, pagePoint(pe, e));
    return;
  }
  if (t === 'hand') return startPan(e);
  const pe = e.target.closest('.page');
  if (!pe) { if (t === 'select' && !e.target.closest('.note-pop')) select(null); return; }
  if (e.target.closest('.note-pop')) return;
  const i = +pe.dataset.index;
  const pt = pagePoint(pe, e);
  const handle = e.target.closest('.handle');
  const annEl = e.target.closest('.ann');
  if (t === 'select') {
    if (handle) { e.preventDefault(); startResize(e, pe, i, annEl.dataset.id, handle.dataset.h); return; }
    if (annEl && !annEl.classList.contains('editing')) { e.preventDefault(); startMove(e, pe, i, annEl.dataset.id); return; }
    if (!annEl && Annotations.selected) select(null);
    return;
  }
  if (t === 'edittext') {
    const c = e.target.closest('.edit-cand');
    if (c) { e.preventDefault(); editExistingText(i, c); }
    return;
  }
  if (CLICK_TOOLS.has(t)) { e.preventDefault(); clickCreate(i, pt); return; }
  if (DRAG_TOOLS.has(t)) { e.preventDefault(); startDraw(e, pe, i, pt); return; }
  if (MARKUP_TOOLS.has(t) && !e.target.closest('.textLayer span')) { e.preventDefault(); startDraw(e, pe, i, pt); }
}

function track(onMove, onUp) {
  const move = (ev) => onMove(ev);
  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    onUp(ev);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function startPan(e) {
  const v = viewerEl();
  const sx = e.clientX, sy = e.clientY, st = v.scrollTop, sl = v.scrollLeft;
  v.classList.add('panning');
  e.preventDefault();
  track((ev) => { v.scrollTop = st - (ev.clientY - sy); v.scrollLeft = sl - (ev.clientX - sx); }, () => v.classList.remove('panning'));
}

function startDraw(e, pe, i, p0) {
  const t = Annotations.tool;
  const layer = pe.querySelector('.annotLayer');
  const s = Viewer.scale;
  const sz = Viewer.doc.sizes[i];
  const pts = [[p0.x, p0.y]];
  let draft;
  let path;
  let line;
  if (t === 'pen' || t === 'line' || t === 'arrow') {
    draft = svgEl('svg', { class: 'draft-svg', viewBox: `0 0 ${sz.w} ${sz.h}`, preserveAspectRatio: 'none' });
    const P = Annotations.props;
    if (t === 'pen') {
      path = svgEl('path', { fill: 'none', stroke: P.pen.stroke, 'stroke-width': P.pen.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: P.pen.opacity });
      draft.append(path);
    } else {
      line = svgEl('line', { x1: p0.x, y1: p0.y, x2: p0.x, y2: p0.y, stroke: P.shape.stroke, 'stroke-width': P.shape.width, 'stroke-linecap': 'round' });
      draft.append(line);
    }
  } else {
    draft = el('div', { class: `draft draft-${t}` });
  }
  layer.append(draft);
  let last = p0;
  const snap45 = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(dx, dy);
    return { x: a.x + len * Math.cos(ang), y: a.y + len * Math.sin(ang) };
  };
  track((ev) => {
    let p = pagePoint(pe, ev);
    if (t === 'pen') {
      if (Math.hypot(p.x - last.x, p.y - last.y) * s < 1.5) return;
      pts.push([p.x, p.y]);
      last = p;
      path.setAttribute('d', pts.map(([x, y], k) => `${k ? 'L' : 'M'}${x} ${y}`).join(' '));
    } else if (line) {
      if (ev.shiftKey) p = snap45(p0, p);
      line.setAttribute('x2', p.x);
      line.setAttribute('y2', p.y);
    } else {
      const r = normRect(p0, p);
      Object.assign(draft.style, { left: r.x * s + 'px', top: r.y * s + 'px', width: r.w * s + 'px', height: r.h * s + 'px' });
    }
  }, (ev) => {
    draft.remove();
    let p = pagePoint(pe, ev);
    if ((t === 'line' || t === 'arrow') && ev.shiftKey) p = snap45(p0, p);
    finishDraw(i, t, p0, p, pts);
  });
}

function finishDraw(i, t, p0, p, pts) {
  const P = Annotations.props;
  let r = normRect(p0, p);
  const dragged = r.w * Viewer.scale > 4 || r.h * Viewer.scale > 4;
  const sz = Viewer.doc.sizes[i];
  switch (t) {
    case 'pen':
      addAnnot(i, { type: 'ink', strokes: [simplify(pts, 0.35)], stroke: P.pen.stroke, width: P.pen.width, opacity: P.pen.opacity }, { selectIt: false });
      break;
    case 'rect':
    case 'ellipse':
      if (!dragged) r = { x: clamp(p0.x - 60, 0, sz.w - 120), y: clamp(p0.y - 40, 0, sz.h - 80), w: 120, h: 80 };
      addAnnot(i, { type: t, ...r, stroke: P.shape.stroke, fill: P.shape.fill, width: P.shape.width, opacity: P.shape.opacity });
      setTool('select');
      select({ page: i, id: Viewer.doc.annotsAt(i).at(-1).id });
      break;
    case 'line':
    case 'arrow':
      if (!dragged) return;
      addAnnot(i, { type: 'line', arrow: t === 'arrow', pts: [[p0.x, p0.y], [p.x, p.y]], stroke: P.shape.stroke, width: P.shape.width, opacity: P.shape.opacity });
      setTool('select');
      select({ page: i, id: Viewer.doc.annotsAt(i).at(-1).id });
      break;
    case 'whiteout':
      if (!dragged) return;
      addAnnot(i, { type: 'whiteout', ...r, fill: sampleColors(i, r, true).bg }, { selectIt: false });
      break;
    case 'redact':
      if (!dragged) return;
      addAnnot(i, { type: 'redact', ...r }, { selectIt: false });
      break;
    case 'highlight':
    case 'underline':
    case 'strike':
      if (!dragged) return;
      addAnnot(i, { type: t, rects: [r], color: P[t].color, opacity: P[t].opacity }, { selectIt: false });
      break;
    case 'crop':
      if (dragged) App.confirmCrop(i, r);
      break;
    case 'field-text':
    case 'field-multiline':
    case 'field-check': {
      const kind = t.slice(6);
      if (!dragged) r = kind === 'check' ? { x: p0.x - 7, y: p0.y - 7, w: 14, h: 14 } : { x: p0.x, y: p0.y - 10, w: 180, h: kind === 'multiline' ? 60 : 20 };
      App.addFormField(i, kind, r);
      break;
    }
  }
}

/** Ramer–Douglas–Peucker simplification keeps ink strokes small. */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let best = -1, bestD = 0;
    for (let k = a + 1; k < b; k++) {
      const d = Math.abs(dy * pts[k][0] - dx * pts[k][1] + bx * ay - by * ax) / len;
      if (d > bestD) { bestD = d; best = k; }
    }
    if (bestD > tol) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, k) => keep[k]).map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)]);
}

function clickCreate(i, pt) {
  const doc = Viewer.doc;
  const P = Annotations.props;
  const t = Annotations.tool;
  const sz = doc.sizes[i];
  if (t === 'text' || t === 'date') {
    const snap = snapshot(doc);
    const a = { id: uid(), type: 'text', ...P.text, text: t === 'date' ? todayString() : '', created: Date.now() };
    a.w = t === 'date' ? 0 : Math.min(240, sz.w - pt.x);
    if (t === 'date') { _measureCanvas.font = cssFont(a); a.w = _measureCanvas.measureText(a.text).width + 2 * TEXT_PAD + 2; }
    a.x = clamp(pt.x, 0, Math.max(0, sz.w - a.w));
    a.y = clamp(pt.y - a.size * 0.8, 0, sz.h - a.size);
    a.h = textBoxHeight(a);
    if (t === 'date') { addAnnot(i, a); setTool('select'); select({ page: i, id: a.id }); return; }
    doc.annotsAt(i).push(a);
    setTool('select');
    renderAnnotPage(i);
    startTextEdit(i, a, { snap, isNew: true });
    return;
  }
  if (t === 'note') {
    const a = addAnnot(i, { type: 'note', x: clamp(pt.x - 4, 0, sz.w - NOTE_SIZE), y: clamp(pt.y - 4, 0, sz.h - NOTE_SIZE), text: '', color: P.note.color, author: settingsGet('author', '') });
    setTool('select');
    select({ page: i, id: a.id });
    openNotePopup(i, a, true);
    return;
  }
  const size = P.symbol.size;
  addAnnot(i, { type: 'symbol', sym: t, x: clamp(pt.x - size / 2, 0, sz.w - size), y: clamp(pt.y - size / 2, 0, sz.h - size), w: size, h: size, color: P.symbol.color }, { selectIt: false });
}

function startMove(e, pe, i, id) {
  const doc = Viewer.doc;
  const hit = doc.findAnnot(id);
  if (!hit) return;
  if (!Annotations.selected || Annotations.selected.id !== id) select({ page: i, id });
  const a = hit.annot;
  const start = pagePoint(pe, e, false);
  const b0 = annotBBox(a);
  const sz = doc.sizes[i];
  const orig = structuredClone(a);
  let snap = null;
  track((ev) => {
    const p = pagePoint(pe, ev, false);
    let dx = p.x - start.x, dy = p.y - start.y;
    if (!snap && Math.hypot(dx, dy) * Viewer.scale < 3) return;
    if (!snap) snap = snapshot(doc);
    dx = clamp(dx, -b0.x, sz.w - b0.x - b0.w);
    dy = clamp(dy, -b0.y, sz.h - b0.y - b0.h);
    Object.assign(a, structuredClone(orig));
    moveAnnot(a, dx, dy);
    refreshAnnEl(i, a);
  }, () => {
    if (snap) { pushUndoSnap(doc, snap); notify(); }
    else if (a.type === 'note') openNotePopup(i, a);
  });
}

function startResize(e, pe, i, id, h) {
  const doc = Viewer.doc;
  const hit = doc.findAnnot(id);
  if (!hit) return;
  const a = hit.annot;
  const start = pagePoint(pe, e, false);
  const b0 = annotBBox(a);
  const orig = structuredClone(a);
  const sz = doc.sizes[i];
  const snap = snapshot(doc);
  let changed = false;
  track((ev) => {
    const p = pagePoint(pe, ev);
    const dx = p.x - start.x, dy = p.y - start.y;
    changed = true;
    Object.assign(a, structuredClone(orig));
    if (h === 'p0' || h === 'p1') {
      const k = +h[1];
      a.pts[k] = [clamp(orig.pts[k][0] + dx, 0, sz.w), clamp(orig.pts[k][1] + dy, 0, sz.h)];
    } else {
      const lock = (a.type === 'image' || a.type === 'stamp' || a.type === 'symbol') !== ev.shiftKey;
      const nb = resizedBox(b0, h, dx, dy, lock);
      if (a.type === 'text') { a.x = nb.x; a.w = nb.w; a.h = textBoxHeight(a); }
      else setAnnotBBox(a, nb);
    }
    refreshAnnEl(i, a);
  }, () => {
    if (changed) { pushUndoSnap(doc, snap); notify(); }
  });
}

function resizedBox(b0, h, dx, dy, lock) {
  let x0 = b0.x, y0 = b0.y, x1 = b0.x + b0.w, y1 = b0.y + b0.h;
  const min = 4;
  if (h.includes('w')) x0 = Math.min(x0 + dx, x1 - min);
  if (h.includes('e')) x1 = Math.max(x1 + dx, x0 + min);
  if (h.includes('n')) y0 = Math.min(y0 + dy, y1 - min);
  if (h.includes('s')) y1 = Math.max(y1 + dy, y0 + min);
  if (lock && b0.h > 0) {
    const ratio = b0.w / b0.h;
    let w = x1 - x0, hh = y1 - y0;
    if (w / hh > ratio) w = hh * ratio; else hh = w / ratio;
    if (h.includes('w')) x0 = x1 - w; else x1 = x0 + w;
    if (h.includes('n')) y0 = y1 - hh; else y1 = y0 + hh;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---------- text editing ----------
function startTextEdit(i, a, { snap, isNew = false, selectAll = false, pair = null } = {}) {
  const doc = Viewer.doc;
  renderAnnotPage(i);
  const wrap = annElement(i, a.id);
  if (!wrap) return;
  Annotations.editing = { page: i, id: a.id, snap: snap || snapshot(doc), isNew, original: a.text, pair };
  Annotations.selected = { page: i, id: a.id };
  wrap.classList.add('editing', 'selected');
  wrap.querySelectorAll('.handle').forEach((n) => n.remove());
  wrap.style.height = 'auto';
  const body = wrap.querySelector('.ann-text-body');
  body.textContent = a.text;
  body.style.whiteSpace = 'pre-wrap';
  body.style.minHeight = a.size * LINE_H * Viewer.scale + 'px';
  try { body.contentEditable = 'plaintext-only'; } catch { body.contentEditable = 'true'; }
  body.spellcheck = true;
  body.focus();
  const range = document.createRange();
  range.selectNodeContents(body);
  if (!selectAll) range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  body.addEventListener('blur', () => finishTextEdit(), { once: true });
  body.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))) { ev.preventDefault(); body.blur(); }
  });
  body.addEventListener('input', () => { a.text = body.innerText.replace(/\n$/, ''); });
  renderContextBar();
}

function finishTextEdit() {
  const ed = Annotations.editing;
  if (!ed) return;
  Annotations.editing = null;
  const doc = Viewer.doc;
  const hit = doc && doc.findAnnot(ed.id);
  if (!hit) return;
  const a = hit.annot;
  const body = annElement(hit.page, a.id)?.querySelector('.ann-text-body');
  if (body) a.text = body.innerText.replace(/\n$/, '');
  const removePair = () => {
    if (!ed.pair) return;
    const p = doc.findAnnot(ed.pair);
    if (p) p.list.splice(p.list.indexOf(p.annot), 1);
  };
  if (!a.text.trim() || (ed.pair && a.text === ed.original)) {
    hit.list.splice(hit.list.indexOf(a), 1);
    removePair();
    if (!ed.isNew && !ed.pair) pushUndoSnap(doc, ed.snap);
    Annotations.selected = null;
  } else if (ed.isNew || a.text !== ed.original || ed.pair) {
    a.h = textBoxHeight(a);
    const sz = doc.sizes[hit.page];
    if (a.x + a.w > sz.w) a.w = Math.max(20, sz.w - a.x);
    pushUndoSnap(doc, ed.snap);
  }
  renderAnnotPage(hit.page);
  renderContextBar();
  notify();
}

// ---------- editing text that is already in the PDF ----------
async function renderEditCandidates(i) {
  const pe = Viewer.els[i];
  if (!pe) return;
  const layer = pe.querySelector('.annotLayer');
  layer.querySelectorAll('.edit-cand').forEach((n) => n.remove());
  if (Annotations.tool !== 'edittext' || !pe._key) return;
  const doc = Viewer.doc;
  const tc = await pageTextContent(doc, i);
  const vp = await scale1Viewport(i);
  if (Annotations.tool !== 'edittext' || doc !== Viewer.doc) return;
  const s = Viewer.scale;
  const frag = document.createDocumentFragment();
  tc.items.forEach((it) => {
    if (!it.str || !it.str.trim()) return;
    const b = itemBox(vp, it);
    const c = el('div', { class: 'edit-cand', title: 'Click to edit', style: { left: b.x * s + 'px', top: b.y * s + 'px', width: b.w * s + 'px', height: b.h * s + 'px' } });
    c._item = it;
    c._box = b;
    frag.append(c);
  });
  layer.prepend(frag);
}

/** Reads the page background and text color around a box from the rendered canvas. */
function sampleColors(i, box, bgOnly = false) {
  const fallback = { bg: '#ffffff', fg: '#111111' };
  const pe = Viewer.els[i];
  const canvas = pe && pe.querySelector('canvas.page-canvas');
  if (!canvas || !pe._canvasScale) return fallback;
  const k = pe._canvasScale;
  const x0 = Math.max(0, Math.floor((box.x - 2) * k)), y0 = Math.max(0, Math.floor((box.y - 2) * k));
  const x1 = Math.min(canvas.width - 1, Math.ceil((box.x + box.w + 2) * k)), y1 = Math.min(canvas.height - 1, Math.ceil((box.y + box.h + 2) * k));
  if (x1 <= x0 || y1 <= y0) return fallback;
  let data;
  try { data = canvas.getContext('2d').getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1); } catch { return fallback; }
  const W = data.width, H = data.height, d = data.data;
  const counts = new Map();
  const px = (x, y) => { const o = (y * W + x) * 4; return [d[o], d[o + 1], d[o + 2]]; };
  const tally = (c) => { const key = c.map((v) => v >> 3).join(','); const cur = counts.get(key); if (cur) cur.n++; else counts.set(key, { n: 1, c }); };
  for (let x = 0; x < W; x++) { tally(px(x, 0)); tally(px(x, H - 1)); }
  for (let y = 0; y < H; y++) { tally(px(0, y)); tally(px(W - 1, y)); }
  let best = null;
  for (const v of counts.values()) if (!best || v.n > best.n) best = v;
  const bg = best ? best.c : [255, 255, 255];
  if (bgOnly) return { bg: rgbToHex(...bg), fg: fallback.fg };
  let fg = [17, 17, 17], far = -1;
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const c = px(x, y);
    const dd = (c[0] - bg[0]) ** 2 + (c[1] - bg[1]) ** 2 + (c[2] - bg[2]) ** 2;
    if (dd > far) { far = dd; fg = c; }
  }
  return { bg: rgbToHex(...bg), fg: rgbToHex(...fg) };
}

async function editExistingText(i, cand) {
  const doc = Viewer.doc;
  const it = cand._item;
  const b = cand._box;
  const snap = snapshot(doc);
  const page = await doc.pdf.getPage(i + 1);
  const tc = await pageTextContent(doc, i);
  const style = tc.styles[it.fontName] || {};
  let realName = '';
  try { if (page.commonObjs.has(it.fontName)) realName = page.commonObjs.get(it.fontName).name || ''; } catch { /* font not loaded */ }
  const nm = `${realName} ${style.fontFamily || ''}`.toLowerCase();
  let font = 'Helvetica';
  if (/courier|mono/.test(nm)) font = 'Courier';
  else if (/times|serif|roman|georgia|garamond|cambria|minion|book/.test(nm) && !/sans/.test(nm)) font = 'Times';
  const bold = /bold|black|heavy|semibold|demi/.test(nm);
  const italic = /italic|oblique/.test(nm);
  const { bg, fg } = sampleColors(i, b);
  const size = +b.fontH.toFixed(2);
  const wo = { id: uid(), type: 'whiteout', x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h + 2, fill: bg, created: Date.now() };
  const ta = {
    id: uid(), type: 'text', font, bold, italic, underline: false, size, color: fg, align: 'left', bg: null, text: it.str,
    x: b.x - TEXT_PAD, y: b.baseline - TEXT_PAD - baselineOffset(font, size), w: b.w + 2 * TEXT_PAD + size * 3, created: Date.now(),
  };
  ta.w = Math.min(ta.w, doc.sizes[i].w - ta.x);
  ta.h = textBoxHeight(ta);
  doc.annotsAt(i).push(wo, ta);
  setTool('select');
  startTextEdit(i, ta, { snap, pair: wo.id, selectAll: false });
}

// ---------- markup from a text selection ----------
function applySelectionMarkup() {
  const t = Annotations.tool;
  if (!MARKUP_TOOLS.has(t)) return;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  const s = Viewer.scale;
  const byPage = new Map();
  for (let r = 0; r < sel.rangeCount; r++) {
    for (const cr of sel.getRangeAt(r).getClientRects()) {
      if (cr.width < 1 || cr.height < 1) continue;
      const pe = pageAtClientPoint(cr.left + cr.width / 2, cr.top + cr.height / 2);
      if (!pe) continue;
      const pr = pe.getBoundingClientRect();
      if (cr.height > pr.height * 0.2) continue;
      const i = +pe.dataset.index;
      if (!byPage.has(i)) byPage.set(i, []);
      byPage.get(i).push({ x: (cr.left - pr.left) / s, y: (cr.top - pr.top) / s, w: cr.width / s, h: cr.height / s });
    }
  }
  sel.removeAllRanges();
  if (!byPage.size) return;
  const doc = Viewer.doc;
  const P = Annotations.props[t];
  pushUndo(doc);
  for (const [i, rects] of byPage) {
    doc.annotsAt(i).push({ id: uid(), type: t, rects: mergeLineRects(rects), color: P.color, opacity: P.opacity, created: Date.now() });
    renderAnnotPage(i);
  }
  notify();
}

function mergeLineRects(rects) {
  const sorted = rects.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - r.y) < Math.min(last.h, r.h) * 0.5 && r.x <= last.x + last.w + Math.max(last.h, r.h) * 0.6) {
      const x1 = Math.max(last.x + last.w, r.x + r.w);
      const y0 = Math.min(last.y, r.y);
      const y1 = Math.max(last.y + last.h, r.y + r.h);
      last.x = Math.min(last.x, r.x);
      last.w = x1 - last.x;
      last.y = y0;
      last.h = y1 - y0;
    } else out.push({ ...r });
  }
  return out;
}

// ---------- notes ----------
function openNotePopup(i, a, isNew = false) {
  $$('.note-pop').forEach((n) => n.remove());
  const doc = Viewer.doc;
  const s = Viewer.scale;
  const snap = snapshot(doc);
  const ta = el('textarea', { class: 'note-text', rows: 5, placeholder: 'Write a comment…', dir: 'auto' });
  ta.value = a.text || '';
  const close = (save = true) => {
    pop.remove();
    if (save && ta.value !== (a.text || '')) {
      a.text = ta.value;
      pushUndoSnap(doc, snap);
      renderAnnotPage(i);
      notify();
    } else if (isNew && !ta.value && !a.text) {
      // Leave an empty new note in place; the user can delete it.
    }
  };
  const pop = el('div', { class: 'note-pop' },
    el('div', { class: 'pop-head' },
      el('span', {}, a.author || 'Comment'),
      el('span', { class: 'muted' }, new Date(a.created || Date.now()).toLocaleString())),
    ta,
    el('div', { class: 'pop-actions' },
      el('button', { class: 'btn btn-ghost', onclick: () => { pop.remove(); select({ page: i, id: a.id }); deleteSelected(); } }, 'Delete'),
      el('button', { class: 'btn btn-primary', onclick: () => close(true) }, 'Done')));
  pop.style.left = Math.min((a.x + NOTE_SIZE + 6) * s, Viewer.els[i].clientWidth - 250) + 'px';
  pop.style.top = a.y * s + 'px';
  ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(true); });
  Viewer.els[i].querySelector('.annotLayer').append(pop);
  ta.focus();
}

// ---------- placing images, signatures and stamps ----------
function showGhost(p) {
  hideGhost();
  const g = el('div', { id: 'ghost' });
  if (p.kind === 'image') g.append(el('img', { src: p.src, alt: '' }));
  else if (p.kind === 'stamp') g.append(el('div', { class: 'stamp-box', style: { color: p.color, borderColor: p.color } }, el('div', { class: 'stamp-main' }, p.text)));
  else g.append(el('div', { class: 'ghost-box' }, p.label || ''));
  document.body.append(g);
  const sizeIt = () => { g.style.width = p.w * Viewer.scale + 'px'; g.style.height = p.h * Viewer.scale + 'px'; };
  sizeIt();
  const move = (e) => { sizeIt(); g.style.left = e.clientX + 'px'; g.style.top = e.clientY + 'px'; g.hidden = !e.target.closest('#pages .page'); };
  g._move = move;
  window.addEventListener('pointermove', move);
}
function hideGhost() {
  const g = $('#ghost');
  if (g) { window.removeEventListener('pointermove', g._move); g.remove(); }
}

function placePending(i, pt) {
  const p = Annotations.pending;
  const doc = Viewer.doc;
  const sz = doc.sizes[i];
  Annotations.pending = null;
  hideGhost();
  viewerEl().dataset.mode = 'select';
  let w = Math.min(p.w, sz.w), h = Math.min(p.h, sz.h);
  if (w !== p.w || h !== p.h) { const k = Math.min(sz.w / p.w, sz.h / p.h); w = p.w * k; h = p.h * k; }
  const box = { x: clamp(pt.x - w / 2, 0, sz.w - w), y: clamp(pt.y - h / 2, 0, sz.h - h), w, h };
  if (p.onPlace) { p.onPlace(i, box); renderContextBar(); return; }
  if (p.kind === 'image') addAnnot(i, { type: 'image', src: p.src, ...box, opacity: 1, role: p.role });
  else if (p.kind === 'stamp') addAnnot(i, { type: 'stamp', text: p.text, sub: p.sub, color: p.color, ...box, opacity: 1 });
  renderContextBar();
}

/** Puts an image into a given box (e.g. a signature field), keeping its aspect ratio. */
function placeImageInBox(i, src, imgW, imgH, box, role) {
  const k = Math.min(box.w / imgW, box.h / imgH);
  const w = imgW * k, h = imgH * k;
  addAnnot(i, { type: 'image', src, x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h, opacity: 1, role });
}

// ---------- context (properties) bar ----------
function currentGroup() {
  const a = selectedAnnot();
  if (a) return TYPE_GROUP[a.type] || null;
  return TOOL_GROUP[Annotations.tool] || null;
}

function applyProp(key, value) {
  const group = currentGroup();
  if (!group) return;
  Annotations.props[group][key] = value;
  settingsSet('props', Annotations.props);
  const a = selectedAnnot();
  if (a) {
    const doc = Viewer.doc;
    const ed = Annotations.editing;
    if (!ed) pushUndo(doc);
    if (group === 'symbol' && key === 'size') { a.w = a.h = value; }
    else if (['highlight', 'underline', 'strike', 'note', 'stamp'].includes(group) && key === 'color') a.color = value;
    else a[key] = value;
    if (a.type === 'text') a.h = textBoxHeight(a);
    if (ed) {
      const body = annElement(ed.page, a.id)?.querySelector('.ann-text-body');
      if (body) Object.assign(body.style, { font: cssFont(a, Viewer.scale), color: a.color, textAlign: a.align, background: a.bg || 'transparent', textDecoration: a.underline ? 'underline' : 'none' });
      body?.focus();
    } else {
      renderAnnotPage(Annotations.selected.page);
    }
    notify();
  }
  renderContextBar();
}

function swatchRow(key, value, { allowNone = false, label } = {}) {
  const row = el('div', { class: 'cb-group', role: 'group', 'aria-label': label || key });
  if (label) row.append(el('span', { class: 'cb-label' }, label));
  if (allowNone) {
    row.append(el('button', { class: 'swatch swatch-none' + (!value ? ' on' : ''), title: 'None', 'aria-label': 'None', onclick: () => applyProp(key, null) }));
  }
  for (const c of SWATCHES) {
    row.append(el('button', { class: 'swatch' + (value && value.toLowerCase() === c ? ' on' : ''), style: { '--c': c }, title: c, 'aria-label': c, onclick: () => applyProp(key, c) }));
  }
  const custom = el('input', { type: 'color', class: 'swatch-custom', value: value || '#000000', title: 'Custom color', 'aria-label': 'Custom color' });
  custom.addEventListener('change', () => applyProp(key, custom.value));
  row.append(custom);
  return row;
}
function numberField(key, value, { label, min, max, step = 1, suffix = '' }) {
  const input = el('input', { type: 'number', class: 'cb-num', min, max, step, value: +(+value).toFixed(2), 'aria-label': label });
  input.addEventListener('change', () => applyProp(key, clamp(+input.value || min, min, max)));
  input.addEventListener('keydown', (e) => e.stopPropagation());
  return el('label', { class: 'cb-group' }, el('span', { class: 'cb-label' }, label), input, suffix ? el('span', { class: 'cb-suffix' }, suffix) : null);
}
function rangeField(key, value, { label, min, max, step, fmt }) {
  const out = el('span', { class: 'cb-suffix' }, fmt(value));
  const input = el('input', { type: 'range', class: 'cb-range', min, max, step, value, 'aria-label': label });
  input.addEventListener('input', () => { out.textContent = fmt(+input.value); });
  input.addEventListener('change', () => applyProp(key, +input.value));
  return el('label', { class: 'cb-group' }, el('span', { class: 'cb-label' }, label), input, out);
}
function toggleBtn(key, value, iconName, title) {
  return el('button', { class: 'cb-toggle' + (value ? ' on' : ''), title, 'aria-label': title, 'aria-pressed': value ? 'true' : 'false', onmousedown: (e) => e.preventDefault(), onclick: () => applyProp(key, !value) }, icon(iconName, 16));
}

function renderContextBar() {
  const bar = $('#contextBar');
  if (!bar) return;
  bar.innerHTML = '';
  const a = selectedAnnot();
  const group = currentGroup();
  const v = a || (group ? Annotations.props[group] : null);
  const t = Annotations.tool;

  if (Annotations.pending) {
    bar.append(el('span', { class: 'cb-hint' }, Annotations.pending.hint || 'Click on a page to place it. Press Esc to cancel.'),
      el('button', { class: 'btn btn-ghost', onclick: () => { Annotations.pending = null; hideGhost(); viewerEl().dataset.mode = 'select'; renderContextBar(); } }, 'Cancel'));
    return;
  }
  if (!v) {
    bar.append(el('span', { class: 'cb-hint' }, TOOL_HINTS[t] || ''));
    if (t === 'redact') bar.append(el('button', { class: 'btn btn-danger', onclick: () => App.run('apply-redactions') }, 'Apply Redactions'));
    return;
  }
  const title = a ? ({ text: 'Text', rect: 'Rectangle', ellipse: 'Ellipse', line: a.arrow ? 'Arrow' : 'Line', ink: 'Drawing', highlight: 'Highlight', underline: 'Underline', strike: 'Strikethrough', note: 'Note', symbol: 'Mark', stamp: 'Stamp', image: a.role === 'signature' ? 'Signature' : a.role === 'initials' ? 'Initials' : a.role === 'seal' ? 'Seal' : 'Image', whiteout: 'White-out', redact: 'Redaction' }[a.type] || 'Item') : null;
  if (title) bar.append(el('span', { class: 'cb-title' }, title));

  switch (group) {
    case 'text': {
      const fontSel = el('select', { class: 'cb-select', 'aria-label': 'Font' },
        ...[['Helvetica', 'Sans'], ['Times', 'Serif'], ['Courier', 'Mono']].map(([val, lab]) => el('option', { value: val, selected: v.font === val }, lab)));
      fontSel.addEventListener('change', () => applyProp('font', fontSel.value));
      bar.append(el('label', { class: 'cb-group' }, el('span', { class: 'cb-label' }, 'Font'), fontSel));
      bar.append(numberField('size', v.size, { label: 'Size', min: 4, max: 144, step: 0.5, suffix: 'pt' }));
      bar.append(el('div', { class: 'cb-group' },
        toggleBtn('bold', v.bold, 'bold', 'Bold'), toggleBtn('italic', v.italic, 'italic', 'Italic'), toggleBtn('underline', v.underline, 'textUnderline', 'Underline')));
      bar.append(el('div', { class: 'cb-group' }, ...['left', 'center', 'right'].map((al) =>
        el('button', { class: 'cb-toggle' + ((v.align || 'left') === al ? ' on' : ''), title: 'Align ' + al, 'aria-label': 'Align ' + al, onmousedown: (e) => e.preventDefault(), onclick: () => applyProp('align', al) }, icon('align' + al[0].toUpperCase() + al.slice(1), 16)))));
      bar.append(swatchRow('color', v.color, { label: 'Color' }));
      bar.append(swatchRow('bg', v.bg, { label: 'Fill', allowNone: true }));
      break;
    }
    case 'shape':
      bar.append(swatchRow('stroke', v.stroke, { label: 'Stroke', allowNone: a && a.type !== 'line' }));
      if (!a || a.type !== 'line') bar.append(swatchRow('fill', v.fill, { label: 'Fill', allowNone: true }));
      bar.append(rangeField('width', v.width, { label: 'Width', min: 0.5, max: 16, step: 0.5, fmt: (x) => x + 'pt' }));
      bar.append(rangeField('opacity', v.opacity, { label: 'Opacity', min: 0.1, max: 1, step: 0.05, fmt: (x) => Math.round(x * 100) + '%' }));
      break;
    case 'pen':
      bar.append(swatchRow('stroke', v.stroke, { label: 'Color' }));
      bar.append(rangeField('width', v.width, { label: 'Width', min: 0.5, max: 20, step: 0.5, fmt: (x) => x + 'pt' }));
      bar.append(rangeField('opacity', v.opacity, { label: 'Opacity', min: 0.1, max: 1, step: 0.05, fmt: (x) => Math.round(x * 100) + '%' }));
      break;
    case 'highlight':
    case 'underline':
    case 'strike':
      bar.append(swatchRow('color', v.color, { label: 'Color' }));
      if (group === 'highlight') bar.append(rangeField('opacity', v.opacity ?? 0.4, { label: 'Strength', min: 0.15, max: 0.8, step: 0.05, fmt: (x) => Math.round(x * 100) + '%' }));
      break;
    case 'note':
      bar.append(swatchRow('color', v.color, { label: 'Color' }));
      if (a) bar.append(el('button', { class: 'btn btn-ghost', onclick: () => openNotePopup(Annotations.selected.page, a) }, 'Open note'));
      break;
    case 'symbol':
      bar.append(swatchRow('color', v.color, { label: 'Color' }));
      bar.append(numberField('size', a ? a.w : v.size, { label: 'Size', min: 6, max: 96, suffix: 'pt' }));
      break;
    case 'stamp':
      bar.append(swatchRow('color', v.color, { label: 'Color' }));
      break;
    case 'image':
      bar.append(rangeField('opacity', v.opacity ?? 1, { label: 'Opacity', min: 0.1, max: 1, step: 0.05, fmt: (x) => Math.round(x * 100) + '%' }));
      break;
    case 'whiteout':
      bar.append(swatchRow('fill', v.fill, { label: 'Fill' }));
      break;
  }
  if (a) {
    bar.append(el('span', { class: 'cb-spacer' }));
    if (a.type === 'text' && !Annotations.editing) bar.append(el('button', { class: 'btn btn-ghost', onclick: () => startTextEdit(Annotations.selected.page, a, {}) }, 'Edit text'));
    bar.append(el('button', { class: 'btn btn-ghost', title: 'Duplicate (Ctrl+D)', onclick: () => duplicateSelected() }, icon('copy', 16), 'Duplicate'));
    bar.append(el('button', { class: 'btn btn-ghost danger-text', title: 'Delete (Del)', onclick: () => deleteSelected() }, icon('trash', 16), 'Delete'));
  } else if (t === 'redact') {
    bar.append(el('button', { class: 'btn btn-danger', onclick: () => App.run('apply-redactions') }, 'Apply Redactions'));
  }
}

// ---------- keyboard ----------
function annotationKeys(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') {
    if (Annotations.pending) { Annotations.pending = null; hideGhost(); viewerEl().dataset.mode = 'select'; renderContextBar(); return true; }
    if (Annotations.selected) { select(null); return true; }
    if (Annotations.tool !== 'select') { setTool('select'); return true; }
    return false;
  }
  const a = selectedAnnot();
  if (!a) {
    if (mod && e.key.toLowerCase() === 'v' && Annotations.clipboard && !window.getSelection()?.toString()) { duplicateSelected(Viewer.current, 12); return true; }
    return false;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); return true; }
  if (mod && e.key.toLowerCase() === 'd') { duplicateSelected(); return true; }
  if (mod && e.key.toLowerCase() === 'c') { Annotations.clipboard = structuredClone(a); toast('Copied'); return true; }
  if (mod && e.key.toLowerCase() === 'v' && Annotations.clipboard) { duplicateSelected(Viewer.current, 12); return true; }
  if (e.key === 'Enter' && a.type === 'text') { startTextEdit(Annotations.selected.page, a, {}); return true; }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[e.key]) {
    const step = e.shiftKey ? 10 : 1;
    const doc = Viewer.doc;
    const i = Annotations.selected.page;
    const b = annotBBox(a);
    const sz = doc.sizes[i];
    pushUndo(doc);
    moveAnnot(a, clamp(arrows[e.key][0] * step, -b.x, sz.w - b.x - b.w), clamp(arrows[e.key][1] * step, -b.y, sz.h - b.y - b.h));
    renderAnnotPage(i);
    notify();
    return true;
  }
  return false;
}

// Hooks used by the viewer.
Annotations.renderPage = (i) => {
  if (Annotations.editing && Annotations.editing.page === i) finishTextEdit();
  $$('.note-pop', Viewer.els[i]).forEach((n) => n.remove());
  renderAnnotPage(i);
  renderEditCandidates(i);
};
Annotations.onPageRendered = (i) => renderEditCandidates(i);
