'use strict';
/* "My signatures & seals": a saved library of signatures, initials, company seals
   and text stamps, a seal designer, a quick picker and a manager window. */

const LIB_KINDS = {
  signature: { label: 'Signature', plural: 'Signatures' },
  initials: { label: 'Initials', plural: 'Initials' },
  seal: { label: 'Seal', plural: 'Seals' },
  stamp: { label: 'Stamp', plural: 'Stamps' },
};

const Library = {
  items: [],
  loaded: false,
  status: null,
  /** Makes the library available, asking for the PIN if it is locked. Resolves to false if the user cancels. */
  async load({ interactive = true } = {}) {
    this.status = await Host.libraryStatus().catch(() => ({ protection: 'none', locked: false }));
    if (this.status.error) { toast(this.status.error, 'error', 6000); return false; }
    if (this.status.locked) {
      this.items = [];
      this.loaded = false;
      if (!interactive || !(await unlockDialog())) return false;
      this.status = await Host.libraryStatus();
    }
    if (!this.loaded) {
      try { this.items = (await Host.libraryGet()) || []; } catch (e) {
        if (/LOCKED/.test(e.message)) { this.loaded = false; return interactive ? this.load() : false; }
        toast(cleanIpcError(e).replace(/^[A-Z_]+: /, ''), 'error', 6000);
        return false;
      }
      this.loaded = true;
      // Signatures saved by earlier versions lived in browser storage.
      const legacy = settingsGet('signatures', []);
      if (legacy.length) {
        let n = 0;
        for (const s of legacy) {
          if (this.items.some((x) => x.src === s.src)) continue;
          this.items.push({ id: uid('L'), kind: s.kind || 'signature', name: `${LIB_KINDS[s.kind || 'signature'].label} ${++n}`, src: s.src, w: s.w, h: s.h, created: Date.now() });
        }
        settingsSet('signatures', []);
        this.ensureDefaults();
        await this.save();
      }
    }
    return true;
  },
  /** Called when the main process locks the library: forget everything decrypted. */
  forget() {
    this.items = [];
    this.loaded = false;
    if (this.status) this.status.locked = this.status.protection === 'pin';
  },
  get pinOn() { return !!this.status && this.status.protection === 'pin'; },
  of(...kinds) { return this.items.filter((x) => kinds.includes(x.kind)); },
  get(id) { return this.items.find((x) => x.id === id); },
  defaultOf(kind) { return this.items.find((x) => x.kind === kind && x.isDefault) || this.of(kind)[0] || null; },
  ensureDefaults() {
    for (const kind of Object.keys(LIB_KINDS)) {
      const list = this.of(kind);
      if (list.length && !list.some((x) => x.isDefault)) list[0].isDefault = true;
    }
  },
  nextName(kind, base) {
    const label = base || LIB_KINDS[kind].label;
    const names = new Set(this.of(kind).map((x) => x.name));
    if (!names.has(label)) return label;
    let n = 2;
    while (names.has(`${label} ${n}`)) n++;
    return `${label} ${n}`;
  },
  async add(item) {
    if (!(await this.load())) throw new Error('The library is locked.');
    const dup = item.src && this.items.find((x) => x.kind === item.kind && x.src === item.src);
    if (dup) return dup;
    const it = { id: uid('L'), created: Date.now(), ...item };
    it.name = (it.name || '').trim() || this.nextName(it.kind);
    if (!this.of(it.kind).length) it.isDefault = true;
    this.items.unshift(it);
    await this.save();
    document.dispatchEvent(new CustomEvent('library-changed'));
    return it;
  },
  async update(id, patch) {
    const it = this.get(id);
    if (!it) return;
    Object.assign(it, patch);
    await this.save();
    document.dispatchEvent(new CustomEvent('library-changed'));
  },
  async remove(id) {
    this.items = this.items.filter((x) => x.id !== id);
    this.ensureDefaults();
    await this.save();
    document.dispatchEvent(new CustomEvent('library-changed'));
  },
  async setDefault(id) {
    const it = this.get(id);
    if (!it) return;
    for (const x of this.of(it.kind)) x.isDefault = x === it;
    await this.save();
    document.dispatchEvent(new CustomEvent('library-changed'));
  },
  async save() {
    try { await Host.librarySet(this.items); } catch (e) {
      if (/LOCKED/.test(e.message) && (await this.relock())) { await Host.librarySet(this.items); return; }
      toast('Could not save your library: ' + cleanIpcError(e).replace(/^[A-Z_]+: /, ''), 'error');
    }
  },
  /** The library locked itself while a window was open: unlock again, keeping pending changes. */
  async relock() {
    const pending = this.items;
    if (!(await unlockDialog())) return false;
    this.status = await Host.libraryStatus();
    this.items = pending;
    this.loaded = true;
    return true;
  },
  async importItems(list) {
    let added = 0;
    for (const raw of list) {
      if (!raw || !LIB_KINDS[raw.kind]) continue;
      if (raw.kind !== 'stamp' && (typeof raw.src !== 'string' || !raw.src.startsWith('data:image/'))) continue;
      const same = this.items.find((x) => x.kind === raw.kind && (raw.src ? x.src === raw.src : JSON.stringify(x.spec) === JSON.stringify(raw.spec)));
      if (same) continue;
      this.items.push({ ...raw, id: uid('L'), isDefault: false });
      added++;
    }
    this.ensureDefaults();
    await this.save();
    document.dispatchEvent(new CustomEvent('library-changed'));
    return added;
  },
};

// ---------- seal rendering ----------
const SEAL_COLORS = [['#1d3fae', 'Blue'], ['#b42318', 'Red'], ['#0b6e5c', 'Green'], ['#6d28d9', 'Purple'], ['#111827', 'Black']];

function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

function drawStar(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
  }
  ctx.closePath();
  ctx.fill();
}

/** Fits a font size so `text` is at most `maxW` wide. */
function fitFont(ctx, text, weight, maxSize, maxW, family = "Arial, 'Liberation Sans', sans-serif") {
  let size = maxSize;
  ctx.font = `${weight} ${size}px ${family}`;
  const w = ctx.measureText(text).width;
  if (w > maxW) size = Math.max(10, (size * maxW) / w);
  ctx.font = `${weight} ${size}px ${family}`;
  return size;
}

/** Text along a circle. top=true reads clockwise over the top, false reads left to right along the bottom. */
function arcText(ctx, text, cx, cy, radius, size, top) {
  ctx.font = `700 ${size}px Arial, 'Liberation Sans', sans-serif`;
  const spacing = size * 0.08;
  const widths = [...text].map((ch) => ctx.measureText(ch).width + spacing);
  const total = widths.reduce((a, b) => a + b, 0) - spacing;
  let angle = top ? -Math.PI / 2 - total / radius / 2 : Math.PI / 2 + total / radius / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  [...text].forEach((ch, i) => {
    const step = widths[i] / radius;
    const a = top ? angle + step / 2 : angle - step / 2;
    ctx.save();
    ctx.translate(cx + radius * Math.cos(a), cy + radius * Math.sin(a));
    ctx.rotate(top ? a + Math.PI / 2 : a - Math.PI / 2);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    angle = top ? angle + step : angle - step;
  });
  return total / radius;
}

function sealCenterLine2(spec) {
  if (spec.line2Mode === 'date') return new Date().toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  if (spec.line2Mode === 'text') return spec.line2 || '';
  return '';
}

/** Renders a designed seal to a transparent PNG. Returns {src, w, h} with w/h in points. */
function renderSeal(spec) {
  const round = spec.shape !== 'rect';
  const W = round ? 640 : 820;
  const H = round ? 640 : 460;
  const c = el('canvas', { width: W, height: H });
  const ctx = c.getContext('2d');
  ctx.fillStyle = ctx.strokeStyle = spec.color || '#1d3fae';
  const top = (spec.top || '').toUpperCase();
  const bottom = (spec.bottom || '').toUpperCase();
  const center = spec.center || '';
  const line2 = sealCenterLine2(spec);

  if (round) {
    const cx = W / 2, cy = H / 2, R = W / 2 - 10;
    ctx.lineWidth = 14;
    ctx.beginPath(); ctx.arc(cx, cy, R - 7, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy, R - 30, 0, Math.PI * 2); ctx.stroke();
    const inner = R * 0.6;
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy, inner, 0, Math.PI * 2); ctx.stroke();
    const band = R - 30 - inner; // ring for the curved text
    let size = band * 0.62;
    const maxSpan = (bottom ? 0.88 : 1.6) * Math.PI;
    // Shrink the ring text until it fits its half of the circle.
    for (let i = 0; i < 20; i++) {
      ctx.font = `700 ${size}px Arial, sans-serif`;
      const span = Math.max(...[top, bottom].map((t) => [...t].reduce((a, ch) => a + ctx.measureText(ch).width + size * 0.08, 0) / (inner + band / 2)));
      if (span <= maxSpan) break;
      size *= 0.92;
    }
    const capH = size * 0.72;
    const mid = inner + band / 2;
    if (top) arcText(ctx, top, cx, cy, mid - capH / 2, size, true);
    if (bottom) arcText(ctx, bottom, cx, cy, mid + capH / 2, size, false);
    if (spec.stars !== false && top && bottom) { drawStar(ctx, cx - mid, cy, band * 0.2); drawStar(ctx, cx + mid, cy, band * 0.2); }
    // Center text inside the inner circle.
    const maxW = inner * 1.62;
    ctx.textAlign = 'center';
    if (center && line2) {
      const s1 = fitFont(ctx, center, 800, inner * 0.36, maxW);
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(center, cx, cy - inner * 0.06);
      ctx.fillRect(cx - inner * 0.62, cy + inner * 0.04, inner * 1.24, 4);
      fitFont(ctx, line2, 700, inner * 0.2, maxW * 0.92);
      ctx.textBaseline = 'top';
      ctx.fillText(line2, cx, cy + inner * 0.14);
      void s1;
    } else if (center || line2) {
      const t = center || line2;
      fitFont(ctx, t, 800, inner * 0.4, maxW);
      ctx.textBaseline = 'middle';
      ctx.fillText(t, cx, cy + 2);
    }
  } else {
    ctx.lineWidth = 12;
    const r = 22;
    const rr = (x, y, w, h, rad) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, rad); ctx.stroke(); };
    rr(8, 8, W - 16, H - 16, r);
    ctx.lineWidth = 4;
    rr(30, 30, W - 60, H - 60, r * 0.6);
    ctx.textAlign = 'center';
    const maxW = W - 120;
    let y = 64;
    if (top) { fitFont(ctx, top, 800, 46, maxW); ctx.textBaseline = 'top'; ctx.fillText(top, W / 2, y); y += 66; }
    ctx.fillRect(70, y, W - 140, 4);
    const bottomH = bottom ? 64 : 0;
    const midTop = y + 10, midBottom = H - 64 - bottomH;
    if (center && line2) {
      fitFont(ctx, center, 800, 96, maxW);
      ctx.textBaseline = 'middle';
      ctx.fillText(center, W / 2, midTop + (midBottom - midTop) * 0.4);
      fitFont(ctx, line2, 700, 40, maxW);
      ctx.fillText(line2, W / 2, midTop + (midBottom - midTop) * 0.82);
    } else if (center || line2) {
      fitFont(ctx, center || line2, 800, 104, maxW);
      ctx.textBaseline = 'middle';
      ctx.fillText(center || line2, W / 2, (midTop + midBottom) / 2);
    }
    ctx.fillRect(70, H - 60 - bottomH, W - 140, 4);
    if (bottom) { fitFont(ctx, bottom, 700, 38, maxW); ctx.textBaseline = 'bottom'; ctx.fillText(bottom, W / 2, H - 52); }
  }

  if (spec.rough) {
    // Rubber-stamp texture: knock out small specks of ink in a repeatable pattern.
    const rnd = seededRandom(spec.seed || 7);
    ctx.globalCompositeOperation = 'destination-out';
    const count = Math.round((W * H) / 260);
    for (let i = 0; i < count; i++) {
      ctx.globalAlpha = 0.25 + rnd() * 0.75;
      ctx.beginPath();
      ctx.arc(rnd() * W, rnd() * H, 0.6 + rnd() * rnd() * 4.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  const size = round ? { w: 124, h: 124 } : { w: 176, h: 99 };
  return { src: c.toDataURL('image/png'), ...size };
}

// ---------- seal designer ----------
async function sealDesigner(existing = null) {
  const spec = {
    shape: 'round', top: 'MV DIGITAL TOOLS', bottom: 'MALE · MALDIVES', center: 'APPROVED',
    line2Mode: 'date', line2: '', color: SEAL_COLORS[0][0], rough: true, stars: true, seed: Math.floor(Math.random() * 1e9),
    ...(existing ? existing.spec : settingsGet('lastSeal', {})),
  };
  const preview = el('img', { class: 'seal-preview-img', alt: 'Seal preview' });
  const nameInput = textInput(existing ? existing.name : '', { placeholder: 'e.g. Company seal', id: 'sealName' });
  const inputs = {
    top: textInput(spec.top, { maxlength: 48, id: 'sealTop' }),
    bottom: textInput(spec.bottom, { maxlength: 48, id: 'sealBottom' }),
    center: textInput(spec.center, { maxlength: 30, id: 'sealCenter' }),
    line2: textInput(spec.line2, { maxlength: 30, placeholder: 'Second line', id: 'sealLine2' }),
  };
  const line2Mode = el('select', { class: 'inp', id: 'sealLine2Mode' },
    el('option', { value: 'date' }, 'Today’s date (updates when placed)'), el('option', { value: 'text' }, 'Custom text'), el('option', { value: 'none' }, 'Nothing'));
  line2Mode.value = spec.line2Mode;
  const rough = el('input', { type: 'checkbox', checked: spec.rough });
  const stars = el('input', { type: 'checkbox', checked: spec.stars !== false });
  const shapeSeg = el('div', { class: 'seg' });
  const colorRow = el('div', { class: 'ink-colors' });
  let topField, bottomField, starsLabel;
  const update = () => {
    if (starsLabel) starsLabel.hidden = spec.shape === 'rect';
    if (topField) topField.querySelector('.fld-label').textContent = spec.shape === 'rect' ? 'Top text' : 'Top text (curves around the edge)';
    if (bottomField) bottomField.querySelector('.fld-label').textContent = spec.shape === 'rect' ? 'Bottom text' : 'Bottom text (curves around the edge)';
    spec.top = inputs.top.value; spec.bottom = inputs.bottom.value; spec.center = inputs.center.value; spec.line2 = inputs.line2.value;
    spec.line2Mode = line2Mode.value; spec.rough = rough.checked; spec.stars = stars.checked;
    inputs.line2.hidden = spec.line2Mode !== 'text';
    preview.src = renderSeal(spec).src;
    shapeSeg.innerHTML = '';
    for (const [k, lab] of [['round', 'Round'], ['rect', 'Rectangle']]) {
      shapeSeg.append(el('button', { class: 'seg-btn' + (spec.shape === k ? ' on' : ''), onclick: () => { spec.shape = k; update(); } }, lab));
    }
    colorRow.innerHTML = '';
    for (const [c, n] of SEAL_COLORS) colorRow.append(el('button', { class: 'ink' + (spec.color === c ? ' on' : ''), style: { '--c': c }, title: n, 'aria-label': n, onclick: () => { spec.color = c; update(); } }));
    const custom = el('input', { type: 'color', class: 'swatch-custom', value: spec.color, title: 'Custom color' });
    custom.addEventListener('input', () => { spec.color = custom.value; preview.src = renderSeal(spec).src; });
    colorRow.append(custom);
  };
  Object.values(inputs).forEach((i) => i.addEventListener('input', update));
  [line2Mode, rough, stars].forEach((i) => i.addEventListener('change', update));
  update();

  const hasDoc = !!App.active;
  const res = await dialog({
    title: existing ? 'Edit seal' : 'Design a company seal',
    width: 820,
    className: 'dlg-seal',
    content: el('div', { class: 'seal-designer' },
      el('div', { class: 'seal-preview' }, preview, el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { spec.seed = Math.floor(Math.random() * 1e9); update(); } }, icon('refresh', 15), 'New ink texture')),
      el('div', { class: 'stack' },
        el('div', { class: 'row between' }, el('span', { class: 'fld-label' }, 'Shape'), shapeSeg),
        topField = field('Top text', inputs.top),
        bottomField = field('Bottom text', inputs.bottom),
        field('Center text', inputs.center),
        field('Center second line', line2Mode), inputs.line2,
        el('div', { class: 'row between' }, el('span', { class: 'fld-label' }, 'Ink color'), colorRow),
        el('div', { class: 'row' }, el('label', { class: 'check' }, rough, 'Rubber ink texture'), starsLabel = el('label', { class: 'check' }, stars, 'Stars between texts')),
        field('Save as', nameInput))),
    buttons: [
      { label: 'Cancel', value: null },
      { label: existing ? 'Save changes' : 'Save to library', value: 'save', kind: hasDoc ? 'ghost' : 'primary', id: 'sealSave' },
      ...(hasDoc ? [{ label: 'Save & place', value: 'place', kind: 'primary', id: 'sealPlace' }] : []),
    ],
  });
  if (!res) return null;
  settingsSet('lastSeal', { ...spec });
  const out = renderSeal(spec);
  let item;
  if (existing) {
    await Library.update(existing.id, { spec: { ...spec }, src: out.src, w: out.w, h: out.h, name: nameInput.value.trim() || existing.name });
    item = existing;
  } else {
    item = await Library.add({ kind: 'seal', name: nameInput.value.trim() || Library.nextName('seal', 'Company seal'), spec: { ...spec }, src: out.src, w: out.w, h: out.h });
  }
  toast(`Saved “${item.name}” to your library`, 'ok');
  if (res === 'place') placeLibraryItem(item);
  return item;
}

async function uploadSealImage() {
  const [f] = await Host.openDialog({ multi: false, kind: 'images', title: 'Choose a photo or scan of your seal' });
  if (!f) return null;
  const removeBg = el('input', { type: 'checkbox', checked: true });
  const preview = el('div', { class: 'sig-upload-preview' });
  const nameInput = textInput(Library.nextName('seal', 'Company seal'), { id: 'sealUploadName' });
  let result = null;
  const refresh = async () => {
    result = await imageToSignature(f.data, removeBg.checked);
    preview.innerHTML = '';
    if (result) { const k = 124 / Math.max(result.w, result.h); result = { ...result, w: result.w * k, h: result.h * k }; preview.append(el('img', { src: result.src, alt: 'Seal preview' })); }
  };
  removeBg.addEventListener('change', refresh);
  await refresh();
  const ok = await dialog({
    title: 'Add a seal from an image',
    width: 520,
    content: el('div', { class: 'stack' }, preview, el('label', { class: 'check' }, removeBg, 'Remove paper background (keeps the ink color)'), field('Save as', nameInput)),
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save to library', kind: 'primary', value: true, validate: () => (result ? null : 'This image looks empty.') }],
  });
  if (!ok) return null;
  const item = await Library.add({ kind: 'seal', name: nameInput.value, src: result.src, w: result.w, h: result.h });
  toast(`Saved “${item.name}” to your library`, 'ok');
  return item;
}

async function textStampDesigner(existing = null) {
  const spec = { text: 'RECEIVED', color: '#1d3fae', includeName: true, name: settingsGet('author', ''), includeDate: true, ...(existing ? existing.spec : {}) };
  const text = textInput(spec.text, { maxlength: 40, id: 'stampText' });
  const nm = textInput(spec.name, { placeholder: 'Name or company (optional)', id: 'stampNameLine' });
  const incName = el('input', { type: 'checkbox', checked: spec.includeName });
  const incDate = el('input', { type: 'checkbox', checked: spec.includeDate });
  const colorRow = el('div', { class: 'ink-colors' });
  const preview = el('div', { class: 'stamp-preview' });
  const saveName = textInput(existing ? existing.name : '', { placeholder: 'Defaults to the stamp text', id: 'stampSaveName' });
  const update = () => {
    spec.text = text.value.toUpperCase(); spec.name = nm.value; spec.includeName = incName.checked; spec.includeDate = incDate.checked;
    preview.innerHTML = '';
    preview.append(stampPreviewEl(spec, 1.6));
    colorRow.innerHTML = '';
    for (const [c, n] of [['#1f7a4d', 'Green'], ...SEAL_COLORS]) colorRow.append(el('button', { class: 'ink' + (spec.color === c ? ' on' : ''), style: { '--c': c }, title: n, 'aria-label': n, onclick: () => { spec.color = c; update(); } }));
  };
  [text, nm].forEach((i) => i.addEventListener('input', update));
  [incName, incDate].forEach((i) => i.addEventListener('change', update));
  update();
  const ok = await dialog({
    title: existing ? 'Edit stamp' : 'Create a text stamp',
    width: 560,
    content: el('div', { class: 'stack' }, preview, field('Stamp text', text),
      el('div', { class: 'row' }, el('label', { class: 'check' }, incName, 'Add a name line'), el('label', { class: 'check' }, incDate, 'Add today’s date')), nm,
      el('div', { class: 'row between' }, el('span', { class: 'fld-label' }, 'Color'), colorRow), field('Save as', saveName)),
    buttons: [{ label: 'Cancel', value: null }, { label: existing ? 'Save changes' : 'Save to library', kind: 'primary', value: true, validate: () => (text.value.trim() ? null : 'Type the stamp text.') }],
  });
  if (!ok) return null;
  if (nm.value.trim()) settingsSet('author', nm.value.trim());
  const name = saveName.value.trim() || spec.text;
  if (existing) { await Library.update(existing.id, { spec: { ...spec }, name }); return existing; }
  const item = await Library.add({ kind: 'stamp', name: Library.of('stamp').some((x) => x.name === name) ? Library.nextName('stamp', name) : name, spec: { ...spec } });
  toast(`Saved “${item.name}” to your library`, 'ok');
  return item;
}

function stampSub(spec) {
  return [spec.includeName ? (spec.name || '').trim() : '', spec.includeDate ? todayString() : ''].filter(Boolean).join(' · ');
}
function stampGeometry(spec) {
  const sub = stampSub(spec);
  _measureCanvas.font = `700 100px ${FONT_CSS.Helvetica}`;
  const h = sub ? 52 : 40;
  const w = Math.max(110, (_measureCanvas.measureText(spec.text).width / 100) * 22 + 34);
  return { text: spec.text, sub, color: spec.color, w, h };
}
function stampPreviewEl(spec, scale = 1) {
  const g = stampGeometry(spec);
  const box = el('div', { class: 'stamp-box', style: { color: g.color, borderColor: g.color, borderWidth: Math.max(1.5, Math.min(g.w, g.h) * 0.05) * scale + 'px', width: g.w * scale + 'px', height: g.h * scale + 'px' } },
    el('div', { class: 'stamp-main', style: { fontSize: (g.sub ? g.h * 0.36 : g.h * 0.48) * scale + 'px' } }, g.text));
  if (g.sub) box.append(el('div', { class: 'stamp-sub', style: { fontSize: g.h * 0.16 * scale + 'px' } }, g.sub));
  return box;
}

// ---------- placing ----------
function placeLibraryItem(item) {
  if (!App.active) { toast('Open a PDF first, then place it on a page.', 'error'); return; }
  if (item.kind === 'stamp') {
    setPending({ kind: 'stamp', ...stampGeometry(item.spec), hint: `Click on the page to place “${item.name}”. Press Esc to cancel.` });
    return;
  }
  let { src, w, h } = item;
  if (item.kind === 'seal' && item.spec && item.spec.line2Mode === 'date') ({ src, w, h } = renderSeal(item.spec));
  const role = item.kind === 'seal' ? 'seal' : item.kind;
  setPending({ kind: 'image', src, w, h, role, hint: `Click on the page to place “${item.name}”. Press Esc to cancel.` });
}

function libThumb(item) {
  if (item.kind === 'stamp') return el('span', { class: 'lib-thumb' }, stampPreviewEl(item.spec, 0.9));
  return el('span', { class: 'lib-thumb' }, el('img', { src: item.spec && item.spec.line2Mode === 'date' ? renderSeal(item.spec).src : item.src, alt: '' }));
}

// ---------- quick picker ----------
function closePicker() { $$('.lib-picker').forEach((p) => p._close()); }

async function openLibraryPicker({ kinds, title, anchor, create }) {
  if (!(await Library.load())) return;
  closePicker();
  const items = Library.of(...kinds);
  const pop = el('div', { class: 'lib-picker', role: 'dialog', 'aria-label': title });
  const close = () => { pop.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', esc, true); };
  pop._close = close;
  const outside = (e) => { if (!pop.contains(e.target) && !(anchor && anchor.contains(e.target))) close(); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const grid = el('div', { class: 'lib-picker-grid' });
  if (!items.length) grid.append(el('p', { class: 'lib-empty' }, 'Nothing saved yet. Create one below and it will be here next time.'));
  for (const it of items) {
    grid.append(el('button', { class: 'lib-pick' + (it.isDefault ? ' is-default' : ''), title: `Place “${it.name}”`, onclick: () => { close(); placeLibraryItem(it); } },
      libThumb(it), el('span', { class: 'lib-pick-name' }, it.isDefault ? icon('star', 12) : null, it.name)));
  }
  pop.append(
    el('div', { class: 'lib-picker-head' }, el('strong', {}, title),
      el('span', { class: 'row' },
        Library.pinOn ? el('button', { class: 'icon-btn', title: 'Lock now', 'aria-label': 'Lock now', onclick: async () => { close(); await Host.libraryLock(); } }, icon('lock', 15)) : null,
        el('button', { class: 'link-btn', onclick: () => { close(); libraryManager(kinds[0]); } }, 'Manage', icon('arrowRight', 13)))),
    grid,
    el('div', { class: 'lib-picker-foot' }, ...create.map(([label, ic, fn]) => el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { close(); fn(); } }, icon(ic, 15), label))));
  document.body.append(pop);
  const r = anchor ? anchor.getBoundingClientRect() : { left: window.innerWidth / 2 - 180, bottom: 100 };
  pop.style.left = Math.max(12, Math.min(r.left, window.innerWidth - pop.offsetWidth - 12)) + 'px';
  pop.style.top = r.bottom + 8 + 'px';
  setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', esc, true); }, 0);
}

async function newSignatureFlow(kind) {
  const sig = await signatureDialog(kind);
  if (sig && App.active) setPending({ kind: 'image', src: sig.src, w: sig.w, h: sig.h, role: kind, hint: 'Click on the page where you want to sign. Press Esc to cancel.' });
}

async function signCommand(kind) {
  if (!(await Library.load())) return;
  const anchor = $(`#toolGroups [data-cmd="${kind === 'signature' ? 'sign' : 'initials'}"]`);
  if (!Library.of(kind).length) return newSignatureFlow(kind);
  openLibraryPicker({
    kinds: [kind], anchor,
    title: kind === 'signature' ? 'My signatures' : 'My initials',
    create: [[kind === 'signature' ? 'New signature' : 'New initials', 'plus', () => newSignatureFlow(kind)]],
  });
}

async function sealCommand() {
  if (!(await Library.load())) return;
  openLibraryPicker({
    kinds: ['seal', 'stamp'], anchor: $('#toolGroups [data-cmd="seal"]'), title: 'My seals & stamps',
    create: [['Design a seal', 'seal', () => sealDesigner()], ['From image', 'image', async () => { const it = await uploadSealImage(); if (it && App.active) placeLibraryItem(it); }], ['Text stamp', 'stamp', async () => { const it = await textStampDesigner(); if (it && App.active) placeLibraryItem(it); }]],
  });
}

// ---------- manager ----------
async function libraryManager(startKind = 'signature') {
  if (!(await Library.load())) return;
  let tab = startKind === 'stamp' ? 'seal' : startKind;
  const tabs = el('div', { class: 'seg', role: 'tablist' });
  const body = el('div', { class: 'lib-body' });
  const actions = el('div', { class: 'row' });
  let closeDlg = null;
  const kindsFor = (t) => (t === 'seal' ? ['seal', 'stamp'] : [t]);

  const render = () => {
    tabs.innerHTML = '';
    for (const [k, lab] of [['signature', 'Signatures'], ['initials', 'Initials'], ['seal', 'Seals & stamps']]) {
      const count = Library.of(...kindsFor(k)).length;
      tabs.append(el('button', { class: 'seg-btn' + (k === tab ? ' on' : ''), role: 'tab', onclick: () => { tab = k; render(); } }, lab, count ? el('span', { class: 'seg-count' }, String(count)) : null));
    }
    actions.innerHTML = '';
    if (tab === 'seal') {
      actions.append(
        el('button', { class: 'btn btn-primary btn-sm', id: 'libDesignSeal', onclick: async () => { await sealDesigner(); render(); } }, icon('seal', 15), 'Design a seal'),
        el('button', { class: 'btn btn-sm', onclick: async () => { await uploadSealImage(); render(); } }, icon('image', 15), 'From image'),
        el('button', { class: 'btn btn-sm', onclick: async () => { await textStampDesigner(); render(); } }, icon('stamp', 15), 'Text stamp'));
    } else {
      actions.append(el('button', { class: 'btn btn-primary btn-sm', onclick: async () => { await signatureDialog(tab, { saveOnly: true }); render(); } }, icon('plus', 15), tab === 'signature' ? 'New signature' : 'New initials'));
    }
    body.innerHTML = '';
    const list = Library.of(...kindsFor(tab));
    if (!list.length) {
      body.append(el('div', { class: 'lib-empty-big' }, icon(tab === 'seal' ? 'seal' : 'sign', 28),
        el('strong', {}, tab === 'seal' ? 'No seals or stamps yet' : tab === 'signature' ? 'No saved signatures yet' : 'No saved initials yet'),
        el('span', {}, tab === 'seal' ? 'Design your company seal, add a photo of a real stamp, or create a text stamp.' : 'Create one and it will be ready to place with one click.')));
      return;
    }
    const grid = el('div', { class: 'lib-grid' });
    for (const it of list) {
      const nameEl = el('input', { class: 'lib-name', value: it.name, 'aria-label': 'Name', spellcheck: 'false' });
      nameEl.addEventListener('change', () => Library.update(it.id, { name: nameEl.value.trim() || it.name }));
      nameEl.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') nameEl.blur(); });
      const editable = it.kind === 'stamp' || (it.kind === 'seal' && it.spec);
      grid.append(el('div', { class: 'lib-card' + (it.isDefault ? ' is-default' : '') },
        el('div', { class: 'lib-card-preview' }, libThumb(it),
          it.isDefault ? el('span', { class: 'lib-badge' }, icon('star', 11), 'Default') : null,
          it.kind === 'seal' && it.spec && it.spec.line2Mode === 'date' ? el('span', { class: 'lib-badge lib-badge-date' }, icon('date', 11), 'Auto date') : null),
        nameEl,
        el('div', { class: 'lib-card-actions' },
          el('button', { class: 'btn btn-primary btn-sm', disabled: !App.active, title: App.active ? 'Place on the current page' : 'Open a PDF to place it', onclick: () => { closeDlg(); placeLibraryItem(it); } }, 'Place'),
          !it.isDefault ? el('button', { class: 'icon-btn', title: 'Make default', 'aria-label': 'Make default', onclick: async () => { await Library.setDefault(it.id); render(); } }, icon('star', 16)) : null,
          editable ? el('button', { class: 'icon-btn', title: 'Edit', 'aria-label': 'Edit', onclick: async () => { if (it.kind === 'stamp') await textStampDesigner(it); else await sealDesigner(it); render(); } }, icon('pen', 16)) : null,
          el('button', { class: 'icon-btn', title: 'Delete', 'aria-label': 'Delete', onclick: async () => { if (await confirmDialog('Delete from library', `Delete “${it.name}”? Documents you already signed are not affected.`, 'Delete', 'danger')) { await Library.remove(it.id); render(); } } }, icon('trash', 16)))));
    }
    body.append(grid);
  };
  render();

  const exportBtn = el('button', { class: 'btn btn-ghost btn-sm', onclick: () => exportLibraryFlow() }, icon('download', 15), 'Export…');
  const importBtn = el('button', { class: 'btn btn-ghost btn-sm', onclick: async () => { if (await importLibraryFlow()) render(); } }, icon('upload', 15), 'Import…');
  const securityChip = () => el('button', { class: 'sec-chip' + (Library.pinOn ? ' on' : ''), id: 'libSecurity', title: 'PIN lock and privacy settings', onclick: async () => { await securityDialog(); if (Library.status && Library.status.locked) { closeDlg(); return; } secHost.innerHTML = ''; secHost.append(securityChip()); } },
    icon(Library.pinOn ? 'lock' : 'unlock', 14), Library.pinOn ? 'PIN lock on' : 'PIN lock off');
  const secHost = el('span', { class: 'row' }, securityChip());
  const lockBtn = el('button', { class: 'btn btn-ghost btn-sm', id: 'libLockNow', hidden: !Library.pinOn, onclick: async () => { await Host.libraryLock(); } }, icon('lock', 15), 'Lock now');

  const p = dialog({
    title: 'My signatures & seals',
    width: 860,
    className: 'dlg-library',
    content: el('div', { class: 'stack' },
      el('div', { class: 'row between' }, tabs, actions),
      body,
      el('div', { class: 'row between lib-foot' }, el('span', { class: 'row' }, secHost, el('span', { class: 'fld-hint' }, protectionLine())), el('span', { class: 'row' }, lockBtn, importBtn, exportBtn))),
    buttons: [{ label: 'Done', value: true, kind: 'primary', id: 'libDone' }],
  });
  closeDlg = () => { const b = $('#libDone'); if (b) b.click(); };
  Library.onLocked = closeDlg;
  await p;
  Library.onLocked = null;
  renderToolbar();
}


// ---------- PIN lock & privacy ----------
function protectionLine() {
  const st = Library.status || {};
  const os = { windows: 'your Windows account', keychain: 'your Mac’s Keychain', keyring: 'your system keyring', other: 'this computer' }[st.osProtection];
  if (st.web) return 'Stored in this browser only.';
  if (st.protection === 'pin') return os ? `Encrypted with your PIN and ${os}.` : 'Encrypted with your PIN.';
  return os ? `Encrypted with ${os}.` : 'Stored on this computer.';
}

const pinInput = (id, placeholder = '••••••') => {
  const i = el('input', { type: 'password', class: 'inp pin-input', id, inputmode: 'numeric', autocomplete: 'off', maxlength: 12, placeholder, spellcheck: 'false' });
  i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, '').slice(0, 12); });
  return i;
};
const pinError = (e) => cleanIpcError(e).replace(/^[A-Z_]+: /, '');

function fmtWait(ms) {
  const s = Math.ceil(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
}

/** Asks for the PIN. Resolves true once unlocked, false if cancelled. */
async function unlockDialog() {
  for (;;) {
    let st = await Host.libraryStatus();
    if (!st.locked) return true;
    const pin = pinInput('libPin');
    const waitLine = el('p', { class: 'pin-wait', role: 'status' });
    let timer = null;
    const tick = () => {
      const left = (st.lockedUntil || 0) - Date.now();
      if (left > 0) { waitLine.textContent = `Too many wrong PINs. Try again in ${fmtWait(left)}.`; pin.disabled = true; }
      else { waitLine.textContent = st.failed ? `${st.failed} wrong attempt${st.failed === 1 ? '' : 's'}.` : ''; pin.disabled = false; clearInterval(timer); timer = null; pin.focus(); }
    };
    tick();
    if (st.lockedUntil > Date.now()) timer = setInterval(tick, 500);
    const res = await dialog({
      title: 'Unlock signatures & seals',
      width: 420,
      className: 'dlg-welcome dlg-pin',
      content: el('div', { class: 'welcome-hero' },
        el('span', { class: 'pin-hero' }, icon('lock', 30)),
        el('h3', {}, 'Enter your PIN'),
        el('p', {}, 'Your saved signatures, seals and stamps are locked.'),
        pin, waitLine),
      buttons: [
        { label: 'Forgot PIN?', value: 'forgot', id: 'pinForgot' },
        { label: 'Cancel', value: null },
        {
          label: 'Unlock', kind: 'primary', value: 'ok', id: 'pinUnlock',
          validate: async () => {
            if (pin.disabled) return 'Please wait before trying again.';
            if (!/^\d{6,12}$/.test(pin.value)) return 'Enter your 6 to 12 digit PIN.';
            let r;
            try { r = await busyQuiet(() => Host.libraryUnlock(pin.value)); } catch (e) { return pinError(e); }
            pin.value = '';
            if (r.ok) return null;
            if (r.wiped) { toast('Too many wrong PINs. Your signatures & seals library was erased.', 'error', 8000); return null; }
            st = await Host.libraryStatus();
            if (st.lockedUntil > Date.now() && !timer) { timer = setInterval(tick, 500); }
            tick();
            return r.wipeIn != null && r.wipeIn <= 5 ? `Wrong PIN. The library will be erased after ${r.wipeIn} more wrong PIN${r.wipeIn === 1 ? '' : 's'}.` : 'Wrong PIN.';
          },
        }],
    });
    clearInterval(timer);
    if (res === 'ok') { st = await Host.libraryStatus(); if (!st.locked) { Library.loaded = false; return true; } Library.forget(); return false; }
    if (res !== 'forgot') return false;
    if (await forgotPinDialog()) { Library.forget(); Library.status = await Host.libraryStatus(); return true; }
  }
}

async function busyQuiet(fn) {
  const btn = $('#pinUnlock') || $('#pinSave');
  if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Checking…'; }
  try { return await fn(); } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = btn.dataset.label; } }
}

async function forgotPinDialog() {
  const confirmIn = textInput('', { placeholder: 'Type ERASE to confirm', id: 'eraseConfirm', autocomplete: 'off' });
  const res = await dialog({
    title: 'Forgot your PIN?',
    width: 480,
    content: el('div', { class: 'stack' },
      el('p', { class: 'dlg-text' }, 'Nobody can recover a forgotten PIN, not even MV Digital Tools. This is what keeps your signatures private.'),
      el('p', { class: 'dlg-text' }, 'You can erase the library and start again. Documents you have already signed are not affected. If you exported a backup, you can import it afterwards.'),
      field('Erase my saved signatures, seals and stamps', confirmIn)),
    buttons: [{ label: 'Cancel', value: null }, { label: 'Erase library', kind: 'danger', value: true, validate: () => (confirmIn.value.trim().toUpperCase() === 'ERASE' ? null : 'Type ERASE to confirm.') }],
  });
  if (!res) return false;
  await Host.libraryReset();
  toast('Library erased. You can set a new PIN from My library.', 'ok', 6000);
  return true;
}

/** Turns the PIN on (current = null) or changes it. */
async function pinSetupDialog({ change = false } = {}) {
  const cur = change ? pinInput('pinCurrent') : null;
  const p1 = pinInput('pinNew');
  const p2 = pinInput('pinConfirm');
  const wipe = el('input', { type: 'checkbox', id: 'pinWipe', checked: !!(Library.status && Library.status.wipeAfter) });
  const res = await dialog({
    title: change ? 'Change PIN' : 'Turn on PIN lock',
    width: 480,
    content: el('div', { class: 'stack' },
      change ? null : el('p', { class: 'dlg-text' }, 'Your signatures, seals and stamps will be encrypted with a PIN. Without it, nobody can see or use them, even with access to your files.'),
      cur ? field('Current PIN', cur) : null,
      el('div', { class: 'grid2' }, field(change ? 'New PIN' : 'PIN (6 to 12 digits)', p1), field('Confirm PIN', p2)),
      change ? null : el('label', { class: 'check' }, wipe, 'Erase the library after 10 wrong PINs'),
      el('p', { class: 'pin-note' }, icon('warning', 15), 'Keep your PIN somewhere safe. A forgotten PIN cannot be recovered.')),
    buttons: [{ label: 'Cancel', value: null }, {
      label: change ? 'Change PIN' : 'Turn on PIN lock', kind: 'primary', value: true, id: 'pinSave',
      validate: async () => {
        if (!/^\d{6,12}$/.test(p1.value)) return 'Use 6 to 12 digits.';
        if (/^(\d)\1+$/.test(p1.value) || '0123456789012'.includes(p1.value) || '9876543210987'.includes(p1.value)) return 'That PIN is too easy to guess. Avoid repeated or sequential digits.';
        if (p1.value !== p2.value) return 'The PINs do not match.';
        try { await busyQuiet(() => Host.librarySetPin({ pin: p1.value, current: cur ? cur.value : undefined, wipeAfter: change ? !!(Library.status && Library.status.wipeAfter) : wipe.checked })); } catch (e) { return pinError(e); }
        return null;
      },
    }],
  });
  if (!res) return false;
  Library.status = await Host.libraryStatus();
  Library.loaded = false;
  await Library.load();
  toast(change ? 'PIN changed' : 'PIN lock is on. Your library is encrypted.', 'ok', 5000);
  return true;
}

async function securityDialog() {
  if (!(await Library.load())) return;
  const st = () => Library.status || {};
  if (st().web) { toast('PIN lock needs the desktop app.', 'error'); return; }
  const body = el('div', { class: 'stack' });
  let done = null;
  const render = () => {
    body.innerHTML = '';
    const on = st().protection === 'pin';
    body.append(el('div', { class: 'sec-status' + (on ? ' on' : '') },
      el('span', { class: 'sec-icon' }, icon(on ? 'lock' : 'unlock', 22)),
      el('div', {}, el('strong', {}, on ? 'PIN lock is on' : 'PIN lock is off'), el('span', { class: 'fld-hint' }, protectionLine()))));
    if (!on) {
      body.append(el('p', { class: 'dlg-text' }, 'Turn on PIN lock so your saved signatures and company seals can only be used after entering your PIN. The library locks itself when you are away.'),
        el('button', { class: 'btn btn-primary', id: 'pinTurnOn', onclick: async () => { if (await pinSetupDialog()) render(); } }, icon('lock', 15), 'Turn on PIN lock'));
      return;
    }
    const auto = el('select', { class: 'inp', id: 'autoLock' }, ...[[1, 'After 1 minute'], [5, 'After 5 minutes'], [15, 'After 15 minutes'], [30, 'After 30 minutes'], [60, 'After 1 hour'], [0, 'Only when I close the app']].map(([v, l]) => el('option', { value: v, selected: Number(st().autoLockMinutes) === v }, l)));
    auto.addEventListener('change', async () => { await Host.libraryAutoLock(+auto.value); Library.status = await Host.libraryStatus(); toast('Auto-lock updated', 'ok'); });
    const wipe = el('input', { type: 'checkbox', checked: !!st().wipeAfter });
    wipe.addEventListener('change', async () => {
      try { await Host.libraryWipeOption(wipe.checked); Library.status = await Host.libraryStatus(); } catch (e) { toast(pinError(e), 'error'); wipe.checked = !wipe.checked; }
    });
    body.append(
      field('Lock automatically when idle', auto),
      el('p', { class: 'fld-hint' }, 'The library also locks when your computer sleeps or its screen locks, and every time the app closes.'),
      el('label', { class: 'check' }, wipe, 'Erase the library after 10 wrong PINs'),
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: async () => { await pinSetupDialog({ change: true }); render(); } }, icon('key', 15), 'Change PIN'),
        el('button', { class: 'btn', id: 'pinLockNow', onclick: async () => { await Host.libraryLock(); if (done) done(); } }, icon('lock', 15), 'Lock now'),
        el('button', { class: 'btn btn-ghost danger-text', onclick: async () => { if (await removePinDialog()) render(); } }, 'Turn off PIN lock')));
  };
  render();
  const p = dialog({ title: 'Privacy & PIN lock', width: 520, content: body, buttons: [{ label: 'Done', value: true, kind: 'primary', id: 'secDone' }] });
  done = () => { const b = $('#secDone'); if (b) b.click(); };
  await p;
}

async function removePinDialog() {
  const cur = pinInput('pinRemove');
  const ok = await dialog({
    title: 'Turn off PIN lock',
    width: 440,
    content: el('div', { class: 'stack' }, el('p', { class: 'dlg-text' }, 'Your library stays encrypted with your computer account, but anyone using this account will be able to use your signatures.'), field('Current PIN', cur)),
    buttons: [{ label: 'Cancel', value: null }, {
      label: 'Turn off', kind: 'danger', value: true,
      validate: async () => { try { await Host.libraryRemovePin({ current: cur.value }); } catch (e) { return pinError(e); } return null; },
    }],
  });
  if (!ok) return false;
  Library.status = await Host.libraryStatus();
  Library.loaded = false;
  await Library.load();
  toast('PIN lock turned off', 'ok');
  return true;
}

// ---------- backups ----------
async function exportLibraryFlow() {
  if (!(await Library.load())) return;
  const pw1 = el('input', { type: 'password', class: 'inp', id: 'backupPw', autocomplete: 'new-password' });
  const pw2 = el('input', { type: 'password', class: 'inp', id: 'backupPw2', autocomplete: 'new-password' });
  const protect = el('input', { type: 'checkbox', checked: true, id: 'backupProtect', disabled: Library.pinOn });
  const pwRow = el('div', { class: 'grid2' }, field('Backup password', pw1), field('Confirm', pw2));
  protect.addEventListener('change', () => { pwRow.hidden = !protect.checked; });
  const ok = await dialog({
    title: 'Export a backup',
    width: 500,
    content: el('div', { class: 'stack' },
      el('p', { class: 'dlg-text' }, `Saves all ${Library.items.length} signatures, seals and stamps to one file you can keep safe or move to another computer.`),
      el('label', { class: 'check' }, protect, Library.pinOn ? 'Protect with a password (required while PIN lock is on)' : 'Protect with a password (recommended)'),
      pwRow,
      el('p', { class: 'fld-hint' }, 'You will need this password to import the backup. It cannot be recovered.')),
    buttons: [{ label: 'Cancel', value: null }, {
      label: 'Export', kind: 'primary', value: true, id: 'backupExport',
      validate: () => {
        if (!protect.checked) return null;
        if (pw1.value.length < 8) return 'Use a password of at least 8 characters.';
        if (pw1.value !== pw2.value) return 'The passwords do not match.';
        return null;
      },
    }],
  });
  if (!ok) return;
  let data;
  try { data = await Host.libraryExport({ password: protect.checked ? pw1.value : null }); } catch (e) { toast(pinError(e), 'error'); return; }
  const r = await Host.saveFile({ data, suggestedName: 'Sahifa signatures and seals.sahifalib', saveAs: true, kind: 'any' });
  if (r) toast(`Exported ${Library.items.length} item${Library.items.length === 1 ? '' : 's'}${protect.checked ? ' (encrypted)' : ''}`, 'ok');
}

async function importLibraryFlow() {
  if (!(await Library.load())) return false;
  const [f] = await Host.openDialog({ multi: false, kind: 'any', title: 'Import a Sahifa library file' });
  if (!f) return false;
  let data;
  try { data = JSON.parse(new TextDecoder().decode(f.data)); } catch { toast('This is not a Sahifa library file.', 'error'); return false; }
  let items = null;
  if (data && data.format === 'sahifa-library' && Array.isArray(data.items)) items = data.items;
  else if (data && data.format === 'sahifa-library-encrypted') {
    const pw = el('input', { type: 'password', class: 'inp', id: 'importPw', autocomplete: 'off' });
    const ok = await dialog({
      title: 'Encrypted backup',
      width: 420,
      content: el('div', { class: 'stack' }, el('p', { class: 'dlg-text' }, 'Enter the password this backup was exported with.'), field('Backup password', pw)),
      buttons: [{ label: 'Cancel', value: null }, {
        label: 'Import', kind: 'primary', value: true, id: 'importGo',
        validate: async () => { try { items = await Host.libraryDecryptBackup({ data: f.data, password: pw.value }); } catch (e) { return pinError(e); } return null; },
      }],
    });
    if (!ok) return false;
  } else { toast('This is not a Sahifa library file.', 'error'); return false; }
  const n = await Library.importItems(items);
  toast(n ? `Imported ${n} item${n === 1 ? '' : 's'}` : 'Everything in that file is already in your library', 'ok');
  return true;
}

// ---------- locking from the main process ----------
Host.onLibraryLocked((reason) => {
  const wasOpen = Library.loaded;
  Library.forget();
  closePicker();
  if (Library.onLocked) Library.onLocked();
  if (wasOpen && reason !== 'manual') toast('Signatures & seals locked', 'info');
  if (reason === 'manual') toast('Signatures & seals locked', 'ok');
});
let _lastActivity = 0;
for (const ev of ['pointerdown', 'keydown']) {
  document.addEventListener(ev, () => {
    if (!Library.pinOn || !Library.loaded) return;
    const now = Date.now();
    if (now - _lastActivity > 15000) { _lastActivity = now; Host.libraryActivity(); }
  }, true);
}
