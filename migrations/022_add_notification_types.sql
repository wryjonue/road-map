-- Add notification types for user management events
-- This migration adds the necessary notification types for user management actions

-- Update existing notifications to have notification_type = 'report'
UPDATE notifications SET notification_type = 'report' WHERE notification_type IS NULL;

-- Create new notification types in a separate table for better management
CREATE TABLE IF NOT EXISTS notification_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT
);

-- Insert standard notification types
INSERT OR IGNORE INTO notification_types (name, description) VALUES 
('report_approved', 'Report was approved'),
('report_rejected', 'Report was rejected'),
('report_resolved', 'Report was resolved'),
('user_role_changed', 'User role was changed'),
('user_blocked', 'User was blocked'),
('user_unblocked', 'User was unblocked');

-- Add foreign key constraint to notifications.type
-- Note: SQLite doesn't support ALTER FOREIGN KEY, so we'll handle validation in application logic