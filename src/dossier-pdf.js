import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

const LETTER = { width: 612, height: 792, margin: 24 };

function isPdf(document) {
  return document.mimeType === "application/pdf" || document.extension === "pdf" || document.name.toLowerCase().endsWith(".pdf");
}

async function appendPdf(target, bytes) {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const pages = await target.copyPages(source, source.getPageIndices());
  pages.forEach((page) => target.addPage(page));
  return pages.length;
}

async function appendImage(target, document) {
  const png = await sharp(document.bytes, { failOn: "error" }).rotate().png().toBuffer();
  const image = await target.embedPng(png);
  const page = target.addPage([LETTER.width, LETTER.height]);
  const scale = Math.min(
    (LETTER.width - LETTER.margin * 2) / image.width,
    (LETTER.height - LETTER.margin * 2) / image.height,
    1
  );
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, {
    x: (LETTER.width - width) / 2,
    y: (LETTER.height - height) / 2,
    width,
    height
  });
  return 1;
}

export async function mergeDossierPdf(documents, { title = "Expediente para aprobación" } = {}) {
  if (!documents.length) throw new Error("El expediente no contiene documentos");
  if (documents[0].category !== "sdp") throw new Error("La SDP debe ser el primer documento del expediente");

  const target = await PDFDocument.create();
  target.setTitle(title);
  target.setAuthor("Hilos y Algodón, S.A.");
  target.setSubject("Expediente completo de gestión para revisión y firma");
  target.setCreator("Sierra · Unificador de Expedientes");

  const manifest = [];
  for (const document of documents) {
    let pages;
    try {
      pages = isPdf(document)
        ? await appendPdf(target, document.bytes)
        : await appendImage(target, document);
    } catch (error) {
      throw new Error(`No se pudo incorporar “${document.name}”: ${error.message}`);
    }
    manifest.push({ assetId: document.assetId, name: document.name, category: document.category, pages });
  }

  if (!target.getPageCount()) throw new Error("El expediente quedó sin páginas");
  return {
    bytes: Buffer.from(await target.save({ useObjectStreams: false })),
    manifest,
    pageCount: target.getPageCount()
  };
}
