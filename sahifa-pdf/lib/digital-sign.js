'use strict';
// Certificate-based (PKCS#7 / CMS) PDF signing, done entirely offline.
// Digital IDs are standard PKCS#12 (.pfx/.p12) files, so the same ID works in
// Adobe Acrobat and other readers.

const forge = require('node-forge');
const { PDFDocument } = require('pdf-lib');
const { pdflibAddPlaceholder } = require('@signpdf/placeholder-pdf-lib');
const { P12Signer } = require('@signpdf/signer-p12');
const signpdf = require('@signpdf/signpdf').default;

function attr(subject, shortName) {
  const f = subject.getField(shortName);
  return f ? String(f.value) : '';
}

/** Create a self-signed digital ID and return it as PKCS#12 bytes. */
function createSelfSignedId({ name, email = '', org = '', password, years = 5 }) {
  if (!name) throw new Error('A name is required for the digital ID.');
  if (!password || password.length < 4) throw new Error('Choose a password of at least 4 characters.');
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(15));
  const now = new Date();
  cert.validity.notBefore = new Date(now.getTime() - 60 * 1000);
  cert.validity.notAfter = new Date(now);
  cert.validity.notAfter.setFullYear(now.getFullYear() + years);
  const attrs = [{ name: 'commonName', value: name }];
  if (org) attrs.push({ name: 'organizationName', value: org });
  if (email) attrs.push({ name: 'emailAddress', value: email });
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
    { name: 'extKeyUsage', emailProtection: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {
    algorithm: '3des',
    friendlyName: name,
  });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
}

/** Open a PKCS#12 file and describe its certificate. Throws on a wrong password. */
function inspectId(p12Bytes, password) {
  let p12;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(p12Bytes).toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch (e) {
    throw new Error('Could not open this digital ID. Check the password.');
  }
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const keyBags =
    (p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [])
      .concat(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || []);
  if (!certBags.length || !keyBags.length) throw new Error('This file does not contain a certificate with a private key.');
  const cert = certBags[0].cert;
  return {
    name: attr(cert.subject, 'CN') || 'Unnamed ID',
    email: attr(cert.subject, 'E'),
    org: attr(cert.subject, 'O'),
    issuer: attr(cert.issuer, 'CN') || attr(cert.issuer, 'O'),
    selfSigned: cert.isIssuer(cert),
    notBefore: cert.validity.notBefore.toISOString(),
    notAfter: cert.validity.notAfter.toISOString(),
    serial: cert.serialNumber,
  };
}

/** Sign PDF bytes with a PKCS#12 ID. Returns the signed PDF bytes. */
async function signPdf(pdfBytes, p12Bytes, password, { reason = '', location = '', contactInfo = '', name = '' } = {}) {
  inspectId(p12Bytes, password); // clear error for a wrong password
  const pdfDoc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  pdflibAddPlaceholder({
    pdfDoc,
    reason: reason || 'I am the author of this document',
    location,
    contactInfo,
    name,
    signingTime: new Date(),
    signatureLength: 16384,
    appName: 'Sahifa PDF by MV Digital Tools',
  });
  const withPlaceholder = await pdfDoc.save({ useObjectStreams: false });
  const signer = new P12Signer(Buffer.from(p12Bytes), { passphrase: password });
  const signed = await signpdf.sign(Buffer.from(withPlaceholder), signer, new Date());
  return new Uint8Array(signed);
}

module.exports = { createSelfSignedId, inspectId, signPdf };
