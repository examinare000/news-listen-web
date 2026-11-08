// Account domain の username（web-rule-account-04）: 正規化（trim + lowercase）と形式検査の単一実装。純関数で、文言は持たない（文言は呼出側）。
//
// RED 理由（実装前）: `@/lib/account/domain/username` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { normalizeUsername, validateUsername } from '@/lib/account/domain/username'

function ofLength(length: number): string {
  return 'a'.repeat(length)
}

describe('validateUsername: 長さの境界 (verifies: web-rule-account-04)', () => {
  test('web-rule-account-04 — 3 文字は ok', () => {
    expect(validateUsername(ofLength(3))).toBe('ok')
  })

  test('web-rule-account-04 — 32 文字は ok', () => {
    expect(validateUsername(ofLength(32))).toBe('ok')
  })

  test('web-rule-account-04 — 2 文字は invalid_format', () => {
    expect(validateUsername(ofLength(2))).toBe('invalid_format')
  })

  test('web-rule-account-04 — 33 文字は invalid_format', () => {
    expect(validateUsername(ofLength(33))).toBe('invalid_format')
  })

  test('web-rule-account-04 — 空文字は throw せず invalid_format', () => {
    expect(validateUsername('')).toBe('invalid_format')
  })
})

describe('validateUsername: 文字種と先頭 (verifies: web-rule-account-04)', () => {
  test('web-rule-account-04 — 先頭が - は invalid_format、先頭が _ も invalid_format', () => {
    expect(validateUsername('-abc')).toBe('invalid_format')
    expect(validateUsername('_abc')).toBe('invalid_format')
  })

  test('web-rule-account-04 — 先頭が英数字なら、2 文字目以降の - と _ は ok（正方向の対照）', () => {
    expect(validateUsername('a-b_c')).toBe('ok')
    expect(validateUsername('0abc')).toBe('ok')
  })

  test('web-rule-account-04 — 許可外の文字（!・空白・日本語）は invalid_format', () => {
    expect(validateUsername('abc!')).toBe('invalid_format')
    expect(validateUsername('a b c')).toBe('invalid_format')
    expect(validateUsername('ユーザー名')).toBe('invalid_format')
  })
})

describe('validateUsername: 正規化してから判定する (verifies: web-rule-account-04)', () => {
  test('web-rule-account-04 — 大文字と前後の空白は正規化で通る', () => {
    expect(validateUsername('  Alice_01 ')).toBe('ok')
  })

  test('web-rule-account-04 — trim の後が 2 文字なら invalid_format（空白は長さに数えない）', () => {
    expect(validateUsername('  ab  ')).toBe('invalid_format')
  })

  test('web-rule-account-04 — trim の後が 33 文字なら invalid_format', () => {
    expect(validateUsername(`  ${ofLength(33)}  `)).toBe('invalid_format')
  })
})

describe('normalizeUsername (verifies: web-rule-account-04)', () => {
  test('web-rule-account-04 — trim + lowercase を行う', () => {
    expect(normalizeUsername('  AbC ')).toBe('abc')
  })

  test('web-rule-account-04 — 形式の検査はしない（不正な形式もそのまま小文字にして返す）', () => {
    expect(normalizeUsername(' -A!B ')).toBe('-a!b')
  })
})
