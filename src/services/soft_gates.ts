/**
 * Domain preflight soft-gate safety rules evaluation service.
 *
 * Evaluates non-blocking safety rules per PROJECT.md § Interface Contracts:
 * 1. Motor impulse class vs flyer certification level:
 *    - Class A-G: Level 0 (no certification required)
 *    - Class H-I: Level 1 (warning if flyerCertLevel < 1)
 *    - Class J-L: Level 2 (warning if flyerCertLevel < 2)
 *    - Class M-O: Level 3 (warning if flyerCertLevel < 3)
 * 2. Aerodynamic stability margin:
 *    - Warning if stabilityCalibers < 1.0 caliber threshold
 * 3. Airspace waiver ceiling:
 *    - Warning if expectedAltitudeM > siteMaxAltitudeM
 *
 * Returns an array of human-readable warning strings. An empty array indicates
 * a fully compliant, safe preflight configuration.
 */

export interface SoftGateInput {
  flyerCertLevel: number
  motorImpulseClass?: string | null
  motorLabel?: string | null
  stabilityCalibers?: number | null
  expectedAltitudeM?: number | null
  siteMaxAltitudeM?: number | null
  siteName?: string | null
}

/**
 * Pure domain evaluator for preflight safety soft gates.
 *
 * @param input Flight configuration parameters to evaluate against safety rules.
 * @returns Array of triggered safety warnings (empty if all rules pass).
 */
export function evaluateSoftGates(input: SoftGateInput): string[] {
  const warnings: string[] = []

  // Rule 1: Motor Impulse Class vs Flyer Certification Level
  if (input.motorImpulseClass) {
    const impulse = input.motorImpulseClass.trim().toUpperCase()
    let requiredLevel = 0

    if (['H', 'I'].includes(impulse)) {
      requiredLevel = 1
    } else if (['J', 'K', 'L'].includes(impulse)) {
      requiredLevel = 2
    } else if (['M', 'N', 'O'].includes(impulse)) {
      requiredLevel = 3
    }

    if (input.flyerCertLevel < requiredLevel) {
      warnings.push(
        `Motor impulse class ${impulse} requires Level ${requiredLevel} certification, but flyer has Level ${input.flyerCertLevel}.`,
      )
    }
  }

  // Rule 2: Aerodynamic Stability Calibers Margin (< 1.0 caliber threshold)
  if (input.stabilityCalibers !== null && input.stabilityCalibers !== undefined) {
    if (input.stabilityCalibers < 1.0) {
      warnings.push(
        `Stability margin of ${input.stabilityCalibers.toFixed(2)} calibers is below the 1.0 caliber safety threshold.`,
      )
    }
  }

  // Rule 3: Expected Altitude vs Launch Site Waiver Ceiling
  if (
    input.expectedAltitudeM !== null &&
    input.expectedAltitudeM !== undefined &&
    input.siteMaxAltitudeM !== null &&
    input.siteMaxAltitudeM !== undefined
  ) {
    if (input.expectedAltitudeM > input.siteMaxAltitudeM) {
      warnings.push(
        `Expected altitude (${input.expectedAltitudeM}m) exceeds the site waiver ceiling (${input.siteMaxAltitudeM}m).`,
      )
    }
  }

  return warnings
}
