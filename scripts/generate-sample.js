import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import { generateFuelReportPdf } from "../src/pdf-generator.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = process.env.SAMPLE_OUTPUT || join(root, "output", "pdf", "reporte-combustible-muestra.pdf");
await mkdir(dirname(output), { recursive: true });
const temp = await mkdtemp(join(tmpdir(), "sierra-sample-"));

const landscape = join(temp, "odometro-horizontal.jpg");
const portrait = join(temp, "odometro-vertical.jpg");
await sharp({ create: { width: 1400, height: 800, channels: 3, background: "#ece9df" } })
  .composite([{ input: Buffer.from(`<svg width="1400" height="800"><rect x="90" y="110" width="1220" height="580" rx="60" fill="#1f2b29"/><circle cx="700" cy="400" r="225" fill="#f8f8f2" stroke="#59a29e" stroke-width="26"/><text x="700" y="430" text-anchor="middle" font-family="Arial" font-size="112" font-weight="700" fill="#033029">45,821 km</text></svg>`) }])
  .jpeg({ quality: 88 }).toFile(landscape);
await sharp({ create: { width: 850, height: 1400, channels: 3, background: "#e8efed" } })
  .composite([{ input: Buffer.from(`<svg width="850" height="1400"><rect x="95" y="220" width="660" height="900" rx="70" fill="#17221f"/><circle cx="425" cy="650" r="260" fill="#ffffff" stroke="#c4c412" stroke-width="24"/><text x="425" y="690" text-anchor="middle" font-family="Arial" font-size="92" font-weight="700" fill="#033029">46,013 km</text></svg>`) }])
  .jpeg({ quality: 88 }).toFile(portrait);

const supportPdf = join(temp, "respaldo-adicional.pdf");
const attachment = await PDFDocument.create();
const font = await attachment.embedFont(StandardFonts.HelveticaBold);
for (let pageNumber = 1; pageNumber <= 2; pageNumber += 1) {
  const page = attachment.addPage([612, 792]);
  page.drawRectangle({ x: 55, y: 585, width: 502, height: 120, color: rgb(0.94, 0.94, 0.69) });
  page.drawText(`RESPALDO FICTICIO - PÁGINA ${pageNumber}`, { x: 82, y: 640, size: 20, font, color: rgb(0.01, 0.19, 0.16) });
  page.drawText("Sin datos reales de colaboradores.", { x: 82, y: 610, size: 12, font, color: rgb(0.2, 0.2, 0.2) });
}
await writeFile(supportPdf, await attachment.save());

const trips = Array.from({ length: 24 }, (_, index) => ({
  id: String(9000 + index),
  number: index + 1,
  date: `2026-09-${String((index % 20) + 1).padStart(2, "0")}`,
  start: index % 3 === 0 ? "Oficinas centrales - zona industrial" : "Centro de distribución",
  end: index % 4 === 0 ? "Reunión con proveedor y revisión de muestras en planta" : "Oficinas centrales",
  distanceKm: 6.25 + (index % 7) * 1.5,
  proofs: index === 0 ? [{ id: "a1", name: "odometro-horizontal.jpg", extension: "jpg", localPath: landscape }] :
    index === 1 ? [{ id: "a2", name: "odometro-vertical.jpg", extension: "jpg", localPath: portrait }] :
    index === 2 ? [{ id: "a3", name: "respaldo-adicional.pdf", extension: "pdf", mimeType: "application/pdf", localPath: supportPdf }] :
    index === 3 ? [{ id: "a4", name: "archivo-dañado.jpg", extension: "jpg", error: "El archivo de origen no está disponible." }] : []
}));
const totalKm = Math.round(trips.reduce((sum, trip) => sum + trip.distanceKm, 0) * 1000) / 1000;
const report = {
  reportId: "18430000001",
  companyName: "Hilos y Algodón, S.A.",
  collaborator: "Colaborador de muestra",
  department: "Mercadeo",
  period: { start: "2026-09-01", end: "2026-09-30" },
  generatedAt: "2026-10-02T15:00:00.000Z",
  confirmation: true,
  approval: "Aprobado para generar",
  fixedRate: 0.25,
  rateCurrency: "USD",
  exchangeRate: 7.66,
  reimbursementCurrency: "GTQ",
  totalKm,
  reimbursement: Math.round(totalKm * 0.25 * 7.66 * 100) / 100,
  trips,
  warnings: ["Muestra anonimizada para validar saltos de página, imágenes y archivos inválidos."],
  includeAuthorizationLines: true
};
await writeFile(output, await generateFuelReportPdf(report));
console.log(output);
