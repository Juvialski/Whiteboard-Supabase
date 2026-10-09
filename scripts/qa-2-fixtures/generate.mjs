// Deterministic, entirely synthetic upload fixtures. No external material.
import fs from 'node:fs';
const fixture = JSON.parse(fs.readFileSync(new URL('../qa-1-fixtures/media.whiteboard.json', import.meta.url)));
fs.writeFileSync(new URL('pixel.png', import.meta.url), Buffer.from(fixture.assets[0].data.split(',')[1], 'base64'));
const stream = 'BT /F1 12 Tf 20 100 Td (QA-2 synthetic PDF page) Tj ET\n';
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 150] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
];
let pdf = '%PDF-1.4\n';
const offsets = [0];
objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
fs.writeFileSync(new URL('one-page.pdf', import.meta.url), pdf);
