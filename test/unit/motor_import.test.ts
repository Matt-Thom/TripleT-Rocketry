import { describe, expect, it } from 'vitest'
import { parseDelay } from '../../src/services/motor_import'

describe('parseDelay (Unit Tests)', () => {
  describe('null, undefined, and empty string handling', () => {
    it('returns null for undefined input', () => {
      expect(parseDelay(undefined)).toBeNull()
      expect(parseDelay()).toBeNull()
    })

    it('returns null for null input', () => {
      expect(parseDelay(null)).toBeNull()
    })

    it('returns null for empty string or whitespace-only string', () => {
      expect(parseDelay('')).toBeNull()
      expect(parseDelay('   ')).toBeNull()
      expect(parseDelay('\t\n')).toBeNull()
    })
  })

  describe('nullish text placeholders', () => {
    it.each([
      'none',
      'NONE',
      'None',
      'n/a',
      'N/A',
      'na',
      'NA',
      'n/A',
      '-',
      'null',
      'NULL',
      'undefined',
      'UNDEFINED',
    ])('returns null for placeholder string %j', (input) => {
      expect(parseDelay(input)).toBeNull()
    })

    it.each([
      '  none  ',
      '  n/a  ',
      '  -  ',
    ])('returns null for padded placeholder string %j', (input) => {
      expect(parseDelay(input)).toBeNull()
    })
  })

  describe('plugged delay designations', () => {
    it.each([
      'P',
      'p',
      'Plugged',
      'plugged',
      'PLUGGED',
    ])('returns 0 for plugged string %j', (input) => {
      expect(parseDelay(input)).toBe(0)
    })

    it.each([
      '  P  ',
      '  plugged  ',
      '  PLUGGED  ',
    ])('returns 0 for trimmed plugged string %j', (input) => {
      expect(parseDelay(input)).toBe(0)
    })
  })

  describe('valid numeric delay parsing', () => {
    it('parses integer delay strings', () => {
      expect(parseDelay('0')).toBe(0)
      expect(parseDelay('6')).toBe(6)
      expect(parseDelay('14')).toBe(14)
    })

    it('parses decimal delay strings', () => {
      expect(parseDelay('4.5')).toBe(4.5)
      expect(parseDelay('0.5')).toBe(0.5)
      expect(parseDelay('.5')).toBe(0.5)
    })

    it('parses signed numeric strings', () => {
      expect(parseDelay('+5')).toBe(5)
      expect(parseDelay('-3')).toBe(-3)
    })

    it('parses numeric strings with leading/trailing whitespace', () => {
      expect(parseDelay('  10  ')).toBe(10)
      expect(parseDelay('  7.2  ')).toBe(7.2)
    })

    it('parses numbers with trailing text unit labels', () => {
      expect(parseDelay('6 sec')).toBe(6)
      expect(parseDelay('14s')).toBe(14)
      expect(parseDelay('5 seconds')).toBe(5)
    })
  })

  describe('invalid and non-numeric string handling', () => {
    it.each([
      'abc',
      'foo',
      'delay',
      'unknown',
      '???',
    ])('returns null for non-numeric text %j', (input) => {
      expect(parseDelay(input)).toBeNull()
    })
  })
})
