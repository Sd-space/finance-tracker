import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  detectRecurringTransactions,
  getDatasetSummary,
  queryInvestments,
  queryTransactions,
} from "../../domain/finance-service.js";
import { sanitizeToolInput } from "../../domain/questions.js";
import { failToolTrace, finishToolTrace, startToolTrace } from "../../lib/request-context.js";

const datePresetSchema = z
  .enum(["last_month", "current_month", "last_3_months", "last_12_months", "latest_quarter"])
  .optional();

export const queryTransactionsTool = createTool({
  id: "query-transactions",
  description:
    "Query spending transactions for totals, rankings, comparisons, date-filtered lookups, and merchant/category analysis. Use this for all money-out questions about transactions.",
  inputSchema: z.object({
    analysisType: z.enum([
      "total_spend",
      "largest_expense",
      "top_merchants",
      "month_over_month_category_comparison",
      "category_increase",
      "transaction_search",
      "category_breakdown",
    ]),
    category: z.string().optional(),
    categories: z.array(z.string()).optional(),
    merchant: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    datePreset: datePresetSchema,
    groupBy: z.enum(["none", "month", "merchant", "category"]).optional(),
    limit: z.number().int().positive().max(50).optional(),
    includeTransfers: z.boolean().optional(),
  }),
  execute: async (inputData) => {
    const trace = startToolTrace("query-transactions", sanitizeToolInput(inputData), ["transactions"]);
    try {
      const result = await queryTransactions(inputData);
      finishToolTrace(trace);
      return result;
    } catch (error) {
      failToolTrace(trace, error);
      throw error;
    }
  },
});

export const detectRecurringTransactionsTool = createTool({
  id: "detect-recurring-transactions",
  description:
    "Detect likely recurring charges or subscriptions by looking for the same merchant appearing in multiple months with similar patterns.",
  inputSchema: z.object({
    minOccurrences: z.number().int().min(2).max(12).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    datePreset: datePresetSchema,
  }),
  execute: async (inputData) => {
    const trace = startToolTrace("detect-recurring-transactions", sanitizeToolInput(inputData), ["transactions"]);
    try {
      const result = await detectRecurringTransactions(inputData);
      finishToolTrace(trace);
      return result;
    } catch (error) {
      failToolTrace(trace, error);
      throw error;
    }
  },
});

export const queryInvestmentsTool = createTool({
  id: "query-investments",
  description:
    "Analyze funds, holdings, and the overall portfolio. Use this for fund NAV returns, realized holding returns, fund ranking, and portfolio value/gains.",
  inputSchema: z.object({
    analysisType: z.enum([
      "fund_period_return",
      "rank_funds_by_return",
      "holding_realized_return",
      "portfolio_summary",
      "best_holding_vs_fund_period",
    ]),
    fundName: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    datePreset: datePresetSchema,
    limit: z.number().int().positive().max(25).optional(),
  }),
  execute: async (inputData) => {
    const trace = startToolTrace("query-investments", sanitizeToolInput(inputData), ["funds", "fund_navs", "holdings"]);
    try {
      const result = await queryInvestments(inputData);
      finishToolTrace(trace);
      return result;
    } catch (error) {
      failToolTrace(trace, error);
      throw error;
    }
  },
});

export const getDatasetSummaryTool = createTool({
  id: "get-dataset-summary",
  description:
    "Return the available transaction and fund date ranges in the currently ingested snapshot. Use this when a question depends on relative dates like last month or today.",
  inputSchema: z.object({}),
  execute: async () => {
    const trace = startToolTrace("get-dataset-summary", {}, ["transactions", "fund_navs", "funds", "holdings"]);
    try {
      const result = await getDatasetSummary();
      finishToolTrace(trace);
      return result;
    } catch (error) {
      failToolTrace(trace, error);
      throw error;
    }
  },
});
