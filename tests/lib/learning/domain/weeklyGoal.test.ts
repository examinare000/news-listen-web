// Learning domain の weeklyGoal: 週の目標の進捗の比（product-learn-09・web-dec-171）。
//
// RED 理由（実装前）: `@/lib/learning/domain/weeklyGoal` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { progress } from '@/lib/learning/domain/weeklyGoal'

describe('progress (product-learn-09)', () => {
  test('verifies: CI-LD04 — 聴取数 / 目標 の比（3/5 → 0.6、0/3 → 0）', () => {
    expect(progress(3, 5)).toBe(0.6)
    expect(progress(0, 3)).toBe(0)
  })

  test('verifies: CI-LD04 — 目標を超えても上限は 1（7/5 → 1）', () => {
    expect(progress(7, 5)).toBe(1)
  })

  test('verifies: CI-LD04 — Math.min(listened / goal, 1) と同値（2/0 → 1、0/0 → NaN）', () => {
    expect(progress(2, 0)).toBe(1)
    expect(progress(0, 0)).toBeNaN()
  })
})
