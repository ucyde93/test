'use strict';
// Unit tests for the encrypted signatures & seals library. Run: node test/secure-library.test.js
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SecureLibrary } = require('../lib/secure-library');

// Stand-in for Electron's safeStorage: encryption bound to one "computer account".
function fakeSafeStorage(secret) {
  const key = crypto.createHash('sha256').update(secret).digest();
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString(s) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const d = Buffer.concat([c.update(s, 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), d]);
    },
    decryptString(b) {
      const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
      d.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
    },
  };
}

const ITEMS = [
  { id: 'a', kind: 'signature', name: 'Aminath Rasheed signature', src: 'data:image/png;base64,SIGNATUREPIXELS' },
  { id: 'b', kind: 'seal', name: 'MV Digital Tools seal', src: 'data:image/png;base64,SEALPIXELS' },
];
let n = 0;
const ok = (msg) => console.log(`  ✓ ${String(++n).padStart(2, '0')} ${msg}`);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sahifa-lib-'));
  let clock = Date.now();
  const lib = new SecureLibrary({ dir, safeStorage: fakeSafeStorage('alice@pc1'), now: () => clock });
  const fileText = () => fs.readFileSync(path.join(dir, 'library.json'), 'utf8');

  assert.deepEqual(await lib.getItems(), []);
  await lib.setItems(ITEMS);
  assert.deepEqual(await lib.getItems(), ITEMS);
  assert.doesNotMatch(fileText(), /SIGNATUREPIXELS|Aminath/, 'OS layer hides contents even without a PIN');
  ok('stores the library encrypted with the computer account, even without a PIN');

  const other = new SecureLibrary({ dir, safeStorage: fakeSafeStorage('mallory@pc2') });
  await assert.rejects(other.getItems(), (e) => e.code === 'OS_UNAVAILABLE');
  ok('a copied library file cannot be opened by another computer or account');

  await assert.rejects(lib.setPin({ pin: '12345' }), (e) => e.code === 'BAD_PIN');
  await assert.rejects(lib.setPin({ pin: 'abcdef' }), (e) => e.code === 'BAD_PIN');
  let t = Date.now();
  await lib.setPin({ pin: '482916' });
  const kdfMs = Date.now() - t;
  assert.deepEqual(await lib.getItems(), ITEMS, 'still unlocked right after setting the PIN');
  assert.equal((await lib.status()).protection, 'pin');
  ok(`sets a 6–12 digit PIN (key derivation takes ${kdfMs} ms per guess)`);

  // Even with the OS layer removed (same account), the PIN layer still protects the items.
  const raw = JSON.parse(fileText());
  const inner = JSON.parse(fakeSafeStorage('alice@pc1').decryptString(Buffer.from(raw.body, 'base64')));
  assert.ok(inner.kdf && inner.wrap && inner.box && !JSON.stringify(inner).includes('SIGNATUREPIXELS'));
  assert.ok(!JSON.stringify(inner).includes('482916'), 'PIN itself is never stored');
  ok('inside the OS layer, items are AES-256-GCM encrypted and the PIN is never stored');

  lib.lock();
  assert.equal(lib.key, null);
  await assert.rejects(lib.getItems(), (e) => e.code === 'LOCKED');
  await assert.rejects(lib.setItems([]), (e) => e.code === 'LOCKED');
  assert.equal((await lib.status()).locked, true);
  ok('locking wipes the key from memory; nothing can be read or written while locked');

  for (let i = 1; i <= 4; i++) {
    const r = await lib.unlock('000000');
    assert.equal(r.ok, false);
    assert.equal(r.lockedUntil, 0, 'first wrong PINs are not delayed');
  }
  let r = await lib.unlock('000000');
  assert.equal(r.failed, 5);
  assert.ok(r.lockedUntil - clock >= 30000, 'delay after the 5th wrong PIN');
  r = await lib.unlock('482916');
  assert.equal(r.ok, false, 'even the right PIN is refused during the delay');
  clock += 31000;
  r = await lib.unlock('111111');
  assert.ok(r.lockedUntil - clock >= 60000, 'delay doubles');
  clock += 61000;
  r = await lib.unlock('482916');
  assert.equal(r.ok, true);
  assert.deepEqual(await lib.getItems(), ITEMS);
  assert.equal((await lib.status()).failed, 0, 'counter resets after success');
  ok('wrong PINs are rate-limited with doubling delays; the right PIN unlocks afterwards');

  await assert.rejects(lib.setPin({ pin: '777777', current: '999999' }), (e) => e.code === 'WRONG_PIN');
  await lib.setPin({ pin: '777777', current: '482916' });
  lib.lock();
  assert.equal((await lib.unlock('482916')).ok, false);
  clock += 10;
  assert.equal((await lib.unlock('777777')).ok, true);
  ok('changing the PIN requires the current PIN; the old PIN stops working');

  await lib.setWipeAfter(true);
  lib.lock();
  let last;
  for (let i = 0; i < 10; i++) { clock += 2 * 60 * 60 * 1000; last = await lib.unlock('123123'); }
  assert.equal(last.wiped, true);
  assert.equal(fs.existsSync(path.join(dir, 'library.json')), false);
  assert.deepEqual(await lib.getItems(), []);
  ok('optional self-erase after 10 wrong PINs');

  await lib.setItems(ITEMS);
  await lib.setPin({ pin: '246810' });
  await assert.rejects(lib.removePin({ current: '000000' }), (e) => e.code === 'WRONG_PIN');
  await lib.removePin({ current: '246810' });
  assert.equal((await lib.status()).protection, 'none');
  assert.deepEqual(await lib.getItems(), ITEMS);
  ok('turning the PIN off requires the PIN and keeps the items');

  const backup = await SecureLibrary.encryptBackup(ITEMS, 'correct horse battery');
  assert.doesNotMatch(JSON.stringify(backup), /SIGNATUREPIXELS|Aminath/);
  await assert.rejects(SecureLibrary.decryptBackup(backup, 'wrong password'), (e) => e.code === 'WRONG_PASSWORD');
  assert.deepEqual(await SecureLibrary.decryptBackup(backup, 'correct horse battery'), ITEMS);
  await assert.rejects(SecureLibrary.encryptBackup(ITEMS, 'short'), (e) => e.code === 'BAD_PASSWORD');
  ok('backups are encrypted with their own password');

  // Tampering with the encrypted data is detected rather than producing garbage.
  await lib.setPin({ pin: '135790' });
  const outer = JSON.parse(fileText());
  const ss = fakeSafeStorage('alice@pc1');
  const inner2 = JSON.parse(ss.decryptString(Buffer.from(outer.body, 'base64')));
  const bytes = Buffer.from(inner2.box.data, 'base64'); bytes[0] ^= 1; inner2.box.data = bytes.toString('base64');
  outer.body = ss.encryptString(JSON.stringify(inner2)).toString('base64');
  fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify(outer));
  await assert.rejects(lib.getItems());
  ok('tampered library data is rejected (authenticated encryption)');

  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sahifa-lib-'));
  fs.writeFileSync(path.join(dir2, 'library.json'), JSON.stringify({ format: 'sahifa-library', version: 1, items: ITEMS }));
  const legacy = new SecureLibrary({ dir: dir2, safeStorage: fakeSafeStorage('alice@pc1') });
  assert.deepEqual(await legacy.getItems(), ITEMS);
  await legacy.setItems(ITEMS);
  assert.doesNotMatch(fs.readFileSync(path.join(dir2, 'library.json'), 'utf8'), /SIGNATUREPIXELS/);
  ok('libraries from version 1.1 are read and re-saved encrypted');

  console.log(`\nAll ${n} security checks passed.`);
})().catch((e) => { console.error('\n✗ Security test failed:', e); process.exit(1); });
