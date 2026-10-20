'use strict';
/* Takes clean screenshots of the real app for the website and store listings.
   Run with `npm run screenshots` (on Linux without a display: `xvfb-run -a npm run screenshots`).
   Images are written to website-kit/screenshots at 2x resolution. */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron } = require('playwright-core');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'website-kit', 'screenshots');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sahifa-shots-'));

// A realistic two-page agreement to show in the screenshots.
async function agreementPdf() {
  const doc = await PDFDocument.create();
  doc.setTitle('Service Agreement');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.13, 0.15, 0.2);
  const soft = rgb(0.42, 0.45, 0.52);
  const accent = rgb(0.24, 0.43, 1);
  const para = (page, text, y, size = 10.5) => {
    const words = text.split(' ');
    let line = '';
    for (const w of words) {
      const next = line ? line + ' ' + w : w;
      if (font.widthOfTextAtSize(next, size) > 475) { page.drawText(line, { x: 60, y, size, font, color: ink }); y -= size * 1.6; line = w; } else line = next;
    }
    if (line) { page.drawText(line, { x: 60, y, size, font, color: ink }); y -= size * 1.6; }
    return y - 8;
  };
  const header = (page) => {
    page.drawRectangle({ x: 0, y: 812, width: 595, height: 30, color: rgb(0.95, 0.96, 1) });
    page.drawText('MV DIGITAL TOOLS', { x: 60, y: 822, size: 10, font: bold, color: accent });
    page.drawText('Malé, Maldives  ·  mvdigital.tools', { x: 365, y: 822, size: 9, font, color: soft });
  };

  let page = doc.addPage([595, 842]);
  header(page);
  page.drawText('Service Agreement', { x: 60, y: 750, size: 26, font: bold, color: ink });
  page.drawText('Agreement No. MVDT-2026-041   ·   20 October 2026', { x: 60, y: 728, size: 10, font, color: soft });
  page.drawLine({ start: { x: 60, y: 712 }, end: { x: 535, y: 712 }, thickness: 0.8, color: rgb(0.85, 0.87, 0.92) });
  let y = 685;
  page.drawText('1. Parties', { x: 60, y, size: 12.5, font: bold, color: ink }); y -= 22;
  y = para(page, 'This agreement is made between MV Digital Tools, Malé, Republic of Maldives ("the Provider"), and Island Retail Pvt Ltd, Hulhumalé ("the Client"), together "the Parties".', y);
  page.drawText('2. Services', { x: 60, y, size: 12.5, font: bold, color: ink }); y -= 22;
  y = para(page, 'The Provider will design, build and maintain a point-of-sale and inventory system for the Client, including staff training, data migration from the existing spreadsheets and twelve months of technical support.', y);
  page.drawText('3. Fees and payment', { x: 60, y, size: 12.5, font: bold, color: ink }); y -= 22;
  y = para(page, 'The total fee is MVR 48,500, payable in three instalments: 40% on signing, 40% on delivery and 20% thirty days after go-live. Invoices are due within fourteen days of issue.', y);
  page.drawText('4. Confidentiality', { x: 60, y, size: 12.5, font: bold, color: ink }); y -= 22;
  y = para(page, 'Each Party will keep the other Party\'s business information confidential and will use it only to perform this agreement, during its term and for three years after it ends.', y);
  page.drawText('5. Signatures', { x: 60, y, size: 12.5, font: bold, color: ink }); y -= 22;
  y = para(page, 'By signing below, the Parties confirm that they have read and agree to the terms of this agreement.', y);
  for (const [x, who, role] of [[60, 'For MV Digital Tools', 'Managing Director'], [330, 'For Island Retail Pvt Ltd', 'Director']]) {
    page.drawLine({ start: { x, y: 150 }, end: { x: x + 205, y: 150 }, thickness: 0.8, color: soft });
    page.drawText(who, { x, y: 134, size: 10, font: bold, color: ink });
    page.drawText(role, { x, y: 120, size: 9.5, font, color: soft });
  }
  page.drawText('Page 1 of 2', { x: 270, y: 40, size: 8.5, font, color: soft });

  page = doc.addPage([595, 842]);
  header(page);
  page.drawText('Schedule A: Delivery plan', { x: 60, y: 750, size: 18, font: bold, color: ink });
  y = 715;
  for (const [w, t] of [['Week 1-2', 'Requirements workshop and data review'], ['Week 3-6', 'Build and internal testing'], ['Week 7', 'Data migration and staff training'], ['Week 8', 'Go-live and on-site support']]) {
    page.drawText(w, { x: 60, y, size: 11, font: bold, color: accent });
    page.drawText(t, { x: 160, y, size: 11, font, color: ink });
    y -= 26;
  }
  page.drawText('Page 2 of 2', { x: 270, y: 40, size: 8.5, font, color: soft });
  return doc.save();
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(TMP, 'Service Agreement.pdf');
  fs.writeFileSync(file, await agreementPdf());
  const home = path.join(TMP, 'home');
  fs.mkdirSync(home, { recursive: true });
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', SAHIFA_USER_DATA: path.join(TMP, 'profile'), HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local', 'share') };
  const app = await _electron.launch({ executablePath: require('electron'), args: [ROOT, '--no-sandbox', '--force-device-scale-factor=2', file], env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setContentSize(1440, 900); });
  win.setDefaultTimeout(10000);
  global.__win = win;
  const settle = (ms = 500) => win.waitForTimeout(ms);
  const shot = async (name) => { await settle(600); await win.screenshot({ path: path.join(OUT_DIR, name + '.png') }); console.log('  ✓', name); };
  const at = async (x, y) => win.evaluate(([px, py]) => {
    const pe = Viewer.els[0];
    const v = document.getElementById('viewer');
    const vr = v.getBoundingClientRect();
    let r = pe.getBoundingClientRect();
    v.scrollTop += r.top + py * Viewer.scale - (vr.top + v.clientHeight / 2);
    r = pe.getBoundingClientRect();
    return { x: r.left + px * Viewer.scale, y: r.top + py * Viewer.scale };
  }, [x, y]);
  const place = async (x, y) => { const p = await at(x, y); await win.mouse.move(p.x - 20, p.y); await win.mouse.click(p.x, p.y); await settle(); };

  await win.waitForFunction(() => typeof App !== 'undefined' && App.docs.length === 1 && Viewer.els[0] && Viewer.els[0]._key, null, { timeout: 30000 });
  const later = await win.waitForSelector('#defaultLater', { timeout: 4000 }).catch(() => null);
  if (later) await later.click();
  await win.addStyleTag({ content: '#toasts{display:none!important}' });

  // Home screen
  await win.evaluate(() => showHome());
  await shot('01-home');

  // Sign: a typed signature, then a company seal designed in the app.
  await win.evaluate(() => activate(App.docs[0]));
  await win.evaluate(() => { App.run('zoom-width'); App.run('zoom-out'); App.run('zoom-out'); });
  await settle();
  await win.click('#rail .rail-btn:has-text("Fill & Sign")');
  await win.click('#toolGroups .tb-btn:has-text("Signature")');
  await win.waitForSelector('.dlg-sign');
  await win.click('.seg-btn:has-text("Type")');
  await win.fill('#sigName', 'Ahmed Rasheed');
  await shot('03-signature-pad');
  await win.click('.dlg-actions .btn-primary');
  await win.waitForSelector('.dlg-sign', { state: 'detached' });
  await place(150, 668);

  await win.click('#toolGroups .tb-btn:has-text("Seal")');
  await win.waitForSelector('.lib-picker');
  await win.click('.lib-picker .btn:has-text("Design a seal")');
  await win.waitForSelector('.dlg-seal');
  await win.fill('#sealTop', 'MV DIGITAL TOOLS');
  await win.fill('#sealBottom', 'MALE · MALDIVES');
  await win.fill('#sealCenter', 'APPROVED');
  await win.fill('#sealName', 'Company seal');
  await shot('04-seal-designer');
  await win.click('#sealPlace');
  await place(318, 636);
  await win.keyboard.press('Escape');
  await win.mouse.click(5, 450);
  await at(300, 560);
  await shot('02-signed-document');

  // Saved signatures & seals picker
  await win.click('#toolGroups .tb-btn:has-text("Seal")');
  await win.waitForSelector('.lib-picker .lib-pick');
  await shot('05-quick-picker');
  await win.keyboard.press('Escape');

  // PIN lock
  await win.evaluate(() => { App.run('library'); });
  await win.waitForSelector('.dlg-library');
  await win.click('#libSecurity');
  await win.click('#pinTurnOn');
  await win.fill('#pinNew', '482916');
  await win.fill('#pinConfirm', '482916');
  await win.click('#pinSave');
  await win.waitForSelector('#pinLockNow', { timeout: 20000 });
  await win.click('#pinLockNow');
  await win.waitForFunction(() => !document.querySelector('.dlg-library'), null, { timeout: 10000 });
  await win.click('#toolGroups .tb-btn:has-text("Signature")');
  await win.waitForSelector('#libPin');
  await win.fill('#libPin', '4829');
  await shot('06-pin-lock');
  await win.fill('#libPin', '482916');
  await win.click('#pinUnlock');
  await win.waitForSelector('#libPin', { state: 'detached', timeout: 20000 });
  await win.keyboard.press('Escape');

  // Page organizer
  await win.evaluate(() => { App.run('organize'); });
  await win.waitForSelector('.org-card');
  await shot('07-organize-pages');
  await win.click('.org-bar .btn-primary');

  // Dark mode
  await win.evaluate(() => { App.run('theme'); });
  await win.click('#rail .rail-btn:has-text("Fill & Sign")');
  await at(300, 560);
  await shot('08-dark-mode');

  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\nScreenshots saved in ${OUT_DIR}`);
}

main().catch(async (e) => {
  console.error(e.message);
  if (global.__win) await global.__win.screenshot({ path: path.join(TMP, 'failure.png') }).then(() => console.error('Failure screenshot:', path.join(TMP, 'failure.png'))).catch(() => {});
  process.exit(1);
});
