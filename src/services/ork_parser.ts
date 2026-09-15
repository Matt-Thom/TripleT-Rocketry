/**
 * OpenRocket (.ork) Airframe Parser Service (Requirement R2).
 *
 * Decompresses .ork ZIP archives, extracts and parses internal rocket.xml design documents,
 * converts MKS (SI) units to TripleT millimeters and grams, and extracts key airframe
 * specifications:
 * - Rocket name and stage configuration
 * - Overall length (mm)
 * - Maximum body diameter (mm)
 * - Dry mass / weight (g)
 * - Motor mount tube diameter (mm)
 * - Fin count and recovery device specifications
 *
 * Cloudflare Workers (workerd isolate) compatible: pure JavaScript, 0 native C++ addons,
 * no browser DOM dependencies.
 */

import { XMLParser, XMLValidator } from 'fast-xml-parser'
import * as fflate from 'fflate'

export class OrkParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OrkParseError'
  }
}

export interface ParsedOrkData {
  name: string
  lengthMm: number | null
  bodyDiameterMm: number | null
  dryMassG: number | null
  loadedMassG: number | null
  stabilityCalibers: number | null
  cgMm: number | null
  cpMm: number | null
  motorMountDiameterMm: number | null
  finCount: number | null
  recoveryType: 'dual_deploy' | 'parachute' | 'streamer' | 'other' | null
  parachuteSizeMm: number | null
  airframeMaterial: string | null
  stageCount: number
  stageNames: string[]
  notes: string
}

const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024 // 10 MB limit

function extractText(val: unknown): string | null {
  if (val === undefined || val === null) return null
  if (typeof val === 'string') {
    const s = val.trim()
    return s.length > 0 ? s : null
  }
  if (typeof val === 'number') return String(val)
  if (typeof val === 'object' && val !== null) {
    if ('#text' in val) return extractText((val as Record<string, unknown>)['#text'])
  }
  return null
}

function extractNumber(val: unknown): number | null {
  if (val === undefined || val === null) return null
  if (typeof val === 'number') return isNaN(val) ? null : val
  if (typeof val === 'string') {
    const n = Number(val.trim())
    return isNaN(n) ? null : n
  }
  if (typeof val === 'object' && val !== null) {
    if ('#text' in val) return extractNumber((val as Record<string, unknown>)['#text'])
  }
  return null
}

function getSubcomponentsList(
  container: unknown,
): Array<{ type: string; data: Record<string, unknown> }> {
  if (!container || typeof container !== 'object') return []
  const list: Array<{ type: string; data: Record<string, unknown> }> = []
  for (const [key, val] of Object.entries(container as Record<string, unknown>)) {
    if (key.startsWith('@_') || key === '#text') continue
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item === 'object') {
          list.push({ type: key.toLowerCase(), data: item as Record<string, unknown> })
        }
      }
    } else if (val && typeof val === 'object') {
      list.push({ type: key.toLowerCase(), data: val as Record<string, unknown> })
    }
  }
  return list
}

function findTagDeep(obj: unknown, tagNames: string[]): number | null {
  if (!obj || typeof obj !== 'object') return null
  const targets = tagNames.map((t) => t.toLowerCase())
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (targets.includes(k.toLowerCase())) {
      const num = extractNumber(v)
      if (num !== null && !isNaN(num)) return num
    }
    if (v && typeof v === 'object') {
      const found = findTagDeep(v, tagNames)
      if (found !== null) return found
    }
  }
  return null
}

/**
 * Parse an OpenRocket (.ork) ZIP archive buffer and extract airframe parameters.
 */
export async function parseOrkArchive(
  archiveBuffer: ArrayBuffer | Uint8Array,
  filename?: string,
): Promise<ParsedOrkData> {
  const bytes =
    archiveBuffer instanceof Uint8Array
      ? archiveBuffer
      : new Uint8Array(archiveBuffer)

  if (bytes.length === 0) {
    throw new OrkParseError('Please select an OpenRocket (.ork) file to upload.')
  }

  if (bytes.length > MAX_PAYLOAD_BYTES) {
    throw new OrkParseError('File exceeds maximum allowed size of 10 MB.')
  }

  // Verify ZIP magic bytes: PK\x03\x04 (0x50, 0x4B, 0x03, 0x04)
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 0x03 ||
    bytes[3] !== 0x04
  ) {
    throw new OrkParseError('Invalid file format: Uploaded file is not a valid ZIP/.ork archive.')
  }

  // Decompress ZIP archive
  let unzipped: Record<string, Uint8Array>
  try {
    unzipped = fflate.unzipSync(bytes)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'corrupted ZIP data'
    throw new OrkParseError(`Invalid file format: Failed to decompress ZIP archive (${msg}).`)
  }

  // Locate rocket.xml or rocket.ork
  const targetEntryKey = Object.keys(unzipped).find((k) => {
    const norm = k.toLowerCase().replace(/\\/g, '/')
    return (
      norm === 'rocket.xml' ||
      norm === 'rocket.ork' ||
      norm.endsWith('/rocket.xml') ||
      norm.endsWith('/rocket.ork')
    )
  })

  if (!targetEntryKey || !unzipped[targetEntryKey]) {
    throw new OrkParseError(
      "Invalid OpenRocket archive: No 'rocket.xml' design document found inside .ork file.",
    )
  }

  const xmlBytes = unzipped[targetEntryKey]
  const xmlText = fflate.strFromU8(xmlBytes)

  // Validate XML syntax before parsing
  const validation = XMLValidator.validate(xmlText)
  if (validation !== true) {
    const detail =
      typeof validation === 'object' && validation.err
        ? `${validation.err.msg} (line ${validation.err.line}, col ${validation.err.col})`
        : 'syntax error'
    throw new OrkParseError(
      `Malformed rocket design document: Unable to parse internal rocket.xml (${detail}).`,
    )
  }

  // Parse XML securely (disabling entity expansion to protect against XXE/Billion Laughs)
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    trimValues: true,
    processEntities: false,
  })

  let doc: any
  try {
    doc = parser.parse(xmlText)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'XML syntax error'
    throw new OrkParseError(`Malformed rocket design document: Unable to parse internal rocket.xml (${msg}).`)
  }

  const rawRoot = doc?.openrocket?.rocket ?? doc?.rocket
  if (rawRoot === undefined || rawRoot === null || (typeof rawRoot !== 'object' && rawRoot !== '')) {
    throw new OrkParseError(
      'Invalid OpenRocket file: The document does not contain an OpenRocket <rocket> specification.',
    )
  }
  const root = typeof rawRoot === 'object' && rawRoot !== null ? rawRoot : {}

  // Clean filename fallback
  const cleanFilename = filename
    ? filename.replace(/^.*[\\/]/, '').replace(/\.(ork|zip|xml)$/i, '').trim()
    : null

  // 1. Rocket Name
  const rawName = extractText(root.name)
  let rocketName = rawName || cleanFilename || 'Untitled Airframe'

  // 2. Stage Enumeration
  const stageList: Array<{ type: string; data: Record<string, unknown> }> = []

  // Check in root.subcomponents
  const directSubcomps = getSubcomponentsList(root.subcomponents)
  for (const c of directSubcomps) {
    if (c.type === 'stage' || c.type === 'axialstage') {
      stageList.push(c)
    }
  }

  // Also check if stages were direct children of root
  if (stageList.length === 0) {
    const rootChildren = getSubcomponentsList(root)
    for (const c of rootChildren) {
      if (c.type === 'stage' || c.type === 'axialstage') {
        stageList.push(c)
      }
    }
  }

  const stageNames: string[] = []
  if (stageList.length > 0) {
    stageList.forEach((s, idx) => {
      const sName = extractText(s.data.name) || `Stage ${idx + 1}`
      stageNames.push(sName)
    })
  } else {
    stageNames.push('Sustainer')
  }
  const stageCount = stageNames.length

  // If rocket name was missing and we have a stage name, use stage name if cleaner
  if (!rawName && stageNames.length === 1 && stageNames[0] !== 'Stage 1' && !cleanFilename) {
    rocketName = stageNames[0]
  }

  // 3. Components Traversal (Dimensions, Motor Mount, Fins, Recovery, Material, Mass)
  let totalLengthM = 0
  let maxRadiusM = 0
  let material: string | null = null
  let motorMountDiaM: number | null = null
  let finCount: number | null = null
  const parachutes: Array<{ diameterM: number | null }> = []
  let streamerCount = 0
  let componentMassSum = 0

  function checkRadius(data: Record<string, unknown>) {
    const radii = [
      extractNumber(data.radius),
      extractNumber(data.outerradius),
      extractNumber(data.aftradius),
      extractNumber(data.foreradius),
    ].filter((r): r is number => r !== null && r > 0)

    for (const r of radii) {
      if (r > maxRadiusM) maxRadiusM = r
    }

    const dias = [
      extractNumber(data.diameter),
      extractNumber(data.outerdiameter),
    ].filter((d): d is number => d !== null && d > 0)

    for (const d of dias) {
      if (d / 2 > maxRadiusM) maxRadiusM = d / 2
    }
  }

  function traverseComponent(comp: { type: string; data: Record<string, unknown> }) {
    const { type, data } = comp

    // Mass tracking on components
    const cMass = extractNumber(data.overridemass) ?? extractNumber(data.mass)
    if (cMass !== null && cMass > 0) {
      componentMassSum += cMass
    }

    // Body material (from first bodytube encountered)
    if (type === 'bodytube' && !material) {
      material = extractText(data.material)
    }

    // Fin count & specs
    if (type.includes('finset') || type === 'fins') {
      const count = extractNumber(data.instancecount) ?? extractNumber(data.fincount)
      if (count !== null && (finCount === null || count > finCount)) {
        finCount = Math.round(count)
      }
      finSets.push({
        finCount: count !== null ? Math.round(count) : null,
        rootChordM: extractNumber(data.rootchord) ?? extractNumber(data.length),
        tipChordM: extractNumber(data.tipchord),
        heightM: extractNumber(data.height) ?? extractNumber(data.semispan),
        sweepM: extractNumber(data.sweep) ?? extractNumber(data.sweeplength),
        rootPosM: null,
      })
    }

    // Parachute
    if (type === 'parachute') {
      const dia =
        extractNumber(data.diameter) ??
        (extractNumber(data.radius) !== null ? (extractNumber(data.radius)! * 2) : null)
      parachutes.push({ diameterM: dia })
    }

    // Streamer
    if (type === 'streamer') {
      streamerCount++
    }

    // Motor Mount detection
    const isMotorMount =
      data.motormount !== undefined ||
      (type === 'innertube' &&
        extractText(data.name)?.toLowerCase().includes('motor'))

    if (isMotorMount) {
      let dia: number | null = null
      const mmData = data.motormount as Record<string, unknown> | undefined

      if (mmData && typeof mmData === 'object') {
        const motorsList = Array.isArray(mmData.motor)
          ? mmData.motor
          : mmData.motor
            ? [mmData.motor]
            : []
        for (const m of motorsList) {
          if (m && typeof m === 'object') {
            const mObj = m as Record<string, unknown>
            if (dia === null) dia = extractNumber(mObj.diameter)
            const mMass =
              extractNumber(mObj.launchmass) ??
              extractNumber(mObj.totalmass) ??
              extractNumber(mObj.mass)
            if (mMass !== null && mMass > 0) {
              motorMassSum += mMass
            }
          }
        }
      }

      if (dia === null && data.innerradius !== undefined) {
        const ir = extractNumber(data.innerradius)
        if (ir !== null) dia = ir * 2
      }

      if (dia === null && data.innerdiameter !== undefined) {
        dia = extractNumber(data.innerdiameter)
      }

      if (dia === null && (data.radius !== undefined || data.outerradius !== undefined)) {
        const r = extractNumber(data.radius) ?? extractNumber(data.outerradius)
        if (r !== null) dia = r * 2
      }

      if (dia === null && (data.diameter !== undefined || data.outerdiameter !== undefined)) {
        dia = extractNumber(data.diameter) ?? extractNumber(data.outerdiameter)
      }

      if (dia !== null && dia > 0) {
        if (motorMountDiaM === null || dia > motorMountDiaM) {
          motorMountDiaM = dia
        }
      }
    }

    // Recursively process children
    if (data.subcomponents) {
      const children = getSubcomponentsList(data.subcomponents)
      for (const child of children) {
        traverseComponent(child)
      }
    }
  }

  const axialTypes = ['nosecone', 'bodytube', 'transition', 'tail']
  let currentAxialPos = 0
  let noseLenM = 0
  let cgMassWeightSum = 0
  const finSets: Array<{
    finCount: number | null
    rootChordM: number | null
    tipChordM: number | null
    heightM: number | null
    sweepM: number | null
    rootPosM: number | null
  }> = []
  let motorMassSum = 0

  if (stageList.length > 0) {
    for (const stage of stageList) {
      const comps = getSubcomponentsList(stage.data.subcomponents || stage.data)
      for (const comp of comps) {
        if (axialTypes.includes(comp.type)) {
          const len = extractNumber(comp.data.length)
          if (len !== null && len > 0) {
            totalLengthM += len
            if (comp.type === 'nosecone') {
              noseLenM = len
            }
            const cMass = extractNumber(comp.data.overridemass) ?? extractNumber(comp.data.mass)
            if (cMass !== null && cMass > 0) {
              const compCg = comp.type === 'nosecone' ? len * 0.55 : len * 0.5
              cgMassWeightSum += cMass * (currentAxialPos + compCg)
            }
            currentAxialPos += len
          }
          checkRadius(comp.data)
        }
        traverseComponent(comp)
      }
    }
  } else {
    const comps = getSubcomponentsList(root.subcomponents || root)
    for (const comp of comps) {
      if (axialTypes.includes(comp.type)) {
        const len = extractNumber(comp.data.length)
        if (len !== null && len > 0) {
          totalLengthM += len
          if (comp.type === 'nosecone') {
            noseLenM = len
          }
          const cMass = extractNumber(comp.data.overridemass) ?? extractNumber(comp.data.mass)
          if (cMass !== null && cMass > 0) {
            const compCg = comp.type === 'nosecone' ? len * 0.55 : len * 0.5
            cgMassWeightSum += cMass * (currentAxialPos + compCg)
          }
          currentAxialPos += len
        }
        checkRadius(comp.data)
      }
      traverseComponent(comp)
    }
  }

  // 4. Overrides check on root
  const rootOverrideLen = extractNumber(root.overridelength)
  if (rootOverrideLen !== null && rootOverrideLen > 0) {
    totalLengthM = rootOverrideLen
  }

  const rootOverrideDia = extractNumber(root.overridediameter)
  if (rootOverrideDia !== null && rootOverrideDia > 0) {
    maxRadiusM = rootOverrideDia / 2
  }

  // 5. Dry Mass
  let massKg: number | null = null
  const rootOverrideMass = extractNumber(root.overridemass)
  const rootMass = extractNumber(root.mass)

  if (rootOverrideMass !== null && rootOverrideMass > 0) {
    massKg = rootOverrideMass
  } else if (rootMass !== null && rootMass > 0) {
    massKg = rootMass
  } else if (stageList.length > 0) {
    let stageMassSum = 0
    let hasStageMass = false
    for (const stage of stageList) {
      const sm = extractNumber(stage.data.overridemass) ?? extractNumber(stage.data.mass)
      if (sm !== null && sm > 0) {
        stageMassSum += sm
        hasStageMass = true
      }
    }
    if (hasStageMass) {
      massKg = stageMassSum
    }
  }

  if (massKg === null && componentMassSum > 0) {
    massKg = componentMassSum
  }

  // Unit conversions: SI (meters, kg) -> mm, grams
  const lengthMm = totalLengthM > 0 ? Math.round(totalLengthM * 1000 * 10) / 10 : null
  const bodyDiameterMm = maxRadiusM > 0 ? Math.round(maxRadiusM * 2000 * 10) / 10 : null
  const dryMassG = massKg !== null && massKg > 0 ? Math.round(massKg * 1000 * 10) / 10 : null
  const motorMountDiameterMm =
    motorMountDiaM !== null && motorMountDiaM > 0
      ? Math.round(motorMountDiaM * 1000 * 10) / 10
      : null

  // 6. Stability & CG / CP Extraction
  let stabilityCalibers: number | null = null
  let cgMm: number | null = null
  let cpMm: number | null = null

  // Check explicit stability tags anywhere in document (e.g. simulations, conditions, root)
  const explicitStability = findTagDeep(doc, [
    'stabilitycalibers',
    'stabilitymargin',
    'launchstability',
    'staticmargin',
    'stability',
    'initialstability',
  ])

  if (explicitStability !== null && !isNaN(explicitStability)) {
    stabilityCalibers = Math.round(explicitStability * 100) / 100
  }

  // Check explicit CG and CP
  const explicitCg = findTagDeep(doc, ['overridecg', 'cg'])
  const explicitCp = findTagDeep(doc, ['overridecp', 'cp'])

  if (explicitCg !== null && explicitCg > 0) {
    cgMm = Math.round(explicitCg * 1000 * 10) / 10
  }
  if (explicitCp !== null && explicitCp > 0) {
    cpMm = Math.round(explicitCp * 1000 * 10) / 10
  }

  if (stabilityCalibers === null && explicitCg !== null && explicitCp !== null && maxRadiusM > 0) {
    stabilityCalibers = Math.round(((explicitCp - explicitCg) / (maxRadiusM * 2)) * 100) / 100
  }

  // If stability is still null, compute using Barrowman CP and component-weighted CG
  if (stabilityCalibers === null && maxRadiusM > 0 && totalLengthM > 0) {
    const refDiameterM = maxRadiusM * 2
    let cnaTotal = 2.0 // Nose cone CNA = 2
    let cnaXcpSum = 2.0 * (0.466 * (noseLenM > 0 ? noseLenM : totalLengthM * 0.25))

    for (const f of finSets) {
      const n = f.finCount || finCount || 4
      const cr = f.rootChordM && f.rootChordM > 0 ? f.rootChordM : 0.12 * totalLengthM
      const ct = f.tipChordM && f.tipChordM > 0 ? f.tipChordM : cr * 0.5
      const s = f.heightM && f.heightM > 0 ? f.heightM : maxRadiusM * 1.5
      const xr = f.sweepM && f.sweepM > 0 ? f.sweepM : cr * 0.4
      const xRoot = f.rootPosM && f.rootPosM > 0 ? f.rootPosM : Math.max(0, totalLengthM - cr)

      const r = maxRadiusM
      const lm = Math.sqrt(xr * xr + Math.pow(cr / 2 - ct / 2, 2) + s * s)
      const cnaFin =
        (1 + r / (s + r)) *
        ((4 * n * Math.pow(s / refDiameterM, 2)) /
          (1 + Math.sqrt(1 + Math.pow((2 * lm) / (cr + ct), 2))))

      const xf =
        xRoot +
        (xr * (cr + 2 * ct)) / (3 * (cr + ct)) +
        (1 / 6) * (cr + ct - (cr * ct) / (cr + ct))

      cnaTotal += cnaFin
      cnaXcpSum += cnaFin * xf
    }

    const calculatedCpM = cnaXcpSum / cnaTotal
    const calculatedCgM =
      cgMassWeightSum > 0 && componentMassSum > 0
        ? cgMassWeightSum / componentMassSum
        : totalLengthM * 0.58

    if (calculatedCpM > 0 && calculatedCgM > 0) {
      if (cpMm === null) cpMm = Math.round(calculatedCpM * 1000 * 10) / 10
      if (cgMm === null) cgMm = Math.round(calculatedCgM * 1000 * 10) / 10
      stabilityCalibers = Math.round(((calculatedCpM - calculatedCgM) / refDiameterM) * 100) / 100
    }
  }

  // 7. Loaded Mass
  let loadedMassKg: number | null = null
  const explicitLaunchMass = findTagDeep(doc, [
    'launchmass',
    'loadedmass',
    'liftoffmass',
    'launch_mass',
  ])

  if (explicitLaunchMass !== null && explicitLaunchMass > 0) {
    loadedMassKg = explicitLaunchMass
  } else if (motorMassSum > 0 && massKg !== null) {
    loadedMassKg = massKg + motorMassSum
  } else if (massKg !== null && massKg > 0) {
    loadedMassKg = massKg
  }

  const loadedMassG =
    loadedMassKg !== null && loadedMassKg > 0
      ? Math.round(loadedMassKg * 1000 * 10) / 10
      : null

  // Recovery Determination
  let recoveryType: 'dual_deploy' | 'parachute' | 'streamer' | 'other' | null = null
  let parachuteSizeMm: number | null = null

  if (parachutes.length >= 2 || (parachutes.length >= 1 && streamerCount >= 1)) {
    recoveryType = 'dual_deploy'
  } else if (parachutes.length === 1) {
    recoveryType = 'parachute'
  } else if (streamerCount > 0) {
    recoveryType = 'streamer'
  }

  if (parachutes.length > 0) {
    const validChuteDias = parachutes
      .map((p) => p.diameterM)
      .filter((d): d is number => d !== null && d > 0)
    if (validChuteDias.length > 0) {
      const maxDiaM = Math.max(...validChuteDias)
      parachuteSizeMm = Math.round(maxDiaM * 1000 * 10) / 10
    }
  }

  // Provenance Notes
  const filePart = filename ? `: ${filename}` : ''
  const notes = `Imported from OpenRocket (.ork)${filePart}. Stages: ${stageCount} (${stageNames.join(', ')}).`

  return {
    name: rocketName,
    lengthMm,
    bodyDiameterMm,
    dryMassG,
    loadedMassG,
    stabilityCalibers,
    cgMm,
    cpMm,
    motorMountDiameterMm,
    finCount,
    recoveryType,
    parachuteSizeMm,
    airframeMaterial: material,
    stageCount,
    stageNames,
    notes,
  }
}
