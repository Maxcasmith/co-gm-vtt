-- co-gm-vtt Auth Schema
-- Run this script against the same MySQL database used by packages/api
-- (see MYSQL_HOST/PORT/USER/PASSWORD/DATABASE in packages/api/src/licenses/db.ts)

-- ============================================================================
-- USERS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  firstName VARCHAR(100) NOT NULL,
  lastName VARCHAR(100) NOT NULL,
  mobile VARCHAR(20) NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- USER AUTH PROVIDERS TABLE (Google, Facebook, X/Twitter)
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_auth_providers (
  id VARCHAR(36) PRIMARY KEY,
  userId VARCHAR(36) NOT NULL,
  provider ENUM('google', 'facebook', 'x') NOT NULL,
  providerUserId VARCHAR(255) NOT NULL,
  providerEmail VARCHAR(255) NOT NULL,

  -- Google-specific encrypted tokens
  googleAccessToken TEXT NULL,
  googleRefreshToken TEXT NULL,
  googleTokenExpiresAt TIMESTAMP NULL,

  -- Facebook-specific encrypted tokens (for future)
  facebookAccessToken TEXT NULL,
  facebookTokenExpiresAt TIMESTAMP NULL,

  -- X-specific encrypted tokens (for future)
  xAccessToken TEXT NULL,
  xRefreshToken TEXT NULL,
  xTokenExpiresAt TIMESTAMP NULL,

  -- Scopes granted by user
  scopes TEXT NULL,

  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_provider_user (provider, providerUserId),
  INDEX idx_user_id (userId),
  INDEX idx_provider_user (provider, providerUserId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- REFRESH TOKENS TABLE (Session management with token chains)
-- ============================================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id VARCHAR(36) PRIMARY KEY,
  userId VARCHAR(36) NOT NULL,
  refreshToken VARCHAR(500) NOT NULL UNIQUE,
  predecessorId VARCHAR(36) NULL,
  expiresAt TIMESTAMP NOT NULL,
  inactive BOOLEAN DEFAULT FALSE,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (predecessorId) REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  INDEX idx_user_id (userId),
  INDEX idx_refresh_token (refreshToken),
  INDEX idx_inactive_expires (inactive, expiresAt),
  INDEX idx_predecessor (predecessorId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- CLEANUP PROCEDURE (Optional - run periodically via cron)
-- ============================================================================
DELIMITER //

CREATE PROCEDURE IF NOT EXISTS cleanup_expired_tokens()
BEGIN
  -- Delete expired tokens
  DELETE FROM refresh_tokens
  WHERE expiresAt < NOW();

  -- Delete inactive tokens older than 30 days (audit retention)
  DELETE FROM refresh_tokens
  WHERE inactive = TRUE
    AND updatedAt < DATE_SUB(NOW(), INTERVAL 30 DAY);
END //

DELIMITER ;

-- ============================================================================
-- SAMPLE CLEANUP EVENT (Optional - runs daily at 2 AM)
-- ============================================================================
-- Uncomment to enable automatic cleanup:
-- CREATE EVENT IF NOT EXISTS daily_token_cleanup
-- ON SCHEDULE EVERY 1 DAY
-- STARTS CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 2 HOUR
-- DO CALL cleanup_expired_tokens();
