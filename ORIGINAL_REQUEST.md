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
