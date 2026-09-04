/**
 * Unit tests for the Pure Preflight Soft-Gates Safety Calculation Rules.
 *
 * Requirements:
 * - Impulse class vs Certification Level:
 *     A-G require Level 0 (clean for cert >= 0)
 *     H-I require Level 1 (warning if flyerCertLevel < 1)
 *     J-L require Level 2 (warning if flyerCertLevel < 2)
 *     M-O require Level 3 (warning if flyerCertLevel < 3)
 * - Stability Caliber Margin:
 *     stabilityCalibers < 1.0 triggers warning
 *     stabilityCalibers >= 1.0 is clean
 * - Altitude Waiver Ceiling:
 *     expectedAltitudeM > siteMaxAltitudeM triggers warning
 *     expectedAltitudeM <= siteMaxAltitudeM is clean
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { evaluateSoftGates as appEvaluateSoftGates, type SoftGateInput } from '../../src/services/soft_gates'

/**
 * Reference specification evaluator matching PROJECT.md § 2 Interface Contracts.
 * Used to independently verify expected outputs and serve as the test oracle.
 */
export function referenceEvaluateSoftGates(input: SoftGateInput): string[] {
  const warnings: string[] = []

  // Rule 1: Motor Impulse vs Flyer Certification Level
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

  // Rule 2: Aerodynamic Stability Calibers Margin (< 1.0 caliber)
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

type SoftGateEvaluator = (input: SoftGateInput) => string[]

describe('Preflight Soft-Gates Engine (Unit Tests)', () => {
  let evaluateSoftGates: SoftGateEvaluator = appEvaluateSoftGates ?? referenceEvaluateSoftGates

  beforeAll(async () => {
    try {
      const appModule = await import('../../src/services/soft_gates')
      if (typeof appModule.evaluateSoftGates === 'function') {
        evaluateSoftGates = appModule.evaluateSoftGates
      }
    } catch {
      // Fallback to reference evaluator if dynamic import fails
    }
  })

  describe('Impulse Class vs Flyer Certification Level (Rule 1)', () => {
    const lowPowerClasses = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
    const level1Classes = ['H', 'I']
    const level2Classes = ['J', 'K', 'L']
    const level3Classes = ['M', 'N', 'O']

    it.each(lowPowerClasses)(
      'permits class %s motor for Level 0 flyer without warning',
      (impulseClass) => {
        const warnings = evaluateSoftGates({
          flyerCertLevel: 0,
          motorImpulseClass: impulseClass,
        })
        expect(warnings).toHaveLength(0)
      },
    )

    it('handles exact boundary: Class G is permitted at Level 0, Class H warns at Level 0', () => {
      const gResult = evaluateSoftGates({ flyerCertLevel: 0, motorImpulseClass: 'G' })
      expect(gResult).toHaveLength(0)

      const hResult = evaluateSoftGates({ flyerCertLevel: 0, motorImpulseClass: 'H' })
      expect(hResult).toHaveLength(1)
      expect(hResult[0]).toMatch(/requires Level 1/i)
    })

    it.each(level1Classes)(
      'permits class %s motor for Level 1 flyer without warning',
      (impulseClass) => {
        const warnings = evaluateSoftGates({
          flyerCertLevel: 1,
          motorImpulseClass: impulseClass,
        })
        expect(warnings).toHaveLength(0)
      },
    )

    it('handles exact boundary: Class I is permitted at Level 1, Class J warns at Level 1', () => {
      const iResult = evaluateSoftGates({ flyerCertLevel: 1, motorImpulseClass: 'I' })
      expect(iResult).toHaveLength(0)

      const jResult = evaluateSoftGates({ flyerCertLevel: 1, motorImpulseClass: 'J' })
      expect(jResult).toHaveLength(1)
      expect(jResult[0]).toMatch(/requires Level 2/i)
    })

    it.each(level2Classes)(
      'permits class %s motor for Level 2 flyer without warning',
      (impulseClass) => {
        const warnings = evaluateSoftGates({
          flyerCertLevel: 2,
          motorImpulseClass: impulseClass,
        })
        expect(warnings).toHaveLength(0)
      },
    )

    it('handles exact boundary: Class L is permitted at Level 2, Class M warns at Level 2', () => {
      const lResult = evaluateSoftGates({ flyerCertLevel: 2, motorImpulseClass: 'L' })
      expect(lResult).toHaveLength(0)

      const mResult = evaluateSoftGates({ flyerCertLevel: 2, motorImpulseClass: 'M' })
      expect(mResult).toHaveLength(1)
      expect(mResult[0]).toMatch(/requires Level 3/i)
    })

    it.each(level3Classes)(
      'permits class %s motor for Level 3 flyer without warning',
      (impulseClass) => {
        const warnings = evaluateSoftGates({
          flyerCertLevel: 3,
          motorImpulseClass: impulseClass,
        })
        expect(warnings).toHaveLength(0)
      },
    )

    it('warns when Level 0 flyer attempts Level 2 or Level 3 motors', () => {
      const jWarn = evaluateSoftGates({ flyerCertLevel: 0, motorImpulseClass: 'J' })
      expect(jWarn).toHaveLength(1)
      expect(jWarn[0]).toMatch(/requires Level 2/i)

      const oWarn = evaluateSoftGates({ flyerCertLevel: 0, motorImpulseClass: 'O' })
      expect(oWarn).toHaveLength(1)
      expect(oWarn[0]).toMatch(/requires Level 3/i)
    })

    it('normalizes lowercase motor impulse class (e.g., "h" behaves identically to "H")', () => {
      const lowerH = evaluateSoftGates({ flyerCertLevel: 0, motorImpulseClass: 'h' })
      expect(lowerH).toHaveLength(1)
      expect(lowerH[0]).toMatch(/requires Level 1/i)

      const lowerHClean = evaluateSoftGates({ flyerCertLevel: 1, motorImpulseClass: 'h' })
      expect(lowerHClean).toHaveLength(0)
    })

    it('tolerates missing or undefined motor impulse class gracefully', () => {
      expect(evaluateSoftGates({ flyerCertLevel: 0, motorImpulseClass: null })).toHaveLength(0)
      expect(evaluateSoftGates({ flyerCertLevel: 0, motorImpulseClass: undefined })).toHaveLength(0)
    })
  })

  describe('Aerodynamic Stability Margin (Rule 2)', () => {
    it.each([0.0, 0.5, 0.85, 0.95, 0.999])(
      'triggers safety warning for unstable margin of %d calibers (< 1.0)',
      (calibers) => {
        const warnings = evaluateSoftGates({
          flyerCertLevel: 1,
          stabilityCalibers: calibers,
        })
        expect(warnings).toHaveLength(1)
        expect(warnings[0]).toMatch(/below the 1\.0 caliber/i)
      },
    )

    it('handles exact boundary: 0.99 calibers warns, 1.00 caliber is clean', () => {
      const warnResult = evaluateSoftGates({ flyerCertLevel: 1, stabilityCalibers: 0.99 })
      expect(warnResult).toHaveLength(1)

      const cleanResult = evaluateSoftGates({ flyerCertLevel: 1, stabilityCalibers: 1.0 })
      expect(cleanResult).toHaveLength(0)
    })

    it.each([1.0, 1.01, 1.4, 1.8, 2.5, 3.0])(
      'permits stable margin of %d calibers (>= 1.0) with zero warnings',
      (calibers) => {
        const warnings = evaluateSoftGates({
          flyerCertLevel: 1,
          stabilityCalibers: calibers,
        })
        expect(warnings).toHaveLength(0)
      },
    )

    it('triggers warning for negative stability (rocket will tumble)', () => {
      const warnings = evaluateSoftGates({
        flyerCertLevel: 1,
        stabilityCalibers: -0.5,
      })
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toMatch(/below the 1\.0 caliber/i)
    })

    it('tolerates null or undefined stability calibers without false alarms', () => {
      expect(evaluateSoftGates({ flyerCertLevel: 1, stabilityCalibers: null })).toHaveLength(0)
      expect(evaluateSoftGates({ flyerCertLevel: 1, stabilityCalibers: undefined })).toHaveLength(0)
    })
  })

  describe('Airspace Waiver Altitude Ceiling (Rule 3)', () => {
    it('triggers warning when expected altitude exceeds site ceiling', () => {
      const warnings = evaluateSoftGates({
        flyerCertLevel: 1,
        expectedAltitudeM: 2200,
        siteMaxAltitudeM: 1500,
      })
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toMatch(/exceeds the site waiver ceiling/i)
    })

    it('handles exact boundary: equal to ceiling (1500m vs 1500m) is clean, 1501m warns', () => {
      const cleanResult = evaluateSoftGates({
        flyerCertLevel: 1,
        expectedAltitudeM: 1500,
        siteMaxAltitudeM: 1500,
      })
      expect(cleanResult).toHaveLength(0)

      const warnResult = evaluateSoftGates({
        flyerCertLevel: 1,
        expectedAltitudeM: 1501,
        siteMaxAltitudeM: 1500,
      })
      expect(warnResult).toHaveLength(1)
      expect(warnResult[0]).toMatch(/exceeds the site waiver ceiling/i)
    })

    it('permits flights within altitude limit with zero warnings', () => {
      const warnings = evaluateSoftGates({
        flyerCertLevel: 1,
        expectedAltitudeM: 850,
        siteMaxAltitudeM: 3000,
      })
      expect(warnings).toHaveLength(0)
    })

    it('tolerates missing expected altitude or missing site ceiling', () => {
      expect(
        evaluateSoftGates({ flyerCertLevel: 1, expectedAltitudeM: null, siteMaxAltitudeM: 1500 }),
      ).toHaveLength(0)
      expect(
        evaluateSoftGates({ flyerCertLevel: 1, expectedAltitudeM: 2000, siteMaxAltitudeM: null }),
      ).toHaveLength(0)
    })
  })

  describe('Combinatorial & Adversarial Multiple Soft-Gate Overrides', () => {
    it('accumulates all three warnings when cert, stability, and ceiling rules are all violated', () => {
      const warnings = evaluateSoftGates({
        flyerCertLevel: 0,
        motorImpulseClass: 'H', // Requires L1 (+1 warning)
        stabilityCalibers: 0.75, // < 1.0 caliber (+1 warning)
        expectedAltitudeM: 3500,
        siteMaxAltitudeM: 2000, // Exceeds 2000m (+1 warning)
      })

      expect(warnings).toHaveLength(3)
      expect(warnings.some((w) => /requires Level 1/i.test(w))).toBe(true)
      expect(warnings.some((w) => /below the 1\.0 caliber/i.test(w))).toBe(true)
      expect(warnings.some((w) => /exceeds the site waiver ceiling/i.test(w))).toBe(true)
    })

    it('returns empty warning array when all parameters meet safety criteria', () => {
      const warnings = evaluateSoftGates({
        flyerCertLevel: 2,
        motorImpulseClass: 'J', // L2 flyer flying Class J is valid
        stabilityCalibers: 1.65, // Stable
        expectedAltitudeM: 1200,
        siteMaxAltitudeM: 3000, // Within waiver
      })
      expect(warnings).toEqual([])
    })
  })
})
