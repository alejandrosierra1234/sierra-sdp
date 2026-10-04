import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { createDossierHandler } from "../src/dossier-route.js";
import { responseRecorder, testConfig } from "./helpers.js";

const logger = { info() {}, warn() {}, error() {} };

test("exige una sesión monday válida y procesa el Payment", async () => {
  const config = testConfig();
  config.monday.signingSecret = "signing-secret";
  let called;
  const service = { async process(id, options) { called = { id, options }; return { status: "uploaded" }; } };
  const handler = createDossierHandler({ config, service, logger });

  const unauthorized = responseRecorder();
  await handler({ headers: {}, body: { paymentId: "100" } }, unauthorized);
  assert.equal(unauthorized.code, 401);

  const token = jwt.sign({ accountId: 1, userId: 2 }, config.monday.signingSecret, { algorithm: "HS256" });
  const response = responseRecorder();
  await handler({ headers: { authorization: `Bearer ${token}` }, body: { paymentId: "100", dryRun: true } }, response);
  assert.equal(response.code, 200);
  assert.deepEqual(called, { id: "100", options: { dryRun: true } });
});
