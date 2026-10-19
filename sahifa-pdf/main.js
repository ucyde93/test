'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fss = require('fs');
const crypto = require('crypto');
const digital = require('./lib/digital-sign');
const defaultApp = require('./lib/default-app');

const isMac = process.platform === 'darwin';
if (process.env.SAHIFA_USER_DATA) app.setPath('userData', process.env.SAHIFA_USER_DATA);
let win = null;
let rendererReady = false;
let pendingPaths = [];
let anyDirty = false;
let allowClose = false;
let defaultCheckPending = false;
const CHROME = { light: { color: '#eef1fa', symbolColor: '#3a4258' }, dark: { color: '#141927', symbolColor: '#c9d0e0' } };

app.setAppUserModelId?.('com.mvdigitaltools.sahifapdf');
app.setAboutPanelOptions?.({
  applicationName: 'Sahifa PDF',
  copyright: '© 2026 MV Digital Tools. All rights reserved.',
  credits: 'A product of MV Digital Tools',
});

// ---------- helpers ----------
const userFile = (name) => path.join(app.getPath('userData'), name);
const idsDir = () => path.join(app.getPath('userData'), 'digital-ids');

function pdfPathsFromArgv(argv) {
  return argv.filter((a) => /\.pdf$/i.test(a) && fss.existsSync(a)).map((a) => path.resolve(a));
}

function openPaths(paths) {
  if (!paths.length) return;
  if (win && rendererReady) {
    win.webContents.send('open-paths', paths);
    if (win.isMinimized()) win.restore();
    win.focus();
  } else {
    pendingPaths.push(...paths);
    // macOS keeps the app running after its window is closed; reopen it for the file.
    if (!win && app.isReady()) createWindow();
  }
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2));
}

async function getRecent() {
  const list = await readJson(userFile('recent.json'), []);
  return list.filter((p) => fss.existsSync(p)).slice(0, 12);
}
async function addRecent(p) {
  const list = (await getRecent()).filter((x) => x !== p);
  list.unshift(p);
  await writeJson(userFile('recent.json'), list.slice(0, 12));
  app.addRecentDocument?.(p);
  buildMenu();
}

const FILTERS = {
  pdf: [{ name: 'PDF documents', extensions: ['pdf'] }],
  images: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
  pdfimages: [{ name: 'PDFs and images', extensions: ['pdf', 'png', 'jpg', 'jpeg'] }],
  pfx: [{ name: 'Digital ID (PKCS#12)', extensions: ['pfx', 'p12'] }],
  any: [{ name: 'All files', extensions: ['*'] }],
};

async function fileRecord(p) {
  const data = await fs.readFile(p);
  return { name: path.basename(p), path: p, data: new Uint8Array(data) };
}

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 880,
    minHeight: 560,
    title: 'Sahifa PDF',
    backgroundColor: '#f3f5fc',
    icon: path.join(__dirname, 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 16 } } : { titleBarOverlay: { ...CHROME.light, height: 46 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.on('close', (e) => {
    if (!anyDirty || allowClose) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Close without saving', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Unsaved changes',
      message: 'You have unsaved changes.',
      detail: 'Close Sahifa PDF and discard the changes you have not saved?',
    });
    if (choice === 0) {
      allowClose = true;
      win.close();
    }
  });
  win.on('closed', () => { win = null; rendererReady = false; if (secureLib) secureLib.lock(); });
  // After the user confirms the default app in Windows Settings or the Open With
  // dialog, they come back to this window: re-check and tell the page.
  win.on('focus', async () => {
    if (!defaultCheckPending || !win) return;
    const st = await defaultApp.status();
    win.webContents.send('default-status', st);
    if (st.isDefault) defaultCheckPending = false;
  });

  // Links inside PDFs open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
    }
  });
}

// ---------- menu ----------
function send(cmd, arg) {
  if (win) win.webContents.send('menu', cmd, arg);
}

async function buildMenu() {
  const recent = await getRecent();
  const item = (label, cmd, accelerator, extra = {}) => ({ label, accelerator, click: () => send(cmd), ...extra });
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        item('Open…', 'open', 'CmdOrCtrl+O'),
        {
          label: 'Open Recent',
          submenu: recent.length
            ? [
                ...recent.map((p) => ({ label: p, click: () => openPaths([p]) })),
                { type: 'separator' },
                { label: 'Clear Recent', click: async () => { await writeJson(userFile('recent.json'), []); buildMenu(); send('recent-changed'); } },
              ]
            : [{ label: 'No recent files', enabled: false }],
        },
        item('Create PDF from Images…', 'new-from-images'),
        item('New Blank PDF', 'new-blank'),
        { type: 'separator' },
        item('Save', 'save', 'CmdOrCtrl+S'),
        item('Save As…', 'save-as', 'CmdOrCtrl+Shift+S'),
        item('Save Flattened Copy…', 'save-flat'),
        {
          label: 'Export',
          submenu: [
            item('Pages as Images…', 'export-images'),
            item('Text (.txt)…', 'export-text'),
            item('Extract Pages…', 'extract'),
            item('Split Document…', 'split'),
          ],
        },
        { type: 'separator' },
        item('Print…', 'print', 'CmdOrCtrl+P'),
        { type: 'separator' },
        item('Document Properties…', 'properties'),
        { type: 'separator' },
        item('Close Tab', 'close-tab', 'CmdOrCtrl+W'),
        isMac ? { role: 'close', label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W' } : { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        item('Undo', 'undo', 'CmdOrCtrl+Z'),
        item('Redo', 'redo', isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y'),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        item('Find…', 'find', 'CmdOrCtrl+F'),
      ],
    },
    {
      label: 'View',
      submenu: [
        item('Zoom In', 'zoom-in', 'CmdOrCtrl+='),
        item('Zoom Out', 'zoom-out', 'CmdOrCtrl+-'),
        item('Actual Size', 'zoom-actual', 'CmdOrCtrl+0'),
        item('Fit Width', 'zoom-width', 'CmdOrCtrl+2'),
        item('Fit Page', 'zoom-page', 'CmdOrCtrl+1'),
        { type: 'separator' },
        item('Show/Hide Sidebar', 'toggle-sidebar', 'F4'),
        item('Organize Pages', 'organize', 'CmdOrCtrl+Shift+O'),
        item('Night Reading Mode', 'night'),
        item('Toggle Dark Interface', 'theme'),
        item('Read Page Aloud', 'read-aloud', 'CmdOrCtrl+Shift+Y'),
        { type: 'separator' },
        item('Presentation Mode', 'present', 'CmdOrCtrl+L'),
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Tools',
      submenu: [
        item('Fill & Sign: Add Signature…', 'sign'),
        item('Sign with Digital ID…', 'digital-sign'),
        item('Manage Digital IDs…', 'digital-ids'),
        { type: 'separator' },
        item('Protect with Password…', 'protect'),
        item('Redact: Apply Redactions', 'apply-redactions'),
        item('Remove Hidden Information', 'sanitize'),
        { type: 'separator' },
        item('Add Watermark…', 'watermark'),
        item('Add Page Numbers / Header & Footer…', 'header-footer'),
        item('Edit Document Info…', 'metadata'),
        item('Attach a File…', 'attach'),
        { type: 'separator' },
        item('My Signatures & Seals…', 'library'),
        item('Signatures & Seals Privacy (PIN Lock)…', 'library-security'),
        item('Lock Signatures & Seals', 'library-lock', 'CmdOrCtrl+Shift+L'),
      ],
    },
    {
      label: 'Help',
      submenu: [
        item('Make Sahifa My Default PDF App…', 'make-default'),
        { type: 'separator' },
        item('Keyboard Shortcuts', 'shortcuts', 'F1'),
        item('About Sahifa PDF', 'about'),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC ----------
ipcMain.on('renderer-ready', () => {
  rendererReady = true;
  const paths = pendingPaths.splice(0);
  if (paths.length) win.webContents.send('open-paths', paths);
});
ipcMain.on('set-dirty', (_e, dirty) => { anyDirty = !!dirty; win?.setDocumentEdited?.(anyDirty); });
ipcMain.on('set-title', (_e, title) => { if (win) win.setTitle(title); });

ipcMain.handle('open-dialog', async (_e, { multi = true, kind = 'pdf', title } = {}) => {
  const res = await dialog.showOpenDialog(win, {
    title: title || 'Open',
    properties: ['openFile', ...(multi ? ['multiSelections'] : [])],
    filters: FILTERS[kind] || FILTERS.pdf,
  });
  if (res.canceled) return [];
  return Promise.all(res.filePaths.map(fileRecord));
});

ipcMain.handle('read-file', async (_e, p) => fileRecord(p));

ipcMain.handle('save-file', async (_e, { data, path: target, suggestedName = 'document.pdf', saveAs = false, kind = 'pdf' }) => {
  let out = target;
  if (!out || saveAs) {
    const res = await dialog.showSaveDialog(win, {
      title: 'Save',
      defaultPath: target ? path.join(path.dirname(target), suggestedName) : suggestedName,
      filters: kind === 'any' ? FILTERS.any : kind === 'txt' ? [{ name: 'Text', extensions: ['txt'] }] : kind === 'pfx' ? FILTERS.pfx : FILTERS.pdf,
    });
    if (res.canceled || !res.filePath) return null;
    out = res.filePath;
  }
  // Write to a temp file first so a failed write never corrupts the original.
  const tmp = out + '.sahifa-tmp';
  await fs.writeFile(tmp, Buffer.from(data));
  await fs.rename(tmp, out);
  if (/\.pdf$/i.test(out)) await addRecent(out);
  return { path: out, name: path.basename(out) };
});

ipcMain.handle('save-many', async (_e, { files, title }) => {
  const res = await dialog.showOpenDialog(win, {
    title: title || 'Choose a folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const dir = res.filePaths[0];
  for (const f of files) await fs.writeFile(path.join(dir, f.name), Buffer.from(f.data));
  shell.openPath(dir);
  return { dir, count: files.length };
});

ipcMain.handle('recent-get', async () => (await getRecent()).map((p) => {
  const st = fss.statSync(p);
  return { path: p, name: path.basename(p), size: st.size, mtime: st.mtimeMs };
}));
ipcMain.handle('show-in-folder', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('open-external', (_e, url) => {
  if (/^(https?:|mailto:)/i.test(url)) return shell.openExternal(url);
});
ipcMain.handle('app-info', () => ({ version: app.getVersion(), platform: process.platform, electron: process.versions.electron, company: 'MV Digital Tools' }));

// ---------- window chrome ----------
ipcMain.on('set-chrome', (_e, theme) => {
  if (!win || isMac || !win.setTitleBarOverlay) return;
  try { win.setTitleBarOverlay({ ...(CHROME[theme] || CHROME.light), height: 46 }); } catch { /* not supported */ }
});
ipcMain.on('menu-popup', (_e, { x, y }) => {
  const menu = Menu.getApplicationMenu();
  if (menu && win) menu.popup({ window: win, x: Math.round(x), y: Math.round(y) });
});

// ---------- default PDF app ----------
async function welcomePdfPath() {
  const file = userFile('Welcome to Sahifa PDF.pdf');
  if (fss.existsSync(file)) return file;
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.08, 0.09, 0.11);
  const muted = rgb(0.38, 0.41, 0.46);
  const accent = rgb(0.18, 0.36, 0.92);
  page.drawRectangle({ x: 0, y: 741.89, width: 595.28, height: 100, color: rgb(0.08, 0.09, 0.11) });
  page.drawText('Sahifa PDF', { x: 56, y: 790, size: 26, font: bold, color: rgb(1, 1, 1) });
  page.drawText('A PRODUCT OF MV DIGITAL TOOLS', { x: 56, y: 766, size: 9, font: bold, color: rgb(0.62, 0.68, 0.98) });
  page.drawText('Welcome. You are all set.', { x: 56, y: 680, size: 22, font: bold, color: ink });
  const lines = [
    'Sahifa PDF opens, fills, signs, edits and organizes PDF files on your computer.',
    'It is free, works offline, and never uploads your documents anywhere.',
    '',
    'Quick tips',
    '  •  Drag any PDF onto the window to open it.',
    '  •  Fill & Sign: type, draw or upload your signature and place it anywhere.',
    '  •  Edit: click a line of existing text to change it.',
    '  •  Organize: drag pages to reorder, rotate, merge and split.',
    '  •  Protect: add a password or permanently redact sensitive content.',
  ];
  lines.forEach((t, i) => page.drawText(t, { x: 56, y: 640 - i * 22, size: t === 'Quick tips' ? 13 : 11.5, font: t === 'Quick tips' ? bold : font, color: t === 'Quick tips' ? accent : muted }));
  page.drawText('© 2026 MV Digital Tools', { x: 56, y: 48, size: 9, font, color: muted });
  pdf.setTitle('Welcome to Sahifa PDF');
  pdf.setAuthor('MV Digital Tools');
  await fs.writeFile(file, await pdf.save());
  return file;
}

// ---------- signatures, seals and stamps library (encrypted) ----------
const { SecureLibrary } = require('./lib/secure-library');
let secureLib = null;
let autoLockTimer = null;
const lib = () => {
  if (!secureLib) secureLib = new SecureLibrary({ dir: app.getPath('userData'), safeStorage: require('electron').safeStorage });
  return secureLib;
};
async function lockLibrary(reason) {
  if (!secureLib || !secureLib.key) return;
  secureLib.lock();
  clearTimeout(autoLockTimer);
  if (win) win.webContents.send('library-locked', reason);
}
async function armAutoLock() {
  clearTimeout(autoLockTimer);
  if (!secureLib || !secureLib.key) return;
  const { autoLockMinutes } = await secureLib.readState();
  if (autoLockMinutes > 0) autoLockTimer = setTimeout(() => lockLibrary('idle'), autoLockMinutes * 60 * 1000);
}
// Errors cross IPC as plain messages; prefix the code so the page can react to it.
const libCall = (fn) => async (...args) => {
  try { return await fn(...args); } catch (e) { throw new Error(`${e.code || 'ERROR'}: ${e.message}`); }
};
ipcMain.handle('library-status', libCall(() => lib().status()));
ipcMain.handle('library-get', libCall(async () => { const items = await lib().getItems(); armAutoLock(); return items; }));
ipcMain.handle('library-set', libCall(async (_e, items) => { await lib().setItems(items); armAutoLock(); return true; }));
ipcMain.handle('library-unlock', libCall(async (_e, pin) => { const r = await lib().unlock(String(pin || '')); if (r.ok) armAutoLock(); return r; }));
ipcMain.handle('library-lock', libCall(() => lockLibrary('manual')));
ipcMain.handle('library-set-pin', libCall(async (_e, o) => { await lib().setPin(o || {}); armAutoLock(); return true; }));
ipcMain.handle('library-remove-pin', libCall(async (_e, o) => { await lib().removePin(o || {}); return true; }));
ipcMain.handle('library-wipe-option', libCall((_e, on) => lib().setWipeAfter(on)));
ipcMain.handle('library-auto-lock', libCall(async (_e, minutes) => { await lib().setAutoLock(minutes); armAutoLock(); return true; }));
ipcMain.handle('library-reset', libCall(() => lib().reset()));
ipcMain.handle('library-export', libCall(async (_e, { password } = {}) => {
  const items = await lib().getItems();
  const data = password ? await SecureLibrary.encryptBackup(items, password) : { format: 'sahifa-library', version: 1, app: 'Sahifa PDF by MV Digital Tools', items };
  return new Uint8Array(Buffer.from(JSON.stringify(data)));
}));
ipcMain.handle('library-decrypt-backup', libCall(async (_e, { data, password }) => SecureLibrary.decryptBackup(JSON.parse(Buffer.from(data).toString('utf8')), password)));
ipcMain.on('library-activity', () => armAutoLock());

ipcMain.handle('default-status', () => defaultApp.status());
ipcMain.handle('default-set', async (_e, { via } = {}) => {
  const res = await defaultApp.makeDefault({ welcomePdf: await welcomePdfPath(), via });
  if (res.confirm) defaultCheckPending = true;
  return res;
});
ipcMain.handle('default-settings', () => defaultApp.openSystemSettings());

// ---------- Digital IDs ----------
async function listIds() {
  const index = await readJson(path.join(idsDir(), 'index.json'), []);
  return index.filter((x) => fss.existsSync(path.join(idsDir(), x.file)));
}
async function saveIdBytes(bytes, info) {
  await fs.mkdir(idsDir(), { recursive: true });
  const id = crypto.randomUUID();
  const file = id + '.pfx';
  await fs.writeFile(path.join(idsDir(), file), bytes);
  const index = await listIds();
  const entry = { id, file, ...info, added: new Date().toISOString() };
  index.push(entry);
  await writeJson(path.join(idsDir(), 'index.json'), index);
  return entry;
}

ipcMain.handle('ids-list', () => listIds());
ipcMain.handle('ids-create', async (_e, { name, email, org, password }) => {
  const bytes = digital.createSelfSignedId({ name, email, org, password });
  return saveIdBytes(bytes, digital.inspectId(bytes, password));
});
ipcMain.handle('ids-import', async (_e, { password }) => {
  const res = await dialog.showOpenDialog(win, { title: 'Import Digital ID', properties: ['openFile'], filters: FILTERS.pfx });
  if (res.canceled || !res.filePaths[0]) return null;
  const bytes = await fs.readFile(res.filePaths[0]);
  return saveIdBytes(bytes, digital.inspectId(bytes, password));
});
ipcMain.handle('ids-delete', async (_e, id) => {
  const index = await listIds();
  const hit = index.find((x) => x.id === id);
  if (hit) await fs.rm(path.join(idsDir(), hit.file), { force: true });
  await writeJson(path.join(idsDir(), 'index.json'), index.filter((x) => x.id !== id));
  return true;
});
ipcMain.handle('ids-export', async (_e, id) => {
  const hit = (await listIds()).find((x) => x.id === id);
  if (!hit) throw new Error('Digital ID not found.');
  const res = await dialog.showSaveDialog(win, { title: 'Export Digital ID', defaultPath: `${hit.name}.pfx`, filters: FILTERS.pfx });
  if (res.canceled || !res.filePath) return null;
  await fs.copyFile(path.join(idsDir(), hit.file), res.filePath);
  return res.filePath;
});
ipcMain.handle('digital-sign', async (_e, { data, id, password, reason, location, contactInfo }) => {
  const hit = (await listIds()).find((x) => x.id === id);
  if (!hit) throw new Error('Digital ID not found.');
  const p12 = await fs.readFile(path.join(idsDir(), hit.file));
  return digital.signPdf(data, p12, password, { reason, location, contactInfo, name: hit.name });
});

// ---------- lifecycle ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => openPaths(pdfPathsFromArgv(argv.slice(1))));
  app.on('open-file', (e, p) => { e.preventDefault(); openPaths([p]); });
  app.whenReady().then(() => {
    const { powerMonitor } = require('electron');
    for (const ev of ['lock-screen', 'suspend', 'user-did-resign-active']) powerMonitor.on(ev, () => lockLibrary(ev));
    pendingPaths.push(...pdfPathsFromArgv(process.argv.slice(1)));
    buildMenu();
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}
