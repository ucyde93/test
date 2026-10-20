'use strict';
/* End-to-end test: drives the real Electron app and checks the PDFs it writes.
   Run with `npm test` (on Linux without a display: `xvfb-run -a npm test`). */

const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const { _electron } = require('playwright-core');
const { PDFDocument } = require('pdf-lib');
const fixtures = require('./fixtures');

const ROOT = path.join(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'sahifa-e2e-'));
const SHOTS = process.env.SAHIFA_SHOTS || OUT;
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

let step = 0;
const log = (msg) => console.log(`  ✓ ${String(++step).padStart(2, '0')} ${msg}`);

async function readPdf(file, password) {
  const data = new Uint8Array(fs.readFileSync(file));
  return pdfjs.getDocument({ data, password, verbosity: 0, isEvalSupported: false }).promise;
}
async function pageText(doc, n) {
  const p = await doc.getPage(n);
  return (await p.getTextContent()).items.map((i) => i.str).join(' ');
}

async function main() {
  const sample = path.join(OUT, 'sample.pdf');
  const form = path.join(OUT, 'form.pdf');
  fs.writeFileSync(sample, await fixtures.samplePdf());
  fs.writeFileSync(form, await fixtures.formPdf());

  // A private profile and home folder keep the test away from the real user's settings,
  // including their default PDF app.
  const home = path.join(OUT, 'home');
  fs.mkdirSync(home, { recursive: true });
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', SAHIFA_USER_DATA: path.join(OUT, 'profile'), HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local', 'share') };
  const app = await _electron.launch({ executablePath: require('electron'), args: [ROOT, '--no-sandbox', sample], env });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await win.setViewportSize({ width: 1400, height: 900 }).catch(() => {});

  const stubSave = (file) => app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, file);
  const stubOpen = (files) => app.evaluate(({ dialog }, ps) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ps }); }, files);
  const shot = (name) => win.screenshot({ path: path.join(SHOTS, name + '.png') });
  const settle = (ms = 400) => win.waitForTimeout(ms);
  const waitIdle = () => win.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 30000 });
  // Converts display units on a page into window coordinates.
  const at = async (pageIndex, x, y) => win.evaluate(([i, px, py]) => {
    const pe = Viewer.els[i];
    const v = document.getElementById('viewer');
    const vr = v.getBoundingClientRect();
    let r = pe.getBoundingClientRect();
    v.scrollTop += r.top + py * Viewer.scale - (vr.top + v.clientHeight / 2);
    v.scrollLeft += r.left + px * Viewer.scale - (vr.left + v.clientWidth / 2);
    r = pe.getBoundingClientRect();
    return { x: r.left + px * Viewer.scale, y: r.top + py * Viewer.scale };
  }, [pageIndex, x, y]);
  const saveAs = async (file) => {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    await stubSave(file);
    await win.evaluate(() => { App.active.dirty = true; });
    await run('save-as');
    await win.waitForFunction(() => !App.active.dirty && document.getElementById('busy').hidden, null, { timeout: 30000 });
    assert.ok(fs.existsSync(file), 'file written: ' + file);
  };
  // Fire a command without waiting for it: many commands wait on a dialog.
  const run = (cmd) => win.evaluate((c) => { App.run(c); }, cmd);
  const annCount = (i) => win.evaluate((k) => Viewer.doc.annotsAt(k).length, i);
  const clickRibbon = async (tab, label) => {
    await win.click(`#rail .rail-btn:has-text("${tab}")`);
    await win.click(`#toolGroups .tb-btn:has-text("${label}")`);
  };

  await win.waitForFunction(() => typeof App !== 'undefined' && App.docs.length === 1 && Viewer.els[0] && Viewer.els[0]._key, null, { timeout: 30000 });
  await settle(800);
  await shot('01-opened');
  assert.equal(await win.evaluate(() => Viewer.doc.pageCount), 3);
  log('opens a PDF passed on the command line');

  // ---- first run: offer to become the default PDF app ----
  const st0 = await win.evaluate(() => App.defaultStatus);
  if (st0 && st0.supported && process.platform === 'linux') {
    await win.waitForSelector('#defaultYes', { timeout: 10000 });
    await shot('00-first-run');
    await win.click('#defaultYes');
    await win.waitForFunction(() => App.defaultStatus && App.defaultStatus.isDefault, null, { timeout: 15000 });
    const q = execFileSync('xdg-mime', ['query', 'default', 'application/pdf'], { env, encoding: 'utf8' }).trim();
    assert.equal(q, 'mv-sahifa-pdf.desktop');
    const desktop = fs.readFileSync(path.join(home, '.local', 'share', 'applications', 'mv-sahifa-pdf.desktop'), 'utf8');
    assert.match(desktop, /MimeType=application\/pdf;/);
    await win.evaluate(() => showHome());
    await win.waitForSelector('.chip-ok');
    await shot('00-home');
    await win.evaluate(() => activate(App.docs[0]));
    log('first run makes Sahifa PDF the default PDF app (registered with the desktop)');
  } else {
    const later = await win.waitForSelector('#defaultLater', { timeout: 3000 }).catch(() => null);
    if (later) await later.click();
  }

  // ---- search ----
  await win.fill('#findInput', 'quick brown');
  await win.waitForFunction(() => Search.hits.length >= 3, null, { timeout: 10000 });
  assert.equal(await win.evaluate(() => Search.hits.length), 3);
  await win.fill('#findInput', '');
  await win.press('#findInput', 'Escape');
  log('finds text on every page');

  // ---- add text ----
  await clickRibbon('Comment', 'Text box');
  let p = await at(0, 60, 250);
  await win.mouse.click(p.x, p.y);
  await win.keyboard.type('Hello Sahifa');
  await win.keyboard.press('Escape');
  await settle();
  assert.equal(await annCount(0), 1);
  log('adds a text box by clicking and typing');

  // ---- highlight by selecting text ----
  await win.click('#toolGroups .tb-btn:has-text("Highlight")');
  const line = await win.evaluate(() => {
    const spans = [...Viewer.els[0].querySelectorAll('.textLayer span')];
    const s = spans.find((n) => n.textContent.includes('quick brown'));
    s.scrollIntoView({ block: 'center' });
    const r = s.getBoundingClientRect();
    return { x0: r.left + 2, x1: r.right - 2, y: r.top + r.height / 2 };
  });
  await win.mouse.move(line.x0, line.y);
  await win.mouse.down();
  await win.mouse.move(line.x1, line.y, { steps: 8 });
  await win.mouse.up();
  await settle();
  const hl = await win.evaluate(() => Viewer.doc.annotsAt(0).find((a) => a.type === 'highlight'));
  assert.ok(hl && hl.rects.length >= 1, 'highlight created from selection');
  log('highlights selected text');

  // ---- pen and rectangle ----
  await win.click('#toolGroups .tb-btn:has-text("Pen")');
  p = await at(0, 320, 600);
  await win.mouse.move(p.x, p.y);
  await win.mouse.down();
  for (let k = 1; k <= 12; k++) await win.mouse.move(p.x + k * 10, p.y + Math.sin(k) * 20);
  await win.mouse.up();
  await win.click('#toolGroups .tb-btn:has-text("Rectangle")');
  p = await at(0, 60, 600);
  await win.mouse.move(p.x, p.y);
  await win.mouse.down();
  await win.mouse.move(p.x + 150, p.y + 80, { steps: 5 });
  await win.mouse.up();
  await settle();
  assert.deepEqual(await win.evaluate(() => Viewer.doc.annotsAt(0).map((a) => a.type).sort()), ['highlight', 'ink', 'rect', 'text']);
  log('draws with the pen and rectangle tools');

  // ---- move and resize the selected rectangle, then undo/redo ----
  const before = await win.evaluate(() => ({ ...Viewer.doc.annotsAt(0).find((a) => a.type === 'rect') }));
  const rc = await win.evaluate(() => { const n = document.querySelector('.ann-rect'); const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await win.mouse.move(rc.x, rc.y);
  await win.mouse.down();
  await win.mouse.move(rc.x + 40, rc.y + 20, { steps: 5 });
  await win.mouse.up();
  const moved = await win.evaluate(() => ({ ...Viewer.doc.annotsAt(0).find((a) => a.type === 'rect') }));
  assert.ok(moved.x > before.x + 10 && moved.y > before.y + 5, 'rectangle moved');
  await win.keyboard.press('Control+z');
  await settle(200);
  const undone = await win.evaluate(() => ({ ...Viewer.doc.annotsAt(0).find((a) => a.type === 'rect') }));
  assert.ok(Math.abs(undone.x - before.x) < 0.01, 'undo restores position');
  await win.keyboard.press('Control+y');
  await settle(200);
  assert.ok(Math.abs((await win.evaluate(() => Viewer.doc.annotsAt(0).find((a) => a.type === 'rect').x)) - moved.x) < 0.01, 'redo');
  log('moves items, with undo and redo');

  // ---- edit existing text ----
  await clickRibbon('Edit', 'Edit text');
  await win.waitForSelector('.edit-cand');
  const cand = await win.evaluate(() => {
    const c = [...Viewer.els[0].querySelectorAll('.edit-cand')].find((n) => n._item.str.startsWith('Invoice total'));
    c.scrollIntoView({ block: 'center' });
    const r = c.getBoundingClientRect();
    return { x: r.left + 5, y: r.top + r.height / 2 };
  });
  await win.mouse.click(cand.x, cand.y);
  await settle(300);
  await win.keyboard.press('Control+a');
  await win.keyboard.type('Invoice total for page 1: 999.00 USD (corrected)');
  await win.keyboard.press('Escape');
  await settle();
  const edited = await win.evaluate(() => Viewer.doc.annotsAt(0).filter((a) => a.type === 'whiteout' || (a.type === 'text' && a.text.includes('corrected'))).length);
  assert.equal(edited, 2, 'white-out plus replacement text');
  await shot('02-edits');
  log('edits a line of existing text');

  // ---- sticky note ----
  await clickRibbon('Comment', 'Sticky note');
  p = await at(0, 500, 120);
  await win.mouse.click(p.x, p.y);
  await win.fill('.note-text', 'Please double-check this total.');
  await win.click('.note-pop .btn-primary');
  assert.ok(await win.evaluate(() => Viewer.doc.annotsAt(0).some((a) => a.type === 'note' && a.text.includes('double-check'))));
  log('adds a sticky note comment');

  // ---- typed signature ----
  await clickRibbon('Fill & Sign', 'Signature');
  await win.waitForSelector('.dlg-sign');
  await win.click('.seg-btn:has-text("Type")');
  await win.fill('#sigName', 'Aminath Test');
  await win.click('.dlg-actions .btn-primary');
  await win.waitForSelector('.dlg-sign', { state: 'detached' });
  p = await at(0, 400, 760);
  await win.mouse.move(p.x - 30, p.y);
  await win.mouse.click(p.x, p.y);
  await settle();
  const sig = await win.evaluate(() => Viewer.doc.annotsAt(0).find((a) => a.role === 'signature'));
  assert.ok(sig && sig.src.startsWith('data:image/png') && sig.w > 40, 'signature placed');
  log('creates a typed signature and places it');

  // ---- drawn initials ----
  await win.click('#toolGroups .tb-btn:has-text("Initials")');
  await win.waitForSelector('.dlg-sign');
  await win.click('.seg-btn:has-text("Draw")');
  const padBox = await win.evaluate(() => { const r = document.querySelector('.sig-pad').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await win.mouse.move(padBox.x + 60, padBox.y + 140);
  await win.mouse.down();
  for (let k = 0; k < 20; k++) await win.mouse.move(padBox.x + 60 + k * 12, padBox.y + 140 - Math.sin(k / 3) * 50);
  await win.mouse.up();
  await win.click('.dlg-actions .btn-primary');
  await win.waitForSelector('.dlg-sign', { state: 'detached' });
  p = await at(0, 120, 780);
  await win.mouse.click(p.x, p.y);
  assert.ok(await win.evaluate(() => Viewer.doc.annotsAt(0).some((a) => a.role === 'initials')));
  log('draws initials and places them');

  // ---- stamp and check mark ----
  await win.click('#toolGroups .tb-btn:has-text("Check")');
  p = await at(0, 40, 700);
  await win.mouse.click(p.x, p.y);
  await clickRibbon('Comment', 'Stamp');
  await win.click('.stamp-choice:has-text("APPROVED")');
  await win.click('.dlg-actions .btn-primary');
  p = await at(0, 420, 300);
  await win.mouse.click(p.x, p.y);
  await settle();
  assert.ok(await win.evaluate(() => Viewer.doc.annotsAt(0).some((a) => a.type === 'stamp' && a.text === 'APPROVED')));
  assert.ok(await win.evaluate(() => Viewer.doc.annotsAt(0).some((a) => a.type === 'symbol')));
  log('places a stamp and a check mark');

  // ---- signatures & seals library ----
  await win.evaluate(() => goToPage(0));
  await settle(300);
  assert.equal(await win.evaluate(() => Library.of('signature')[0].name), 'Aminath Test', 'typed signature saved under its name');
  assert.equal(await win.evaluate(() => Library.of('initials').length), 1, 'drawn initials saved');
  await clickRibbon('Fill & Sign', 'Signature');
  await win.waitForSelector('.lib-picker .lib-pick');
  await shot('08-signature-picker');
  await win.click('.lib-picker .lib-pick');
  p = await at(0, 330, 470);
  await win.mouse.move(p.x - 20, p.y);
  await win.mouse.click(p.x, p.y);
  await settle();
  assert.equal(await win.evaluate(() => Viewer.doc.annotsAt(0).filter((a) => a.role === 'signature').length), 2, 'saved signature placed from the picker');

  await win.click('#toolGroups .tb-btn:has-text("Seal")');
  await win.waitForSelector('.lib-picker');
  await win.click('.lib-picker .btn:has-text("Design a seal")');
  await win.waitForSelector('.dlg-seal');
  await win.fill('#sealTop', 'MV DIGITAL TOOLS');
  await win.fill('#sealBottom', 'MALE · MALDIVES');
  await win.fill('#sealCenter', 'APPROVED');
  await win.fill('#sealName', 'Company seal');
  await shot('09-seal-designer');
  await win.click('#sealPlace');
  p = await at(0, 470, 470);
  await win.mouse.move(p.x - 20, p.y);
  await win.mouse.click(p.x, p.y);
  await settle();
  assert.ok(await win.evaluate(() => Viewer.doc.annotsAt(0).some((a) => a.role === 'seal')), 'seal placed');

  await run('library');
  await win.waitForSelector('.dlg-library');
  await win.click('.dlg-library .seg-btn:has-text("Seals")');
  await win.click('.dlg-library .btn:has-text("Text stamp")');
  await win.fill('#stampText', 'Received');
  await win.fill('#stampNameLine', 'MV Digital Tools');
  await win.click('.dlg >> nth=1 >> .dlg-actions .btn-primary');
  await win.waitForFunction(() => Library.of('stamp').length === 1);
  await settle(300);
  await shot('10-library');
  // Export a backup, delete the stamp, then import the backup again.
  const libFile = path.join(OUT, 'backup.sahifalib');
  await stubSave(libFile);
  await win.click('.dlg-library .btn:has-text("Export")');
  await win.fill('#backupPw', 'backup-pass-123');
  await win.fill('#backupPw2', 'backup-pass-123');
  await win.click('#backupExport');
  for (let i = 0; i < 60 && !fs.existsSync(libFile); i++) await settle(250);
  await settle(300);
  assert.ok(fs.existsSync(libFile), 'library exported');
  assert.doesNotMatch(fs.readFileSync(libFile, 'utf8'), /data:image|Aminath/, 'backup is encrypted');
  await win.click('#libDone');
  await win.evaluate(() => Library.remove(Library.of('stamp')[0].id));
  await stubOpen([libFile]);
  await run('library');
  await win.waitForSelector('.dlg-library');
  await win.click('.dlg-library .btn:has-text("Import")');
  await win.fill('#importPw', 'wrong-password');
  await win.click('#importGo');
  await win.waitForSelector('.dlg-error:has-text("not correct")');
  await win.fill('#importPw', 'backup-pass-123');
  await win.click('#importGo');
  await win.waitForFunction(() => Library.of('stamp').length === 1, null, { timeout: 15000 });
  await win.click('#libDone');
  const outer = JSON.parse(fs.readFileSync(path.join(OUT, 'profile', 'library.json'), 'utf8'));
  const saved = outer.os ? null : JSON.parse(outer.body);
  if (saved) assert.deepEqual(saved.items.map((x) => x.kind).sort(), ['initials', 'seal', 'signature', 'stamp'], 'library stored on disk');
  // A saved stamp can be placed from the Seal picker.
  await win.click('#rail .rail-btn:has-text("Fill & Sign")');
  await win.click('#toolGroups .tb-btn:has-text("Seal")');
  await win.waitForSelector('.lib-picker .lib-pick');
  await win.click('.lib-picker .lib-pick:has-text("RECEIVED")');
  p = await at(0, 120, 640);
  await win.mouse.move(p.x - 20, p.y);
  await win.mouse.click(p.x, p.y);
  await settle();
  assert.ok(await win.evaluate(() => Viewer.doc.annotsAt(0).some((a) => a.type === 'stamp' && a.text === 'RECEIVED' && /MV Digital Tools/.test(a.sub))), 'saved stamp placed');
  log('saves signatures, seals and stamps to a library, places them, exports and imports an encrypted backup');

  // ---- PIN lock ----
  await run('library');
  await win.waitForSelector('.dlg-library');
  await win.click('#libSecurity');
  await win.click('#pinTurnOn');
  await win.fill('#pinNew', '123456');
  await win.fill('#pinConfirm', '123456');
  await win.click('#pinSave');
  await win.waitForSelector('.dlg-error:has-text("too easy")');
  await win.fill('#pinNew', '482916');
  await win.fill('#pinConfirm', '482916');
  await win.click('#pinSave');
  await win.waitForSelector('#pinLockNow', { timeout: 20000 });
  await shot('11-pin-on');
  const locked1 = JSON.parse(fs.readFileSync(path.join(OUT, 'profile', 'library.json'), 'utf8'));
  assert.equal(locked1.protection, 'pin');
  const diskText = fs.readFileSync(path.join(OUT, 'profile', 'library.json'), 'utf8');
  assert.doesNotMatch(diskText, /data:image|Aminath|RECEIVED|482916/, 'library file is encrypted and never contains the PIN');
  await win.click('#pinLockNow');
  await win.waitForFunction(() => !document.querySelector('.dlg-library'), null, { timeout: 10000 });
  assert.equal(await win.evaluate(() => Library.items.length), 0, 'nothing decrypted stays in the window');
  await win.click('#rail .rail-btn:has-text("Fill & Sign")');
  await win.click('#toolGroups .tb-btn:has-text("Seal")');
  await win.waitForSelector('#libPin');
  await shot('12-unlock');
  await win.fill('#libPin', '000000');
  await win.click('#pinUnlock');
  await win.waitForSelector('.dlg-error:has-text("Wrong PIN")', { timeout: 20000 });
  await win.fill('#libPin', '482916');
  await win.click('#pinUnlock');
  await win.waitForSelector('.lib-picker .lib-pick', { timeout: 20000 });
  assert.ok(await win.evaluate(() => Library.items.length) >= 4, 'library usable again after unlocking');
  await win.keyboard.press('Escape');
  log('PIN lock encrypts the library, locks on demand, rejects a wrong PIN and unlocks with the right one');

  // ---- text on the rotated page ----
  await win.evaluate(() => { setTool('select'); goToPage(2); });
  await settle(600);
  await clickRibbon('Comment', 'Text box');
  p = await at(2, 100, 100);
  await win.mouse.click(p.x, p.y);
  await win.keyboard.type('ROTATED PAGE NOTE');
  await win.keyboard.press('Escape');
  await settle();
  await shot('03-rotated');
  log('adds text on a rotated page');

  // ---- save and verify ----
  const out1 = path.join(OUT, 'edited.pdf');
  await saveAs(out1);
  const d1 = await readPdf(out1);
  assert.equal(d1.numPages, 3);
  const t1 = await pageText(d1, 1);
  assert.match(t1, /Hello Sahifa/);
  assert.match(t1, /999\.00 USD \(corrected\)/);
  assert.match(t1, /APPROVED/);
  const annots1 = await (await d1.getPage(1)).getAnnotations();
  assert.ok(annots1.some((a) => a.subtype === 'Text' && a.contentsObj.str.includes('double-check')), 'sticky note saved as a real PDF comment');
  const ops = await (await d1.getPage(1)).getOperatorList();
  assert.ok(ops.fnArray.includes(pdfjs.OPS.paintImageXObject), 'signature image drawn');
  // The rotated-page text must read horizontally where it was placed.
  const p3 = await d1.getPage(3);
  const vp3 = p3.getViewport({ scale: 1 });
  const rotItem = (await p3.getTextContent()).items.find((i) => i.str.includes('ROTATED PAGE NOTE'));
  assert.ok(rotItem, 'text on rotated page saved');
  const tx = pdfjs.Util.transform(vp3.transform, rotItem.transform);
  assert.ok(tx[0] > 0 && Math.abs(tx[1]) < 0.01, 'text is upright on screen');
  assert.ok(Math.abs(tx[4] - 103) < 4 && Math.abs(tx[5] - 100) < 16, `text lands where placed (got ${tx[4].toFixed(1)}, ${tx[5].toFixed(1)})`);
  log('saves every edit into the PDF (text, edits, stamp, signature, comment, rotation)');

  // ---- organize pages ----
  await run('organize');
  await win.waitForSelector('.org-card');
  await win.click('.org-card[data-index="1"]');
  await win.click('.org-actions .tb-btn:has-text("Duplicate")');
  await waitIdle();
  await win.waitForFunction(() => Viewer.doc.pageCount === 4);
  await win.click('.org-card[data-index="0"]');
  await win.click('.org-actions .tb-btn:has-text("Rotate right")');
  await waitIdle();
  await win.click('.org-card[data-index="3"]');
  await win.click('.org-actions .tb-btn:has-text("Delete")');
  await waitIdle();
  await win.waitForFunction(() => Viewer.doc.pageCount === 3);
  await win.click('.org-card[data-index="2"]');
  await win.click('.org-actions .tb-btn:has-text("Blank page")');
  await waitIdle();
  await win.waitForFunction(() => Viewer.doc.pageCount === 4);
  // Drag page 3 to the front.
  await win.locator('.org-card[data-index="2"]').dragTo(win.locator('.org-card[data-index="0"]'), { targetPosition: { x: 5, y: 40 } });
  await waitIdle();
  await settle(500);
  await shot('04-organizer');
  await win.click('.org-bar .btn-primary');
  // Opening and closing the organizer without changes keeps text selectable: the text
  // layer must be rebuilt even though the zoom did not change.
  await win.waitForFunction(() => Viewer.els[Viewer.current].querySelectorAll('.textLayer span').length > 0, null, { timeout: 15000 });
  await settle(500);
  await run('organize');
  await win.waitForSelector('.org-card');
  await win.click('.org-bar .btn-primary');
  await win.waitForFunction(() => Viewer.els[Viewer.current].querySelectorAll('.textLayer span').length > 0, null, { timeout: 15000 });
  const out2 = path.join(OUT, 'organized.pdf');
  await saveAs(out2);
  const d2 = await readPdf(out2);
  assert.equal(d2.numPages, 4);
  assert.equal((await d2.getPage(2)).rotate, 90, 'rotated first page moved to position 2');
  assert.match(await pageText(d2, 1), /Chapter 2/);
  assert.equal((await pageText(d2, 4)).trim(), '', 'blank page at the end');
  log('duplicates, rotates, deletes, inserts and drag-reorders pages');

  // ---- watermark & page numbers ----
  await run('watermark');
  await win.fill('.dlg input.inp >> nth=0', 'DRAFT COPY');
  await win.click('.dlg-actions .btn-primary');
  await waitIdle();
  await run('header-footer');
  await win.click('.dlg-actions .btn-primary');
  await waitIdle();
  const out3 = path.join(OUT, 'stamped.pdf');
  await saveAs(out3);
  const d3 = await readPdf(out3);
  const t3 = await pageText(d3, 2);
  assert.match(t3, /DRAFT COPY/);
  assert.match(t3, /Page 2 of 4/);
  log('adds a watermark and page numbers');

  // ---- redaction ----
  await win.evaluate(() => goToPage(0));
  await settle(500);
  await clickRibbon('Protect', 'Mark');
  const target = await win.evaluate(() => {
    const s = [...Viewer.els[0].querySelectorAll('.textLayer span')].find((n) => n.textContent.includes('Patience'));
    s.scrollIntoView({ block: 'center' });
    const r = s.getBoundingClientRect();
    return { x: r.left - 4, y: r.top - 4, w: r.width + 8, h: r.height + 8 };
  });
  await win.mouse.move(target.x, target.y);
  await win.mouse.down();
  await win.mouse.move(target.x + target.w, target.y + target.h, { steps: 6 });
  await win.mouse.up();
  await win.click('#toolGroups .tb-btn:has-text("Apply")');
  await win.click('.dlg-actions .btn-danger');
  await waitIdle();
  await settle(500);
  const out4 = path.join(OUT, 'redacted.pdf');
  await saveAs(out4);
  const d4 = await readPdf(out4);
  const t4 = await pageText(d4, 1);
  assert.doesNotMatch(t4, /Patience/, 'redacted text is gone');
  assert.doesNotMatch(fs.readFileSync(out4, 'latin1'), /Patience is beautiful/, 'not hidden in the file either');
  log('redacts content permanently');

  // ---- password protection ----
  await run('protect');
  const pw = await win.$$('.dlg input[type=password]');
  await pw[0].fill('s3cret!');
  await pw[1].fill('s3cret!');
  await win.click('.dlg-actions .btn-primary');
  const out5 = path.join(OUT, 'protected.pdf');
  await saveAs(out5);
  await assert.rejects(readPdf(out5), /password/i, 'needs a password');
  const d5 = await readPdf(out5, 's3cret!');
  assert.equal(d5.numPages, 4);
  log('encrypts with a password (AES-256)');

  // ---- reopen the protected file in the app ----
  const copy5 = path.join(OUT, 'protected-copy.pdf');
  fs.copyFileSync(out5, copy5);
  await stubOpen([copy5]);
  await run('open');
  await win.waitForSelector('#pwInput');
  await win.fill('#pwInput', 's3cret!');
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => App.docs.length === 2 && App.active.name === 'protected-copy.pdf', null, { timeout: 20000 });
  log('opens a password-protected PDF');

  // ---- forms ----
  await stubOpen([form]);
  await run('open');
  await win.waitForFunction(() => App.active && App.active.name === 'form.pdf', null, { timeout: 20000 });
  await win.waitForSelector('.formLayer .field-text');
  await win.fill('.formLayer .field-text', 'Aminath Test');
  await win.check('.formLayer .field-check');
  await win.selectOption('.formLayer .field-choice', 'Morocco');
  const out6 = path.join(OUT, 'filled.pdf');
  await saveAs(out6);
  const f6 = (await PDFDocument.load(fs.readFileSync(out6))).getForm();
  assert.equal(f6.getTextField('fullName').getText(), 'Aminath Test');
  assert.equal(f6.getCheckBox('agree').isChecked(), true);
  assert.deepEqual(f6.getDropdown('country').getSelected(), ['Morocco']);
  await shot('05-form');
  log('fills in form fields');

  // ---- create a form field ----
  await clickRibbon('Edit', 'Text field');
  p = await at(0, 160, 240);
  await win.mouse.move(p.x, p.y);
  await win.mouse.down();
  await win.mouse.move(p.x + 200, p.y + 22, { steps: 4 });
  await win.mouse.up();
  await waitIdle();
  await win.waitForFunction(() => document.querySelectorAll('.formLayer .field-text').length === 2, null, { timeout: 10000 });
  log('adds a new fillable field');

  // ---- digital signature with a new digital ID ----
  await win.evaluate(() => setTool('select'));
  await run('digital-sign');
  await win.click('.dlg .btn:has-text("Create new ID")');
  const idInputs = await win.$$('.dlg >> nth=1 >> input');
  await idInputs[0].fill('Aminath Test');
  await idInputs[1].fill('aminath@example.com');
  await idInputs[3].fill('pass1234');
  await idInputs[4].fill('pass1234');
  await win.click('.dlg >> nth=1 >> .dlg-actions .btn-primary');
  await win.waitForSelector('.id-row');
  await win.fill('#idPassword', 'pass1234');
  await win.click('.dlg-actions .btn-primary');
  p = await at(0, 330, 560);
  const out7 = path.join(OUT, 'signed.pdf');
  await stubSave(out7);
  await win.mouse.click(p.x, p.y);
  await waitIdle();
  await win.waitForFunction(() => App.active && App.active.name === 'signed.pdf', null, { timeout: 30000 });
  await settle(800);
  await shot('06-signed');
  const signed = fs.readFileSync(out7);
  const s = signed.toString('latin1');
  const m = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(s);
  assert.ok(m, 'has a ByteRange');
  const br = m.slice(1).map(Number);
  const content = Buffer.concat([signed.subarray(br[0], br[0] + br[1]), signed.subarray(br[2], br[2] + br[3])]);
  let hex = s.slice(br[0] + br[1] + 1, br[2] - 1).replace(/(00)+$/, '');
  fs.writeFileSync(path.join(OUT, 'sig.der'), Buffer.from(hex, 'hex'));
  fs.writeFileSync(path.join(OUT, 'content.bin'), content);
  const verify = execFileSync('openssl', ['cms', '-verify', '-binary', '-inform', 'DER', '-in', path.join(OUT, 'sig.der'), '-content', path.join(OUT, 'content.bin'), '-noverify', '-out', os.devNull], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  void verify;
  assert.ok(await win.evaluate(() => App.active.hasSignatures), 'app recognises the signature');
  log('signs with a self-signed digital ID (OpenSSL verifies the signature)');

  // ---- merge ----
  await stubOpen([sample, form]);
  await run('merge-files');
  await win.waitForFunction(() => App.active && App.active.name === 'Merged.pdf', null, { timeout: 30000 });
  assert.equal(await win.evaluate(() => App.active.pageCount), 4);
  log('merges PDFs');

  const stubFolder = (dir) => app.evaluate(({ dialog, shell }, d) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [d] });
    shell.openPath = async () => '';
  }, dir);

  // ---- Arabic text (scripts the standard PDF fonts cannot encode) ----
  await win.evaluate(() => goToPage(0));
  await clickRibbon('Comment', 'Text box');
  p = await at(0, 300, 320);
  await win.mouse.click(p.x, p.y);
  await win.keyboard.insertText('بسم الله الرحمن الرحيم');
  await win.keyboard.press('Escape');
  await settle();
  assert.ok(await win.evaluate(() => Viewer.doc.annotsAt(0).some((a) => a.type === 'text' && /الرحمن/.test(a.text))));
  log('types Arabic text');

  // ---- crop with undo ----
  const w0 = await win.evaluate(() => Viewer.doc.sizes[1].w);
  await win.evaluate(() => goToPage(1));
  await clickRibbon('Edit', 'Crop');
  p = await at(1, 50, 50);
  await win.mouse.move(p.x, p.y);
  await win.mouse.down();
  const p2 = await win.evaluate(() => ({ s: Viewer.scale }));
  await win.mouse.move(p.x + 400 * p2.s, p.y + 300 * p2.s, { steps: 5 });
  await win.mouse.up();
  await win.click('.dlg-actions .btn-primary');
  await waitIdle();
  await win.waitForFunction((w) => Math.abs(Viewer.doc.sizes[1].w - 400) < 2 && Viewer.doc.sizes[1].w !== w, w0);
  await win.keyboard.press('Control+z');
  await win.waitForFunction((w) => Math.abs(Viewer.doc.sizes[1].w - w) < 0.5, w0);
  log('crops a page, and undo restores it');

  // ---- document info ----
  await run('metadata');
  await win.fill('.dlg input.inp >> nth=0', 'Merged handbook');
  await win.click('.dlg-actions .btn-primary');

  // ---- attach a file ----
  const note = path.join(OUT, 'notes.txt');
  fs.writeFileSync(note, 'Attached notes, salam.');
  await stubOpen([note]);
  await run('attach');
  await waitIdle();
  await win.waitForFunction(() => Viewer.doc.pdf.getAttachments().then((a) => a && Object.keys(a).length === 1));
  const out8 = path.join(OUT, 'merged.pdf');
  await saveAs(out8);
  const d8 = await readPdf(out8);
  assert.equal((await d8.getMetadata()).info.Title, 'Merged handbook');
  const att = await d8.getAttachments();
  assert.equal(Buffer.from(Object.values(att)[0].content).toString(), 'Attached notes, salam.');
  const ops8 = await (await d8.getPage(1)).getOperatorList();
  assert.ok(ops8.fnArray.includes(pdfjs.OPS.paintImageXObject), 'Arabic text written as an image');
  log('saves document info, attachments and Arabic text');

  // ---- exports ----
  const txt = path.join(OUT, 'merged.txt');
  await stubSave(txt);
  await run('export-text');
  await waitIdle();
  await win.waitForTimeout(500);
  assert.match(fs.readFileSync(txt, 'utf8'), /--- Page 4 ---[\s\S]*Application form/);
  const imgDir = path.join(OUT, 'images');
  fs.mkdirSync(imgDir);
  await stubFolder(imgDir);
  await run('export-images');
  await win.click('.dlg-actions .btn-primary');
  await win.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 60000 });
  await win.waitForTimeout(800);
  const imgs = fs.readdirSync(imgDir).filter((f) => f.endsWith('.png'));
  assert.equal(imgs.length, 4);
  assert.equal(fs.readFileSync(path.join(imgDir, imgs[0])).subarray(1, 4).toString(), 'PNG');
  const ex = path.join(OUT, 'extract.pdf');
  await stubSave(ex);
  await run('extract');
  await win.fill('.dlg input.inp', '2-3');
  await win.click('.dlg-actions .btn-primary');
  await waitIdle();
  await win.waitForTimeout(500);
  assert.equal((await readPdf(ex)).numPages, 2);
  const splitDir = path.join(OUT, 'split');
  fs.mkdirSync(splitDir);
  await stubFolder(splitDir);
  await run('split');
  await win.fill('.dlg input[type=number]', '2');
  await win.click('.dlg-actions .btn-primary');
  await waitIdle();
  await win.waitForTimeout(800);
  assert.equal(fs.readdirSync(splitDir).filter((f) => f.endsWith('.pdf')).length, 2);
  log('exports text and images, extracts and splits pages');

  // ---- print (the system print dialog is replaced by a stub) ----
  await win.evaluate(() => { window.print = () => { window.__printed = document.querySelectorAll('#printRoot img').length; }; });
  await run('print');
  await win.waitForFunction(() => window.__printed !== undefined, null, { timeout: 30000 });
  assert.equal(await win.evaluate(() => window.__printed), 4);
  log('prepares every page for printing');

  // ---- theme & night mode render without errors ----
  await win.evaluate(() => { App.run('theme'); App.run('night'); });
  await settle(500);
  await shot('07-dark');
  await win.evaluate(() => { App.run('theme'); App.run('theme'); App.run('night'); });

  const real = errors.filter((e) => !/Autofill|DevTools|Electron Security|favicon|Warning:/.test(e));
  assert.deepEqual(real, [], 'no renderer errors');
  log('no renderer errors');

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy()));
  await app.close().catch(() => {});
  console.log(`\nAll ${step} checks passed. Output in ${OUT}`);
}

main().catch((e) => {
  console.error('\n✗ E2E failed:', e);
  process.exit(1);
});
