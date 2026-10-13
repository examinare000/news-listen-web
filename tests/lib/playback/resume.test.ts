// 再開位置の純関数 resolveResumePosition(serverSeconds, durationSeconds) の契約テスト。
// 正本: docs/design/shared-playback-spec.md §4.3 shared-resume-01〜shared-resume-07（末尾 2 秒窓）。
// verifies: shared-resume-01, shared-resume-02, shared-resume-03, shared-resume-04, shared-resume-05, shared-resume-06, shared-resume-07
//
// RED 理由: `@/lib/playback/domain/resume` がまだ存在しない。
import { describe, test, expect } from 'vitest'
import { resolveResumePosition } from '@/lib/playback/domain/resume'

describe('resolveResumePosition (shared-playback-spec §4.3)', () => {
  const rows: Array<[string, number, number, number, string]> = [
    ['shared-resume-01', 0, 600, 0, '未再生は先頭から'],
    ['shared-resume-02', 120, 600, 120, '続きから'],
    ['shared-resume-03', 598, 600, 0, '末尾 2 秒窓の境界（duration − 2 と等しい）は完聴扱い'],
    ['shared-resume-04', 597.5, 600, 597.5, '窓の外側は続きから'],
    ['shared-resume-05', 600, 600, 0, 'duration 以上は完聴扱い'],
    ['shared-resume-06', 120, 0, 120, 'duration 不明（0）では窓判定をしない'],
    ['shared-resume-07', -5, 600, 0, '負値は先頭から'],
  ]

  test.each(rows)('%s: (%s, %s) → %s（%s）', (_id, server, duration, expected) => {
    expect(resolveResumePosition(server, duration)).toBe(expected)
  })

  test('shared-resume-01: NaN の保存位置は先頭から（!(server > 0) は 0）', () => {
    expect(resolveResumePosition(Number.NaN, 600)).toBe(0)
  })

  test('shared-resume-06: duration が負でも窓判定をしない（duration > 0 のときだけ窓を適用）', () => {
    expect(resolveResumePosition(120, -1)).toBe(120)
  })

  test('shared-resume-05: duration 超過の保存位置は完聴扱いで 0', () => {
    expect(resolveResumePosition(9999, 600)).toBe(0)
  })
})
