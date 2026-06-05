import express from "express";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { config } from "./config.js";
import { detectTaskType } from "./domain/finance-service.js";
import { appendJsonLog } from "./lib/logger.js";
import { getRequestTrace, withRequestTrace } from "./lib/request-context.js";
import { taraAgent } from "./mastra/agents/tara-agent.js";

const askSchema = z.object({
  question: z.string().min(1),
});

const app = express();
const publicDir = path.resolve("public");

app.use(express.static(publicDir));
app.use(express.json());

app.get("/health", async (_req, res) => {
  res.json({ ok: true });
});

app.get("/", async (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.post("/ask", async (req, res) => {
  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body. Expected { question: string }." });
  }

  const requestId = randomUUID();
  const question = parsed.data.question;
  const startedAt = Date.now();
  const trace = {
    requestId,
    question,
    startedAt: new Date(startedAt).toISOString(),
    toolCalls: [],
    tablesRead: new Set<string>(),
  };

  try {
    const answer = await withRequestTrace(trace, async () => {
      const result = await taraAgent.generateLegacy(question);
      return result.text;
    });

    const latencyMs = Date.now() - startedAt;
    const activeTrace = getRequestTrace() ?? trace;
    await appendJsonLog("requests.jsonl", {
      requestId,
      question,
      taskType: detectTaskType(question),
      toolsCalled: activeTrace.toolCalls.map((call) => ({
        tool: call.tool,
        input: call.input,
        tables: call.tables,
        status: call.status,
        startedAt: call.startedAt,
        completedAt: call.completedAt,
      })),
      tablesRead: Array.from(activeTrace.tablesRead.values()),
      latencyMs,
      status: "success",
      answer,
    });

    return res.json({ answer });
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    await appendJsonLog("requests.jsonl", {
      requestId,
      question,
      taskType: detectTaskType(question),
      toolsCalled: trace.toolCalls,
      tablesRead: Array.from(trace.tablesRead.values()),
      latencyMs,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected error",
    });
  }
});

app.listen(config.PORT, () => {
  console.log(`Tara server listening on http://localhost:${config.PORT}`);
});
