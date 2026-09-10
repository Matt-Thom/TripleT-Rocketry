# Original User Request

## 2026-09-08T01:14:20Z

Implement comprehensive functional refinements for TripleT-Rocketry across admin access control, flight logging usability, launch event operational roles, regulatory storage site management, user profile self-service with multi-club memberships, and rocket airframe dimensions.

Working directory: /home/matt/Code/TripleT-Rocketry
Integrity mode: development

## Requirements

### R1. Role-Based Admin Visibility & Navigation Guarding
- Restrict all "Admin" menu items, navigation links, and administrative dashboard widgets exclusively to authenticated users who possess administrator privileges (`role === 'admin'`).
- Ensure non-admin flyers cannot see the "Admin" option anywhere in desktop top navigation, mobile menus, or dashboard cards.
- Directly requesting `/admin` or administrative endpoints as a non-admin user must return HTTP 403 Forbidden with a user-friendly error page.

### R2. Flight Logbook Usability: Searchable Motor Filter & Flight-Level Duty Officers
- In the flight creation and editing forms (`/flights/new`, `/flights/:id/edit`), implement a fast, responsive searchable filter for the "Motor Model" selection so flyers can type text (e.g. designation "H128", manufacturer "AeroTech", or diameter) to filter long lists of motors.
- Move Range Safety Officer (RSO) and Launch Control Officer (LCO) tracking directly to individual flight logs (storing RSO and LCO names or user associations per flight), reflecting that duty officers rotate throughout a launch meet.

### R3. Launch Event Operational Roles & Event Creation Resilience
- Add dedicated **Launch Director** and **Tripoli Prefect** fields to the `launch_events` data model, event creation/edit forms, and event detail views.
- Ensure the event creation form (`POST /events`) reliably accepts past event dates and optional officer fields without raising 500 errors or foreign key constraint failures.

### R4. Inventory Management: Zero-Quantity Archiving & SA >3kg Storage Site Permits
- Allow flyers to dismiss or remove motors with quantity 0 from their active inventory view, while strictly preserving all historical chain-of-custody records and inventory transactions.
- Create a dedicated **Storage Sites** management section (`/inventory/storage-sites`) allowing flyers to create, view, and edit physical storage locations and magazines.
- Implement South Australia explosive storage compliance: if a storage site is configured with a propellant capacity exceeding 3.0 kg, dynamically require and display the regulatory permit / storage license field.

### R5. User Profile Self-Management & Multi-Club Membership Tracking
- Make WebAuthn Passkey registration accessible as a self-service user function in the user profile settings, rather than restricting it to the admin panel.
- Create a dedicated user profile edit screen (`/profile`) distinct from the administrative user management interface:
  - Allow users to view and update their own pilot profile and rocketry certification levels (TRA/ARA/NAR levels 0–3, cert numbers, and expiry dates).
  - Add the ability to record multiple club affiliations (e.g. VRA, SARC, Tripoli, ARA) along with individual membership numbers for each club.

### R6. Rocket Airframe Geometry Specifications
- Extend the rocket and rocket configuration data models to store key physical airframe measurements:
  - **Length** (overall rocket length in millimeters or centimeters/meters).
  - **Body Diameter** (maximum airframe diameter in millimeters).
- Incorporate length and body diameter into rocket creation forms, configuration editors, detail cards, and preflight safety checks.

### R7. Automated Testing & Verification
- Unit and integration tests covering:
  - Admin navigation gating and 403 enforcement for non-admin users.
  - Motor search filter interaction and flight-level RSO/LCO recording.
  - Event creation with past dates, Launch Director, and Tripoli Prefect.
  - Zero-quantity motor inventory filtering without transaction data loss.
  - Storage site CRUD and South Australian >3kg permit condition evaluation.
  - User profile updates, multi-club membership persistence, and passkey registration.
  - Rocket airframe length and diameter storage and display.
- All tests execute against local Cloudflare D1 environment and pass in Vitest.
- TypeScript typechecks pass cleanly with zero errors (`npm run typecheck`).

## Acceptance Criteria

### Navigation & Admin Access Control
- [ ] Admin navigation link and dashboard admin section are strictly hidden for flyers where `role !== 'admin'`.
- [ ] Non-admin requests to `/admin` return HTTP 403 Forbidden.

### Flight Logging & Range Operations
- [ ] Flight creation form allows typing to dynamically filter the motor dropdown list.
- [ ] Flight records capture and display the active RSO and LCO for that specific flight.

### Launch Events
- [ ] Launch events capture Launch Director and Tripoli Prefect.
- [ ] Creating an event with past dates or unassigned officers completes with HTTP 302/303 redirect to the event page without 500 errors.

### Inventory & Storage Compliance
- [ ] Motors with zero stock can be hidden/removed from active inventory without deleting historical custody transactions.
- [ ] Storage sites can be created and edited in a dedicated storage management section.
- [ ] Storage site form displays and requires a permit number when propellant capacity exceeds 3.0 kg (SA regulation).

### User Profile & Club Memberships
- [ ] Users can register passkeys directly from their user profile screen.
- [ ] Users can edit their profile, certification level, and certification numbers.
- [ ] Users can add multiple club affiliations with corresponding membership numbers (e.g. VRA, SARC, Tripoli).

### Rocket Specifications
- [ ] Rocket creation and configuration forms accept Length and Body Diameter.
- [ ] Rocket detail views display Length and Body Diameter.

### Verification & Quality
- [ ] `npm run typecheck` exits with code 0 and zero TypeScript errors.
- [ ] `npm test` runs all test suites against local D1 and passes 100% of test cases.

## 2026-09-08T07:54:37Z

Implement usability and domain refinements for TripleT-Rocketry covering launch event visibility & editing, flight logging enhancements (dual altitude units, simplified duty officers, flight log type, unified motor selection), and reload motor casing/hardware tracking.

Working directory: /home/matt/Code/TripleT-Rocketry
Integrity mode: development

## Requirements

### R1. Launch Events: Past Events Visibility, Full Editing & Flight Selection
- **Past Event Visibility**: Ensure all launch meets (both upcoming and past) are clearly visible and organized on the events page (`/events`), using distinct sections or tabs (e.g. "Upcoming Launches" and "Past Launch Meets / Archive") with clear date tags so past events are never hidden or lost.
- **Event Editing Workflow**: Provide an event editing interface with `GET /events/:id/edit` and `POST /events/:id/edit` (and `PUT /events/:id`), allowing organizers to modify event name, host site, dates, pad count, launch director, tripoli prefect, and notes, accessible via an "✏️ Edit Event" button on the event detail view and list.
- **Flight Event Selectability**: Ensure all past and upcoming events are selectable in the flight logging dropdown (`/flights/new`, `/flights/:id/edit`), clearly formatted with event name, date, and launch site.

### R2. Flight Logbook: Dual Altitude Units, Pure Text Duty Officers, Flight Stage, & Unified Motor Input
- **Dual Peak Altitude (Meters & Feet)**:
  - Display side-by-side inputs for Peak Altitude in meters (`m`) and feet (`ft`), each occupying half width.
  - Implement real-time bi-directional calculation: entering feet automatically computes and populates meters (`m = ft * 0.3048`), and entering meters automatically computes and populates feet (`ft = m * 3.28084`).
  - Persist the canonical altitude in meters (`altitude_agl_m`) in D1 while displaying both units on flight detail views.
- **Pure Text Duty Officers**:
  - Remove the "Link registered flyer" user dropdown/linking for Range Safety Officer (RSO) and Launch Control Officer (LCO).
  - Provide simple text input fields (`rso_name` and `lco_name`) directly on the flight log form.
- **Flight Log Type (Preflight vs Actual)**:
  - Add a selectable flight log type field distinguishing whether the record is a "Preflight Simulation / Planned" flight or a "Post-Flight Actuals" log (`log_type`: `'preflight'` | `'actual'`).
  - Display distinct visual badges on flight logs, list views, and detail cards.
- **Unified Motor Selection**:
  - Consolidate the separate "Motor Model" (catalog) and "Motor Stock Item" (inventory) inputs into a single, unified motor selector.
  - Allow flyers to select a motor once; if the flyer has inventory units for that motor, display an on-hand stock badge and seamlessly link inventory, without requiring two duplicate fields.

### R3. Reload Motor Casings & Hardware Tracking
- **Required Casing / Hardware Association**:
  - Track what motor casing/hardware is required for reloadable motors (using the manufacturer hardware specifications from AeroTech and Cesaroni catalog data in `motors.hardware`).
  - Prominently display the required casing/hardware on the motor catalog detail views, motor inventory cards, and flight motor summary so flyers immediately know which casing is needed.
  - Ensure motor CSV import and manual motor creation preserve and display the hardware field.

### R4. Automated Testing & Verification
- Comprehensive automated unit and integration tests covering:
  - Event editing workflows (`GET /events/:id/edit`, `POST /events/:id/edit`) and past event visibility on `/events`.
  - Dual altitude unit entry, real-time bi-directional calculation, and database persistence.
  - Simplified text duty officers (RSO and LCO) without user foreign key constraints.
  - Flight log type selection (`preflight` vs `actual`) and badge display.
  - Unified motor selector behavior with inventory deduction and catalog fallback.
  - Motor casing/hardware tracking and display in catalog, inventory, and flight views.
- All tests execute against the local Cloudflare D1 environment and pass 100% in Vitest.
- TypeScript typecheck passes cleanly with zero errors (`npm run typecheck`).

## Acceptance Criteria

### Launch Events
- [ ] Past launch events are clearly visible and organized on `/events` (e.g. in a "Past Launch Meets" section or tab).
- [ ] Users can edit any event via `/events/:id/edit` and updates are saved to D1.
- [ ] All past and upcoming events appear in the flight logging event dropdown.

### Flight Logbook
- [ ] Peak Altitude displays side-by-side meters and feet inputs, each half size.
- [ ] Typing into feet updates meters, and typing into meters updates feet automatically.
- [ ] RSO and LCO are simple text input fields without requiring user account linking.
- [ ] Flight logging form includes a selectable toggle between Preflight Simulation / Planned and Post-Flight Actuals.
- [ ] Flight form provides a single unified motor input instead of two separate motor fields.

### Motor Casings & Hardware
- [ ] Motor catalog detail and inventory views display the required motor casing / hardware.
- [ ] CSV import and motor creation reliably store and display the hardware casing specification.

### Verification & Quality
- [ ] `npm run typecheck` exits with status 0 and zero TypeScript diagnostics.
- [ ] `npm test` passes 100% of test suites with zero failures.

## 2026-09-09T04:39:24Z

Implement comprehensive logbook usability, range operations, rocket configuration snapshot editing, and flight card domain refinements for TripleT-Rocketry, fully aligning with club flight card data specifications and resolving event workflow edge cases.

Working directory: /home/matt/Code/TripleT-Rocketry
Integrity mode: development

## Requirements

### R1. Flight Card & Range Log Alignment (Google Sheet Schema Matching)
- **Flight Card Schema & Form Fields**:
  - Extend the flight data model (`flights` table in D1) and flight logging form (`/flights/new`, `/flights/:id/edit`) to incorporate all flight card categories from the Tripoli/SARC flight tracking specification:
    - **First Flight**: Boolean flag indicating if this is the rocket airframe's maiden voyage (`is_first_flight`).
    - **Certification Attempt**: Selectable level (`none`, `mpr`, `l1`, `l2`, `l3`).
    - **Build Type**: Construction method (`rtf`, `kit`, `modified`, `scratch_built`).
    - **Stability Check Method**: Method/tool used to verify stability for modified/scratch builds (`OpenRocket`, `Rocksim`, `AltiCal`, `RasAero`, or custom text).
    - **Stability Margin**: Calibers of stability recorded for the flight.
    - **Motor Type & Impulse Range**: Motor composition (`Black Powder`, `Composite`, `Hybrid`, `Cluster`, `Staged`, `Sparky`) and impulse power class.
    - **Total Weight**: Pre-launch all-up mass in grams (`total_weight_g` / loaded weight).
    - **Recovery Configuration**: Recovery system (`Chute(s)`, `Streamer`, `Tumble`, `Other`), size description (e.g. `24"`), deployment method (`Motor eject`, `Chute Release`, `Electronic deploy`), and main chute deployment altitude (e.g. altitude in feet/meters AGL or `Apogee`).
    - **Pad Number**: Launch pad designation on the range (e.g., `A1`, `A2`, `B3`, `Own`).
    - **Flight Outcomes**: Expanded club outcome options (`GOOD`, `CATO`, `Shred`, `Unstable`, `Zipper`, `Separation`, `No chute`, `Tangled`, `Lawn Dart`, `Retention fail`, `No ignition`).
- **Automatic Event Duty Officer Autofill**:
  - When an event is selected on `/flights/new` (or passed via query parameter `?launch_event_id=`), automatically pre-populate the flight's RSO and LCO text fields with the event's designated RSO and LCO.
  - Keep both fields fully editable/overwritable on the flight log form to accommodate duty rotations during the day.
- **Flight Detail & Logbook Display**:
  - Render all flight card categories cleanly in flight detail cards, range summary views, and exportable tables.

### R2. Rocket Configuration Snapshots & Active Config Editing
- **Snapshot History Editing**:
  - Implement full editing capabilities for historical configuration snapshots (`GET /rockets/:id/configurations/:configId/edit` and `POST /rockets/:id/configurations/:configId/edit`).
  - Add explicit "✏️ Edit" action buttons for every configuration version in the snapshot history table on `/rockets/:id`.
- **Active Configuration Editing**:
  - Provide a direct "✏️ Edit Active Configuration" button and workflow on the rocket detail view, allowing flyers to update aerodynamic and physical properties of the active configuration.
- **Full Field Coverage & Separation**:
  - Ensure all active config parameters can be updated: dry mass, loaded mass, ballast, length, body diameter, Center of Gravity (CG), Center of Pressure (CP), stability calibers, recovery type, parachute size, drogue parachute size, motor mount diameter, and configuration notes.
  - In the rocket configuration summary card, cleanly separate **Motor Mount Diameter** and **Recovery / Chute Specifications** into distinct visual metrics cards instead of combining them into a single tile.

### R3. Launch Events: Plain Text Duty Officers & Non-Destructive Site Creation
- **Plain Text Event Duty Officers**:
  - Update `launch_events` to store plain text RSO and LCO names (`rso_name`, `lco_name`), matching the Launch Director and Tripoli Prefect pattern.
  - Remove all "Optional User UUID" placeholders and UUID foreign key restrictions from event forms (`/events/new`, `/events/:id/edit`).
  - Ensure entered names (e.g. "Andrew Buttery", "Jerome Pong") persist reliably and display prominently on the event dashboard, event detail view, and event list instead of showing "None designated".
- **Non-Destructive Site Creation from Event Form**:
  - When a user selects the option to add a new launch site while creating an event, provide an inline modal/dialog or preserve all entered event form state and redirect back to `/events/new` with the newly created site automatically selected, preventing data loss.

### R4. Automated Testing & Verification
- Comprehensive automated unit and integration tests covering:
  - Database schema migration and D1 persistence for all new flight card fields and event text duty officers.
  - Event officer text persistence without UUID restrictions and display across event cards and detail views.
  - Flight form event selection auto-populating RSO/LCO and allowing manual overrides.
  - Configuration snapshot editing (`GET/POST /rockets/:id/configurations/:configId/edit`) and active configuration updates.
  - Distinct visual separation of motor mount diameter and recovery chutes.
  - Non-destructive site creation flow returning to the event creation form.
- All tests execute against the local Cloudflare D1 environment and pass 100% in Vitest.
- TypeScript typecheck passes cleanly with zero errors (`npm run typecheck`).

## Acceptance Criteria

### Flight Card & Range Tracking
- [ ] Flight creation form includes all flight card fields matching the Tripoli/SARC specification (first flight, cert attempt, build type, stability check method, motor type, total weight in grams, pad number, recovery size & deployment method, main chute deploy altitude, expanded outcomes).
- [ ] Selecting an event automatically populates RSO and LCO fields while allowing manual edits.
- [ ] Flight detail and table views display the new flight card specifications.

### Rocket Configuration Editing
- [ ] Configuration snapshots in the history table have a functional "✏️ Edit" button that opens an edit form.
- [ ] Flyers can edit CG, CP, motor mount diameter, chute sizes, and all physical parameters on any configuration.
- [ ] Active configuration card has a direct "✏️ Edit Active Config" action.
- [ ] Motor Mount Diameter and Recovery / Chute are displayed in separate cards.

### Launch Events
- [ ] Event creation and editing forms accept text strings for RSO and LCO without "Optional User UUID" placeholders.
- [ ] Saved RSO and LCO names display on the event dashboard and detail view (not "None designated").
- [ ] Creating a new site from `/events/new` returns to the event form without losing previously entered event data.

### Verification & Quality
- [ ] `npm run typecheck` exits with status 0 and zero TypeScript errors.
- [ ] `npm test` executes all test suites against local Cloudflare D1 and passes 100% of test cases.

## 2026-09-10T03:55:11Z

This is a single self-contained fix; keep it small and focused.

Review and fix the sign-in and session security issues in the TripleT-Rocketry web application where users appear to remain authenticated or continue using the site after signing out, and sessions never appear to expire.

Working directory: /home/matt/Code/TripleT-Rocketry
Integrity mode: development

## Requirements

### R1. Server-Side Session Invalidation on Sign-Out
Ensure that signing out invalidates the session on both client and server:
- The session record or token must be explicitly revoked or deleted server-side so it can never be used again.
- All session authentication cookies must be properly cleared/expired in the response.
- Any subsequent requests using previously valid session credentials must be rejected.

### R2. Session Expiration & Lifecycle Enforcement
Implement and enforce session expiration:
- Sessions must have a defined expiration lifetime (absolute timeout and/or idle timeout).
- Authentication middleware and session verification logic must validate that the session is neither expired nor revoked on protected endpoints.
- Expired sessions must be rejected, prompting re-authentication.

### R3. Automated Regression Verification
Add automated tests covering the session security lifecycle using the existing Vitest test suite:
- Verification that signing out immediately renders the session token/cookie invalid for protected routes.
- Verification that expired sessions cannot access protected routes.
- Verification that standard legitimate sessions remain functional within their validity window.

## Acceptance Criteria

### Security & Functional Criteria
- [ ] Calling the sign-out endpoint revokes the session server-side and clears session cookies.
- [ ] Requests to protected routes using a signed-out session cookie/token receive a 401 Unauthorized response (or redirect to sign-in).
- [ ] Requests to protected routes using an expired session receive a 401 Unauthorized response (or redirect to sign-in).
- [ ] Legitimate active sessions can access authorized endpoints without disruption.

### Verification Criteria
- [ ] `npm test` runs and all tests pass (including new session invalidation and expiration tests).
- [ ] `npm run typecheck` passes with zero TypeScript errors.
