-- Migration 018: AI moderation columns and expanded notification types.
-- Adds AI verdict tracking to reports and allows new notification types for
-- AI auto-approve, auto-reject, manual review flagging, and comment notifications.

-- AI moderation metadata on reports
ALTER TABLE reports ADD COLUMN ai_verdict TEXT;
ALTER TABLE reports ADD COLUMN ai_confidence REAL;
ALTER TABLE reports ADD COLUMN ai_reason TEXT;
ALTER TABLE reports ADD COLUMN ai_reviewed_at TEXT;

-- Recreate notifications table with expanded type CHECK constraint.
-- SQLite cannot alter CHECK constraints in place, so we rebuild the table.
CREATE TABLE IF NOT EXISTS notifications_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN (
        'report_approved', 'report_rejected', 'report_resolved',
        'report_auto_approved', 'report_auto_rejected', 'report_needs_review',
        'comment_created'
    )),
    report_id INTEGER NOT NULL,
    actor_id TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (report_id) REFERENCES reports(id)
);

INSERT INTO notifications_new (id, user_id, type, report_id, actor_id, message, is_read, created_at)
    SELECT id, user_id, type, report_id, actor_id, message, is_read, created_at FROM notifications;

DROP TABLE notifications;

ALTER TABLE notifications_new RENAME TO notifications;

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
