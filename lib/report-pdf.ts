'use client';

export function reportPdfFilename(from: string, to: string) {
  const safe = (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : 'period');
  return `report-${safe(from)}-${safe(to)}.pdf`;
}

export async function downloadReportPdf(root: HTMLElement, from: string, to: string) {
  const [{default: html2canvas}, {jsPDF}] = await Promise.all([import('html2canvas'), import('jspdf')]);
  if (document.fonts?.ready) await document.fonts.ready;
  const filename = reportPdfFilename(from, to);
  const pdf = new jsPDF({unit: 'mm', format: 'a4', orientation: 'portrait'});
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const maxW = pageWidth - margin * 2;
  const maxH = pageHeight - margin * 2;
  let y = margin;
  const blocks = [...root.querySelectorAll<HTMLElement>(':scope > .pdf-block')];
  if (!blocks.length) throw new Error('empty print sheet');
  for (const block of blocks) {
    const canvas = await html2canvas(block, {scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false});
    if (!canvas.width || !canvas.height) continue;
    const img = canvas.toDataURL('image/png');
    let drawW = maxW;
    let drawH = (canvas.height * drawW) / canvas.width;
    if (drawH > maxH) {
      const scale = maxH / drawH;
      drawH = maxH;
      drawW = maxW * scale;
    }
    if (y > margin && y + drawH > pageHeight - margin) {
      pdf.addPage();
      y = margin;
    }
    pdf.addImage(img, 'PNG', margin + (maxW - drawW) / 2, y, drawW, drawH);
    y += drawH + 4;
  }
  pdf.save(filename);
  return filename;
}
