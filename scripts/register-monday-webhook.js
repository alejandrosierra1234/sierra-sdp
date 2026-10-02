import "dotenv/config";
import { loadConfig } from "../src/config.js";
import { MondayClient } from "../src/monday-client.js";
import { registerMondayWebhook } from "../src/webhook-registration.js";

if (!process.argv.includes("--apply")) {
  throw new Error("Registration changes monday.com. Re-run with --apply after npm run verify:deployment passes");
}

const config = loadConfig();
const client = new MondayClient(config.monday);
console.log(JSON.stringify(await registerMondayWebhook({ client, config }), null, 2));
