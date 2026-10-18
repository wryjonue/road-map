-- Extend notifications table to support user management events
-- Add target_user_id for notifications that target specific users
-- Add notification_type column to distinguish between report-based and user-management notifications

ALTER TABLE notifications ADD COLUMN target_user_id TEXT;
ALTER TABLE notifications ADD COLUMN notification_type TEXT DEFAULT 'report';

-- Update existing notifications to have notification_type = 'report'
UPDATE notifications SET notification_type = 'report' WHERE notification_type IS NULL;

-- Create index for efficient querying by target_user_id
CREATE INDEX IF NOT EXISTS idx_notifications_target_user ON notifications(target_user_id);

-- Update check constraint to include new notification types
DROP INDEX IF EXISTS idx_notifications_user_unread;
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read, notification_type);

-- Add new notification types to the check constraint
-- Note: SQLite doesn't support ALTER CHECK constraints, so we'll handle validation in application logic