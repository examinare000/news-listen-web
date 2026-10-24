// @vitest-environment node
// 再生の command / query の分離（web-check-07）。
// (a) PlaybackCommands の名前の集合 = 7（web-cmd-playback-01〜07）、PlaybackQueries = 5（web-query-playback-01〜05）。
// (b) 書く port を記録する double を渡し、query 5 つを全部呼んでも変更系の呼出が 0 件。
// (c) command の戻り値が void・Promise<void>（retry）・Promise<StartResult> で、リードモデルの型でない。
// 型の等価は `npm run typecheck` が検査する（等価でなければ代入が TS2322 で落ちる）。実行時の検査は vitest が行う。
// 正本: docs/design/modules/web/2026-09-30-implementation-spec-target-architecture.md §7 web-check-07、§5.1 web-deriv-21。
//
// RED 理由（実装前）: `@/lib/playback/application/coordinator`（createPlaybackCoordinator・PlaybackCommands・PlaybackQueries）が
// まだ存在しない（module not found）。
import { describe, expect, test, vi } from 'vitest'
import { createPlaybackCoordinator } from '@/lib/playback/application/coordinator'
import type { PlaybackCommands, PlaybackQueries } from '@/lib/playback/application/coordinator'
import type { StartResult } from '@/lib/playback/application/ports'
import type {
  NowPlaying,
  PlaybackView,
  QueueView,
  UpNextItem,
} from '@/lib/playback/application/readModels'
import { createPlaybackSession } from '@/lib/playback/application/session'
import type { PlayableEpisode } from '@/lib/playback/domain/session'
import { MockAudio } from '../helpers/mockAudio'

// ---------------------------------------------------------------------------
// 型の等価（実行しない。typecheck だけが読む）
// ---------------------------------------------------------------------------
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

type CommandNames = 'startEpisode' | 'retry' | 'addToQueue' | 'playNext' | 'removeFromQueue' | 'reorder' | 'skipToNext'
type QueryNames = 'nowPlaying' | 'upNext' | 'queueView' | 'playbackView' | 'savedPosition'

function typeProbes(coordinator: ReturnType<typeof createPlaybackCoordinator>): void {
  // (a) 名前の集合が過不足なく一致する
  const commandKeys: Equals<keyof PlaybackCommands, CommandNames> = true
  const queryKeys: Equals<keyof PlaybackQueries, QueryNames> = true
  // (c) command の戻り値
  const startEpisode: Equals<ReturnType<PlaybackCommands['startEpisode']>, Promise<StartResult>> = true
  const retry: Equals<ReturnType<PlaybackCommands['retry']>, Promise<void>> = true
  const addToQueue: Equals<ReturnType<PlaybackCommands['addToQueue']>, Promise<StartResult>> = true
  const playNext: Equals<ReturnType<PlaybackCommands['playNext']>, Promise<StartResult>> = true
  const removeFromQueue: Equals<ReturnType<PlaybackCommands['removeFromQueue']>, void> = true
  const reorder: Equals<ReturnType<PlaybackCommands['reorder']>, void> = true
  const skipToNext: Equals<ReturnType<PlaybackCommands['skipToNext']>, Promise<StartResult>> = true
  // query の戻り値はリードモデル
  const nowPlaying: Equals<ReturnType<PlaybackQueries['nowPlaying']>, NowPlaying | null> = true
  const upNext: Equals<ReturnType<PlaybackQueries['upNext']>, ReadonlyArray<UpNextItem>> = true
  const queueView: Equals<ReturnType<PlaybackQueries['queueView']>, QueueView> = true
  const playbackView: Equals<ReturnType<PlaybackQueries['playbackView']>, PlaybackView> = true
  const savedPosition: Equals<ReturnType<PlaybackQueries['savedPosition']>, number | null> = true
  // 戻り値の型は command と query の別の型の両方を満たす
  const asCommands: PlaybackCommands = coordinator
  const asQueries: PlaybackQueries = coordinator
  void [
    commandKeys,
    queryKeys,
    startEpisode,
    retry,
    addToQueue,
    playNext,
    removeFromQueue,
    reorder,
    skipToNext,
    nowPlaying,
    upNext,
    queueView,
    playbackView,
    savedPosition,
    asCommands,
    asQueries,
  ]
}
void typeProbes

// ---------------------------------------------------------------------------
// 呼出を記録する double
// ---------------------------------------------------------------------------
type Deps = Parameters<typeof createPlaybackCoordinator>[0]

const SESSION_MUTATORS = ['start', 'play', 'pause', 'seek', 'seekRelative', 'setSpeed', 'setVolume', 'stop', 'fail'] as const

/** 変更系の port の呼出名（記録の中でこれに当たるものが 1 件でもあれば query が書いたことになる）。 */
const WRITE_CALLS: ReadonlySet<string> = new Set([
  'offline.save',
  'offline.remove',
  'offline.clear',
  'localPositions.write',
  'positionReporter.attach',
  'positionReporter.detach',
  ...SESSION_MUTATORS.map((name) => `session.${name}`),
])

function episode(id: string): PlayableEpisode {
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
  }
}

function harness() {
  const calls: string[] = []
  const session = createPlaybackSession(new MockAudio())
  const sessionSpies = SESSION_MUTATORS.map((name) => [name, vi.spyOn(session, name)] as const)
  /** これまでの記録（port の呼出と session の変更操作）を返して空にする。 */
  const drain = (): string[] => {
    const recorded = [...calls]
    for (const [name, spy] of sessionSpies) {
      if (spy.mock.calls.length > 0) recorded.push(`session.${name}`)
      spy.mockClear()
    }
    calls.length = 0
    return recorded
  }
  const deps: Deps = {
    session,
    offline: {
      save: () => {
        calls.push('offline.save')
        return Promise.resolve({ ok: true, value: undefined })
      },
      get: () => {
        calls.push('offline.get')
        return Promise.resolve(null)
      },
      has: () => {
        calls.push('offline.has')
        return Promise.resolve(false)
      },
      remove: () => {
        calls.push('offline.remove')
        return Promise.resolve()
      },
      clear: () => {
        calls.push('offline.clear')
        return Promise.resolve()
      },
      list: () => {
        calls.push('offline.list')
        return Promise.resolve([])
      },
      usage: () => {
        calls.push('offline.usage')
        return Promise.resolve(null)
      },
    },
    positionReporter: {
      attach: () => void calls.push('positionReporter.attach'),
      detach: () => void calls.push('positionReporter.detach'),
      lastSyncFailure: () => null,
    },
    episodes: {
      fetch: (id: string) => {
        calls.push('episodes.fetch')
        return Promise.resolve({ ok: true, value: episode(id) })
      },
    },
    localPositions: {
      read: () => null,
      write: () => void calls.push('localPositions.write'),
    },
    isOnline: () => true,
    defaultSpeed: () => 1,
  }
  const coordinator = createPlaybackCoordinator(deps)
  return { coordinator, drain, session }
}

const entry = (id: string) => ({ id, title: `title ${id}`, intro: `intro ${id}` })

// ---------------------------------------------------------------------------
// (a) 名前の集合
// ---------------------------------------------------------------------------
describe('web-check-07 (a) command 7 と query 5 は別の名前の集合として公開される', () => {
  test('verifies: CI-T38 (web-check-07, web-cmd-playback-01) — 戻り値の key は command 7 ＋ query 5 ＋ subscribe の 13 だけ', () => {
    const { coordinator } = harness()
    const commands: readonly CommandNames[] = [
      'startEpisode',
      'retry',
      'addToQueue',
      'playNext',
      'removeFromQueue',
      'reorder',
      'skipToNext',
    ]
    const queries: readonly QueryNames[] = ['nowPlaying', 'upNext', 'queueView', 'playbackView', 'savedPosition']
    expect(commands).toHaveLength(7)
    expect(queries).toHaveLength(5)
    expect(Object.keys(coordinator).sort()).toEqual([...commands, ...queries, 'subscribe'].sort())
    for (const name of [...commands, ...queries, 'subscribe']) {
      expect(typeof (coordinator as unknown as Record<string, unknown>)[name], name).toBe('function')
    }
  })
})

// ---------------------------------------------------------------------------
// (b) query は書かない
// ---------------------------------------------------------------------------
describe('web-check-07 (b) query 5 つを全部呼んでも、変更系の呼出は 0 件', () => {
  test('verifies: CI-T35 (web-check-07, web-query-playback-01) — 再生中で待機列があるとき、query の前後で session の状態は同じ参照・キューの見え方も不変で、書く port の記録が 0 件', async () => {
    const { coordinator, drain, session } = harness()
    await coordinator.startEpisode('a')
    await coordinator.addToQueue(entry('b'))

    // 正方向対照: 同じ記録に、command は取得（episodes.fetch）と session の変更を残す（記録が配線されている）
    const afterCommands = drain()
    expect(afterCommands).toContain('episodes.fetch')
    expect(afterCommands).toContain('session.start')
    expect(afterCommands.some((name) => WRITE_CALLS.has(name))).toBe(true)

    const stateBefore = session.state()
    const queueBefore = coordinator.queueView()
    expect(coordinator.nowPlaying()?.episodeId).toBe('a')
    expect(queueBefore.upNext.map((item) => item.id)).toEqual(['b'])
    drain()

    coordinator.nowPlaying()
    coordinator.upNext()
    coordinator.queueView()
    coordinator.playbackView()
    coordinator.savedPosition('a')

    expect(drain().filter((name) => WRITE_CALLS.has(name))).toEqual([])
    expect(session.state()).toBe(stateBefore)
    expect(coordinator.queueView()).toEqual(queueBefore)
    expect(coordinator.upNext().map((item) => item.id)).toEqual(['b'])
  })
})

// ---------------------------------------------------------------------------
// (c) command の戻り値
// ---------------------------------------------------------------------------
describe('web-check-07 (c) command の戻り値は void・Promise<void>（retry）・Promise<StartResult>', () => {
  test('verifies: CI-T38 (web-check-07, web-deriv-21) — 開始系は Promise<{ ok: true }>、retry は Promise<undefined>、removeFromQueue・reorder は undefined', async () => {
    const { coordinator } = harness()

    const started = coordinator.startEpisode('a')
    expect(started).toBeInstanceOf(Promise)
    expect(await started).toEqual({ ok: true })
    expect(await coordinator.addToQueue(entry('b'))).toEqual({ ok: true })
    expect(await coordinator.playNext(entry('c'))).toEqual({ ok: true })
    expect(await coordinator.addToQueue(entry('d'))).toEqual({ ok: true })

    const retried = coordinator.retry()
    expect(retried).toBeInstanceOf(Promise)
    expect(await retried).toBeUndefined()

    expect(coordinator.reorder(0, 1)).toBeUndefined()
    expect(coordinator.removeFromQueue('d')).toBeUndefined()

    const skipped = coordinator.skipToNext()
    expect(skipped).toBeInstanceOf(Promise)
    expect(await skipped).toEqual({ ok: true })
  })

  test('verifies: CI-T38 (web-check-07) — command の戻り値はリードモデルの形（nowPlaying・upNext・canSkipNext・status）を持たない', async () => {
    const { coordinator } = harness()
    const results: unknown[] = [
      await coordinator.startEpisode('a'),
      await coordinator.addToQueue(entry('b')),
      await coordinator.skipToNext(),
      await coordinator.retry(),
      coordinator.removeFromQueue('zzz'),
    ]
    for (const result of results) {
      if (typeof result !== 'object' || result === null) continue
      for (const key of ['nowPlaying', 'upNext', 'canSkipNext', 'status', 'primaryAction']) {
        expect(result, key).not.toHaveProperty(key)
      }
    }
  })
})
