import { appendFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.resolve(__dir, '../storage/logs');

export function logError(context: string, err: unknown): void {
  mkdirSync(LOGS_DIR, { recursive: true });

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 8);
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && err.stack ? `\n${err.stack}` : '';

  appendFileSync(path.join(LOGS_DIR, `${date}.log`), `[ERROR ${time}] ${context}: ${message}${stack}\n\n`, 'utf-8');
}

// console.log only reaches the dev-server's own terminal — use this for anything that needs to
// survive into storage/logs for later inspection.
export function logDebug(message: string): void {
  mkdirSync(LOGS_DIR, { recursive: true });
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 8);
  appendFileSync(path.join(LOGS_DIR, `${date}.log`), `[DEBUG ${time}] ${message}\n`, 'utf-8');
}

/** Awaits `work` and logs how long it took, whether it resolved or threw. For attributing a slow
 * multi-step wait (a fight's loading screen) to the step that caused it. */
export async function timed<T>(label: string, work: Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await work;
  } finally {
    logDebug(`${label} ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
}

// Tag audit trail — persisted to storage/logs only when DEBUG_MODE=true, since every DM turn with
// tags writes several lines.
export function logTagDebug(message: string): void {
  if (process.env.DEBUG_MODE === 'true') logDebug(`[tag] ${message}`);
}
