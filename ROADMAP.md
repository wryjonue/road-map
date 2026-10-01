# RoadMap Product Roadmap

## Product Goal

RoadMap is a community road-incident reporting system for hazards such as accidents, roadworks, traffic disruptions, and flooding. It combines public reports and map-based discovery with authority workflows, including report resolution and traffic-violation ticketing.

The roadmap prioritizes trustworthy role-based access before authority-only workflows. Public users should be able to submit and follow reports; authorized staff should be able to moderate reports, manage resolution, and issue tickets. Dashboards and AI features should be built on persisted, permission-checked data rather than demo-only state.

## Status Legend

- `[x]` Reported complete in the supplied checklist; not independently audited by this document.
- `[~]` Partially complete, as reported.
- `[ ]` Not complete or not yet confirmed.

## Current Status

### Authentication - Reported 100%

- `[x]` Log in
- `[x]` Register
- `[x]` Log out
- `[x]` Email verification

### User Profile - Reported 70%

- `[x]` Basic profile
- `[x]` Edit profile
- `[ ]` Roles - Highest priority

### Report Feed

- `[x]` Report post cards
- `[ ]` Update report status
- `[ ]` Filter reports
- `[ ]` Comments - Lowest priority
- `[ ]` Upvote reports

### Create Report - Reported 100%

- `[x]` Basic report details
- `[x]` Location/geographic information
- `[x]` Static map creation
- `[x]` Media upload to object storage
- `[x]` Submit report to backend
- `[x]` Persist report in the database

### Map View

- `[x]` Base map view
- `[ ]` Report pins - Medium priority
- `[ ]` Filter visible reports
- `[ ]` Report blobs/clusters - Low priority

### Ticketing System

- `[ ]` Replace view-only/mock data with persisted ticket records
- `[ ]` Define how tickets relate to reports, incidents, and authority users
- `[ ]` Add authorized ticket creation and status workflows

### Dashboard

- `[ ]` Live numbers/metrics
- `[ ]` Charts
- `[ ]` Data tables
- `[ ]` AI-generated summary
- `[ ]` Export data

### Cross-Cutting and AI

- `[ ]` Sitewide role-based access control - Highest priority
- `[ ]` AI-based report moderation

## Proposed Delivery Order

### P0 - Roles and Access Control

Establish the authorization foundation before implementing authority-only tools. Confirm the role model and permission matrix first; role names below are examples to decide, not an assumed final design.

Scope:

- Define supported roles, such as community member, authority staff, and administrator, and document what each can view and change.
- Decide how roles are granted, changed, and revoked. Elevated access must not be self-assigned by an ordinary user.
- Store the authoritative role assignment in a trusted server-side source. Do not treat hidden buttons, route guards, user-editable profile fields, or unsigned client claims as authorization.
- Enforce permissions in Worker/API handlers for every protected operation. Add matching route, navigation, and action visibility in the frontend for usability.
- Define default behavior for new users, missing role data, revoked access, and unavailable authorization data. Protected operations must fail closed.
- Add migration/backfill strategy if role assignments require database changes, without resetting existing user or report data.

Acceptance criteria:

- A documented role-to-capability matrix covers report moderation/resolution, ticket workflows, profile access, and administrative actions.
- Tests prove allowed and denied behavior for each protected API operation, including unauthenticated users and users with the wrong role.
- A user cannot gain elevated access by changing browser state or submitting a forged role value.
- The frontend does not show unavailable authority actions to unauthorized users, while the server remains the enforcement boundary.
- Role changes take effect predictably and are attributable to an authorized actor.

### P1 - Authority Report Workflow and Map Pins

Build on P0 so status changes and authority capabilities are permission-checked from the start.

Scope:

- Define report statuses and valid transitions, including who may perform each transition and whether a reason or audit event is required.
- Add feed controls for authorized status updates and show the current status consistently in cards and report details.
- Render report pins from persisted report coordinates; show a useful summary when a pin is selected.
- Keep map results consistent with feed visibility rules and report permissions.

Acceptance criteria:

- Invalid status transitions and unauthorized changes are rejected by the backend.
- A successful status update persists, is reflected in feed/map views, and records the actor and timestamp where required.
- Reports with missing or invalid coordinates do not break the map.
- Pins open the correct report and remain usable on narrow screens and with keyboard navigation.

### P1 - Persistent Ticketing and Report Relationship

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

Scope:

- For report moderation, define acceptable use, data handling, confidence thresholds, human review, correction/appeal, and failure behavior before model integration.
- Keep uncertain moderation outcomes in a review queue; do not silently discard valid public reports.
- For dashboard summaries, ground output in authorized aggregate data, include the covered period, and handle unavailable or contradictory data without fabricating claims.
- Record model/version and moderation decisions as appropriate for auditability and privacy policy.

Acceptance criteria:

- AI errors or timeouts do not prevent core report submission or authorized manual review.
- Moderation decisions can be reviewed and corrected by an authorized person.
- AI summaries cannot access data beyond the requesting user's permissions and identify the data period they summarize.
- Privacy, retention, and user-notice requirements are documented before enabling AI processing.

## Next Planned Work: Role System

The next implementation request should begin with a short role-design decision: role names, permission matrix, role assignment authority, and whether roles live in application-managed data or trusted identity claims. Then implement the server-side role source and API enforcement first, add migrations if needed, and finally wire frontend route/action visibility. Do not implement the rest of P0 until the role policy is agreed.

## Open Decisions

- What are the exact roles, and which role can grant or revoke each one?
- Are authority staff scoped to a city, district, or agency, or do all authority users share one scope?
- Are report status changes restricted to authority staff, or can report authors withdraw/edit their own reports?
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
