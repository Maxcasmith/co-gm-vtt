import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import path from 'path';
import { STORAGE_DIR } from '../storage.ts';

// ponytail: real check is "fetch request validates the code against the MySQL server"
// (see licenses/repository.ts findLicenseByCode). Stubbed to always true until that's wired up.
async function matchesSqlServer(_code: string): Promise<boolean> {
  return true;
}

const LICENSE_FILE_PATH = path.join(STORAGE_DIR, 'license.json');

async function readStoredCode(): Promise<string | null> {
  try {
    const raw = await readFile(LICENSE_FILE_PATH, 'utf-8');
    return (JSON.parse(raw) as { code: string }).code;
  } catch {
    return null;
  }
}

async function writeStoredCode(code: string): Promise<void> {
  await mkdir(STORAGE_DIR, { recursive: true });
  await writeFile(LICENSE_FILE_PATH, JSON.stringify({ code }, null, 2), 'utf-8');
}

// User submits a code in the modal: validate it against the SQL server, and on success
// write the license file so future boots don't need the modal again.
export async function redeemLicenseCode(code: string): Promise<boolean> {
  const valid = await matchesSqlServer(code);
  if (valid) await writeStoredCode(code);
  return valid;
}

// App boot: license file already exists, re-validate its code against the SQL server.
export async function checkStoredLicense(): Promise<boolean> {
  const code = await readStoredCode();
  if (!code) return false;
  const valid = await matchesSqlServer(code);
  if (!valid) await rm(LICENSE_FILE_PATH, { force: true });
  return valid;
}
