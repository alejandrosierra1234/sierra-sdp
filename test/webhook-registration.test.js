import test from "node:test";
import assert from "node:assert/strict";
import { testConfig } from "./helpers.js";
import { buildWebhookUrl, registerMondayWebhook } from "../src/webhook-registration.js";

test("builds the protected HTTPS webhook URL", () => {
  const config = testConfig({ publicWebhookUrl: "https://example.com/api/monday/webhook" });
  const url = buildWebhookUrl(config);
  assert.equal(url.origin + url.pathname, config.publicWebhookUrl);
  assert.equal(url.searchParams.get("secret"), config.monday.webhookSecret);
});

test("does not duplicate an existing status-column webhook", async () => {
  const config = testConfig({ publicWebhookUrl: "https://example.com/api/monday/webhook" });
  const client = {
    async request() {
      return { webhooks: [{ id: "55", event: "change_status_column_value", board_id: config.monday.boardId, config: JSON.stringify({ columnId: config.monday.triggerColumnId }) }] };
    }
  };
  const result = await registerMondayWebhook({ client, config });
  assert.equal(result.status, "already_registered");
  assert.equal(result.webhookId, "55");
});

test("creates the configured status-column webhook", async () => {
  const config = testConfig({ publicWebhookUrl: "https://example.com/api/monday/webhook" });
  const calls = [];
  const client = {
    async request(query, variables) {
      calls.push({ query, variables });
      if (query.includes("ExistingWebhooks")) return { webhooks: [] };
      return { create_webhook: { id: "99", board_id: config.monday.boardId } };
    }
  };
  const result = await registerMondayWebhook({ client, config });
  assert.equal(result.status, "registered");
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[1].variables.url).searchParams.get("secret"), config.monday.webhookSecret);
});
