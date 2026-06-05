import type { PoolClient } from "pg";
import { query, withClient } from "../lib/db.js";
import { resolveDatePreset, type DatePreset } from "../lib/date-range.js";
import {
  canonicalizeFundName,
  canonicalizeMerchant,
  informativeTokens,
  normalizeCategory,
  normalizeText,
} from "../lib/normalization.js";
import { roundCurrency, roundPercent } from "../lib/format.js";

type TxAnalysisType =
  | "total_spend"
  | "largest_expense"
  | "top_merchants"
  | "month_over_month_category_comparison"
  | "category_increase"
  | "transaction_search"
  | "category_breakdown";

export type TransactionQueryInput = {
  analysisType: TxAnalysisType;
  category?: string;
  categories?: string[];
  merchant?: string;
  startDate?: string;
  endDate?: string;
  datePreset?: DatePreset;
  groupBy?: "none" | "month" | "merchant" | "category";
  limit?: number;
  includeTransfers?: boolean;
};

export type RecurringQueryInput = {
  minOccurrences?: number;
  startDate?: string;
  endDate?: string;
  datePreset?: DatePreset;
};

type InvestmentAnalysisType =
  | "fund_period_return"
  | "rank_funds_by_return"
  | "holding_realized_return"
  | "portfolio_summary"
  | "best_holding_vs_fund_period";

export type InvestmentQueryInput = {
  analysisType: InvestmentAnalysisType;
  fundName?: string;
  startDate?: string;
  endDate?: string;
  datePreset?: DatePreset;
  limit?: number;
};

type DateBounds = {
  startDate?: string;
  endDate?: string;
};

type SqlPart = {
  text: string;
  values: unknown[];
};

async function resolveBounds(
  input: { startDate?: string; endDate?: string; datePreset?: DatePreset },
  anchorKind: "transactions" | "funds",
): Promise<DateBounds> {
  if (input.startDate || input.endDate) {
    return {
      startDate: input.startDate,
      endDate: input.endDate,
    };
  }

  if (!input.datePreset) {
    return {};
  }

  return resolveDatePreset(input.datePreset, anchorKind);
}

function buildTransactionWhere(input: TransactionQueryInput, bounds: DateBounds): SqlPart {
  const clauses = ["1=1"];
  const values: unknown[] = [];
  let index = 1;

  if (bounds.startDate) {
    clauses.push(`date >= $${index++}::date`);
    values.push(bounds.startDate);
  }

  if (bounds.endDate) {
    clauses.push(`date <= $${index++}::date`);
    values.push(bounds.endDate);
  }

  if (input.category) {
    clauses.push(`category = $${index++}`);
    values.push(normalizeCategory(input.category));
  }

  if (input.categories?.length) {
    clauses.push(`category = ANY($${index++}::text[])`);
    values.push(input.categories.map(normalizeCategory));
  }

  if (input.merchant) {
    const tokens = informativeTokens(input.merchant);
    if (tokens.length > 0) {
      clauses.push(`merchant_tokens && $${index++}::text[]`);
      values.push(tokens);
    } else {
      clauses.push(`merchant_canonical = $${index++}`);
      values.push(canonicalizeMerchant(input.merchant));
    }
  }

  if (!input.includeTransfers) {
    clauses.push(`category <> 'transfer'`);
  }

  return {
    text: clauses.join(" AND "),
    values,
  };
}

function monthLabel(dateText: string): string {
  return dateText.slice(0, 7);
}

export async function queryTransactions(input: TransactionQueryInput): Promise<Record<string, unknown>> {
  const bounds = await resolveBounds(input, "transactions");
  const where = buildTransactionWhere(input, bounds);

  switch (input.analysisType) {
    case "total_spend": {
      const result = await query<{
        total: string | null;
        txn_count: string;
      }>(
        `
          SELECT
            COALESCE(SUM(amount), 0)::text AS total,
            COUNT(*)::text AS txn_count
          FROM transactions
          WHERE ${where.text}
        `,
        where.values,
      );

      return {
        analysisType: input.analysisType,
        startDate: bounds.startDate ?? null,
        endDate: bounds.endDate ?? null,
        total: roundCurrency(Number(result.rows[0]?.total ?? 0)),
        transactionCount: Number(result.rows[0]?.txn_count ?? 0),
      };
    }
    case "largest_expense": {
      const result = await query<{
        id: string;
        date: string;
        merchant: string;
        merchant_canonical: string;
        category: string;
        amount: string;
        memo: string;
      }>(
        `
          SELECT id, date::text, merchant, merchant_canonical, category, amount::text, memo
          FROM transactions
          WHERE ${where.text} AND amount > 0
          ORDER BY amount DESC, date ASC
          LIMIT 1
        `,
        where.values,
      );

      return {
        analysisType: input.analysisType,
        row: result.rows[0]
          ? {
              ...result.rows[0],
              amount: roundCurrency(Number(result.rows[0].amount)),
            }
          : null,
      };
    }
    case "top_merchants": {
      const limit = Math.min(Math.max(input.limit ?? 5, 1), 25);
      const values = [...where.values, limit];
      const result = await query<{
        merchant_canonical: string;
        net_spend: string;
        transaction_count: string;
      }>(
        `
          SELECT
            merchant_canonical,
            SUM(amount)::text AS net_spend,
            COUNT(*)::text AS transaction_count
          FROM transactions
          WHERE ${where.text}
          GROUP BY merchant_canonical
          ORDER BY SUM(amount) DESC, merchant_canonical ASC
          LIMIT $${where.values.length + 1}
        `,
        values,
      );

        return {
          analysisType: input.analysisType,
          rows: result.rows.map((row: { merchant_canonical: string; net_spend: string; transaction_count: string }, index: number) => ({
            rank: index + 1,
            merchant: row.merchant_canonical,
            netSpend: roundCurrency(Number(row.net_spend)),
            transactionCount: Number(row.transaction_count),
          })),
      };
    }
    case "month_over_month_category_comparison": {
      const categories = (input.categories ?? []).map(normalizeCategory);
      if (categories.length < 2) {
        throw new Error("month_over_month_category_comparison requires at least two categories.");
      }

      const values = [...where.values, categories];
      const result = await query<{
        month: string;
        category: string;
        total: string;
      }>(
        `
          SELECT
            TO_CHAR(date_trunc('month', date), 'YYYY-MM') AS month,
            category,
            SUM(amount)::text AS total
          FROM transactions
          WHERE ${where.text} AND category = ANY($${where.values.length + 1}::text[])
          GROUP BY 1, 2
          ORDER BY 1 ASC, 2 ASC
        `,
        values,
      );

      const totalsByCategory = new Map<string, Array<{ month: string; total: number }>>();
      for (const row of result.rows) {
        const list = totalsByCategory.get(row.category) ?? [];
        list.push({ month: row.month, total: roundCurrency(Number(row.total)) });
        totalsByCategory.set(row.category, list);
      }

      const growth = Array.from(totalsByCategory.entries()).map(([category, rows]) => {
        const first = rows[0]?.total ?? 0;
        const last = rows[rows.length - 1]?.total ?? 0;
        const delta = last - first;
        return { category, first, last, delta: roundCurrency(delta) };
      });

      growth.sort((a, b) => b.delta - a.delta || a.category.localeCompare(b.category));

      return {
        analysisType: input.analysisType,
        categories,
        series: Object.fromEntries(
          Array.from(totalsByCategory.entries()).map(([category, rows]) => [category, rows]),
        ),
        fastestGrowthCategory: growth[0] ?? null,
      };
    }
    case "category_increase": {
      const result = await query<{
        month: string;
        category: string;
        total: string;
      }>(
        `
          SELECT
            TO_CHAR(date_trunc('month', date), 'YYYY-MM') AS month,
            category,
            SUM(amount)::text AS total
          FROM transactions
          WHERE ${where.text}
          GROUP BY 1, 2
          ORDER BY 1 ASC, 2 ASC
        `,
        where.values,
      );

      const perCategory = new Map<string, Array<{ month: string; total: number }>>();
      for (const row of result.rows) {
        const list = perCategory.get(row.category) ?? [];
        list.push({ month: row.month, total: Number(row.total) });
        perCategory.set(row.category, list);
      }

      const increases = Array.from(perCategory.entries())
        .map(([category, rows]) => {
          if (rows.length < 2) {
            return null;
          }

          const prev = rows[rows.length - 2];
          const curr = rows[rows.length - 1];
          return {
            category,
            fromMonth: prev.month,
            toMonth: curr.month,
            increase: roundCurrency(curr.total - prev.total),
            previousTotal: roundCurrency(prev.total),
            currentTotal: roundCurrency(curr.total),
          };
        })
        .filter((value): value is NonNullable<typeof value> => Boolean(value))
        .sort((a, b) => b.increase - a.increase || a.category.localeCompare(b.category));

      return {
        analysisType: input.analysisType,
        row: increases[0] ?? null,
      };
    }
    case "transaction_search": {
      const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);
      const rows = await query<{
        id: string;
        date: string;
        merchant: string;
        merchant_canonical: string;
        category: string;
        amount: string;
        memo: string;
      }>(
        `
          SELECT id, date::text, merchant, merchant_canonical, category, amount::text, memo
          FROM transactions
          WHERE ${where.text}
          ORDER BY date ASC, id ASC
          LIMIT $${where.values.length + 1}
        `,
        [...where.values, limit],
      );

      return {
        analysisType: input.analysisType,
        rows: rows.rows.map((row: {
          id: string;
          date: string;
          merchant: string;
          merchant_canonical: string;
          category: string;
          amount: string;
          memo: string;
        }) => ({
          ...row,
          amount: roundCurrency(Number(row.amount)),
        })),
      };
    }
    case "category_breakdown": {
      const result = await query<{
        category: string;
        total: string;
      }>(
        `
          SELECT category, SUM(amount)::text AS total
          FROM transactions
          WHERE ${where.text}
          GROUP BY category
          ORDER BY SUM(amount) DESC, category ASC
        `,
        where.values,
      );

      return {
        analysisType: input.analysisType,
        rows: result.rows.map((row: { category: string; total: string }) => ({
          category: row.category,
          total: roundCurrency(Number(row.total)),
        })),
      };
    }
  }
}

export async function detectRecurringTransactions(input: RecurringQueryInput): Promise<Record<string, unknown>> {
  const bounds = await resolveBounds(input, "transactions");
  const where: string[] = ["category <> 'transfer'"];
  const values: unknown[] = [];
  let index = 1;

  if (bounds.startDate) {
    where.push(`date >= $${index++}::date`);
    values.push(bounds.startDate);
  }

  if (bounds.endDate) {
    where.push(`date <= $${index++}::date`);
    values.push(bounds.endDate);
  }

  const minOccurrences = Math.max(input.minOccurrences ?? 3, 2);
  values.push(minOccurrences);

  const result = await query<{
    merchant_canonical: string;
    category: string;
    occurrences: string;
    months_seen: string;
    average_amount: string;
    latest_date: string;
  }>(
    `
      WITH monthly AS (
        SELECT
          merchant_canonical,
          category,
          TO_CHAR(date_trunc('month', date), 'YYYY-MM') AS month,
          COUNT(*) AS tx_count,
          AVG(amount) AS avg_amount,
          MAX(date) AS latest_date
        FROM transactions
        WHERE ${where.join(" AND ")}
        GROUP BY 1, 2, 3
      )
      SELECT
        merchant_canonical,
        category,
        SUM(tx_count)::text AS occurrences,
        COUNT(*)::text AS months_seen,
        AVG(avg_amount)::text AS average_amount,
        MAX(latest_date)::text AS latest_date
      FROM monthly
      GROUP BY 1, 2
      HAVING COUNT(*) >= $${values.length}
      ORDER BY COUNT(*) DESC, AVG(avg_amount) DESC, merchant_canonical ASC
    `,
    values,
  );

  return {
    recurringCandidates: result.rows.map((row: {
      merchant_canonical: string;
      category: string;
      occurrences: string;
      months_seen: string;
      average_amount: string;
      latest_date: string;
    }) => ({
      merchant: row.merchant_canonical,
      category: row.category,
      occurrences: Number(row.occurrences),
      monthsSeen: Number(row.months_seen),
      averageAmount: roundCurrency(Number(row.average_amount)),
      latestDate: row.latest_date,
    })),
  };
}

async function matchFund(client: PoolClient, fundName: string) {
  const normalized = canonicalizeFundName(fundName);
  const tokens = informativeTokens(fundName);
  const result = await client.query<{
    id: string;
    name: string;
    name_normalized: string;
    category: string;
  }>(
    `
      SELECT id, name, name_normalized, category
      FROM funds
      WHERE name_normalized = $1
         OR name_normalized LIKE $2
      ORDER BY
        CASE WHEN name_normalized = $1 THEN 0 ELSE 1 END,
        LENGTH(name_normalized) ASC
      LIMIT 1
    `,
    [normalized, `%${tokens.join("%")}%`],
  );

  return result.rows[0] ?? null;
}

async function getNavForDate(client: PoolClient, fundId: string, date: string) {
  const result = await client.query<{ nav_date: string; nav_value: string }>(
    `
      SELECT nav_date::text, nav_value::text
      FROM fund_navs
      WHERE fund_id = $1 AND nav_date <= $2::date
      ORDER BY nav_date DESC
      LIMIT 1
    `,
    [fundId, date],
  );

  return result.rows[0] ?? null;
}

async function getLatestNav(client: PoolClient, fundId: string) {
  const result = await client.query<{ nav_date: string; nav_value: string }>(
    `
      SELECT nav_date::text, nav_value::text
      FROM fund_navs
      WHERE fund_id = $1
      ORDER BY nav_date DESC
      LIMIT 1
    `,
    [fundId],
  );

  return result.rows[0] ?? null;
}

export async function queryInvestments(input: InvestmentQueryInput): Promise<Record<string, unknown>> {
  const bounds = await resolveBounds(input, "funds");

  return withClient(async (client) => {
    switch (input.analysisType) {
      case "fund_period_return": {
        if (!input.fundName) {
          throw new Error("fund_period_return requires fundName.");
        }
        if (!bounds.startDate || !bounds.endDate) {
          throw new Error("fund_period_return requires startDate/endDate or a datePreset.");
        }

        const fund = await matchFund(client, input.fundName);
        if (!fund) {
          return { analysisType: input.analysisType, fundFound: false };
        }

        const startNav = await getNavForDate(client, fund.id, bounds.startDate);
        const endNav = await getNavForDate(client, fund.id, bounds.endDate);
        if (!startNav || !endNav) {
          return { analysisType: input.analysisType, fundFound: true, hasNavData: false, fundName: fund.name };
        }

        const startValue = Number(startNav.nav_value);
        const endValue = Number(endNav.nav_value);
        const periodReturn = ((endValue - startValue) / startValue) * 100;

        return {
          analysisType: input.analysisType,
          fundFound: true,
          hasNavData: true,
          fundName: fund.name,
          category: fund.category,
          startDate: startNav.nav_date,
          endDate: endNav.nav_date,
          startNav: roundCurrency(startValue),
          endNav: roundCurrency(endValue),
          periodReturnPercent: roundPercent(periodReturn),
        };
      }
      case "rank_funds_by_return": {
        if (!bounds.startDate || !bounds.endDate) {
          throw new Error("rank_funds_by_return requires startDate/endDate or a datePreset.");
        }

        const funds = await client.query<{ id: string; name: string; category: string }>(
          `SELECT id, name, category FROM funds ORDER BY name ASC`,
        );

        const rows: Array<Record<string, unknown>> = [];
        for (const fund of funds.rows) {
          const startNav = await getNavForDate(client, fund.id, bounds.startDate);
          const endNav = await getNavForDate(client, fund.id, bounds.endDate);
          if (!startNav || !endNav) {
            continue;
          }

          const periodReturn = ((Number(endNav.nav_value) - Number(startNav.nav_value)) / Number(startNav.nav_value)) * 100;
          rows.push({
            fundName: fund.name,
            category: fund.category,
            startDate: startNav.nav_date,
            endDate: endNav.nav_date,
            periodReturnPercent: roundPercent(periodReturn),
          });
        }

        rows.sort(
          (a, b) =>
            Number(b.periodReturnPercent) - Number(a.periodReturnPercent) ||
            String(a.fundName).localeCompare(String(b.fundName)),
        );

        const best = rows[0];
        const worst = rows[rows.length - 1];
        const spread =
          best && worst
            ? roundPercent(Number(best.periodReturnPercent) - Number(worst.periodReturnPercent))
            : null;

        return {
          analysisType: input.analysisType,
          startDate: bounds.startDate,
          endDate: bounds.endDate,
          rows: rows.slice(0, Math.min(input.limit ?? rows.length, rows.length)),
          spreadPercent: spread,
        };
      }
      case "holding_realized_return": {
        if (!input.fundName) {
          throw new Error("holding_realized_return requires fundName.");
        }

        const fund = await matchFund(client, input.fundName);
        if (!fund) {
          return { analysisType: input.analysisType, fundFound: false };
        }

        const holding = await client.query<{
          fund_name: string;
          units: string;
          purchase_date: string;
          purchase_nav: string;
        }>(
          `
            SELECT fund_name, units::text, purchase_date::text, purchase_nav::text
            FROM holdings
            WHERE fund_id = $1
          `,
          [fund.id],
        );

        const row = holding.rows[0];
        if (!row) {
          return { analysisType: input.analysisType, fundFound: true, holdingFound: false, fundName: fund.name };
        }

        const latestNav = await getLatestNav(client, fund.id);
        if (!latestNav) {
          return { analysisType: input.analysisType, fundFound: true, holdingFound: true, hasNavData: false, fundName: fund.name };
        }

        const units = Number(row.units);
        const purchaseNav = Number(row.purchase_nav);
        const latestNavValue = Number(latestNav.nav_value);
        const costBasis = units * purchaseNav;
        const currentValue = units * latestNavValue;
        const profit = currentValue - costBasis;
        const realizedReturn = (profit / costBasis) * 100;

        return {
          analysisType: input.analysisType,
          fundFound: true,
          holdingFound: true,
          hasNavData: true,
          fundName: row.fund_name,
          purchaseDate: row.purchase_date,
          latestNavDate: latestNav.nav_date,
          units: roundCurrency(units),
          purchaseNav: roundCurrency(purchaseNav),
          latestNav: roundCurrency(latestNavValue),
          costBasis: roundCurrency(costBasis),
          currentValue: roundCurrency(currentValue),
          gainAmount: roundCurrency(profit),
          realizedReturnPercent: roundPercent(realizedReturn),
        };
      }
      case "portfolio_summary": {
        const holdings = await client.query<{
          fund_id: string;
          fund_name: string;
          units: string;
          purchase_nav: string;
          purchase_date: string;
        }>(
          `SELECT fund_id, fund_name, units::text, purchase_nav::text, purchase_date::text FROM holdings ORDER BY fund_name ASC`,
        );

        const rows: Array<Record<string, unknown>> = [];
        let portfolioCostBasis = 0;
        let portfolioValue = 0;
        let latestNavDate = "";

        for (const holding of holdings.rows) {
          const latestNav = await getLatestNav(client, holding.fund_id);
          if (!latestNav) {
            continue;
          }

          const units = Number(holding.units);
          const purchaseNav = Number(holding.purchase_nav);
          const currentNav = Number(latestNav.nav_value);
          const costBasis = units * purchaseNav;
          const currentValue = units * currentNav;
          const gainAmount = currentValue - costBasis;
          const realizedReturn = (gainAmount / costBasis) * 100;
          portfolioCostBasis += costBasis;
          portfolioValue += currentValue;
          latestNavDate = latestNav.nav_date > latestNavDate ? latestNav.nav_date : latestNavDate;

          rows.push({
            fundName: holding.fund_name,
            purchaseDate: holding.purchase_date,
            units: roundCurrency(units),
            costBasis: roundCurrency(costBasis),
            currentValue: roundCurrency(currentValue),
            gainAmount: roundCurrency(gainAmount),
            realizedReturnPercent: roundPercent(realizedReturn),
          });
        }

        return {
          analysisType: input.analysisType,
          latestNavDate,
          portfolioCostBasis: roundCurrency(portfolioCostBasis),
          portfolioValue: roundCurrency(portfolioValue),
          portfolioGainAmount: roundCurrency(portfolioValue - portfolioCostBasis),
          portfolioReturnPercent:
            portfolioCostBasis === 0 ? 0 : roundPercent(((portfolioValue - portfolioCostBasis) / portfolioCostBasis) * 100),
          holdings: rows,
        };
      }
      case "best_holding_vs_fund_period": {
        const holdings = await client.query<{
          fund_id: string;
          fund_name: string;
          units: string;
          purchase_nav: string;
          purchase_date: string;
        }>(
          `SELECT fund_id, fund_name, units::text, purchase_nav::text, purchase_date::text FROM holdings ORDER BY fund_name ASC`,
        );

        const comparisons: Array<Record<string, unknown>> = [];

        for (const holding of holdings.rows) {
          const latestNav = await getLatestNav(client, holding.fund_id);
          if (!latestNav) {
            continue;
          }

          const purchaseDate = holding.purchase_date;
          const fundStartNav = await getNavForDate(client, holding.fund_id, purchaseDate);
          if (!fundStartNav) {
            continue;
          }

          const units = Number(holding.units);
          const purchaseNav = Number(holding.purchase_nav);
          const currentNav = Number(latestNav.nav_value);
          const holdingReturn = ((units * currentNav - units * purchaseNav) / (units * purchaseNav)) * 100;
          const fundReturn = ((currentNav - Number(fundStartNav.nav_value)) / Number(fundStartNav.nav_value)) * 100;

          comparisons.push({
            fundName: holding.fund_name,
            purchaseDate,
            latestNavDate: latestNav.nav_date,
            holdingRealizedReturnPercent: roundPercent(holdingReturn),
            fundPeriodReturnPercent: roundPercent(fundReturn),
            deltaPercent: roundPercent(holdingReturn - fundReturn),
          });
        }

        comparisons.sort(
          (a, b) =>
            Number(b.holdingRealizedReturnPercent) - Number(a.holdingRealizedReturnPercent) ||
            String(a.fundName).localeCompare(String(b.fundName)),
        );

        return {
          analysisType: input.analysisType,
          row: comparisons[0] ?? null,
        };
      }
    }
  });
}

export async function getDatasetSummary(): Promise<Record<string, unknown>> {
  const [transactions, navs] = await Promise.all([
    query<{ min_date: string | null; max_date: string | null; count: string }>(
      `SELECT MIN(date)::text AS min_date, MAX(date)::text AS max_date, COUNT(*)::text AS count FROM transactions`,
    ),
    query<{ max_nav_date: string | null; funds_count: string; holdings_count: string }>(`
      SELECT
        (SELECT MAX(nav_date)::text FROM fund_navs) AS max_nav_date,
        (SELECT COUNT(*)::text FROM funds) AS funds_count,
        (SELECT COUNT(*)::text FROM holdings) AS holdings_count
    `),
  ]);

  return {
    transactionDateRange: {
      start: transactions.rows[0]?.min_date,
      end: transactions.rows[0]?.max_date,
    },
    transactionCount: Number(transactions.rows[0]?.count ?? 0),
    latestNavDate: navs.rows[0]?.max_nav_date,
    fundCount: Number(navs.rows[0]?.funds_count ?? 0),
    holdingCount: Number(navs.rows[0]?.holdings_count ?? 0),
  };
}

export function detectTaskType(question: string): string {
  const normalized = normalizeText(question);
  if (normalized.includes("PORTFOLIO") || normalized.includes("FUND") || normalized.includes("HOLDING")) {
    return "investments";
  }
  if (normalized.includes("SUBSCRIPTION") || normalized.includes("RECURRING")) {
    return "recurring";
  }
  return "spending";
}

export function summarizeNoData(result: Record<string, unknown>): boolean {
  if ("row" in result && result.row === null) {
    return true;
  }
  if ("rows" in result && Array.isArray(result.rows) && result.rows.length === 0) {
    return true;
  }
  if ("fundFound" in result && result.fundFound === false) {
    return true;
  }
  return false;
}

export function describeDateBounds(input: DateBounds): string {
  if (input.startDate && input.endDate) {
    return `${input.startDate} to ${input.endDate}`;
  }
  if (input.startDate) {
    return `from ${input.startDate}`;
  }
  if (input.endDate) {
    return `through ${input.endDate}`;
  }
  return "all available data";
}

export function computeExpectedMonthLabel(dateText: string): string {
  return monthLabel(dateText);
}
