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

module.exports = { samplePdf, formPdf };
