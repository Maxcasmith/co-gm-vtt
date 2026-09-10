-- licenses table is normally bootstrapped by the api at startup (initLicensesTable in
-- packages/api/src/licenses/db.ts), not by a migration — guard here so this seed also
-- runs standalone on a database the api hasn't booted against yet.
CREATE TABLE IF NOT EXISTS licenses (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email_address VARCHAR(255) NOT NULL,
  license_code VARCHAR(64) NOT NULL UNIQUE,
  redeemed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Licenses are a desktop-only concept (one-time purchase) — cloud/web is a
-- subscription and never gets a license row.
INSERT IGNORE INTO licenses (id, name, email_address, license_code, redeemed_at, created_at, updated_at) VALUES
  ('b0000000-0000-4000-8000-000000000002', 'Demo Two', 'demo2@example.com', 'DEMO-LICENSE-0002', NOW(), NOW(), NOW());
