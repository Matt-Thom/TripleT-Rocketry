/**
 * Motor Product CSV Import Service (`src/services/motor_import.ts`).
 *
 * Implements:
 * 1. RFC 4180 compliant CSV parser supporting quotes, commas, multiline cells, and CRLF/LF line breaks.
 * 2. 20-column schema parser and transformation engine matching:
 *    Part_Number, Designation_Product_Name, Manufacturer, Diameter_mm, Hardware,
 *    Total_Impulse_Ns, Avg_Thrust_N, Peak_Thrust_N, Propellant_Type, Grains,
 *    Propellant_Weight_g, Grain_Weight_g, Total_Weight_g, UN_Number, Classification,
 *    Length, Thrust_Duration_Sec, Delay_Sec, USPS_Mailable, Notes
 * 3. Dynamic impulse class calculation (A through O) based on total impulse (N·s).
 * 4. Propellant type normalization to SQLite check-constraint compliant enums.
 * 5. Type coercion for numeric measurements, plugged delays ("P" / "0"), and boolean mailability.
 * 6. Batch database insertion and upsert conflict resolution on (manufacturer, model, delay_s).
 */

import { eq, and, isNull, sql } from 'drizzle-orm'
import * as schema from '../db/schema'

export interface ParsedMotor {
  partNumber?: string | null
  model: string
  manufacturer: string
  diameterMm?: number | null
  hardware?: string | null
  casingReusable: boolean
  totalImpulseNs?: number | null
  impulseClass?: string | null
  averageThrustN?: number | null
  maxThrustN?: number | null
  propellantType: 'black_powder' | 'apcp' | 'hybrid' | 'other'
  grains?: number | null
  propellantWeightG?: number | null
  grainWeightG?: number | null
  weightG?: number | null
  unNumber?: string | null
  hazardClassification?: string | null
  lengthMm?: number | null
  burnTimeS?: number | null
  delayS?: number | null
  uspsMailable: boolean
  notes?: string | null
}

export interface MotorImportResult {
  success: boolean
  total: number
  imported: number
  updated: number
  errors: string[]
}

export const MAX_CSV_ROWS = 5000

/**
 * Parses raw CSV text according to RFC 4180 rules.
 * Enforces a bounded row count to prevent CPU/memory exhaustion (BL-15).
 */
export function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentField = ''
  let inQuotes = false
  let i = 0

  while (i < csvText.length) {
    const char = csvText[i]

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < csvText.length && csvText[i + 1] === '"') {
          // Escaped quote ("") inside quotes
          currentField += '"'
          i += 2
        } else {
          // Closing quote
          inQuotes = false
          i++
        }
      } else {
        currentField += char
        i++
      }
    } else {
      if (char === '"') {
        inQuotes = true
        i++
      } else if (char === ',') {
        currentRow.push(currentField.trim())
        currentField = ''
        i++
      } else if (char === '\r') {
        if (i + 1 < csvText.length && csvText[i + 1] === '\n') {
          i++
        }
        currentRow.push(currentField.trim())
        currentField = ''
        if (currentRow.some((f) => f !== '')) {
          if (rows.length >= MAX_CSV_ROWS) {
            throw new Error(`CSV row count exceeds maximum allowed limit (${MAX_CSV_ROWS} rows)`)
          }
          rows.push(currentRow)
        }
        currentRow = []
        i++
      } else if (char === '\n') {
        currentRow.push(currentField.trim())
        currentField = ''
        if (currentRow.some((f) => f !== '')) {
          if (rows.length >= MAX_CSV_ROWS) {
            throw new Error(`CSV row count exceeds maximum allowed limit (${MAX_CSV_ROWS} rows)`)
          }
          rows.push(currentRow)
        }
        currentRow = []
        i++
      } else {
        currentField += char
        i++
      }
    }
  }

  // Final field and row if any
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField.trim())
    if (currentRow.some((f) => f !== '')) {
      if (rows.length >= MAX_CSV_ROWS) {
        throw new Error(`CSV row count exceeds maximum allowed limit (${MAX_CSV_ROWS} rows)`)
      }
      rows.push(currentRow)
    }
  }

  return rows
}

const VALID_IMPULSE_CLASSES = new Set([
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O',
])

/**
 * Dynamically calculates impulse class (A–O) from total impulse (N·s) or designation.
 */
export function calculateImpulseClass(
  totalImpulseNs?: number | null,
  model?: string | null,
): string | null {
  if (
    totalImpulseNs !== undefined &&
    totalImpulseNs !== null &&
    !isNaN(totalImpulseNs) &&
    totalImpulseNs > 0
  ) {
    let cls: string | null = null
    if (totalImpulseNs <= 1.25) cls = 'A'
    else if (totalImpulseNs <= 2.5) cls = 'A'
    else if (totalImpulseNs <= 5.0) cls = 'B'
    else if (totalImpulseNs <= 10.0) cls = 'C'
    else if (totalImpulseNs <= 20.0) cls = 'D'
    else if (totalImpulseNs <= 40.0) cls = 'E'
    else if (totalImpulseNs <= 80.0) cls = 'F'
    else if (totalImpulseNs <= 160.0) cls = 'G'
    else if (totalImpulseNs <= 320.0) cls = 'H'
    else if (totalImpulseNs <= 640.0) cls = 'I'
    else if (totalImpulseNs <= 1280.0) cls = 'J'
    else if (totalImpulseNs <= 2560.0) cls = 'K'
    else if (totalImpulseNs <= 5120.0) cls = 'L'
    else if (totalImpulseNs <= 10240.0) cls = 'M'
    else if (totalImpulseNs <= 20480.0) cls = 'N'
    else if (totalImpulseNs <= 40960.0) cls = 'O'

    if (cls && VALID_IMPULSE_CLASSES.has(cls)) return cls
  }

  if (model) {
    const trimmed = model.trim().toUpperCase()
    // 1. Fractional motors like 1/2A6-2, 1/4A3-3T -> 'A'
    const fracMatch = trimmed.match(/^\d+\/\d+([A-O])/i)
    if (fracMatch && VALID_IMPULSE_CLASSES.has(fracMatch[1].toUpperCase())) {
      return fracMatch[1].toUpperCase()
    }

    // 2. Standard designations: H128W, J350, C6-5 -> starts with [A-O] followed by digit
    const stdMatch = trimmed.match(/^([A-O])\d+/i)
    if (stdMatch && VALID_IMPULSE_CLASSES.has(stdMatch[1].toUpperCase())) {
      return stdMatch[1].toUpperCase()
    }

    // 3. CTI / Cesaroni style: 640J120-14A, 154G80 -> number prefix followed by class letter and digits
    const ctiMatch = trimmed.match(/^\d+([A-O])\d+/i)
    if (ctiMatch && VALID_IMPULSE_CLASSES.has(ctiMatch[1].toUpperCase())) {
      return ctiMatch[1].toUpperCase()
    }

    // 4. Any letter A-O followed by digits anywhere after a separator, e.g. "RMS-29/180-H128W" or "Pro38-H153"
    const sepMatch = trimmed.match(/(?:^|[-/_\s])([A-O])\d+/i)
    if (sepMatch && VALID_IMPULSE_CLASSES.has(sepMatch[1].toUpperCase())) {
      return sepMatch[1].toUpperCase()
    }

    // 5. Fallback: single letter at start if it's A-O
    const fallbackMatch = trimmed.match(/^([A-O])/i)
    if (fallbackMatch && VALID_IMPULSE_CLASSES.has(fallbackMatch[1].toUpperCase())) {
      return fallbackMatch[1].toUpperCase()
    }
  }

  return null
}

/**
 * Normalizes commercial propellant names to SQLite check-constraint compliant types.
 */
export function normalizePropellantType(
  val?: string | null,
): 'black_powder' | 'apcp' | 'hybrid' | 'other' {
  if (!val) return 'other'
  const lower = val.toLowerCase().trim()
  if (lower === 'black_powder' || lower === 'black powder' || lower === 'bp') {
    return 'black_powder'
  }
  if (lower === 'hybrid') {
    return 'hybrid'
  }
  if (
    lower === 'apcp' ||
    lower.includes('apcp') ||
    lower.includes('composite') ||
    lower.includes('white lightning') ||
    lower.includes('black jack') ||
    lower.includes('redline') ||
    lower.includes('blue streak') ||
    lower.includes('mojave green') ||
    lower.includes('skidmark') ||
    lower.includes('aerotech') ||
    lower.includes('cesaroni') ||
    lower.includes('c-star') ||
    lower.includes('warp')
  ) {
    return 'apcp'
  }
  if (lower === 'other') return 'other'
  return 'other'
}

/**
 * Parses delay seconds: handles numbers, plugged designation ("P" / "Plugged" -> 0), or null.
 */
export function parseDelay(val?: string | null): number | null {
  if (val === undefined || val === null) return null
  const str = String(val).trim()
  if (str === '' || /^(none|n\/?a|-|null|undefined)$/i.test(str)) return null
  if (/^p(lugged)?$/i.test(str)) {
    return 0
  }
  const numMatch = str.match(/^[-+]?[0-9]*\.?[0-9]+/)
  if (numMatch) {
    const num = parseFloat(numMatch[0])
    if (!isNaN(num)) return num
  }
  return null
}

/**
 * Parses boolean flags from strings ("true", "1", "yes", "y").
 */
export function parseBoolean(val?: any): boolean {
  if (typeof val === 'boolean') return val
  if (!val) return false
  const lower = String(val).trim().toLowerCase()
  return ['true', '1', 'yes', 'y'].includes(lower)
}

/**
 * Determines whether casing is reusable based on hardware description.
 */
export function parseCasingReusable(hardware?: string | null): boolean {
  if (!hardware) return false
  const trimmed = hardware.trim()
  if (/single[ -]?use/i.test(trimmed)) return false
  if (/^su$/i.test(trimmed)) return false
  return true
}

/**
 * Parses numeric floating-point values or returns null if invalid.
 */
function parseNumber(val?: string | null): number | null {
  if (val === undefined || val === null) return null
  const str = String(val).trim()
  if (str === '' || /^(none|n\/?a|-|null|undefined)$/i.test(str)) return null
  const match = str.match(/[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/)
  if (!match) return null
  const n = parseFloat(match[0])
  return isNaN(n) ? null : n
}

/**
 * Parses integer values or returns null if invalid.
 */
function parseIntNumber(val?: string | null): number | null {
  if (val === undefined || val === null) return null
  const str = String(val).trim()
  if (str === '' || /^(none|n\/?a|-|null|undefined)$/i.test(str)) return null
  const match = str.match(/[-+]?[0-9]+/)
  if (!match) return null
  const n = parseInt(match[0], 10)
  return isNaN(n) ? null : n
}

/**
 * Parses motor CSV content into typed `ParsedMotor` structures with schema validation.
 */
export function parseMotorsCsv(csvContent: string): {
  motors: ParsedMotor[]
  errors: string[]
  error?: string
} {
  if (!csvContent || csvContent.trim() === '') {
    return {
      motors: [],
      errors: ['Empty CSV data submitted: no data to import'],
      error: 'Empty CSV data submitted: no data to import',
    }
  }

  let rows: string[][]
  try {
    rows = parseCsvRows(csvContent)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      motors: [],
      errors: [msg],
      error: msg,
    }
  }

  if (rows.length < 2) {
    return {
      motors: [],
      errors: ['CSV must contain a header row and at least one data row'],
      error: 'CSV must contain a header row and at least one data row',
    }
  }

  const headerRow = rows[0]
  const headerMap: Record<string, number> = {}
  headerRow.forEach((col, idx) => {
    const clean = col.toLowerCase().replace(/[^a-z0-9]/g, '')
    headerMap[clean] = idx
  })

  // Verify presence of critical required columns
  const hasPartNumber = headerMap['partnumber'] !== undefined
  const hasModel =
    headerMap['designationproductname'] !== undefined ||
    headerMap['designation'] !== undefined ||
    headerMap['model'] !== undefined ||
    headerMap['productname'] !== undefined
  const hasManufacturer =
    headerMap['manufacturer'] !== undefined || headerMap['mfr'] !== undefined
  const hasTotalImpulse =
    headerMap['totalimpulsens'] !== undefined ||
    headerMap['totalimpulse'] !== undefined ||
    headerMap['impulse'] !== undefined

  if (!hasPartNumber || !hasModel || !hasManufacturer || !hasTotalImpulse) {
    const missing: string[] = []
    if (!hasPartNumber) missing.push('Part_Number')
    if (!hasModel) missing.push('Designation_Product_Name')
    if (!hasManufacturer) missing.push('Manufacturer')
    if (!hasTotalImpulse) missing.push('Total_Impulse_Ns')

    return {
      motors: [],
      errors: [
        `Missing required CSV header columns: expected 20-column schema. Missing: ${missing.join(', ')}`,
      ],
      error: `Missing required CSV header columns: ${missing.join(', ')}`,
    }
  }

  const getCol = (row: string[], ...keys: string[]): string | null => {
    for (const k of keys) {
      const idx = headerMap[k.toLowerCase().replace(/[^a-z0-9]/g, '')]
      if (idx !== undefined && idx < row.length) {
        const val = row[idx].trim()
        if (val !== '' && !/^(none|n\/?a|-|null|undefined)$/i.test(val)) {
          return val
        }
      }
    }
    return null
  }

  const motors: ParsedMotor[] = []
  const errors: string[] = []

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (row.length === 0 || row.every((c) => c === '')) continue

    const partNumber = getCol(row, 'part_number', 'partnumber')
    const model = getCol(row, 'designation_product_name', 'designation', 'model', 'product_name')
    const manufacturer = getCol(row, 'manufacturer', 'mfr')

    if (!model || !manufacturer) {
      errors.push(`Row ${r}: Missing model or manufacturer`)
      continue
    }

    const diameterMm = parseNumber(getCol(row, 'diameter_mm', 'diameter'))
    const hardware = getCol(row, 'hardware')
    const casingReusable = parseCasingReusable(hardware)
    const totalImpulseNs = parseNumber(getCol(row, 'total_impulse_ns', 'total_impulse', 'impulse'))
    const impulseClass = calculateImpulseClass(totalImpulseNs, model)
    const averageThrustN = parseNumber(getCol(row, 'avg_thrust_n', 'average_thrust_n', 'avg_thrust'))
    const maxThrustN = parseNumber(getCol(row, 'peak_thrust_n', 'peak_thrust', 'max_thrust_n'))
    const rawPropellant = getCol(row, 'propellant_type', 'propellant')
    const propellantType = normalizePropellantType(rawPropellant)
    const grains = parseIntNumber(getCol(row, 'grains'))
    const propellantWeightG = parseNumber(getCol(row, 'propellant_weight_g', 'propellant_weight'))
    const grainWeightG = parseNumber(getCol(row, 'grain_weight_g', 'grain_weight'))
    const weightG = parseNumber(getCol(row, 'total_weight_g', 'total_weight', 'weight'))
    const unNumber = getCol(row, 'un_number', 'un')
    const hazardClassification = getCol(row, 'classification', 'hazard_classification')
    const lengthMm = parseNumber(getCol(row, 'length', 'length_mm'))
    const burnTimeS = parseNumber(getCol(row, 'thrust_duration_sec', 'thrust_duration', 'burn_time_s'))
    const delayS = parseDelay(getCol(row, 'delay_sec', 'delay_s', 'delay'))
    const uspsMailable = parseBoolean(getCol(row, 'usps_mailable', 'mailable'))
    const notes = getCol(row, 'notes')

    motors.push({
      partNumber,
      model,
      manufacturer,
      diameterMm,
      hardware,
      casingReusable,
      totalImpulseNs,
      impulseClass,
      averageThrustN,
      maxThrustN,
      propellantType,
      grains,
      propellantWeightG,
      grainWeightG,
      weightG,
      unNumber,
      hazardClassification,
      lengthMm,
      burnTimeS,
      delayS,
      uspsMailable,
      notes,
    })
  }

  return { motors, errors }
}

/**
 * Imports parsed motors into the D1 database with upsert / conflict resolution.
 *
 * Employs:
 * 1. Single pre-fetch of existing active motors into an in-memory Map to avoid
 *    N+1 subrequests, preventing Cloudflare Worker 1,000 subrequest limit exhaustion.
 * 2. In-memory duplicate resolution so duplicate rows within the same CSV payload
 *    are cleanly handled as upserts rather than throwing UNIQUE constraint violations.
 * 3. Batch execution in chunks via db.batch() where available (mapping to D1 batch),
 *    with per-item fallback if a chunk encounters a malformed row.
 */
export async function importMotorsToDb(
  db: any,
  motors: ParsedMotor[],
): Promise<MotorImportResult> {
  let importedCount = 0
  let updatedCount = 0
  const errors: string[] = []

  if (motors.length === 0) {
    return {
      success: true,
      total: 0,
      imported: 0,
      updated: 0,
      errors: [],
    }
  }

  // 1. Single pre-fetch of existing motors to avoid subrequest exhaustion
  const makeKey = (mfr: string, mdl: string, delay: number | null | undefined): string => {
    const normMfr = (mfr || '').trim().toLowerCase()
    const normMdl = (mdl || '').trim().toLowerCase()
    const normDelay =
      delay !== null && delay !== undefined && !isNaN(delay) ? Number(delay) : 'null'
    return `${normMfr}:::${normMdl}:::${normDelay}`
  }

  const existingMap = new Map<string, string>()
  try {
    const existingMotors = await db
      .select({
        id: schema.motors.id,
        manufacturer: schema.motors.manufacturer,
        model: schema.motors.model,
        delayS: schema.motors.delayS,
      })
      .from(schema.motors)
      .where(isNull(schema.motors.deletedAt))

    for (const m of existingMotors) {
      existingMap.set(makeKey(m.manufacturer, m.model, m.delayS), m.id)
    }
  } catch (err) {
    // If pre-fetch fails, log and continue with empty existingMap
    console.warn('Pre-fetch of existing motors failed, will attempt direct operations:', err)
  }

  // 2. Plan operations: classify each motor as insert or update, resolving intra-batch duplicates
  type PlannedOp = {
    type: 'insert' | 'update'
    id: string
    motor: ParsedMotor
    buildQuery: () => any
  }

  const plannedOps: PlannedOp[] = []

  for (const motor of motors) {
    const key = makeKey(motor.manufacturer, motor.model, motor.delayS)
    const existingId = existingMap.get(key)

    if (existingId) {
      // Plan update
      const updateData = {
        partNumber: motor.partNumber ?? null,
        diameterMm: motor.diameterMm ?? null,
        hardware: motor.hardware ?? null,
        casingReusable: motor.casingReusable ?? false,
        totalImpulseNs: motor.totalImpulseNs ?? null,
        impulseClass: (motor.impulseClass as any) ?? null,
        averageThrustN: motor.averageThrustN ?? null,
        maxThrustN: motor.maxThrustN ?? null,
        propellantType: motor.propellantType,
        grains: motor.grains ?? null,
        propellantWeightG: motor.propellantWeightG ?? null,
        grainWeightG: motor.grainWeightG ?? null,
        weightG: motor.weightG ?? null,
        unNumber: motor.unNumber ?? null,
        hazardClassification: motor.hazardClassification ?? null,
        lengthMm: motor.lengthMm ?? null,
        burnTimeS: motor.burnTimeS ?? null,
        uspsMailable: motor.uspsMailable ?? false,
        notes: motor.notes ?? null,
        updatedAt: Date.now(),
      }

      plannedOps.push({
        type: 'update',
        id: existingId,
        motor,
        buildQuery: () =>
          db
            .update(schema.motors)
            .set(updateData)
            .where(eq(schema.motors.id, existingId)),
      })
    } else {
      // Plan insert
      const newId = crypto.randomUUID()
      // Immediately register in map so subsequent identical rows in the CSV update this row
      existingMap.set(key, newId)

      const insertData = {
        id: newId,
        manufacturer: motor.manufacturer,
        model: motor.model,
        partNumber: motor.partNumber ?? null,
        diameterMm: motor.diameterMm ?? null,
        hardware: motor.hardware ?? null,
        casingReusable: motor.casingReusable ?? false,
        totalImpulseNs: motor.totalImpulseNs ?? null,
        impulseClass: (motor.impulseClass as any) ?? null,
        averageThrustN: motor.averageThrustN ?? null,
        maxThrustN: motor.maxThrustN ?? null,
        propellantType: motor.propellantType,
        grains: motor.grains ?? null,
        propellantWeightG: motor.propellantWeightG ?? null,
        grainWeightG: motor.grainWeightG ?? null,
        weightG: motor.weightG ?? null,
        unNumber: motor.unNumber ?? null,
        hazardClassification: motor.hazardClassification ?? null,
        lengthMm: motor.lengthMm ?? null,
        burnTimeS: motor.burnTimeS ?? null,
        delayS: motor.delayS ?? null,
        uspsMailable: motor.uspsMailable ?? false,
        notes: motor.notes ?? null,
      }

      plannedOps.push({
        type: 'insert',
        id: newId,
        motor,
        buildQuery: () => db.insert(schema.motors).values(insertData),
      })
    }
  }

  // 3. Execute operations in chunks (batch size 50 to optimize subrequests)
  const CHUNK_SIZE = 50
  for (let i = 0; i < plannedOps.length; i += CHUNK_SIZE) {
    const chunk = plannedOps.slice(i, i + CHUNK_SIZE)

    let batchSucceeded = false
    if (typeof db.batch === 'function') {
      try {
        const batchQueries = chunk.map((op) => op.buildQuery())
        await db.batch(batchQueries as any)
        for (const op of chunk) {
          if (op.type === 'insert') importedCount++
          else updatedCount++
        }
        batchSucceeded = true
      } catch (batchErr) {
        // Batch failed, fall back to individual query execution for this chunk
        batchSucceeded = false
      }
    }

    if (!batchSucceeded) {
      for (const op of chunk) {
        try {
          await op.buildQuery()
          if (op.type === 'insert') importedCount++
          else updatedCount++
        } catch (singleErr) {
          errors.push(
            `Failed to process ${op.motor.manufacturer} ${op.motor.model}: ${singleErr instanceof Error ? singleErr.message : String(singleErr)}`,
          )
        }
      }
    }
  }

  return {
    success: errors.length === 0,
    total: motors.length,
    imported: importedCount,
    updated: updatedCount,
    errors,
  }
}

/**
 * End-to-end motor CSV import handler.
 */
export async function importMotorsFromCsv(
  db: any,
  csvContent: string,
): Promise<MotorImportResult> {
  const parseResult = parseMotorsCsv(csvContent)
  if (parseResult.error || parseResult.motors.length === 0) {
    return {
      success: false,
      total: 0,
      imported: 0,
      updated: 0,
      errors: parseResult.errors,
    }
  }

  return importMotorsToDb(db, parseResult.motors)
}
