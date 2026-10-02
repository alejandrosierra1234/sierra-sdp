const SECRET_KEYS = /token|authorization|secret|public_url|signed|url/i;

function sanitize(value, depth = 0) {
  if (depth > 5) return "[depth-limit]";
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      SECRET_KEYS.test(key) ? "[redacted]" : sanitize(child, depth + 1)
    ])
  );
}

export function createLogger(base = {}) {
  const write = (level, message, details = {}) => {
    const entry = sanitize({ timestamp: new Date().toISOString(), level, message, ...base, ...details });
    const output = JSON.stringify(entry);
    (level === "error" ? console.error : console.log)(output);
  };
  return {
    child(extra) { return createLogger({ ...base, ...extra }); },
    info(message, details) { write("info", message, details); },
    warn(message, details) { write("warn", message, details); },
    error(message, details) { write("error", message, details); }
  };
}

export const logger = createLogger();

