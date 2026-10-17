-- Migration 017: Remove denormalized author_name and author_image_url columns.
-- Applied after Session 5 deployed LEFT JOIN users across all queries.
-- These columns had no indexes, CHECK constraints, FKs, views, or triggers.

ALTER TABLE reports DROP COLUMN author_name;
ALTER TABLE reports DROP COLUMN author_image_url;
ALTER TABLE comments DROP COLUMN author_name;
ALTER TABLE comments DROP COLUMN author_image_url;
