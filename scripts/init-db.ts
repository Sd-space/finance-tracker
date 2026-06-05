import { readFile } from "node:fs/promises";
import path from "node:path";
import { withClient } from "../src/lib/db.js";

async function main() {
  const schemaPath = path.resolve("sql/schema.sql");
  const sql = await readFile(schemaPath, "utf8");

  await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });

  console.log("Database schema initialized.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
