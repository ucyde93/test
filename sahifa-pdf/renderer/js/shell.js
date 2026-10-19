'use strict';
/* Window layout: title bar with document tabs, tool rail, toolbar, floating page
   controls, the Home dashboard, the splash screen and the "default PDF app" flow. */

const COMPANY = 'MV Digital Tools';
const T = (tool, label, iconName, key) => ({ tool, label, icon: iconName, key });
const C = (cmd, label, iconName, title) => ({ cmd, label, icon: iconName, title });

const MODES = [
  { id: 'view', label: 'View', icon: 'eye', groups: [
    [T('select', 'Select', 'select', 'V'), T('hand', 'Hand', 'hand', 'H')],
    [C('zoom-out', 'Zoom out', 'zoomOut'), C('zoom-in', 'Zoom in', 'zoomIn'), C('zoom-width', 'Fit width', 'fitWidth'), C('zoom-page', 'Fit page', 'fitPage')],
    [C('night', 'Night', 'night', 'Night reading mode'), C('read-aloud', 'Read aloud', 'speaker'), C('present', 'Present', 'present')],
    [C('properties', 'Properties', 'info')],
  ] },
  { id: 'comment', label: 'Comment', icon: 'comments', groups: [
    [T('highlight', 'Highlight', 'highlight', 'U'), T('underline', 'Underline', 'underline'), T('strike', 'Strikeout', 'strike')],
    [T('note', 'Sticky note', 'note', 'N'), T('text', 'Text box', 'text', 'T')],
    [T('pen', 'Pen', 'pen', 'P'), T('rect', 'Rectangle', 'rect', 'R'), T('ellipse', 'Ellipse', 'ellipse'), T('line', 'Line', 'line'), T('arrow', 'Arrow', 'arrow')],
    [C('stamp', 'Stamp', 'stamp')],
  ] },
  { id: 'edit', label: 'Edit', icon: 'editText', groups: [
    [T('edittext', 'Edit text', 'editText', 'E'), T('text', 'Add text', 'text')],
    [C('image', 'Image', 'image'), T('whiteout', 'White-out', 'whiteout')],
    [C('watermark', 'Watermark', 'watermark'), C('header-footer', 'Page numbers', 'pageNumbers', 'Page numbers, header & footer'), T('crop', 'Crop', 'crop')],
    [T('field-text', 'Text field', 'fieldText'), T('field-multiline', 'Text area', 'dropdown'), T('field-check', 'Checkbox', 'fieldCheck')],
    [C('metadata', 'Info', 'info', 'Title, author and keywords'), C('attach', 'Attach', 'attach', 'Attach a file')],
  ] },
  { id: 'sign', label: 'Fill & Sign', icon: 'sign', groups: [
    [C('sign', 'Signature', 'sign'), C('initials', 'Initials', 'initials'), C('seal', 'Seal', 'seal', 'Company seals and saved stamps'), C('library', 'My library', 'library', 'Saved signatures, seals and stamps')],
    [T('text', 'Text', 'text'), T('date', 'Date', 'date'), T('check', 'Check', 'check'), T('cross', 'Cross', 'cross'), T('dot', 'Dot', 'dot')],
    [C('digital-sign', 'Digital ID', 'certificate', 'Sign with a certificate')],
    [C('save-flat', 'Flatten', 'layers', 'Save a copy with fields and edits merged into the pages')],
  ] },
  { id: 'organize', label: 'Pages', icon: 'organize', groups: [
    [C('organize', 'Page grid', 'organize', 'Show all pages as a grid')],
    [C('rotate-ccw', 'Rotate left', 'rotateCcw'), C('rotate-cw', 'Rotate right', 'rotateCw'), C('delete-page', 'Delete', 'trash'), C('duplicate-page', 'Duplicate', 'copy')],
    [C('insert-blank', 'Blank page', 'blank'), C('insert-pdf', 'Merge PDF', 'merge'), C('insert-images', 'Images', 'images')],
    [C('extract', 'Extract', 'extract'), C('split', 'Split', 'split'), T('crop', 'Crop', 'crop')],
  ] },
  { id: 'protect', label: 'Protect', icon: 'shield', groups: [
    [C('protect', 'Encrypt', 'lock', 'Protect with a password')],
    [T('redact', 'Mark', 'redact', 'Mark content for redaction'), C('apply-redactions', 'Apply', 'shield', 'Permanently remove marked content')],
    [C('sanitize', 'Remove hidden', 'sanitize', 'Remove metadata, scripts and attachments')],
    [C('digital-sign', 'Sign', 'certificate', 'Sign with a digital ID'), C('digital-ids', 'My IDs', 'key', 'Manage digital IDs')],
  ] },
  { id: 'convert', label: 'Convert', icon: 'convert', groups: [
    [C('export-images', 'To images', 'exportImage'), C('export-text', 'To text', 'textFile'), C('extract', 'Extract pages', 'extract')],
    [C('new-from-images', 'From images', 'images'), C('new-blank', 'Blank PDF', 'blank'), C('merge-files', 'Merge files', 'merge')],
  ] },
];
const NEEDS_DOC = (cmd) => !['open', 'new-from-images', 'new-blank', 'merge-files', 'shortcuts', 'about', 'theme', 'digital-ids', 'make-default', 'home', 'library', 'design-seal', 'library-security', 'library-lock'].includes(cmd);

// ---------- rail & toolbar ----------
function setMode(id) {
  if (!MODES.some((m) => m.id === id)) id = 'view';
  const was = App.mode;
  App.mode = id;
  settingsSet('mode', id);
  if (App.active) {
    if (id === 'organize' && !Organizer.open) openOrganizer();
    if (was === 'organize' && id !== 'organize' && Organizer.open) closeOrganizer(orgTargets()[0]);
  }
  renderRail();
  renderToolbar();
}

function renderRail() {
  const rail = $('#rail');
  rail.innerHTML = '';
  const top = el('div', { class: 'rail-group' });
  for (const m of MODES) {
    const on = m.id === App.mode;
    top.append(el('button', { class: 'rail-btn' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', title: m.label, onclick: () => setMode(m.id) },
      icon(m.icon, 20), el('span', {}, m.label)));
  }
  const bottom = el('div', { class: 'rail-group rail-bottom' },
    el('button', { class: 'rail-btn rail-small' + (App.sidebarOpen ? ' on' : ''), title: 'Show or hide panels (F4)', onclick: () => App.run('toggle-sidebar') }, icon('sidebar', 18), el('span', {}, 'Panels')),
    el('button', { class: 'rail-btn rail-small', title: 'Keyboard shortcuts (F1)', onclick: () => App.run('shortcuts') }, icon('help', 18), el('span', {}, 'Help')));
  rail.append(top, bottom);
}

function renderToolbar() {
  const box = $('#toolGroups');
  box.innerHTML = '';
  const mode = MODES.find((m) => m.id === App.mode) || MODES[0];
  const hasDoc = !!App.active;
  mode.groups.forEach((items, gi) => {
    if (gi) box.append(el('span', { class: 'tg-sep', 'aria-hidden': 'true' }));
    const group = el('span', { class: 'tg' });
    box.append(group);
    for (const it of items) {
      const active = it.tool && hasDoc && Annotations.tool === it.tool;
      group.append(el('button', {
        class: 'tb-btn' + (active ? ' on' : ''),
        title: (it.title || it.label) + (it.key ? `  (${it.key})` : ''),
        'aria-pressed': it.tool ? (active ? 'true' : 'false') : null,
        disabled: it.tool ? !hasDoc : (!hasDoc && NEEDS_DOC(it.cmd)),
        dataset: it.tool ? { tool: it.tool } : { cmd: it.cmd },
        onclick: () => (it.tool ? (Annotations.tool === it.tool && it.tool !== 'select' ? setTool('select') : setTool(it.tool)) : App.run(it.cmd)),
      }, icon(it.icon, 18), el('span', {}, it.label)));
    }
  });
  for (const id of ['#tbUndo', '#tbRedo', '#tbPrint', '#tbSave']) $(id).disabled = !hasDoc;
  fitToolbar();
}

/** Shows labels when they fit, icons only (with tooltips) when they do not. */
function fitToolbar() {
  const box = $('#toolGroups');
  const groups = $$('.tg', box);
  groups.forEach((g) => g.classList.remove('icons-only'));
  // Drop labels group by group, starting with the last, until everything fits.
  for (let i = groups.length - 1; i >= 0 && box.scrollWidth > box.clientWidth + 1; i--) groups[i].classList.add('icons-only');
}
// Older call sites refresh "the ribbon".
const renderRibbon = () => { renderRail(); renderToolbar(); };

// ---------- title bar tabs ----------
function renderDocTabs() {
  const bar = $('#docTabs');
  bar.innerHTML = '';
  $('#homeTab').classList.toggle('on', App.home);
  for (const d of App.docs) {
    const on = !App.home && d === App.active;
    const tab = el('div', { class: 'doc-tab' + (on ? ' on' : ''), role: 'tab', title: d.path || d.name, 'aria-selected': on ? 'true' : 'false' },
      el('button', { class: 'doc-tab-name', onclick: () => activate(d) }, icon('fileText', 14), el('span', { class: 'doc-tab-label' }, d.name), d.dirty ? el('span', { class: 'dirty-dot', title: 'Unsaved changes' }) : null),
      el('button', { class: 'doc-tab-x', 'aria-label': `Close ${d.name}`, onclick: () => closeDoc(d) }, icon('close', 12)));
    bar.append(tab);
  }
  bar.append(el('button', { class: 'doc-tab-add', title: 'Open a PDF (Ctrl+O)', 'aria-label': 'Open a PDF', onclick: () => App.run('open') }, icon('plus', 15)));
}

function updateTitle() {
  const d = App.active;
  Host.setTitle(!App.home && d ? `${d.dirty ? '• ' : ''}${d.name} · Sahifa PDF` : 'Sahifa PDF · MV Digital Tools');
  Host.setDirty(App.docs.some((x) => x.dirty));
}

// ---------- switching between Home and documents ----------
function showHome() {
  if (Annotations.editing) finishTextEdit();
  if (App.active && !App.home) App.active.scrollTop = viewerEl().scrollTop;
  App.home = true;
  document.body.classList.add('home');
  renderHome();
  renderDocTabs();
  updateTitle();
}

function activate(doc) {
  if (!doc) { App.active = null; Viewer.doc = null; $('#pages').innerHTML = ''; showHome(); renderToolbar(); return; }
  if (Annotations.editing) finishTextEdit();
  if (App.active && App.active !== doc && !App.home) App.active.scrollTop = viewerEl().scrollTop;
  if (Organizer.open) closeOrganizer();
  App.active = doc;
  App.home = false;
  document.body.classList.remove('home');
  $('#viewer').hidden = false;
  Annotations.selected = null;
  Search.hits = [];
  Search.index = -1;
  Viewer.doc = doc;
  renderSidebar();
  mountDoc(doc);
  setTool(Annotations.tool === 'select' || Annotations.tool === 'hand' ? Annotations.tool : 'select');
  if (App.mode === 'organize') openOrganizer();
  renderDocTabs();
  renderRibbon();
  renderSidebar();
  renderStatus();
  renderBanner();
  updateTitle();
}

// ---------- page controls & status ----------
function renderStatus() {
  const doc = App.active;
  $('#pageControls').classList.toggle('disabled', !doc);
  $('#pageInput').value = doc ? Viewer.current + 1 : '';
  $('#pageCount').textContent = doc ? `/ ${doc.pageCount}` : '';
  $('#zoomLabel').textContent = doc ? Math.round(Viewer.scale * 100) + '%' : '';
  const st = $('#docState');
  st.textContent = doc ? (doc.dirty ? 'Unsaved changes' : doc.path ? 'All changes saved' : '') : '';
  st.classList.toggle('dirty', !!(doc && doc.dirty));
  $$('.thumb.on').forEach((t) => t.classList.remove('on'));
  const th = $(`.thumb[data-index="${Viewer.current}"]`);
  if (th) { th.classList.add('on'); const p = $('#sidePanel'); if (th.offsetTop < p.scrollTop || th.offsetTop > p.scrollTop + p.clientHeight - 60) p.scrollTop = th.offsetTop - 80; }
}

function buildPageControls() {
  const pageInput = $('#pageInput');
  pageInput.addEventListener('change', () => { const n = parseInt(pageInput.value, 10); if (n) goToPage(n - 1); });
  pageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') pageInput.blur(); e.stopPropagation(); });
  const wire = (id, ic, title, fn) => { const b = $(id); b.append(icon(ic, 16)); b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', fn); };
  wire('#sbPrev', 'chevLeft', 'Previous page (Page Up)', () => goToPage(Viewer.current - 1));
  wire('#sbNext', 'chevRight', 'Next page (Page Down)', () => goToPage(Viewer.current + 1));
  wire('#sbZoomOut', 'zoomOut', 'Zoom out', () => App.run('zoom-out'));
  wire('#sbZoomIn', 'zoomIn', 'Zoom in', () => App.run('zoom-in'));
  wire('#sbFitWidth', 'fitWidth', 'Fit width', () => App.run('zoom-width'));
  wire('#sbFitPage', 'fitPage', 'Fit page', () => App.run('zoom-page'));
  wire('#sbNight', 'night', 'Night reading mode', () => App.run('night'));
  $('#zoomLabel').addEventListener('click', async () => {
    const pct = el('input', { type: 'number', class: 'inp', min: 10, max: 800, value: Math.round(Viewer.scale * 100) });
    const v = await dialog({ title: 'Zoom', width: 300, content: field('Zoom (%)', pct), buttons: [{ label: 'Cancel', value: null }, { label: 'Apply', kind: 'primary', value: () => +pct.value }] });
    if (v) setZoom('custom', clamp(v / 100, 0.1, 8));
  });
  const end = (id, ic, cmd) => { $(id).append(icon(ic, 18)); $(id).addEventListener('click', () => App.run(cmd)); };
  end('#tbUndo', 'undo', 'undo');
  end('#tbRedo', 'redo', 'redo');
  end('#tbPrint', 'print', 'print');
  $('#tbSave').prepend(icon('save', 16));
  $('#tbSave').addEventListener('click', () => App.run('save'));
}

// ---------- title bar ----------
function buildTitlebar() {
  $('#brandChev').append(icon('chevDown', 12));
  $('#homeIcon').append(icon('home', 15));
  $('#homeTab').addEventListener('click', () => showHome());
  $('#brandMenu').addEventListener('click', (e) => {
    if (Host.isDesktop) {
      const r = e.currentTarget.getBoundingClientRect();
      Host.popupMenu(r.left, r.bottom + 4);
    } else aboutDialog();
  });
  const f = $('#findInput');
  const go = debounce(() => runSearch(f.value), 280);
  f.addEventListener('input', () => { if (App.active) go(); });
  f.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      if (Search.query !== f.value) runSearch(f.value);
      else focusHit(Search.index + (e.shiftKey ? -1 : 1));
    }
    if (e.key === 'Escape') { f.value = ''; runSearch(''); f.blur(); }
  });
  f.addEventListener('focus', () => {
    if (!App.active) return;
    if (App.home) activate(App.active);
    if (App.sidebarTab !== 'search' || !App.sidebarOpen) { App.sidebarTab = 'search'; App.sidebarOpen = true; renderSidebar(); }
  });
  $('#findPrev').append(icon('chevUp', 13));
  $('#findNext').append(icon('chevDown', 13));
  $('#findPrev').addEventListener('click', () => focusHit(Search.index - 1));
  $('#findNext').addEventListener('click', () => focusHit(Search.index + 1));
  $('#searchIcon').append(icon('search', 15));
  $('#themeBtn').addEventListener('click', () => App.run('theme'));
  $('#dropIcon').append(icon('download', 22));
  if (Host.platform === 'darwin') $('.find-kbd').textContent = '⌘F';
}

function applyTheme(mode) {
  if (mode === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  settingsSet('theme', mode);
  const dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  Host.setChrome(dark ? 'dark' : 'light');
  const btn = $('#themeBtn');
  if (btn) {
    btn.innerHTML = '';
    btn.append(icon(mode === 'dark' ? 'moon' : mode === 'light' ? 'sun' : 'contrast', 16));
    btn.title = `Appearance: ${mode === 'system' ? 'match system' : mode}`;
  }
}

// ---------- Home dashboard ----------
const HOME_TOOLS = [
  { t: 'Edit PDF', d: 'Change existing text, add text and images', icon: 'editText', tint: '#2f5bea', mode: 'edit', tool: 'edittext' },
  { t: 'Fill & Sign', d: 'Fill forms, type or draw your signature', icon: 'sign', tint: '#7c3aed', mode: 'sign', cmd: 'sign' },
  { t: 'Comment', d: 'Highlight, sticky notes, drawings, stamps', icon: 'comments', tint: '#c2410c', mode: 'comment', tool: 'highlight' },
  { t: 'Organize pages', d: 'Reorder, rotate, insert and delete pages', icon: 'organize', tint: '#0e7490', mode: 'organize' },
  { t: 'Merge files', d: 'Combine several PDFs into one', icon: 'merge', tint: '#047857', cmd: 'merge-files', noDoc: true },
  { t: 'Split PDF', d: 'Separate pages into new files', icon: 'split', tint: '#be185d', mode: 'organize', cmd: 'split' },
  { t: 'Protect', d: 'Lock with an AES-256 password', icon: 'lock', tint: '#b91c1c', mode: 'protect', cmd: 'protect' },
  { t: 'Redact', d: 'Permanently remove sensitive content', icon: 'redact', tint: '#334155', mode: 'protect', tool: 'redact' },
  { t: 'Digital ID', d: 'Sign with a certificate readers can verify', icon: 'certificate', tint: '#0f766e', mode: 'sign', cmd: 'digital-sign' },
  { t: 'Images to PDF', d: 'Turn photos and scans into a PDF', icon: 'images', tint: '#b45309', cmd: 'new-from-images', noDoc: true },
  { t: 'Export images', d: 'Save pages as PNG or JPEG', icon: 'exportImage', tint: '#4338ca', mode: 'convert', cmd: 'export-images' },
  { t: 'Signatures & seals', d: 'Your saved signatures, company seals and stamps', icon: 'seal', tint: '#6d28d9', cmd: 'library', noDoc: true },
];

async function launchTool(tool) {
  if (tool.noDoc) return App.run(tool.cmd);
  if (!App.active) {
    await App.run('open');
    if (!App.active) return;
  }
  activate(App.active);
  if (tool.mode) setMode(tool.mode);
  if (tool.tool) setTool(tool.tool);
  if (tool.cmd && tool.cmd !== 'organize') App.run(tool.cmd);
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
function relTime(ms) {
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return 'Just now';
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)} d ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function defaultAppBlock() {
  const st = App.defaultStatus;
  if (!st || !st.supported) return null;
  if (st.isDefault) return null;
  if (App.defaultDismissed) return null;
  return el('section', { class: 'default-card', 'aria-label': 'Default PDF app' },
    el('img', { src: '../build/icon.png', alt: '', class: 'default-icon' }),
    el('div', { class: 'default-text' },
      el('h2', {}, 'Make Sahifa PDF your default PDF app'),
      el('p', {}, 'PDFs you double-click will open here, ready to read, fill and sign.')),
    el('div', { class: 'default-actions' },
      el('button', { class: 'btn btn-ghost', onclick: () => { App.defaultDismissed = true; renderHome(); } }, 'Not now'),
      el('button', { class: 'btn btn-primary', id: 'setDefaultBtn', onclick: () => makeDefaultFlow() }, 'Set as default')));
}

async function renderHome() {
  const root = $('#home');
  const recent = await Host.recentGet().catch(() => []);
  root.innerHTML = '';
  const st = App.defaultStatus;
  const info = App.appInfo || { version: '' };

  const evening = new Date().getHours() >= 17 || new Date().getHours() < 5;
  const head = el('header', { class: 'home-head' },
    el('div', {},
      el('span', { class: 'greet-pill' }, icon(evening ? 'moon' : 'sun', 15), greeting()),
      el('h1', {}, 'What would you like to do with ', el('span', { class: 'grad' }, 'your PDFs?')),
      el('p', { class: 'home-sub' }, 'Read, fill, sign, edit and organize. Everything stays on this computer.')),
    el('img', { src: 'assets/hero.svg', alt: '', class: 'hero-art', draggable: 'false' }),
    el('div', { class: 'home-head-actions' },
      el('button', { class: 'btn btn-primary btn-pill', id: 'homeOpen', onclick: () => App.run('open') }, icon('open', 20), 'Open File', el('span', { class: 'arrow' }, icon('arrowRight', 18))),
      st && st.isDefault ? el('span', { class: 'chip chip-ok', title: 'PDFs open in Sahifa PDF' }, icon('check', 14), 'Default PDF app') : null));

  const drop = el('div', { class: 'drop-card' },
    el('button', { class: 'drop-zone', onclick: () => App.run('open') },
      el('span', { class: 'drop-icon' }, icon('cloudUpload', 34)),
      el('span', { class: 'drop-title' }, 'Drop PDFs or images here'),
      el('span', { class: 'drop-sub' }, 'or click to browse your computer'),
      el('span', { class: 'formats' }, el('span', {}, 'PDF'), el('span', {}, 'JPG'), el('span', {}, 'PNG'))));

  const tools = el('div', { class: 'tool-grid' }, ...HOME_TOOLS.map((tool) => {
    const card = el('button', { class: 'tool-card', onclick: () => launchTool(tool) },
      el('span', { class: 'tool-icon' }, icon(tool.icon, 24)),
      el('span', { class: 'tool-title' }, tool.t),
      el('span', { class: 'tool-desc' }, tool.d),
      el('span', { class: 'tool-chev' }, icon('chevRight', 16)));
    card.style.setProperty('--tint', tool.tint);
    return card;
  }));

  const RECENT_SHOWN = 5;
  let recentBody;
  if (!recent.length) {
    recentBody = el('div', { class: 'recent-empty' }, el('span', { class: 'empty-icon' }, icon('fileText', 20)), el('span', {}, 'Files you open will appear here.'));
  } else {
    const rows = App.recentExpanded ? recent : recent.slice(0, RECENT_SHOWN);
    recentBody = el('div', { class: 'recent-table', role: 'list' }, ...rows.map((r) => {
      const folder = r.path.slice(0, r.path.length - r.name.length).replace(/[\\/]$/, '');
      return el('button', { class: 'recent-row', role: 'listitem', title: r.path, onclick: () => openPaths([r.path]) },
        el('span', { class: 'recent-file' }, el('span', { class: 'pdf-badge' }, 'PDF'), el('span', { class: 'recent-name' }, r.name)),
        el('span', { class: 'recent-folder' }, folder),
        el('span', { class: 'recent-size' }, fmtBytes(r.size)),
        el('span', { class: 'recent-time' }, relTime(r.mtime)));
    }));
  }
  const sectionHead = (ic, title, action) => el('div', { class: 'section-head' }, el('h2', { class: 'section-title' }, icon(ic, 17), title), action || null);
  const viewAll = recent.length > RECENT_SHOWN
    ? el('button', { class: 'link-btn', onclick: () => { App.recentExpanded = !App.recentExpanded; renderHome(); } }, App.recentExpanded ? 'Show less' : 'View all', icon('arrowRight', 14))
    : null;

  const open = App.docs.length
    ? el('section', { class: 'home-section' }, sectionHead('layers', 'Open now'),
      el('div', { class: 'open-docs' }, ...App.docs.map((d) => el('button', { class: 'open-doc', onclick: () => activate(d) },
        el('span', { class: 'pdf-badge' }, 'PDF'), el('span', { class: 'recent-name' }, d.name), el('span', { class: 'muted small' }, `${d.pageCount} page${d.pageCount === 1 ? '' : 's'}${d.dirty ? ' · unsaved' : ''}`)))))
    : null;

  const foot = el('footer', { class: 'home-foot' },
    el('div', { class: 'company' },
      el('img', { src: 'assets/mv-digital-tools.svg', alt: '', class: 'company-mark' }),
      el('div', {}, el('div', { class: 'company-line' }, 'A product of ', el('strong', {}, COMPANY)), el('div', { class: 'muted small' }, `Sahifa PDF ${info.version ? 'v' + info.version : ''}  ·  © 2026 ${COMPANY}`))),
    el('ul', { class: 'promises' }, el('li', {}, el('span', { class: 'dot' }), 'Works offline'), el('li', {}, icon('lock', 15), 'Files never leave your computer'), el('li', {}, icon('shield', 15), 'Free, no account')));

  root.append(el('div', { class: 'home-inner' },
    head,
    defaultAppBlock(),
    el('div', { class: 'home-grid' },
      el('div', { class: 'home-col' }, drop, open,
        el('section', { class: 'home-section' }, sectionHead('clock', 'Recent files', viewAll), recentBody)),
      el('section', { class: 'home-section' }, sectionHead('wrench', 'Tools'), tools)),
    foot));
  if (!Host.isDesktop) root.querySelector('.home-head').after(el('p', { class: 'web-note' }, 'You are using the browser preview. Install the desktop app to save in place, use digital IDs and open PDFs from your file manager.'));
}

// ---------- default PDF app ----------
async function refreshDefaultStatus() {
  App.defaultStatus = await Host.defaultStatus().catch(() => null);
  if (App.home) renderHome();
  return App.defaultStatus;
}

function steps(...items) {
  return el('ol', { class: 'steps' }, ...items.map((t) => el('li', {}, ...t)));
}

async function makeDefaultFlow() {
  if (!Host.isDesktop) { toast('Install the desktop app to make it your default PDF app.', 'error'); return; }
  const r = await Host.makeDefault({});
  if (r.done) {
    await refreshDefaultStatus();
    toast('Sahifa PDF is now your default PDF app', 'ok');
    return;
  }
  if (r.error) { toast(r.error, 'error', 6000); return; }
  if (r.confirm === 'openwith') {
    const choice = await dialog({
      title: 'Confirm in Windows',
      width: 480,
      content: el('div', { class: 'stack' },
        el('p', { class: 'dlg-text' }, 'Windows asks you to confirm the change yourself. In the window that just opened:'),
        steps(['Select ', el('strong', {}, 'Sahifa PDF'), '.'], ['Choose ', el('strong', {}, 'Always'), ' (or tick ', el('em', {}, 'Always use this app'), ').']),
        el('p', { class: 'fld-hint' }, 'Your welcome document opens in Sahifa PDF when you are done.')),
      buttons: [{ label: 'Use Windows Settings instead', value: 'settings' }, { label: 'Done', kind: 'primary', value: 'done' }],
    });
    if (choice === 'settings') {
      await Host.makeDefault({ via: 'settings' });
      await dialog({
        title: 'Finish in Settings',
        content: steps(['Next to ', el('strong', {}, '.pdf'), ', click the current app.'], ['Pick ', el('strong', {}, 'Sahifa PDF'), ' and confirm.']),
        buttons: [{ label: 'Done', kind: 'primary', value: true }],
      });
    }
  } else if (r.confirm === 'settings') {
    await dialog({
      title: 'Finish in Settings',
      content: steps(['Next to ', el('strong', {}, '.pdf'), ', click the current app.'], ['Pick ', el('strong', {}, 'Sahifa PDF'), ' and confirm.']),
      buttons: [{ label: 'Done', kind: 'primary', value: true }],
    });
  } else if (r.confirm === 'finder') {
    await dialog({
      title: 'Finish in Finder',
      content: steps(['Select any PDF in Finder and choose ', el('strong', {}, 'File › Get Info'), '.'], ['Under ', el('strong', {}, 'Open with'), ', pick ', el('strong', {}, 'Sahifa PDF'), '.'], ['Click ', el('strong', {}, 'Change All…'), ' and confirm.']),
      buttons: [{ label: 'Done', kind: 'primary', value: true }],
    });
  }
  const st = await refreshDefaultStatus();
  if (st && st.isDefault) toast('Sahifa PDF is now your default PDF app', 'ok');
}

async function maybeAskDefault() {
  if (!Host.isDesktop || settingsGet('defaultAsked', false)) return;
  const st = App.defaultStatus;
  if (!st || !st.supported || st.isDefault) return;
  settingsSet('defaultAsked', true);
  const yes = await dialog({
    title: 'Welcome to Sahifa PDF',
    width: 460,
    className: 'dlg-welcome',
    content: el('div', { class: 'welcome-hero' },
      el('img', { src: '../build/icon.png', alt: '', class: 'welcome-icon' }),
      el('h3', {}, 'Open your PDFs with Sahifa PDF?'),
      el('p', {}, 'Make it your default PDF app so documents you double-click open here, ready to read, fill and sign.'),
      el('p', { class: 'fld-hint' }, 'You can change this any time from the Home screen.')),
    buttons: [{ label: 'Not now', value: false, id: 'defaultLater' }, { label: 'Make default', kind: 'primary', value: true, id: 'defaultYes' }],
  });
  if (yes) makeDefaultFlow();
}

// ---------- boot ----------
function hideSplash() {
  const s = $('#splash');
  if (!s) return;
  s.classList.add('out');
  setTimeout(() => s.remove(), 450);
}

async function boot() {
  document.body.classList.add('platform-' + Host.platform);
  applyTheme(settingsGet('theme', 'system'));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(settingsGet('theme', 'system')));
  Viewer.night = settingsGet('night', false);
  viewerEl().classList.toggle('night', Viewer.night);
  buildTitlebar();
  buildPageControls();
  new ResizeObserver(() => fitToolbar()).observe($('#toolbar'));
  setupDragDrop();
  wireEvents();
  App.appInfo = await Host.appInfo().catch(() => null);
  App.defaultStatus = await Host.defaultStatus().catch(() => null);
  Host.onDefaultStatus((st) => {
    const was = App.defaultStatus && App.defaultStatus.isDefault;
    App.defaultStatus = st;
    if (st.isDefault && !was) toast('Sahifa PDF is now your default PDF app', 'ok');
    if (App.home) renderHome();
  });
  renderRail();
  activate(null);
  setTool('select');
  Host.rendererReady();
  document.body.classList.add('ready');
  setTimeout(hideSplash, 550);
  setTimeout(maybeAskDefault, 900);
}

boot();
