'use strict';
/* Platform bridge. In the desktop app this is provided by preload.js; when the
   renderer is opened in a plain browser (handy for development) a fallback
   with file inputs and downloads is used instead. */

// Version shown by the browser build. Kept equal to package.json by test/version.test.js.
const WEB_APP_VERSION = '1.3.0';

function browserDownload(data, name, mime = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const ACCEPT = {
  pdf: 'application/pdf,.pdf',
  images: 'image/png,image/jpeg',
  pdfimages: 'application/pdf,.pdf,image/png,image/jpeg',
  pfx: '.pfx,.p12',
  any: '*/*',
};

const Host = window.sahifaHost || {
  isDesktop: false,
  platform: 'web',
  openDialog({ multi = true, kind = 'pdf' } = {}) {
    return new Promise((resolve) => {
      const input = el('input', { type: 'file', accept: ACCEPT[kind] || ACCEPT.pdf, multiple: multi, style: { display: 'none' } });
      document.body.append(input);
      input.addEventListener('change', async () => {
        const files = await Promise.all([...input.files].map(async (f) => ({ name: f.name, path: null, data: new Uint8Array(await f.arrayBuffer()) })));
        input.remove();
        resolve(files);
      });
      input.addEventListener('cancel', () => { input.remove(); resolve([]); });
      input.click();
    });
  },
  async readFile() { return null; },
  async saveFile({ data, suggestedName, kind }) {
    browserDownload(data, suggestedName, kind === 'txt' ? 'text/plain' : 'application/pdf');
    return { path: null, name: suggestedName };
  },
  async saveMany({ files }) {
    for (const f of files) { browserDownload(f.data, f.name, 'application/octet-stream'); await sleep(300); }
    return { dir: null, count: files.length };
  },
  async recentGet() { return []; },
  async showInFolder() {},
  async openExternal(url) { window.open(url, '_blank', 'noopener'); },
  async appInfo() { return { version: WEB_APP_VERSION, platform: 'web' }; },
  setDirty() {},
  setTitle(t) { document.title = t; },
  async idsList() { return []; },
  async idsCreate() { throw new Error('Digital IDs need the desktop app.'); },
  async idsImport() { throw new Error('Digital IDs need the desktop app.'); },
  async idsDelete() {},
  async idsExport() {},
  async digitalSign() { throw new Error('Certificate signing needs the desktop app.'); },
  async libraryGet() { return settingsGet('library', null); },
  async librarySet(items) { settingsSet('library', items); return true; },
  async libraryStatus() { return { protection: 'none', locked: false, osProtection: null, web: true, autoLockMinutes: 0 }; },
  async libraryUnlock() { return { ok: true }; },
  async libraryLock() {},
  async librarySetPin() { throw new Error('PIN lock needs the desktop app.'); },
  async libraryRemovePin() {},
  async libraryWipeOption() {},
  async libraryAutoLock() {},
  async libraryReset() { settingsSet('library', []); },
  async libraryExport() { return new TextEncoder().encode(JSON.stringify({ format: 'sahifa-library', version: 1, items: settingsGet('library', []) })); },
  async libraryDecryptBackup() { throw new Error('Encrypted backups need the desktop app.'); },
  libraryActivity() {},
  onLibraryLocked() {},
  async defaultStatus() { return { platform: 'web', supported: false, isDefault: false }; },
  async makeDefault() { return { error: 'Install the desktop app to make it your default PDF app.' }; },
  async openDefaultSettings() {},
  onDefaultStatus() {},
  setChrome() {},
  popupMenu() {},
  onMenu() {},
  onOpenPaths() {},
  rendererReady() {},
};
