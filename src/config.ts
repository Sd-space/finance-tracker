import "dotenv/config";
import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  NVIDIA_API_KEY: z.string().min(1).optional(),
  NVIDIA_MODEL: z.string().default("nvidia/nemotron-3-super-120b-a12b"),
  OPENAI_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  DATABASE_URL: z.string().min(1).optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  DATA_DIR: z.string().default("./data-20260603T120050Z-3-001/data/sample_a"),
  LOG_DIR: z.string().default("./logs"),
});

const parsed = envSchema.parse(process.env);

export const config = {
  ...parsed,
  LOG_DIR: path.resolve(parsed.LOG_DIR),
};

export function requireDatabaseUrl(): string {
  if (!config.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Add it to your .env before using the database.");
  }

  return config.DATABASE_URL;
}

export function requireOpenAiKey(): string {
  if (config.NVIDIA_API_KEY) {
    return config.NVIDIA_API_KEY;
  }

  const key = config.OPENAI_KEY ?? config.OPENAI_API_KEY;
  if (!key) {
    throw new Error("NVIDIA_API_KEY or OPENAI_KEY is not set. Add one to your .env before starting the server.");
  }

  return key;
}
