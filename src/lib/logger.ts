import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

export async function appendJsonLog(filename: string, payload: unknown): Promise<void> {
  await mkdir(config.LOG_DIR, { recursive: true });
  const filePath = path.join(config.LOG_DIR, filename);
  await appendFile(filePath, `${JSON.stringify(payload)}\n`, "utf8");
}
