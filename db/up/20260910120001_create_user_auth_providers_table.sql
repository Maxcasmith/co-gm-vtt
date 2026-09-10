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
