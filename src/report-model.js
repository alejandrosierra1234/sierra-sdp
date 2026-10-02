import { createHash } from "node:crypto";

function columnMap(values = []) {
  return new Map(values.map((column) => [column.id, column]));
}

export function normalizeNumber(input) {
  if (input == null || input === "") return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  let raw = String(input).trim().replace(/[^0-9,.-]/g, "");
  if (!raw) return null;
  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");
  if (comma > dot) raw = raw.replace(/\./g, "").replace(",", ".");
  else raw = raw.replace(/,/g, "");
  const result = Number(raw);
  return Number.isFinite(result) ? result : null;
}

function jsonValue(column) {
  if (!column?.value) return {};
  if (typeof column.value === "object") return column.value;
  try { return JSON.parse(column.value); } catch { return {}; }
}

function textValue(column) {
  return String(column?.text || "").trim();
}

function numberValue(column) {
  const parsed = jsonValue(column);
  return normalizeNumber(parsed.number ?? parsed.value ?? textValue(column));
}

function dateValue(column) {
  const parsed = jsonValue(column);
  const raw = parsed.date || parsed.from || parsed.start_date || textValue(column);
  if (!raw) return null;
  const match = String(raw).match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function booleanValue(column) {
  const parsed = jsonValue(column);
  if (typeof parsed.checked === "boolean") return parsed.checked;
  if (typeof parsed.checked === "string") return parsed.checked === "true";
  return /^(yes|true|checked|sí|si|v)$/i.test(textValue(column));
}

function fileValues(column) {
  if (Array.isArray(column?.files)) {
    return column.files.map((file) => ({
      id: String(file.asset_id || file.asset?.id || ""),
      name: file.name || file.asset?.name || "respaldo",
      mimeType: file.mime_type || "",
      extension: file.asset?.file_extension || "",
      size: Number(file.asset?.file_size || 0),
      downloadUrl: file.asset?.public_url || file.asset?.url || "",
      requiresAuth: !file.asset?.public_url && Boolean(file.asset?.url)
    })).filter((file) => file.id || file.downloadUrl);
  }
  const parsed = jsonValue(column);
  return (parsed.files || []).map((file) => ({
    id: String(file.assetId || file.asset_id || ""),
    name: file.name || "respaldo",
    extension: String(file.name || "").split(".").pop()?.toLowerCase() || "",
    size: Number(file.fileSize || 0),
    downloadUrl: "",
    requiresAuth: false
  }));
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

export function reportVersion(report) {
  const snapshot = {
    reportId: report.reportId,
    collaborator: report.collaborator,
    department: report.department,
    period: report.period,
    confirmation: report.confirmation,
    approval: report.approval,
    fixedRate: report.fixedRate,
    exchangeRate: report.exchangeRate,
    trips: report.trips.map((trip) => ({
      id: trip.id,
      date: trip.date,
      start: trip.start,
      end: trip.end,
      distanceKm: trip.distanceKm,
      proofs: trip.proofs.map(({ id, name, size }) => ({ id, name, size }))
    }))
  };
  return createHash("sha256").update(JSON.stringify(stable(snapshot))).digest("hex").slice(0, 16);
}

export function mapMondayItemToReport(item, config, generatedAt = new Date()) {
  if (!item || !/^\d+$/.test(String(item.id))) throw new Error("Invalid monday item");
  if (String(item.board?.id) !== String(config.monday.boardId)) throw new Error("Item belongs to an unexpected board");
  const main = columnMap(item.column_values);
  const ids = config.monday.columns;
  const warnings = [];
  const trips = (item.subitems || []).map((subitem, index) => {
    const values = columnMap(subitem.column_values);
    const subIds = config.monday.subitemColumns;
    const distanceKm = numberValue(values.get(subIds.distance));
    if (distanceKm == null || distanceKm < 0) throw new Error(`Invalid distance on trip ${index + 1}`);
    return {
      id: String(subitem.id),
      number: index + 1,
      date: dateValue(values.get(subIds.date)),
      start: String(subitem.name || "").trim(),
      end: textValue(values.get(subIds.end)),
      distanceKm,
      proofs: fileValues(values.get(subIds.proof))
    };
  });
  const totalKm = Math.round(trips.reduce((sum, trip) => sum + trip.distanceKm, 0) * 1000) / 1000;
  const boardTotal = numberValue(main.get(ids.totalKm)) ?? numberValue(main.get(ids.declaredKm));
  if (boardTotal != null && Math.abs(boardTotal - totalKm) > 0.01) {
    warnings.push(`El total del tablero (${boardTotal}) no coincide con la suma de trayectos (${totalKm}). Se usó la suma del servidor.`);
  }
  const boardRate = numberValue(main.get(ids.rate));
  if (boardRate != null && Math.abs(boardRate - config.fuelRatePerKm) > 0.000001) {
    warnings.push("La tarifa del tablero no coincide con la tarifa segura del sistema y fue ignorada.");
  }
  const exchangeRate = numberValue(main.get(ids.exchangeRate));
  const baseAmount = totalKm * config.fuelRatePerKm;
  const reimbursement = roundCurrency(exchangeRate ? baseAmount * exchangeRate : baseAmount);
  const startColumn = main.get(ids.periodStart);
  const endColumn = main.get(ids.periodEnd);
  const startJson = jsonValue(startColumn);
  const period = {
    start: dateValue(startColumn),
    end: dateValue(endColumn) || startJson.to || startJson.end_date || null
  };
  const report = {
    reportId: String(item.id),
    itemName: String(item.name || ""),
    companyName: config.companyName,
    collaborator: textValue(main.get(ids.collaborator)) || "No indicado",
    department: ids.department ? textValue(main.get(ids.department)) : "",
    period,
    generatedAt: generatedAt.toISOString(),
    confirmation: booleanValue(main.get(ids.confirmation)),
    approval: textValue(main.get(ids.approval)),
    fixedRate: config.fuelRatePerKm,
    rateCurrency: config.fuelRateCurrency,
    exchangeRate,
    reimbursement,
    reimbursementCurrency: exchangeRate ? config.reimbursementCurrency : config.fuelRateCurrency,
    totalKm,
    trips,
    warnings,
    includeAuthorizationLines: config.includeAuthorizationLines
  };
  report.version = reportVersion(report);
  report.filename = `reporte-combustible-${report.reportId}-${report.version}.pdf`;
  return report;
}

export function formatDate(date, locale = "es-GT") {
  if (!date) return "No indicada";
  const value = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(value.getTime())) return "No indicada";
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(value);
}

export function formatNumber(value, digits = 2, locale = "es-GT") {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

export function formatMoney(value, currency, locale = "es-GT") {
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2 }).format(value);
}
