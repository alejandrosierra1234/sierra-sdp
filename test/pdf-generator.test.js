import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { generateFuelReportPdf } from "../src/pdf-generator.js";

test("generates a multipage PDF with repeated trip tables and mixed image orientations", async () => {
  const temp = await mkdtemp(join(tmpdir(), "fuel-pdf-test-"));
  const horizontal = join(temp, "horizontal.jpg");
  const vertical = join(temp, "vertical.jpg");
  await sharp({ create: { width: 1200, height: 500, channels: 3, background: "#59a29e" } }).jpeg().toFile(horizontal);
  await sharp({ create: { width: 500, height: 1200, channels: 3, background: "#c4c412" } }).jpeg().toFile(vertical);
  const trips = Array.from({ length: 35 }, (_, index) => ({
    id: String(index + 1), number: index + 1, date: "2026-09-03",
    start: "Origen con un nombre suficientemente largo para envolver texto",
    end: "Destino corporativo", distanceKm: 3.5,
    proofs: index === 0 ? [{ name: "horizontal.jpg", localPath: horizontal }] : index === 1 ? [{ name: "vertical.jpg", localPath: vertical }] : []
  }));
  const report = {
    reportId: "123", companyName: "Empresa de Prueba, S.A.", collaborator: "Persona de Prueba", department: "Operaciones",
    period: { start: "2026-09-01", end: "2026-09-30" }, generatedAt: "2026-10-02T12:00:00Z",
    approval: "Aprobado para generar", fixedRate: 0.25, rateCurrency: "USD", exchangeRate: 7.66,
    reimbursementCurrency: "GTQ", totalKm: 122.5, reimbursement: 581.77, trips, warnings: [], includeAuthorizationLines: true
  };
  const bytes = await generateFuelReportPdf(report);
  assert.ok(bytes.length > 10_000);
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 5);
});

test("does not fail when proof files are missing or invalid", async () => {
  const report = {
    reportId: "124", companyName: "Empresa de Prueba, S.A.", collaborator: "Persona de Prueba", department: "",
    period: { start: "2026-09-01", end: "2026-09-30" }, generatedAt: "2026-10-02T12:00:00Z",
    approval: "Pendiente", fixedRate: 0.25, rateCurrency: "USD", exchangeRate: null,
    reimbursementCurrency: "USD", totalKm: 5, reimbursement: 3.1,
    trips: [{ id: "1", number: 1, date: "2026-09-01", start: "A", end: "B", distanceKm: 5, proofs: [{ name: "bad.jpg", buffer: Buffer.from("invalid") }] }],
    warnings: [], includeAuthorizationLines: false
  };
  const bytes = await generateFuelReportPdf(report);
  assert.ok(bytes.subarray(0, 4).equals(Buffer.from("%PDF")));
});
