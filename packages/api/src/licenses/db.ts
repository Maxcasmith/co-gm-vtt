import mysql from 'mysql2/promise';

export const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'co_gm_vtt',
});

export async function initLicensesTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS licenses (
      id CHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email_address VARCHAR(255) NOT NULL,
      license_code VARCHAR(64) NOT NULL UNIQUE,
      redeemed_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}
