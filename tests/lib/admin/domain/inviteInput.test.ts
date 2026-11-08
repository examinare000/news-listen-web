// 招待コードの任意の数値欄の検査（web-rule-admin-03）。空なら未指定、正の整数なら値、それ以外は 'invalid'。現行の結果を固定する。
//
// RED 理由（実装前）: `@/lib/admin/domain/inviteInput` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { parseOptionalPositiveInt } from '@/lib/admin/domain/inviteInput'

describe('web-rule-admin-03 parseOptionalPositiveInt', () => {
  test('空文字と空白だけは undefined（未指定）', () => {
    expect(parseOptionalPositiveInt('')).toBeUndefined()
    expect(parseOptionalPositiveInt('  ')).toBeUndefined()
  })

  test('正の整数はその値', () => {
    expect(parseOptionalPositiveInt('1')).toBe(1)
    expect(parseOptionalPositiveInt('12')).toBe(12)
  })

  test('0 と負数は invalid', () => {
    expect(parseOptionalPositiveInt('0')).toBe('invalid')
    expect(parseOptionalPositiveInt('-1')).toBe('invalid')
  })

  test('小数は invalid', () => {
    expect(parseOptionalPositiveInt('1.5')).toBe('invalid')
  })

  test('数値でない文字列は invalid', () => {
    expect(parseOptionalPositiveInt('abc')).toBe('invalid')
  })

  test('現行の結果を固定する: 指数表記 1e2 は 100、前後の空白は無視して 3', () => {
    expect(parseOptionalPositiveInt('1e2')).toBe(100)
    expect(parseOptionalPositiveInt(' 3 ')).toBe(3)
  })
})
