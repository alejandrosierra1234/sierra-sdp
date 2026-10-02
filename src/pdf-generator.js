import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import { formatDate, formatMoney, formatNumber } from "./report-model.js";

const PAGE = { width: 612, height: 792, margin: 38 };
const COLOR = {
  ink: rgb(0.114, 0.114, 0.122),
  graphite: rgb(0.431, 0.431, 0.451),
  mist: rgb(0.898, 0.898, 0.898),
  fog: rgb(0.961, 0.961, 0.961),
  deep: rgb(0.012, 0.188, 0.161),
  teal: rgb(0.349, 0.635, 0.620),
  lime: rgb(0.769, 0.769, 0.071),
  limePale: rgb(0.937, 0.937, 0.686),
  danger: rgb(0.706, 0.137, 0.094),
  white: rgb(1, 1, 1)
};

async function embedHilosYAlgodonLogo(pdf) {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const match = html.match(/const HA_SRC='data:image\/svg\+xml;base64,([^']+)'/);
  if (!match) throw new Error("No se encontró el logotipo HA_SRC en index.html");
  const svg = Buffer.from(match[1], "base64");
  const png = await sharp(svg).resize({ height: 1200, withoutEnlargement: false }).png().toBuffer();
  return pdf.embedPng(png);
}

function sanitizeText(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function splitLongToken(token, font, size, maxWidth) {
  const pieces = [];
  let current = "";
  for (const char of token) {
    if (font.widthOfTextAtSize(current + char, size) > maxWidth && current) {
      pieces.push(current);
      current = char;
    } else current += char;
  }
  if (current) pieces.push(current);
  return pieces;
}

function wrapText(text, font, size, maxWidth) {
  const words = sanitizeText(text).split(" ").flatMap((word) => (
    font.widthOfTextAtSize(word, size) > maxWidth ? splitLongToken(word, font, size, maxWidth) : [word]
  ));
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function drawLines(page, lines, { x, y, font, size, color = COLOR.ink, lineHeight = size * 1.25 }) {
  lines.forEach((line, index) => page.drawText(line, { x, y: y - index * lineHeight, font, size, color }));
  return y - lines.length * lineHeight;
}

function drawHeader(page, fonts, title = "REPORTE PARA REEMBOLSO DE COMBUSTIBLE") {
  const { bold, logo } = fonts;
  const logoHeight = 52;
  const logoWidth = logo.width * (logoHeight / logo.height);
  page.drawImage(logo, { x: PAGE.margin + 6, y: 706, width: logoWidth, height: logoHeight });
  const titleLines = wrapText(title, bold, 15, 325);
  drawLines(page, titleLines, { x: 109, y: 744, font: bold, size: 15, color: COLOR.deep, lineHeight: 18 });
  page.drawLine({ start: { x: PAGE.margin, y: 694 }, end: { x: PAGE.width - PAGE.margin, y: 694 }, thickness: 2, color: COLOR.deep });
  return 677;
}

function drawKeyValue(page, fonts, label, value, x, y, width) {
  page.drawText(label.toUpperCase(), { x, y, font: fonts.bold, size: 7.5, color: COLOR.graphite });
  const lines = wrapText(value || "No indicado", fonts.regular, 9.5, width);
  drawLines(page, lines.slice(0, 2), { x, y: y - 13, font: fonts.regular, size: 9.5, lineHeight: 11 });
}

function drawMeta(page, fonts, report, y) {
  const width = PAGE.width - PAGE.margin * 2;
  page.drawRectangle({ x: PAGE.margin, y: y - 89, width, height: 89, color: COLOR.fog });
  const col = (width - 28) / 3;
  drawKeyValue(page, fonts, "Empresa", report.companyName, PAGE.margin + 10, y - 15, col - 10);
  drawKeyValue(page, fonts, "Colaborador", report.collaborator, PAGE.margin + col + 14, y - 15, col - 10);
  drawKeyValue(page, fonts, "Centro de costo / departamento", report.department || "No indicado", PAGE.margin + col * 2 + 18, y - 15, col - 10);
  const period = `${formatDate(report.period.start)} - ${formatDate(report.period.end)}`;
  drawKeyValue(page, fonts, "Período", period, PAGE.margin + 10, y - 58, col - 10);
  drawKeyValue(page, fonts, "Generado", new Intl.DateTimeFormat("es-GT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(report.generatedAt)), PAGE.margin + col + 14, y - 58, col - 10);
  drawKeyValue(page, fonts, "No. de reporte", report.reportId, PAGE.margin + col * 2 + 18, y - 58, col - 10);
  return y - 105;
}

function drawSummary(page, fonts, report, y) {
  page.drawText("RESUMEN", { x: PAGE.margin, y, font: fonts.bold, size: 10, color: COLOR.deep });
  y -= 13;
  const gap = 6;
  const width = (PAGE.width - PAGE.margin * 2 - gap * 2) / 3;
  const cards = [
    ["Trayectos", String(report.trips.length)],
    ["Kilómetros", `${formatNumber(report.totalKm)} km`],
    ["Tarifa fija", `${formatMoney(report.fixedRate, report.rateCurrency)} / km`],
    ["Tipo de cambio", report.exchangeRate ? `${formatNumber(report.exchangeRate, 4)} ${report.reimbursementCurrency}/${report.rateCurrency}` : "No aplica"],
    ["Reembolso", formatMoney(report.reimbursement, report.reimbursementCurrency)],
    ["Aprobación", report.approval || "Pendiente"]
  ];
  cards.forEach(([label, value], index) => {
    const row = Math.floor(index / 3);
    const column = index % 3;
    const x = PAGE.margin + column * (width + gap);
    const top = y - row * 51;
    page.drawRectangle({ x, y: top - 44, width, height: 44, color: index === 4 ? COLOR.limePale : COLOR.fog });
    page.drawText(label.toUpperCase(), { x: x + 8, y: top - 12, font: fonts.bold, size: 7, color: COLOR.graphite });
    const lines = wrapText(value, fonts.bold, 10.5, width - 16).slice(0, 2);
    drawLines(page, lines, { x: x + 8, y: top - 28, font: fonts.bold, size: 10.5, color: index === 4 ? COLOR.deep : COLOR.ink, lineHeight: 11 });
  });
  return y - 112;
}

const TABLE_COLS = [
  { key: "number", title: "No.", width: 31 },
  { key: "date", title: "Fecha", width: 70 },
  { key: "start", title: "Inicio", width: 160 },
  { key: "end", title: "Fin / destino", width: 190 },
  { key: "distanceKm", title: "Km", width: 85 }
];

function drawTableHeader(page, fonts, y) {
  let x = PAGE.margin;
  page.drawRectangle({ x, y: y - 25, width: PAGE.width - PAGE.margin * 2, height: 25, color: COLOR.deep });
  for (const column of TABLE_COLS) {
    page.drawText(column.title, { x: x + 6, y: y - 16, font: fonts.bold, size: 8, color: COLOR.white });
    x += column.width;
  }
  return y - 25;
}

function tripCells(trip) {
  return {
    number: String(trip.number),
    date: formatDate(trip.date),
    start: trip.start || "No indicado",
    end: trip.end || "No indicado",
    distanceKm: formatNumber(trip.distanceKm)
  };
}

function rowHeight(trip, font) {
  const cells = tripCells(trip);
  const lines = TABLE_COLS.map((column) => wrapText(cells[column.key], font, 8.5, column.width - 12).length);
  return Math.max(26, Math.max(...lines) * 10 + 10);
}

function drawTripRow(page, fonts, trip, y, shade) {
  const height = rowHeight(trip, fonts.regular);
  if (shade) page.drawRectangle({ x: PAGE.margin, y: y - height, width: PAGE.width - PAGE.margin * 2, height, color: COLOR.fog });
  const cells = tripCells(trip);
  let x = PAGE.margin;
  for (const column of TABLE_COLS) {
    const lines = wrapText(cells[column.key], fonts.regular, 8.5, column.width - 12);
    drawLines(page, lines, { x: x + 6, y: y - 15, font: fonts.regular, size: 8.5, lineHeight: 10 });
    page.drawLine({ start: { x, y }, end: { x, y: y - height }, thickness: 0.4, color: COLOR.mist });
    x += column.width;
  }
  page.drawLine({ start: { x, y }, end: { x, y: y - height }, thickness: 0.4, color: COLOR.mist });
  page.drawLine({ start: { x: PAGE.margin, y: y - height }, end: { x, y: y - height }, thickness: 0.6, color: COLOR.mist });
  return y - height;
}

function newDetailPage(pdf, fonts) {
  const page = pdf.addPage([PAGE.width, PAGE.height]);
  let y = drawHeader(page, fonts);
  page.drawText("DETALLE DE TRAYECTOS (continuación)", { x: PAGE.margin, y, font: fonts.bold, size: 10, color: COLOR.deep });
  y -= 13;
  return { page, y: drawTableHeader(page, fonts, y) };
}

function drawWarnings(page, fonts, warnings, y) {
  if (!warnings.length) return y;
  const lines = warnings.flatMap((warning) => wrapText(`• ${warning}`, fonts.regular, 7.5, PAGE.width - PAGE.margin * 2 - 16));
  const height = lines.length * 9 + 15;
  page.drawRectangle({ x: PAGE.margin, y: y - height, width: PAGE.width - PAGE.margin * 2, height, color: COLOR.limePale });
  drawLines(page, lines, { x: PAGE.margin + 8, y: y - 11, font: fonts.regular, size: 7.5, color: COLOR.ink, lineHeight: 9 });
  return y - height - 8;
}

function drawSignatures(page, fonts, y) {
  if (y < 84) return y;
  const labels = ["COLABORADOR", "AUTORIZADO POR", "FINANZAS / RECIBIDO"];
  const width = (PAGE.width - PAGE.margin * 2 - 28) / 3;
  labels.forEach((label, index) => {
    const x = PAGE.margin + index * (width + 14);
    page.drawLine({ start: { x, y: y - 35 }, end: { x: x + width, y: y - 35 }, thickness: 1, color: COLOR.ink });
    page.drawText(label, { x, y: y - 48, font: fonts.bold, size: 7, color: COLOR.graphite });
  });
  return y - 58;
}

function drawProofMeta(page, fonts, trip, proof, y) {
  page.drawText(`TRAYECTO ${trip.number}`, { x: PAGE.margin, y, font: fonts.bold, size: 10, color: COLOR.deep });
  y -= 18;
  const details = [
    ["Fecha", formatDate(trip.date)],
    ["Ruta", `${trip.start || "No indicado"} - ${trip.end || "No indicado"}`],
    ["Kilómetros", `${formatNumber(trip.distanceKm)} km`],
    ["Archivo", sanitizeText(proof.name || "Sin nombre")]
  ];
  for (const [label, value] of details) {
    page.drawText(`${label}:`, { x: PAGE.margin, y, font: fonts.bold, size: 8, color: COLOR.graphite });
    const lines = wrapText(value, fonts.regular, 8.5, 420);
    drawLines(page, lines, { x: PAGE.margin + 73, y, font: fonts.regular, size: 8.5, lineHeight: 10 });
    y -= Math.max(14, lines.length * 10);
  }
  return y - 4;
}

async function readProof(proof) {
  if (proof.buffer) return Buffer.from(proof.buffer);
  if (proof.localPath) return readFile(proof.localPath);
  throw new Error(proof.error || "No se pudo descargar el archivo");
}

async function appendImageProof(pdf, fonts, report, trip, proof) {
  const page = pdf.addPage([PAGE.width, PAGE.height]);
  let y = drawHeader(page, fonts, "ANEXO - PRUEBAS DEL KILOMETRAJE");
  y = drawProofMeta(page, fonts, trip, proof, y);
  try {
    const source = await readProof(proof);
    const imageBuffer = await sharp(source).rotate().resize({ width: 1500, height: 1800, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer();
    const image = await pdf.embedJpg(imageBuffer);
    const availableWidth = PAGE.width - PAGE.margin * 2;
    const availableHeight = y - 52;
    const scale = Math.min(availableWidth / image.width, availableHeight / image.height, 1);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(image, { x: (PAGE.width - width) / 2, y: Math.max(42, y - height), width, height });
  } catch (error) {
    page.drawRectangle({ x: PAGE.margin, y: y - 95, width: PAGE.width - PAGE.margin * 2, height: 95, color: COLOR.fog });
    page.drawText("RESPALDO NO DISPONIBLE", { x: PAGE.margin + 12, y: y - 28, font: fonts.bold, size: 10, color: COLOR.danger });
    const lines = wrapText(`El archivo no pudo procesarse: ${sanitizeText(error.message)}`, fonts.regular, 8.5, PAGE.width - PAGE.margin * 2 - 24);
    drawLines(page, lines, { x: PAGE.margin + 12, y: y - 47, font: fonts.regular, size: 8.5, color: COLOR.ink, lineHeight: 11 });
  }
}

async function appendPdfProof(pdf, fonts, trip, proof) {
  let source;
  try {
    source = await PDFDocument.load(await readProof(proof), { ignoreEncryption: false });
  } catch (error) {
    await appendImageProof(pdf, fonts, {}, trip, { ...proof, error: `PDF inválido: ${error.message}`, buffer: null, localPath: null });
    return;
  }
  for (let index = 0; index < source.getPageCount(); index += 1) {
    const page = pdf.addPage([PAGE.width, PAGE.height]);
    let y = drawHeader(page, fonts, "ANEXO - PRUEBAS DEL KILOMETRAJE");
    y = drawProofMeta(page, fonts, trip, { ...proof, name: `${proof.name} (página ${index + 1}/${source.getPageCount()})` }, y);
    const [embedded] = await pdf.embedPdf(await source.save(), [index]);
    const availableWidth = PAGE.width - PAGE.margin * 2;
    const availableHeight = y - 44;
    const scale = Math.min(availableWidth / embedded.width, availableHeight / embedded.height);
    const width = embedded.width * scale;
    const height = embedded.height * scale;
    page.drawPage(embedded, { x: (PAGE.width - width) / 2, y: Math.max(38, y - height), width, height });
  }
}

function proofIsPdf(proof) {
  return proof.mimeType === "application/pdf" || String(proof.extension).toLowerCase() === "pdf" || /\.pdf$/i.test(proof.name || "");
}

function addPageNumbers(pdf, fonts) {
  const pages = pdf.getPages();
  pages.forEach((page, index) => {
    const label = `Página ${index + 1} de ${pages.length}`;
    const width = fonts.regular.widthOfTextAtSize(label, 7.5);
    page.drawText(label, { x: PAGE.width - PAGE.margin - width, y: 20, font: fonts.regular, size: 7.5, color: COLOR.graphite });
    page.drawText("Documento generado automáticamente desde monday.com", { x: PAGE.margin, y: 20, font: fonts.regular, size: 7.5, color: COLOR.graphite });
  });
}

export async function generateFuelReportPdf(report) {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Reporte para reembolso de combustible");
  pdf.setAuthor(report.companyName);
  pdf.setSubject(`Reporte ${report.reportId}`);
  pdf.setCreator("sierra-sdp");
  pdf.setCreationDate(new Date(report.generatedAt));
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    logo: await embedHilosYAlgodonLogo(pdf)
  };

  let page = pdf.addPage([PAGE.width, PAGE.height]);
  let y = drawHeader(page, fonts);
  y = drawMeta(page, fonts, report, y);
  y = drawSummary(page, fonts, report, y);
  page.drawText("DETALLE DE TRAYECTOS", { x: PAGE.margin, y, font: fonts.bold, size: 10, color: COLOR.deep });
  y -= 13;
  y = drawTableHeader(page, fonts, y);
  for (let index = 0; index < report.trips.length; index += 1) {
    const trip = report.trips[index];
    const height = rowHeight(trip, fonts.regular);
    if (y - height < 92) ({ page, y } = newDetailPage(pdf, fonts));
    y = drawTripRow(page, fonts, trip, y, index % 2 === 1);
  }
  y -= 12;
  y = drawWarnings(page, fonts, report.warnings || [], y);
  if (report.includeAuthorizationLines) {
    if (y < 115) {
      page = pdf.addPage([PAGE.width, PAGE.height]);
      y = drawHeader(page, fonts, "AUTORIZACIONES");
    }
    drawSignatures(page, fonts, y);
  }

  const proofs = report.trips.flatMap((trip) => trip.proofs.map((proof) => ({ trip, proof })));
  if (!proofs.length) {
    page = pdf.addPage([PAGE.width, PAGE.height]);
    y = drawHeader(page, fonts, "ANEXO - PRUEBAS DEL KILOMETRAJE");
    page.drawRectangle({ x: PAGE.margin, y: y - 85, width: PAGE.width - PAGE.margin * 2, height: 85, color: COLOR.fog });
    page.drawText("No se adjuntaron respaldos de kilometraje.", { x: PAGE.margin + 15, y: y - 44, font: fonts.bold, size: 11, color: COLOR.graphite });
  } else {
    for (const { trip, proof } of proofs) {
      if (proofIsPdf(proof)) await appendPdfProof(pdf, fonts, trip, proof);
      else await appendImageProof(pdf, fonts, report, trip, proof);
    }
  }
  addPageNumbers(pdf, fonts);
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
