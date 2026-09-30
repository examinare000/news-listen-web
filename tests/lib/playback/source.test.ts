// 旧 tests/lib/resolvePlayback.test.ts の複製（対象 import だけが違う）。挙動は旧 lib/resolvePlayback.ts と同一。
// RED 理由: `@/lib/playback/source` がまだ存在しない。
import { describe, test, expect } from 'vitest'
import { resolvePlaybackSource } from '@/lib/playback/source'

// ==========================================================
// resolvePlaybackSource — オフライン再生の分岐（issue #167）
// キャッシュがあれば常にそれを優先する（getPodcast() 再取得をスキップしオフラインでも動く）。
// ==========================================================
describe('resolvePlaybackSource', () => {
  test('Given cached audio exists and online, returns cached (skip refetch)', () => {
    const result = resolvePlaybackSource({ hasCached: true, isOnline: true })
    expect(result).toBe('cached')
  })

  test('Given cached audio exists and offline, returns cached', () => {
    const result = resolvePlaybackSource({ hasCached: true, isOnline: false })
    expect(result).toBe('cached')
  })

  test('Given no cache and online, returns network', () => {
    const result = resolvePlaybackSource({ hasCached: false, isOnline: true })
    expect(result).toBe('network')
  })

  test('Given no cache and offline, returns unavailable', () => {
    const result = resolvePlaybackSource({ hasCached: false, isOnline: false })
    expect(result).toBe('unavailable')
  })
})
