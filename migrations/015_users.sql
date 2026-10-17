-- Users table
-- Canonical user profiles synced from Clerk. The Clerk user ID is the primary key.
-- No foreign keys from reports or comments: SQLite cannot add FKs to existing tables
-- without a full rebuild, and D1/workerd enforces FKs during DROP TABLE even with
-- PRAGMA foreign_keys = OFF (see migration 012). Referential integrity for author_id
-- is enforced at the application layer, backed by idx_reports_author_id and
-- idx_comments_author_id. This matches the precedent in migrations 011 and 013.
-- Soft-deleted users (deleted_at IS NOT NULL) are excluded from LEFT JOINs so that
-- deleted accounts do not render stale profile data.

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    first_name TEXT,
    last_name TEXT,
    image_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT
);
