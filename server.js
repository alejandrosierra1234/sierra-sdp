import "dotenv/config";
import express from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./src/config.js";
import { logger } from "./src/logger.js";
import { MondayClient } from "./src/monday-client.js";
import { FuelReportService } from "./src/report-service.js";
import { createWebhookHandler } from "./src/webhook.js";

const config = loadConfig();
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

const client = new MondayClient(config.monday, { logger });
const service = new FuelReportService({ client, config, logger });
app.post("/api/monday/webhook", createWebhookHandler({ config, service, logger }));
app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

const root = dirname(fileURLToPath(import.meta.url));
app.get("/", (_req, res) => res.sendFile(join(root, "index.html")));

app.use((error, _req, res, _next) => {
  logger.error("request_failed", { error: error.message });
  if (error?.type === "entity.too.large") return res.status(413).json({ error: "Request body too large" });
  return res.status(500).json({ error: "Internal server error" });
});

app.listen(config.port, () => logger.info("server_started", { port: config.port }));
