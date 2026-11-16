// @vitest-environment node
// 再開時の確認が要るかの判定（ADR-109 決定 11）。純関数。I/O なし。
//
// RED 理由（実装前）: `@/lib/playback/domain/resumeConfirmation` がまだ存在しない。
import { describe, expect, test } from 'vitest'
import { RESUME_CONFIRM_THRESHOLD_SECONDS, needsResumeChoice } from '@/lib/playback/domain/resumeConfirmation'

describe('shared-sync-10 / ADR-109 決定 11: 差 14.99 は偽・15 は真・15.01 は真・符号に依らない', () => {
  test('閾値の定数は 15 秒', () => {
    expect(RESUME_CONFIRM_THRESHOLD_SECONDS).toBe(15)
  })

  test.each<[string, number, number, boolean]>([
    ['差 14.99 は尋ねない', 100, 114.99, false],
    ['差 15 ちょうどは尋ねる', 100, 115, true],
    ['差 15.01 は尋ねる', 100, 115.01, true],
    ['remote が小さい側でも尋ねる（符号に依らない）', 115, 100, true],
    ['remote が大きい側の 14.99 も尋ねない', 114.99, 100, false],
    ['差 0 は尋ねない', 100, 100, false],
  ])('%s', (_name, remote, local, expected) => {
    expect(needsResumeChoice(remote, local)).toBe(expected)
  })

  test('引数の順を入れ替えても同じ結果（(100, 500) と (500, 100)）', () => {
    expect(needsResumeChoice(100, 500)).toBe(true)
    expect(needsResumeChoice(500, 100)).toBe(needsResumeChoice(100, 500))
  })

  test('同じ入力には何度呼んでも同じ結果を返す', () => {
    expect(needsResumeChoice(100, 115)).toBe(needsResumeChoice(100, 115))
    expect(needsResumeChoice(100, 114.99)).toBe(needsResumeChoice(100, 114.99))
  })
})
