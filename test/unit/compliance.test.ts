import { describe, expect, it } from 'vitest'
import { getRequiredCertLevelForImpulse } from '../../src/services/compliance'

describe('getRequiredCertLevelForImpulse', () => {
  describe('Falsy and empty/whitespace inputs', () => {
    it('returns 0 for null', () => {
      expect(getRequiredCertLevelForImpulse(null)).toBe(0)
    })

    it('returns 0 for undefined', () => {
      expect(getRequiredCertLevelForImpulse(undefined)).toBe(0)
    })

    it('returns 0 for empty string', () => {
      expect(getRequiredCertLevelForImpulse('')).toBe(0)
    })

    it('returns 0 for whitespace-only strings', () => {
      expect(getRequiredCertLevelForImpulse('   ')).toBe(0)
      expect(getRequiredCertLevelForImpulse('\t\n')).toBe(0)
    })
  })

  describe('Low and Mid Power impulse classes (Level 0)', () => {
    const lowMidPowerClasses = ['A', 'B', 'C', 'D', 'E', 'F', 'G']

    it.each(lowMidPowerClasses)(
      'returns 0 for low/mid power class %s',
      (impulseClass) => {
        expect(getRequiredCertLevelForImpulse(impulseClass)).toBe(0)
      },
    )
  })

  describe('High Power Level 1 classes (H, I)', () => {
    const level1Classes = ['H', 'I']

    it.each(level1Classes)(
      'returns 1 for Level 1 class %s',
      (impulseClass) => {
        expect(getRequiredCertLevelForImpulse(impulseClass)).toBe(1)
      },
    )
  })

  describe('High Power Level 2 classes (J, K, L)', () => {
    const level2Classes = ['J', 'K', 'L']

    it.each(level2Classes)(
      'returns 2 for Level 2 class %s',
      (impulseClass) => {
        expect(getRequiredCertLevelForImpulse(impulseClass)).toBe(2)
      },
    )
  })

  describe('High Power Level 3 classes (M, N, O)', () => {
    const level3Classes = ['M', 'N', 'O']

    it.each(level3Classes)(
      'returns 3 for Level 3 class %s',
      (impulseClass) => {
        expect(getRequiredCertLevelForImpulse(impulseClass)).toBe(3)
      },
    )
  })

  describe('Unknown or invalid impulse classes', () => {
    const unknownClasses = ['P', 'Z', '123', 'UNKNOWN', 'AB']

    it.each(unknownClasses)(
      'returns 0 for unknown impulse class %s',
      (impulseClass) => {
        expect(getRequiredCertLevelForImpulse(impulseClass)).toBe(0)
      },
    )
  })

  describe('Case insensitivity and whitespace handling', () => {
    it('handles lowercase characters correctly', () => {
      expect(getRequiredCertLevelForImpulse('h')).toBe(1)
      expect(getRequiredCertLevelForImpulse('i')).toBe(1)
      expect(getRequiredCertLevelForImpulse('j')).toBe(2)
      expect(getRequiredCertLevelForImpulse('k')).toBe(2)
      expect(getRequiredCertLevelForImpulse('l')).toBe(2)
      expect(getRequiredCertLevelForImpulse('m')).toBe(3)
      expect(getRequiredCertLevelForImpulse('n')).toBe(3)
      expect(getRequiredCertLevelForImpulse('o')).toBe(3)
    })

    it('trims leading and trailing whitespace', () => {
      expect(getRequiredCertLevelForImpulse('  h  ')).toBe(1)
      expect(getRequiredCertLevelForImpulse('\tJ\n')).toBe(2)
      expect(getRequiredCertLevelForImpulse('   m   ')).toBe(3)
    })
  })
})
