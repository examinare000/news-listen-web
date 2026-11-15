// Learning domain の quiz: 送信可否・合否・全問正解（product-learn-19）。純関数だけを検証する。
//
// RED 理由（実装前）: `@/lib/learning/domain/quiz` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { canSubmit, isPerfect, passed } from '@/lib/learning/domain/quiz'

describe('canSubmit (product-learn-19)', () => {
  test('verifies: CI-LN01 — 未回答（undefined）が 1 問でも残れば false、全問に回答済みなら true', () => {
    expect(canSubmit({ questionCount: 3, answers: [0, undefined, 2] })).toBe(false)
    expect(canSubmit({ questionCount: 3, answers: [0, 1, 2] })).toBe(true)
  })

  test('verifies: CI-LN01 — 添字 0 の回答も回答済みとして数える（falsy と未回答を取り違えない）', () => {
    expect(canSubmit({ questionCount: 2, answers: [0, 0] })).toBe(true)
  })

  test('verifies: CI-LN01 — 回答の数が設問の数に足りなければ false（範囲外は未回答）', () => {
    expect(canSubmit({ questionCount: 3, answers: [0, 1] })).toBe(false)
  })

  test('verifies: CI-LN01 — 設問が 0 件なら true（空の every と同じ）', () => {
    expect(canSubmit({ questionCount: 0, answers: [] })).toBe(true)
  })

  test('verifies: CI-LN01 — 入力を変更しない', () => {
    const answers = [0, undefined, 2]
    canSubmit({ questionCount: 3, answers })
    expect(answers).toEqual([0, undefined, 2])
  })
})

describe('passed (product-learn-19)', () => {
  test('verifies: CI-LN02 — 正答率 0.5 ちょうどは合格（1/2）', () => {
    expect(passed({ correct: 1, total: 2 })).toBe(true)
  })

  test('verifies: CI-LN02 — 正答率 0.49 は不合格（49/100）', () => {
    expect(passed({ correct: 49, total: 100 })).toBe(false)
  })

  test('verifies: CI-LN02 — 全問正解は合格、0 問正解は不合格', () => {
    expect(passed({ correct: 3, total: 3 })).toBe(true)
    expect(passed({ correct: 0, total: 3 })).toBe(false)
  })

  test('verifies: CI-LN02 — total が 0 なら不合格（0/0 でも correct > 0 でも false）', () => {
    expect(passed({ correct: 0, total: 0 })).toBe(false)
    expect(passed({ correct: 1, total: 0 })).toBe(false)
  })
})

describe('isPerfect (product-learn-19)', () => {
  test('verifies: CI-LN03 — correct と total が等しいときだけ true', () => {
    expect(isPerfect({ correct: 3, total: 3 })).toBe(true)
    expect(isPerfect({ correct: 2, total: 3 })).toBe(false)
  })

  test('verifies: CI-LN03 — total が 0（correct も 0）なら true', () => {
    expect(isPerfect({ correct: 0, total: 0 })).toBe(true)
  })
})
