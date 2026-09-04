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
- Treat `author_id` as the stable Clerk identity; do not use display names as identity.
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
- Clerk authentication UI is present, but server-side API token verification and authorization must be added before treating client identity fields as trusted.
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
```

Use `--remote` only when explicitly authorized. Never print or commit secret values. Before finishing a change, run at least `npm run lint` and `npm run build`, plus focused D1/API checks when backend behavior changes.
