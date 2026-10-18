-- Add role column to users table
-- This migration adds the role field to support granular access control
-- Role is stored in Clerk's public_metadata.role and defaults to 'user'

ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';

-- Update existing users to have default 'user' role
UPDATE users SET role = 'user' WHERE role IS NULL;