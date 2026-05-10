-- MCP OAuth Tables Migration
-- Run this against the SparkyFitness PostgreSQL database

-- OAuth clients (dynamic client registration for claude.ai)
CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  redirect_uris TEXT[] NOT NULL,
  grant_types TEXT[] NOT NULL DEFAULT '{authorization_code, refresh_token}',
  response_types TEXT[] NOT NULL DEFAULT '{code}',
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- OAuth authorization codes (short-lived, single-use)
CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
  code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id),
  user_id UUID NOT NULL REFERENCES "user"(id),
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  scope TEXT NOT NULL DEFAULT 'mcp:tools',
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- OAuth refresh tokens (stored as SHA-256 hashes for security)
CREATE TABLE IF NOT EXISTS mcp_oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES "user"(id),
  client_id TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id),
  scope TEXT NOT NULL DEFAULT 'mcp:tools',
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_codes_user ON mcp_oauth_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_codes_expires ON mcp_oauth_codes(expires_at) WHERE used = FALSE;
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_refresh_user ON mcp_oauth_refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_refresh_revoked ON mcp_oauth_refresh_tokens(revoked, expires_at);
