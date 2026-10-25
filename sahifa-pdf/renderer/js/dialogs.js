'use strict';
/* Modal dialogs. `dialog()` resolves to the value of the button pressed, or null. */

function dialog({ title, content, buttons = [{ label: 'OK', value: true, kind: 'primary' }], width = 480, className = '' }) {
  return new Promise((resolve) => {
    const root = $('#modalRoot');
    const prevFocus = document.activeElement;
    const err = el('div', { class: 'dlg-error', role: 'alert' });
    const footer = el('div', { class: 'dlg-actions' });
    const box = el('div', { class: `dlg ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: { width: `min(${width}px, calc(100vw - 32px))` } },
      el('div', { class: 'dlg-head' }, el('h2', {}, title), el('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => done(null) }, icon('close', 18))),
      el('div', { class: 'dlg-body' }, content),
      err,
      footer);
    const overlay = el('div', { class: 'dlg-overlay' }, box);
    let finished = false;
    async function done(value, btn) {
      if (finished) return;
      if (btn && btn.validate) {
        try {
          const msg = await btn.validate();
          if (msg) { err.textContent = msg; return; }
        } catch (e) { err.textContent = e.message || String(e); return; }
      }
      finished = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(typeof value === 'function' ? value() : value);
    }
    for (const b of buttons) {
      footer.append(el('button', { class: `btn btn-${b.kind || 'ghost'}`, id: b.id, onclick: () => done(b.value, b) }, b.label));
    }
    function onKey(e) {
      if (!overlay.isConnected) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
        const primary = buttons.find((b) => b.kind === 'primary' || b.kind === 'danger');
        if (primary) { e.preventDefault(); done(primary.value, primary); }
      }
      e.stopPropagation();
    }
    document.addEventListener('keydown', onKey, true);
    root.append(overlay);
    const first = box.querySelector('[autofocus]') || box.querySelector('input, select, textarea') || footer.querySelector('.btn-primary');
    if (first) setTimeout(() => first.focus(), 20);
    box._setError = (m) => { err.textContent = m || ''; };
  });
}

function field(label, input, hint) {
  return el('label', { class: 'fld' }, el('span', { class: 'fld-label' }, label), input, hint ? el('span', { class: 'fld-hint' }, hint) : null);
}
function textInput(value = '', attrs = {}) {
  return el('input', { type: 'text', class: 'inp', value, ...attrs });
}

async function confirmDialog(title, message, okLabel = 'OK', kind = 'primary') {
  return !!(await dialog({
    title,
    content: el('p', { class: 'dlg-text' }, message),
    buttons: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, kind }],
  }));
}

async function passwordPrompt(name, incorrect) {
  const inp = el('input', { type: 'password', class: 'inp', autofocus: true, id: 'pwInput' });
  return dialog({
    title: 'Password required',
    content: el('div', { class: 'stack' },
      el('p', { class: 'dlg-text' }, `“${name}” is protected. Enter its password to open it.`),
      incorrect ? el('p', { class: 'dlg-warn' }, 'That password was not correct. Try again.') : null,
      field('Password', inp)),
    buttons: [{ label: 'Cancel', value: null }, { label: 'Open', kind: 'primary', value: () => inp.value }],
    width: 420,
  });
}

// ---------- signatures ----------
const SIG_FONTS = [
  { family: 'Dancing Script', label: 'Flowing' },
  { family: 'Great Vibes', label: 'Formal' },
  { family: 'Allura', label: 'Elegant' },
  { family: 'Sacramento', label: 'Light' },
];
const INK_COLORS = [['#111827', 'Black'], ['#1d3fae', 'Blue'], ['#0b5e4d', 'Green'], ['#b42318', 'Red']];

/** Crops transparent margins off a canvas and returns {src, w, h} in points. */
function trimCanvas(c, pad = 6, pxPerPt = 3) {
  const ctx = c.getContext('2d');
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const out = el('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return { src: out.toDataURL('image/png'), w: out.width / pxPerPt, h: out.height / pxPerPt };
}

function typedSignature(text, family, color) {
  const c = el('canvas');
  const size = 120;
  const ctx = c.getContext('2d');
  ctx.font = `${size}px "${family}", cursive`;
  const w = Math.ceil(ctx.measureText(text).width) + size;
  c.width = w;
  c.height = Math.ceil(size * 1.8);
  ctx.font = `${size}px "${family}", cursive`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, c.height / 2);
  return trimCanvas(c, 8, 120 / 30); // typed signature renders ~30pt tall
}

function makeSignaturePad(color) {
  const W = 640, H = 220;
  const dpr = 2;
  const canvas = el('canvas', { class: 'sig-pad', width: W * dpr, height: H * dpr, 'aria-label': 'Signature drawing area' });
  canvas.style.width = '100%';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const strokes = [];
  let cur = null;
  const state = { color };
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H, t: performance.now() }; };
  function drawSeg(p0, p1, p2, width) {
    ctx.strokeStyle = state.color;
    ctx.lineWidth = width;
    ctx.beginPath();
    const m1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    const m2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    ctx.moveTo(m1.x, m1.y);
    ctx.quadraticCurveTo(p1.x, p1.y, m2.x, m2.y);
    ctx.stroke();
  }
  function redraw() {
    ctx.clearRect(0, 0, W, H);
    for (const s of strokes) replay(s);
  }
  function widthFor(a, b) {
    const v = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, b.t - a.t);
    return clamp(4.2 - v * 1.6, 1.4, 4.2);
  }
  function replay(s) {
    if (s.length === 1) { ctx.fillStyle = state.color; ctx.beginPath(); ctx.arc(s[0].x, s[0].y, 2, 0, Math.PI * 2); ctx.fill(); return; }
    for (let k = 1; k < s.length; k++) drawSeg(s[Math.max(0, k - 2)], s[k - 1], s[k], s[k].w);
  }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const p = pos(e);
    p.w = 3;
    cur = [p];
    strokes.push(cur);
    replay(cur);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!cur) return;
    const p = pos(e);
    const last = cur[cur.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < 1.2) return;
    p.w = (last.w * 0.6) + widthFor(last, p) * 0.4;
    cur.push(p);
    drawSeg(cur[Math.max(0, cur.length - 3)], cur[cur.length - 2], p, p.w);
  });
  const end = () => { cur = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  return {
    canvas,
    clear() { strokes.length = 0; redraw(); },
    setColor(c) { state.color = c; redraw(); },
    isEmpty: () => !strokes.length,
    export() {
      // Re-render at 3 px per point for a crisp result.
      const out = el('canvas', { width: W * 3, height: H * 3 });
      const o = out.getContext('2d');
      o.scale(3, 3);
      const saved = ctx;
      o.lineCap = 'round'; o.lineJoin = 'round';
      for (const s of strokes) {
        if (s.length === 1) { o.fillStyle = state.color; o.beginPath(); o.arc(s[0].x, s[0].y, 2, 0, Math.PI * 2); o.fill(); continue; }
        for (let k = 1; k < s.length; k++) {
          const p0 = s[Math.max(0, k - 2)], p1 = s[k - 1], p2 = s[k];
          o.strokeStyle = state.color; o.lineWidth = p2.w; o.beginPath();
          o.moveTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
          o.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
          o.stroke();
        }
      }
      void saved;
      // Drawn at pad scale: 640 px wide pad ≈ 213 pt; signatures land at about 40% of that.
      const r = trimCanvas(out, 10, 3);
      if (r) { r.w *= 0.4; r.h *= 0.4; }
      return r;
    },
  };
}

async function imageToSignature(data, removeBg) {
  const img = await loadImage(bytesToDataUrl(data, data[0] === 0x89 ? 'image/png' : 'image/jpeg'));
  const max = 1400;
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = el('canvas', { width: Math.round(img.width * k), height: Math.round(img.height * k) });
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, c.width, c.height);
  if (removeBg) {
    const id = ctx.getImageData(0, 0, c.width, c.height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      // Fade light pixels to transparent so paper and shadows disappear.
      d[i + 3] = Math.round(d[i + 3] * clamp((235 - lum) / 70, 0, 1));
    }
    ctx.putImageData(id, 0, 0);
  }
  const r = trimCanvas(c, 4, 1);
  if (!r) return null;
  const target = 150; // default width in points
  const s = target / r.w;
  return { src: r.src, w: r.w * s, h: r.h * s };
}

async function signatureDialog(kind = 'signature', { saveOnly = false } = {}) {
  if (!(await Library.load())) return null;
  const isInit = kind === 'initials';
  const label = isInit ? 'initials' : 'signature';
  let color = settingsGet('inkColor', INK_COLORS[0][0]);
  let tab = !saveOnly && Library.of(kind).length ? 'saved' : 'type';
  let chosenFont = settingsGet('sigFont', SIG_FONTS[0].family);
  let upload = null;
  let pickedSaved = null;
  const pad = makeSignaturePad(color);

  const nameInput = textInput(settingsGet(isInit ? 'initials' : 'author', ''), { placeholder: isInit ? 'Your initials' : 'Your full name', id: 'sigName' });
  const fontsBox = el('div', { class: 'sig-fonts', role: 'radiogroup', 'aria-label': 'Style' });
  const renderFonts = () => {
    fontsBox.innerHTML = '';
    for (const f of SIG_FONTS) {
      const card = el('button', { class: 'sig-font' + (f.family === chosenFont ? ' on' : ''), role: 'radio', 'aria-checked': f.family === chosenFont ? 'true' : 'false', style: { fontFamily: `"${f.family}", cursive`, color } },
        nameInput.value || (isInit ? 'AB' : 'Your Name'));
      card.addEventListener('click', () => { chosenFont = f.family; renderFonts(); });
      fontsBox.append(card);
    }
  };
  nameInput.addEventListener('input', renderFonts);
  renderFonts();

  const removeBg = el('input', { type: 'checkbox', checked: true, id: 'sigRemoveBg' });
  const uploadPreview = el('div', { class: 'sig-upload-preview' }, 'No image chosen yet.');
  const pickBtn = el('button', { class: 'btn btn-ghost' }, icon('image', 16), 'Choose image…');
  const refreshUpload = async (files) => {
    if (!files || !files[0]) return;
    upload = files[0].data;
    const r = await imageToSignature(upload, removeBg.checked);
    uploadPreview.innerHTML = '';
    if (r) uploadPreview.append(el('img', { src: r.src, alt: 'Signature preview' }));
  };
  pickBtn.addEventListener('click', async () => refreshUpload(await Host.openDialog({ multi: false, kind: 'images' })));
  removeBg.addEventListener('change', () => upload && refreshUpload([{ data: upload }]));

  const savedBox = el('div', { class: 'sig-saved' });
  const renderSaved = () => {
    savedBox.innerHTML = '';
    const list = Library.of(kind);
    if (!list.length) savedBox.append(el('p', { class: 'muted' }, `No saved ${label}s yet.`));
    if (!pickedSaved) pickedSaved = list.find((x) => x.isDefault) || null;
    for (const s of list) {
      const card = el('div', { class: 'sig-saved-item' + (pickedSaved === s ? ' on' : '') },
        el('button', { class: 'sig-saved-pick', 'aria-label': 'Use ' + s.name, onclick: () => { pickedSaved = s; renderSaved(); } }, el('img', { src: s.src, alt: '' }), el('span', { class: 'sig-saved-name' }, s.isDefault ? icon('star', 11) : null, s.name)),
        el('button', { class: 'icon-btn', 'aria-label': 'Remove', title: 'Remove', onclick: async () => { await Library.remove(s.id); if (pickedSaved === s) pickedSaved = null; renderSaved(); } }, icon('trash', 16)));
      savedBox.append(card);
    }
  };
  renderSaved();

  const colorRow = el('div', { class: 'ink-colors', role: 'radiogroup', 'aria-label': 'Ink color' });
  const renderColors = () => {
    colorRow.innerHTML = '';
    for (const [c, name] of INK_COLORS) {
      colorRow.append(el('button', { class: 'ink' + (c === color ? ' on' : ''), style: { '--c': c }, title: name, 'aria-label': name, role: 'radio', 'aria-checked': c === color ? 'true' : 'false', onclick: () => { color = c; settingsSet('inkColor', c); pad.setColor(c); renderColors(); renderFonts(); } }));
    }
  };
  renderColors();

  const panels = {
    saved: el('div', { class: 'sig-panel' }, savedBox),
    type: el('div', { class: 'sig-panel stack' }, field(isInit ? 'Initials' : 'Name', nameInput), fontsBox),
    draw: el('div', { class: 'sig-panel stack' }, el('div', { class: 'sig-pad-wrap' }, pad.canvas, el('div', { class: 'sig-line' })),
      el('div', { class: 'row' }, el('span', { class: 'muted' }, 'Draw with your mouse, trackpad or pen.'), el('button', { class: 'btn btn-ghost', onclick: () => pad.clear() }, 'Clear'))),
    upload: el('div', { class: 'sig-panel stack' }, el('div', { class: 'row' }, pickBtn, el('label', { class: 'check' }, removeBg, 'Remove paper background')), uploadPreview),
  };
  const tabs = el('div', { class: 'seg', role: 'tablist' });
  const host = el('div', {});
  const renderTabs = () => {
    tabs.innerHTML = '';
    for (const [k, lab] of (saveOnly ? [['type', 'Type'], ['draw', 'Draw'], ['upload', 'Image']] : [['saved', 'Saved'], ['type', 'Type'], ['draw', 'Draw'], ['upload', 'Image']])) {
      tabs.append(el('button', { class: 'seg-btn' + (k === tab ? ' on' : ''), role: 'tab', 'aria-selected': k === tab ? 'true' : 'false', onclick: () => { tab = k; renderTabs(); } }, lab));
    }
    host.innerHTML = '';
    host.append(panels[tab]);
    colorRow.hidden = tab === 'saved' || tab === 'upload';
    saveRow.hidden = tab === 'saved';
  };
  const remember = el('input', { type: 'checkbox', checked: true, id: 'sigRemember' });
  const saveName = textInput('', { placeholder: `Name in your library (e.g. “${isInit ? 'Initials' : 'Full signature'}”)`, id: 'sigSaveName' });
  const saveRow = el('div', { class: 'row between' }, saveOnly ? el('span', { class: 'fld-label' }, 'Name') : el('label', { class: 'check' }, remember, 'Save to my library'), saveName);
  renderTabs();
  remember.addEventListener('change', () => { saveName.disabled = !remember.checked; });

  let result = null;
  const ok = await dialog({
    title: isInit ? 'Add your initials' : 'Add your signature',
    width: 680,
    className: 'dlg-sign',
    content: el('div', { class: 'stack' }, tabs, host, colorRow, saveRow),
    buttons: [
      { label: 'Cancel', value: null },
      {
        label: saveOnly ? 'Save to library' : isInit ? 'Use initials' : 'Use signature', kind: 'primary', value: true,
        validate: async () => {
          if (tab === 'saved') { if (!pickedSaved) return `Pick a saved ${label}, or create one in another tab.`; result = pickedSaved; return null; }
          if (tab === 'type') {
            const t = nameInput.value.trim();
            if (!t) return isInit ? 'Type your initials.' : 'Type your name.';
            await document.fonts.load(`40px "${chosenFont}"`);
            settingsSet(isInit ? 'initials' : 'author', t);
            settingsSet('sigFont', chosenFont);
            result = typedSignature(t, chosenFont, color);
          } else if (tab === 'draw') {
            if (pad.isEmpty()) return `Draw your ${label} first.`;
            result = pad.export();
          } else {
            if (!upload) return 'Choose an image of your signature.';
            result = await imageToSignature(upload, removeBg.checked);
          }
          if (!result) return `That ${label} came out empty. Try again.`;
          if (isInit) { const k = 36 / result.h; result = { ...result, w: result.w * k, h: 36 }; }
          if (remember.checked || saveOnly) {
            const typedName = tab === 'type' ? nameInput.value.trim() : '';
            await Library.add({ kind, name: saveName.value.trim() || Library.nextName(kind, typedName || undefined), src: result.src, w: result.w, h: result.h });
          }
          return null;
        },
      },
    ],
  });
  return ok ? { src: result.src, w: result.w, h: result.h } : null;
}

// ---------- stamps ----------
const STAMPS = [
  ['APPROVED', '#1f7a4d'], ['REVIEWED', '#1f4fd1'], ['RECEIVED', '#1f4fd1'], ['PAID', '#1f7a4d'],
  ['DRAFT', '#5b6472'], ['FINAL', '#1f7a4d'], ['CONFIDENTIAL', '#b42318'], ['NOT APPROVED', '#b42318'],
  ['VOID', '#b42318'], ['COPY', '#5b6472'], ['URGENT', '#c2410c'], ['COMPLETED', '#0b6e5c'],
];
async function stampDialog() {
  if (!(await Library.load())) return null;
  let pick = STAMPS[0];
  let pickSaved = null;
  const saveIt = el('input', { type: 'checkbox', id: 'stampSaveLib' });
  const savedGrid = el('div', { class: 'stamp-grid' });
  const custom = textInput('', { placeholder: 'Or type your own stamp text', maxlength: 40 });
  const withSub = el('input', { type: 'checkbox', checked: settingsGet('stampSub', true) });
  const nameInput = textInput(settingsGet('author', ''), { placeholder: 'Your name (optional)' });
  const grid = el('div', { class: 'stamp-grid' });
  const render = () => {
    grid.innerHTML = '';
    for (const s of STAMPS) {
      grid.append(el('button', { class: 'stamp-choice' + (s === pick && !pickSaved && !custom.value ? ' on' : ''), style: { color: s[1], borderColor: s[1] }, onclick: () => { pick = s; pickSaved = null; custom.value = ''; render(); } }, s[0]));
    }
    savedGrid.innerHTML = '';
    for (const it of Library.of('stamp')) {
      savedGrid.append(el('button', { class: 'stamp-choice stamp-saved' + (pickSaved === it ? ' on' : ''), style: { color: it.spec.color, borderColor: it.spec.color }, title: it.name, onclick: () => { pickSaved = it; custom.value = ''; render(); } }, it.spec.text, el('small', {}, it.name)));
    }
  };
  custom.addEventListener('input', render);
  render();
  const res = await dialog({
    title: 'Choose a stamp',
    width: 560,
    content: el('div', { class: 'stack' },
      Library.of('stamp').length ? el('div', { class: 'stack tight' }, el('span', { class: 'fld-label' }, 'My saved stamps'), savedGrid) : null,
      el('span', { class: 'fld-label' }, 'Standard stamps'), grid, field('Custom', custom),
      el('label', { class: 'check' }, withSub, 'Add name and date under the stamp'), field('Name', nameInput),
      el('label', { class: 'check' }, saveIt, 'Save this stamp to my library')),
    buttons: [{ label: 'Cancel', value: null }, { label: 'Place stamp', kind: 'primary', value: true }],
  });
  if (!res) return null;
  if (pickSaved && !custom.value.trim()) return stampGeometry(pickSaved.spec);
  settingsSet('stampSub', withSub.checked);
  if (nameInput.value.trim()) settingsSet('author', nameInput.value.trim());
  const text = (custom.value.trim() || pick[0]).toUpperCase();
  const color = custom.value.trim() ? Annotations.props.stamp.color : pick[1];
  const sub = withSub.checked ? [nameInput.value.trim(), todayString()].filter(Boolean).join(' · ') : '';
  if (saveIt.checked) {
    await Library.add({ kind: 'stamp', name: Library.nextName('stamp', text.charAt(0) + text.slice(1).toLowerCase()), spec: { text, color, includeName: withSub.checked && !!nameInput.value.trim(), name: nameInput.value.trim(), includeDate: withSub.checked } });
    toast('Stamp saved to your library', 'ok');
  }
  _measureCanvas.font = `700 100px ${FONT_CSS.Helvetica}`;
  const h = sub ? 52 : 40;
  const w = Math.max(110, (_measureCanvas.measureText(text).width / 100) * (sub ? 22 : 22) + 34);
  return { text, sub, color, w, h };
}

// ---------- page tools ----------
function rangeInput(value = 'all') {
  return textInput(value, { placeholder: 'e.g. all, 1-3, 5, 8-' });
}
function colorInput(value) { return el('input', { type: 'color', class: 'inp-color', value }); }

async function watermarkDialog(doc) {
  const text = textInput(settingsGet('wmText', 'CONFIDENTIAL'), { autofocus: true });
  const size = el('input', { type: 'number', class: 'inp', value: 60, min: 8, max: 300 });
  const color = colorInput('#b42318');
  const opacity = el('input', { type: 'range', min: 0.05, max: 1, step: 0.05, value: 0.18 });
  const angle = el('select', { class: 'inp' }, ...[[45, 'Diagonal ↗'], [0, 'Horizontal'], [-45, 'Diagonal ↘'], [90, 'Vertical']].map(([v, l]) => el('option', { value: v }, l)));
  const bold = el('input', { type: 'checkbox', checked: true });
  const range = rangeInput();
  const res = await dialog({
    title: 'Add watermark',
    content: el('div', { class: 'grid2' },
      field('Text', text), field('Pages', range),
      field('Size (pt)', size), field('Direction', angle),
      field('Color', color), field('Opacity', opacity),
      el('label', { class: 'check' }, bold, 'Bold')),
    buttons: [{ label: 'Cancel', value: null }, {
      label: 'Add watermark', kind: 'primary', value: true,
      validate: () => { if (!text.value.trim()) return 'Enter the watermark text.'; parseRange(range.value, doc.pageCount); return null; },
    }],
  });
  if (!res) return null;
  settingsSet('wmText', text.value);
  return { text: text.value.trim(), size: +size.value || 60, color: color.value, opacity: +opacity.value, angle: +angle.value, bold: bold.checked, pages: parseRange(range.value, doc.pageCount) };
}

async function headerFooterDialog(doc) {
  const format = textInput(settingsGet('hfFormat', 'Page {n} of {total}'), { autofocus: true });
  const position = el('select', { class: 'inp' }, ...['bottom-center', 'bottom-right', 'bottom-left', 'top-center', 'top-right', 'top-left'].map((p) => el('option', { value: p }, p.replace('-', ' '))));
  const size = el('input', { type: 'number', class: 'inp', value: 10, min: 5, max: 48 });
  const margin = el('input', { type: 'number', class: 'inp', value: 24, min: 4, max: 144 });
  const start = el('input', { type: 'number', class: 'inp', value: 1, min: 0 });
  const color = colorInput('#333333');
  const range = rangeInput();
  const res = await dialog({
    title: 'Page numbers, header & footer',
    content: el('div', { class: 'stack' },
      field('Text', format, 'Use {n} for the page number, {total} for the page count, {date} for today and {file} for the file name.'),
      el('div', { class: 'grid2' }, field('Position', position), field('Pages', range), field('Size (pt)', size), field('Margin (pt)', margin), field('Start numbering at', start), field('Color', color))),
    buttons: [{ label: 'Cancel', value: null }, {
      label: 'Apply', kind: 'primary', value: true,
      validate: () => { if (!format.value.trim()) return 'Enter the text to add.'; parseRange(range.value, doc.pageCount); return null; },
    }],
  });
  if (!res) return null;
  settingsSet('hfFormat', format.value);
  return { format: format.value, position: position.value, size: +size.value || 10, margin: +margin.value || 24, start: +start.value || 0, color: color.value, pages: parseRange(range.value, doc.pageCount), countAll: false };
}

async function metadataDialog(doc) {
  const info = (await doc.pdf.getMetadata().catch(() => ({ info: {} }))).info || {};
  const m = { ...(info || {}), ...(doc.meta && !doc.meta.strip ? doc.meta : {}) };
  const title = textInput(m.title ?? m.Title ?? '');
  const author = textInput(m.author ?? m.Author ?? '');
  const subject = textInput(m.subject ?? m.Subject ?? '');
  const keywords = textInput(m.keywords ?? m.Keywords ?? '');
  const res = await dialog({
    title: 'Document info',
    content: el('div', { class: 'stack' }, field('Title', title), field('Author', author), field('Subject', subject), field('Keywords', keywords, 'Separate keywords with commas.')),
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save info', kind: 'primary', value: true }],
  });
  if (!res) return null;
  return { title: title.value, author: author.value, subject: subject.value, keywords: keywords.value };
}

async function protectDialog(doc) {
  const p = doc.protect || {};
  const user = el('input', { type: 'password', class: 'inp', value: p.userPassword || '', autocomplete: 'new-password', placeholder: 'Leave empty to allow opening without a password' });
  const user2 = el('input', { type: 'password', class: 'inp', value: p.userPassword || '', autocomplete: 'new-password' });
  const owner = el('input', { type: 'password', class: 'inp', value: p.ownerPassword && p.ownerPassword !== p.userPassword ? p.ownerPassword : '', autocomplete: 'new-password', placeholder: 'Needed to change restrictions' });
  const perms = p.permissions || {};
  const cb = (key, label, on = true) => { const c = el('input', { type: 'checkbox', checked: perms[key] === undefined ? on : !!perms[key] }); c.dataset.key = key; return el('label', { class: 'check' }, c, label); };
  const permBox = el('div', { class: 'stack tight' },
    cb('printing', 'Allow printing'), cb('modifying', 'Allow changes'), cb('copying', 'Allow copying text and images'),
    cb('annotating', 'Allow comments'), cb('fillingForms', 'Allow form filling'), cb('documentAssembly', 'Allow page assembly'));
  const res = await dialog({
    title: 'Protect with password',
    width: 520,
    content: el('div', { class: 'stack' },
      el('p', { class: 'dlg-text' }, 'The file is encrypted with AES-256 when you save it.'),
      field('Password to open', user), field('Confirm password', user2),
      field('Permissions password', owner),
      el('div', { class: 'fld' }, el('span', { class: 'fld-label' }, 'What others may do'), permBox)),
    buttons: [
      ...(doc.protect ? [{ label: 'Remove protection', value: 'remove', kind: 'ghost' }] : []),
      { label: 'Cancel', value: null },
      {
        label: 'Protect', kind: 'primary', value: 'ok',
        validate: () => {
          if (user.value !== user2.value) return 'The passwords do not match.';
          if (!user.value && !owner.value) return 'Enter a password to open, a permissions password, or both.';
          return null;
        },
      }],
  });
  if (res === 'remove') return { remove: true };
  if (res !== 'ok') return null;
  const permissions = {};
  $$('input[type=checkbox]', permBox).forEach((c) => { permissions[c.dataset.key] = c.checked; });
  if (permissions.printing) permissions.printing = 'highResolution';
  return { userPassword: user.value, ownerPassword: owner.value || user.value, permissions };
}

async function rangeDialog(title, doc, okLabel, hint) {
  const range = rangeInput(Viewer.current + 1 + '');
  const res = await dialog({
    title,
    content: el('div', { class: 'stack' }, field('Pages', range, hint || `This document has ${doc.pageCount} pages.`)),
    buttons: [{ label: 'Cancel', value: null }, {
      label: okLabel, kind: 'primary', value: true,
      validate: () => { const r = parseRange(range.value, doc.pageCount); return r.length ? null : 'Choose at least one page.'; },
    }],
  });
  return res ? parseRange(range.value, doc.pageCount) : null;
}

async function splitDialog(doc) {
  const mode = el('select', { class: 'inp' }, el('option', { value: 'every' }, 'Every N pages'), el('option', { value: 'ranges' }, 'Custom ranges'));
  const every = el('input', { type: 'number', class: 'inp', value: 1, min: 1, max: doc.pageCount });
  const ranges = textInput('', { placeholder: 'e.g. 1-3; 4-6; 7-' });
  const rangesField = field('Ranges', ranges, 'Each range separated by ; becomes its own file.');
  const everyField = field('Pages per file', every);
  rangesField.hidden = true;
  mode.addEventListener('change', () => { rangesField.hidden = mode.value !== 'ranges'; everyField.hidden = mode.value === 'ranges'; });
  const res = await dialog({
    title: 'Split document',
    content: el('div', { class: 'stack' }, field('Split', mode), everyField, rangesField),
    buttons: [{ label: 'Cancel', value: null }, {
      label: 'Split', kind: 'primary', value: true,
      validate: () => {
        if (mode.value === 'ranges') {
          const parts = ranges.value.split(';').map((s) => s.trim()).filter(Boolean);
          if (!parts.length) return 'Enter at least one range.';
          parts.forEach((p) => { if (!parseRange(p, doc.pageCount).length) throw new Error(`"${p}" has no pages.`); });
        }
        return null;
      },
    }],
  });
  if (!res) return null;
  if (mode.value === 'ranges') return ranges.value.split(';').map((s) => s.trim()).filter(Boolean).map((p) => parseRange(p, doc.pageCount));
  const n = Math.max(1, +every.value || 1);
  const out = [];
  for (let i = 0; i < doc.pageCount; i += n) out.push(Array.from({ length: Math.min(n, doc.pageCount - i) }, (_, k) => i + k));
  return out;
}

async function exportImagesDialog(doc) {
  const format = el('select', { class: 'inp' }, el('option', { value: 'png' }, 'PNG'), el('option', { value: 'jpeg' }, 'JPEG'));
  const dpi = el('select', { class: 'inp' }, ...[72, 96, 150, 200, 300].map((d) => el('option', { value: d, selected: d === 150 }, d + ' dpi')));
  const range = rangeInput('all');
  const res = await dialog({
    title: 'Export pages as images',
    content: el('div', { class: 'grid2' }, field('Format', format), field('Resolution', dpi), field('Pages', range)),
    buttons: [{ label: 'Cancel', value: null }, { label: 'Export', kind: 'primary', value: true, validate: () => { parseRange(range.value, doc.pageCount); return null; } }],
  });
  return res ? { format: format.value, dpi: +dpi.value, pages: parseRange(range.value, doc.pageCount) } : null;
}

// ---------- compress ----------
async function compressDialog(doc) {
  let level = settingsGet('compressLevel', 'medium');
  if (!COMPRESS_LEVELS[level]) level = 'medium';
  const options = Object.entries(COMPRESS_LEVELS).map(([key, l]) => {
    const radio = el('input', { type: 'radio', name: 'compressLevel', value: key, class: 'field-radio', checked: key === level });
    radio.addEventListener('change', () => { level = key; });
    return el('label', { class: 'compress-opt' }, radio,
      el('span', { class: 'compress-opt-text' }, el('strong', {}, l.label), el('span', { class: 'muted' }, `${l.note} (${l.dpi} dpi images)`)));
  });
  const res = await dialog({
    title: 'Compress PDF',
    width: 500,
    content: el('div', { class: 'stack' },
      el('p', { class: 'dlg-text' }, `This document is ${fmtBytes(doc.bytes.length)}. Images are made smaller; text stays sharp and selectable. Your original file is not changed: you save a compressed copy.`),
      el('div', { class: 'compress-opts', role: 'radiogroup', 'aria-label': 'Compression level' }, ...options)),
    buttons: [{ label: 'Cancel', value: null }, { label: 'Compress', kind: 'primary', value: true }],
  });
  if (!res) return null;
  settingsSet('compressLevel', level);
  return level;
}

async function compressResultDialog(before, after, images) {
  const saving = before > 0 ? Math.round((1 - after / before) * 100) : 0;
  const good = saving >= 5;
  return dialog({
    title: good ? 'Compressed' : 'Already compact',
    width: 460,
    content: el('div', { class: 'stack' },
      el('div', { class: 'compress-result' },
        el('span', { class: 'compress-size muted' }, fmtBytes(before)),
        icon('arrowRight', 18),
        el('strong', { class: 'compress-size' }, fmtBytes(after)),
        good ? el('span', { class: 'compress-badge' }, `${saving}% smaller`) : null),
      el('p', { class: 'dlg-text' }, good
        ? `${images ? `${images} image${images === 1 ? ' was' : 's were'} optimized and the` : 'The'} file structure was packed more tightly.`
        : 'This PDF has little left to shrink, usually because it is mostly text or its images are already compressed. You can still save the copy.')),
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save compressed copy', kind: 'primary', value: true }],
  });
}

async function cropDialog(i) {
  return dialog({
    title: 'Crop pages',
    content: el('p', { class: 'dlg-text' }, 'Apply this crop to the current page only, or to every page in the document?'),
    buttons: [{ label: 'Cancel', value: null }, { label: 'All pages', value: 'all' }, { label: `Page ${i + 1}`, value: 'one', kind: 'primary' }],
  });
}

// ---------- digital IDs ----------
async function createIdDialog() {
  const name = textInput(settingsGet('author', ''), { autofocus: true });
  const email = el('input', { type: 'email', class: 'inp' });
  const org = textInput('');
  const pw = el('input', { type: 'password', class: 'inp', autocomplete: 'new-password' });
  const pw2 = el('input', { type: 'password', class: 'inp', autocomplete: 'new-password' });
  let created = null;
  const ok = await dialog({
    title: 'Create a digital ID',
    width: 520,
    content: el('div', { class: 'stack' },
      el('p', { class: 'dlg-text' }, 'A digital ID is a certificate plus a private key, stored only on this computer and protected by your password. It is self-signed, so readers show your name and that the document has not changed since you signed it.'),
      field('Name', name), el('div', { class: 'grid2' }, field('Email', email), field('Organization', org)),
      el('div', { class: 'grid2' }, field('Password', pw), field('Confirm', pw2))),
    buttons: [{ label: 'Cancel', value: null }, {
      label: 'Create ID', kind: 'primary', value: true,
      validate: async () => {
        if (!name.value.trim()) return 'Enter your name.';
        if (pw.value.length < 4) return 'Use a password of at least 4 characters.';
        if (pw.value !== pw2.value) return 'The passwords do not match.';
        created = await busy('Creating your digital ID…', () => Host.idsCreate({ name: name.value.trim(), email: email.value.trim(), org: org.value.trim(), password: pw.value }));
        return null;
      },
    }],
  });
  return ok ? created : null;
}

async function digitalSignDialog() {
  let ids = await Host.idsList();
  let chosen = ids[0]?.id || null;
  const list = el('div', { class: 'id-list', role: 'radiogroup', 'aria-label': 'Digital IDs' });
  const render = () => {
    list.innerHTML = '';
    if (!ids.length) list.append(el('p', { class: 'muted' }, 'You have no digital IDs yet. Create one, or import a .pfx/.p12 file from your organization.'));
    for (const id of ids) {
      const row = el('label', { class: 'id-row' + (id.id === chosen ? ' on' : '') },
        el('input', { type: 'radio', name: 'digid', checked: id.id === chosen, onchange: () => { chosen = id.id; render(); } }),
        el('span', { class: 'id-main' }, el('strong', {}, id.name), el('span', { class: 'muted' }, [id.email, id.org].filter(Boolean).join(' · ') || (id.selfSigned ? 'Self-signed' : `Issued by ${id.issuer}`))),
        el('span', { class: 'muted small' }, 'Valid to ' + new Date(id.notAfter).toLocaleDateString()),
        el('button', { class: 'icon-btn', title: 'Export .pfx', 'aria-label': 'Export', onclick: (e) => { e.preventDefault(); Host.idsExport(id.id); } }, icon('download', 16)),
        el('button', { class: 'icon-btn', title: 'Delete', 'aria-label': 'Delete', onclick: async (e) => { e.preventDefault(); if (await confirmDialog('Delete digital ID', `Delete the digital ID for ${id.name}? Documents already signed stay valid.`, 'Delete', 'danger')) { await Host.idsDelete(id.id); ids = await Host.idsList(); if (chosen === id.id) chosen = ids[0]?.id || null; render(); } } }, icon('trash', 16)));
      list.append(row);
    }
  };
  render();
  const importPw = el('input', { type: 'password', class: 'inp', placeholder: 'Password of the .pfx file' });
  const pw = el('input', { type: 'password', class: 'inp', placeholder: 'Password of the selected ID', id: 'idPassword' });
  const reason = textInput('I approve this document');
  const location = textInput('');
  const visible = el('input', { type: 'checkbox', checked: true });
  const ok = await dialog({
    title: 'Sign with a digital ID',
    width: 600,
    content: el('div', { class: 'stack' },
      list,
      el('div', { class: 'row' },
        el('button', { class: 'btn btn-ghost', onclick: async () => { const c = await createIdDialog(); if (c) { ids = await Host.idsList(); chosen = c.id; render(); } } }, icon('plus', 16), 'Create new ID'),
        el('span', { class: 'row' }, importPw, el('button', { class: 'btn btn-ghost', onclick: async () => {
          try { const c = await Host.idsImport({ password: importPw.value }); if (c) { ids = await Host.idsList(); chosen = c.id; render(); toast('Digital ID imported', 'ok'); } } catch (e) { toast(e.message, 'error', 5000); }
        } }, 'Import .pfx'))),
      el('hr'),
      el('div', { class: 'grid2' }, field('ID password', pw), field('Reason', reason), field('Location', location, 'Optional, e.g. your city.')),
      el('label', { class: 'check' }, visible, 'Show a visible signature box on the page'),
      el('p', { class: 'fld-hint' }, 'Signing is the final step: you choose where to save the signed copy. Any later change to that file breaks the signature.')),
    buttons: [{ label: 'Cancel', value: null }, {
      label: 'Continue', kind: 'primary', value: true,
      validate: () => { if (!chosen) return 'Create or import a digital ID first.'; if (!pw.value) return 'Enter the password for your digital ID.'; return null; },
    }],
  });
  if (!ok) return null;
  return { id: ids.find((x) => x.id === chosen), password: pw.value, reason: reason.value, location: location.value, visible: visible.checked };
}

async function propertiesDialog(doc) {
  const meta = await doc.pdf.getMetadata().catch(() => ({ info: {} }));
  const info = meta.info || {};
  const s = doc.sizes[Viewer.current] || doc.sizes[0];
  const pdfDate = (d) => { const x = d && pdfjsLib.PDFDateString.toDateObject(d); return x ? x.toLocaleString() : '—'; };
  const rows = [
    ['File', doc.name], ['Location', doc.path || '—'], ['File size', fmtBytes(doc.bytes.length)], ['Pages', doc.pageCount],
    ['Page size', `${(s.w / 72 * 25.4).toFixed(0)} × ${(s.h / 72 * 25.4).toFixed(0)} mm (${(s.w / 72).toFixed(2)} × ${(s.h / 72).toFixed(2)} in)`],
    ['Title', info.Title || '—'], ['Author', info.Author || '—'], ['Subject', info.Subject || '—'], ['Keywords', info.Keywords || '—'],
    ['Created', pdfDate(info.CreationDate)], ['Modified', pdfDate(info.ModDate)], ['Application', info.Creator || '—'], ['PDF producer', info.Producer || '—'],
    ['PDF version', info.PDFFormatVersion || '—'], ['Fast web view', info.IsLinearized ? 'Yes' : 'No'], ['Has form fields', doc.hasForm ? 'Yes' : 'No'],
    ['Digitally signed', doc.hasSignatures ? 'Yes' : 'No'], ['Opened with password', doc.openPassword ? 'Yes' : 'No'],
  ];
  await dialog({
    title: 'Document properties',
    width: 560,
    content: el('table', { class: 'props-table' }, el('tbody', {}, ...rows.map(([k, v]) => el('tr', {}, el('th', {}, k), el('td', {}, String(v)))))),
    buttons: [{ label: 'Close', value: true, kind: 'primary' }],
  });
}

const SHORTCUTS = [
  ['Open', 'Ctrl+O'], ['Save', 'Ctrl+S'], ['Save as', 'Ctrl+Shift+S'], ['Print', 'Ctrl+P'], ['Find', 'Ctrl+F'],
  ['Undo / Redo', 'Ctrl+Z / Ctrl+Y'], ['Zoom in / out', 'Ctrl + = / Ctrl + −'], ['Fit page / width', 'Ctrl+1 / Ctrl+2'],
  ['Next / previous page', 'Page Down / Page Up'], ['First / last page', 'Home / End'],
  ['Select tool', 'V'], ['Hand tool', 'H'], ['Add text', 'T'], ['Edit text', 'E'], ['Highlight', 'U'], ['Draw', 'P'],
  ['Sticky note', 'N'], ['Rectangle', 'R'], ['Sign', 'S'], ['Delete selected item', 'Delete'], ['Duplicate item', 'Ctrl+D'],
  ['Nudge item', 'Arrow keys (Shift = 10pt)'], ['Cancel / deselect', 'Esc'], ['Sidebar', 'F4'], ['Presentation', 'Ctrl+L'],
];
async function shortcutsDialog() {
  await dialog({
    title: 'Keyboard shortcuts',
    width: 560,
    content: el('table', { class: 'props-table' }, el('tbody', {}, ...SHORTCUTS.map(([k, v]) => el('tr', {}, el('th', {}, k), el('td', {}, el('kbd', {}, v)))))),
    buttons: [{ label: 'Close', value: true, kind: 'primary' }],
  });
}

async function aboutDialog() {
  const info = await Host.appInfo();
  await dialog({
    title: 'About',
    width: 440,
    className: 'dlg-welcome',
    content: el('div', { class: 'welcome-hero' },
      el('img', { src: '../build/icon.png', alt: '', class: 'welcome-icon' }),
      el('h3', {}, 'Sahifa PDF'),
      el('p', { class: 'muted' }, `Version ${info.version}`),
      el('div', { class: 'about-company' }, el('img', { src: 'assets/mv-digital-tools.svg', alt: '' }), el('span', {}, 'A product of ', el('strong', {}, 'MV Digital Tools'))),
      el('p', {}, 'A free PDF reader and editor that works completely offline. No accounts, no subscriptions, no tracking.'),
      el('p', { class: 'fld-hint' }, '© 2026 MV Digital Tools. Built with Electron, Mozilla pdf.js, pdf-lib, node-forge and @signpdf.')),
    buttons: [{ label: 'Close', value: true, kind: 'primary' }],
  });
}
