export function buildWebhookUrl(config) {
  if (!config.publicWebhookUrl) throw new Error("PUBLIC_WEBHOOK_URL is required");
  const webhookUrl = new URL(config.publicWebhookUrl);
  if (webhookUrl.protocol !== "https:") throw new Error("PUBLIC_WEBHOOK_URL must use HTTPS");
  if (!config.monday.requireJwt) webhookUrl.searchParams.set("secret", config.monday.webhookSecret);
  if (webhookUrl.toString().length > 255) throw new Error("Webhook URL exceeds monday's 255-character limit");
  return webhookUrl;
}

export async function registerMondayWebhook({ client, config }) {
  const webhookUrl = buildWebhookUrl(config);
  const existingQuery = `query ExistingWebhooks($boardId: ID!) {
    webhooks(board_id: $boardId) { id event board_id config }
  }`;
  const existingData = await client.request(existingQuery, { boardId: config.monday.boardId });
  const duplicate = (existingData.webhooks || []).find((webhook) => {
    if (webhook.event !== "change_status_column_value") return false;
    try { return JSON.parse(webhook.config || "{}").columnId === config.monday.triggerColumnId; }
    catch { return false; }
  });
  if (duplicate) {
    return { status: "already_registered", webhookId: duplicate.id, boardId: duplicate.board_id };
  }

  const mutation = `mutation CreateFuelWebhook($boardId: ID!, $url: String!, $config: JSON!) {
    create_webhook(board_id: $boardId, url: $url, event: change_status_column_value, config: $config) {
      id
      board_id
    }
  }`;
  const created = await client.request(mutation, {
    boardId: config.monday.boardId,
    url: webhookUrl.toString(),
    config: JSON.stringify({ columnId: config.monday.triggerColumnId, columnValue: { $any$: true } })
  });
  return { status: "registered", webhookId: created.create_webhook.id, boardId: created.create_webhook.board_id };
}
