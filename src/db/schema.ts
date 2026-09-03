/**
 * Drizzle schema for D1 (SQLite) — the Phase 1 (WP0) entity graph.
 *
 * Ported from the SQLAlchemy/PostgreSQL models under `app/models/`. Type
 * mapping decisions, made once here so the migrations stay mechanical:
 *
 *   uuid            -> text primary key, generated with crypto.randomUUID()
 *   timestamptz     -> integer (unix ms). SQLite has no native timestamp type;
 *                      ms-since-epoch sorts correctly and round-trips to Date.
 *   date            -> text, ISO-8601 'YYYY-MM-DD'. Date-only values must not
 *                      acquire a timezone, so they stay text rather than epoch.
 *   float/double    -> real
 *   boolean         -> integer 0/1
 *   jsonb           -> text, JSON-encoded (see `mode: 'json'`)
 *   native enum     -> text + a CHECK constraint in the migration. SQLite has
 *                      no enum type; the `enum:` option below is TypeScript-side
 *                      only, so the CHECK is what actually enforces the domain.
 *
 * See: wiki/concepts/phase1-implementation-plan.md
 */

import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'

// --- Domain enumerations (mirror app/models/enums.py) ----------------------

export const CERTIFYING_BODY = ['NAR', 'TRA'] as const
export const CERT_LEVEL = [1, 2, 3] as const
export const IMPULSE_CLASS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H',
  'I', 'J', 'K', 'L', 'M', 'N', 'O',
] as const
export const PROPELLANT_TYPE = ['black_powder', 'apcp', 'hybrid', 'other'] as const
export const CERTIFYING_ORG = ['NAR', 'TRA', 'BOTH', 'NONE'] as const
export const ROCKET_STATUS = ['flight_ready', 'in_build', 'damaged', 'retired'] as const
export const RECOVERY_TYPE = [
  'parachute', 'streamer', 'dual_deploy', 'tumble', 'other',
] as const
export const FLIGHT_OUTCOME = [
  'successful', 'cato', 'separation', 'recovery_failure',
  'tree', 'powerline', 'lost', 'other',
] as const

// --- Shared column builders ------------------------------------------------

const uuidPk = () =>
  text('id').primaryKey().$defaultFn(() => crypto.randomUUID())

const nowMs = sql`(unixepoch('subsec') * 1000)`

/**
 * The audit columns every Phase 1 entity carries (app/models/base.py).
 *
 * `updated_at` is refreshed by Drizzle's `$onUpdate`, not by a SQLite trigger:
 * a trigger would also fire for D1 migrations and backfills, which should not
 * count as user edits.
 */
const auditColumns = {
  createdAt: integer('created_at').notNull().default(nowMs),
  updatedAt: integer('updated_at')
    .notNull()
    .default(nowMs)
    .$onUpdate(() => Date.now()),
  createdBy: text('created_by'),
  deletedAt: integer('deleted_at'),
}

/**
 * A CHECK constraint standing in for a PostgreSQL native enum.
 *
 * Drizzle's `enum:` option is erased at runtime, so without this the column
 * would accept any string. Nullable columns must still admit NULL, hence the
 * explicit `IS NULL` branch.
 *
 * The predicate is built with `sql.raw` rather than interpolation because
 * drizzle-kit renders interpolated values as `?` bind placeholders, and SQLite
 * rejects parameters inside a CHECK constraint. Both the column names and the
 * value lists are compile-time constants declared in this file, so there is no
 * untrusted input to escape here.
 */
const literalList = (values: readonly (string | number)[]) =>
  values.map((v) => (typeof v === 'number' ? String(v) : `'${v}'`)).join(', ')

const enumCheck = (
  name: string,
  column: SQLiteColumn,
  values: readonly (string | number)[],
) =>
  check(
    name,
    sql.raw(
      `"${column.name}" IS NULL OR "${column.name}" IN (${literalList(values)})`,
    ),
  )

// --- Entities --------------------------------------------------------------

export const users = sqliteTable(
  'users',
  {
    id: uuidPk(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at')
      .notNull()
      .default(nowMs)
      .$onUpdate(() => Date.now()),
  },
  (t) => [uniqueIndex('uq_users_email').on(t.email)],
)

export const certifications = sqliteTable(
  'certifications',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    certifyingBody: text('certifying_body', { enum: CERTIFYING_BODY }).notNull(),
    level: integer('level').notNull(),
    certNumber: text('cert_number'),
    expiresOn: text('expires_on'),
    verifiedAt: integer('verified_at'),
    overrideReason: text('override_reason'),
    ...auditColumns,
  },
  (t) => [
    index('ix_certifications_user_id').on(t.userId),
    enumCheck('ck_certifications_certifying_body', t.certifyingBody, CERTIFYING_BODY),
    enumCheck('ck_certifications_level', t.level, CERT_LEVEL),
  ],
)

export const rockets = sqliteTable(
  'rockets',
  {
    id: uuidPk(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    status: text('status', { enum: ROCKET_STATUS }).notNull().default('in_build'),
    ...auditColumns,
  },
  (t) => [
    index('ix_rockets_owner_id').on(t.ownerId),
    enumCheck('ck_rockets_status', t.status, ROCKET_STATUS),
  ],
)

export const rocketConfigurations = sqliteTable(
  'rocket_configurations',
  {
    id: uuidPk(),
    rocketId: text('rocket_id')
      .notNull()
      .references(() => rockets.id),
    version: integer('version').notNull(),
    airframeMaterial: text('airframe_material'),
    finCount: integer('fin_count'),
    dryMassG: real('dry_mass_g'),
    loadedMassG: real('loaded_mass_g'),
    ballastG: real('ballast_g'),
    cgMm: real('cg_mm'),
    cpMm: real('cp_mm'),
    stabilityCalibers: real('stability_calibers'),
    recoveryType: text('recovery_type', { enum: RECOVERY_TYPE }),
    parachuteSizeMm: real('parachute_size_mm'),
    motorMountDiameterMm: real('motor_mount_diameter_mm'),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(true),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex('uq_rocket_configurations_rocket_version').on(t.rocketId, t.version),
    enumCheck('ck_rocket_configurations_recovery_type', t.recoveryType, RECOVERY_TYPE),
  ],
)

export const motors = sqliteTable(
  'motors',
  {
    id: uuidPk(),
    manufacturer: text('manufacturer').notNull(),
    model: text('model').notNull(),
    impulseClass: text('impulse_class', { enum: IMPULSE_CLASS }),
    totalImpulseNs: real('total_impulse_ns'),
    averageThrustN: real('average_thrust_n'),
    maxThrustN: real('max_thrust_n'),
    burnTimeS: real('burn_time_s'),
    delayS: real('delay_s'),
    propellantType: text('propellant_type', { enum: PROPELLANT_TYPE }),
    diameterMm: real('diameter_mm'),
    lengthMm: real('length_mm'),
    casingReusable: integer('casing_reusable', { mode: 'boolean' })
      .notNull()
      .default(false),
    certNumber: text('cert_number'),
    certifyingOrg: text('certifying_org', { enum: CERTIFYING_ORG }),
    weightG: real('weight_g'),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex('uq_motors_manufacturer_model_delay').on(
      t.manufacturer,
      t.model,
      t.delayS,
    ),
    enumCheck('ck_motors_impulse_class', t.impulseClass, IMPULSE_CLASS),
    enumCheck('ck_motors_propellant_type', t.propellantType, PROPELLANT_TYPE),
    enumCheck('ck_motors_certifying_org', t.certifyingOrg, CERTIFYING_ORG),
  ],
)

export const motorInventories = sqliteTable(
  'motor_inventories',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    motorId: text('motor_id')
      .notNull()
      .references(() => motors.id),
    quantityOnHand: integer('quantity_on_hand').notNull().default(0),
    expendedCount: integer('expended_count').notNull().default(0),
    acquiredOn: text('acquired_on'),
    notes: text('notes'),
    ...auditColumns,
  },
  (t) => [
    index('ix_motor_inventories_user_id').on(t.userId),
    index('ix_motor_inventories_motor_id').on(t.motorId),
  ],
)

export const launchSites = sqliteTable('launch_sites', {
  id: uuidPk(),
  name: text('name').notNull(),
  latitude: real('latitude'),
  longitude: real('longitude'),
  maxAltitudeAglM: real('max_altitude_agl_m'),
  notes: text('notes'),
  ...auditColumns,
})

export const launchEvents = sqliteTable(
  'launch_events',
  {
    id: uuidPk(),
    launchSiteId: text('launch_site_id')
      .notNull()
      .references(() => launchSites.id),
    name: text('name').notNull(),
    startsOn: text('starts_on'),
    endsOn: text('ends_on'),
    rsoUserId: text('rso_user_id').references(() => users.id),
    lcoUserId: text('lco_user_id').references(() => users.id),
    weatherNotes: text('weather_notes'),
    padCount: integer('pad_count'),
    ...auditColumns,
  },
  (t) => [index('ix_launch_events_launch_site_id').on(t.launchSiteId)],
)

export const flights = sqliteTable(
  'flights',
  {
    id: uuidPk(),
    flyerId: text('flyer_id')
      .notNull()
      .references(() => users.id),
    rocketConfigurationId: text('rocket_configuration_id').references(
      () => rocketConfigurations.id,
    ),
    motorId: text('motor_id').references(() => motors.id),
    motorInventoryId: text('motor_inventory_id').references(() => motorInventories.id),
    launchSiteId: text('launch_site_id').references(() => launchSites.id),
    launchEventId: text('launch_event_id').references(() => launchEvents.id),
    flightNumber: integer('flight_number'),
    flownAt: integer('flown_at'),
    altitudeAglM: real('altitude_agl_m'),
    altitudeMslM: real('altitude_msl_m'),
    maxVelocityMps: real('max_velocity_mps'),
    maxAccelG: real('max_accel_g'),
    windMps: real('wind_mps'),
    windDirDeg: real('wind_dir_deg'),
    temperatureC: real('temperature_c'),
    visibilityM: real('visibility_m'),
    ceilingM: real('ceiling_m'),
    outcome: text('outcome', { enum: FLIGHT_OUTCOME }),
    notes: text('notes'),
    mediaUrls: text('media_urls', { mode: 'json' }).$type<string[]>(),
    softGateWarnings: text('soft_gate_warnings', { mode: 'json' }).$type<string[]>(),
    proceededDespiteWarnings: integer('proceeded_despite_warnings', {
      mode: 'boolean',
    })
      .notNull()
      .default(false),
    ...auditColumns,
  },
  (t) => [
    index('ix_flights_flyer_id').on(t.flyerId),
    index('ix_flights_flown_at').on(t.flownAt),
    enumCheck('ck_flights_outcome', t.outcome, FLIGHT_OUTCOME),
  ],
)
