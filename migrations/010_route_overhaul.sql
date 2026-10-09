-- Route Overhaul Migration
-- Add start/destination coordinates and route polyline to reports
-- Wipe all existing report data as requested

-- Add new columns for route-based reporting
ALTER TABLE reports ADD COLUMN start_longitude REAL;
ALTER TABLE reports ADD COLUMN start_latitude REAL;
ALTER TABLE reports ADD COLUMN dest_longitude REAL;
ALTER TABLE reports ADD COLUMN dest_latitude REAL;
ALTER TABLE reports ADD COLUMN route_polyline TEXT;

-- Wipe all existing reports and related data
DELETE FROM report_images;
DELETE FROM report_votes;
DELETE FROM reports;
DELETE FROM sqlite_sequence WHERE name IN ('reports', 'report_images', 'report_votes');
