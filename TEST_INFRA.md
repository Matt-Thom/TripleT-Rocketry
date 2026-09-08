# Test Infrastructure Specification: TripleT-Rocketry E2E Testing Track

## 1. Test Philosophy

TripleT-Rocketry utilizes a strictly **opaque-box, requirement-driven testing approach** for end-to-end and integration verification. The test harness evaluates the system from the external perspective of an HTTP client / flyer interacting with the web application over standard HTTP protocols (GET/POST, HTML form submissions, session cookies, and HTMX headers).

### Core Testing Methodologies
1. **Opaque-Box Verification**: Tests do not couple to internal function implementations, ORM internals, or transient memory structures. Instead, tests dispatch HTTP requests through Cloudflare Worker bindings (`SELF.fetch`) and assert against visible HTTP responses (status codes, redirect headers, cookies, and rendered DOM structure).
2. **Requirement-Driven Derivation**: Every test case directly traces back to an explicit requirement in `ORIGINAL_REQUEST.md` (R1 through R7). Expected outputs are derived strictly from documented requirements, regulatory rules (e.g. SafeWork South Australia propellant thresholds), and domain constraints.
3. **Category-Partition Method**: Systematic decomposition of input domains and user authorization contexts into equivalence classes:
   - User roles: Anonymous (`unauthenticated`), Regular Flyer (`role: 'flyer'`), Administrator (`role: 'admin'`).
   - Certification levels: Level 0 (Junior / Uncertified / Model Rocketry), Level 1 (HPR 1), Level 2 (HPR 2), Level 3 (HPR 3).
   - Certifying bodies: `TRA` (Tripoli Rocketry Association), `ARA` (Australian Rocketry Association), `NAR` (National Association of Rocketry).
   - Regulatory thresholds: South Australia unlicensed propellant limit (<= 3.0 kg compliant vs > 3.0 kg requiring license).
4. **Boundary Value Analysis (BVA)**: Precision testing at domain boundaries:
   - Storage capacity: 0.0 kg, 2.99 kg, 3.0 kg (unlicensed limit), 3.01 kg (license required), extreme values.
   - Inventory stock: exactly 0 quantity on hand (archivable) vs 1+ units (active, non-dismissible).
   - Rocket airframe geometry: fractional dimensions (e.g. 1245.5 mm), extreme aspect ratios, missing/zero values.
   - Event scheduling: past dates (historical meets), current dates, future dates, unassigned safety officers.
5. **Pairwise (Combinatorial) Testing**: Systematic cross-feature testing verifying that features operate harmoniously when exercised together across authorization boundaries and regulatory regions.
6. **Real-World Workload Scenarios**: Multi-step operational workflows modeling actual rocket launch meets, regulatory compliance audits, pilot onboarding, and range officer rotations.

---

## 2. Feature Inventory & Coverage Mapping

| Req # | Feature Area | Description | Tier 1 (Nominal) | Tier 2 (Boundaries) | Tier 3 (Pairwise) | Tier 4 (Workload) |
|---|---|---|---|---|---|---|
| **R1** | Admin RBAC & Visibility | Desktop & mobile navigation gating, dashboard widget exclusion, `/admin` 403 Forbidden enforcement | >= 5 tests | >= 5 tests | Cross-role flight logging | Launch Day RBAC Isolation |
| **R2** | Flight Logbook Usability | Searchable motor filter, flight edit GET/POST, flight-level RSO/LCO tracking | >= 5 tests | >= 5 tests | Dimension + motor filter | Launch meet flight operations |
| **R3** | Launch Events Resilience | Launch Director & Tripoli Prefect fields, past dates acceptance, unassigned/invalid officer FK resilience | >= 5 tests | >= 5 tests | Past event + flight officers | Event Director full meet workflow |
| **R4** | Inventory & Storage | 0-quantity motor dismissal, custody ledger preservation, `/inventory/storage-sites` CRUD, SA >3kg permit condition | >= 5 tests | >= 5 tests | Storage site + motor stock | Explosive compliance audit |
| **R5** | Profile & Multi-Club | Dedicated `/profile` route, TRA/ARA/NAR certs (levels 0-3), multi-club affiliations, self-service WebAuthn passkeys | >= 5 tests | >= 5 tests | Cert L0 + ARA + HPR check | New pilot onboarding |
| **R6** | Rocket Geometry | Length and body diameter in mm/cm, rocket create/edit forms, version config editor, detail cards, preflight checks | >= 5 tests | >= 5 tests | Airframe geometry + motor | Fleet maintenance & retest |
| **R7** | Automated Testing | Vitest + Miniflare D1 test runner, 100% test pass, clean TypeScript typecheck | Config | All Tiers | All Tiers | All Tiers |

---

## 3. Test Architecture & Harness

### Execution Environment
- **Runtime**: Vitest 4.1 executing inside Miniflare `workerd` isolate via `@cloudflare/vitest-pool-workers`.
- **Database**: In-memory Cloudflare D1 SQLite isolate initialized via migrations (`test/apply-migrations.ts`).
- **Isolation**: Each test suite runs in an isolated worker context. Database tables are purged before each test run using `truncateDb()` in reverse foreign-key order.

### HTTP Dispatch & Assertion Harness
- **`test/helpers/http.ts`**:
  - `fetchGet(path, headers, options)`: Dispatches GET requests via `SELF.fetch`.
  - `fetchPostForm(path, data, headers, options)`: Dispatches `application/x-www-form-urlencoded` POST requests.
  - `fetchHtmxGet(path, headers)` & `fetchHtmxPostForm(path, data, headers)`: Dispatches requests with `HX-Request: true`.
- **`test/helpers/html.ts`**:
  - `assertHtmlResponse(response, expectedStatus)`: Asserts status and `Content-Type: text/html`.
  - `assertContains(html, pattern, message)`: Asserts presence of content.
  - `assertNotContains(html, pattern, message)`: Asserts absence of content.
  - `assertHasFormField(html, fieldName)`: Asserts form input/select field presence.
  - `assertAlertBanner(html, variant)`: Asserts notification/alert styling.
- **`test/helpers/db.ts`**:
  - Model seeding factories (`seedTestUser`, `seedTestCert`, `seedTestRocket`, `seedTestConfig`, `seedTestMotor`, `seedTestInventory`, `seedTestSite`, `seedTestEvent`, `seedTestFlight`, `seedTestComponent`, `seedTestTransaction`).
  - Session generation: `signSession(userId)` creates valid HMAC-signed session cookies for role testing.
  - Truncation: `truncateDb()` executes `DELETE FROM <table>` in reverse foreign-key order.

### File Layout
```
test/
├── apply-migrations.ts                     # Isolate startup migration runner
├── helpers/
│   ├── db.ts                              # D1 seed factories & truncateDb()
│   ├── html.ts                            # DOM assertion helpers
│   └── http.ts                            # SELF.fetch HTTP dispatchers
├── integration/
│   ├── e2e_requirements.test.ts           # Central Requirement-Driven E2E Suite (Tiers 1-4)
│   ├── admin_security.test.ts             # Admin & authentication integration tests
│   ├── compliance_r2.test.ts              # Regulatory compliance integration tests
│   ├── flights.test.ts                    # Flight logging & soft gates integration tests
│   └── ...                                # Milestone integration test suites
└── unit/
    └── soft_gates.test.ts                 # Preflight safety rules pure unit tests
```

### Test Invocation Commands
```bash
# Run complete test suite (all test files)
npm test

# Run E2E requirement-driven test suite exclusively
npx vitest run test/integration/e2e_requirements.test.ts

# Run TypeScript typecheck
npm run typecheck
```

---

## 4. Coverage Thresholds & Quality Gates

| Test Tier | Focus Area | Required Count | Success Criteria |
|---|---|---|---|
| **Tier 1** | Primary Feature Coverage (R1–R6) | >= 5 tests per feature (>= 30 tests total) | HTTP 200/302/403 status, form field rendering, persistence |
| **Tier 2** | Boundary & Corner Cases (R1–R6) | >= 5 tests per feature (>= 30 tests total) | Rejection of invalid inputs, handling past dates, >3kg permits, 0-qty |
| **Tier 3** | Cross-Feature Combinations | >= 6 combinatorial tests | Interoperability between auth, flights, inventory, events, profile |
| **Tier 4** | Real-World Workload Scenarios | >= 5 comprehensive scenarios | Complete end-to-end user journeys matching real range operations |
| **Quality** | Type Safety & Framework Integrity | Zero TypeScript errors | `npm run typecheck` exits with code 0 |

---

## 5. Requirement-by-Requirement Test Specifications

### R1: Role-Based Admin Visibility & Navigation Guarding
- **Tier 1 (Nominal)**:
  - 1.1: Admin user sees "Admin" link in desktop top navigation on all standard pages.
  - 1.2: Admin user sees "Admin" link in mobile bottom navigation bar.
  - 1.3: Non-admin flyer does not see "Admin" link anywhere in desktop top navigation.
  - 1.4: Non-admin flyer does not see "Admin" link in mobile bottom navigation.
  - 1.5: Authenticated admin can successfully access `GET /admin` with HTTP 200.
- **Tier 2 (Boundaries & Negative Cases)**:
  - 2.1: Non-admin flyer requesting `GET /admin` receives HTTP 403 Forbidden with user-friendly error page.
  - 2.2: Non-admin flyer requesting `GET /admin/users` receives HTTP 403 Forbidden.
  - 2.3: Non-admin flyer requesting `/admin/users` with `Accept: application/json` receives 403 JSON error.
  - 2.4: Non-admin flyer visiting `/` (dashboard) sees zero administrative widgets or links.
  - 2.5: Anonymous (unauthenticated) request to `/admin` redirects to `/login` with HTTP 302.

### R2: Flight Logbook Usability: Searchable Motor Filter & Flight-Level Duty Officers
- **Tier 1 (Nominal)**:
  - 1.1: Flight creation form (`GET /flights/new`) renders searchable motor text input (`#motor-search-filter` or `#motor-search`).
  - 1.2: Motor select dropdown includes searchable attributes (`data-search` or model/manufacturer/diameter).
  - 1.3: Flight creation form includes RSO and LCO tracking fields (`rso_name`/`rso_user_id` and `lco_name`/`lco_user_id`).
  - 1.4: Flight submission (`POST /flights`) persists active RSO and LCO on the flight record.
  - 1.5: Flight detail view (`GET /flights/:id`) renders the recorded RSO and LCO duty officers.
- **Tier 2 (Boundaries & Edge Cases)**:
  - 2.1: Flight edit route `GET /flights/:id/edit` renders pre-filled form with current flight values.
  - 2.2: Flight edit submission `POST /flights/:id/edit` updates flight details, RSO, and LCO.
  - 2.3: Flight creation with empty/unassigned RSO and LCO persists gracefully without error.
  - 2.4: Flight creation with non-member/visiting officer name (e.g. "Visiting RSO Dave") records name without FK error.
  - 2.5: Requesting `GET /flights/:id/edit` for non-existent flight returns HTTP 404.

### R3: Launch Event Operational Roles & Event Creation Resilience
- **Tier 1 (Nominal)**:
  - 1.1: Event creation form (`GET /events/new`) includes Launch Director and Tripoli Prefect inputs.
  - 1.2: Event creation (`POST /events`) persists Launch Director and Tripoli Prefect.
  - 1.3: Event detail view (`GET /events/:id`) displays Launch Director and Tripoli Prefect.
  - 1.4: Event creation with assigned officers redirects to `/events/:id` with HTTP 302/303.
  - 1.5: Event list (`GET /events`) renders newly created events.
- **Tier 2 (Boundaries & Resilience)**:
  - 2.1: Event creation with past date (e.g. `2020-01-15`) succeeds with HTTP 302/303 redirect and persists event.
  - 2.2: Event creation with unassigned/empty officer fields (`rso_user_id: ''`, `lco_user_id: ''`) succeeds without 500 error.
  - 2.3: Event creation with non-existent or invalid user ID strings does not crash with foreign key violation.
  - 2.4: Event creation with extreme pad count (e.g. 64 pads or 1 pad) persists accurately.
  - 2.5: Event creation missing mandatory fields (e.g. missing name or launch site) returns 400 or re-renders form with error.

### R4: Inventory Management: Zero-Quantity Archiving & SA >3kg Storage Site Permits
- **Tier 1 (Nominal)**:
  - 1.1: Zero-quantity motor row displays a dismiss/archive action button on `GET /inventory`.
  - 1.2: Submitting dismissal (`POST /inventory/:id/dismiss` or `/archive`) removes motor from active inventory view.
  - 1.3: Chain-of-custody ledger (`GET /inventory` or ledger view) preserves all historical transactions for dismissed motor.
  - 1.4: Dedicated storage sites section `GET /inventory/storage-sites` renders list of storage sites.
  - 1.5: Storage site creation (`POST /inventory/storage-sites`) persists site and redirects.
- **Tier 2 (Boundaries & Regulatory Compliance)**:
  - 2.1: Dismissal rejected (HTTP 400) when attempted on motor with `quantityOnHand > 0`.
  - 2.2: Storage site with capacity <= 3.0 kg (e.g. 2.5 kg) can be created without a permit number.
  - 2.3: Storage site with capacity exactly 3.0 kg can be created without a permit number (boundary threshold).
  - 2.4: Storage site with capacity > 3.0 kg (e.g. 3.01 kg or 5.0 kg) requires permit number; fails with 400 if omitted.
  - 2.5: Storage site with capacity > 3.0 kg succeeds when valid permit number is provided.

### R5: User Profile Self-Management & Multi-Club Membership Tracking
- **Tier 1 (Nominal)**:
  - 1.1: Dedicated user profile screen (`GET /profile`) is accessible to authenticated flyers.
  - 1.2: User can update profile display name and personal settings via `POST /profile`.
  - 1.3: User profile displays rocketry certifications section and club affiliations section.
  - 1.4: User can record club affiliation (e.g. VRA, SARC, Tripoli, ARA) via `POST /profile/clubs`.
  - 1.5: User can delete/remove a club affiliation via `POST /profile/clubs/:id/delete`.
- **Tier 2 (Boundaries & Edge Cases)**:
  - 2.1: Certification supports Level 0 (Junior / Uncertified / Model Rocketry) across TRA, ARA, and NAR.
  - 2.2: Certification supports Level 3 (Maximum HPR certification).
  - 2.3: Certification supports Australian Rocketry Association (`ARA`) certifying body.
  - 2.4: User can record multiple clubs simultaneously (e.g. VRA with number VRA-102 and Tripoli with number TRA-8854).
  - 2.5: Profile view renders self-service WebAuthn passkey enrollment controls (register button/script) for regular flyers.

### R6: Rocket Airframe Geometry Specifications
- **Tier 1 (Nominal)**:
  - 1.1: Rocket creation form (`GET /rockets/new`) renders Length (`length_mm`) and Body Diameter (`body_diameter_mm`) inputs.
  - 1.2: Rocket creation (`POST /rockets`) persists length and body diameter.
  - 1.3: Rocket detail view (`GET /rockets/:id`) displays Length and Body Diameter.
  - 1.4: Configuration editor (`GET /rockets/:id/configurations/new`) renders length and body diameter inputs.
  - 1.5: Configuration creation (`POST /rockets/:id/configurations`) persists updated geometry.
- **Tier 2 (Boundaries & Formats)**:
  - 2.1: Accepts fractional airframe dimensions (e.g. length `1234.5` mm, diameter `54.2` mm).
  - 2.2: Accepts large-scale airframe dimensions (e.g. length `6500` mm, diameter `152` mm for high-power rocket).
  - 2.3: Accepts minimum boundary dimensions (e.g. micro-rocket length `150` mm, diameter `13` mm).
  - 2.4: Rocket creation with omitted/empty optional dimensions persists without database crash.
  - 2.5: Preflight safety check / form displays airframe length and diameter for pilot verification.

---

## 6. Tier 3: Pairwise Cross-Feature Combinations

1. **Pairwise 1 (R1 x R6)**: Non-admin flyer creates rocket with custom airframe length and diameter, verifies geometry displays on rocket detail view, and verifies absence of admin navigation links throughout the workflow.
2. **Pairwise 2 (R2 x R3)**: Event Director creates past launch event with Launch Director and Tripoli Prefect; flyer then logs a flight under that event selecting motor via filter and assigning specific flight RSO and LCO.
3. **Pairwise 3 (R4 x R5)**: Flyer with multi-club membership (ARA) creates storage site with 4.0 kg capacity and SA permit, logs motor into inventory, expends to 0 stock, and dismisses 0-stock motor while verifying custody transaction history remains intact.
4. **Pairwise 4 (R2 x R5 x R6)**: Flyer with Cert Level 0 and ARA affiliation configures rocket with airframe dimensions; selects HPR motor via searchable filter; preflight check alerts with Level 1 cert requirement warning; flyer acknowledges warning and logs flight with duty officers.
5. **Pairwise 5 (R1 x R3 x R4)**: Admin user creates launch event and storage site; switches session to non-admin flyer; non-admin flyer successfully views event and storage site but is rejected with HTTP 403 on `/admin`.
6. **Pairwise 6 (R2 x R6)**: Flyer edits an existing flight log (`POST /flights/:id/edit`) updating motor selection, airframe configuration geometry, and rotating duty officers (RSO/LCO).

---

## 7. Tier 4: Real-World Workload Scenarios

1. **Scenario 1: Complete Launch Meet Operation (RSO/LCO Rotation & Event Roles)**:
   - Event Director sets up monthly launch meet with Launch Director and Tripoli Prefect, accepting date settings.
   - Flyer logs flight #1 with morning RSO Dave and LCO Alice using motor selected from search filter.
   - Flyer logs flight #2 in the afternoon with rotated RSO Sarah and LCO Bob.
   - Verifies both flights capture independent duty officers on their respective flight detail logs.
2. **Scenario 2: South Australia High-Power Explosive Storage Compliance & Zero-Stock Archiving**:
   - Flyer creates physical storage site configured for 5.0 kg propellant capacity, providing SafeWork SA Explosives Permit #SA-EXP-2026-99.
   - Flyer receives two high-power motors into storage site.
   - Both motors are expended in launch activities.
   - Flyer dismisses zero-quantity motor from active inventory.
   - Active inventory reflects zero stock without listing dismissed item; custody ledger preserves complete audit trail of receipts and expenditures.
3. **Scenario 3: Pilot Profile Onboarding, Cert Level 0, Multi-Club Affiliation, and Passkeys**:
   - New rocketeer accesses `/profile`.
   - Adds dual club affiliations: Victorian Rocketry Association (VRA-2026-042) and Tripoli (TRA-99411).
   - Sets rocketry certification to Level 0 (Junior / Model Rocketry).
   - Checks WebAuthn passkey registration options endpoint from profile.
   - Logs first model rocket flight with airframe length and diameter recorded.
4. **Scenario 4: Role-Based Range Operations & Security Boundary Enforcement**:
   - Admin initializes range parameters.
   - Regular flyer logs in; verifies absence of Admin link in top and mobile navigation.
   - Flyer visits dashboard; confirms no administrative cards/actions are rendered.
   - Flyer attempts direct GET and POST to `/admin/users`; verifies HTTP 403 Forbidden with user-friendly error page.
   - Flyer successfully navigates to permitted operational sections (flights, rockets, inventory, events).
5. **Scenario 5: Fleet Maintenance, Airframe Versioning, and Flight Edit Retest**:
   - Flyer builds custom rocket airframe specifying Length (1420.0 mm) and Body Diameter (76.0 mm).
   - Flyer logs initial test flight with designated RSO and LCO.
   - Flyer realizes duty officer was recorded with a typo and uses `/flights/:id/edit` to correct RSO and apogee telemetry.
   - Flyer creates version 2 configuration with updated dimensions.
   - Verifies all version geometry and flight histories persist accurately.
