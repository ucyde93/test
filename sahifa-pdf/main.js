'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fss = require('fs');
const crypto = require('crypto');
const digital = require('./lib/digital-sign');

const isMac = process.platform === 'darwin';
let win = null;
let rendererReady = false;
let pendingPaths = [];
let anyDirty = false;
let allowClose = false;

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
    backgroundColor: '#e6e9e7',
    icon: path.join(__dirname, 'build', 'icon.png'),
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
  win.on('closed', () => { win = null; rendererReady = false; });

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
      ],
    },
    {
      label: 'Help',
      submenu: [
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

ipcMain.handle('recent-get', () => getRecent());
ipcMain.handle('show-in-folder', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('open-external', (_e, url) => {
  if (/^(https?:|mailto:)/i.test(url)) return shell.openExternal(url);
});
ipcMain.handle('app-info', () => ({ version: app.getVersion(), platform: process.platform, electron: process.versions.electron }));

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
    pendingPaths.push(...pdfPathsFromArgv(process.argv.slice(1)));
    buildMenu();
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}
