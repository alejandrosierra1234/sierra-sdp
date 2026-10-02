import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mapMondayItemToReport } from "./report-model.js";
import { generateFuelReportPdf } from "./pdf-generator.js";

function extensionFor(asset, mimeType) {
  const fromName = String(asset.name || "").split(".").pop()?.toLowerCase();
  if (fromName && fromName !== asset.name) return fromName.replace(/[^a-z0-9]/g, "").slice(0, 8);
  const byMime = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "application/pdf": "pdf" };
  return byMime[mimeType] || String(asset.extension || "bin").replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
}

export class FuelReportService {
  constructor({ client, config, logger, generatePdf = generateFuelReportPdf }) {
    this.client = client;
    this.config = config;
    this.logger = logger;
    this.generatePdf = generatePdf;
    this.inFlight = new Map();
  }

  enqueue(itemId) {
    const id = String(itemId);
    if (this.inFlight.has(id)) return { accepted: false, reason: "already_processing", promise: this.inFlight.get(id) };
    const promise = this.process(id).finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, promise);
    return { accepted: true, promise };
  }

  async process(itemId) {
    const log = this.logger.child({ itemId, boardId: this.config.monday.boardId });
    log.info("fuel_report_started");
    const item = await this.client.getItem(itemId);
    const report = mapMondayItemToReport(item, this.config);
    const existing = await this.client.listReportFiles(itemId, this.config.monday.reportPdfColumnId);
    if (existing.some((file) => file.name === report.filename)) {
      log.info("fuel_report_skipped_existing_version", { version: report.version, filename: report.filename });
      return { status: "skipped", reason: "same_version_exists", report };
    }

    const tempRoot = await mkdtemp(join(tmpdir(), "sierra-fuel-"));
    let totalBytes = 0;
    let count = 0;
    try {
      for (const trip of report.trips) {
        for (const proof of trip.proofs) {
          count += 1;
          if (count > this.config.limits.maxAttachments) {
            proof.error = "Se omitió porque el reporte excede el límite de archivos.";
            continue;
          }
          try {
            const downloaded = await this.client.downloadAsset(proof, this.config.limits);
            totalBytes += downloaded.buffer.length;
            if (totalBytes > this.config.limits.maxTotalAttachmentBytes) {
              proof.error = "Se omitió porque el reporte excede el límite total de archivos.";
              continue;
            }
            proof.mimeType = downloaded.mimeType;
            const extension = extensionFor(proof, downloaded.mimeType);
            const localPath = join(tempRoot, `trip-${trip.number}-proof-${count}.${extension}`);
            await writeFile(localPath, downloaded.buffer, { mode: 0o600 });
            proof.localPath = localPath;
          } catch (error) {
            proof.error = error.message;
            log.warn("fuel_report_proof_unavailable", { trip: trip.number, assetId: proof.id, error: error.message });
          }
        }
      }

      const pdf = await this.generatePdf(report);
      const uploaded = await this.client.uploadReport(itemId, this.config.monday.reportPdfColumnId, report.filename, pdf);
      if (!uploaded?.id) throw new Error("monday did not return an asset ID after upload");
      const verified = await this.client.verifyReportFile(itemId, this.config.monday.reportPdfColumnId, {
        assetId: uploaded.id,
        filename: report.filename
      });
      if (!verified) throw new Error("Uploaded PDF did not appear in Reporte PDF after verification");
      log.info("fuel_report_completed", { version: report.version, filename: report.filename, assetId: String(uploaded.id), bytes: pdf.length });
      return { status: "uploaded", report, assetId: String(uploaded.id), bytes: pdf.length };
    } finally {
      await import("node:fs/promises").then(({ rm }) => rm(tempRoot, { recursive: true, force: true }));
    }
  }
}
