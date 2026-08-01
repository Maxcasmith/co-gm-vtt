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
