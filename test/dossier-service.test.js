import assert from "node:assert/strict";
import test from "node:test";
import { PaymentDossierService } from "../src/dossier-service.js";
import { testConfig } from "./helpers.js";

const logger = { info() {}, warn() {}, error() {} };

function fileColumn(id, assetId, name) {
  return {
    id,
    files: [{
      __typename: "FileAssetValue",
      asset_id: assetId,
      name,
      asset: { id: assetId, name, public_url: `https://files.example/${assetId}`, file_extension: "pdf", file_size: 100 }
    }]
  };
}

function fakeClient(overrides = {}) {
  const payment = {
    id: "100",
    name: "Pago de prueba",
    board: { id: "18432867606" },
    column_values: [
      fileColumn("file_mm7sxf2y", "sdp-1", "Solicitud de Pago.pdf"),
      { id: "board_relation_invoices", value: JSON.stringify({ linkedPulseIds: [{ linkedPulseId: "200" }] }) }
    ]
  };
  const invoice = {
    id: "200",
    name: "Factura vinculada",
    board: { id: "18432936014" },
    column_values: [fileColumn("factura", "invoice-1", "Factura.pdf")]
  };
  return {
    async getItem() { return structuredClone(payment); },
    async getItems(ids) { return ids.includes("200") ? [structuredClone(invoice)] : []; },
    async inspectBoard(boardId) {
      return String(boardId) === "18432867606"
        ? { columns: [{ id: "file_mm7sxf2y", title: "Solicitud de Pago (SDP)" }, { id: "board_relation_invoices", title: "Facturas vinculadas" }] }
        : { columns: [{ id: "factura", title: "Factura" }] };
    },
    async listReportFiles() { return []; },
    async downloadAsset(asset) { return { buffer: Buffer.from(asset.assetId), mimeType: "application/pdf" }; },
    async uploadPdf(_itemId, _columnId, filename) { return { id: "merged-1", name: filename }; },
    async verifyReportFile() { return true; },
    ...overrides
  };
}

test("recopila la SDP y soportes vinculados en orden y los carga una sola vez", async () => {
  let mergedDocuments;
  let uploadTarget;
  const client = fakeClient({
    async uploadPdf(itemId, columnId, filename) {
      uploadTarget = { itemId, columnId, filename };
      return { id: "merged-1", name: filename };
    }
  });
  const service = new PaymentDossierService({
    client,
    config: testConfig(),
    logger,
    mergePdf: async (documents) => {
      mergedDocuments = documents;
      return { bytes: Buffer.from("%PDF"), pageCount: 2, manifest: documents.map(({ assetId, category }) => ({ assetId, category })) };
    }
  });

  const result = await service.process("100");
  assert.deepEqual(mergedDocuments.map((entry) => entry.category), ["sdp", "factura"]);
  assert.deepEqual(mergedDocuments.map((entry) => entry.assetId), ["sdp-1", "invoice-1"]);
  assert.equal(uploadTarget.itemId, "100");
  assert.equal(uploadTarget.columnId, "file_mm7m9w7t");
  assert.equal(result.status, "uploaded");
  assert.equal(result.assetId, "merged-1");

  const reused = new PaymentDossierService({
    client: fakeClient({ async listReportFiles() { return [{ name: result.filename }]; } }),
    config: testConfig(), logger,
    mergePdf: async () => { throw new Error("no debe regenerarse"); }
  });
  assert.equal((await reused.process("100")).reused, true);
});

test("no permite generar sin SDP", async () => {
  const client = fakeClient({
    async getItem() {
      const item = await fakeClient().getItem();
      item.column_values = item.column_values.filter((column) => column.id !== "file_mm7sxf2y");
      return item;
    }
  });
  const service = new PaymentDossierService({ client, config: testConfig(), logger, mergePdf: async () => ({}) });
  await assert.rejects(service.process("100"), /falta la Solicitud de Pago/);
});
