import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const MONDAY_API = "https://api.monday.com/v2";
const MONDAY_FILE_API = "https://api.monday.com/v2/file";
const MONDAY_API_VERSION = "2026-10";
const BOARD_ID = "18433758498";
const TRIGGER_COLUMN_ID = "color_mm7r9b1w";
const TRIGGER_LABEL = "Aprobado para generar";
const REPORT_COLUMN_ID = "file_mm7rp1y1";
const FIXED_RATE_USD_PER_KM = 0.25;
const MAX_ATTACHMENTS = 40;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const inFlight = new Map<string, Promise<void>>();

const COLUMNS = {
  collaborator: "person",
  periodStart: "date_mm7r76eb",
  periodEnd: "date4",
  totalKm: "lookup_mm7rbkya",
  declaredKm: "numeric_mm7rg95t",
  boardRate: "numeric_mm7rt81x",
  exchangeRate: "numeric_mm7rpc7x",
  confirmation: "boolean_mm7ry62j",
  approval: "color_mm7r9b1w",
  tripDate: "date0",
  tripEnd: "text_mm7rn7he",
  tripDistance: "numeric_mm7r864e",
  tripProof: "file_mm7r1zdy",
} as const;

// PNG generated from the existing HA_SRC logo in the repository's index.html.
const LOGO_PNG_BASE64 = "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";

type Col = { id: string; text?: string; value?: string | Record<string, unknown>; files?: MondayFile[] };
type MondayFile = { asset_id?: string; name?: string; asset?: { id?: string; name?: string; public_url?: string; url?: string; file_extension?: string; file_size?: number } };
type Item = { id: string; name: string; board: { id: string }; column_values: Col[]; subitems: Array<{ id: string; name: string; column_values: Col[] }> };
type Proof = { name: string; extension: string; url: string; requiresAuth: boolean; size: number; bytes?: Uint8Array; error?: string };
type Trip = { number: number; date: string | null; start: string; end: string; distance: number; proofs: Proof[] };
type Report = { id: string; collaborator: string; periodStart: string | null; periodEnd: string | null; approval: string; exchangeRate: number | null; totalKm: number; reimbursement: number; currency: string; trips: Trip[]; warnings: string[]; version: string; filename: string };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const safeText = (value: unknown) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const cmap = (values: Col[] = []) => new Map(values.map((value) => [value.id, value]));
const parsed = (col?: Col): Record<string, unknown> => {
  if (!col?.value) return {};
  if (typeof col.value === "object") return col.value;
  try { return JSON.parse(col.value); } catch { return {}; }
};
const numberValue = (col?: Col): number | null => {
  const value = parsed(col);
  let raw = safeText(value.number ?? value.value ?? col?.text).replace(/[^0-9,.-]/g, "");
  if (!raw) return null;
  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");
  raw = comma > dot ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  const result = Number(raw);
  return Number.isFinite(result) ? result : null;
};
const dateValue = (col?: Col): string | null => {
  const value = parsed(col);
  return safeText(value.date ?? value.from ?? value.start_date ?? col?.text).match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
};
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function monday(query: string, variables: Record<string, unknown> = {}) {
  const token = Deno.env.get("MONDAY_API_TOKEN");
  if (!token) throw new Error("MONDAY_API_TOKEN is not configured");
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(MONDAY_API, { method: "POST", headers: { Authorization: token, "content-type": "application/json", "API-Version": MONDAY_API_VERSION }, body: JSON.stringify({ query, variables }) });
      if (!response.ok) throw new Error(`monday HTTP ${response.status}`);
      const result = await response.json();
      if (result.errors?.length) throw new Error(result.errors.map((entry: { message: string }) => entry.message).join("; "));
      return result.data;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === 3) throw lastError;
      await delay(350 * 2 ** attempt);
    }
  }
  throw lastError;
}

async function getItem(itemId: string): Promise<Item> {
  const query = `query FuelReportItem($ids: [ID!]!) { items(ids: $ids) { id name board { id } column_values { id text value type ... on FileValue { files { __typename ... on FileAssetValue { asset_id name is_image asset { id name public_url url file_extension file_size } } } } } subitems { id name column_values { id text value type ... on FileValue { files { __typename ... on FileAssetValue { asset_id name is_image asset { id name public_url url file_extension file_size } } } } } } } }`;
  const data = await monday(query, { ids: [itemId] });
  if (!data.items?.[0]) throw new Error("monday item not found");
  return data.items[0];
}

function proofValues(col?: Col): Proof[] {
  return (col?.files ?? []).map((file) => ({
    name: file.name || file.asset?.name || "respaldo",
    extension: safeText(file.asset?.file_extension || (file.name || "").split(".").pop()).toLowerCase(),
    url: file.asset?.public_url || file.asset?.url || "",
    requiresAuth: !file.asset?.public_url && Boolean(file.asset?.url),
    size: Number(file.asset?.file_size || 0),
  })).filter((file) => file.url);
}

async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

async function toReport(item: Item): Promise<Report> {
  if (item.board.id !== BOARD_ID) throw new Error("Item belongs to an unexpected board");
  const main = cmap(item.column_values);
  const warnings: string[] = [];
  const trips = item.subitems.map((subitem, index): Trip => {
    const cols = cmap(subitem.column_values);
    const distance = numberValue(cols.get(COLUMNS.tripDistance));
    if (distance == null || distance < 0) throw new Error(`Invalid distance on trip ${index + 1}`);
    return { number: index + 1, date: dateValue(cols.get(COLUMNS.tripDate)), start: safeText(subitem.name), end: safeText(cols.get(COLUMNS.tripEnd)?.text), distance, proofs: proofValues(cols.get(COLUMNS.tripProof)) };
  });
  const totalKm = Math.round(trips.reduce((sum, trip) => sum + trip.distance, 0) * 1000) / 1000;
  const boardTotal = numberValue(main.get(COLUMNS.totalKm)) ?? numberValue(main.get(COLUMNS.declaredKm));
  if (boardTotal != null && Math.abs(boardTotal - totalKm) > 0.01) warnings.push(`El total del tablero (${boardTotal}) no coincide con la suma de trayectos (${totalKm}); se usó la suma calculada.`);
  const boardRate = numberValue(main.get(COLUMNS.boardRate));
  if (boardRate != null && Math.abs(boardRate - FIXED_RATE_USD_PER_KM) > 0.000001) warnings.push("La tarifa editable del tablero fue ignorada; se aplicó USD 0.25 por km.");
  const exchangeRate = numberValue(main.get(COLUMNS.exchangeRate));
  const reimbursement = Math.round(totalKm * FIXED_RATE_USD_PER_KM * (exchangeRate || 1) * 100) / 100;
  const snapshot = { item: item.id, collaborator: main.get(COLUMNS.collaborator)?.text, periodStart: dateValue(main.get(COLUMNS.periodStart)), periodEnd: dateValue(main.get(COLUMNS.periodEnd)), approval: main.get(COLUMNS.approval)?.text, exchangeRate, totalKm, trips: trips.map((trip) => ({ ...trip, proofs: trip.proofs.map(({ name, size }) => ({ name, size })) })) };
  const version = await digest(snapshot);
  return { id: item.id, collaborator: safeText(main.get(COLUMNS.collaborator)?.text) || "No indicado", periodStart: dateValue(main.get(COLUMNS.periodStart)), periodEnd: dateValue(main.get(COLUMNS.periodEnd)), approval: safeText(main.get(COLUMNS.approval)?.text), exchangeRate, totalKm, reimbursement, currency: exchangeRate ? "GTQ" : "USD", trips, warnings, version, filename: `reporte-combustible-${item.id}-${version}.pdf` };
}

async function listFiles(itemId: string) {
  const query = `query ExistingReport($ids: [ID!]!) { items(ids: $ids) { column_values { id ... on FileValue { files { __typename ... on FileAssetValue { asset_id name asset { id name file_size } } } } } } }`;
  const data = await monday(query, { ids: [itemId] });
  const col = data.items?.[0]?.column_values?.find((value: Col) => value.id === REPORT_COLUMN_ID);
  return (col?.files ?? []).map((file: MondayFile) => ({ id: String(file.asset_id || file.asset?.id || ""), name: file.name || file.asset?.name || "" }));
}

async function downloadProofs(report: Report) {
  const token = Deno.env.get("MONDAY_API_TOKEN")!;
  let count = 0;
  let total = 0;
  for (const trip of report.trips) for (const proof of trip.proofs) {
    count += 1;
    if (count > MAX_ATTACHMENTS) { proof.error = "Se excedió el máximo de archivos."; continue; }
    if (proof.size > MAX_ATTACHMENT_BYTES) { proof.error = "El archivo excede el tamaño permitido."; continue; }
    try {
      const response = await fetch(proof.url, { headers: proof.requiresAuth ? { Authorization: token } : {}, redirect: "follow" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > MAX_ATTACHMENT_BYTES || total + bytes.length > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error("El archivo excede los límites del reporte");
      total += bytes.length;
      proof.bytes = bytes;
    } catch (error) { proof.error = error instanceof Error ? error.message : String(error); }
  }
}

const PAGE = { width: 612, height: 792, margin: 38 };
const ink = rgb(0.11, 0.11, 0.12);
const graphite = rgb(0.43, 0.43, 0.45);
const fog = rgb(0.96, 0.96, 0.96);
const deep = rgb(0.012, 0.188, 0.161);
const limePale = rgb(0.94, 0.94, 0.69);

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const words = safeText(text).split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > width) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}
function lines(page: PDFPage, values: string[], x: number, y: number, font: PDFFont, size: number, color = ink, lineHeight = size * 1.25) {
  values.forEach((value, index) => page.drawText(value, { x, y: y - index * lineHeight, font, size, color }));
}
function fmtDate(value: string | null) { return value ? new Intl.DateTimeFormat("es-GT", { timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)) : "No indicada"; }
function fmtNumber(value: number, digits = 2) { return new Intl.NumberFormat("es-GT", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value); }
function fmtMoney(value: number, currency: string) { return new Intl.NumberFormat("es-GT", { style: "currency", currency }).format(value); }

async function generatePdf(report: Report) {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Reporte para reembolso de combustible");
  pdf.setAuthor("Hilos y Algodón, S.A.");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(Uint8Array.from(atob(LOGO_PNG_BASE64), (char) => char.charCodeAt(0)));
  const header = (page: PDFPage, title = "REPORTE PARA REEMBOLSO DE COMBUSTIBLE") => {
    const h = 52; const w = logo.width * h / logo.height;
    page.drawImage(logo, { x: 44, y: 706, width: w, height: h });
    lines(page, wrap(title, bold, 15, 330), 112, 744, bold, 15, deep, 18);
    page.drawLine({ start: { x: 38, y: 694 }, end: { x: 574, y: 694 }, thickness: 2, color: deep });
    return 675;
  };
  let page = pdf.addPage([PAGE.width, PAGE.height]);
  let y = header(page);
  page.drawRectangle({ x: 38, y: y - 88, width: 536, height: 88, color: fog });
  const meta = [["EMPRESA", "Hilos y Algodón, S.A."], ["COLABORADOR", report.collaborator], ["PERÍODO", `${fmtDate(report.periodStart)} - ${fmtDate(report.periodEnd)}`], ["REPORTE", report.id]];
  meta.forEach(([label, value], index) => { const x = 48 + (index % 2) * 265; const top = y - 15 - Math.floor(index / 2) * 41; page.drawText(label, { x, y: top, font: bold, size: 7, color: graphite }); lines(page, wrap(value, regular, 9, 238).slice(0, 2), x, top - 13, regular, 9); });
  y -= 108;
  page.drawText("RESUMEN", { x: 38, y, font: bold, size: 10, color: deep }); y -= 14;
  const cards = [["TRAYECTOS", String(report.trips.length)], ["KILÓMETROS", `${fmtNumber(report.totalKm)} km`], ["TARIFA FIJA", "USD 0.25 / km"], ["REEMBOLSO", fmtMoney(report.reimbursement, report.currency)], ["TIPO DE CAMBIO", report.exchangeRate ? fmtNumber(report.exchangeRate, 4) : "No aplica"], ["APROBACIÓN", report.approval || "Pendiente"]];
  cards.forEach(([label, value], index) => { const width = 174; const x = 38 + (index % 3) * 181; const top = y - Math.floor(index / 3) * 49; page.drawRectangle({ x, y: top - 42, width, height: 42, color: index === 3 ? limePale : fog }); page.drawText(label, { x: x + 8, y: top - 12, font: bold, size: 7, color: graphite }); lines(page, wrap(value, bold, 10, 158).slice(0, 2), x + 8, top - 28, bold, 10); });
  y -= 112;
  const tableHeader = () => { page.drawRectangle({ x: 38, y: y - 24, width: 536, height: 24, color: deep }); [["No.", 44], ["Fecha", 76], ["Inicio", 147], ["Fin / destino", 303], ["Km", 520]].forEach(([label, x]) => page.drawText(String(label), { x: Number(x), y: y - 16, font: bold, size: 8, color: rgb(1, 1, 1) })); y -= 24; };
  page.drawText("DETALLE DE TRAYECTOS", { x: 38, y, font: bold, size: 10, color: deep }); y -= 14; tableHeader();
  for (const trip of report.trips) {
    if (y < 110) { page = pdf.addPage([PAGE.width, PAGE.height]); y = header(page, "DETALLE DE TRAYECTOS"); tableHeader(); }
    const values = [String(trip.number), fmtDate(trip.date), trip.start || "No indicado", trip.end || "No indicado", fmtNumber(trip.distance)];
    const xs = [44, 76, 147, 303, 520]; const widths = [26, 65, 150, 211, 48];
    const cellLines = values.map((value, i) => wrap(value, regular, 8, widths[i]));
    const height = Math.max(26, Math.max(...cellLines.map((value) => value.length)) * 10 + 8);
    cellLines.forEach((value, i) => lines(page, value, xs[i], y - 14, regular, 8, ink, 10));
    page.drawLine({ start: { x: 38, y: y - height }, end: { x: 574, y: y - height }, thickness: 0.5, color: graphite }); y -= height;
  }
  if (report.warnings.length) { y -= 10; const warningLines = report.warnings.flatMap((warning) => wrap(`• ${warning}`, regular, 7.5, 514)); const h = warningLines.length * 9 + 14; if (y - h > 42) { page.drawRectangle({ x: 38, y: y - h, width: 536, height: h, color: limePale }); lines(page, warningLines, 46, y - 11, regular, 7.5, ink, 9); } }
  const allProofs = report.trips.flatMap((trip) => trip.proofs.map((proof) => ({ trip, proof })));
  for (const { trip, proof } of allProofs) {
    if (!proof.bytes || proof.error) continue;
    try {
      if (proof.extension === "pdf" || proof.name.toLowerCase().endsWith(".pdf")) {
        const source = await PDFDocument.load(proof.bytes);
        for (let i = 0; i < source.getPageCount(); i += 1) {
          page = pdf.addPage([PAGE.width, PAGE.height]); y = header(page, `ANEXO - TRAYECTO ${trip.number}`);
          page.drawText(`${fmtDate(trip.date)} | ${trip.start} - ${trip.end} | ${fmtNumber(trip.distance)} km`, { x: 38, y, font: regular, size: 8, color: graphite }); y -= 18;
          const [embedded] = await pdf.embedPdf(proof.bytes, [i]); const scale = Math.min(536 / embedded.width, (y - 40) / embedded.height); const w = embedded.width * scale; const h = embedded.height * scale;
          page.drawPage(embedded, { x: (612 - w) / 2, y: y - h, width: w, height: h });
        }
      } else {
        page = pdf.addPage([PAGE.width, PAGE.height]); y = header(page, `ANEXO - TRAYECTO ${trip.number}`);
        page.drawText(`${fmtDate(trip.date)} | ${trip.start} - ${trip.end} | ${fmtNumber(trip.distance)} km`, { x: 38, y, font: regular, size: 8, color: graphite }); y -= 18;
        const image = proof.extension === "png" ? await pdf.embedPng(proof.bytes) : await pdf.embedJpg(proof.bytes);
        const scale = Math.min(536 / image.width, (y - 40) / image.height, 1); const w = image.width * scale; const h = image.height * scale;
        page.drawImage(image, { x: (612 - w) / 2, y: y - h, width: w, height: h });
      }
    } catch (error) { console.warn(JSON.stringify({ event: "proof_skipped", itemId: report.id, trip: trip.number, error: error instanceof Error ? error.message : String(error) })); }
  }
  pdf.getPages().forEach((current, index, pages) => { const label = `Página ${index + 1} de ${pages.length}`; current.drawText("Documento generado automáticamente desde monday.com", { x: 38, y: 20, font: regular, size: 7.5, color: graphite }); current.drawText(label, { x: 574 - regular.widthOfTextAtSize(label, 7.5), y: 20, font: regular, size: 7.5, color: graphite }); });
  return new Uint8Array(await pdf.save({ useObjectStreams: false }));
}

async function upload(itemId: string, filename: string, bytes: Uint8Array) {
  const token = Deno.env.get("MONDAY_API_TOKEN")!;
  const mutation = `mutation ($file: File!) { add_file_to_column(item_id: ${itemId}, column_id: "${REPORT_COLUMN_ID}", file: $file) { id name file_size } }`;
  const form = new FormData();
  form.append("query", mutation); form.append("map", JSON.stringify({ file: "variables.file" })); form.append("file", new Blob([bytes], { type: "application/pdf" }), filename);
  const response = await fetch(MONDAY_FILE_API, { method: "POST", headers: { Authorization: token, "API-Version": MONDAY_API_VERSION }, body: form });
  if (!response.ok) throw new Error(`monday upload HTTP ${response.status}`);
  const result = await response.json();
  if (result.errors?.length || !result.data?.add_file_to_column?.id) throw new Error(result.errors?.[0]?.message || "monday did not return uploaded asset");
  return result.data.add_file_to_column;
}

async function processItem(itemId: string) {
  console.log(JSON.stringify({ event: "fuel_report_started", itemId }));
  const item = await getItem(itemId);
  const report = await toReport(item);
  if ((await listFiles(itemId)).some((file: { name: string }) => file.name === report.filename)) { console.log(JSON.stringify({ event: "fuel_report_skipped_existing", itemId, version: report.version })); return; }
  await downloadProofs(report);
  const pdf = await generatePdf(report);
  // A repeated webhook can arrive while the first invocation is generating the PDF.
  // Check again immediately before the irreversible upload.
  if ((await listFiles(itemId)).some((file: { name: string }) => file.name === report.filename)) { console.log(JSON.stringify({ event: "fuel_report_skipped_concurrent", itemId, version: report.version })); return; }
  const uploaded = await upload(itemId, report.filename, pdf);
  for (let attempt = 0; attempt < 4; attempt += 1) { if ((await listFiles(itemId)).some((file: { id: string; name: string }) => file.id === String(uploaded.id) || file.name === report.filename)) { console.log(JSON.stringify({ event: "fuel_report_completed", itemId, version: report.version, assetId: String(uploaded.id), bytes: pdf.length })); return; } await delay(400 * 2 ** attempt); }
  throw new Error("Uploaded PDF was not visible after verification");
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (body.challenge) return json({ challenge: body.challenge });
  const expectedSecret = Deno.env.get("FUEL_REPORT_WEBHOOK_SECRET");
  const suppliedSecret = new URL(request.url).searchParams.get("key") || request.headers.get("x-webhook-secret");
  if (!expectedSecret || suppliedSecret !== expectedSecret) return json({ error: "Unauthorized" }, 401);
  const event = (body.event ?? body) as Record<string, any>;
  const boardId = String(event.boardId ?? event.board_id ?? event.board?.id ?? "");
  const itemId = String(event.pulseId ?? event.itemId ?? event.item_id ?? event.pulse?.id ?? "");
  const columnId = String(event.columnId ?? event.column_id ?? "");
  const label = safeText(event.value?.label?.text ?? event.value?.label ?? event.value?.text ?? event.columnValue?.label?.text ?? event.columnValue?.label ?? event.column_value?.label?.text);
  if (boardId !== BOARD_ID) return json({ error: "Board not allowed" }, 403);
  if (!/^\d+$/.test(itemId)) return json({ error: "Invalid item ID" }, 400);
  if (columnId !== TRIGGER_COLUMN_ID) return json({ status: "ignored", reason: "unrelated_column" });
  if (label.toLocaleLowerCase("es") !== TRIGGER_LABEL.toLocaleLowerCase("es")) return json({ status: "ignored", reason: "trigger_label_not_selected" });
  const existingWork = inFlight.get(itemId);
  if (existingWork) return json({ status: "accepted", itemId, duplicate: true }, 202);
  let work: Promise<void>;
  work = processItem(itemId)
    .catch((error) => console.error(JSON.stringify({ event: "fuel_report_failed", itemId, error: error instanceof Error ? error.message : String(error) })))
    .finally(() => { if (inFlight.get(itemId) === work) inFlight.delete(itemId); });
  inFlight.set(itemId, work);
  const runtime = globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } };
  if (runtime.EdgeRuntime?.waitUntil) runtime.EdgeRuntime.waitUntil(work); else await work;
  return json({ status: "accepted", itemId }, 202);
});
