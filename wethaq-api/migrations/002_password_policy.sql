-- Temporary passwords (Section 4.3.6): an account created or reset by an administrator must
-- change its password at first sign-in, and the temporary password stops working after 24 hours.
ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN password_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMPTZ;
