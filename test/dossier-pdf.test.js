import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import sharp from "sharp";
import { mergeDossierPdf } from "../src/dossier-pdf.js";

async function pdfWithText(text) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  page.drawText(text, { x: 40, y: 740, size: 18, font });
  return Buffer.from(await pdf.save());
}

test("conserva la SDP como primera página y añade PDF e imagen", async () => {
  const image = await sharp({ create: { width: 300, height: 200, channels: 3, background: "white" } }).png().toBuffer();
  const result = await mergeDossierPdf([
    { assetId: "1", name: "SDP.pdf", extension: "pdf", mimeType: "application/pdf", category: "sdp", bytes: await pdfWithText("SDP") },
    { assetId: "2", name: "Factura.pdf", extension: "pdf", mimeType: "application/pdf", category: "factura", bytes: await pdfWithText("FACTURA") },
    { assetId: "3", name: "Cotizacion.png", extension: "png", mimeType: "image/png", category: "cotizacion", bytes: image }
  ]);

  const merged = await PDFDocument.load(result.bytes);
  assert.equal(merged.getPageCount(), 3);
  assert.deepEqual(result.manifest.map((entry) => entry.category), ["sdp", "factura", "cotizacion"]);
  assert.ok(result.bytes.subarray(0, 4).equals(Buffer.from("%PDF")));
});

test("rechaza un expediente sin SDP al inicio", async () => {
  await assert.rejects(
    mergeDossierPdf([{ assetId: "2", name: "Factura.pdf", extension: "pdf", category: "factura", bytes: await pdfWithText("FACTURA") }]),
    /SDP debe ser el primer documento/
  );
});
