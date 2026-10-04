import jwt from "jsonwebtoken";

function bearer(header = "") {
  return String(header).replace(/^Bearer\s+/i, "").trim();
}

function allowedOrigin(origin, allowed) {
  if (!origin) return true;
  if (allowed.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    return host.endsWith(".monday.app") || host === "sierratextiles.monday.com";
  } catch {
    return false;
  }
}

export function dossierCors(config) {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (!allowedOrigin(origin, config.dossier.allowedOrigins)) return res.status(403).json({ error: "Origin not allowed" });
    if (origin) res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (req.method === "OPTIONS") return res.status(204).end();
    return next();
  };
}

export function createDossierHandler({ config, service, logger }) {
  return async (req, res) => {
    const token = bearer(req.headers.authorization);
    if (!token || !config.monday.signingSecret) return res.status(401).json({ error: "Missing monday session token" });
    try {
      jwt.verify(token, config.monday.signingSecret, { algorithms: ["HS256"] });
    } catch {
      return res.status(401).json({ error: "Invalid monday session token" });
    }

    const paymentId = String(req.body?.paymentId || "");
    if (!/^\d+$/.test(paymentId)) return res.status(400).json({ error: "Invalid paymentId" });
    try {
      const result = await service.process(paymentId, { dryRun: req.body?.dryRun === true });
      return res.status(200).json(result);
    } catch (error) {
      logger?.error("payment_dossier_failed", { paymentId, error: error.message });
      const status = /falta|inv[aá]lid|no autorizado|excede|No se pudo incorporar/i.test(error.message) ? 422 : 500;
      return res.status(status).json({ error: error.message });
    }
  };
}
