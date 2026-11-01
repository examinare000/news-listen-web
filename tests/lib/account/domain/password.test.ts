import { describe, test, expect } from 'vitest'
import { validatePassword } from '@/lib/account/domain/password'

// パスワード規則の単一実装（ADR-101）: 長さ 12〜20 かつ文字種（小文字・大文字・数字・記号）3 種以上。
// 純関数で、文言は持たない（文言は呼出側）。長さは String.prototype.length（UTF-16 code unit）で数える。
// RED 理由（実装前）: `@/lib/account/domain/password` が無い（module not found）。

// 3 種（小文字・大文字・数字）で任意の長さの文字列を作る。
function threeClasses(length: number): string {
  return ('Ab1' + 'x'.repeat(length)).slice(0, length)
}

describe('validatePassword: 長さの境界 (verifies: ADR-101)', () => {
  test('11 文字は too_short', () => {
    expect(validatePassword(threeClasses(11))).toEqual({ ok: false, reason: 'too_short' })
  })

  test('12 文字（3 種）は ok', () => {
    expect(validatePassword(threeClasses(12))).toEqual({ ok: true })
  })

  test('20 文字（3 種）は ok', () => {
    expect(validatePassword(threeClasses(20))).toEqual({ ok: true })
  })

  test('21 文字は too_long', () => {
    expect(validatePassword(threeClasses(21))).toEqual({ ok: false, reason: 'too_long' })
  })

  test('空文字は throw せず too_short', () => {
    expect(() => validatePassword('')).not.toThrow()
    expect(validatePassword('')).toEqual({ ok: false, reason: 'too_short' })
  })
})

describe('validatePassword: 文字種 (verifies: ADR-101)', () => {
  test('12 文字でも 2 種（小文字＋数字）なら too_few_classes', () => {
    expect(validatePassword('abcdefgh1234')).toEqual({ ok: false, reason: 'too_few_classes' })
  })

  test('12 文字・3 種（小文字・大文字・数字）は ok', () => {
    expect(validatePassword('Abcdefgh1234')).toEqual({ ok: true })
  })

  test('12 文字・3 種（小文字・数字・記号）は ok', () => {
    expect(validatePassword('abcdefgh123!')).toEqual({ ok: true })
  })

  test('空白は記号に数えない（小文字＋数字＋空白は 2 種）', () => {
    expect(validatePassword('abcdefg 1234')).toEqual({ ok: false, reason: 'too_few_classes' })
  })

  test('空白があっても別の 3 種が揃えば ok', () => {
    expect(validatePassword('Abcdef 12345')).toEqual({ ok: true })
  })
})

describe('validatePassword: 判定順は長さ → 文字種 (verifies: ADR-101)', () => {
  test('2 種・21 文字は too_long（文字種より長さが先）', () => {
    expect(validatePassword('a'.repeat(20) + '1')).toEqual({ ok: false, reason: 'too_long' })
  })

  test('2 種・11 文字は too_short（文字種より長さが先）', () => {
    expect(validatePassword('abcdefghij1')).toEqual({ ok: false, reason: 'too_short' })
  })
})

describe('validatePassword: 長さは UTF-16 code unit で数える (verifies: ADR-101)', () => {
  test('21 code unit / 12 code point の文字列は too_long（code point 数えなら ok になって落ちる）', () => {
    const value = 'Ab1' + '😀'.repeat(9)
    expect(value.length).toBe(21)
    expect([...value].length).toBe(12)
    expect(validatePassword(value)).toEqual({ ok: false, reason: 'too_long' })
  })
})
