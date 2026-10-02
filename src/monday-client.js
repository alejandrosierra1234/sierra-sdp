import { setTimeout as delay } from "node:timers/promises";

const API_URL = "https://api.monday.com/v2";
const FILE_URL = "https://api.monday.com/v2/file";

const ITEM_QUERY = `
  query FuelReportItem($itemIds: [ID!]!) {
    items(ids: $itemIds) {
      id
      name
      board { id }
      column_values {
        id
        text
        value
        type
        ... on FileValue {
          files {
            __typename
            ... on FileAssetValue {
              asset_id
              name
              is_image
              asset { id name public_url url file_extension file_size }
            }
          }
        }
      }
      subitems {
        id
        name
        column_values {
          id
          text
          value
          type
          ... on FileValue {
            files {
              __typename
              ... on FileAssetValue {
                asset_id
                name
                is_image
                asset { id name public_url url file_extension file_size }
              }
            }
          }
        }
      }
    }
  }
`;

const VERIFY_FILE_QUERY = `
  query VerifyReportFile($itemIds: [ID!]!) {
    items(ids: $itemIds) {
      id
      column_values {
        id
        text
        value
        ... on FileValue {
          files {
            __typename
            ... on FileAssetValue { asset_id name asset { id name file_size } }
          }
        }
      }
    }
  }
`;

export class MondayApiError extends Error {
  constructor(message, { status, retryable = false } = {}) {
    super(message);
    this.name = "MondayApiError";
    this.status = status;
    this.retryable = retryable;
  }
}

function sanitizedName(name) {
  const clean = String(name || "file").normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean.slice(0, 120) || "file";
}

function retryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

export class MondayClient {
  constructor(config, { fetchImpl = fetch, logger } = {}) {
    this.config = config;
    this.fetch = fetchImpl;
    this.logger = logger;
  }

  async withRetry(label, operation) {
    let lastError;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!error.retryable || attempt === this.config.maxRetries) throw error;
        const waitMs = Math.min(500 * (2 ** attempt) + Math.floor(Math.random() * 150), 5_000);
        this.logger?.warn("monday_request_retry", { operation: label, attempt: attempt + 1, waitMs, status: error.status });
        await delay(waitMs);
      }
    }
    throw lastError;
  }

  async request(query, variables = {}) {
    return this.withRetry("graphql", async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
      let response;
      try {
        response = await this.fetch(API_URL, {
          method: "POST",
          headers: {
            Authorization: this.config.token,
            "Content-Type": "application/json",
            "API-Version": this.config.apiVersion
          },
          body: JSON.stringify({ query, variables }),
          signal: controller.signal
        });
      } catch (error) {
        throw new MondayApiError(error.name === "AbortError" ? "monday request timed out" : "monday network request failed", { retryable: true });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new MondayApiError(`monday API returned HTTP ${response.status}`, { status: response.status, retryable: retryableStatus(response.status) });
      const result = await response.json();
      if (result.errors?.length) {
        const message = result.errors.map((entry) => entry.message).join("; ").slice(0, 500);
        const retryable = result.errors.some((entry) => /rate|timeout|temporar|complexity/i.test(entry.message || ""));
        throw new MondayApiError(`monday GraphQL error: ${message}`, { retryable });
      }
      return result.data;
    });
  }

  async getItem(itemId) {
    if (!/^\d+$/.test(String(itemId))) throw new Error("Invalid item ID");
    const data = await this.request(ITEM_QUERY, { itemIds: [String(itemId)] });
    if (!data.items?.[0]) throw new MondayApiError("monday item was not found");
    return data.items[0];
  }

  async inspectBoard(boardId) {
    const query = `query BoardSchema($boardIds: [ID!]!) { boards(ids: $boardIds) { id name columns { id title type settings } } }`;
    const data = await this.request(query, { boardIds: [String(boardId)] });
    if (!data.boards?.[0]) throw new MondayApiError("monday board was not found");
    return data.boards[0];
  }

  async downloadAsset(asset, limits) {
    if (!asset.downloadUrl) throw new Error("Asset has no downloadable URL");
    let downloadUrl;
    try {
      downloadUrl = new URL(asset.downloadUrl);
    } catch {
      throw new Error("Asset has an invalid download URL");
    }
    if (downloadUrl.protocol !== "https:") throw new Error("Asset download URL must use HTTPS");
    if (asset.size && asset.size > limits.maxAttachmentBytes) throw new Error("Attachment exceeds the configured size limit");
    return this.withRetry("asset_download", async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
      let response;
      try {
        response = await this.fetch(asset.downloadUrl, {
          headers: asset.requiresAuth ? { Authorization: this.config.token } : {},
          redirect: "follow",
          signal: controller.signal
        });
      } catch (error) {
        throw new MondayApiError(error.name === "AbortError" ? "asset download timed out" : "asset download failed", { retryable: true });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new MondayApiError(`asset download returned HTTP ${response.status}`, { status: response.status, retryable: retryableStatus(response.status) });
      const length = Number(response.headers.get("content-length") || 0);
      if (length > limits.maxAttachmentBytes) throw new Error("Attachment exceeds the configured size limit");
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > limits.maxAttachmentBytes) throw new Error("Attachment exceeds the configured size limit");
      return { buffer, mimeType: response.headers.get("content-type")?.split(";")[0] || asset.mimeType || "application/octet-stream" };
    });
  }

  async uploadReport(itemId, columnId, filename, buffer) {
    if (!/^\d+$/.test(String(itemId)) || !/^[a-zA-Z0-9_]+$/.test(columnId)) throw new Error("Invalid upload target");
    const safeName = sanitizedName(filename);
    const mutation = `mutation ($file: File!) { add_file_to_column(item_id: ${itemId}, column_id: "${columnId}", file: $file) { id name file_size } }`;
    return this.withRetry("file_upload", async () => {
      const form = new FormData();
      form.append("query", mutation);
      form.append("map", JSON.stringify({ file: "variables.file" }));
      form.append("file", new Blob([buffer], { type: "application/pdf" }), safeName);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.max(this.config.requestTimeoutMs, 30_000));
      let response;
      try {
        response = await this.fetch(FILE_URL, {
          method: "POST",
          headers: { Authorization: this.config.token, "API-Version": this.config.apiVersion },
          body: form,
          signal: controller.signal
        });
      } catch (error) {
        throw new MondayApiError(error.name === "AbortError" ? "report upload timed out" : "report upload failed", { retryable: true });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new MondayApiError(`report upload returned HTTP ${response.status}`, { status: response.status, retryable: retryableStatus(response.status) });
      const result = await response.json();
      if (result.errors?.length) throw new MondayApiError(`report upload failed: ${result.errors[0].message}`, { retryable: false });
      return result.data?.add_file_to_column;
    });
  }

  async listReportFiles(itemId, columnId) {
    const data = await this.request(VERIFY_FILE_QUERY, { itemIds: [String(itemId)] });
    const column = data.items?.[0]?.column_values?.find((entry) => entry.id === columnId);
    return (column?.files || []).filter((file) => file.__typename === "FileAssetValue").map((file) => ({
      id: String(file.asset_id || file.asset?.id || ""),
      name: file.name || file.asset?.name || "",
      size: Number(file.asset?.file_size || 0)
    }));
  }

  async verifyReportFile(itemId, columnId, { assetId, filename }) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const files = await this.listReportFiles(itemId, columnId);
      if (files.some((file) => file.id === String(assetId) || file.name === filename)) return true;
      await delay(300 * (2 ** attempt));
    }
    return false;
  }
}
