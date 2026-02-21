/**
 * Generate a printable PDF stock check sheet for warehouse team.
 *
 * Usage: node server/src/scripts/generateStockCheckPdf.mjs
 * Output: stock-check-YYYY-MM-DD.pdf in project root
 */

import PDFDocument from 'pdfkit';
import { createWriteStream } from 'fs';
import pg from 'pg';

const { Client } = pg;

const client = new Client({ connectionString: process.env.DATABASE_URL || "postgresql://cohapp:cohsecure2026@128.140.98.253:5432/coherp" });

async function fetchFabrics() {
  await client.connect();
  const { rows } = await client.query(`
    SELECT
      fc.code,
      fc."colourName" as "colourName",
      fc."currentBalance" as "currentBalance",
      f.name as "fabricName",
      f.unit,
      m.name as "materialName"
    FROM "FabricColour" fc
    JOIN "Fabric" f ON fc."fabricId" = f.id
    LEFT JOIN "Material" m ON f."materialId" = m.id
    WHERE fc."isActive" = true AND f."isActive" = true AND m.id IS NOT NULL
    ORDER BY m.name, f.name, fc."colourName"
  `);
  await client.end();
  return rows.map(r => ({
    code: r.code || '-',
    materialName: r.materialName || '-',
    fabricName: r.fabricName,
    colourName: r.colourName,
    unit: r.unit || '-',
    systemQty: Number(r.currentBalance) || 0,
  }));
}

function generatePdf(fabrics, outputPath) {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'portrait',
    margins: { top: 40, bottom: 40, left: 30, right: 30 },
  });

  const stream = createWriteStream(outputPath);
  doc.pipe(stream);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const startX = doc.page.margins.left;

  const columns = [
    { label: '#', width: 0.035 },
    { label: 'Code', width: 0.13 },
    { label: 'Fabric', width: 0.20 },
    { label: 'Colour', width: 0.15 },
    { label: 'Unit', width: 0.05 },
    { label: 'Qty', width: 0.14 },
    { label: 'Notes', width: 0.255 },
  ];

  const colWidths = columns.map(c => c.width * pageWidth);
  const rowHeight = 20;
  const headerHeight = 28;

  function drawHeader(y) {
    doc.fontSize(16).font('Helvetica-Bold');
    doc.text('COH — Physical Stock Check Sheet', startX, y, { align: 'center', width: pageWidth });
    y += 24;

    doc.fontSize(9).font('Helvetica');
    doc.text('Date: _______________    Time: _______________    Checked by: ___________________________', startX, y, { width: pageWidth });
    y += 20;

    doc.moveTo(startX, y).lineTo(startX + pageWidth, y).lineWidth(1).stroke();
    y += 8;

    return y;
  }

  function drawTableHeader(y) {
    doc.rect(startX, y, pageWidth, headerHeight).fill('#2d2d2d');

    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('white');
    let x = startX;
    for (let i = 0; i < columns.length; i++) {
      doc.text(columns[i].label, x + 3, y + 5, {
        width: colWidths[i] - 6,
        height: headerHeight - 4,
        align: i === 5 ? 'center' : 'left',
      });
      x += colWidths[i];
    }

    doc.fillColor('black');
    return y + headerHeight;
  }

  function drawRow(y, row, index, isEven) {
    if (isEven) {
      doc.rect(startX, y, pageWidth, rowHeight).fill('#f5f5f5');
    }

    doc.fillColor('black').fontSize(7).font('Helvetica');

    let x = startX;
    const values = [
      String(index + 1),
      row.code,
      row.fabricName,
      row.colourName,
      row.unit,
      '',
      '',
    ];

    for (let i = 0; i < values.length; i++) {
      doc.text(values[i], x + 3, y + 5, {
        width: colWidths[i] - 6,
        height: rowHeight - 4,
        align: i === 5 ? 'center' : 'left',
        ellipsis: true,
      });
      x += colWidths[i];
    }

    // Writable cells get visible borders
    x = startX;
    for (let i = 0; i < colWidths.length; i++) {
      if (i >= 5) {
        doc.rect(x, y, colWidths[i], rowHeight).lineWidth(0.3).stroke('#999999');
      }
      x += colWidths[i];
    }

    doc.moveTo(startX, y + rowHeight).lineTo(startX + pageWidth, y + rowHeight).lineWidth(0.2).stroke('#cccccc');

    return y + rowHeight;
  }

  // Build pages
  let y = drawHeader(doc.page.margins.top);
  y = drawTableHeader(y);
  let pageNum = 1;

  // Pre-calculate total pages
  let tempY = y;
  let totalPages = 1;
  for (let i = 0; i < fabrics.length; i++) {
    if (tempY + rowHeight > doc.page.height - doc.page.margins.bottom - 30) {
      totalPages++;
      tempY = doc.page.margins.top + headerHeight;
    }
    tempY += rowHeight;
  }

  for (let i = 0; i < fabrics.length; i++) {
    if (y + rowHeight > doc.page.height - doc.page.margins.bottom - 30) {
      doc.fontSize(7).font('Helvetica').fillColor('#888888');
      doc.text(
        `Page ${pageNum} of ${totalPages}  |  Total: ${fabrics.length} fabrics`,
        startX, doc.page.height - doc.page.margins.bottom - 10,
        { align: 'center', width: pageWidth }
      );

      doc.addPage();
      pageNum++;
      y = drawTableHeader(doc.page.margins.top);
    }

    y = drawRow(y, fabrics[i], i, i % 2 === 0);
  }

  // Final page footer
  doc.fontSize(7).font('Helvetica').fillColor('#888888');
  doc.text(
    `Page ${pageNum} of ${totalPages}  |  Total: ${fabrics.length} fabrics`,
    startX, doc.page.height - doc.page.margins.bottom - 10,
    { align: 'center', width: pageWidth }
  );

  // Summary box
  y += 15;
  if (y + 50 < doc.page.height - doc.page.margins.bottom - 20) {
    doc.fontSize(8).font('Helvetica-Bold').fillColor('black');
    doc.text('Summary:', startX, y);
    y += 14;
    doc.fontSize(8).font('Helvetica');
    doc.text(`Total items checked: _______ / ${fabrics.length}          Discrepancies found: _______          Remarks: ________________________________________`, startX, y);
  }

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

async function main() {
  const fabrics = await fetchFabrics();
  console.log(`Found ${fabrics.length} active fabric colours`);

  const date = new Date().toISOString().slice(0, 10);
  const outputPath = `stock-check-${date}.pdf`;

  await generatePdf(fabrics, outputPath);
  console.log(`PDF generated: ${outputPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
