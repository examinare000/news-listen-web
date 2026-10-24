// Playback domain の薄い委譲 queueEntry（queueEntryOf・nowPlayingTitle・upNextTitle）の契約テスト。
// 規則は Catalog の queuedEpisode・displayTitle にあり、本ファイルの 3 関数は委譲だけを持つ（web-dec-24）。
//
// RED 理由（実装前）: `@/lib/playback/domain/queueEntry` がまだ存在しない（module not found）。
import { describe, expect, test } from 'vitest'
import { displayTitle, queuedEpisode } from '@/lib/catalog/domain/episode'
import type { EpisodeLabel, QueuedEpisodeInput } from '@/lib/catalog/domain/episode'
import { nowPlayingTitle, queueEntryOf, upNextTitle } from '@/lib/playback/domain/queueEntry'

function unfrozenNodes(value: unknown, where = '$'): string[] {
  if (typeof value !== 'object' || value === null) return []
  const found = Object.isFrozen(value) ? [] : [where]
  for (const [key, child] of Object.entries(value)) found.push(...unfrozenNodes(child, `${where}.${key}`))
  return found
}

describe('web-dec-24 queueEntryOf: queuedEpisode への委譲', () => {
  const input = (): QueuedEpisodeInput => ({ id: 'a', title: '題', intro: 'イントロの全文' })

  test('verifies: CI-T01 — queuedEpisode(input) と toEqual で、{ id, label: { title, intro } } の原文を持つ', () => {
    const entry = queueEntryOf(input())
    expect(entry).toEqual(queuedEpisode(input()))
    // 正方向対照: 空の戻り値や既定値では成立しない実測値
    expect(entry).toEqual({ id: 'a', label: { title: '題', intro: 'イントロの全文' } })
  })

  test('verifies: CI-T01 — 戻り値は深く凍結され、title が null でも原文のまま保つ', () => {
    expect(unfrozenNodes(queueEntryOf(input()))).toEqual([])
    expect(queueEntryOf({ id: 'a', title: null, intro: 'i' }).label).toEqual({ title: null, intro: 'i' })
  })

  test('verifies: CI-T01 — 呼出の後で入力を書き換えても戻り値は変わらず、入力は凍結されず、参照を共有しない', () => {
    const given = input() as { id: string; title: string | null; intro: string }
    const entry = queueEntryOf(given)
    given.id = 'changed'
    given.title = 'changed'
    given.intro = 'changed'
    expect(entry).toEqual({ id: 'a', label: { title: '題', intro: 'イントロの全文' } })
    expect(Object.isFrozen(given)).toBe(false)
    expect(entry.label).not.toBe(given)
  })

  test('verifies: CI-T01 — idempotent: 同じ入力から等しい値を返すが、毎回新しい object', () => {
    const first = queueEntryOf(input())
    const second = queueEntryOf(input())
    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    expect(second.label).not.toBe(first.label)
  })
})

describe('web-dec-24 nowPlayingTitle・upNextTitle: displayTitle への委譲', () => {
  const LONG = 'あ'.repeat(60)
  const labels: ReadonlyArray<readonly [string, EpisodeLabel]> = [
    ['題あり', { title: '題', intro: LONG }],
    ['題あり（長い題は切り詰めない）', { title: 'い'.repeat(70), intro: LONG }],
    ['題が null', { title: null, intro: LONG }],
    ['題が空白だけ', { title: '   ', intro: LONG }],
  ]

  test.each(labels)('verifies: CI-T02 — %s: displayTitle(label, 50)・displayTitle(label, 40) と等しい', (_name, label) => {
    expect(nowPlayingTitle(label)).toBe(displayTitle(label, 50))
    expect(upNextTitle(label)).toBe(displayTitle(label, 40))
  })

  test('verifies: CI-T02 — null・空白の題は intro の先頭 50 字・40 字（実測値で固定）、題ありは題そのもの', () => {
    expect(nowPlayingTitle({ title: null, intro: LONG })).toBe('あ'.repeat(50))
    expect(upNextTitle({ title: '   ', intro: LONG })).toBe('あ'.repeat(40))
    expect(nowPlayingTitle({ title: '題', intro: LONG })).toBe('題')
    expect(upNextTitle({ title: '題', intro: LONG })).toBe('題')
  })
})
