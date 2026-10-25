'use strict';
// Generates small PDFs used by the end-to-end test.
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');

async function samplePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let n = 1; n <= 3; n++) {
    const page = pdf.addPage([595.28, 841.89]);
    page.drawText(`Chapter ${n}: The Garden`, { x: 60, y: 760, size: 22, font: bold, color: rgb(0.1, 0.2, 0.2) });
    const lines = [
      'Bismillah. This sample document is used to test Sahifa PDF.',
      'The quick brown fox jumps over the lazy dog near the river.',
      `Invoice total for page ${n}: 1,250.00 USD due on 30 November.`,
      'Patience is beautiful, and knowledge is light.',
    ];
    lines.forEach((t, i) => page.drawText(t, { x: 60, y: 700 - i * 24, size: 13, font }));
    page.drawRectangle({ x: 60, y: 420, width: 470, height: 120, color: rgb(0.93, 0.96, 0.95) });
    page.drawText('Highlighted box area', { x: 80, y: 480, size: 16, font });
  }
  // A rotated page to check coordinate handling.
  pdf.getPage(2).setRotation(degrees(90));
  pdf.setTitle('Sahifa sample');
  pdf.setAuthor('Test Author');
  return pdf.save();
}

async function formPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const form = pdf.getForm();
  page.drawText('Application form', { x: 60, y: 780, size: 20, font });
  page.drawText('Full name', { x: 60, y: 732, size: 11, font });
  form.createTextField('fullName').addToPage(page, { x: 160, y: 724, width: 260, height: 22 });
  page.drawText('Agree to terms', { x: 60, y: 692, size: 11, font });
  form.createCheckBox('agree').addToPage(page, { x: 160, y: 688, width: 16, height: 16 });
  page.drawText('Country', { x: 60, y: 652, size: 11, font });
  const dd = form.createDropdown('country');
  dd.addOptions(['Maldives', 'Malaysia', 'Morocco']);
  dd.addToPage(page, { x: 160, y: 644, width: 160, height: 22 });
  page.drawText('Signature', { x: 60, y: 600, size: 11, font });
  return pdf.save();
}

/** A heavy PDF for the compress test: a high-quality photo (JPEG), a large image stored
 *  with the PNG predictor (as many PDF writers do) next to real text, and an image with
 *  transparency. `jpeg` and `png` are image bytes made by the app's own canvas. */
async function heavyPdf({ jpeg, png }) {
  const zlib = require('zlib');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const p1 = pdf.addPage([595.28, 841.89]);
  const photo = await pdf.embedJpg(jpeg);
  p1.drawImage(photo, { x: 0, y: 0, width: 595.28, height: 841.89 });

  // 1800x1800 RGB image with PNG "Sub" predictor rows, the way many PDF producers store images.
  const W = 1800, H = 1800, rowLen = W * 3;
  const rows = Buffer.alloc(H * (rowLen + 1));
  for (let y = 0; y < H; y++) {
    const o = y * (rowLen + 1);
    rows[o] = 1; // Sub filter
    let prev = [0, 0, 0];
    for (let x = 0; x < W; x++) {
      const n = (Math.sin(x * 0.37 + y * 0.11) * 40 + ((x * 7919 + y * 104729) % 23));
      const px = [(x * 255 / W + n) & 255, (y * 255 / H + n) & 255, ((x + y) * 128 / W + n) & 255];
      for (let c = 0; c < 3; c++) { rows[o + 1 + x * 3 + c] = (px[c] - prev[c]) & 255; }
      prev = px;
    }
  }
  const raw = pdf.context.stream(zlib.deflateSync(rows), {
    Type: 'XObject', Subtype: 'Image', Width: W, Height: H, ColorSpace: 'DeviceRGB', BitsPerComponent: 8,
    Filter: 'FlateDecode', DecodeParms: { Predictor: 15, Colors: 3, Columns: W, BitsPerComponent: 8 },
  });
  const rawRef = pdf.context.register(raw);
  const p2 = pdf.addPage([595.28, 841.89]);
  const name = p2.node.newXObject('Im', rawRef);
  const { pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } = require('pdf-lib');
  p2.pushOperators(pushGraphicsState(), concatTransformationMatrix(480, 0, 0, 480, 57, 300), drawObject(name), popGraphicsState());
  p2.drawText('Compress test text stays selectable.', { x: 57, y: 240, size: 16, font });

  const p3 = pdf.addPage([595.28, 841.89]);
  const logo = await pdf.embedPng(png);
  p3.drawImage(logo, { x: 97, y: 220, width: 400, height: 400 });
  return pdf.save();
}

module.exports = { samplePdf, formPdf, heavyPdf };
