import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import html2canvas from "html2canvas";

const PDF_CONFIG = {
  orientation: "portrait",
  unit: "mm",
  format: "a4",
  margin: 14,
  titleFontSize: 18,
  sectionFontSize: 12,
  bodyFontSize: 10,
  footerFontSize: 9,
  lineGap: 7,
  chartPadding: 10,
  dateLocale: "en-CA",
  dateOptions: { year: "numeric", month: "2-digit", day: "2-digit" },
  timestampOptions: {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  },
  summaryHead: [["Metric", "Value"]],
  groupHead: [["Group ID", "Record 1", "Record 2", "Similarity Score", "Language"]],
  summarySectionLabel: "Summary",
  groupsSectionLabel: "Duplicate Groups",
  generatedAtPrefix: "Generated:",
  footerPagePrefix: "Page",
  outputPrefix: "DupliDetect_Report_",
  outputExt: ".pdf",
};

function getDateStamp(date = new Date()) {
  return date.toLocaleDateString(PDF_CONFIG.dateLocale, PDF_CONFIG.dateOptions);
}

function getTimestamp(date = new Date()) {
  return date.toLocaleString(undefined, PDF_CONFIG.timestampOptions);
}

function toSummaryRows(summary = {}) {
  return Object.entries(summary).map(([metric, value]) => [String(metric), String(value)]);
}

function toGroupRows(groups = []) {
  return groups.map((group) => [
    String(group.groupId ?? ""),
    String(group.record1 ?? ""),
    String(group.record2 ?? ""),
    String(group.similarityScore ?? ""),
    String(group.language ?? ""),
  ]);
}

function addFooterPageNumbers(doc) {
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i);
    doc.setFontSize(PDF_CONFIG.footerFontSize);
    doc.text(
      `${PDF_CONFIG.footerPagePrefix} ${i} / ${total}`,
      doc.internal.pageSize.getWidth() - PDF_CONFIG.margin,
      doc.internal.pageSize.getHeight() - PDF_CONFIG.margin / 2,
      { align: "right" },
    );
  }
}

export async function exportDashboardPDF(data) {
  const { title, summary, duplicateGroups, chartRef } = data;
  const doc = new jsPDF({
    orientation: PDF_CONFIG.orientation,
    unit: PDF_CONFIG.unit,
    format: PDF_CONFIG.format,
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const usableWidth = pageWidth - PDF_CONFIG.margin * 2;

  let y = PDF_CONFIG.margin;
  doc.setFontSize(PDF_CONFIG.titleFontSize);
  doc.text(String(title ?? ""), PDF_CONFIG.margin, y);

  y += PDF_CONFIG.lineGap;
  doc.setFontSize(PDF_CONFIG.bodyFontSize);
  doc.text(
    `${PDF_CONFIG.generatedAtPrefix} ${getTimestamp(new Date())}`,
    PDF_CONFIG.margin,
    y,
  );

  y += PDF_CONFIG.lineGap + 1;
  doc.setFontSize(PDF_CONFIG.sectionFontSize);
  doc.text(PDF_CONFIG.summarySectionLabel, PDF_CONFIG.margin, y);

  autoTable(doc, {
    startY: y + 3,
    head: PDF_CONFIG.summaryHead,
    body: toSummaryRows(summary),
    margin: { left: PDF_CONFIG.margin, right: PDF_CONFIG.margin },
    styles: { fontSize: PDF_CONFIG.bodyFontSize },
    headStyles: { fillColor: [52, 73, 94] },
  });

  doc.addPage();
  doc.setFontSize(PDF_CONFIG.sectionFontSize);
  doc.text(PDF_CONFIG.groupsSectionLabel, PDF_CONFIG.margin, PDF_CONFIG.margin);

  autoTable(doc, {
    startY: PDF_CONFIG.margin + 4,
    head: PDF_CONFIG.groupHead,
    body: toGroupRows(duplicateGroups),
    margin: { left: PDF_CONFIG.margin, right: PDF_CONFIG.margin },
    styles: { fontSize: PDF_CONFIG.bodyFontSize, cellPadding: 2 },
    headStyles: { fillColor: [41, 128, 185] },
  });

  const chartElement = chartRef?.current ?? chartRef ?? null;
  if (chartElement) {
    const canvas = await html2canvas(chartElement, { useCORS: true, backgroundColor: "#ffffff" });
    const chartImage = canvas.toDataURL("image/png");

    doc.addPage();
    const maxW = usableWidth;
    const maxH = pageHeight - PDF_CONFIG.margin * 2;
    const ratio = Math.min(maxW / canvas.width, maxH / canvas.height);
    const drawW = canvas.width * ratio;
    const drawH = canvas.height * ratio;
    const x = (pageWidth - drawW) / 2;
    const yChart = PDF_CONFIG.margin + PDF_CONFIG.chartPadding;

    doc.addImage(chartImage, "PNG", x, yChart, drawW, drawH);
  }

  addFooterPageNumbers(doc);
  doc.save(`${PDF_CONFIG.outputPrefix}${getDateStamp(new Date())}${PDF_CONFIG.outputExt}`);
}
