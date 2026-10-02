import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { FuelReportService } from "../src/report-service.js";
import { testConfig } from "./helpers.js";

const root = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(await readFile(join(root, "fixtures", "monday-item.json"), "utf8"));
const logger = { child() { return this; }, info() {}, warn() {}, error() {} };

function fakeClient(overrides = {}) {
  return {
    async getItem() { return structuredClone(fixture); },
    async listReportFiles() { return []; },
    async downloadAsset() { return { buffer: Buffer.from("invalid image"), mimeType: "image/jpeg" }; },
    async uploadReport(_item, _column, name) { return { id: "asset-1", name }; },
    async verifyReportFile() { return true; },
    ...overrides
  };
}

test("skips generation when the same content version already exists", async () => {
  let generated = 0;
  const client = fakeClient({
    async listReportFiles() {
      const { mapMondayItemToReport } = await import("../src/report-model.js");
      const report = mapMondayItemToReport(structuredClone(fixture), testConfig());
      return [{ id: "existing", name: report.filename }];
    }
  });
  const service = new FuelReportService({ client, config: testConfig(), logger, generatePdf: async () => { generated += 1; return Buffer.from("pdf"); } });
  const result = await service.process(fixture.id);
  assert.equal(result.status, "skipped");
  assert.equal(generated, 0);
});

test("surfaces monday read and upload failures", async () => {
  const readFailure = new FuelReportService({ client: fakeClient({ async getItem() { throw new Error("read failed"); } }), config: testConfig(), logger });
  await assert.rejects(readFailure.process(fixture.id), /read failed/);
  const uploadFailure = new FuelReportService({
    client: fakeClient({ async uploadReport() { throw new Error("upload failed"); } }),
    config: testConfig(), logger, generatePdf: async () => Buffer.from("%PDF test")
  });
  await assert.rejects(uploadFailure.process(fixture.id), /upload failed/);
});

test("coalesces duplicate in-flight events", async () => {
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  const service = new FuelReportService({
    client: fakeClient({ async getItem() { await blocker; return structuredClone(fixture); } }),
    config: testConfig(), logger, generatePdf: async () => Buffer.from("%PDF test")
  });
  const first = service.enqueue(fixture.id);
  const second = service.enqueue(fixture.id);
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.equal(first.promise, second.promise);
  release();
  await first.promise;
});

