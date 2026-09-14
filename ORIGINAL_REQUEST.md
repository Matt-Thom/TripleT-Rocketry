# Original User Request

## 2026-09-14T08:27:34Z

TripleT-Rocketry security review and functional enhancements: enforce strict unauthenticated route and navigation gating across all pages, implement OpenRocket (.ork) airframe file import, relocate propellant storage sites under Sites, and enable single and bulk motor inventory removal.

Working directory: /mnt/GAMES_SSD/matt/Code/TripleT-Rocketry
Integrity mode: development

## Requirements

### R1. Strict Unauthenticated Access Control & Navigation Menu Gating
When logged out or unauthenticated, no internal system views, pages, or data may be accessible. 
1. The global layout navigation header (desktop) and bottom navigation bar (mobile) must completely suppress all internal application links (`/`, `/flights`, `/rockets`, `/motors`, `/inventory`, `/sites`, `/events`, `/admin`, `/profile`) when there is no active authenticated user, showing only public entrypoints (e.g. "Sign In" / `/login`).
2. Review all registered routes to ensure every non-public endpoint strictly enforces authentication, returning an HTTP 302 redirect to `/login` for browser requests and HTTP 401 Unauthorized for API requests.
3. Remove or strictly guard any dev/test cookieless fallback mechanisms that automatically treat unauthenticated visitors as logged-in flyers.

### R2. OpenRocket (.ork) Airframe Import
Enable flyers to import rockets directly from OpenRocket files.
1. Provide an airframe import upload interface accepting standard `.ork` files (ZIP archives containing `rocket.xml`).
2. Parse the internal XML structure to extract airframe specifications: rocket name, stages, overall length, maximum body diameter, dry mass/weight, and motor mount tube diameter.
3. Save the imported data as a new rocket and configuration record associated with the current flyer, with sensible defaults for any unmapped fields.

### R3. Propellant Storage Sites Reorganization
Relocate "Propellant Storage Sites & Magazines" to be a dedicated section under Sites rather than Inventory.
1. Establish storage site routes under `/sites/storage-sites` (list, new, view, edit, delete).
2. Retain 301/302 redirects from legacy `/inventory/storage-sites` paths to prevent broken bookmarks.
3. Update top-level navigation, page breadcrumbs, and inventory views so that storage sites are accessed and managed from the Sites module.

### R4. Motor Inventory Removal & Lifecycle Management
Provide operators and flyers the capability to remove motor inventory items individually and in bulk.
1. In inventory views, provide single-item delete actions and multi-select checkboxes for batch deletion.
2. If an inventory record has no associated flight logs or historical transactions, perform a permanent hard deletion.
3. If an inventory item has linked flight logs or transaction history, record a regulatory disposal/expenditure transaction to maintain audit compliance while removing the motor from active available stock.

## Acceptance Criteria

### Security & Route Gating
- [ ] Any HTTP GET/POST request to non-public endpoints without valid session credentials redirects to `/login` (HTML) or returns 401 (JSON/API).
- [ ] Publicly accessible pages (`/login`, `/register`, `/setup`, `/health`, `/ready`) render layout navigation with zero links to internal protected routes.
- [ ] Browser requests with `triplet_logged_out=1` or empty cookies cannot access `/`, `/flights`, `/rockets`, `/motors`, `/inventory`, `/sites`, `/events`, or `/admin`.
- [ ] Automated security tests verify every non-public route enforces 302/401 for unauthenticated requests and confirms absence of protected navigation links in unauthenticated responses.

### OpenRocket Import
- [ ] Uploading a valid `.ork` file creates a new rocket and rocket configuration in SQLite D1.
- [ ] Parsed attributes (name, total length, outer diameter, mass, motor mount size) match values extracted from the archive's `rocket.xml`.
- [ ] Malformed or invalid non-ZIP/non-ORK uploads are rejected gracefully with user-friendly error messages without crashing the Worker isolate.

### Sites & Storage Reorganization
- [ ] Storage sites listing, creation, viewing, editing, and deletion operate under `/sites/storage-sites/*`.
- [ ] Requests to `/inventory/storage-sites/*` redirect cleanly to corresponding `/sites/storage-sites/*` paths.
- [ ] Sites navigation and views feature clear entrypoints for Propellant Storage Sites & Magazines.

### Inventory Removal & Audit Preservation
- [ ] Operators can remove an individual motor inventory item from the UI.
- [ ] Operators can select multiple motor inventory items via checkboxes and execute bulk deletion.
- [ ] Motors with zero associated flight logs or transaction records are completely deleted from the database.
- [ ] Motors with linked flights or history generate a disposal inventory transaction and are excluded from active inventory listings.

### Quality & Regression Verification
- [ ] `npm run typecheck` exits 0 with no TypeScript errors.
- [ ] `npm audit --omit=dev --audit-level=high` reports 0 high/critical vulnerabilities.
- [ ] `npx drizzle-kit generate --name ci-drift-check` outputs "No schema changes, nothing to migrate" with zero untracked migration drift.
- [ ] `npm test` executes and passes 100% of tests.
