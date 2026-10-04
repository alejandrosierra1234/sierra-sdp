const integer = (name, fallback) => {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
};

const bool = (name, fallback) => {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
};

const value = (name, fallback = "") => process.env[name] || fallback;

export const FIXED_FUEL_RATE_PER_KM = 0.25;

export function loadConfig({ requireSecrets = true } = {}) {
  const config = {
    port: integer("PORT", 3000),
    nodeEnv: value("NODE_ENV", "development"),
    publicWebhookUrl: value("PUBLIC_WEBHOOK_URL"),
    autoRegisterWebhook: bool("AUTO_REGISTER_WEBHOOK", false),
    companyName: value("COMPANY_NAME", "Hilos y Algodón, S.A."),
    includeAuthorizationLines: bool("INCLUDE_AUTHORIZATION_LINES", true),
    monday: {
      token: value("MONDAY_API_TOKEN"),
      signingSecret: value("MONDAY_SIGNING_SECRET"),
      webhookSecret: value("MONDAY_WEBHOOK_SECRET"),
      requireJwt: bool("MONDAY_REQUIRE_JWT", false),
      apiVersion: value("MONDAY_API_VERSION", "2026-10"),
      boardId: value("MONDAY_BOARD_ID", "18433758498"),
      triggerColumnId: value("MONDAY_TRIGGER_COLUMN_ID", "color_mm7r9b1w"),
      triggerLabel: value("MONDAY_TRIGGER_LABEL", "Aprobado para generar"),
      reportPdfColumnId: value("MONDAY_REPORT_PDF_COLUMN_ID", "file_mm7rp1y1"),
      columns: {
        collaborator: value("MONDAY_COLLABORATOR_COLUMN_ID", "person"),
        department: value("MONDAY_DEPARTMENT_COLUMN_ID"),
        periodStart: value("MONDAY_PERIOD_START_COLUMN_ID", "date_mm7r76eb"),
        periodEnd: value("MONDAY_PERIOD_END_COLUMN_ID", "date4"),
        totalKm: value("MONDAY_TOTAL_KM_COLUMN_ID", "lookup_mm7rbkya"),
        declaredKm: value("MONDAY_DECLARED_KM_COLUMN_ID", "numeric_mm7rg95t"),
        rate: value("MONDAY_RATE_COLUMN_ID", "numeric_mm7rt81x"),
        exchangeRate: value("MONDAY_EXCHANGE_RATE_COLUMN_ID", "numeric_mm7rpc7x"),
        confirmation: value("MONDAY_CONFIRMATION_COLUMN_ID", "boolean_mm7ry62j"),
        approval: value("MONDAY_APPROVAL_COLUMN_ID", "color_mm7r9b1w")
      },
      subitemColumns: {
        date: value("MONDAY_TRIP_DATE_COLUMN_ID", "date0"),
        end: value("MONDAY_TRIP_END_COLUMN_ID", "text_mm7rn7he"),
        distance: value("MONDAY_TRIP_DISTANCE_COLUMN_ID", "numeric_mm7r864e"),
        proof: value("MONDAY_TRIP_PROOF_COLUMN_ID", "file_mm7r1zdy")
      },
      requestTimeoutMs: integer("MONDAY_REQUEST_TIMEOUT_MS", 15_000),
      maxRetries: integer("MONDAY_MAX_RETRIES", 3)
    },
    dossier: {
      paymentsBoardId: value("MONDAY_PAYMENTS_BOARD_ID", "18432867606"),
      sdpColumnId: value("MONDAY_SDP_COLUMN_ID", "file_mm7sxf2y"),
      outputColumnId: value("MONDAY_DOSSIER_COLUMN_ID", "file_mm7m9w7t"),
      allowedOrigins: value(
        "DOSSIER_ALLOWED_ORIGINS",
        "https://sierratextiles.monday.com,https://payment-hub-sierratextiles.monday.app,https://payment-hub-sierratextiles-draft.v.monday.app"
      ).split(",").map((origin) => origin.trim()).filter(Boolean)
    },
    // Business rule: the form/board must never control this value.
    fuelRatePerKm: FIXED_FUEL_RATE_PER_KM,
    fuelRateCurrency: value("FUEL_RATE_CURRENCY", "USD"),
    reimbursementCurrency: value("REIMBURSEMENT_CURRENCY", "GTQ"),
    limits: {
      maxAttachments: integer("MAX_ATTACHMENTS", 40),
      maxAttachmentBytes: integer("MAX_ATTACHMENT_BYTES", 15 * 1024 * 1024),
      maxTotalAttachmentBytes: integer("MAX_TOTAL_ATTACHMENT_BYTES", 100 * 1024 * 1024)
    }
  };

  if (!/^\d+$/.test(config.monday.boardId)) throw new Error("MONDAY_BOARD_ID must contain digits only");
  if (!/^[a-zA-Z0-9_]+$/.test(config.monday.reportPdfColumnId)) {
    throw new Error("MONDAY_REPORT_PDF_COLUMN_ID is invalid");
  }
  if (!/^\d+$/.test(config.dossier.paymentsBoardId)) throw new Error("MONDAY_PAYMENTS_BOARD_ID must contain digits only");
  if (!/^[a-zA-Z0-9_]+$/.test(config.dossier.sdpColumnId)) throw new Error("MONDAY_SDP_COLUMN_ID is invalid");
  if (!/^[a-zA-Z0-9_]+$/.test(config.dossier.outputColumnId)) throw new Error("MONDAY_DOSSIER_COLUMN_ID is invalid");
  if (requireSecrets && !config.monday.token) throw new Error("MONDAY_API_TOKEN is required");
  if (requireSecrets && !config.monday.signingSecret && !config.monday.webhookSecret) {
    throw new Error("Set MONDAY_SIGNING_SECRET or MONDAY_WEBHOOK_SECRET");
  }
  if (config.monday.requireJwt && !config.monday.signingSecret) {
    throw new Error("MONDAY_REQUIRE_JWT=true requires MONDAY_SIGNING_SECRET");
  }
  return config;
}
