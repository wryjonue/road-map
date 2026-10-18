# RoadMap Product Roadmap

## Product Goal

RoadMap is a community road-incident reporting system for hazards such as accidents, roadworks, traffic disruptions, and flooding. It combines public reports and map-based discovery with authority workflows, including report resolution and traffic-violation ticketing.

The roadmap prioritizes trustworthy role-based access before authority-only workflows. Public users should be able to submit and follow reports; authorized staff should be able to moderate reports, manage resolution, and issue tickets. Dashboards and AI features should be built on persisted, permission-checked data rather than demo-only state.

## Status Legend

- `[x]` Reported complete in the supplied checklist or implemented in the current branch; implementation updates are summarized below.
- `[~]` Partially complete; remaining work is described in the relevant section.
- `[ ]` Not complete or not yet confirmed.

## Implementation Update - RBAC And Report Resolution

Implemented in the current branch:

- Clerk's verified top-level `role` claim supports exactly `user`, `authority`, and `admin`. Missing/unknown roles and local mock auth use least-privileged `user`; role assignment remains in the Clerk Dashboard.
- `user` cannot see the Tickets navigation or Home entry point, and direct access to `/tickets` redirects to Home. `authority` and `admin` can access the mock ticket page.
- New reports are assigned `Pending` by the Worker regardless of client-supplied status.
- Pending reports are omitted from regular/anonymous report lists. Authors can read their own pending report and media directly; authority/admin can read all pending reports. Pending media uses private, no-store caching.
- Authority/admin can resolve reports through `PATCH /api/reports/{id}/status`. Resolution records the verified actor and timestamps; the endpoint does not expose general status editing or deletion.
- Nine focused API tests cover role normalization, visibility, media access, resolution, mock-auth denial, malformed authorization, and server-controlled creation status.

Still incomplete: map report pins, persistent ticket records/API, ticket-to-report relationships, and the other backlog items below. The ticket page remains mock data; route gating does not make bundled mock records confidential.

## Current Status

### Authentication - 100%

- `[x]` Log in
- `[x]` Register
- `[x]` Log out
- `[x]` Email verification

### User Profile - 100%

- `[x]` Basic profile
- `[x]` Edit profile
- `[x]` Role-Based Access Control - High Priority


### Report Feed

- `[x]` Report post cards
- `[x]` Authority/admin can resolve a report from the feed; Worker validates the role and records resolution metadata
- `[x]` Filter reports
- `[x]` Comments
- `[x]` Upvote reports
- `[x]` Upvote reports
- `[ ]` Semantic Search Bar

### Create Report - 100%

- `[x]` Basic report details
- `[x]` Location/geographic information
- `[x]` Static map creation
- `[x]` Media upload to object storage
- `[x]` Submit report to backend
- `[x]` Persist report in the database
- `[x]` New reports receive server-controlled `Pending` status

### Map View - 100%

- `[x]` Base map view
- `[x]` Report Routes Display
- `[x]` Proximity Tracking
- `[x]` Filter visible reports
- `[x]` Report Clusters/Hostpot

### Dashboard

- `[x]` Live numbers/metrics
- `[x]` Charts
- `[x]` Data tables
- `[ ]` AI-generated summary
- `[x]` Export CSV

### AI Page
- `[ ]` Gemini API Integration
- `[x]` Function Calls
- `[x]` 


### Cross-Cutting and AI

- `[x]` Role-based route/navigation gating and Worker enforcement for Pending visibility and report resolution; role assignment remains Clerk Dashboard-only
- `[~]` AI-based report moderation — auto-approve/auto-reject with confidence scoring and manual review fallback implemented; admin override and appeal workflow pending

## Proposed Delivery Order

### P0 - Roles and Access Control

**Status: Complete for the currently defined role and report workflow scope.** The role source, role set, ticket-page access, pending visibility, and report resolution are implemented as summarized above. Role changes remain outside the application and are performed in Clerk Dashboard.

The current role model is `user`, `authority`, and `admin`. Frontend guards control presentation and navigation; the Worker remains the security boundary.

Scope:

- `[x]` Read the role from the verified top-level Clerk session claim; normalize missing/unknown roles to `user`.
- `[x]` Keep role assignment out of app UI/API; use the Clerk Dashboard.
- `[x]` Hide and route-protect the mock Tickets page for `user`; allow `authority` and `admin`.
- `[x]` Enforce report read visibility and status resolution in the Worker, independent of frontend controls.
- `[x]` Fail closed for malformed supplied authorization and prevent mock-auth elevation.
- `[ ]` Add any future authorization scope such as agency/district boundaries when that policy is defined.

Acceptance criteria:

- The implemented capability matrix is documented in the implementation update above; persistent ticket API permissions remain pending.
- Focused tests cover role normalization, pending access, report resolution, and mock-auth denial.
- Role values are taken from verified Clerk claims, never request data; frontend route/action hiding is backed by Worker checks.
- Clerk Dashboard assignment and session refresh behavior should be verified with real authority/admin accounts before production rollout.

### P1 - Authority Report Workflow and Map Pins

**Status: Report status resolution is implemented. Map pins remain open.**

Scope:

- `[x]` For this release, the status action is limited to `Resolved`; only authority/admin may perform it.
- `[x]` Add a feed action for authorized status updates and show persisted status on the card.
- `[x]` Persist `updated_at`, `resolved_at`, and `resolved_by` on resolution.
- Render report pins from persisted report coordinates; show a useful summary when a pin is selected.
- Keep map results consistent with feed visibility rules and report permissions.

Acceptance criteria:

- Invalid status transitions and unauthorized changes are rejected by the backend.
- A successful status update persists, is reflected in feed/map views, and records the actor and timestamp where required.
- Reports with missing or invalid coordinates do not break the map.
- Pins open the correct report and remain usable on narrow screens and with keyboard navigation.

### P1 - Persistent Ticketing and Report Relationship

**Status: Not implemented.** Only client-side route gating is present; the current records and actions remain mock/in-memory.

Replace the current mock/in-memory ticket workflow with a backend-backed authority workflow. Decide the relationship before creating the schema: a ticket may reference a report when one exists, but standalone violations may also need to be supported.

Scope:

- Define ticket ownership, identifiers, required fields, valid statuses, and audit history.
- Decide whether ticket creation requires a linked report, permits an optional report link, or is independent.
- Add database migrations and authenticated/authorized API operations for listing, issuing, and updating tickets.
- Replace browser-only state and fixture data with API-backed loading, empty, error, and success states.
- Ensure public users cannot access private enforcement data unless policy explicitly permits it.

Acceptance criteria:

- Ticket creation and updates survive reloads and are stored in the database.
- Unauthorized users cannot issue tickets or change enforcement status, even by calling the API directly.
- Ticket/report relationships are validated and do not create orphaned or mismatched records.
- Ticket actions and state transitions are auditable and presented consistently in the UI.

### P2 - Feed and Map Discovery

Scope:

- Add filters for useful report attributes such as status, category, and location/date where supported by the data model.
- Apply compatible filters to both feed and map; keep query parameters shareable when appropriate.
- Add report upvotes with one-vote-per-user behavior, backend validation, and persistent counts.
- Add report blobs/clusters at low priority after pins work and map density is measured.
- Add comments last in this group, respecting the supplied lowest-priority label; define moderation, deletion, and abuse-reporting rules before launch.

Acceptance criteria:

- Filters compose predictably, have clear empty states, and do not expose reports a user is not allowed to see.
- Vote counts are derived from persisted data and cannot be inflated through repeated or forged requests.
- Map pins/clusters represent the filtered result set and remain usable at different zoom levels.
- Comments have clear ownership and moderation behavior before they become publicly writable.

### P2 - Operational Dashboard and Export

Build metrics from persisted reports and tickets after their status models are stable.

Scope:

- Define metric names, formulas, date ranges, and access rules with the intended operational users.
- Replace placeholder numbers with database-backed aggregates.
- Add charts and tables with loading, empty, and error states; keep tabular data available to assistive technology.
- Add export for the same authorized, filtered dataset shown in the dashboard, initially as CSV unless another format is required.
- Defer AI summary until the underlying metrics are trusted and the summary can cite its reporting period and source data.

Acceptance criteria:

- Dashboard values are reproducible from documented queries/formulas and match the selected time/filter scope.
- Access checks apply to both dashboard endpoints and exported data.
- Exported columns and time range are explicit; exports do not include fields the current user is not allowed to see.
- The dashboard remains usable on desktop and mobile and communicates stale or unavailable data clearly.

### P3 - AI Moderation and Summaries

Treat AI as an assistive capability, not the authorization or final enforcement authority.

**Status: Auto-approve/auto-reject implemented with external Render service.**

Implemented:
- `[x]` Gemini multimodal moderation (`gemini-3.5-flash-lite`) runs fire-and-forget after report creation
- `[x]` Confidence thresholds: ≥ 0.80 auto-approves or auto-rejects; below triggers manual review flag
- `[x]` User-uploaded images analyzed; static maps excluded
- `[x]` AI verdict, confidence, reason, and timestamp persisted on `reports` (migration `018`)
- `[x]` Notifications sent for auto-approved, auto-rejected, and needs-review outcomes via NotificationHub DO
- `[x]` System comments record AI decisions with confidence percentage
- `[x]` Failures default to `Pending`; never block report creation or silently discard reports
- `[x]` External Render AI service with HMAC-SHA256 signed webhooks (production only)
- `[x]` Replay-window protection (5-minute timestamp validation) on both Worker and Render endpoints
- `[x]` Retry with exponential backoff on Worker→Render dispatch and Render→Worker callback
- `[x]` Local dev fallback: in-worker moderation when `RENDER_AI_SERVICE_URL` is not set
- `[x]` Integration test script (`scripts/test-ai-moderation.mjs`)

Remaining:
- `[ ]` Admin dashboard view for reviewing AI-flagged reports and overriding decisions
- `[ ]` User appeal/correction workflow for AI-rejected reports
- `[ ]` Dashboard AI summaries grounded in authorized aggregate data
- `[ ]` Privacy notice and data retention policy for AI-processed content

#### AI Moderation Production Deployment Runbook

1. **Set Cloudflare Worker secrets:**
   ```powershell
   wrangler secret put AI_WEBHOOK_SECRET       # value: technoblade-never-dies
   wrangler secret put RENDER_AI_SERVICE_URL    # value: https://<render-app>.onrender.com/moderate
   ```

2. **Set Render environment variables:**
   - `GEMINI_API_KEY` — Google AI Studio API key
   - `AI_WEBHOOK_SECRET` — must match Cloudflare secret exactly
   - `WORKER_WEBHOOK_URL` — `https://<worker-domain>/api/webhooks/ai-moderation`
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` — R2 read-only credentials

3. **Deploy Render service:** Push `render-ai-service/` directory to connected repo or deploy manually.

4. **Verify:** Run `node scripts/test-ai-moderation.mjs --execute` with appropriate env vars to confirm end-to-end flow.

5. **Monitor:** Check Render logs for `[render]` prefixed entries and Worker logs for `[webhook]` / `[report]` entries. Failed retries are logged at error level.

Acceptance criteria:

- AI errors or timeouts do not prevent core report submission or authorized manual review.
- Moderation decisions can be reviewed and corrected by an authorized person.
- AI summaries cannot access data beyond the requesting user's permissions and identify the data period they summarize.
- Privacy, retention, and user-notice requirements are documented before enabling AI processing.

## Next Planned Work: Map And Ticket Workflows

The role foundation is in place. Recommended next slices are:

1. Implement map report pins using the existing role-filtered report API; preserve the same pending visibility rules as the feed.
2. Design and implement the persistent ticket API. First decide whether a ticket must link to a report, may link optionally, or is independent; then add D1 schema/migrations, role-checked Worker endpoints, and replace the mock UI state.
3. Add dashboard metrics only after report/ticket statuses and persisted data are stable.

## Open Decisions

- Are authority staff scoped to a city, district, or agency, or do all authority users share one scope?
- Can tickets exist without a related report? Can a report have multiple tickets?
- Which reports and ticket fields are public, private, or visible only to authority users?
- Which filters and dashboard metrics are required for the first operational release?
- What moderation actions should AI recommend, and which actions always require a human decision?

## Engineering Guardrails

- Keep database changes in sequential migrations; preserve existing records.
- Enforce authorization in Worker handlers; frontend gating is supplementary only.
- Use parameterized database queries and validate all IDs, status transitions, and user-supplied filters.
- Keep API errors consistent with the existing `{ "error": "message" }` response shape.
- Keep secrets server-side and media in private object storage, served through validated routes.
- Add focused tests for role boundaries, state transitions, data visibility, and failure paths as each workflow is implemented.
