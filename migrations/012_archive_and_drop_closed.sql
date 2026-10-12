-- Archive rejected/deleted reports (never hard-delete) and remove the unused 'Closed' status.
--
-- 1) Add an archived_at timestamp column and backfill it for already-rejected /
--    already-soft-deleted rows so they appear in the archive view.
-- 2) The 'Closed' status is removed at the application layer (FEED_STATUSES, error
--    messages, UI filters, CSS). The physical CHECK constraint in the schema still
--    lists 'Closed' because SQLite cannot ALTER a CHECK and D1's local workerd
--    enforces foreign keys during DROP TABLE even with PRAGMA foreign_keys = OFF,
--    making a safe table rebuild impossible in this environment. Since no rows ever
--    have status='Closed' (it's a zombie status never produced by code) and nothing
--    in the app sets it, leaving the CHECK as-is is harmless. A future migration on
--    remote D1 (where the pragma may behave differently) or after dropping
--    report_images' FK could complete the schema cleanup.

-- Step 1: add the archive timestamp. Migrations run once, so a plain ADD is fine.
ALTER TABLE reports ADD COLUMN archived_at TEXT;

-- Step 2: backfill archived_at for rows that are already archived.
UPDATE reports SET archived_at = updated_at WHERE status = 'Rejected' AND archived_at IS NULL;
UPDATE reports SET archived_at = deleted_at WHERE deleted_at IS NOT NULL AND archived_at IS NULL;
