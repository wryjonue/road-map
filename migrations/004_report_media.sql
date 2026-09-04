ALTER TABLE reports ADD COLUMN static_map_url TEXT;
ALTER TABLE reports ADD COLUMN static_map_r2_key TEXT;

ALTER TABLE report_images ADD COLUMN r2_key TEXT;
ALTER TABLE report_images ADD COLUMN content_type TEXT;
ALTER TABLE report_images ADD COLUMN file_name TEXT;
ALTER TABLE report_images ADD COLUMN file_size INTEGER;