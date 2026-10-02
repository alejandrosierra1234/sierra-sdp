import assert from "node:assert/strict";
import test from "node:test";
import { MondayClient } from "../src/monday-client.js";
import { testConfig } from "./helpers.js";

const logger = { warn() {} };

test("uploads the PDF with monday multipart mapping", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ data: { add_file_to_column: { id: "asset-7", name: "report.pdf", file_size: 4 } } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const client = new MondayClient(testConfig().monday, { fetchImpl, logger });
  const result = await client.uploadReport("123", "file_mm7rp1y1", "report.pdf", Buffer.from("%PDF"));

  assert.equal(request.url, "https://api.monday.com/v2/file");
  assert.equal(request.options.headers.Authorization, "test-token");
  assert.match(request.options.body.get("query"), /add_file_to_column\(item_id: 123/);
  assert.deepEqual(JSON.parse(request.options.body.get("map")), { file: "variables.file" });
  assert.equal(request.options.body.get("file").name, "report.pdf");
  assert.equal(result.id, "asset-7");
});

test("downloads temporary public URLs without leaking the API token", async () => {
  let headers;
  const fetchImpl = async (_url, options) => {
    headers = options.headers;
    return new Response(Buffer.from("image"), { status: 200, headers: { "content-type": "image/jpeg" } });
  };
  const client = new MondayClient(testConfig().monday, { fetchImpl, logger });
  const result = await client.downloadAsset(
    { downloadUrl: "https://files.example.test/proof.jpg", requiresAuth: false, size: 5 },
    { maxAttachmentBytes: 100 }
  );

  assert.deepEqual(headers, {});
  assert.equal(result.mimeType, "image/jpeg");
  await assert.rejects(
    client.downloadAsset({ downloadUrl: "http://example.test/proof.jpg" }, { maxAttachmentBytes: 100 }),
    /must use HTTPS/
  );
});
