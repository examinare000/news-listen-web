// Learning domain の difficultySuggestion: 提案を出すか（提案なし・取得失敗はどちらも出さない）（web-rule-learning-06・product-learn-20）。
//
// RED 理由（実装前）: `@/lib/learning/domain/difficultySuggestion` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { isOffered } from '@/lib/learning/domain/difficultySuggestion'

describe('isOffered (web-rule-learning-06)', () => {
  test('verifies: CI-LD05 — has_suggestion が true のときだけ出す', () => {
    expect(isOffered(true)).toBe(true)
  })

  test('verifies: CI-LD05 — false（提案なし）と null（取得できなかった）は出さない', () => {
    expect(isOffered(false)).toBe(false)
    expect(isOffered(null)).toBe(false)
  })
})
