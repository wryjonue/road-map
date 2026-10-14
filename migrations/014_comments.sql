-- Comments table
-- Flat, non-nested comments for report detail pages.
-- Author fields are denormalized at insert time from verified Clerk claims
-- (there is no local users table to join against).
-- is_system rows are status-change auto comments and can never be deleted.

CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL,
    author_id TEXT NOT NULL,
    author_name TEXT,
    author_image_url TEXT,
    body TEXT NOT NULL,
    is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comments_report_created ON comments(report_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_comments_author_id ON comments(author_id);
