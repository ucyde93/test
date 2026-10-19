'use strict';
// "Make Sahifa PDF my default PDF app" for Windows, macOS and Linux.
//
// Windows 10/11 do not let programs silently take over a file type: the user
// has to confirm in the "Open with" dialog or in Settings. We register the app
// properly (so it appears in both places) and open the confirmation for them.

const { app, shell } = require('electron');
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PROG_ID = 'MVDigitalTools.SahifaPDF.Document';
const APP_NAME = 'Sahifa PDF';
const COMPANY = 'MV Digital Tools';
const CAPS_KEY = `Software\\${COMPANY}\\${APP_NAME}\\Capabilities`;
const DESKTOP_ID = 'mv-sahifa-pdf.desktop';
const MAC_BUNDLE_ID = 'com.mvdigitaltools.sahifapdf';

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 15000, ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), err });
    });
  });
}

/** The command that launches this copy of the app with a file. */
function launchTarget() {
  if (process.platform === 'linux' && process.env.APPIMAGE) return { exe: process.env.APPIMAGE, args: [] };
  if (process.defaultApp) return { exe: process.execPath, args: [path.resolve(app.getAppPath())] };
  return { exe: process.execPath, args: [] };
}

// ---------------- Windows ----------------
async function regRead(key, value) {
  const args = ['query', key];
  if (value === '') args.push('/ve');
  else args.push('/v', value);
  const r = await run('reg', args);
  if (!r.ok) return null;
  const line = r.stdout.split(/\r?\n/).find((l) => /REG_(SZ|EXPAND_SZ)/.test(l));
  return line ? line.replace(/^.*?REG_(?:EXPAND_)?SZ\s*/, '').trim() : null;
}
const regAdd = (key, value, data) => run('reg', ['add', key, ...(value === '' ? ['/ve'] : ['/v', value]), '/t', 'REG_SZ', '/d', data, '/f']);

async function windowsRegister() {
  const { exe, args } = launchTarget();
  const cmd = [exe, ...args].map((a) => `"${a}"`).join(' ') + ' "%1"';
  const icon = `"${process.execPath}",0`;
  const C = 'HKCU\\Software\\Classes';
  await regAdd(`${C}\\${PROG_ID}`, '', 'PDF Document');
  await regAdd(`${C}\\${PROG_ID}`, 'FriendlyTypeName', 'PDF Document');
  await regAdd(`${C}\\${PROG_ID}\\DefaultIcon`, '', icon);
  await regAdd(`${C}\\${PROG_ID}\\shell\\open\\command`, '', cmd);
  await regAdd(`${C}\\${PROG_ID}\\Application`, 'ApplicationName', APP_NAME);
  await regAdd(`${C}\\${PROG_ID}\\Application`, 'ApplicationCompany', COMPANY);
  await regAdd(`${C}\\.pdf\\OpenWithProgids`, PROG_ID, '');
  await regAdd(`HKCU\\${CAPS_KEY}`, 'ApplicationName', APP_NAME);
  await regAdd(`HKCU\\${CAPS_KEY}`, 'ApplicationDescription', 'Free PDF reader and editor by MV Digital Tools');
  await regAdd(`HKCU\\${CAPS_KEY}`, 'ApplicationIcon', icon);
  await regAdd(`HKCU\\${CAPS_KEY}\\FileAssociations`, '.pdf', PROG_ID);
  await regAdd('HKCU\\Software\\RegisteredApplications', APP_NAME, CAPS_KEY);
}

async function windowsIsDefault() {
  const choice = await regRead('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.pdf\\UserChoice', 'ProgId');
  const progId = choice || (await regRead('HKCU\\Software\\Classes\\.pdf', '')) || (await regRead('HKCR\\.pdf', ''));
  if (!progId) return false;
  if (progId === PROG_ID) return true;
  // The user may have picked us through a different entry (e.g. Applications\Sahifa PDF.exe).
  const command = (await regRead(`HKCU\\Software\\Classes\\${progId}\\shell\\open\\command`, ''))
    || (await regRead(`HKCR\\${progId}\\shell\\open\\command`, ''));
  return !!command && command.toLowerCase().includes(path.basename(process.execPath).toLowerCase());
}

function windowsBuild() {
  return Number(os.release().split('.')[2] || 0);
}

// ---------------- macOS ----------------
const jxa = (script) => run('osascript', ['-l', 'JavaScript', '-e', script]);

async function macIsDefault() {
  const r = await jxa(`ObjC.import('CoreServices');
    var h = $.LSCopyDefaultRoleHandlerForContentType($('com.adobe.pdf'), $.kLSRolesAll);
    h ? ObjC.castRefToObject(h).js : ''`);
  return r.ok && r.stdout.trim().toLowerCase() === MAC_BUNDLE_ID;
}
async function macSetDefault() {
  const r = await jxa(`ObjC.import('CoreServices');
    $.LSSetDefaultRoleHandlerForContentType($('com.adobe.pdf'), $.kLSRolesAll, $('${MAC_BUNDLE_ID}'))`);
  return r.ok && r.stdout.trim() === '0';
}

// ---------------- Linux ----------------
function linuxDesktopFile() {
  const { exe, args } = launchTarget();
  const iconDir = path.join(os.homedir(), '.local', 'share', 'icons', 'hicolor', '512x512', 'apps');
  const iconSrc = path.join(__dirname, '..', 'build', 'icon.png');
  let icon = 'application-pdf';
  try {
    fs.mkdirSync(iconDir, { recursive: true });
    fs.copyFileSync(iconSrc, path.join(iconDir, 'mv-sahifa-pdf.png'));
    icon = 'mv-sahifa-pdf';
  } catch { /* keep the generic icon */ }
  const q = (s) => (/\s/.test(s) ? `"${s}"` : s);
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${APP_NAME}`,
    'GenericName=PDF Reader & Editor',
    `Comment=Read, fill, sign and edit PDFs. A product of ${COMPANY}.`,
    `Exec=${[exe, ...args].map(q).join(' ')} %F`,
    `Icon=${icon}`,
    'MimeType=application/pdf;',
    'Categories=Office;Viewer;',
    'Terminal=false',
    `StartupWMClass=${APP_NAME}`,
    '',
  ].join('\n');
}
async function linuxRegister() {
  const dir = path.join(os.homedir(), '.local', 'share', 'applications');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, DESKTOP_ID), linuxDesktopFile(), { mode: 0o755 });
  await run('update-desktop-database', [dir]);
}
async function linuxIsDefault() {
  const r = await run('xdg-mime', ['query', 'default', 'application/pdf']);
  return r.ok && r.stdout.trim() === DESKTOP_ID;
}

// ---------------- public API ----------------
async function status() {
  try {
    if (process.platform === 'win32') return { platform: 'win32', supported: true, isDefault: await windowsIsDefault() };
    if (process.platform === 'darwin') return { platform: 'darwin', supported: app.isPackaged, isDefault: app.isPackaged && (await macIsDefault()) };
    if (process.platform === 'linux') {
      const has = (await run('xdg-mime', ['--version'])).ok;
      return { platform: 'linux', supported: has, isDefault: has && (await linuxIsDefault()) };
    }
  } catch (e) {
    return { platform: process.platform, supported: false, isDefault: false, error: e.message };
  }
  return { platform: process.platform, supported: false, isDefault: false };
}

/**
 * Asks the operating system to make this app the default for PDFs.
 * Returns {done} when it is already the default afterwards, or {confirm}
 * naming the window the user must finish in.
 */
async function makeDefault({ welcomePdf, via } = {}) {
  if (process.platform === 'win32') {
    await windowsRegister();
    if (await windowsIsDefault()) return { done: true };
    if (via === 'settings' || !welcomePdf) {
      const url = windowsBuild() >= 22000
        ? `ms-settings:defaultapps?registeredAppUser=${encodeURIComponent(APP_NAME)}`
        : 'ms-settings:defaultapps';
      await shell.openExternal(url);
      return { confirm: 'settings' };
    }
    // The classic "How do you want to open this file?" dialog with an "Always" choice.
    spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', welcomePdf], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    return { confirm: 'openwith' };
  }
  if (process.platform === 'darwin') {
    if (!app.isPackaged) return { error: 'Install the app first, then set it as default.' };
    const ok = await macSetDefault();
    if (ok && (await macIsDefault())) return { done: true };
    return { confirm: 'finder' };
  }
  if (process.platform === 'linux') {
    await linuxRegister();
    await run('xdg-mime', ['default', DESKTOP_ID, 'application/pdf']);
    return (await linuxIsDefault()) ? { done: true } : { error: 'Your desktop did not accept the change.' };
  }
  return { error: 'This system is not supported.' };
}

async function openSystemSettings() {
  if (process.platform === 'win32') return shell.openExternal('ms-settings:defaultapps');
  if (process.platform === 'darwin') return shell.openPath('/System/Applications/System Settings.app');
  return null;
}

module.exports = { status, makeDefault, openSystemSettings, PROG_ID, APP_NAME, COMPANY, MAC_BUNDLE_ID };
