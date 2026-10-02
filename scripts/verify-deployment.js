import "dotenv/config";
import { randomBytes } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { MondayClient } from "../src/monday-client.js";

const config = loadConfig();
if (!config.publicWebhookUrl) throw new Error("PUBLIC_WEBHOOK_URL is required");
const webhookUrl = new URL(config.publicWebhookUrl);
if (webhookUrl.protocol !== "https:") throw new Error("PUBLIC_WEBHOOK_URL must use HTTPS");

const healthUrl = new URL("/healthz", webhookUrl);
const health = await fetch(healthUrl, { signal: AbortSignal.timeout(15_000) });
if (!health.ok) throw new Error(`Health check returned HTTP ${health.status}`);

const challengeValue = randomBytes(18).toString("hex");
const challenge = await fetch(webhookUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ challenge: challengeValue }),
  signal: AbortSignal.timeout(15_000)
});
const challengeBody = await challenge.json();
if (!challenge.ok || challengeBody.challenge !== challengeValue) {
  throw new Error("The public webhook did not echo monday's challenge correctly");
}

const client = new MondayClient(config.monday);
const board = await client.inspectBoard(config.monday.boardId);
const columns = new Map(board.columns.map((column) => [column.id, column]));
const required = [
  [config.monday.triggerColumnId, "trigger", ["color", "status"]],
  [config.monday.reportPdfColumnId, "Reporte PDF", ["file"]]
];

for (const [id, label, allowedTypes] of required) {
  const column = columns.get(id);
  if (!column) throw new Error(`Missing ${label} column (${id}) on board ${board.id}`);
  if (allowedTypes && !allowedTypes.includes(column.type)) {
    throw new Error(`${label} column ${id} has unexpected type ${column.type}`);
  }
}

const trigger = columns.get(config.monday.triggerColumnId);
if (!JSON.stringify(trigger.settings || {}).includes(config.monday.triggerLabel)) {
  throw new Error(`Add the label "${config.monday.triggerLabel}" to the Aprobación column before registering the webhook`);
}

console.log(JSON.stringify({
  status: "ready",
  service: healthUrl.origin,
  board: { id: board.id, name: board.name },
  trigger: { columnId: config.monday.triggerColumnId, label: config.monday.triggerLabel },
  reportColumnId: config.monday.reportPdfColumnId,
  fixedFuelRate: { currency: config.fuelRateCurrency, perKm: config.fuelRatePerKm }
}, null, 2));
