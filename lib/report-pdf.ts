'use client';

export function reportPdfFilename(from: string, to: string) {
  const safe = (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : 'period');
  return `report-${safe(from)}-${safe(to)}.pdf`;
}

function riyadhDateKey(value?: string) {
  const date = value ? new Date(value) : new Date();
  const when = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(when);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || '';
  const key = `${get('year')}-${get('month')}-${get('day')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : when.toISOString().slice(0, 10);
}

export async function downloadReportPdf(root: HTMLElement, from: string, to: string, generatedAt?: string) {
  const [{default: html2canvas}, {jsPDF}] = await Promise.all([import('html2canvas'), import('jspdf')]);
  if (document.fonts?.ready) await document.fonts.ready;
  const filename = reportPdfFilename(from, to);
  const pdf = new jsPDF({unit: 'mm', format: 'a4', orientation: 'portrait'});
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const marginX = 12;
  const marginTop = 12;
  const marginBottom = 16;
  const maxW = pageWidth - marginX * 2;
  const maxH = pageHeight - marginTop - marginBottom;
  let y = marginTop;
  const blocks = [...root.querySelectorAll<HTMLElement>(':scope > .pdf-block')];
  if (!blocks.length) throw new Error('empty print sheet');
  for (const block of blocks) {
    const canvas = await html2canvas(block, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      onclone: (_doc, element) => {
        element.style.overflow = 'visible';
        element.querySelectorAll<HTMLElement>('th,td,h1,h2,h3,p,span,b').forEach(node => {
          node.style.overflow = 'visible';
        });
      },
    });
    if (!canvas.width || !canvas.height) continue;
    const img = canvas.toDataURL('image/png');
    let drawW = maxW;
    let drawH = (canvas.height * drawW) / canvas.width;
    if (drawH > maxH) {
      const scale = maxH / drawH;
      drawH = maxH;
      drawW = maxW * scale;
    }
    if (y > marginTop && y + drawH > pageHeight - marginBottom) {
      pdf.addPage();
      y = marginTop;
    }
    pdf.addImage(img, 'PNG', marginX + (maxW - drawW) / 2, y, drawW, drawH);
    y += drawH + 6;
  }
  const generated = riyadhDateKey(generatedAt);
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(210);
    pdf.setLineWidth(0.2);
    pdf.line(marginX, pageHeight - 11, pageWidth - marginX, pageHeight - 11);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(90);
    pdf.text(generated, marginX, pageHeight - 6);
    pdf.text(`${page} / ${pages}`, pageWidth - marginX, pageHeight - 6, {align: 'right'});
  }
  pdf.save(filename);
  return filename;
}
