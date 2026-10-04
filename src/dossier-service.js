import { createHash } from "node:crypto";
import { mergeDossierPdf } from "./dossier-pdf.js";

const OUTPUT_TITLE = /expediente\s+(para\s+)?aprobaci[oó]n/i;
const EXCLUDED_TITLE = /(expediente\s+firmado|expediente\s+final|comprobante|constancia\s+de\s+retenci[oó]n|recepci[oó]n\s+de\s+finanzas)/i;
const RELATED_TITLE = /(factur|solicitud(?:es)?\s+de\s+compra|\bodc\b|tarjeta|credit\s*card|combustible|reembolso|liquidaci[oó]n)/i;

function safe(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
}

function parsed(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function linkedIds(column) {
  const value = parsed(column.value);
  const raw = value.linkedPulseIds || value.linked_item_ids || value.linkedItemIds || [];
  return raw.map((entry) => String(entry.linkedPulseId ?? entry.item_id ?? entry.id ?? entry)).filter((id) => /^\d+$/.test(id));
}

function fileAssets(column, title, sourceItemId) {
  return (column.files || [])
    .filter((file) => file.__typename === "FileAssetValue")
    .map((file) => {
      const asset = file.asset || {};
      const name = file.name || asset.name || `asset-${file.asset_id}`;
      const extension = String(asset.file_extension || name.split(".").pop() || "").replace(/^\.+/, "").toLowerCase();
      return {
        assetId: String(file.asset_id || asset.id || ""),
        name,
        extension,
        mimeType: extension === "pdf" ? "application/pdf" : undefined,
        downloadUrl: asset.public_url || asset.url || "",
        requiresAuth: !asset.public_url && Boolean(asset.url),
        size: Number(asset.file_size || 0),
        sourceItemId: String(sourceItemId),
        sourceColumnId: column.id,
        sourceTitle: title
      };
    })
    .filter((asset) => asset.assetId && asset.downloadUrl);
}

function categoryFor(document, sdpColumnId) {
  const haystack = `${document.sourceTitle} ${document.name}`;
  if (document.sourceColumnId === sdpColumnId || /solicitud\s+de\s+pago|\bsdp\b/i.test(haystack)) return "sdp";
  if (/cotizaci[oó]n|quote/i.test(haystack)) return "cotizacion";
  if (/orden\s+de\s+compra|\bodc\b/i.test(haystack)) return "odc";
  if (/liquidaci[oó]n|reporte|combustible|tarjeta/i.test(haystack)) return "liquidacion";
  if (/factur|invoice|recibo|receipt/i.test(haystack)) return "factura";
  return "soporte";
}

const ORDER = { sdp: 0, cotizacion: 1, odc: 2, liquidacion: 3, factura: 4, soporte: 5 };

function dedupeAndOrder(documents, sdpColumnId) {
  const seen = new Set();
  return documents
    .map((document) => ({ ...document, category: categoryFor(document, sdpColumnId) }))
    .filter((document) => !seen.has(document.assetId) && seen.add(document.assetId))
    .sort((a, b) => ORDER[a.category] - ORDER[b.category] || a.name.localeCompare(b.name, "es"));
}

function fingerprint(documents) {
  return createHash("sha256")
    .update(JSON.stringify(documents.map(({ assetId, size, category }) => [assetId, size, category])))
    .digest("hex")
    .slice(0, 16);
}

export class PaymentDossierService {
  constructor({ client, config, logger, mergePdf = mergeDossierPdf }) {
    this.client = client;
    this.config = config;
    this.logger = logger;
    this.mergePdf = mergePdf;
    this.inFlight = new Map();
  }

  async collect(paymentId) {
    const payment = await this.client.getItem(paymentId);
    if (String(payment.board?.id) !== String(this.config.dossier.paymentsBoardId)) {
      throw new Error("El Payment pertenece a un tablero no autorizado");
    }
    const paymentSchema = await this.client.inspectBoard(payment.board.id);
    const titles = new Map(paymentSchema.columns.map((column) => [column.id, column.title]));
    const documents = [];
    const relationIds = [];

    for (const column of payment.column_values || []) {
      const title = titles.get(column.id) || column.id;
      if (column.id !== this.config.dossier.outputColumnId && !OUTPUT_TITLE.test(title) && !EXCLUDED_TITLE.test(title)) {
        documents.push(...fileAssets(column, title, payment.id));
      }
      if (RELATED_TITLE.test(title)) relationIds.push(...linkedIds(column));
    }

    const related = await this.client.getItems(relationIds);
    const schemas = new Map();
    for (const item of related) {
      const boardId = String(item.board?.id || "");
      if (!schemas.has(boardId)) schemas.set(boardId, await this.client.inspectBoard(boardId));
      const relatedTitles = new Map(schemas.get(boardId).columns.map((column) => [column.id, column.title]));
      for (const column of item.column_values || []) {
        const title = relatedTitles.get(column.id) || column.id;
        if (!OUTPUT_TITLE.test(title) && !EXCLUDED_TITLE.test(title)) {
          documents.push(...fileAssets(column, title, item.id));
        }
      }
    }

    const ordered = dedupeAndOrder(documents, this.config.dossier.sdpColumnId);
    if (ordered.length > this.config.limits.maxAttachments) {
      throw new Error(`El expediente excede el máximo de ${this.config.limits.maxAttachments} documentos`);
    }
    if (!ordered.some((document) => document.category === "sdp")) {
      throw new Error("No se puede preparar el expediente: falta la Solicitud de Pago (SDP)");
    }
    if (ordered[0].category !== "sdp") throw new Error("No se pudo colocar la SDP al inicio del expediente");
    return { payment, documents: ordered };
  }

  async process(paymentId, { dryRun = false } = {}) {
    const id = String(paymentId);
    if (!/^\d+$/.test(id)) throw new Error("Payment ID inválido");
    if (this.inFlight.has(id)) return this.inFlight.get(id);
    const work = this.#process(id, { dryRun }).finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, work);
    return work;
  }

  async #process(paymentId, { dryRun }) {
    const { payment, documents } = await this.collect(paymentId);
    const version = fingerprint(documents);
    const filename = `expediente-aprobacion-${paymentId}-${version}.pdf`;
    const existing = await this.client.listReportFiles(paymentId, this.config.dossier.outputColumnId);
    if (existing.some((file) => file.name === filename)) {
      return { status: "ready", reused: true, filename, version, documents: documents.length };
    }

    let totalBytes = 0;
    const hydrated = [];
    for (const document of documents) {
      const downloaded = await this.client.downloadAsset(document, this.config.limits);
      totalBytes += downloaded.buffer.length;
      if (totalBytes > this.config.limits.maxTotalAttachmentBytes) {
        throw new Error("El expediente excede el tamaño total permitido");
      }
      hydrated.push({ ...document, bytes: downloaded.buffer, mimeType: downloaded.mimeType });
    }

    const merged = await this.mergePdf(hydrated, { title: `Expediente ${payment.name || paymentId}` });
    const result = {
      status: dryRun ? "validated" : "uploaded",
      reused: false,
      filename,
      version,
      documents: documents.length,
      pages: merged.pageCount,
      manifest: merged.manifest
    };
    if (dryRun) return result;

    const uploaded = await this.client.uploadPdf(paymentId, this.config.dossier.outputColumnId, filename, merged.bytes);
    if (!uploaded?.id) throw new Error("monday no devolvió el asset del expediente");
    const verified = await this.client.verifyReportFile(paymentId, this.config.dossier.outputColumnId, {
      assetId: uploaded.id,
      filename
    });
    if (!verified) throw new Error("El expediente cargado no apareció en monday después de verificarlo");
    this.logger?.info("payment_dossier_completed", { paymentId, filename, pages: merged.pageCount, documents: documents.length });
    return { ...result, assetId: String(uploaded.id) };
  }
}
