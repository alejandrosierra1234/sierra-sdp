import { PDFDocument } from "npm:pdf-lib@1.17.1";

const API = "https://api.monday.com/v2";
const FILE_API = "https://api.monday.com/v2/file";
const API_VERSION = "2026-10";
const BOARD_ID = "18432867606";
const PROCESSING_LABEL = "Preparando expediente";
const READY_LABEL = "Enviar a firma";
const MAX_FILES = 40;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const inFlight = new Map<string, Promise<Record<string, unknown>>>();

type MondayFile = {
  __typename?: string;
  asset_id?: string;
  name?: string;
  asset?: { id?: string; name?: string; public_url?: string; url?: string; file_extension?: string; file_size?: number };
};
type ColumnValue = { id: string; text?: string; value?: string | Record<string, unknown>; linked_item_ids?: string[]; files?: MondayFile[] };
type Item = { id: string; name: string; board: { id: string }; column_values: ColumnValue[] };
type Source = {
  assetId: string;
  name: string;
  extension: string;
  url: string;
  requiresAuth: boolean;
  size: number;
  columnId: string;
  columnTitle: string;
  itemId: string;
  category: "sdp" | "cotizacion" | "odc" | "liquidacion" | "factura" | "soporte";
  bytes?: Uint8Array;
};

const ITEM_QUERY = `query DossierItems($ids: [ID!]!) {
  items(ids: $ids) {
    id name board { id }
    column_values {
      id text value type
      ... on BoardRelationValue { linked_item_ids }
      ... on FileValue {
        files { __typename ... on FileAssetValue { asset_id name asset { id name public_url url file_extension file_size } } }
      }
    }
  }
}`;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
});
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (value: unknown) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const normalize = (value: unknown) => clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const parse = (value: unknown): Record<string, unknown> => {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, unknown>;
  try { return JSON.parse(String(value)); } catch { return {}; }
};

async function monday(query: string, variables: Record<string, unknown> = {}) {
  const token = Deno.env.get("MONDAY_API_TOKEN");
  if (!token) throw new Error("MONDAY_API_TOKEN no está configurado");
  let last: Error | undefined;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(API, {
        method: "POST",
        headers: { Authorization: token, "content-type": "application/json", "API-Version": API_VERSION },
        body: JSON.stringify({ query, variables }),
      });
      if (!response.ok) throw new Error(`monday HTTP ${response.status}`);
      const result = await response.json();
      if (result.errors?.length) throw new Error(result.errors.map((entry: { message: string }) => entry.message).join("; "));
      return result.data;
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error));
      if (attempt === 3) throw last;
      await delay(350 * 2 ** attempt);
    }
  }
  throw last;
}

async function boardSchema() {
  const data = await monday(`query DossierBoard($ids: [ID!]!) { boards(ids: $ids) { id name columns { id title type } } }`, { ids: [BOARD_ID] });
  if (!data.boards?.[0]) throw new Error("No se encontró el tablero Payments");
  return data.boards[0] as { id: string; name: string; columns: Array<{ id: string; title: string; type: string }> };
}

function requiredColumns(schema: Awaited<ReturnType<typeof boardSchema>>) {
  const find = (title: string) => schema.columns.find((column) => normalize(column.title) === normalize(title));
  const status = find("Estado de firma");
  const sdp = find("Solicitud de Pago (SDP)");
  const output = find("Expediente para aprobación");
  if (!status || !sdp || !output) {
    throw new Error("Faltan columnas requeridas: Estado de firma, Solicitud de Pago (SDP) o Expediente para aprobación");
  }
  return { status, sdp, output };
}

async function getItems(ids: string[]): Promise<Item[]> {
  const unique = [...new Set(ids)].filter((id) => /^\d+$/.test(id));
  if (!unique.length) return [];
  const data = await monday(ITEM_QUERY, { ids: unique });
  return data.items ?? [];
}

function linkedIds(column: ColumnValue) {
  const value = parse(column.value);
  const raw = column.linked_item_ids ?? value.linkedPulseIds ?? value.linked_item_ids ?? value.linkedItemIds ?? [];
  return (Array.isArray(raw) ? raw : []).map((entry: any) => String(entry?.linkedPulseId ?? entry?.item_id ?? entry?.id ?? entry)).filter((id) => /^\d+$/.test(id));
}

function category(title: string, name: string, columnId: string, sdpColumnId: string): Source["category"] {
  const text = normalize(`${title} ${name}`);
  if (columnId === sdpColumnId || /solicitud de pago|\bsdp\b/.test(text)) return "sdp";
  if (/cotizacion|quote/.test(text)) return "cotizacion";
  if (/orden de compra|\bodc\b/.test(text)) return "odc";
  if (/liquidacion|reporte|combustible|tarjeta/.test(text)) return "liquidacion";
  if (/factur|invoice|recibo|receipt/.test(text)) return "factura";
  return "soporte";
}

function assets(column: ColumnValue, title: string, itemId: string, sdpColumnId: string): Source[] {
  return (column.files ?? [])
    .filter((file) => file.__typename === "FileAssetValue")
    .map((file) => {
      const asset = file.asset ?? {};
      const name = file.name || asset.name || `asset-${file.asset_id}`;
      const extension = clean(asset.file_extension || name.split(".").pop()).replace(/^\./, "").toLowerCase();
      return {
        assetId: String(file.asset_id || asset.id || ""),
        name,
        extension,
        url: asset.public_url || asset.url || "",
        requiresAuth: !asset.public_url && Boolean(asset.url),
        size: Number(asset.file_size || 0),
        columnId: column.id,
        columnTitle: title,
        itemId,
        category: category(title, name, column.id, sdpColumnId),
      } satisfies Source;
    })
    .filter((source) => source.assetId && source.url);
}

const RELATED = /(factur|solicitud(?:es)? de compra|\bodc\b|tarjeta|combustible|reembolso|liquidacion)/;
const EXCLUDED = /(expediente para aprobacion|expediente firmado|expediente final|comprobante|constancia de retencion|recepcion de finanzas)/;
const ORDER: Record<Source["category"], number> = { sdp: 0, cotizacion: 1, odc: 2, liquidacion: 3, factura: 4, soporte: 5 };

async function collect(itemId: string, schema: Awaited<ReturnType<typeof boardSchema>>, columns: ReturnType<typeof requiredColumns>) {
  const [payment] = await getItems([itemId]);
  if (!payment || payment.board.id !== BOARD_ID) throw new Error("Payment no encontrado o pertenece a otro tablero");
  const paymentTitles = new Map(schema.columns.map((column) => [column.id, column.title]));
  const sources: Source[] = [];
  const relations: string[] = [];

  for (const column of payment.column_values) {
    const title = paymentTitles.get(column.id) || column.id;
    if (column.id !== columns.output.id && !EXCLUDED.test(normalize(title))) sources.push(...assets(column, title, payment.id, columns.sdp.id));
    if (RELATED.test(normalize(title))) relations.push(...linkedIds(column));
  }

  const related = await getItems(relations);
  const schemas = new Map<string, Map<string, string>>();
  for (const item of related) {
    if (!schemas.has(item.board.id)) {
      const data = await monday(`query RelatedBoard($ids: [ID!]!) { boards(ids: $ids) { columns { id title } } }`, { ids: [item.board.id] });
      schemas.set(item.board.id, new Map((data.boards?.[0]?.columns ?? []).map((column: { id: string; title: string }) => [column.id, column.title])));
    }
    const titles = schemas.get(item.board.id)!;
    for (const column of item.column_values) {
      const title = titles.get(column.id) || column.id;
      if (!EXCLUDED.test(normalize(title))) sources.push(...assets(column, title, item.id, columns.sdp.id));
    }
  }

  const seen = new Set<string>();
  const ordered = sources
    .filter((source) => !seen.has(source.assetId) && seen.add(source.assetId))
    .sort((a, b) => ORDER[a.category] - ORDER[b.category] || a.name.localeCompare(b.name, "es"));
  if (ordered.length > MAX_FILES) throw new Error(`El expediente excede el máximo de ${MAX_FILES} documentos`);
  if (!ordered.length || ordered[0].category !== "sdp") throw new Error("Falta la Solicitud de Pago (SDP)");
  return { payment, sources: ordered };
}

async function fingerprint(sources: Source[]) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(sources.map((source) => [source.assetId, source.size, source.category]))));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

async function download(sources: Source[]) {
  const token = Deno.env.get("MONDAY_API_TOKEN")!;
  let total = 0;
  for (const source of sources) {
    if (source.size > MAX_FILE_BYTES) throw new Error(`“${source.name}” excede el límite por archivo`);
    const response = await fetch(source.url, { headers: source.requiresAuth ? { Authorization: token } : {}, redirect: "follow" });
    if (!response.ok) throw new Error(`No se pudo descargar “${source.name}” (HTTP ${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    total += bytes.length;
    if (bytes.length > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) throw new Error("El expediente excede el tamaño permitido");
    source.bytes = bytes;
  }
}

async function merge(sources: Source[]) {
  const target = await PDFDocument.create();
  target.setTitle("Expediente completo para aprobación");
  target.setAuthor("Hilos y Algodón, S.A.");
  target.setCreator("Sierra · Unificador de Expedientes");
  const manifest: Array<Record<string, unknown>> = [];
  for (const source of sources) {
    try {
      if (source.extension === "pdf" || source.name.toLowerCase().endsWith(".pdf")) {
        const pdf = await PDFDocument.load(source.bytes!, { ignoreEncryption: true, updateMetadata: false });
        const pages = await target.copyPages(pdf, pdf.getPageIndices());
        pages.forEach((page) => target.addPage(page));
        manifest.push({ assetId: source.assetId, name: source.name, category: source.category, pages: pages.length });
      } else if (["jpg", "jpeg", "png"].includes(source.extension)) {
        const image = source.extension === "png" ? await target.embedPng(source.bytes!) : await target.embedJpg(source.bytes!);
        const page = target.addPage([612, 792]);
        const scale = Math.min(564 / image.width, 744 / image.height, 1);
        const width = image.width * scale;
        const height = image.height * scale;
        page.drawImage(image, { x: (612 - width) / 2, y: (792 - height) / 2, width, height });
        manifest.push({ assetId: source.assetId, name: source.name, category: source.category, pages: 1 });
      } else {
        throw new Error(`formato .${source.extension || "desconocido"} no compatible`);
      }
    } catch (error) {
      throw new Error(`No se pudo incorporar “${source.name}”: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!target.getPageCount()) throw new Error("El expediente quedó vacío");
  return { bytes: new Uint8Array(await target.save({ useObjectStreams: false })), pages: target.getPageCount(), manifest };
}

async function existingFiles(itemId: string, columnId: string) {
  const data = await monday(`query ExistingDossier($ids: [ID!]!) { items(ids: $ids) { column_values { id ... on FileValue { files { __typename ... on FileAssetValue { asset_id name asset { id name file_size } } } } } } }`, { ids: [itemId] });
  const column = data.items?.[0]?.column_values?.find((entry: ColumnValue) => entry.id === columnId);
  return (column?.files ?? []).map((file: MondayFile) => ({ id: String(file.asset_id || file.asset?.id || ""), name: file.name || file.asset?.name || "" }));
}

async function upload(itemId: string, columnId: string, filename: string, bytes: Uint8Array) {
  const token = Deno.env.get("MONDAY_API_TOKEN")!;
  const mutation = `mutation ($file: File!) { add_file_to_column(item_id: ${itemId}, column_id: "${columnId}", file: $file) { id name file_size } }`;
  const form = new FormData();
  form.append("query", mutation);
  form.append("map", JSON.stringify({ file: "variables.file" }));
  form.append("file", new Blob([bytes], { type: "application/pdf" }), filename);
  const response = await fetch(FILE_API, { method: "POST", headers: { Authorization: token, "API-Version": API_VERSION }, body: form });
  if (!response.ok) throw new Error(`monday upload HTTP ${response.status}`);
  const result = await response.json();
  if (result.errors?.length || !result.data?.add_file_to_column?.id) throw new Error(result.errors?.[0]?.message || "monday no devolvió el archivo cargado");
  return result.data.add_file_to_column;
}

async function setStatus(itemId: string, columnId: string, label: string) {
  await monday(`mutation DossierStatus($board: ID!, $item: ID!, $column: String!, $value: String!) { change_simple_column_value(board_id: $board, item_id: $item, column_id: $column, value: $value, create_labels_if_missing: true) { id } }`, {
    board: BOARD_ID,
    item: itemId,
    column: columnId,
    value: label,
  });
}

async function processItem(itemId: string, options: { dryRun?: boolean } = {}) {
  const schema = await boardSchema();
  const columns = requiredColumns(schema);
  if (!options.dryRun) await setStatus(itemId, columns.status.id, PROCESSING_LABEL);
  const { sources } = await collect(itemId, schema, columns);
  const version = await fingerprint(sources);
  const filename = `expediente-aprobacion-${itemId}-${version}.pdf`;
  if (options.dryRun) {
    await download(sources);
    const result = await merge(sources);
    return {
      status: "validated",
      dryRun: true,
      itemId,
      filename,
      documents: sources.length,
      pages: result.pages,
      manifest: result.manifest,
    };
  }
  const existing = await existingFiles(itemId, columns.output.id);
  if (existing.some((file: { name: string }) => file.name === filename)) {
    await setStatus(itemId, columns.status.id, READY_LABEL);
    return { status: "ready", reused: true, itemId, filename, documents: sources.length };
  }
  await download(sources);
  const result = await merge(sources);
  const uploaded = await upload(itemId, columns.output.id, filename, result.bytes);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const files = await existingFiles(itemId, columns.output.id);
    if (files.some((file: { id: string; name: string }) => file.id === String(uploaded.id) || file.name === filename)) {
      await setStatus(itemId, columns.status.id, READY_LABEL);
      return { status: "ready", reused: false, itemId, assetId: String(uploaded.id), filename, documents: sources.length, pages: result.pages, manifest: result.manifest };
    }
    await delay(400 * 2 ** attempt);
  }
  throw new Error("El expediente se cargó pero no apareció al verificarlo");
}

function eventValue(event: Record<string, any>) {
  return clean(event.value?.label?.text ?? event.value?.label ?? event.value?.text ?? event.columnValue?.label?.text ?? event.columnValue?.label ?? event.column_value?.label?.text);
}

async function registerWebhook(request: Request, secret: string) {
  const schema = await boardSchema();
  const { sdp } = requiredColumns(schema);
  const url = new URL(request.url);
  url.search = `?key=${encodeURIComponent(secret)}`;
  const created = await monday(`mutation CreateDossierWebhook($board: ID!, $url: String!) { create_webhook(board_id: $board, url: $url, event: change_column_value) { id board_id } }`, {
    board: BOARD_ID,
    url: url.toString(),
  });
  return { status: "created", webhookId: String(created.create_webhook.id), triggerColumnId: sdp.id };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, any>;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (body.challenge) return json({ challenge: body.challenge });
  const expected = Deno.env.get("PAYMENT_DOSSIER_WEBHOOK_SECRET");
  const supplied = new URL(request.url).searchParams.get("key") || request.headers.get("x-webhook-secret");
  if (!expected || supplied !== expected) return json({ error: "Unauthorized" }, 401);
  try {
    if (body.action === "register") return json(await registerWebhook(request, expected));
    if (body.action === "process") {
      const itemId = String(body.itemId || "");
      if (!/^\d+$/.test(itemId)) return json({ error: "Invalid item ID" }, 400);
      return json(await processItem(itemId, { dryRun: body.dryRun === true }));
    }
    const event = (body.event ?? body) as Record<string, any>;
    const boardId = String(event.boardId ?? event.board_id ?? event.board?.id ?? "");
    const itemId = String(event.pulseId ?? event.itemId ?? event.item_id ?? event.pulse?.id ?? "");
    const columnId = String(event.columnId ?? event.column_id ?? "");
    if (boardId !== BOARD_ID) return json({ error: "Board not allowed" }, 403);
    if (!/^\d+$/.test(itemId)) return json({ error: "Invalid item ID" }, 400);
    const schema = await boardSchema();
    const columns = requiredColumns(schema);
    if (columnId !== columns.sdp.id) return json({ status: "ignored", reason: "unrelated_column" });
    if (inFlight.has(itemId)) return json({ status: "accepted", duplicate: true, itemId }, 202);
    let work: Promise<Record<string, unknown>>;
    work = processItem(itemId).finally(() => { if (inFlight.get(itemId) === work) inFlight.delete(itemId); });
    inFlight.set(itemId, work);
    const runtime = globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } };
    if (runtime.EdgeRuntime?.waitUntil) runtime.EdgeRuntime.waitUntil(work); else await work;
    return json({ status: "accepted", itemId }, 202);
  } catch (error) {
    console.error(JSON.stringify({ event: "payment_dossier_failed", error: error instanceof Error ? error.message : String(error) }));
    return json({ error: error instanceof Error ? error.message : String(error) }, 422);
  }
});
