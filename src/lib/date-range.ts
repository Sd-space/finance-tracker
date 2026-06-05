import { query } from "./db.js";

export type DatePreset =
  | "last_month"
  | "current_month"
  | "last_3_months"
  | "last_12_months"
  | "latest_quarter";

type AnchorKind = "transactions" | "funds";

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function addMonths(date: Date, amount: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
}

async function getAnchorDate(kind: AnchorKind): Promise<Date> {
  const sql =
    kind === "transactions"
      ? `SELECT MAX(date)::text AS anchor FROM transactions`
      : `SELECT MAX(nav_date)::text AS anchor FROM fund_navs`;

  const result = await query<{ anchor: string | null }>(sql);
  const anchor = result.rows[0]?.anchor;
  if (!anchor) {
    throw new Error(`No ${kind} data found in the database.`);
  }

  return new Date(`${anchor}T00:00:00.000Z`);
}

export async function resolveDatePreset(
  preset: DatePreset,
  anchorKind: AnchorKind,
): Promise<{ startDate: string; endDate: string }> {
  const anchor = await getAnchorDate(anchorKind);
  const monthStart = startOfMonth(anchor);

  switch (preset) {
    case "last_month": {
      const start = addMonths(monthStart, -1);
      return { startDate: start.toISOString().slice(0, 10), endDate: endOfMonth(start).toISOString().slice(0, 10) };
    }
    case "current_month": {
      return {
        startDate: monthStart.toISOString().slice(0, 10),
        endDate: endOfMonth(anchor).toISOString().slice(0, 10),
      };
    }
    case "last_3_months": {
      const start = addMonths(monthStart, -2);
      return { startDate: start.toISOString().slice(0, 10), endDate: endOfMonth(anchor).toISOString().slice(0, 10) };
    }
    case "last_12_months": {
      const start = addMonths(monthStart, -11);
      return { startDate: start.toISOString().slice(0, 10), endDate: endOfMonth(anchor).toISOString().slice(0, 10) };
    }
    case "latest_quarter": {
      const quarter = Math.floor(anchor.getUTCMonth() / 3);
      const start = new Date(Date.UTC(anchor.getUTCFullYear(), quarter * 3, 1));
      const end = new Date(Date.UTC(anchor.getUTCFullYear(), quarter * 3 + 3, 0));
      return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
    }
  }
}
