import { loadConfig } from "../src/config.js";

export function testConfig(overrides = {}) {
  const config = loadConfig({ requireSecrets: false });
  config.monday.token = "test-token";
  config.monday.webhookSecret = "test-webhook-secret";
  return Object.assign(config, overrides);
}

export function responseRecorder() {
  return {
    code: 200,
    body: null,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

