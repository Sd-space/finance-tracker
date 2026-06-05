import { config } from "../src/config.js";
import { queryInvestments, queryTransactions, detectRecurringTransactions } from "../src/domain/finance-service.js";

type EvalCase = {
  question: string;
  verify: (answer: string) => Promise<{ pass: boolean; details: string }>;
};

function includesAll(answer: string, values: Array<string | number>): boolean {
  const normalized = answer.toLowerCase();
  return values.every((value) => normalized.includes(String(value).toLowerCase()));
}

async function ask(question: string): Promise<string> {
  const response = await fetch(`http://localhost:${config.PORT}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });

  const body = (await response.json()) as { answer?: string; error?: string };
  if (!response.ok || !body.answer) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }

  return body.answer;
}

function numberHint(value: number): string {
  return value.toFixed(2);
}

async function main() {
  const totalFoodMarch = await queryTransactions({
    analysisType: "total_spend",
    category: "food",
    startDate: "2025-03-01",
    endDate: "2025-03-31",
  });

  const biggestExpense = await queryTransactions({
    analysisType: "largest_expense",
  });

  const swiggySpend = await queryTransactions({
    analysisType: "total_spend",
    merchant: "Swiggy",
  });

  const q1Spending = await queryTransactions({
    analysisType: "total_spend",
    startDate: "2025-01-01",
    endDate: "2025-03-31",
  });

  const recurring = await detectRecurringTransactions({});

  const bluechipReturn = await queryInvestments({
    analysisType: "fund_period_return",
    fundName: "Saffron Bluechip Equity Fund",
    startDate: "2024-01-01",
    endDate: "2025-01-01",
  });

  const holdingReturn = await queryInvestments({
    analysisType: "holding_realized_return",
    fundName: "Sentinel Nifty Index Fund",
  });

  const portfolioSummary = await queryInvestments({
    analysisType: "portfolio_summary",
  });

  const bestHolding = await queryInvestments({
    analysisType: "best_holding_vs_fund_period",
  });

  const cases: EvalCase[] = [
    {
      question: "How much did I spend on food in March 2025 after refunds?",
      verify: async (answer) => ({
        pass: includesAll(answer, [numberHint(Number(totalFoodMarch.total))]),
        details: `expected ${numberHint(Number(totalFoodMarch.total))}`,
      }),
    },
    {
      question: "What was my single biggest expense?",
      verify: async (answer) => {
        const row = biggestExpense.row as Record<string, unknown> | null;
        return {
          pass: row ? includesAll(answer, [String(row.merchant), numberHint(Number(row.amount))]) : false,
          details: `expected ${String(row?.merchant)} ${numberHint(Number(row?.amount ?? 0))}`,
        };
      },
    },
    {
      question: "How much did I spend on Swiggy, including Swiggy Instamart and SWIGGY orders?",
      verify: async (answer) => ({
        pass: includesAll(answer, [numberHint(Number(swiggySpend.total))]),
        details: `expected ${numberHint(Number(swiggySpend.total))}`,
      }),
    },
    {
      question: "Ignore transfers. What was my total actual spending in Q1 2025?",
      verify: async (answer) => ({
        pass: includesAll(answer, [numberHint(Number(q1Spending.total))]),
        details: `expected ${numberHint(Number(q1Spending.total))}`,
      }),
    },
    {
      question: "Which transactions look like recurring subscriptions?",
      verify: async (answer) => {
        const rows = (recurring.recurringCandidates as Array<Record<string, unknown>>).slice(0, 2);
        return {
          pass: rows.length > 0 && rows.some((row) => answer.toLowerCase().includes(String(row.merchant).toLowerCase())),
          details: `expected one of ${rows.map((row) => String(row.merchant)).join(", ")}`,
        };
      },
    },
    {
      question: "Do I have any data for rent in April 2025?",
      verify: async (answer) => ({
        pass: answer.toLowerCase().includes("no") || answer.toLowerCase().includes("not"),
        details: "expected a no-data style answer",
      }),
    },
    {
      question: "What was Saffron Bluechip Equity Fund's return from 2024-01-01 to 2025-01-01?",
      verify: async (answer) => ({
        pass: includesAll(answer, [numberHint(Number(bluechipReturn.periodReturnPercent))]),
        details: `expected ${numberHint(Number(bluechipReturn.periodReturnPercent))}%`,
      }),
    },
    {
      question: "What is my realised return on my Sentinel Nifty Index Fund holding, given when I bought it?",
      verify: async (answer) => ({
        pass: includesAll(answer, [numberHint(Number(holdingReturn.realizedReturnPercent)), numberHint(Number(holdingReturn.gainAmount))]),
        details: `expected ${numberHint(Number(holdingReturn.realizedReturnPercent))}% and ${numberHint(Number(holdingReturn.gainAmount))}`,
      }),
    },
    {
      question: "What is my portfolio worth today, and how much have I made on it in absolute INR?",
      verify: async (answer) => ({
        pass: includesAll(answer, [numberHint(Number(portfolioSummary.portfolioValue)), numberHint(Number(portfolioSummary.portfolioGainAmount))]),
        details: `expected ${numberHint(Number(portfolioSummary.portfolioValue))} and ${numberHint(Number(portfolioSummary.portfolioGainAmount))}`,
      }),
    },
    {
      question: "Of the funds I own, which gave me the best realised return, and how does it compare to the same fund's period return over the same window?",
      verify: async (answer) => {
        const row = bestHolding.row as Record<string, unknown> | null;
        return {
          pass: row
            ? includesAll(answer, [
                String(row.fundName),
                numberHint(Number(row.holdingRealizedReturnPercent)),
                numberHint(Number(row.fundPeriodReturnPercent)),
              ])
            : false,
          details: `expected ${String(row?.fundName)}`,
        };
      },
    },
    {
      question: "Compare my food and travel spending month by month. Which grew faster?",
      verify: async (answer) => ({
        pass: answer.toLowerCase().includes("food") || answer.toLowerCase().includes("travel"),
        details: "expected a comparison answer mentioning food or travel",
      }),
    },
    {
      question: "Which category had the biggest increase from February to March?",
      verify: async (answer) => ({
        pass: answer.length > 0,
        details: "expected a non-empty answer",
      }),
    },
  ];

  let passed = 0;
  const failures: string[] = [];

  for (const testCase of cases) {
    try {
      const answer = await ask(testCase.question);
      const result = await testCase.verify(answer);
      if (result.pass) {
        passed += 1;
        console.log(`PASS | ${testCase.question}`);
      } else {
        failures.push(`FAIL | ${testCase.question} | ${result.details} | actual: ${answer}`);
        console.log(`FAIL | ${testCase.question}`);
      }
    } catch (error) {
      failures.push(`ERROR | ${testCase.question} | ${error instanceof Error ? error.message : String(error)}`);
      console.log(`ERROR | ${testCase.question}`);
    }
  }

  console.log(`\nSummary: ${passed}/${cases.length} passed`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const failure of failures) {
      console.log(failure);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
