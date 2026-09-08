# Project: TripleT-Rocketry Functional Refinements

## Architecture
- **Runtime**: Cloudflare Workers (Node.js compatibility mode, target ES2022).
- **Web Framework**: Hono 4.13 with Hono HTML template literal rendering (`import { html } from 'hono/html'`).
- **Database & ORM**: Cloudflare D1 SQLite database with Drizzle ORM (`drizzle-orm`, `drizzle-kit`).
- **Frontend / Styling**: Server-rendered HTML with Tailwind CSS and HTMX 2.0.4.
- **Testing**: Vitest 4.1 executing in Miniflare `workerd` isolate against local in-memory D1 (`@cloudflare/vitest-pool-workers`).
- **Dual Track Strategy**:
  - **Implementation Track**: Milestones M1 through M6 build schema, routes, and views, culminating in M7 (100% E2E test pass + adversarial hardening).
  - **E2E Testing Track**: Dispatched in parallel, independently designs opaque-box test suites (Tiers 1-4) derived strictly from user requirements, publishing `TEST_READY.md`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | R1.1 Desktop & Mobile Nav Admin Guard | Restrict Admin link in top and mobile nav exclusively to `user?.role === 'admin'`. | M2 | ORIGINAL_REQUEST §R1 |
| 2 | R1.2 Dashboard Admin Card Guard | Ensure non-admin flyers cannot see any administrative dashboard card/widget. | M2 | ORIGINAL_REQUEST §R1 |
| 3 | R1.3 Administrative Route Guarding | Directly requesting `/admin` as non-admin returns HTTP 403 with user-friendly error page. | M2 | ORIGINAL_REQUEST §R1 |
| 4 | R2.1 Searchable Motor Filter | Fast responsive client-side filter on motor model (designation, manufacturer, diameter) in `/flights/new` and `/flights/:id/edit`. | M3 | ORIGINAL_REQUEST §R2 |
| 5 | R2.2 Flight Edit Route | Implement `GET /flights/:id/edit` and `POST /flights/:id/edit` for editing existing flight logs. | M3 | ORIGINAL_REQUEST §R2 |
| 6 | R2.3 Flight-Level Duty Officers | Capture and display active RSO and LCO on individual flight records (`schema.flights`). | M1, M3 | ORIGINAL_REQUEST §R2 |
| 7 | R3.1 Launch Director & Tripoli Prefect | Add dedicated Launch Director and Tripoli Prefect fields to `launch_events`, event forms, and event detail views. | M1, M2 | ORIGINAL_REQUEST §R3 |
| 8 | R3.2 Event Creation Resilience | Ensure `POST /events` reliably accepts past dates and optional officer fields without 500 errors or FK failures. | M2 | ORIGINAL_REQUEST §R3 |
| 9 | R4.1 Zero-Quantity Motor Archiving | Allow dismissing zero-quantity motors from active inventory via soft delete (`deletedAt`), preserving chain-of-custody ledger. | M4 | ORIGINAL_REQUEST §R4 |
| 10 | R4.2 Storage Sites Management | Dedicated Storage Sites CRUD section (`/inventory/storage-sites`) for physical storage locations and magazines. | M1, M4 | ORIGINAL_REQUEST §R4 |
| 11 | R4.3 SafeWork SA Storage Permit Compliance | Dynamically require and display regulatory permit / storage license when propellant capacity exceeds 3.0 kg. | M4 | ORIGINAL_REQUEST §R4 |
| 12 | R5.1 Self-Service Passkey Enrollment | Make WebAuthn passkey registration accessible directly in user profile settings. | M5 | ORIGINAL_REQUEST §R5 |
| 13 | R5.2 Dedicated User Profile Screen | Dedicated `/profile` screen allowing users to view and update profile details distinct from admin panel. | M5 | ORIGINAL_REQUEST §R5 |
| 14 | R5.3 Expanded Rocketry Certifications | Support TRA, ARA, and NAR rocketry certifications across levels 0–3 with cert numbers and expiry dates. | M1, M5 | ORIGINAL_REQUEST §R5 |
| 15 | R5.4 Multi-Club Membership Tracking | Track multiple club affiliations (VRA, SARC, Tripoli, ARA) and membership numbers (`club_memberships`). | M1, M5 | ORIGINAL_REQUEST §R5 |
| 16 | R6.1 Rocket Airframe Dimensions Schema | Extend `rockets` and `rocketConfigurations` data models with Length (`length_mm`) and Body Diameter (`body_diameter_mm`). | M1, M6 | ORIGINAL_REQUEST §R6 |
| 17 | R6.2 Airframe Geometry in Forms & Views | Incorporate length and body diameter into rocket forms, configuration editors, detail cards, and preflight checks. | M6 | ORIGINAL_REQUEST §R6 |
| 18 | R7.1 Automated Testing & Verification | Comprehensive unit/integration tests for R1–R6, migration generation, clean typecheck, and 100% test pass. | M7, E2E | ORIGINAL_REQUEST §R7 |

## Milestones
| # | Name | Scope | Dependencies | Status | Outputs |
|---|------|-------|-------------|--------|---------|
| M1 | Schema & Migration Foundation | Add columns/tables for R2, R3, R4, R5, R6 in `schema.ts`, generate `0003_...sql`, update test helpers | none | DONE | `schema.ts`, `migrations/0003_cloudy_hawkeye.sql`, `test/schema.test.ts`, `test/helpers/db.ts` (Gate PASSED) |
| M2 | Admin RBAC & Launch Event Resilience (R1, R3) | Admin nav/dashboard guarding, `/admin` 403 enforcement, Launch Director & Tripoli Prefect, event creation resilience | M1 | DONE | `src/middleware/auth.ts`, `src/routes/events.ts`, `src/views/events.ts` (Gate PASSED) |
| M3 | Flight Logbook Usability & Duty Officers (R2) | Searchable motor filter, `GET/POST /flights/:id/edit`, flight-level RSO & LCO | M1 | DONE | `src/routes/flights.ts`, `src/views/flights.ts`, `test/helpers/db.ts` (Gate PASSED) |
| M4 | Inventory Archiving & Storage Sites (R4) | 0-qty motor dismissal (soft delete), `/inventory/storage-sites` CRUD, SafeWork SA >3kg compliance | M1 | DONE | `src/routes/inventory.ts`, `src/views/inventory.ts`, `src/views/storage_sites.ts`, `src/views/motors.ts` (Gate PASSED) |
| M5 | User Profile & Multi-Club Tracking (R5) | Dedicated `/profile` route, self-service passkeys, certifications (ARA/0-3), multi-club memberships | M1 | DONE | `src/routes/profile.ts`, `src/views/profile.ts`, `src/index.ts`, `src/views/layout.ts`, `src/db/context.ts` (Gate PASSED) |
| M6 | Rocket Airframe Geometry (R6) | Rocket forms & configuration editors, detail views, and preflight safety checks with length & body diameter | M1 | DONE | `src/routes/rockets.ts`, `src/views/rockets.ts`, `src/routes/flights.ts`, `src/views/flights.ts`, `test/challenger_m6_airframe_versioning.test.ts`, `test/challenger_m6_preflight_clearance.test.ts` (Gate PASSED) |
| M7 | Final Milestone: 100% E2E Pass & Adversarial Hardening (R7) | Run full E2E test suite (Tiers 1-4), fix issues, adversarial coverage hardening (Tier 5), forensic audit clean | M2, M3, M4, M5, M6, E2E | READY_FOR_AUDIT | `test/integration/e2e_requirements.test.ts` (71 tests), `test/challenger_m7_security_and_roles.test.ts` (27 tests), `test/challenger_m7_logistics_and_airframe.test.ts` (14 tests) |

## Interface Contracts

### M1 (Database Schema) ↔ All Modules
- `schema.flights`:
  - `rsoUserId: text('rso_user_id').references(() => users.id)` (nullable)
  - `lcoUserId: text('lco_user_id').references(() => users.id)` (nullable)
  - `rsoName: text('rso_name')` (nullable)
  - `lcoName: text('lco_name')` (nullable)
- `schema.launchEvents`:
  - `launchDirector: text('launch_director')` (nullable)
  - `tripoliPrefect: text('tripoli_prefect')` (nullable)
- `schema.storageSites`:
  - `id`: UUID primary key
  - `userId`: text reference to `users.id`
  - `name`: text not null
  - `location`: text
  - `capacityKg`: real not null default 0
  - `permitNumber`: text
  - `notes`: text
  - `...auditColumns`
- `schema.clubMemberships`:
  - `id`: UUID primary key
  - `userId`: text reference to `users.id`
  - `clubName`: text not null
  - `membershipNumber`: text
  - `expiresOn`: text
  - `...auditColumns`
- `schema.certifications`:
  - `certifyingBody`: enum `['NAR', 'TRA', 'ARA']`
  - `level`: integer `[0, 1, 2, 3]`
- `schema.rockets` & `schema.rocketConfigurations`:
  - `lengthMm`: real nullable
  - `bodyDiameterMm`: real nullable

### M2 (Admin & Events)
- `/admin` access check: if `!user || user.role !== 'admin'`, return 403 with `forbiddenView` (or 403 JSON). Unauthenticated cookieless requests redirect with 302 to `/login`.
- `POST /events`: input sanitization checks `rsoUserId` and `lcoUserId` existence against `users`; if invalid/empty, set to `null`. Accepts any date string (past or future). Returns 302/303 redirect to `/events/:id`.

### M3 (Flights)
- Searchable filter: `<input id="motor-search-filter">` client-side JS filtering `<option data-search="...">` within `<select name="motor_id" id="motor_id">`.
- `GET /flights/:id/edit` and `POST /flights/:id/edit`: renders form pre-filled with flight details and updates flight record in D1.
- `flights` duty officers: input and display active RSO and LCO per flight.

### M4 (Inventory & Storage Sites)
- `POST /inventory/:id/dismiss`: checks `quantityOnHand === 0`; sets `deletedAt = Date.now()`. Returns 200 or 303 redirect.
- `/inventory/storage-sites`: full CRUD routes. Enforces `capacityKg > 3.0` requires `permitNumber` (400 validation error if missing).

### M5 (User Profile)
- `GET /profile`: returns HTML with personal info, passkeys enrollment, certifications (ARA/0-3), and club memberships.
- `POST /profile`: updates user profile.
- `POST /profile/clubs` & `POST /profile/clubs/:id/delete`: manages multi-club memberships.
- Passkey WebAuthn: wires client-side JavaScript to `/auth/webauthn/register-options` and `/auth/webauthn/register-verify`.

### M6 (Rockets)
- Forms & views accept and render `length_mm` and `body_diameter_mm`.

## Code Layout
- `src/db/schema.ts` — Core D1 schema definitions and domain enums (Owned exclusively by M1).
- `migrations/` — Drizzle migration files (Owned exclusively by M1).
- `test/schema.test.ts` & `test/helpers/db.ts` — Migration table list & truncation helpers (Owned by M1).
- `src/routes/admin.ts`, `src/routes/events.ts`, `src/views/events.ts` — (Owned by M2).
- `src/routes/flights.ts`, `src/views/flights.ts` — (Owned by M3).
- `src/routes/inventory.ts`, `src/views/inventory.ts` — (Owned by M4).
- `src/routes/profile.ts`, `src/views/profile.ts` — (Owned by M5).
- `src/routes/rockets.ts`, `src/views/rockets.ts` — (Owned by M6).
- `src/views/layout.ts`, `src/views/dashboard.ts` — Navigation and dashboard layout (Owned by M2).
- `test/integration/` — Integration tests (Owned by test writers / M7).
