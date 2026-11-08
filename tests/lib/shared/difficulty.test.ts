// @vitest-environment node
// 難易度の既定値と正規化（共有仕様 §3.4 の列挙値の前方互換）。I/O なし。
//
// RED 理由（実装前）: `normalizeDifficulty`・`DEFAULT_DIFFICULTY` が `@/lib/shared/difficulty` から export されていない。
import { describe, expect, test } from 'vitest'
import { DEFAULT_DIFFICULTY, DIFFICULTY_LEVELS, normalizeDifficulty } from '@/lib/shared/difficulty'
import { DEFAULT_DIFFICULTY as REEXPORTED_DEFAULT_DIFFICULTY } from '@/types/index'

describe('normalizeDifficulty', () => {
  test.each(['toeic_600', 'toeic_900', 'ielts_55', 'ielts_7', 'eiken_2', 'eiken_p1'])(
    'normalizeDifficulty: 既知の値 %s はそのまま返す',
    (level) => {
      expect(normalizeDifficulty(level)).toBe(level)
    },
  )

  test('normalizeDifficulty: DIFFICULTY_LEVELS の全値が素通しになる（6 値の取りこぼしがない）', () => {
    expect(DIFFICULTY_LEVELS).toHaveLength(6)
    for (const level of DIFFICULTY_LEVELS) expect(normalizeDifficulty(level)).toBe(level)
  })

  test.each<[string, unknown]>([
    ['未知の文字列', 'toeic_250'],
    ['空文字', ''],
    ['大文字違い', 'TOEIC_600'],
    ['数', 42],
    ['null', null],
    ['undefined', undefined],
    ['object', {}],
    ['配列', ['toeic_600']],
  ])('normalizeDifficulty: 既知の 6 値に無い値（%s）は DEFAULT_DIFFICULTY に倒し、例外を投げない', (_label, raw) => {
    expect(() => normalizeDifficulty(raw)).not.toThrow()
    expect(normalizeDifficulty(raw)).toBe('toeic_600')
    expect(normalizeDifficulty(raw)).toBe(DEFAULT_DIFFICULTY)
  })
})

describe('DEFAULT_DIFFICULTY', () => {
  test('DEFAULT_DIFFICULTY は toeic_600 で、DIFFICULTY_LEVELS に含まれる', () => {
    expect(DEFAULT_DIFFICULTY).toBe('toeic_600')
    expect(DIFFICULTY_LEVELS).toContain(DEFAULT_DIFFICULTY)
  })

  test('DEFAULT_DIFFICULTY: @/types/index の再 export と同じ値を指す', () => {
    expect(REEXPORTED_DEFAULT_DIFFICULTY).toBe(DEFAULT_DIFFICULTY)
  })
})
