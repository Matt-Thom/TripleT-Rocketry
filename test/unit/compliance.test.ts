import { describe, expect, it } from 'vitest'
import {
  getRequiredCertLevelForImpulse,
  isHighPowerImpulse,
} from '../../src/services/compliance'

describe('Compliance Service Unit Tests', () => {
  describe('isHighPowerImpulse', () => {
    const lowAndMidPowerClasses = ['1/2A', 'A', 'B', 'C', 'D', 'E', 'F', 'G']
    const level1Classes = ['H', 'I']
    const level2Classes = ['J', 'K', 'L']
    const level3Classes = ['M', 'N', 'O']

    it.each(lowAndMidPowerClasses)(
      'returns false for Low/Mid Power Class %s motor',
      (impulseClass) => {
        expect(isHighPowerImpulse(impulseClass)).toBe(false)
      },
    )

    it('handles exact boundary: Class G is non-HPR (false), Class H is HPR (true)', () => {
      expect(isHighPowerImpulse('G')).toBe(false)
      expect(isHighPowerImpulse('H')).toBe(true)
    })

    it.each(level1Classes)(
      'returns true for High Power Level 1 Class %s motor',
      (impulseClass) => {
        expect(isHighPowerImpulse(impulseClass)).toBe(true)
      },
    )

    it.each(level2Classes)(
      'returns true for High Power Level 2 Class %s motor',
      (impulseClass) => {
        expect(isHighPowerImpulse(impulseClass)).toBe(true)
      },
    )

    it.each(level3Classes)(
      'returns true for High Power Level 3 Class %s motor',
      (impulseClass) => {
        expect(isHighPowerImpulse(impulseClass)).toBe(true)
      },
    )

    it('normalizes lowercase and whitespace-padded class strings', () => {
      expect(isHighPowerImpulse('h')).toBe(true)
      expect(isHighPowerImpulse('  i  ')).toBe(true)
      expect(isHighPowerImpulse('j')).toBe(true)
      expect(isHighPowerImpulse('\tk\n')).toBe(true)
      expect(isHighPowerImpulse('m')).toBe(true)

      expect(isHighPowerImpulse('g')).toBe(false)
      expect(isHighPowerImpulse('  a  ')).toBe(false)
    })

    it('returns false for null, undefined, empty string, or whitespace-only inputs', () => {
      expect(isHighPowerImpulse(null)).toBe(false)
      expect(isHighPowerImpulse(undefined)).toBe(false)
      expect(isHighPowerImpulse('')).toBe(false)
      expect(isHighPowerImpulse('   ')).toBe(false)
    })

    it('returns false for out-of-range or unrecognized class strings', () => {
      expect(isHighPowerImpulse('P')).toBe(false)
      expect(isHighPowerImpulse('Q')).toBe(false)
      expect(isHighPowerImpulse('Z')).toBe(false)
      expect(isHighPowerImpulse('123')).toBe(false)
      expect(isHighPowerImpulse('INVALID')).toBe(false)
    })
  })

  describe('getRequiredCertLevelForImpulse', () => {
    it.each(['1/2A', 'A', 'B', 'C', 'D', 'E', 'F', 'G'])(
      'returns Level 0 required for Class %s',
      (impulseClass) => {
        expect(getRequiredCertLevelForImpulse(impulseClass)).toBe(0)
      },
    )

    it.each(['H', 'I'])('returns Level 1 required for Class %s', (impulseClass) => {
      expect(getRequiredCertLevelForImpulse(impulseClass)).toBe(1)
    })

    it.each(['J', 'K', 'L'])('returns Level 2 required for Class %s', (impulseClass) => {
      expect(getRequiredCertLevelForImpulse(impulseClass)).toBe(2)
    })

    it.each(['M', 'N', 'O'])('returns Level 3 required for Class %s', (impulseClass) => {
      expect(getRequiredCertLevelForImpulse(impulseClass)).toBe(3)
    })

    it('handles null, undefined, empty, whitespace, and unrecognized strings', () => {
      expect(getRequiredCertLevelForImpulse(null)).toBe(0)
      expect(getRequiredCertLevelForImpulse(undefined)).toBe(0)
      expect(getRequiredCertLevelForImpulse('')).toBe(0)
      expect(getRequiredCertLevelForImpulse('  ')).toBe(0)
      expect(getRequiredCertLevelForImpulse('P')).toBe(0)
    })
  })
})
