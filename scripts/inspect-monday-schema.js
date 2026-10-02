import "dotenv/config";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { MondayClient } from "../src/monday-client.js";

const config = loadConfig();
const client = new MondayClient(config.monday, { logger: createLogger({ task: "schema_inspection" }) });
const board = await client.inspectBoard(config.monday.boardId);
console.log(JSON.stringify({
  board: { id: board.id, name: board.name },
  columns: board.columns.map(({ id, title, type }) => ({ id, title, type }))
}, null, 2));
