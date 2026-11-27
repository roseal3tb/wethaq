-- Server-side session control.
-- Signing out revokes the current token: its id is kept here until the token would have expired anyway.
CREATE TABLE revoked_tokens (
  jti        TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(user_id),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX revoked_tokens_expires_idx ON revoked_tokens(expires_at);
-- A password change or an administrator's password reset ends every session of the user (on every device): each
-- token carries the session version it was issued with, and a token with an older version is refused.
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0 CHECK (session_version >= 0);
