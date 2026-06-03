import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

type LogFields = Record<string, unknown>;

const logPath = join(process.cwd(), "data", "bearly-secure.log");

export function logEvent(eventName: string, fields: LogFields = {}): void {
  mkdirSync(dirname(logPath), { recursive: true });

  appendFileSync(
    logPath,
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      event: eventName,
      ...fields,
    })}\n`,
  );
}
