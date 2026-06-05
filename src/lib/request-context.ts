import { AsyncLocalStorage } from "node:async_hooks";

export type ToolCallTrace = {
  tool: string;
  input: unknown;
  tables: string[];
  startedAt: string;
  completedAt?: string;
  status: "running" | "success" | "error";
  error?: string;
};

export type RequestTrace = {
  requestId: string;
  question: string;
  startedAt: string;
  toolCalls: ToolCallTrace[];
  tablesRead: Set<string>;
};

const storage = new AsyncLocalStorage<RequestTrace>();

export function withRequestTrace<T>(trace: RequestTrace, fn: () => Promise<T>): Promise<T> {
  return storage.run(trace, fn);
}

export function getRequestTrace(): RequestTrace | undefined {
  return storage.getStore();
}

export function startToolTrace(tool: string, input: unknown, tables: string[]): ToolCallTrace | undefined {
  const trace = storage.getStore();
  if (!trace) {
    return undefined;
  }

  const entry: ToolCallTrace = {
    tool,
    input,
    tables,
    startedAt: new Date().toISOString(),
    status: "running",
  };

  trace.toolCalls.push(entry);
  for (const table of tables) {
    trace.tablesRead.add(table);
  }

  return entry;
}

export function finishToolTrace(entry: ToolCallTrace | undefined): void {
  if (!entry) {
    return;
  }

  entry.completedAt = new Date().toISOString();
  entry.status = "success";
}

export function failToolTrace(entry: ToolCallTrace | undefined, error: unknown): void {
  if (!entry) {
    return;
  }

  entry.completedAt = new Date().toISOString();
  entry.status = "error";
  entry.error = error instanceof Error ? error.message : String(error);
}
