import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../src/config.js";
import { withClient } from "../src/lib/db.js";
import { canonicalizeFundName, canonicalizeMerchant, informativeTokens, normalizeCategory } from "../src/lib/normalization.js";

type TransactionRow = {
  id: string;
  date: string;
  merchant: string;
  category: string;
  amount: number;
  currency: string;
  memo: string;
};

type FundRow = {
  id: string;
  name: string;
  category: string;
  nav: Array<{ date: string; value: number }>;
};

type HoldingRow = {
  fund_id: string;
  fund_name: string;
  units: number;
  purchase_date: string;
  purchase_nav: number;
};

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

function resolveDataDir(): string {
  const cliArg = process.argv[2];
  return path.resolve(cliArg ?? config.DATA_DIR);
}

async function main() {
  const dataDir = resolveDataDir();
  const transactionsPath = path.join(dataDir, "transactions.json");
  const fundsPath = path.join(dataDir, "funds.json");
  const holdingsPath = path.join(dataDir, "holdings.json");
  const snapshotKey = path.basename(dataDir);

  const [transactions, funds, holdings] = await Promise.all([
    readJsonFile<TransactionRow[]>(transactionsPath),
    readJsonFile<FundRow[]>(fundsPath),
    readJsonFile<HoldingRow[]>(holdingsPath),
  ]);

  await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const schemaSql = await readFile(path.resolve("sql/schema.sql"), "utf8");
      await client.query(schemaSql);

      await client.query("DELETE FROM holdings");
      await client.query("DELETE FROM fund_navs");
      await client.query("DELETE FROM funds");
      await client.query("DELETE FROM transactions");
      await client.query("DELETE FROM datasets");

      const datasetInsert = await client.query<{ id: string }>(
        `
          INSERT INTO datasets (snapshot_key, source_path)
          VALUES ($1, $2)
          RETURNING id::text
        `,
        [snapshotKey, dataDir],
      );
      const datasetId = Number(datasetInsert.rows[0].id);

      for (const row of transactions) {
        await client.query(
          `
            INSERT INTO transactions (
              dataset_id, id, date, merchant, merchant_canonical, merchant_tokens, category, amount, currency, memo
            )
            VALUES ($1, $2, $3::date, $4, $5, $6::text[], $7, $8, $9, $10)
          `,
          [
            datasetId,
            row.id,
            row.date,
            row.merchant,
            canonicalizeMerchant(row.merchant),
            informativeTokens(row.merchant),
            normalizeCategory(row.category),
            row.amount,
            row.currency,
            row.memo,
          ],
        );
      }

      for (const fund of funds) {
        await client.query(
          `
            INSERT INTO funds (dataset_id, id, name, name_normalized, category)
            VALUES ($1, $2, $3, $4, $5)
          `,
          [datasetId, fund.id, fund.name, canonicalizeFundName(fund.name), normalizeCategory(fund.category)],
        );

        for (const nav of fund.nav) {
          await client.query(
            `
              INSERT INTO fund_navs (dataset_id, fund_id, nav_date, nav_value)
              VALUES ($1, $2, $3::date, $4)
            `,
            [datasetId, fund.id, nav.date, nav.value],
          );
        }
      }

      for (const holding of holdings) {
        await client.query(
          `
            INSERT INTO holdings (dataset_id, fund_id, fund_name, units, purchase_date, purchase_nav)
            VALUES ($1, $2, $3, $4, $5::date, $6)
          `,
          [datasetId, holding.fund_id, holding.fund_name, holding.units, holding.purchase_date, holding.purchase_nav],
        );
      }

      await client.query("COMMIT");
      console.log(
        JSON.stringify({
          snapshotKey,
          dataDir,
          transactions: transactions.length,
          funds: funds.length,
          holdings: holdings.length,
        }),
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
