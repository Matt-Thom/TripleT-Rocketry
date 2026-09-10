# Project: TripleT-Rocketry Usability & Domain Refinements

## Architecture
- **Runtime**: Cloudflare Workers (Node.js compatibility mode, target ES2022).
- **Web Framework**: Hono 4.13 with Hono HTML template literal rendering (`import { html } from 'hono/html'`).
- **Database & ORM**: Cloudflare D1 SQLite database with Drizzle ORM (`drizzle-orm`, `drizzle-kit`).
- **Frontend / Styling**: Server-rendered HTML with Tailwind CSS and HTMX 2.0.4.
- **Testing**: Vitest 4.1 executing in Miniflare `workerd` isolate against local in-memory D1 (`@cloudflare/vitest-pool-workers`).
- **Dual Track Strategy**:
  - **Implementation Track**: Milestones M1, M2, M3 implement features sequentially.
  - **Verification Track**: Milestone M4 ensures 100% Vitest pass, clean TypeScript typecheck, adversarial stress-testing, and forensic integrity audit.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | R1.1 Past Event Visibility | Distinct sections/tabs on `/events` ("Upcoming Launches" and "Past Launch Meets / Archive") with date status badges. | M1 | ORIGINAL_REQUEST §R1 |
| 2 | R1.2 Event Editing Workflow | `GET /events/:id/edit`, `POST /events/:id/edit`, `PUT /events/:id`, with "✏️ Edit Event" buttons in detail and card views. | M1 | ORIGINAL_REQUEST §R1 |
| 3 | R1.3 Flight Event Selectability | All past & upcoming events formatted as `${name} (${date}) — ${site}` in flight form event dropdown. | M1 | ORIGINAL_REQUEST §R1 |
| 4 | R2.1 Dual Peak Altitude Units | Side-by-side inputs for meters and feet (half-width) with real-time bi-directional calculation and dual unit detail display. | M2 | ORIGINAL_REQUEST §R2 |
| 5 | R2.2 Pure Text Duty Officers | Remove registered user dropdown linking; provide direct text inputs (`rso_name`, `lco_name`) on flight form. | M2 | ORIGINAL_REQUEST §R2 |
| 6 | R2.3 Flight Log Type | Selectable toggle between Preflight Simulation / Planned and Post-Flight Actuals (`preflight` vs `actual`) with visual badges. | M2 | ORIGINAL_REQUEST §R2 |
| 7 | R2.4 Unified Motor Selection | Consolidate catalog motor and stock item inputs into single unified selector with stock badge and auto inventory linking. | M2 | ORIGINAL_REQUEST §R2 |
| 8 | R3.1 Motor Casing in Catalog Views | Prominently display `motor.hardware` in motor detail view (header & specs card) and catalog list; support casing search. | M3 | ORIGINAL_REQUEST §R3 |
| 9 | R3.2 Motor Casing in Inventory & Flights | Project `hardware` in inventory queries; render casing on inventory cards and flight Propulsion Metrics summary. | M3 | ORIGINAL_REQUEST §R3 |
| 10 | R3.3 Motor Casing CSV Import & Data Integrity | Ensure motor CSV import and catalog data reliably store and display hardware casing specifications. | M3 | ORIGINAL_REQUEST §R3 |
| 11 | R4.1 Automated Testing & Verification | Comprehensive unit/integration tests for R1-R3, 100% Vitest pass against local D1, clean typecheck, adversarial tests, and clean audit. | M4 | ORIGINAL_REQUEST §R4 |

## Milestones
| # | Name | Scope | Dependencies | Status | Outputs |
|---|------|-------|-------------|--------|---------|
| M1 | Launch Events Usability & Full Editing (R1) | Past event visibility sections/tabs, `/events/:id/edit` routes & form, Edit Event buttons, flight event dropdown formatting | none | DONE | `src/routes/events.ts`, `src/views/events.ts`, `src/routes/flights.ts`, `src/views/flights.ts`, `test/integration/events.test.ts`, `test/integration/challenger_m1_events_adversarial.test.ts`, `test/integration/challenger_m1_2_events_adversarial.test.ts` (Gate PASSED) |
| M2 | Flight Logbook Usability (R2) | Dual altitude units (bi-directional JS sync), pure text duty officers, flight log type (`preflight`/`actual` schema & UI badges), unified motor selector with stock linkage | M1 | DONE | `src/db/schema.ts`, `migrations/0004_add_flight_log_type.sql`, `src/routes/flights.ts`, `src/views/flights.ts`, `test/helpers/db.ts`, `test/integration/flights.test.ts`, `test/integration/challenger_m2_altitude_and_duty_officers.test.ts`, `test/integration/challenger_m2_flight_stage_and_motor_stock.test.ts` (Gate PASSED) |
| M3 | Reload Motor Casings & Hardware Tracking (R3) | Display required casing in catalog details/table, inventory queries & cards, flight summary metrics, search parameter aliasing, and CSV import integrity | M2 | DONE | `src/routes/inventory.ts`, `src/views/inventory.ts`, `src/routes/motors.ts`, `src/views/motors.ts`, `src/views/flights.ts`, `test/integration/motors.test.ts`, `test/integration/challenger_m3_casing_search_and_display.test.ts`, `test/integration/challenger_m3_casing_inventory_and_csv.test.ts` (Gate PASSED) |
| M4 | Automated Testing, Hardening & Audit (R4) | End-to-end regression & new integration tests, 100% Vitest pass against local D1, 0 typecheck errors, adversarial challenger verification, forensic integrity audit | M1, M2, M3 | DONE | `test/integration/refinements_r1_r4_e2e.test.ts` (28 tests), 1,148 repository tests passed 100%, 0 typecheck errors, audit verdict CLEAN (Gate PASSED) |

## Interface Contracts

### M1: Launch Events Refinements (COMPLETED & VERIFIED)
- `GET /events`: Partition list into upcoming and past events using `(endsOn ?? startsOn) < today`. Render top-level tabs (`Upcoming`, `Past Meets / Archive`, `All`) and distinct sections with date badges (`Upcoming`, `Active Today`, `Past Meet`).
- `GET /events/:id/edit`: Render edit form pre-populated with current event attributes (name, host site, dates, pad count, launch director, tripoli prefect, notes).
- `POST /events/:id/edit` & `PUT /events/:id`: Accept form data and JSON updates, sanitize officer IDs, update SQLite record, and redirect with 303 to `/events/:id`.
- `views/events.ts`: Add "✏️ Edit Event" buttons in `eventDetailView` header and `eventsListView` event cards.
- `flights.ts` & `views/flights.ts`: Query `launchEvents` left joined with `launchSites` selecting `name`, `startsOn`, `siteName`. Format options as `${e.name} (${dateText}) — ${siteName}`. All past and upcoming events selectable.

### M2: Flight Logbook Usability (COMPLETED & VERIFIED)
- `src/db/schema.ts`:
  - `export const FLIGHT_LOG_TYPE = ['preflight', 'actual'] as const;`
  - `logType: text('log_type').notNull().default('actual'),`
- `migrations/0004_add_flight_log_type.sql`:
  - `ALTER TABLE flights ADD log_type text DEFAULT 'actual' NOT NULL;`
- Peak Altitude:
  - Form grid: `#altitude_agl_m` and `#altitude_agl_ft` (half-width, side-by-side).
  - Client JS sync: `m = ft * 0.3048`, `ft = m * 3.28084` with precision formatting (`.toFixed(1)`) and native `change` event dispatch on `#altitude_agl_m` for HTMX soft-gate check (`/flights/preflight-check`).
  - Canonical persistence: SQLite `altitude_agl_m` (REAL).
  - Detail view: Render `${m} m (${ft} ft)`.
- Pure Text Duty Officers:
  - Form: Removed user dropdowns `<select name="rso_user_id">` and `<select name="lco_user_id">`.
  - Provided text inputs `#rso_name` and `#lco_name`.
  - Routes: Persist `rsoName` and `lcoName` directly without requiring user FK lookup.
- Flight Log Type:
  - Form: Selectable toggle between Preflight Simulation / Planned (`preflight`) and Post-Flight Actuals (`actual`).
  - List & Detail Views: Visual badges (`📋 Planned / Sim` vs `🚀 Actual Flight`).
- Unified Motor Selector:
  - Single `<select name="motor_id">` with stock badges `— [In Stock: N]`.
  - Live on-hand stock status indicator card.
  - Backend auto-linking: if `logType === 'actual'` and user has inventory for the selected motor, link and decrement inventory atomically; if `preflight`, preserve inventory; if no inventory, clean fallback to catalog model.

### M3: Motor Casings & Hardware Tracking (COMPLETED & VERIFIED)
- `src/routes/inventory.ts`: Select `hardware: schema.motors.hardware` in `listInventoryHandler` join projection.
- `src/views/motors.ts`:
  - Display `motor.hardware` badge in `motorDetailView` banner and physical specs card.
  - Display casing in `motorCatalogView` table row.
  - Add `hardware` to `data-search` and backend search query (aliasing `q`, `search`, `query`).
- `src/views/inventory.ts`: Display required casing on inventory cards and row fragments.
- `src/views/flights.ts`: Display required casing in Card 3 ("Propulsion Metrics" / flight motor summary) with clean typing.
- Motor CSV Import: Verified column 5 parsing into `motors.hardware` intact.

## Code Layout
- `src/routes/events.ts` & `src/views/events.ts` — Event routes and view rendering (Owned by M1 - COMPLETED).
- `src/routes/flights.ts` & `src/views/flights.ts` — Flight log routes and view rendering (Owned by M2 - COMPLETED).
- `src/db/schema.ts` & `migrations/` — Database schema & migrations (Owned by M2 for `log_type` - COMPLETED).
- `src/routes/motors.ts` & `src/views/motors.ts` — Motor catalog routes and views (Owned by M3 - COMPLETED).
- `src/routes/inventory.ts` & `src/views/inventory.ts` — Inventory routes and views (Owned by M3 - COMPLETED).
- `test/` — Unit, integration, and adversarial tests (Owned by M4).
