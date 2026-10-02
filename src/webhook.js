import jwt from "jsonwebtoken";

export function extractEvent(payload) {
  const event = payload?.event || payload || {};
  return {
    boardId: String(event.boardId ?? event.board_id ?? event.board?.id ?? ""),
    itemId: String(event.pulseId ?? event.itemId ?? event.item_id ?? event.pulse?.id ?? ""),
    columnId: String(event.columnId ?? event.column_id ?? ""),
    label: String(
      event.value?.label?.text ??
      event.value?.label ??
      event.value?.text ??
      event.columnValue?.label?.text ??
      event.columnValue?.label ??
      event.column_value?.label?.text ??
      ""
    ).trim()
  };
}

function bearer(header = "") {
  return header.replace(/^Bearer\s+/i, "").trim();
}

export function authenticateWebhook(req, config) {
  const token = bearer(req.headers.authorization || "");
  if (token && config.monday.signingSecret) {
    try {
      const options = config.publicWebhookUrl ? { audience: config.publicWebhookUrl.split("?")[0] } : {};
      return { mode: "jwt", claims: jwt.verify(token, config.monday.signingSecret, { algorithms: ["HS256"], ...options }) };
    } catch {
      return { mode: "invalid", error: "Invalid monday webhook signature" };
    }
  }
  if (config.monday.requireJwt) return { mode: "invalid", error: "Signed monday webhook required" };
  const supplied = String(req.query.secret || req.headers["x-webhook-secret"] || "");
  if (config.monday.webhookSecret && supplied === config.monday.webhookSecret) return { mode: "shared_secret" };
  return { mode: "invalid", error: "Webhook authentication failed" };
}

export function createWebhookHandler({ config, service, logger }) {
  return (req, res) => {
    if (req.body?.challenge) return res.status(200).json({ challenge: req.body.challenge });
    const auth = authenticateWebhook(req, config);
    if (auth.mode === "invalid") return res.status(401).json({ error: auth.error });

    const event = extractEvent(req.body);
    if (event.boardId !== String(config.monday.boardId)) return res.status(403).json({ error: "Board not allowed" });
    if (!/^\d+$/.test(event.itemId)) return res.status(400).json({ error: "Invalid item ID" });
    if (event.columnId !== config.monday.triggerColumnId) {
      return res.status(200).json({ status: "ignored", reason: "unrelated_column" });
    }
    if (event.label.toLocaleLowerCase("es") !== config.monday.triggerLabel.toLocaleLowerCase("es")) {
      return res.status(200).json({ status: "ignored", reason: "trigger_label_not_selected" });
    }

    const queued = service.enqueue(event.itemId);
    if (queued.accepted) {
      queued.promise.catch((error) => logger.error("fuel_report_failed", { itemId: event.itemId, boardId: event.boardId, error: error.message }));
      return res.status(202).json({ status: "accepted", itemId: event.itemId });
    }
    return res.status(202).json({ status: "already_processing", itemId: event.itemId });
  };
}

