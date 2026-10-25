'use strict';
/* Compress PDF.
 *
 * Large images are almost always what makes a PDF big, so each image is scaled down
 * to the resolution its page actually needs and stored as JPEG. Text, vector drawings
 * and fonts are left untouched, so text stays sharp and selectable. Objects nothing
 * refers to any more are dropped and the file structure is packed into object streams.
 * Everything runs on this computer.
 */

const COMPRESS_LEVELS = {
  light: { label: 'Light', dpi: 200, quality: 0.85, note: 'Best quality, good for printing' },
  medium: { label: 'Recommended', dpi: 150, quality: 0.72, note: 'Sharp on screen and in print, much smaller' },
  strong: { label: 'Strong', dpi: 100, quality: 0.55, note: 'Smallest file, for email and uploads' },
};

// Images below this many pixels are icons and logos: too small to be worth re-encoding.
const MIN_PIXELS = 40000;
// Bigger images are left alone rather than risk running out of memory.
const MAX_PIXELS = 60e6;
// An image is only replaced when the new version is clearly smaller.
const MIN_SAVING = 0.9;

const nameOf = (o) => (o instanceof PDFName ? o.decodeText() : null);

function filterNames(dict) {
  const f = dict.lookup(PDFName.of('Filter'));
  if (!f) return [];
  if (f instanceof PDFName) return [nameOf(f)];
  if (f instanceof PDFArray) return f.asArray().map((x) => nameOf(dict.context.lookup(x)));
  return ['?'];
}

/** True when an image has no Decode array, or only the default one ([0 1 0 1 ...]). */
function defaultDecode(dict) {
  const d = dict.lookup(PDFName.of('Decode'));
  if (!d) return true;
  if (!(d instanceof PDFArray)) return false;
  return d.asArray().every((v, i) => { v = dict.context.lookup(v); return v instanceof PDFNumber && v.asNumber() === i % 2; });
}

/** Number of colour components for colour spaces we can re-encode, else null. */
function colorComponents(ctx, cs) {
  cs = ctx.lookup(cs);
  if (cs instanceof PDFName) return { DeviceRGB: 3, DeviceGray: 1, CalRGB: 3, CalGray: 1 }[nameOf(cs)] || null;
  if (cs instanceof PDFArray) {
    const kind = nameOf(ctx.lookup(cs.get(0)));
    if (kind === 'ICCBased') {
      const icc = ctx.lookup(cs.get(1));
      const n = icc instanceof PDFStream ? icc.dict.lookup(PDFName.of('N')) : null;
      const comps = n instanceof PDFNumber ? n.asNumber() : 0;
      return comps === 1 || comps === 3 ? comps : null;
    }
    if (kind === 'CalRGB') return 3;
    if (kind === 'CalGray') return 1;
  }
  return null; // CMYK, Indexed, Lab, Separation, DeviceN: left as they are
}

/** Undoes PNG predictors (Predictor 10-15), which many PDF writers use for images. */
function unpredictPng(data, colors, columns, bpc = 8) {
  const bpp = Math.max(1, (colors * bpc) >> 3);
  const rowLen = (colors * columns * bpc + 7) >> 3;
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  let prev = new Uint8Array(rowLen);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (rowLen + 1)];
    const src = data.subarray(r * (rowLen + 1) + 1, (r + 1) * (rowLen + 1));
    const cur = out.subarray(r * rowLen, (r + 1) * rowLen);
    for (let i = 0; i < rowLen; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (type === 1) v += a;
      else if (type === 2) v += b;
      else if (type === 3) v += (a + b) >> 1;
      else if (type === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    prev = cur;
  }
  return out;
}

/** Raw 8-bit samples of a Flate/LZW/... image, or null when the encoding is not supported. */
function decodeSamples(stream, comps, w, h) {
  const dict = stream.dict;
  let data = PDFLib.decodePDFRawStream(stream).decode();
  let parms = dict.lookup(PDFName.of('DecodeParms'));
  if (parms instanceof PDFArray) parms = parms.asArray().map((p) => dict.context.lookup(p)).find((p) => p instanceof PDFDict);
  if (parms instanceof PDFDict) {
    const num = (k, d) => { const v = parms.lookup(PDFName.of(k)); return v instanceof PDFNumber ? v.asNumber() : d; };
    const predictor = num('Predictor', 1);
    if (predictor >= 10) data = unpredictPng(data, num('Colors', 1), num('Columns', 1), num('BitsPerComponent', 8));
    else if (predictor !== 1) return null; // TIFF predictor: rare, skipped
  }
  return data.length >= w * h * comps ? data : null;
}

function samplesToCanvas(data, comps, w, h) {
  const c = el('canvas', { width: w, height: h });
  const img = c.getContext('2d').createImageData(w, h);
  const px = img.data;
  for (let i = 0, j = 0; i < w * h; i++, j += comps) {
    const k = i * 4;
    if (comps === 3) { px[k] = data[j]; px[k + 1] = data[j + 1]; px[k + 2] = data[j + 2]; } else { px[k] = px[k + 1] = px[k + 2] = data[j]; }
    px[k + 3] = 255;
  }
  c.getContext('2d').putImageData(img, 0, 0);
  return c;
}

function scaleCanvas(source, w, h) {
  const c = el('canvas', { width: w, height: h });
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, w, h);
  return c;
}

/** Image XObjects used on each page, with the largest page side (in points) they appear on. */
function collectImages(pdf) {
  const ctx = pdf.context;
  const images = new Map(); // PDFRef -> largest page side in points
  const softMasks = new Set();
  const visit = (res, side, seen) => {
    res = ctx.lookup(res);
    if (!(res instanceof PDFDict)) return;
    const xo = res.lookup(PDFName.of('XObject'));
    if (!(xo instanceof PDFDict)) return;
    for (const [, ref] of xo.entries()) {
      if (!(ref instanceof PDFRef) || seen.has(ref)) continue;
      seen.add(ref);
      const obj = ctx.lookup(ref);
      if (!(obj instanceof PDFStream)) continue;
      const sub = nameOf(obj.dict.lookup(PDFName.of('Subtype')));
      if (sub === 'Image') {
        images.set(ref, Math.max(images.get(ref) || 0, side));
        const sm = obj.dict.get(PDFName.of('SMask'));
        if (sm instanceof PDFRef) softMasks.add(sm);
      } else if (sub === 'Form') {
        visit(obj.dict.get(PDFName.of('Resources')), side, seen);
      }
    }
  };
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    visit(page.node.Resources(), Math.max(width, height), new Set());
  }
  for (const sm of softMasks) images.delete(sm);
  return { images, softMasks };
}

async function readImage(ctx, stream) {
  const d = stream.dict;
  const num = (k) => { const v = d.lookup(PDFName.of(k)); return v instanceof PDFNumber ? v.asNumber() : 0; };
  const w = num('Width'), h = num('Height');
  if (!w || !h || w * h < MIN_PIXELS || w * h > MAX_PIXELS) return null;
  if (d.lookup(PDFName.of('ImageMask')) === PDFBool.True) return null;
  if (!defaultDecode(d) || d.lookup(PDFName.of('Mask')) instanceof PDFArray) return null;
  if (num('BitsPerComponent') !== 8) return null;
  const comps = colorComponents(ctx, d.get(PDFName.of('ColorSpace')));
  if (!comps) return null;
  const filters = filterNames(d);
  if (filters.length === 1 && filters[0] === 'DCTDecode') {
    const bitmap = await createImageBitmap(new Blob([stream.contents], { type: 'image/jpeg' })).catch(() => null);
    return bitmap ? { w, h, source: bitmap } : null;
  }
  if (filters.some((f) => !['FlateDecode', 'LZWDecode', 'RunLengthDecode', 'ASCII85Decode', 'ASCIIHexDecode'].includes(f))) return null;
  const data = decodeSamples(stream, comps, w, h);
  return data ? { w, h, source: samplesToCanvas(data, comps, w, h) } : null;
}

/** Scales a soft mask (transparency) to match its resized image, stored losslessly. */
function resizeSoftMask(ctx, ref, w, h) {
  const sm = ctx.lookup(ref);
  if (!(sm instanceof PDFStream)) return null;
  const d = sm.dict;
  const num = (k) => { const v = d.lookup(PDFName.of(k)); return v instanceof PDFNumber ? v.asNumber() : 0; };
  const sw = num('Width'), sh = num('Height');
  if (num('BitsPerComponent') !== 8 || !defaultDecode(d) || d.lookup(PDFName.of('Matte'))) return null;
  if (sw * sh <= w * h) return null;
  if (filterNames(d).some((f) => !['FlateDecode', 'LZWDecode', 'RunLengthDecode'].includes(f))) return null;
  const data = decodeSamples(sm, 1, sw, sh);
  if (!data) return null;
  const small = scaleCanvas(samplesToCanvas(data, 1, sw, sh), w, h);
  const px = small.getContext('2d').getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) gray[i] = px[i * 4];
  return ctx.flateStream(gray, { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceGray', BitsPerComponent: 8 });
}

/**
 * Compresses PDF bytes. Returns { bytes, images } where images is the number of
 * images that were made smaller.
 */
async function compressPdfBytes(bytes, { dpi, quality }, { protect = null, onProgress } = {}) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = pdf.context;
  const { images } = collectImages(pdf);
  let done = 0, changed = 0;
  for (const [ref, side] of images) {
    onProgress?.(done++, images.size);
    const stream = ctx.lookup(ref);
    if (!(stream instanceof PDFLib.PDFRawStream)) continue;
    let img = null;
    try { img = await readImage(ctx, stream); } catch (e) { console.warn('compress: image skipped', e); }
    if (!img) continue;
    const limit = (side / 72) * dpi;
    const scale = Math.min(1, limit / Math.max(img.w, img.h));
    const tw = Math.max(1, Math.round(img.w * scale)), th = Math.max(1, Math.round(img.h * scale));
    const jpeg = await canvasToBytes(scaleCanvas(img.source, tw, th), 'image/jpeg', quality);
    img.source.close?.();
    if (jpeg.length >= stream.contents.length * MIN_SAVING) continue;
    const old = stream.dict;
    const dict = ctx.obj({ Type: 'XObject', Subtype: 'Image', Width: tw, Height: th, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' });
    for (const key of ['SMask', 'Interpolate', 'Intent', 'OC']) {
      const v = old.get(PDFName.of(key));
      if (v) dict.set(PDFName.of(key), v);
    }
    const sm = old.get(PDFName.of('SMask'));
    if (sm instanceof PDFRef && scale < 1) {
      try {
        const small = resizeSoftMask(ctx, sm, tw, th);
        if (small) ctx.assign(sm, small);
      } catch (e) { console.warn('compress: soft mask kept', e); }
    }
    ctx.assign(ref, PDFLib.PDFRawStream.of(dict, jpeg));
    changed++;
  }
  onProgress?.(images.size, images.size);
  collectGarbage(pdf);
  if (protect) applyProtection(pdf, protect);
  const out = await pdf.save({ useObjectStreams: !protect, updateFieldAppearances: false });
  return { bytes: out, images: changed };
}
