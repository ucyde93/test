'use strict';
// Encrypted storage for saved signatures, seals and stamps.
//
// Layers, outermost first:
//  1. The operating system's own protection (Electron safeStorage: Windows DPAPI,
//     macOS Keychain, Linux keyring). A copied file is unreadable on another
//     computer or user account.
//  2. With a PIN: the items are encrypted with a random 256-bit data key
//     (AES-256-GCM). The data key is wrapped with a key derived from the PIN using
//     scrypt (memory-hard, ~0.5 s per guess). The PIN itself is never stored.
// Wrong PINs are rate-limited, and the library can optionally erase itself after
// too many wrong attempts. While locked, no key or item exists in memory.

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const SCRYPT = { N: 1 << 17, r: 8, p: 1 };
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
const FREE_ATTEMPTS = 5;
const WIPE_AFTER = 10;
const MAX_DELAY_MS = 60 * 60 * 1000;
const PIN_RE = /^\d{6,12}$/;

function deriveKey(secret, salt, params = SCRYPT) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(secret).normalize('NFKC'), salt, 32, { ...params, maxmem: SCRYPT_MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function seal(key, plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(plain), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function open(key, box) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]);
}

class LibraryError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

class SecureLibrary {
  /** @param {{dir: string, safeStorage?: any, now?: () => number}} opts */
  constructor({ dir, safeStorage = null, now = Date.now }) {
    this.file = path.join(dir, 'library.json');
    this.stateFile = path.join(dir, 'library-security.json');
    this.ss = safeStorage;
    this.now = now;
    this.key = null; // data key, only while unlocked
  }

  // ---------- OS protection ----------
  osBackend() {
    try {
      if (!this.ss || !this.ss.isEncryptionAvailable()) return null;
      if (process.platform === 'linux' && this.ss.getSelectedStorageBackend) {
        const b = this.ss.getSelectedStorageBackend();
        if (b === 'basic_text' || b === 'unknown') return null; // no real keyring
      }
      return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'keychain' : 'keyring';
    } catch {
      return null;
    }
  }

  // ---------- files ----------
  async writeAtomic(file, text) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, text, { mode: 0o600 });
    await fs.rename(tmp, file);
  }

  async readOuter() {
    try { return JSON.parse(await fs.readFile(this.file, 'utf8')); } catch { return null; }
  }

  async readInner() {
    const raw = await this.readOuter();
    if (!raw) return { protection: 'none', inner: { items: [] }, os: false, empty: true };
    if (raw.version === 1 || Array.isArray(raw.items)) return { protection: 'none', inner: { items: raw.items || [] }, os: false };
    let text = raw.body;
    if (raw.os) {
      if (!this.ss) throw new LibraryError('OS_UNAVAILABLE', 'This library is protected by your computer account and cannot be opened here.');
      try { text = this.ss.decryptString(Buffer.from(raw.body, 'base64')); } catch {
        throw new LibraryError('OS_UNAVAILABLE', 'This library was locked by another computer or user account.');
      }
    }
    return { protection: raw.protection || 'none', inner: JSON.parse(text), os: !!raw.os };
  }

  async writeInner(protection, inner) {
    const text = JSON.stringify(inner);
    const os = !!this.osBackend();
    const body = os ? this.ss.encryptString(text).toString('base64') : text;
    await this.writeAtomic(this.file, JSON.stringify({ format: 'sahifa-library', version: 2, protection, os, body }));
  }

  async readState() {
    try { return { failed: 0, lockedUntil: 0, autoLockMinutes: 5, ...JSON.parse(await fs.readFile(this.stateFile, 'utf8')) }; } catch {
      return { failed: 0, lockedUntil: 0, autoLockMinutes: 5 };
    }
  }
  async writeState(patch) {
    const st = { ...(await this.readState()), ...patch };
    await this.writeAtomic(this.stateFile, JSON.stringify(st));
    return st;
  }

  // ---------- public API ----------
  async status() {
    const r = await this.readInner().catch((e) => ({ error: e }));
    const st = await this.readState();
    if (r.error) return { protection: 'unknown', locked: true, error: r.error.message, osProtection: this.osBackend(), ...st };
    return {
      protection: r.protection,
      locked: r.protection === 'pin' && !this.key,
      osProtection: r.empty ? this.osBackend() : r.os ? this.osBackend() || 'other' : null,
      wipeAfter: r.protection === 'pin' ? !!r.inner.wipeAfter : false,
      failed: st.failed,
      lockedUntil: st.lockedUntil > this.now() ? st.lockedUntil : 0,
      autoLockMinutes: st.autoLockMinutes,
    };
  }

  async getItems() {
    const { protection, inner } = await this.readInner();
    if (protection !== 'pin') return inner.items || [];
    if (!this.key) throw new LibraryError('LOCKED', 'The library is locked.');
    return JSON.parse(open(this.key, inner.box).toString('utf8'));
  }

  async setItems(items) {
    if (!Array.isArray(items)) throw new LibraryError('INVALID', 'Invalid library.');
    const { protection, inner } = await this.readInner();
    if (protection === 'pin') {
      if (!this.key) throw new LibraryError('LOCKED', 'The library is locked.');
      await this.writeInner('pin', { ...inner, box: seal(this.key, Buffer.from(JSON.stringify(items))) });
    } else {
      await this.writeInner('none', { items });
    }
  }

  /** Checks a PIN against the stored wrapped key. Counts failures and applies delays. */
  async tryPin(pin) {
    const { protection, inner } = await this.readInner();
    if (protection !== 'pin') return { ok: true, key: null };
    const st = await this.readState();
    if (st.lockedUntil > this.now()) return { ok: false, lockedUntil: st.lockedUntil, failed: st.failed };
    const kek = await deriveKey(pin, Buffer.from(inner.kdf.salt, 'base64'), { N: inner.kdf.N, r: inner.kdf.r, p: inner.kdf.p });
    try {
      const key = open(kek, inner.wrap);
      kek.fill(0);
      await this.writeState({ failed: 0, lockedUntil: 0 });
      return { ok: true, key };
    } catch {
      kek.fill(0);
      const failed = st.failed + 1;
      if (inner.wipeAfter && failed >= WIPE_AFTER) {
        await this.reset();
        return { ok: false, wiped: true, failed };
      }
      const lockedUntil = failed >= FREE_ATTEMPTS ? this.now() + Math.min(30000 * 2 ** (failed - FREE_ATTEMPTS), MAX_DELAY_MS) : 0;
      await this.writeState({ failed, lockedUntil });
      return { ok: false, failed, lockedUntil, wipeIn: inner.wipeAfter ? WIPE_AFTER - failed : null };
    }
  }

  async unlock(pin) {
    const r = await this.tryPin(pin);
    if (r.ok && r.key) { this.lock(); this.key = r.key; }
    const { key, ...rest } = r;
    void key;
    return rest;
  }

  lock() {
    if (this.key) { this.key.fill(0); this.key = null; }
  }

  /** Turns the PIN on, or changes it (the current PIN is required to change it). */
  async setPin({ pin, current, wipeAfter = false }) {
    if (!PIN_RE.test(String(pin || ''))) throw new LibraryError('BAD_PIN', 'Use 6 to 12 digits.');
    const { protection, inner } = await this.readInner();
    let items;
    if (protection === 'pin') {
      const r = await this.tryPin(current || '');
      if (!r.ok) throw Object.assign(new LibraryError('WRONG_PIN', r.wiped ? 'Too many wrong PINs. The library was erased.' : 'The current PIN is not correct.'), { result: r });
      items = JSON.parse(open(r.key, inner.box).toString('utf8'));
      r.key.fill(0);
    } else {
      items = inner.items || [];
    }
    const salt = crypto.randomBytes(16);
    const kek = await deriveKey(pin, salt);
    const key = crypto.randomBytes(32);
    const next = {
      kdf: { name: 'scrypt', ...SCRYPT, salt: salt.toString('base64') },
      wrap: seal(kek, key),
      box: seal(key, Buffer.from(JSON.stringify(items))),
      wipeAfter: !!wipeAfter,
    };
    kek.fill(0);
    await this.writeInner('pin', next);
    await this.writeState({ failed: 0, lockedUntil: 0 });
    this.lock();
    this.key = key;
  }

  async removePin({ current }) {
    const { protection, inner } = await this.readInner();
    if (protection !== 'pin') return;
    const r = await this.tryPin(current || '');
    if (!r.ok) throw Object.assign(new LibraryError('WRONG_PIN', r.wiped ? 'Too many wrong PINs. The library was erased.' : 'The PIN is not correct.'), { result: r });
    const items = JSON.parse(open(r.key, inner.box).toString('utf8'));
    r.key.fill(0);
    await this.writeInner('none', { items });
    this.lock();
  }

  async setWipeAfter(on) {
    const { protection, inner } = await this.readInner();
    if (protection !== 'pin') return;
    if (!this.key) throw new LibraryError('LOCKED', 'The library is locked.');
    await this.writeInner('pin', { ...inner, wipeAfter: !!on });
  }

  async setAutoLock(minutes) {
    return this.writeState({ autoLockMinutes: Math.max(0, Math.min(240, Number(minutes) || 0)) });
  }

  /** Erases the library completely (used for "Forgot PIN"). */
  async reset() {
    this.lock();
    await fs.rm(this.file, { force: true });
    await this.writeState({ failed: 0, lockedUntil: 0 });
  }

  // ---------- encrypted backups ----------
  static async encryptBackup(items, password) {
    if (!password || String(password).length < 8) throw new LibraryError('BAD_PASSWORD', 'Use a backup password of at least 8 characters.');
    const salt = crypto.randomBytes(16);
    const key = await deriveKey(password, salt);
    const box = seal(key, Buffer.from(JSON.stringify(items)));
    key.fill(0);
    return { format: 'sahifa-library-encrypted', version: 1, app: 'Sahifa PDF by MV Digital Tools', kdf: { name: 'scrypt', ...SCRYPT, salt: salt.toString('base64') }, box };
  }

  static async decryptBackup(obj, password) {
    if (!obj || obj.format !== 'sahifa-library-encrypted') throw new LibraryError('INVALID', 'This is not an encrypted Sahifa backup.');
    const key = await deriveKey(password || '', Buffer.from(obj.kdf.salt, 'base64'), { N: obj.kdf.N, r: obj.kdf.r, p: obj.kdf.p });
    try { return JSON.parse(open(key, obj.box).toString('utf8')); } catch {
      throw new LibraryError('WRONG_PASSWORD', 'That backup password is not correct.');
    } finally { key.fill(0); }
  }
}

module.exports = { SecureLibrary, LibraryError, PIN_RE, FREE_ATTEMPTS, WIPE_AFTER };
