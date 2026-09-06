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

/**
 * Parses raw CSV text according to RFC 4180 rules.
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
          rows.push(currentRow)
        }
        currentRow = []
        i++
      } else if (char === '\n') {
        currentRow.push(currentField.trim())
        currentField = ''
        if (currentRow.some((f) => f !== '')) {
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
  currentRow.push(currentField.trim())
  if (currentRow.some((f) => f !== '')) {
    rows.push(currentRow)
  }

  return rows
}

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
    if (totalImpulseNs <= 1.25) return 'A'
    if (totalImpulseNs <= 2.5) return 'A'
    if (totalImpulseNs <= 5.0) return 'B'
    if (totalImpulseNs <= 10.0) return 'C'
    if (totalImpulseNs <= 20.0) return 'D'
    if (totalImpulseNs <= 40.0) return 'E'
    if (totalImpulseNs <= 80.0) return 'F'
    if (totalImpulseNs <= 160.0) return 'G'
    if (totalImpulseNs <= 320.0) return 'H'
    if (totalImpulseNs <= 640.0) return 'I'
    if (totalImpulseNs <= 1280.0) return 'J'
    if (totalImpulseNs <= 2560.0) return 'K'
    if (totalImpulseNs <= 5120.0) return 'L'
    if (totalImpulseNs <= 10240.0) return 'M'
    if (totalImpulseNs <= 20480.0) return 'N'
    return 'O'
  }

  if (model) {
    const match = model.trim().toUpperCase().match(/^([A-O])/i)
    if (match) return match[1].toUpperCase()
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
  if (str === '') return null
  if (/^p(lugged)?$/i.test(str)) {
    return 0
  }
  const num = parseFloat(str)
  if (!isNaN(num)) return num
  return 0
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
  if (str === '') return null
  const n = parseFloat(str)
  return isNaN(n) ? null : n
}

/**
 * Parses integer values or returns null if invalid.
 */
function parseIntNumber(val?: string | null): number | null {
  if (val === undefined || val === null) return null
  const str = String(val).trim()
  if (str === '') return null
  const n = parseInt(str, 10)
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

  const rows = parseCsvRows(csvContent)
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
      if (idx !== undefined && idx < row.length && row[idx] !== '') {
        return row[idx].trim()
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
 */
export async function importMotorsToDb(
  db: any,
  motors: ParsedMotor[],
): Promise<MotorImportResult> {
  let importedCount = 0
  let updatedCount = 0
  const errors: string[] = []

  // Process motors in batches
  const batchSize = 15
  for (let i = 0; i < motors.length; i += batchSize) {
    const chunk = motors.slice(i, i + batchSize)

    for (const motor of chunk) {
      try {
        // Query to check if motor already exists by unique key (manufacturer, model, delay_s)
        const query = motor.delayS !== null && motor.delayS !== undefined
          ? db
              .select({ id: schema.motors.id })
              .from(schema.motors)
              .where(
                and(
                  eq(schema.motors.manufacturer, motor.manufacturer),
                  eq(schema.motors.model, motor.model),
                  eq(schema.motors.delayS, motor.delayS),
                ),
              )
              .limit(1)
          : db
              .select({ id: schema.motors.id })
              .from(schema.motors)
              .where(
                and(
                  eq(schema.motors.manufacturer, motor.manufacturer),
                  eq(schema.motors.model, motor.model),
                  isNull(schema.motors.delayS),
                ),
              )
              .limit(1)

        const [existing] = await query

        if (existing) {
          // Update existing motor record
          await db
            .update(schema.motors)
            .set({
              partNumber: motor.partNumber,
              diameterMm: motor.diameterMm,
              hardware: motor.hardware,
              casingReusable: motor.casingReusable,
              totalImpulseNs: motor.totalImpulseNs,
              impulseClass: motor.impulseClass as any,
              averageThrustN: motor.averageThrustN,
              maxThrustN: motor.maxThrustN,
              propellantType: motor.propellantType,
              grains: motor.grains,
              propellantWeightG: motor.propellantWeightG,
              grainWeightG: motor.grainWeightG,
              weightG: motor.weightG,
              unNumber: motor.unNumber,
              hazardClassification: motor.hazardClassification,
              lengthMm: motor.lengthMm,
              burnTimeS: motor.burnTimeS,
              uspsMailable: motor.uspsMailable,
              notes: motor.notes,
              updatedAt: Date.now(),
            })
            .where(eq(schema.motors.id, existing.id))

          updatedCount++
        } else {
          // Insert new motor record
          await db.insert(schema.motors).values({
            manufacturer: motor.manufacturer,
            model: motor.model,
            partNumber: motor.partNumber,
            diameterMm: motor.diameterMm,
            hardware: motor.hardware,
            casingReusable: motor.casingReusable,
            totalImpulseNs: motor.totalImpulseNs,
            impulseClass: motor.impulseClass as any,
            averageThrustN: motor.averageThrustN,
            maxThrustN: motor.maxThrustN,
            propellantType: motor.propellantType,
            grains: motor.grains,
            propellantWeightG: motor.propellantWeightG,
            grainWeightG: motor.grainWeightG,
            weightG: motor.weightG,
            unNumber: motor.unNumber,
            hazardClassification: motor.hazardClassification,
            lengthMm: motor.lengthMm,
            burnTimeS: motor.burnTimeS,
            delayS: motor.delayS,
            uspsMailable: motor.uspsMailable,
            notes: motor.notes,
          })

          importedCount++
        }
      } catch (err) {
        errors.push(
          `Failed to process ${motor.manufacturer} ${motor.model}: ${err instanceof Error ? err.message : String(err)}`,
        )
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
