PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS report_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
    UNIQUE(report_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_report_votes_report_id ON report_votes(report_id);
CREATE INDEX IF NOT EXISTS idx_report_votes_user_id ON report_votes(user_id);