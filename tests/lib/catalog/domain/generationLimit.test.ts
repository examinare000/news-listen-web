// 生成の上限（429）の種別の判定（web-rule-catalog-03・ADR-073）。
// 本文に monthly を含む、または待ち時間が 24 時間（86400 秒）を超えるなら月次。それ以外は日次。
//
// RED 理由（実装前）: `@/lib/catalog/domain/generationLimit` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { classifyGenerationLimit } from '@/lib/catalog/domain/generationLimit'

describe('classifyGenerationLimit (web-rule-catalog-03)', () => {
  const table: Array<[string, string, number | undefined, 'monthly' | 'daily', number | null]> = [
    ['本文が monthly（大文字小文字を問わない）で待ち時間なし → 月次・null', 'Monthly generation limit reached', undefined, 'monthly', null],
    ['待ち時間が 86400 を超える（86401）→ 月次', 'too many', 86401, 'monthly', 86401],
    ['待ち時間がちょうど 86400 は日次（> の境界）', 'Daily generation limit reached', 86400, 'daily', 86400],
    ['本文と待ち時間の両方が月次に当たる → 月次', 'monthly quota', 90000, 'monthly', 90000],
    ['どちらにも当たらない（待ち時間なし）→ 日次・null', 'Daily generation limit reached', undefined, 'daily', null],
  ]

  test.each(table)('%s', (_label, detail, retryAfterSeconds, period, expectedRetry) => {
    expect(classifyGenerationLimit(detail, retryAfterSeconds)).toEqual({ period, retryAfterSeconds: expectedRetry })
  })

  test('retryAfterSeconds が undefined なら null、数値ならその値のまま返す', () => {
    expect(classifyGenerationLimit('x', undefined).retryAfterSeconds).toBeNull()
    expect(classifyGenerationLimit('x', 0).retryAfterSeconds).toBe(0)
    expect(classifyGenerationLimit('x', 30).retryAfterSeconds).toBe(30)
  })

  test('返り値は凍結されており、書き換えを試みても次の呼出の結果は変わらない', () => {
    const result = classifyGenerationLimit('too many', 30) as { period: string; retryAfterSeconds: number | null }
    expect(Object.isFrozen(result)).toBe(true)
    expect(() => {
      result.period = 'monthly'
    }).toThrow(TypeError)
    expect(classifyGenerationLimit('too many', 30)).toEqual({ period: 'daily', retryAfterSeconds: 30 })
  })
})
