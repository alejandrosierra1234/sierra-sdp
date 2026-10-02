import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { createWebhookHandler } from "../src/webhook.js";
import { responseRecorder, testConfig } from "./helpers.js";

const silentLogger = { error() {} };
const event = {
  event: {
    boardId: 18433758498,
    pulseId: 123456789,
    columnId: "color_mm7r9b1w",
    value: { label: { text: "Aprobado para generar" } }
  }
};

test("answers monday webhook challenge", () => {
  const handler = createWebhookHandler({ config: testConfig(), service: {}, logger: silentLogger });
  const res = responseRecorder();
  handler({ body: { challenge: "abc123" }, headers: {}, query: {} }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { challenge: "abc123" });
});

test("rejects unauthenticated, wrong-board, and invalid-item events", () => {
  const config = testConfig();
  const handler = createWebhookHandler({ config, service: { enqueue() { throw new Error("should not run"); } }, logger: silentLogger });
  let res = responseRecorder();
  handler({ body: event, headers: {}, query: {} }, res);
  assert.equal(res.code, 401);
  res = responseRecorder();
  handler({ body: { event: { ...event.event, boardId: 1 } }, headers: {}, query: { secret: config.monday.webhookSecret } }, res);
  assert.equal(res.code, 403);
  res = responseRecorder();
  handler({ body: { event: { ...event.event, pulseId: "bad" } }, headers: {}, query: { secret: config.monday.webhookSecret } }, res);
  assert.equal(res.code, 400);
});

test("queues a valid event once and acknowledges retries", () => {
  const config = testConfig();
  let calls = 0;
  const service = { enqueue() { calls += 1; return { accepted: calls === 1, promise: Promise.resolve() }; } };
  const handler = createWebhookHandler({ config, service, logger: silentLogger });
  let res = responseRecorder();
  handler({ body: event, headers: {}, query: { secret: config.monday.webhookSecret } }, res);
  assert.equal(res.code, 202);
  assert.equal(res.body.status, "accepted");
  res = responseRecorder();
  handler({ body: event, headers: {}, query: { secret: config.monday.webhookSecret } }, res);
  assert.equal(res.body.status, "already_processing");
});

test("verifies signed JWT webhooks", () => {
  const config = testConfig();
  config.monday.signingSecret = "signing-test";
  config.monday.requireJwt = true;
  config.publicWebhookUrl = "";
  const service = { enqueue() { return { accepted: true, promise: Promise.resolve() }; } };
  const handler = createWebhookHandler({ config, service, logger: silentLogger });
  const token = jwt.sign({ accountId: 1 }, config.monday.signingSecret, { algorithm: "HS256", expiresIn: 60 });
  const res = responseRecorder();
  handler({ body: event, headers: { authorization: token }, query: {} }, res);
  assert.equal(res.code, 202);
});

