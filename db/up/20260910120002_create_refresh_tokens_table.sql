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
