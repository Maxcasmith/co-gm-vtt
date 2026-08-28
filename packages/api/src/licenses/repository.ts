import { randomUUID, randomBytes } from 'crypto';
import { pool } from './db.ts';
import type { RowDataPacket } from 'mysql2';

export interface License {
  id: string;
  name: string;
  emailAddress: string;
  licenseCode: string;
  redeemedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface LicenseRow extends RowDataPacket {
  id: string;
  name: string;
  email_address: string;
  license_code: string;
  redeemed_at: string | null;
  created_at: string;
  updated_at: string;
}

function toLicense(row: LicenseRow): License {
  return {
    id: row.id,
    name: row.name,
    emailAddress: row.email_address,
    licenseCode: row.license_code,
    redeemedAt: row.redeemed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function generateLicenseCode(): string {
  return randomBytes(8).toString('hex').toUpperCase().match(/.{1,4}/g)!.join('-');
}

export async function createLicense(name: string, emailAddress: string): Promise<License> {
  const id = randomUUID();
  const licenseCode = generateLicenseCode();
  await pool.query('INSERT INTO licenses (id, name, email_address, license_code) VALUES (?, ?, ?, ?)', [id, name, emailAddress, licenseCode]);
  const [rows] = await pool.query<LicenseRow[]>('SELECT * FROM licenses WHERE id = ?', [id]);
  return toLicense(rows[0]!);
}

export async function findLicenseByCode(licenseCode: string): Promise<License | null> {
  const [rows] = await pool.query<LicenseRow[]>('SELECT * FROM licenses WHERE license_code = ?', [licenseCode]);
  return rows[0] ? toLicense(rows[0]) : null;
}

// Returns null if the code doesn't exist, 'already_redeemed' if it's used, or the redeemed License.
export async function redeemLicense(licenseCode: string): Promise<License | null | 'already_redeemed'> {
  const existing = await findLicenseByCode(licenseCode);
  if (!existing) return null;
  if (existing.redeemedAt) return 'already_redeemed';
  await pool.query('UPDATE licenses SET redeemed_at = NOW() WHERE license_code = ? AND redeemed_at IS NULL', [licenseCode]);
  return findLicenseByCode(licenseCode);
}
