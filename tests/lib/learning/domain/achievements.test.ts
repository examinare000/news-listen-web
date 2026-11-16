// Learning domain の achievements: 既読に無い解錠済みの実績の id（web-rule-learning-05・ADR-086）。
//
// RED 理由（実装前）: `@/lib/learning/domain/achievements` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { newlyUnlocked } from '@/lib/learning/domain/achievements'

const unlocked = (...ids: string[]) => ids.map((id) => ({ id }))

describe('newlyUnlocked (web-rule-learning-05)', () => {
  test('verifies: CI-LD03 — 既読に無いものだけを、解錠済みの並びのまま返す', () => {
    expect(newlyUnlocked(unlocked('a', 'b', 'c'), new Set(['b']))).toEqual(['a', 'c'])
  })

  test('verifies: CI-LD03 — 既読が空なら全部、全部が既読なら空', () => {
    expect(newlyUnlocked(unlocked('a', 'b', 'c'), new Set())).toEqual(['a', 'b', 'c'])
    expect(newlyUnlocked(unlocked('a', 'b', 'c'), new Set(['a', 'b', 'c']))).toEqual([])
  })

  test('verifies: CI-LD03 — 重複は除かない（現行は要素ごとに toast を出す）', () => {
    expect(newlyUnlocked(unlocked('a', 'a'), new Set())).toEqual(['a', 'a'])
  })

  test('verifies: CI-LD03 — 戻りは凍結済みで、入力を変更しない', () => {
    const input = unlocked('a', 'b')
    const seen = new Set(['a'])

    const result = newlyUnlocked(input, seen)

    expect(Object.isFrozen(result)).toBe(true)
    expect(input).toEqual([{ id: 'a' }, { id: 'b' }])
    expect([...seen]).toEqual(['a'])
  })
})
