# RoadMap Agent Guide

## Project Overview

RoadMap is a React single-page application for reporting road hazards, viewing incident locations, and managing traffic violations. Incident reports are served by a Cloudflare Worker and stored in D1, with uploaded media stored in R2.

## Tech Stack

- React 19 with Vite
- React Router
- MapLibre GL for interactive maps
- `@clerk/react` for authentication UI
- Cloudflare Workers with `@cloudflare/vite-plugin`
- Cloudflare D1 for relational data
- Cloudflare R2 for report images and static maps
- Geoapify for server-generated static maps
- CSS Modules for component and page styling
- Oxlint for linting
- JavaScript and JSX only; TypeScript is not currently configured

## Directory Structure

- `src/components/`: reusable UI and layout components
- `src/pages/`: route-level page components
- `src/data/`: static data, category options, and frontend fixtures
- `src/assets/`: frontend assets
- `src/router.jsx`: application route definitions
- `src/index.css`: global variables, resets, shared utility classes, buttons, navigation, statuses, and tables
- `api/index.js`: Cloudflare Worker entry point and API routing
- `api/report-service.js`: report, D1, R2, and Geoapify service logic
- `migrations/`: sequential D1 SQL migrations
- `public/`: static public assets
- `wrangler.jsonc`: Worker, D1, R2, and deployment configuration

Place new route-level UI in `src/pages/`, reusable UI in `src/components/`, and shared mock or lookup data in `src/data/`. Keep backend code under `api/` and database changes in a new numbered migration.

## Code Conventions

### React

- Use functional components and React hooks.
- Keep state and effects close to the page or component that owns the behavior.
- Use `useEffect` for MapLibre setup and cleanup; always remove maps and markers during cleanup.
- Use `useNavigate`, `Link`, and `NavLink` for application navigation instead of manually changing browser history.
- Preserve existing user-facing behavior when refactoring.

### Styling

- Use `[Name].module.css` beside each page or component for local styles.
- Import modules as `styles` and use `className={styles.className}`.
- Keep global variables, resets, shared utility classes, buttons, navigation classes, status badges, and table styles in `src/index.css`.
- Do not add page-specific selectors to `index.css`.
- Combine local module classes with global utility classes when appropriate, for example `className={\`page-card ${styles.page}\`}`.

### Imports and Exports

- Use default exports for page and component modules.
- Use named exports for shared constants and service functions where multiple exports are useful.
- Prefer relative imports and keep third-party imports in the module that uses them.
- Keep imports grouped by external packages, internal modules, and styles where practical.

### API and Database

- Use parameterized D1 queries; never interpolate user input into SQL.
- Preserve existing tables and data. Add schema changes through a new sequential migration; do not reset or drop tables.
- Keep report API errors in the JSON shape `{ "error": "message" }` with an appropriate HTTP status.
- Enforce the report pagination maximum of 10 records per request.
- Exclude soft-deleted reports from public listing and detail responses.
- Treat `author_id` as the stable Clerk identity; do not use display names as identity. The Clerk user ID is the canonical user key across all tables.
- The `users` table stores canonical user profiles (`id`, `first_name`, `last_name`, `image_url`, timestamps, `deleted_at`). Author display names and images must be resolved via `LEFT JOIN users` rather than denormalized columns on `reports` or `comments`. Soft-deleted users (`deleted_at IS NOT NULL`) should be excluded from joins.
- Vector embeddings are intentionally ignored for now and should not be generated or exposed unless explicitly requested.
- Report images and static maps belong in R2; D1 should store keys, URLs, and metadata rather than binary content.
- Keep R2 buckets private and serve media through the validated Worker media route.

### Third-Party APIs and Secrets

- Never expose Worker secrets in React code or `VITE_` environment variables.
- Access server-side secrets through the Worker environment, such as `env.GEOAPIFY_API_KEY`.
- Geoapify static maps must be generated server-side.
- MapLibre maps should use the actual DOM ref as the `container` value and clean up with `map.remove()`.
- Nominatim reverse-geocoding requests must include a descriptive `User-Agent` header and should handle network failures gracefully.
- Attribute OpenStreetMap data and respect external service usage policies.

## Current State and Limitations

- The Feed and report creation flow use the Worker API with D1 and R2.
- Dashboard metrics and ticket records are still demo or in-memory data unless explicitly migrated.
- Clerk authentication UI and server-side token verification are present for report creation. Keep `CLERK_JWT_KEY` or `CLERK_SECRET_KEY` in Worker secrets and derive `author_id` from verified claims.
- The local `mock-user-local` fallback requires `ALLOW_LOCAL_MOCK_AUTH=true` and the `X-Local-Mock-Auth: true` header; never enable it in production.
- Search, voting, comments, and persistent ticket workflows may be incomplete; inspect the current implementation before extending them.
- Local development uses Wrangler/Vite bindings and local D1/R2 state. Remote migrations and deployments require deliberate confirmation.

## Common Commands

```powershell
npm run dev
npm run lint
npm run build
npm run preview
npm run deploy
```

Local D1 commands:

```powershell
npx wrangler d1 migrations apply road-map-db --local
npx wrangler d1 execute road-map-db --local --command "SELECT name FROM sqlite_master WHERE type = 'table'"
```

Cloudflare resource commands:

```powershell
npx wrangler r2 bucket list
npx wrangler r2 bucket create road-map-media
npx wrangler secret put GEOAPIFY_API_KEY
npx wrangler secret put CLERK_JWT_KEY
```

Use `--remote` only when explicitly authorized. Never print or commit secret values. Before finishing a change, run at least `npm run lint` and `npm run build`, plus focused D1/API checks when backend behavior changes.

### User Backfill Runbook

After deploying migration `015_users.sql` to production, populate the `users` table for existing authors:

1. Ensure `CLERK_SECRET_KEY` is available in your shell environment or `.dev.vars` (never commit it).
2. Dry-run first to verify counts: `npm run backfill:users`
3. Apply with explicit authorization: `npm run backfill:users -- --execute`
4. Reconcile by running the dry-run again — it should report zero new inserts.

The script uses `INSERT OR IGNORE` so it is fully idempotent. Authors whose Clerk accounts no longer exist are intentionally skipped.

### Author ID Foreign Key Decision

Physical foreign keys from `reports.author_id` and `comments.author_id` to `users.id` are intentionally **not** added. Rationale:

- SQLite cannot add a FK to an existing table without a full create-copy-drop-rename rebuild.
- D1/workerd enforces FKs during `DROP TABLE` even with `PRAGMA foreign_keys = OFF` (documented in migration `012_archive_and_drop_closed.sql`), making a `reports` rebuild unsafe locally.
- A rebuild of `reports` would cascade to `report_images`, `report_votes`, `comments`, and `notifications` due to their FK dependencies.
- Soft-deleted users (`deleted_at IS NOT NULL`) and mock auth (`mock-user-local`) have no `users` row, which would violate a physical FK.
- The existing indexes `idx_reports_author_id` and `idx_comments_author_id` provide query performance.
- Referential integrity is enforced at the application layer: all user-facing queries use `LEFT JOIN users u ON u.id = r.author_id AND u.deleted_at IS NULL`.

This matches the precedent established by `report_votes.user_id`, `notifications.user_id`, and `chat_messages.user_id` (migration `013_chat_history.sql`).

### Denormalized Author Columns — Removed

The `author_name` and `author_image_url` columns on `reports` and `comments` have been physically removed (migration `017_drop_denormalized_author_columns.sql`). All author display data is now resolved exclusively via `LEFT JOIN users u ON u.id = r.author_id AND u.deleted_at IS NULL`. Do not reference these columns in any query, INSERT, or UPDATE statement.
