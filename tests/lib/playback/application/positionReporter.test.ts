// PositionReporter の契約テスト（web-contract-11・web-spec/capsule-09・web-rule-playback-06・ADR-109 決定 7）。
// session は事象を発行するだけの double、sync / outbox / local / clock / subject は呼出を記録する手書きの fake。
// 「書く」= local.write(主体, episode, 記録) → outbox.flush() の順に呼ぶ。応答は待たない（shared-dec-15）。
// Reporter は sync.updatePosition を呼ばない（送信の経路は outbox の 1 本）。
import { describe, test, expect, vi } from 'vitest'
import { createPositionReporter } from '@/lib/playback/application/positionReporter'
import type { PositionOutbox } from '@/lib/playback/application/positionOutbox'
import type { LocalPositionStore, PositionSubject, PositionSync } from '@/lib/playback/application/ports'
import type { PlaybackSession } from '@/lib/playback/application/session'
import type { PlayableEpisode, PlaybackEvent, PlaybackState } from '@/lib/playback/domain/session'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

type SyncResult = Result<void, ApiFailure>
const OK: SyncResult = { ok: true, value: undefined }

// 時計の基準。記録時刻は clock() の値がそのまま（ミリ秒に切り捨てて）入る。
const T0 = 1_000_000

function episode(id: string, durationSeconds: number): PlayableEpisode {
  return {
    kind: 'playable',
    id,
    title: `title ${id}`,
    label: { title: `title ${id}`, intro: `intro ${id}` },
    audioUrl: `https://example.com/${id}.mp3`,
    durationSeconds,
    difficulty: 'toeic_600',
    createdAt: '2026-10-01T00:00:00Z',
    serverPositionSeconds: 0,
  }
}

const loading = (id: string, resumePosition: number, durationSeconds = 100): PlaybackState => ({
  status: 'loading',
  episode: episode(id, durationSeconds),
  resumePosition,
  speed: 1.0,
})
const playing = (id: string, position: number, duration = 100, durationSeconds = 100): PlaybackState => ({
  status: 'playing',
  episode: episode(id, durationSeconds),
  position,
  duration,
  speed: 1.0,
})
const paused = (id: string, position: number, duration = 100, durationSeconds = 100): PlaybackState => ({
  status: 'paused',
  episode: episode(id, durationSeconds),
  position,
  duration,
  speed: 1.0,
})
const errored = (id: string, position: number): PlaybackState => ({
  status: 'errored',
  episode: episode(id, 100),
  position,
  speed: 1.0,
  reason: { kind: 'media' },
})
const idle: PlaybackState = { status: 'idle' }

const stateChanged = (state: PlaybackState): PlaybackEvent => ({ type: 'stateChanged', state })
const positionChanged = (episodeId: string, seconds: number): PlaybackEvent => ({
  type: 'positionChanged',
  episodeId,
  seconds,
})
const listenCompleted = (episodeId: string): PlaybackEvent => ({ type: 'listenCompleted', episodeId })

/** 事象を発行するだけの session double。`Pick<PlaybackSession, 'subscribe'>` を満たす。 */
function createSessionDouble() {
  const listeners = new Set<(event: PlaybackEvent) => void>()
  const session: Pick<PlaybackSession, 'subscribe'> = {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    session,
    emit(...events: PlaybackEvent[]): void {
      for (const event of events) for (const listener of [...listeners]) listener(event)
    },
    listenerCount: () => listeners.size,
  }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

interface SetupOptions {
  readonly flushImpl?: (unpersisted?: Parameters<PositionOutbox['flush']>[0]) => Promise<SyncResult>
  readonly writeResult?: boolean
  readonly recording?: string | null
}

function setup(options: SetupOptions = {}) {
  const log: string[] = []
  const time = { now: T0 }
  const who = { recording: options.recording === undefined ? 'u-a' : options.recording }
  const markCompleted = vi.fn((id: string): Promise<SyncResult> => {
    log.push(`markCompleted:${id}`)
    return Promise.resolve(OK)
  })
  const updatePosition = vi.fn<PositionSync['updatePosition']>()
  const flush = vi.fn<PositionOutbox['flush']>((unpersisted) => {
    log.push(unpersisted === undefined ? 'flush' : `flush:${unpersisted.episodeId}:${unpersisted.record.positionSeconds}`)
    return options.flushImpl ? options.flushImpl(unpersisted) : Promise.resolve(OK)
  })
  const write = vi.fn<LocalPositionStore['write']>((user, id, record) => {
    log.push(`write:${user}:${id}:${record.positionSeconds}@${record.recordedAt}${record.synced ? ':synced' : ''}`)
    return options.writeResult ?? true
  })
  const sync: PositionSync = { updatePosition, markCompleted }
  const outbox: Pick<PositionOutbox, 'flush'> = { flush }
  const local: Pick<LocalPositionStore, 'write'> = { write }
  const clock = vi.fn(() => time.now)
  const subject: PositionSubject = { recording: () => who.recording, sending: () => who.recording }
  const reporter = createPositionReporter({ sync, outbox, local, clock, subject })
  const double = createSessionDouble()
  reporter.attach(double.session)
  return { log, time, who, markCompleted, updatePosition, flush, write, reporter, ...double }
}

/** log に出る「書く」の 1 行。 */
const wrote = (id: string, position: number, at = T0, user = 'u-a'): string => `write:${user}:${id}:${position}@${at}`

describe('verifies: CI-T13 周期の書込（web-contract-11）', () => {
  test('playing 中は 10 秒以上進んだ位置だけ local → outbox.flush の順に書く（5/10/15/20/後退 → 10 と 20）', () => {
    const t = setup()
    t.emit(stateChanged(loading('a', 0)), stateChanged(playing('a', 0)))
    for (const s of [5, 10, 15, 20, 12]) t.emit(positionChanged('a', s))
    expect(t.log).toEqual([wrote('a', 10), 'flush', wrote('a', 20), 'flush'])
    expect(t.updatePosition).not.toHaveBeenCalled()
  })
})

describe('verifies: CI-T12 エピソードごとの基準（web-contract-11）', () => {
  test('loading は書かず、最後に保存した位置 = resumePosition。30 から始めると 35 は書かず 40 で書く', () => {
    const t = setup()
    t.emit(stateChanged(loading('a', 30)))
    expect(t.log).toEqual([])
    t.emit(stateChanged(playing('a', 30)), positionChanged('a', 35))
    expect(t.log).toEqual([])
    t.emit(positionChanged('a', 40))
    expect(t.log).toEqual([wrote('a', 40), 'flush'])
  })
})

describe('verifies: CI-T15 一時停止・停止への遷移で 1 回書く（web-dec-07・shared-dec-19）', () => {
  test('playing → paused で最後の位置を 1 回書き、paused → idle で同じ位置は書かない', () => {
    const t = setup()
    t.emit(stateChanged(loading('a', 0)), stateChanged(playing('a', 0)), positionChanged('a', 9))
    expect(t.log).toEqual([])
    t.emit(stateChanged(paused('a', 9)))
    expect(t.log).toEqual([wrote('a', 9), 'flush'])
    t.emit(stateChanged(idle))
    expect(t.log).toEqual([wrote('a', 9), 'flush'])
  })

  test('playing → idle は最後に分かっている位置を書く（正方向の対照）', () => {
    const t = setup()
    t.emit(stateChanged(loading('a', 0)), stateChanged(playing('a', 0)), positionChanged('a', 7))
    t.emit(stateChanged(idle))
    expect(t.log).toEqual([wrote('a', 7), 'flush'])
  })

  test('shared-sync-01 / shared-dec-19: 40 で保存した後 5 へ巻き戻して一時停止すると 5 を新しい時刻で記録して送る', () => {
    const t = setup()
    t.emit(stateChanged(loading('a', 0)), stateChanged(playing('a', 0)))
    t.time.now = T0
    t.emit(positionChanged('a', 40))
    expect(t.log).toEqual([wrote('a', 40, T0), 'flush'])
    t.time.now = T0 + 1000
    t.emit(stateChanged(paused('a', 5)))
    expect(t.log.slice(2)).toEqual([wrote('a', 5, T0 + 1000), 'flush'])
    expect(t.write).toHaveBeenLastCalledWith('u-a', 'a', { positionSeconds: 5, recordedAt: T0 + 1000, synced: false })
    expect(t.updatePosition).not.toHaveBeenCalled()
  })
})

describe('verifies: CI-T14 一時停止中は周期送信しない（shared-dec-29・shared-session-06）', () => {
  test('paused 中の positionChanged（seek）は書かない', () => {
    const t = setup()
    t.emit(stateChanged(loading('a', 0)), stateChanged(playing('a', 0)), stateChanged(paused('a', 0)))
    t.emit(positionChanged('a', 50), positionChanged('a', 80))
    expect(t.log).toEqual([])
  })
})

describe('verifies: CI-T16 errored / idle では書かない（shared-session-05）', () => {
  test('errored・idle での positionChanged は周期の書込をしない', () => {
    const t = setup()
    t.emit(stateChanged(loading('a', 0)), stateChanged(errored('a', 0)), positionChanged('a', 50))
    t.emit(stateChanged(idle), positionChanged('a', 90))
    expect(t.log).toEqual([])
  })

  test('loading → idle では書かない', () => {
    const t = setup()
    t.emit(stateChanged(loading('a', 30)), stateChanged(idle))
    expect(t.log).toEqual([])
  })

  test('loading → paused では書かない（状態の position が resume と違っても）', () => {
    const t = setup()
    t.emit(stateChanged(loading('a', 30)), stateChanged(paused('a', 50)))
    expect(t.log).toEqual([])
  })

  test('playing → errored では書かない', () => {
    const t = setup()
    t.emit(stateChanged(loading('a', 0)), stateChanged(playing('a', 0)), positionChanged('a', 5))
    t.emit(stateChanged(errored('a', 5)))
    expect(t.log).toEqual([])
  })

  test('errored・idle・loading では記録しない（shared-session-05）', () => {
    const t = setup()
    t.emit(stateChanged(loading('a', 0)), positionChanged('a', 50))
    t.emit(stateChanged(errored('a', 50)), positionChanged('a', 80))
    t.emit(stateChanged(idle), positionChanged('a', 90))
    expect(t.write).not.toHaveBeenCalled()
    expect(t.flush).not.toHaveBeenCalled()

    // 正方向の対照: 同じ入口から playing の 10 秒以上の進みは記録される。
    t.emit(stateChanged(loading('b', 0)), stateChanged(playing('b', 0)), positionChanged('b', 10))
    expect(t.log).toEqual([wrote('b', 10), 'flush'])
  })
})

describe('verifies: CI-T17 完聴（shared-session-07・shared-dec-26）', () => {
  // 完聴の記録は backend の first-write-wins に依存する。2 回目以降を送らないのはこの前提のため。
  test('markCompleted → local.write(総時間・未送信) → outbox.flush の順に呼び始める', () => {
    const t = setup()
    t.emit(stateChanged(loading('a', 0, 100)), stateChanged(playing('a', 0, 100)))
    t.emit(listenCompleted('a'))
    expect(t.log).toEqual(['markCompleted:a', wrote('a', 100), 'flush'])
    expect(t.write).toHaveBeenCalledWith('u-a', 'a', { positionSeconds: 100, recordedAt: T0, synced: false })
    expect(t.updatePosition).not.toHaveBeenCalled()
  })

  test('同じ再生で 2 回届いても 1 回だけ送り、次の loading の後は再び送る', () => {
    const t = setup()
    t.emit(stateChanged(loading('a', 0, 100)), stateChanged(playing('a', 0, 100)))
    t.emit(listenCompleted('a'), listenCompleted('a'))
    expect(t.markCompleted).toHaveBeenCalledTimes(1)
    expect(t.flush).toHaveBeenCalledTimes(1)
    t.emit(stateChanged(loading('b', 0, 80)), stateChanged(playing('b', 0, 80)), listenCompleted('b'))
    expect(t.markCompleted).toHaveBeenCalledTimes(2)
    expect(t.markCompleted).toHaveBeenLastCalledWith('b')
    expect(t.flush).toHaveBeenCalledTimes(2)
    expect(t.write).toHaveBeenLastCalledWith('u-a', 'b', { positionSeconds: 80, recordedAt: T0, synced: false })
  })
})

describe('verifies: CI-T18 総時間の代替（shared-dec-14）', () => {
  test('状態の duration > 0 ならそれを優先する（episode の総時間より）', () => {
    const t = setup()
    t.emit(stateChanged(loading('a', 0, 100)), stateChanged(playing('a', 0, 120, 100)), listenCompleted('a'))
    expect(t.write).toHaveBeenCalledWith('u-a', 'a', { positionSeconds: 120, recordedAt: T0, synced: false })
  })

  test('状態の duration が 0 なら episode の総時間', () => {
    const t = setup()
    t.emit(stateChanged(loading('a', 0, 90)), stateChanged(playing('a', 0, 0, 90)), listenCompleted('a'))
    expect(t.write).toHaveBeenCalledWith('u-a', 'a', { positionSeconds: 90, recordedAt: T0, synced: false })
  })

  test('どちらも 0 なら最後に分かっている位置', () => {
    const t = setup()
    t.emit(stateChanged(loading('a', 0, 0)), stateChanged(playing('a', 0, 0, 0)), positionChanged('a', 6))
    t.emit(listenCompleted('a'))
    expect(t.flush).toHaveBeenCalledTimes(1)
    expect(t.write).toHaveBeenCalledWith('u-a', 'a', { positionSeconds: 6, recordedAt: T0, synced: false })
  })

  test('すべて 0 なら markCompleted は呼ぶが、local.write・flush は 0 回（shared-dec-38）', () => {
    const t = setup()
    t.emit(stateChanged(loading('a', 0, 0)), stateChanged(playing('a', 0, 0, 0)), listenCompleted('a'))
    expect(t.log).toEqual(['markCompleted:a'])
    expect(t.write).not.toHaveBeenCalled()
    expect(t.flush).not.toHaveBeenCalled()
  })
})

describe('verifies: CI-T20 応答を待たない（shared-dec-15）', () => {
  test('outbox.flush が決着しなくても事象の処理は同期で終わり後続が進む', () => {
    const pending = deferred<SyncResult>()
    const t = setup({ flushImpl: () => pending.promise })
    t.emit(stateChanged(loading('a', 0)), stateChanged(playing('a', 0)))
    t.emit(positionChanged('a', 10))
    t.emit(positionChanged('a', 20))
    expect(t.flush).toHaveBeenCalledTimes(2)
    expect(t.write).toHaveBeenCalledTimes(2)
  })

  test('markCompleted が未決着でも記録と flush を同じ同期区間で呼び始める', () => {
    const pendingCompleted = deferred<SyncResult>()
    const t = setup()
    t.markCompleted.mockImplementation((id) => {
      t.log.push(`markCompleted:${id}`)
      return pendingCompleted.promise
    })
    t.emit(stateChanged(loading('a', 0, 100)), stateChanged(playing('a', 0, 100)), listenCompleted('a'))
    expect(t.log).toEqual(['markCompleted:a', wrote('a', 100), 'flush'])
  })
})

describe('verifies: CI-T19 lastSyncFailure（web-contract-11）', () => {
  test('初期は null。flush が失敗を返すと failure を持ち、後の成功で消えず、Reporter は再送しない', async () => {
    const failure: ApiFailure = { kind: 'server', status: 503 }
    const results: SyncResult[] = [{ ok: false, failure }, OK]
    const t = setup({ flushImpl: () => Promise.resolve(results.shift() ?? OK) })
    expect(t.reporter.lastSyncFailure()).toBeNull()

    t.emit(stateChanged(loading('a', 0)), stateChanged(playing('a', 0)), positionChanged('a', 10))
    await settle()
    expect(t.reporter.lastSyncFailure()).toEqual(failure)
    expect(t.flush).toHaveBeenCalledTimes(1)

    t.emit(positionChanged('a', 20))
    await settle()
    expect(t.flush).toHaveBeenCalledTimes(2)
    expect(t.reporter.lastSyncFailure()).toEqual(failure)
  })

  test('より後に失敗した flush の failure に置き換わる', async () => {
    const t = setup({ flushImpl: () => Promise.resolve({ ok: false, failure: { kind: 'network' } }) })
    t.emit(stateChanged(loading('a', 0)), stateChanged(playing('a', 0)), positionChanged('a', 10))
    await settle()
    expect(t.reporter.lastSyncFailure()).toEqual({ kind: 'network' })
  })
})

describe('verifies: CI-T11 attach / detach（web-contract-11）', () => {
  test('detach 後は事象を受けず書かない。detach の重複は no-op', () => {
    const t = setup()
    t.emit(stateChanged(loading('a', 0)), stateChanged(playing('a', 0)), positionChanged('a', 10))
    expect(t.write).toHaveBeenCalledTimes(1)
    t.reporter.detach()
    t.reporter.detach()
    t.emit(positionChanged('a', 30), listenCompleted('a'))
    expect(t.write).toHaveBeenCalledTimes(1)
    expect(t.markCompleted).not.toHaveBeenCalled()
    expect(t.listenerCount()).toBe(0)
  })

  test('attach を 2 回呼んでも購読は 1 つで、書込は 1 組だけ', () => {
    const t = setup()
    t.reporter.attach(t.session)
    expect(t.listenerCount()).toBe(1)
    t.emit(stateChanged(loading('a', 0)), stateChanged(playing('a', 0)), positionChanged('a', 10))
    expect(t.log).toEqual([wrote('a', 10), 'flush'])
  })

  test('別の session に attach し直すと前の session の購読を外す', () => {
    const t = setup()
    const other = createSessionDouble()
    t.reporter.attach(other.session)
    expect(t.listenerCount()).toBe(0)
    expect(other.listenerCount()).toBe(1)
    other.emit(stateChanged(loading('b', 0)), stateChanged(playing('b', 0)), positionChanged('b', 10))
    expect(t.log).toEqual([wrote('b', 10), 'flush'])
  })
})

describe('shared-leave-07 web-dec-76 reset（主体離脱の停止で A の位置・完聴を送らない）', () => {
  test('reset の後の idle への遷移は位置の書込も完聴の送信も起こさない', () => {
    const t = setup()
    t.emit(stateChanged(loading('a', 0)), stateChanged(playing('a', 0)), positionChanged('a', 7))
    expect(t.log).toEqual([])

    t.reporter.reset()
    t.emit(stateChanged(idle))

    expect(t.write).not.toHaveBeenCalled()
    expect(t.flush).not.toHaveBeenCalled()
    expect(t.markCompleted).not.toHaveBeenCalled()
  })

  test('reset の後に停止直前の完聴事象が来ても markCompleted は送られない（正方向の対照: reset が無ければ idle で位置が書かれる）', () => {
    const control = setup()
    control.emit(stateChanged(loading('a', 0)), stateChanged(playing('a', 0)), positionChanged('a', 7))
    control.emit(stateChanged(idle))
    expect(control.log).toEqual([wrote('a', 7), 'flush'])

    const t = setup()
    t.emit(stateChanged(loading('a', 0)), stateChanged(playing('a', 0)), positionChanged('a', 7))
    t.reporter.reset()
    t.emit(stateChanged(idle))
    expect(t.log).toEqual([])
  })

  test('reset の後も購読は保たれ、次の episode の再生は今まで通り報告される', () => {
    const t = setup()
    t.emit(stateChanged(loading('a', 0)), stateChanged(playing('a', 0)), positionChanged('a', 7))
    t.reporter.reset()
    const listeners = t.listenerCount()
    t.emit(stateChanged(idle))
    expect(listeners).toBe(1)

    t.emit(stateChanged(loading('b', 0)), stateChanged(playing('b', 0)), positionChanged('b', 5))
    t.emit(stateChanged(paused('b', 5)))

    expect(t.log).toEqual([wrote('b', 5), 'flush'])
    expect(t.flush).toHaveBeenCalledTimes(1)
  })

  test('reset を 2 回呼んでも送信は 0 回', () => {
    const t = setup()
    t.emit(stateChanged(loading('a', 0)), stateChanged(playing('a', 0)), positionChanged('a', 7))
    t.reporter.reset()
    t.reporter.reset()
    t.emit(stateChanged(idle))
    expect(t.log).toEqual([])
  })
})

describe('shared-sync-01 / ADR-109 決定 7: 記録の契機と主体', () => {
  test('shared-sync-01 / ADR-109 決定 7（新規）: 周期・一時停止・停止・完聴・paused からの切替の 5 契機で主体つきの記録を書く', () => {
    const t = setup()
    t.emit(stateChanged(loading('a', 0)), stateChanged(playing('a', 0)))

    t.time.now = T0
    t.emit(positionChanged('a', 10)) // 周期
    t.time.now = T0 + 1000
    t.emit(stateChanged(paused('a', 25))) // 一時停止
    t.time.now = T0 + 2000
    t.emit(positionChanged('a', 30), stateChanged(loading('b', 0))) // paused 中の seek の後の切替
    t.emit(stateChanged(playing('b', 0)))
    t.time.now = T0 + 3000
    t.emit(positionChanged('b', 4), stateChanged(idle)) // 停止
    t.emit(stateChanged(loading('c', 0, 80)), stateChanged(playing('c', 0, 80)))
    t.time.now = T0 + 4000
    t.emit(listenCompleted('c')) // 完聴

    expect(t.write.mock.calls).toEqual([
      ['u-a', 'a', { positionSeconds: 10, recordedAt: T0, synced: false }],
      ['u-a', 'a', { positionSeconds: 25, recordedAt: T0 + 1000, synced: false }],
      ['u-a', 'a', { positionSeconds: 30, recordedAt: T0 + 2000, synced: false }],
      ['u-a', 'b', { positionSeconds: 4, recordedAt: T0 + 3000, synced: false }],
      ['u-a', 'c', { positionSeconds: 80, recordedAt: T0 + 4000, synced: false }],
    ])
    expect(t.flush).toHaveBeenCalledTimes(5)
    for (const call of t.flush.mock.calls) expect(call).toEqual([])
    expect(t.updatePosition).not.toHaveBeenCalled()
  })

  test('記録時刻は clock() の小数をミリ秒に切り捨てる', () => {
    const t = setup()
    t.time.now = T0 + 0.9
    t.emit(stateChanged(loading('a', 0)), stateChanged(playing('a', 0)), positionChanged('a', 10))
    expect(t.write).toHaveBeenCalledWith('u-a', 'a', { positionSeconds: 10, recordedAt: T0, synced: false })
  })

  test('shared-sync-02: 主体が null なら記録も送信もしない（shared-dec-36）', () => {
    const t = setup({ recording: null })
    t.emit(stateChanged(loading('a', 0)), stateChanged(playing('a', 0)), positionChanged('a', 10))
    t.emit(stateChanged(paused('a', 25)), stateChanged(playing('a', 25)), stateChanged(idle))
    t.emit(stateChanged(loading('b', 0, 80)), stateChanged(playing('b', 0, 80)), listenCompleted('b'))
    expect(t.write).not.toHaveBeenCalled()
    expect(t.flush).not.toHaveBeenCalled()
    expect(t.updatePosition).not.toHaveBeenCalled()

    // 正方向の対照: 同じ入口で主体があれば記録される。
    const control = setup({ recording: 'u-a' })
    control.emit(stateChanged(loading('a', 0)), stateChanged(playing('a', 0)), positionChanged('a', 10))
    expect(control.log).toEqual([wrote('a', 10), 'flush'])
  })

  test('主体は記録の時点の recording() で決まり、記録ごとに引き直す', () => {
    const t = setup({ recording: 'u-a' })
    t.emit(stateChanged(loading('a', 0)), stateChanged(playing('a', 0)), positionChanged('a', 10))
    t.who.recording = 'u-b'
    t.emit(positionChanged('a', 20))
    expect(t.log).toEqual([wrote('a', 10, T0, 'u-a'), 'flush', wrote('a', 20, T0, 'u-b'), 'flush'])
  })

  test('shared-sync-03 / shared-dec-34（新規）: 保存に失敗した（write が false の）記録も、その回の outbox.flush に直接渡して送信を試みる', () => {
    const t = setup({ writeResult: false })
    t.emit(stateChanged(loading('a', 0)), stateChanged(playing('a', 0)), positionChanged('a', 10))
    expect(t.flush).toHaveBeenCalledTimes(1)
    expect(t.flush).toHaveBeenCalledWith({
      episodeId: 'a',
      record: { positionSeconds: 10, recordedAt: T0, synced: false },
    })

    // 正方向の対照: 保存に成功した記録は引数なしの flush（保存庫から読み直す）。
    const control = setup({ writeResult: true })
    control.emit(stateChanged(loading('a', 0)), stateChanged(playing('a', 0)), positionChanged('a', 10))
    expect(control.flush).toHaveBeenCalledTimes(1)
    expect(control.flush.mock.calls[0]).toEqual([])
  })

  test('ADR-109 決定 14（新規）: 完聴の後の巻き戻しの記録でも markCompleted は再送されない', () => {
    const t = setup()
    t.emit(stateChanged(loading('a', 0, 100)), stateChanged(playing('a', 0, 100)))
    t.emit(listenCompleted('a'))
    expect(t.markCompleted).toHaveBeenCalledTimes(1)

    t.time.now = T0 + 1000
    t.emit(stateChanged(playing('a', 5, 100)), stateChanged(paused('a', 5, 100)))
    t.emit(listenCompleted('a'))

    expect(t.write).toHaveBeenCalledWith('u-a', 'a', { positionSeconds: 5, recordedAt: T0 + 1000, synced: false })
    expect(t.markCompleted).toHaveBeenCalledTimes(1)
  })
})
