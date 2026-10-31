// 失敗の理由 → 利用者向けの日本語文言（web-rule-catalog-11・web-dec-45）。
// 値域の畳み込み（partial_failed・自由文・null → generation_failed）は decodeEpisode が閉じており、
// episodeMapper.test.ts が確かめている。ここは識別子 2 値の文言だけを固定する。
// domain は型だけを import する（値で import すると web-check-08 の閉じた集合が変わるため）。
//
// RED 理由（実装前）: `@/lib/catalog/presentation/failureMessage` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { failureMessage } from '@/lib/catalog/presentation/failureMessage'
import type { FailureReason } from '@/lib/catalog/domain/episode'

describe('failureMessage (web-rule-catalog-11)', () => {
  const table: Array<[FailureReason, string]> = [
    ['generation_failed', '生成に失敗しました'],
    ['quota_exhausted', '生成の上限に達したため、生成できませんでした'],
  ]

  test.each(table)('Given reason=%s, returns the web-dec-45 message', (reason, message) => {
    expect(failureMessage(reason)).toBe(message)
  })

  test('2 値の文言は互いに異なる（片方の値を他方の文言に倒す実装を拒否する）', () => {
    expect(failureMessage('generation_failed')).not.toBe(failureMessage('quota_exhausted'))
  })
})
