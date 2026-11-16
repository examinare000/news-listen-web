// Learning domain の streak: 取り直しの窓（5 分）と、増えたときだけの演出判定（web-rule-learning-01・product-learn-01・product-learn-02・product-learn-17）。
//
// RED 理由（実装前）: `@/lib/learning/domain/streak` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { increased, isStale } from '@/lib/learning/domain/streak'

describe('isStale (web-rule-learning-01・product-learn-17)', () => {
  test('verifies: CI-LD01 — 差が 299_999 ミリ秒なら新鮮（false）、300_000 ミリ秒ちょうどで古い（true）', () => {
    const fetchedAt = 1_000_000

    expect(isStale(fetchedAt, fetchedAt + 299_999)).toBe(false)
    expect(isStale(fetchedAt, fetchedAt + 300_000)).toBe(true)
  })

  test('verifies: CI-LD01 — 初回（fetchedAt=0）は now が 300_000 以上で古い', () => {
    expect(isStale(0, 300_000)).toBe(true)
    expect(isStale(0, 299_999)).toBe(false)
  })

  test('verifies: CI-LD01 — 窓を十分に過ぎたら古い', () => {
    expect(isStale(1_000_000, 1_000_000 + 600_000)).toBe(true)
  })
})

describe('increased (product-learn-02)', () => {
  test('verifies: CI-LD02 — 前の値が無い（null）初回は、値が何であれ増えていない（false）', () => {
    expect(increased(null, { days: 4 })).toBe(false)
  })

  test('verifies: CI-LD02 — 4 → 5 は増えた（true）。同値（4 → 4）・減少（4 → 3）は false', () => {
    expect(increased({ days: 4 }, { days: 5 })).toBe(true)
    expect(increased({ days: 4 }, { days: 4 })).toBe(false)
    expect(increased({ days: 4 }, { days: 3 })).toBe(false)
  })
})
