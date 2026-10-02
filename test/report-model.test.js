import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { formatDate, formatMoney, formatNumber, mapMondayItemToReport, normalizeNumber } from "../src/report-model.js";
import { testConfig } from "./helpers.js";

const root = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(await readFile(join(root, "fixtures", "monday-item.json"), "utf8"));

test("normalizes monday item, sums trips, and uses the fixed server rate", () => {
  const report = mapMondayItemToReport(structuredClone(fixture), testConfig(), new Date("2026-10-02T12:00:00Z"));
  assert.equal(report.collaborator, "Persona de Prueba");
  assert.deepEqual(report.period, { start: "2026-09-01", end: "2026-09-30" });
  assert.equal(report.totalKm, 25.25);
  assert.equal(report.fixedRate, 0.25);
  assert.equal(report.reimbursement, 48.35);
  assert.equal(report.trips[0].proofs[0].id, "8001");
  assert.match(report.filename, /^reporte-combustible-123456789-[a-f0-9]{16}\.pdf$/);
  assert.equal(report.warnings.length, 2);
});

test("does not allow an environment or form value to override the fixed rate", () => {
  const previous = process.env.FUEL_RATE_PER_KM;
  process.env.FUEL_RATE_PER_KM = "99";
  try {
    const config = testConfig();
    const report = mapMondayItemToReport(structuredClone(fixture), config);
    assert.equal(config.fuelRatePerKm, 0.25);
    assert.equal(report.fixedRate, 0.25);
    assert.equal(report.reimbursement, 48.35);
  } finally {
    if (previous == null) delete process.env.FUEL_RATE_PER_KM;
    else process.env.FUEL_RATE_PER_KM = previous;
  }
});

test("normalizes locale-aware numeric formats", () => {
  assert.equal(normalizeNumber("1.234,50 km"), 1234.5);
  assert.equal(normalizeNumber("1,234.50"), 1234.5);
  assert.equal(normalizeNumber("12,75"), 12.75);
  assert.equal(normalizeNumber(""), null);
});

test("formats dates, quantities and money for Guatemala", () => {
  assert.equal(formatDate("2026-09-03"), "03/09/2026");
  assert.equal(formatNumber(25.5), "25.50");
  assert.match(formatMoney(119.91, "GTQ"), /119\.91/);
});

test("rejects invalid trip distances", () => {
  const invalid = structuredClone(fixture);
  invalid.subitems[0].column_values.find((column) => column.id === "numeric_mm7r864e").value = "{}";
  invalid.subitems[0].column_values.find((column) => column.id === "numeric_mm7r864e").text = "not a number";
  assert.throws(() => mapMondayItemToReport(invalid, testConfig()), /Invalid distance/);
});
