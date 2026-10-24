// 再生のリードモデル 6 つと生成関数の契約テスト（画面が読む形。domain の object・関数を含まない）。
// 正本: docs/design/modules/web/2026-09-30-implementation-spec-target-architecture.md §5.1 リードモデルの形（web-query-playback-04・web-deriv-14）。
//
// 引数の形（生成関数の呼出し）:
//   toNowPlaying(entry: QueuedEpisode | null, state: PlaybackState)        // entry = current(queue)
//   toUpNextItems(entries: ReadonlyArray<QueuedEpisode>)                    // entries = upNext(queue)
//   toQueueView(nowPlaying: NowPlaying | null, upNext: ReadonlyArray<UpNextItem>)
//   toPlaybackView(state: PlaybackState, nowPlaying: NowPlaying | null, defaultSpeed: PlaybackSpeed)
//   toOfflineEpisodeView({ episodeId, title, durationSeconds, sizeBytes?, savedAt? })
//   toStorageUsageView({ usage, quota } | null)
//
// RED 理由（実装前）: `@/lib/playback/application/readModels` がまだ存在しない（module not found）。
import { describe, expect, test } from 'vitest'
import type { PlayableEpisode, QueuedEpisode } from '@/lib/catalog/domain/episode'
import type { PlaybackState, PlaybackSpeed } from '@/lib/playback/domain/session'
import {
  toNowPlaying,
  toOfflineEpisodeView,
  toPlaybackView,
  toQueueView,
  toStorageUsageView,
  toUpNextItems,
} from '@/lib/playback/application/readModels'

// ---------------------------------------------------------------------------
// helper
// ---------------------------------------------------------------------------
function unfrozenNodes(value: unknown, where = '$'): string[] {
  if (typeof value !== 'object' || value === null) return []
  const found = Object.isFrozen(value) ? [] : [where]
  for (const [key, child] of Object.entries(value)) found.push(...unfrozenNodes(child, `${where}.${key}`))
  return found
}

/** 関数を含まないことを全深さで確かめる。 */
function containsFunction(value: unknown): boolean {
  if (typeof value === 'function') return true
  if (typeof value !== 'object' || value === null) return false
  return Object.values(value).some(containsFunction)
}

const LONG = 'あ'.repeat(60)

function episode(id: string, over: Partial<PlayableEpisode> = {}): PlayableEpisode {
  return {
    kind: 'playable',
    id,
    title: `title ${id}`,
    label: { title: `title ${id}`, intro: `intro ${id}` },
    audioUrl: `https://example.com/${id}.mp3`,
    durationSeconds: 600,
    difficulty: 'toeic_600',
    createdAt: '2026-05-31T06:00:00Z',
    serverPositionSeconds: 0,
    ...over,
  }
}

const entry = (id: string, title: string | null = `title ${id}`, intro = `intro ${id}`): QueuedEpisode => ({
  id,
  label: { title, intro },
})

const DEFAULT_SPEED: PlaybackSpeed = 1.5
const A = episode('a')

const NOW_PLAYING = toNowPlaying(entry('a'), { status: 'loading', episode: A, resumePosition: 0, speed: 1 })

// ---------------------------------------------------------------------------
// PlaybackView: 6 状態 × field
// ---------------------------------------------------------------------------
describe('web-query-playback-04 toPlaybackView: 状態から画面用の値を導く', () => {
  const states: ReadonlyArray<readonly [string, PlaybackState]> = [
    ['idle', { status: 'idle' }],
    ['loading', { status: 'loading', episode: A, resumePosition: 33, speed: 2 }],
    ['paused', { status: 'paused', episode: A, position: 44, duration: 700, speed: 1.25 }],
    ['playing', { status: 'playing', episode: A, position: 55, duration: 800, speed: 0.75 }],
    ['ended', { status: 'ended', episode: A, duration: 900 }],
    [
      'errored',
      { status: 'errored', episode: A, position: 66, speed: 1.75, reason: { kind: 'media' } },
    ],
  ]

  test('前提: NowPlaying の durationSeconds は 600（状態の duration と区別できる実測値）', () => {
    expect(NOW_PLAYING).not.toBeNull()
    expect(NOW_PLAYING?.durationSeconds).toBe(600)
  })

  test.each([
    ['idle', 0],
    ['loading', 33],
    ['paused', 44],
    ['playing', 55],
    ['ended', 0],
    ['errored', 66],
  ] as const)('verifies: CI-T04 (web-query-playback-04) — position: %s → %d', (name, expected) => {
    const state = states.find(([n]) => n === name)![1]
    expect(toPlaybackView(state, NOW_PLAYING, DEFAULT_SPEED).position).toBe(expected)
  })

  test.each([
    ['idle', 600],
    ['loading', 600],
    ['paused', 700],
    ['playing', 800],
    ['ended', 900],
    ['errored', 600],
  ] as const)('verifies: CI-T05 (web-rule-playback-09) — duration: %s → %d（NowPlaying の長さ 600 を持つとき）', (name, expected) => {
    const state = states.find(([n]) => n === name)![1]
    expect(toPlaybackView(state, NOW_PLAYING, DEFAULT_SPEED).duration).toBe(expected)
  })

  test('verifies: CI-T05 (web-rule-playback-09) — 状態の duration が 0 のとき、またはほかの状態で NowPlaying が無ければ NowPlaying の長さ、無ければ 0', () => {
    const playingUnknown: PlaybackState = { status: 'playing', episode: A, position: 1, duration: 0, speed: 1 }
    const endedUnknown: PlaybackState = { status: 'ended', episode: A, duration: 0 }
    expect(toPlaybackView(playingUnknown, NOW_PLAYING, DEFAULT_SPEED).duration).toBe(600)
    expect(toPlaybackView(endedUnknown, NOW_PLAYING, DEFAULT_SPEED).duration).toBe(600)
    expect(toPlaybackView(playingUnknown, null, DEFAULT_SPEED).duration).toBe(0)
    for (const [, state] of states.filter(([n]) => n === 'idle' || n === 'loading' || n === 'errored')) {
      expect(toPlaybackView(state, null, DEFAULT_SPEED).duration).toBe(0)
    }
    // 状態の duration が正なら NowPlaying が無くてもそれを使う
    expect(toPlaybackView(states[3][1], null, DEFAULT_SPEED).duration).toBe(800)
  })

  test.each([
    ['idle', 1.5],
    ['loading', 2],
    ['paused', 1.25],
    ['playing', 0.75],
    ['ended', 1.5],
    ['errored', 1.75],
  ] as const)('verifies: CI-T06 (web-query-playback-04) — speed: %s → %d（idle・ended は defaultSpeed の 1.5）', (name, expected) => {
    const state = states.find(([n]) => n === name)![1]
    expect(toPlaybackView(state, NOW_PLAYING, DEFAULT_SPEED).speed).toBe(expected)
  })

  test.each([
    ['idle', 'none'],
    ['loading', 'none'],
    ['paused', 'play'],
    ['playing', 'pause'],
    ['ended', 'replay'],
    ['errored', 'retry'],
  ] as const)('verifies: CI-T07 (web-deriv-14) — primaryAction と status: %s → %s', (name, action) => {
    const state = states.find(([n]) => n === name)![1]
    const view = toPlaybackView(state, NOW_PLAYING, DEFAULT_SPEED)
    expect(view.primaryAction).toBe(action)
    expect(view.status).toBe(name)
  })

  test('verifies: CI-T08 (web-query-playback-04) — failure: media・autoplay_blocked → media、fetch_failed・source_unavailable → unavailable、errored 以外 → null', () => {
    const errored = (reason: Extract<PlaybackState, { status: 'errored' }>['reason']): PlaybackState => ({
      status: 'errored',
      episode: { id: 'a' },
      position: 0,
      speed: 1,
      reason,
    })
    const failureOf = (state: PlaybackState): unknown => toPlaybackView(state, null, DEFAULT_SPEED).failure
    expect(failureOf(errored({ kind: 'media' }))).toBe('media')
    expect(failureOf(errored({ kind: 'autoplay_blocked' }))).toBe('media')
    expect(failureOf(errored({ kind: 'source_unavailable' }))).toBe('unavailable')
    expect(failureOf(errored({ kind: 'fetch_failed', failure: { kind: 'validation', detail: 'd' } }))).toBe('unavailable')
    for (const [name, state] of states.filter(([n]) => n !== 'errored')) {
      expect(failureOf(state), `${name} の failure`).toBeNull()
    }
  })

  test('verifies: CI-T04 (web-check-06) — 呼ぶたびに新しい深く凍結された値で、key は 6 つだけ・関数を含まない', () => {
    const state = states[3][1]
    const first = toPlaybackView(state, NOW_PLAYING, DEFAULT_SPEED)
    const second = toPlaybackView(state, NOW_PLAYING, DEFAULT_SPEED)
    expect(second).not.toBe(first)
    expect(second).toEqual(first)
    expect(unfrozenNodes(first)).toEqual([])
    expect(Object.keys(first).sort()).toEqual(['duration', 'failure', 'position', 'primaryAction', 'speed', 'status'])
    expect(containsFunction(first)).toBe(false)
    expect(first).not.toBe(state)
  })
})

// ---------------------------------------------------------------------------
// NowPlaying
// ---------------------------------------------------------------------------
describe('web-deriv-12 toNowPlaying: 5 field だけを持つ。出所が無い状態では null', () => {
  const loadingA: PlaybackState = { status: 'loading', episode: A, resumePosition: 0, speed: 1 }

  test('verifies: CI-T09 (web-deriv-12) — key がちょうど episodeId・title・difficulty・createdAt・durationSeconds で、値は session の episode と entry の題から導く', () => {
    const result = toNowPlaying(entry('a'), loadingA)
    expect(result).toEqual({
      episodeId: 'a',
      title: 'title a',
      difficulty: 'toeic_600',
      createdAt: '2026-05-31T06:00:00Z',
      durationSeconds: 600,
    })
    expect(Object.keys(result!).sort()).toEqual(['createdAt', 'difficulty', 'durationSeconds', 'episodeId', 'title'])
  })

  test('verifies: CI-T09 (web-deriv-12) — title は題あり ＝ 題そのもの、題が null・空白 ＝ intro の先頭 50 字', () => {
    expect(toNowPlaying(entry('a', '題', LONG), loadingA)?.title).toBe('題')
    expect(toNowPlaying(entry('a', null, LONG), loadingA)?.title).toBe('あ'.repeat(50))
    expect(toNowPlaying(entry('a', '   ', LONG), loadingA)?.title).toBe('あ'.repeat(50))
  })

  test('verifies: CI-T09 (web-deriv-12) — null になるのは、entry が無い・idle・id だけの参照の errored・entry と session の episode の id が違うとき', () => {
    const refErrored: PlaybackState = {
      status: 'errored',
      episode: { id: 'a' },
      position: 0,
      speed: 1,
      reason: { kind: 'source_unavailable' },
    }
    expect(toNowPlaying(null, loadingA)).toBeNull()
    expect(toNowPlaying(entry('a'), { status: 'idle' })).toBeNull()
    expect(toNowPlaying(entry('a'), refErrored)).toBeNull()
    expect(toNowPlaying(entry('b'), loadingA)).toBeNull()
    // 正方向対照: 同じ入口で、条件を外せば値が返る
    expect(toNowPlaying(entry('a'), loadingA)).not.toBeNull()
    expect(
      toNowPlaying(entry('a'), { status: 'errored', episode: A, position: 3, speed: 1, reason: { kind: 'media' } }),
    ).not.toBeNull()
  })

  test('verifies: CI-T09 (web-check-06) — 呼ぶたびに新しい深く凍結された値', () => {
    const first = toNowPlaying(entry('a'), loadingA)
    const second = toNowPlaying(entry('a'), loadingA)
    expect(second).not.toBe(first)
    expect(second).toEqual(first)
    expect(unfrozenNodes(first)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// その他の生成関数
// ---------------------------------------------------------------------------
describe('web-check-06 UpNextItem・QueueView・OfflineEpisodeView・StorageUsageView の生成関数', () => {
  test('verifies: CI-T10 (web-check-06) — toUpNextItems: { id, title } だけ。title は 40 字の規則で、呼ぶたびに新しい凍結済みの配列と要素。label は共有しない', () => {
    const entries = [entry('b', null, LONG), entry('c', '題', LONG)]
    const first = toUpNextItems(entries)
    expect(first).toEqual([
      { id: 'b', title: 'あ'.repeat(40) },
      { id: 'c', title: '題' },
    ])
    expect(first.map((i) => Object.keys(i).sort())).toEqual([
      ['id', 'title'],
      ['id', 'title'],
    ])
    const second = toUpNextItems(entries)
    expect(second).not.toBe(first)
    expect(second[0]).not.toBe(first[0])
    expect(unfrozenNodes(first)).toEqual([])
    for (const item of first) for (const entryIn of entries) expect(item).not.toBe(entryIn)
    expect(toUpNextItems([])).toEqual([])
  })

  test('verifies: CI-T10 (web-check-06) — toQueueView: { nowPlaying, upNext, canSkipNext }。canSkipNext は upNext が 1 件以上のときだけ true', () => {
    const items = toUpNextItems([entry('b')])
    const withNext = toQueueView(NOW_PLAYING, items)
    expect(withNext.nowPlaying).toEqual(NOW_PLAYING)
    expect(withNext.upNext).toEqual(items)
    expect(withNext.canSkipNext).toBe(true)
    expect(Object.keys(withNext).sort()).toEqual(['canSkipNext', 'nowPlaying', 'upNext'])

    const empty = toQueueView(null, [])
    expect(empty).toEqual({ nowPlaying: null, upNext: [], canSkipNext: false })

    const again = toQueueView(NOW_PLAYING, items)
    expect(again).not.toBe(withNext)
    expect(unfrozenNodes(withNext)).toEqual([])
    expect(unfrozenNodes(empty)).toEqual([])
  })

  test('verifies: CI-T10 (web-dec-27) — toOfflineEpisodeView: sizeBytes・savedAt は欠けたら null、あればそのまま。title は渡された値のまま（displayTitle を当てない）', () => {
    const full = toOfflineEpisodeView({
      episodeId: 'a',
      title: LONG,
      durationSeconds: 120,
      sizeBytes: 2048,
      savedAt: '2026-10-01T00:00:00.000Z',
    })
    expect(full).toEqual({
      episodeId: 'a',
      title: LONG,
      durationSeconds: 120,
      sizeBytes: 2048,
      savedAt: '2026-10-01T00:00:00.000Z',
    })
    const legacy = toOfflineEpisodeView({ episodeId: 'b', title: 't', durationSeconds: 5 })
    expect(legacy).toEqual({ episodeId: 'b', title: 't', durationSeconds: 5, sizeBytes: null, savedAt: null })
    expect(Object.keys(legacy).sort()).toEqual(['durationSeconds', 'episodeId', 'savedAt', 'sizeBytes', 'title'])
    expect(unfrozenNodes(full)).toEqual([])
    expect(unfrozenNodes(legacy)).toEqual([])
    expect(toOfflineEpisodeView({ episodeId: 'b', title: 't', durationSeconds: 5 })).not.toBe(legacy)
  })

  test('verifies: CI-T10 (web-check-06) — toStorageUsageView: { usage, quota }（新しい凍結済みの値）。入力 null → null', () => {
    const input = { usage: 10, quota: 100 }
    const view = toStorageUsageView(input)
    expect(view).toEqual({ usage: 10, quota: 100 })
    expect(view).not.toBe(input)
    expect(unfrozenNodes(view)).toEqual([])
    expect(toStorageUsageView(input)).not.toBe(view)
    expect(toStorageUsageView(null)).toBeNull()
  })
})
