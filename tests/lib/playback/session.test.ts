// PlaybackSession（lib/playback/session）の契約テスト。
// verifies: CI-T1, CI-T1b, CI-T2, CI-T3, CI-T4, CI-P08, CI-C03
//
// RED 理由: `@/lib/playback/session`・`@/lib/playback/resume` がまだ存在しない。
//
// 公開 API（このテストが固定する形）:
//   createPlaybackSession(audio: AudioElement): PlaybackSession
//   PlaybackSession = { state(); start(episode, resumePosition, speed); play(): Promise<void>; pause();
//     seek(t); seekRelative(d); setSpeed(s); setVolume(v); stop(); subscribe(listener): () => void }
//   PlaybackEvent は判別共用体（type で判別）:
//     { type: 'stateChanged'; state } | { type: 'positionChanged'; episodeId; seconds } | { type: 'listenCompleted'; episodeId }
//   PlayableEpisode: id/title/audioUrl/durationSeconds/difficulty/createdAt/serverPositionSeconds ＋ 任意の audioHandle?: { release(): void }
//   状態: idle / loading{episode,resumePosition,speed} / paused・playing{episode,position,duration,speed} /
//         ended{episode,duration} / errored{episode,position,speed,reason:{kind}}
//
// oracle は state()・MockAudio のフィールド・購読した事象・handle double に限る。
// AudioElement への呼出回数は assert しない（handle の release 回数は契約そのものなので例外）。
import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { createPlaybackSession, PLAYBACK_SPEEDS } from '@/lib/playback/session'
import type {
  AudioHandle,
  PlayableEpisode,
  PlaybackEvent,
  PlaybackSession,
  PlaybackSpeed,
} from '@/lib/playback/session'
import { resolveResumePosition } from '@/lib/playback/resume'
import { MockAudio } from '../../helpers/mockAudio'

// ---------------------------------------------------------------------------
// 共通 helper
// ---------------------------------------------------------------------------

/** union の各状態のフィールドへ絞り込みなしで触れるための緩い見取り図（値の検証は個別の expect で行う）。 */
interface LooseState {
  status: string
  episode?: PlayableEpisode
  resumePosition?: number
  position?: number
  duration?: number
  speed?: number
  reason?: { kind: string }
}

function makeEpisode(id: string, over: Partial<PlayableEpisode> = {}): PlayableEpisode {
  return {
    id,
    title: `title ${id}`,
    audioUrl: `https://example.com/${id}.mp3`,
    durationSeconds: 600,
    difficulty: 'toeic_600',
    createdAt: '2026-05-31T06:00:00Z',
    serverPositionSeconds: 0,
    ...over,
  }
}

interface Deferred {
  promise: Promise<void>
  resolve: () => void
  reject: (e: unknown) => void
}

function deferred(): Deferred {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const notAllowed = () => Object.assign(new Error('autoplay blocked'), { name: 'NotAllowedError' })
const aborted = () => Object.assign(new Error('interrupted'), { name: 'AbortError' })

/** release 時点の audio.src を log に記録する handle double。 */
function makeHandle(audio: MockAudio, log: string[]): { release: Mock<() => void> } {
  return { release: vi.fn(() => void log.push(audio.src)) }
}

/** release が同じ例外オブジェクトを投げる handle double（release 時点の audio.src も記録する）。 */
function makeThrowingHandle(audio: MockAudio, log: string[], err: Error) {
  return {
    release: vi.fn(() => {
      log.push(audio.src)
      throw err
    }),
  }
}

function catchError(fn: () => unknown): unknown {
  let caught: unknown
  try {
    fn()
  } catch (e) {
    caught = e
  }
  return caught
}

type DrivenStatus = 'loading' | 'paused' | 'playing' | 'ended' | 'errored'

let audio: MockAudio
let session: PlaybackSession

const st = (): LooseState => session.state()

function recordEvents(): PlaybackEvent[] {
  const events: PlaybackEvent[] = []
  session.subscribe((e) => events.push(e))
  return events
}

const stateChangedStatuses = (events: PlaybackEvent[]): string[] =>
  events.flatMap((e) => (e.type === 'stateChanged' ? [(e.state as unknown as LooseState).status] : []))

/** idle から指定 status へ駆動する。errored は loading 中の error 事象で作る。 */
async function drive(
  status: DrivenStatus,
  episode: PlayableEpisode,
  resume = 30,
  speed: PlaybackSpeed = 1,
): Promise<void> {
  session.start(episode, resume, speed)
  if (status === 'loading') return
  if (status === 'errored') {
    audio.fireError()
    return
  }
  audio.fireLoadedMetadata(600)
  if (status === 'paused') return
  await session.play()
  if (status === 'playing') return
  audio.fireEnded()
}

const fields = (a: MockAudio) => ({
  src: a.src,
  currentTime: a.currentTime,
  volume: a.volume,
  playbackRate: a.playbackRate,
  defaultPlaybackRate: a.defaultPlaybackRate,
  paused: a.paused,
})

const NON_IDLE: DrivenStatus[] = ['loading', 'paused', 'playing', 'ended', 'errored']

beforeEach(() => {
  audio = new MockAudio()
  session = createPlaybackSession(audio)
})

// ---------------------------------------------------------------------------
// CI-T1: 遷移 13 件（上位 Spec §3.1 の遷移表）
// ---------------------------------------------------------------------------
describe('CI-T1 遷移（13 件）', () => {
  test('初期状態は idle', () => {
    expect(st().status).toBe('idle')
  })

  test('idle → loading: start(ep, resume, speed) で episode・resumePosition・speed を保持し AudioElement を初期化する', () => {
    const ep = makeEpisode('a')
    session.start(ep, 30, 1.5)
    expect(st().status).toBe('loading')
    expect(st().episode).toEqual(ep)
    expect(st().resumePosition).toBe(30)
    expect(st().speed).toBe(1.5)
    expect(audio.src).toBe(ep.audioUrl)
    expect(audio.playbackRate).toBe(1.5)
    expect(audio.defaultPlaybackRate).toBe(1.5)
    expect(audio.currentTime).toBe(30)
  })

  test('loading → paused: loadedmetadata で duration を得て resume 位置を再適用する', () => {
    session.start(makeEpisode('a'), 30, 1.5)
    audio.currentTime = 0
    audio.fireLoadedMetadata(600)
    expect(st().status).toBe('paused')
    expect(st().position).toBe(30)
    expect(st().duration).toBe(600)
    expect(st().speed).toBe(1.5)
    expect(audio.currentTime).toBe(30)
  })

  test('loading → errored: error 事象で reason=media、position=resumePosition', () => {
    session.start(makeEpisode('a'), 30, 1.5)
    audio.fireError()
    expect(st().status).toBe('errored')
    expect(st().reason).toEqual({ kind: 'media' })
    expect(st().position).toBe(30)
    expect(st().speed).toBe(1.5)
    expect(st().episode?.id).toBe('a')
  })

  test('paused → playing: play() は同期的に playing にする', async () => {
    await drive('paused', makeEpisode('a'))
    const p = session.play()
    expect(st().status).toBe('playing')
    await p
    expect(st().status).toBe('playing')
    expect(audio.paused).toBe(false)
  })

  test('paused → paused: seek / seekRelative で位置だけが変わる', async () => {
    await drive('paused', makeEpisode('a'))
    session.seek(100)
    expect(st().status).toBe('paused')
    expect(st().position).toBe(100)
    expect(audio.currentTime).toBe(100)
    session.seekRelative(10)
    expect(st().status).toBe('paused')
    expect(st().position).toBe(110)
    expect(audio.currentTime).toBe(110)
  })

  test('paused → loading: start で別エピソードへ切り替える', async () => {
    await drive('paused', makeEpisode('a'))
    const ep2 = makeEpisode('b')
    session.start(ep2, 5, 2)
    expect(st().status).toBe('loading')
    expect(st().episode?.id).toBe('b')
    expect(st().resumePosition).toBe(5)
    expect(st().speed).toBe(2)
    expect(audio.src).toBe(ep2.audioUrl)
    expect(audio.currentTime).toBe(5)
  })

  test('playing → paused: pause() で AudioElement を止め、position は audio.currentTime を clamp した値', async () => {
    await drive('playing', makeEpisode('a'))
    audio.currentTime = 42
    session.pause()
    expect(st().status).toBe('paused')
    expect(st().position).toBe(42)
    expect(audio.paused).toBe(true)
  })

  test('playing → ended: ended 事象で status ended、episode と duration を保持', async () => {
    await drive('playing', makeEpisode('a'))
    audio.fireEnded()
    expect(st().status).toBe('ended')
    expect(st().episode?.id).toBe('a')
    expect(st().duration).toBe(600)
  })

  test('playing → errored: error 事象で reason=media、position は currentTime を clamp した値', async () => {
    await drive('playing', makeEpisode('a'))
    audio.currentTime = 77
    audio.fireError()
    expect(st().status).toBe('errored')
    expect(st().reason).toEqual({ kind: 'media' })
    expect(st().position).toBe(77)
    expect(st().speed).toBe(1)
  })

  test('playing → playing: timeupdate と seek で位置が更新される（status 不変）', async () => {
    await drive('playing', makeEpisode('a'))
    audio.fireTimeUpdate(50)
    expect(st().status).toBe('playing')
    expect(st().position).toBe(50)
    session.seek(70)
    expect(st().status).toBe('playing')
    expect(st().position).toBe(70)
    expect(audio.currentTime).toBe(70)
  })

  test('ended → loading: start（advance）で次のエピソードへ', async () => {
    await drive('ended', makeEpisode('a'))
    const ep2 = makeEpisode('b')
    session.start(ep2, 0, 1)
    expect(st().status).toBe('loading')
    expect(st().episode?.id).toBe('b')
    expect(audio.src).toBe(ep2.audioUrl)
  })

  test('errored → loading: play() は手動再試行（同じ episode・resume=errored.position・speed 保持。AudioElement.play は呼ばない）', async () => {
    const ep = makeEpisode('a')
    await drive('errored', ep, 30, 1.5)
    audio.src = 'something-else'
    void session.play() // 返り値は使わない（reject しない）
    expect(st().status).toBe('loading')
    expect(st().episode?.id).toBe('a')
    expect(st().resumePosition).toBe(30)
    expect(st().speed).toBe(1.5)
    expect(audio.src).toBe(ep.audioUrl)
    expect(audio.paused).toBe(true)
  })

  test('errored → loading: start で別エピソードへ', async () => {
    await drive('errored', makeEpisode('a'))
    const ep2 = makeEpisode('b')
    session.start(ep2, 0, 1)
    expect(st().status).toBe('loading')
    expect(st().episode?.id).toBe('b')
    expect(audio.src).toBe(ep2.audioUrl)
  })
})

// ---------------------------------------------------------------------------
// CI-T1: 表外入力は no-op（状態・保持値・AudioElement 不変・事象なし）
// ---------------------------------------------------------------------------
describe('CI-T1 表にない入力は no-op（状態・AudioElement 不変・事象なし）', () => {
  type Input = { name: string; run: () => Promise<void> | void }
  const inputs = (): Record<string, Input> => ({
    play: { name: 'play()', run: () => session.play() },
    pause: { name: 'pause()', run: () => session.pause() },
    seek: { name: 'seek(10)', run: () => session.seek(10) },
    seekRelative: { name: 'seekRelative(10)', run: () => session.seekRelative(10) },
    setSpeed: { name: 'setSpeed(2)', run: () => session.setSpeed(2) },
    loadedmetadata: { name: 'loadedmetadata 事象', run: () => audio.fireEvent('loadedmetadata') },
    timeupdate: { name: 'timeupdate 事象', run: () => audio.fireEvent('timeupdate') },
    ended: { name: 'ended 事象', run: () => audio.fireEvent('ended') },
    error: { name: 'error 事象', run: () => audio.fireEvent('error') },
  })

  const blanks: Array<[string, DrivenStatus | 'idle', string[]]> = [
    ['idle', 'idle', ['play', 'pause', 'seek', 'seekRelative', 'setSpeed', 'loadedmetadata', 'timeupdate', 'ended', 'error']],
    ['loading', 'loading', ['play', 'pause', 'seek', 'seekRelative', 'timeupdate', 'ended']],
    ['paused', 'paused', ['pause', 'loadedmetadata', 'timeupdate', 'ended', 'error']],
    ['playing', 'playing', ['play', 'loadedmetadata']],
    ['ended', 'ended', ['play', 'pause', 'seek', 'seekRelative', 'setSpeed', 'loadedmetadata', 'timeupdate', 'ended', 'error']],
    ['errored', 'errored', ['pause', 'seek', 'seekRelative', 'loadedmetadata', 'timeupdate', 'ended', 'error']],
  ]

  for (const [label, status, names] of blanks) {
    for (const key of names) {
      test(`${label} で ${inputs()[key].name} は no-op`, async () => {
        if (status !== 'idle') await drive(status, makeEpisode('a'))
        const events = recordEvents()
        const beforeState = JSON.parse(JSON.stringify(session.state()))
        const beforeAudio = fields(audio)

        await inputs()[key].run()

        expect(JSON.parse(JSON.stringify(session.state()))).toEqual(beforeState)
        expect(fields(audio)).toEqual(beforeAudio)
        expect(events).toEqual([])
      })
    }
  }
})

// ---------------------------------------------------------------------------
// CI-T1: 合成遷移・禁止遷移（別エピソードへの切替）
// ---------------------------------------------------------------------------
describe('CI-T1 start による切替の合成', () => {
  test('playing 中の start は paused（旧 episode のまま）→ loading の順に stateChanged を発行する', async () => {
    await drive('playing', makeEpisode('a'))
    const events = recordEvents()
    const ep2 = makeEpisode('b')
    session.start(ep2, 0, 1)
    expect(stateChangedStatuses(events)).toEqual(['paused', 'loading'])
    const first = events[0]
    expect(first.type === 'stateChanged' && (first.state as unknown as LooseState).episode?.id).toBe('a')
    expect(st().status).toBe('loading')
    expect(st().episode?.id).toBe('b')
    expect(audio.src).toBe(ep2.audioUrl)
  })

  test('loading 中の start は idle → loading の順に stateChanged を発行し、AudioElement を新音源へ', async () => {
    await drive('loading', makeEpisode('a'))
    const events = recordEvents()
    const ep2 = makeEpisode('b')
    session.start(ep2, 0, 1)
    expect(stateChangedStatuses(events)).toEqual(['idle', 'loading'])
    expect(st().status).toBe('loading')
    expect(st().episode?.id).toBe('b')
    expect(audio.src).toBe(ep2.audioUrl)
  })

  test('start 以前に呼んだ play() の遅延 reject は状態を変えない', async () => {
    await drive('paused', makeEpisode('a'))
    const d = deferred()
    vi.spyOn(audio, 'play').mockImplementation(() => d.promise)
    const p = session.play()
    session.start(makeEpisode('b'), 0, 1)
    d.reject(notAllowed())
    await p
    expect(st().status).toBe('loading')
    expect(st().episode?.id).toBe('b')
  })
})

// ---------------------------------------------------------------------------
// CI-T1b: stop()
// ---------------------------------------------------------------------------
describe('CI-T1b stop()', () => {
  for (const status of NON_IDLE) {
    test(`${status} → idle: AudioElement は一時停止し src が空、positionChanged / listenCompleted なし`, async () => {
      await drive(status, makeEpisode('a'))
      const events = recordEvents()
      session.stop()
      expect(st().status).toBe('idle')
      expect(audio.paused).toBe(true)
      expect(audio.src).toBe('')
      expect(events.filter((e) => e.type === 'positionChanged' || e.type === 'listenCompleted')).toEqual([])
      expect(stateChangedStatuses(events)).toEqual(['idle'])
    })
  }

  test('初期の idle で stop() は AudioElement の状態を変えず事象も出さない', () => {
    audio.currentTime = 12
    audio.volume = 0.4
    const before = fields(audio)
    const events = recordEvents()
    session.stop()
    expect(st().status).toBe('idle')
    expect(fields(audio)).toEqual(before)
    expect(events).toEqual([])
  })

  test('stop 後の idle でもう一度 stop() しても何も変わらない', async () => {
    await drive('playing', makeEpisode('a'))
    session.stop()
    const before = fields(audio)
    const events = recordEvents()
    session.stop()
    expect(st().status).toBe('idle')
    expect(fields(audio)).toEqual(before)
    expect(events).toEqual([])
  })

  test('stop 後の idle で error 事象が来ても idle のまま', async () => {
    await drive('playing', makeEpisode('a'))
    session.stop()
    audio.fireError()
    expect(st().status).toBe('idle')
  })
})

// ---------------------------------------------------------------------------
// CI-T2: play() の reject と収束
// ---------------------------------------------------------------------------
describe('CI-T2 play()', () => {
  test('NotAllowedError で reject → errored(autoplay_blocked)。play() 自体は reject しない', async () => {
    await drive('paused', makeEpisode('a'))
    vi.spyOn(audio, 'play').mockRejectedValue(notAllowed())
    await expect(session.play()).resolves.toBeUndefined()
    expect(st().status).toBe('errored')
    expect(st().reason).toEqual({ kind: 'autoplay_blocked' })
  })

  test('その他の Error で reject → errored(media)', async () => {
    await drive('paused', makeEpisode('a'))
    vi.spyOn(audio, 'play').mockRejectedValue(new Error('decode failed'))
    await session.play()
    expect(st().status).toBe('errored')
    expect(st().reason).toEqual({ kind: 'media' })
  })

  test('reject 時の position は audio.currentTime を clamp した値、speed は保持', async () => {
    await drive('paused', makeEpisode('a'), 30, 1.5)
    audio.currentTime = 44
    vi.spyOn(audio, 'play').mockRejectedValue(notAllowed())
    await session.play()
    expect(st().position).toBe(44)
    expect(st().speed).toBe(1.5)
  })

  test('play() を同期的に 2 回呼んでも 1 状態（playing）に収束する', async () => {
    await drive('paused', makeEpisode('a'))
    const p1 = session.play()
    const p2 = session.play()
    await Promise.all([p1, p2])
    expect(st().status).toBe('playing')
  })

  test('play → pause → 1 回目が AbortError で reject しても paused のまま', async () => {
    await drive('paused', makeEpisode('a'))
    const d = deferred()
    vi.spyOn(audio, 'play').mockImplementation(() => d.promise)
    const p = session.play()
    session.pause()
    d.reject(aborted())
    await p
    expect(st().status).toBe('paused')
  })

  test('play① → pause → play② の後、① の AbortError では playing のまま、② の NotAllowedError では errored', async () => {
    await drive('paused', makeEpisode('a'))
    const ds: Deferred[] = []
    vi.spyOn(audio, 'play').mockImplementation(() => {
      const d = deferred()
      ds.push(d)
      return d.promise
    })
    const p1 = session.play()
    session.pause()
    const p2 = session.play()
    expect(ds).toHaveLength(2)

    ds[0].reject(aborted())
    await p1
    expect(st().status).toBe('playing')

    ds[1].reject(notAllowed())
    await p2
    expect(st().status).toBe('errored')
    expect(st().reason).toEqual({ kind: 'autoplay_blocked' })
  })

  test('play → stop → reject でも idle のまま', async () => {
    await drive('paused', makeEpisode('a'))
    const d = deferred()
    vi.spyOn(audio, 'play').mockImplementation(() => d.promise)
    const p = session.play()
    session.stop()
    d.reject(aborted())
    await p
    expect(st().status).toBe('idle')
  })

  test('errored 中の play() は手動再試行（loading、同じ episode、resumePosition=errored.position、src=audioUrl）', async () => {
    const ep = makeEpisode('a')
    await drive('errored', ep, 30, 1)
    void session.play()
    expect(st().status).toBe('loading')
    expect(st().episode?.id).toBe('a')
    expect(st().resumePosition).toBe(30)
    expect(audio.src).toBe(ep.audioUrl)
  })
})

// ---------------------------------------------------------------------------
// CI-T3: resume と loadedmetadata の再適用（RS-01〜RS-07 を resolveResumePosition 経由で駆動）
// ---------------------------------------------------------------------------
describe('CI-T3 resume（resolveResumePosition → start → loadedmetadata）', () => {
  const rows: Array<[string, number, number, number]> = [
    ['RS-01', 0, 600, 0],
    ['RS-02', 120, 600, 120],
    ['RS-03', 598, 600, 0],
    ['RS-04', 597.5, 600, 597.5],
    ['RS-05', 600, 600, 0],
    ['RS-06', 120, 0, 120],
    ['RS-07', -5, 600, 0],
  ]

  test.each(rows)('%s: (%s, %s) → 位置 %s', (_id, server, dur, expected) => {
    const ep = makeEpisode('a', { durationSeconds: dur })
    session.start(ep, resolveResumePosition(server, dur), 1)
    audio.currentTime = 0
    audio.fireLoadedMetadata(dur > 0 ? dur : 600)
    expect(audio.currentTime).toBe(expected)
    expect(st().position).toBe(expected)
  })

  test('resume が duration を超えていれば loadedmetadata で clamp される', () => {
    session.start(makeEpisode('a'), 700, 1)
    audio.fireLoadedMetadata(600)
    expect(st().position).toBe(600)
    expect(audio.currentTime).toBe(600)
  })

  test('start の resume が NaN・負なら resumePosition=0、audio.currentTime=0', () => {
    for (const bad of [Number.NaN, -5]) {
      audio.currentTime = 99
      session.start(makeEpisode('a'), bad, 1)
      expect(st().resumePosition).toBe(0)
      expect(audio.currentTime).toBe(0)
      session.stop()
    }
  })
})

// ---------------------------------------------------------------------------
// CI-T4: 速度
// ---------------------------------------------------------------------------
describe('CI-T4 速度', () => {
  test('start の速度を playbackRate と defaultPlaybackRate の両方へ設定し、loadedmetadata 後に再適用する', () => {
    session.start(makeEpisode('a'), 0, 1.5)
    expect(audio.playbackRate).toBe(1.5)
    expect(audio.defaultPlaybackRate).toBe(1.5)
    audio.playbackRate = 1
    audio.defaultPlaybackRate = 1
    audio.fireLoadedMetadata(600)
    expect(audio.playbackRate).toBe(1.5)
    expect(audio.defaultPlaybackRate).toBe(1.5)
  })

  test('setSpeed(2.0) は state().speed と両 rate を更新する', async () => {
    await drive('paused', makeEpisode('a'), 0, 1)
    session.setSpeed(2.0)
    expect(st().speed).toBe(2)
    expect(audio.playbackRate).toBe(2)
    expect(audio.defaultPlaybackRate).toBe(2)
  })

  test('setSpeed(3)（8 段外）は no-op', async () => {
    await drive('paused', makeEpisode('a'), 0, 1)
    session.setSpeed(3 as unknown as PlaybackSpeed)
    expect(st().speed).toBe(1)
    expect(audio.playbackRate).toBe(1)
    expect(audio.defaultPlaybackRate).toBe(1)
  })

  for (const status of ['loading', 'playing', 'errored'] as const) {
    test(`setSpeed(1.25) は ${status} でも state().speed と両 rate を更新する`, async () => {
      await drive(status, makeEpisode('a'), 0, 1)
      session.setSpeed(1.25)
      expect(st().speed).toBe(1.25)
      expect(audio.playbackRate).toBe(1.25)
      expect(audio.defaultPlaybackRate).toBe(1.25)
    })
  }

  test('setSpeed は idle・ended では no-op', async () => {
    session.setSpeed(2)
    expect(st().status).toBe('idle')
    expect(audio.playbackRate).toBe(1)
    await drive('ended', makeEpisode('a'), 0, 1)
    session.setSpeed(2)
    expect(audio.playbackRate).toBe(1)
    expect(audio.defaultPlaybackRate).toBe(1)
  })

  test('次の start は渡された速度で初期化し直す（持ち越さない）', async () => {
    await drive('paused', makeEpisode('a'), 0, 1)
    session.setSpeed(2.0)
    session.start(makeEpisode('b'), 0, 1.0)
    expect(st().speed).toBe(1)
    expect(audio.playbackRate).toBe(1)
    expect(audio.defaultPlaybackRate).toBe(1)
  })

  test('errored からの再試行はセッション速度を保つ', async () => {
    await drive('errored', makeEpisode('a'), 0, 1.5)
    void session.play()
    audio.playbackRate = 1
    audio.defaultPlaybackRate = 1
    audio.fireLoadedMetadata(600)
    expect(st().speed).toBe(1.5)
    expect(audio.playbackRate).toBe(1.5)
    expect(audio.defaultPlaybackRate).toBe(1.5)
  })

  test('start の速度が 8 段外なら 1.0', () => {
    session.start(makeEpisode('a'), 0, 3 as unknown as PlaybackSpeed)
    expect(st().speed).toBe(1)
    expect(audio.playbackRate).toBe(1)
    expect(audio.defaultPlaybackRate).toBe(1)
  })

  test('PLAYBACK_SPEEDS は 8 段（順序込み）', () => {
    expect([...PLAYBACK_SPEEDS]).toEqual([0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5])
  })
})

// ---------------------------------------------------------------------------
// CI-P08: 位置の clamp
// ---------------------------------------------------------------------------
describe('CI-P08 位置の clamp', () => {
  beforeEach(async () => {
    await drive('paused', makeEpisode('a'), 30, 1)
  })

  test('seek(-5) は 0', () => {
    session.seek(-5)
    expect(st().position).toBe(0)
    expect(audio.currentTime).toBe(0)
  })

  test('seek(9999) は duration', () => {
    session.seek(9999)
    expect(st().position).toBe(600)
    expect(audio.currentTime).toBe(600)
  })

  test('seekRelative(+1000) は duration、seekRelative(-100) は 0（基準は現在の position）', () => {
    session.seekRelative(1000)
    expect(st().position).toBe(600)
    session.seek(30)
    session.seekRelative(-100)
    expect(st().position).toBe(0)
  })

  test('seek / seekRelative の非有限値は no-op', () => {
    session.seek(Number.NaN)
    session.seek(Number.POSITIVE_INFINITY)
    session.seekRelative(Number.NaN)
    expect(st().position).toBe(30)
    expect(audio.currentTime).toBe(30)
  })

  test('playing での timeupdate は duration へ clamp、seek は指定位置（status は playing のまま）', async () => {
    await session.play()
    audio.fireTimeUpdate(700)
    expect(st().status).toBe('playing')
    expect(st().position).toBe(600)
    session.seek(10)
    expect(st().status).toBe('playing')
    expect(st().position).toBe(10)
  })

  test('duration 不明（loadedmetadata で NaN）なら duration=0、上限なしで seek できる', () => {
    session.stop()
    session.start(makeEpisode('b'), 0, 1)
    audio.fireLoadedMetadata(Number.NaN)
    expect(st().duration).toBe(0)
    session.seek(1000)
    expect(st().position).toBe(1000)
  })
})

// ---------------------------------------------------------------------------
// 音量・事象・スナップショット
// ---------------------------------------------------------------------------
describe('音量（setVolume）', () => {
  test('clamp・非有限は no-op・start / stop で変えない・state に含めない', () => {
    session.setVolume(1.5)
    expect(audio.volume).toBe(1)
    session.setVolume(-1)
    expect(audio.volume).toBe(0)
    session.setVolume(0.3)
    session.setVolume(Number.NaN)
    expect(audio.volume).toBe(0.3)
    session.start(makeEpisode('a'), 0, 1)
    expect(audio.volume).toBe(0.3)
    session.stop()
    expect(audio.volume).toBe(0.3)
    expect('volume' in (session.state() as object)).toBe(false)
  })

  test('paused でも clamp して書く', async () => {
    await drive('paused', makeEpisode('a'))
    session.setVolume(2)
    expect(audio.volume).toBe(1)
  })
})

describe('事象（subscribe）', () => {
  test('timeupdate と seek（playing）で positionChanged(episodeId, seconds) を発行する', async () => {
    await drive('playing', makeEpisode('a'))
    const events = recordEvents()
    audio.fireTimeUpdate(12)
    session.seek(20)
    expect(events.filter((e) => e.type === 'positionChanged')).toEqual([
      { type: 'positionChanged', episodeId: 'a', seconds: 12 },
      { type: 'positionChanged', episodeId: 'a', seconds: 20 },
    ])
  })

  test('start・stop・loadedmetadata の resume 適用では positionChanged を発行しない', () => {
    const events = recordEvents()
    session.start(makeEpisode('a'), 30, 1)
    audio.fireLoadedMetadata(600)
    session.stop()
    expect(events.filter((e) => e.type === 'positionChanged')).toEqual([])
  })

  test('ended では listenCompleted が 1 回で stateChanged(ended) より先', async () => {
    await drive('playing', makeEpisode('a'))
    const events = recordEvents()
    audio.fireEnded()
    expect(events.map((e) => e.type)).toEqual(['listenCompleted', 'stateChanged'])
    expect(events[0]).toEqual({ type: 'listenCompleted', episodeId: 'a' })
    expect(stateChangedStatuses(events)).toEqual(['ended'])
  })

  test('購読解除後は届かない', () => {
    const events: PlaybackEvent[] = []
    const unsubscribe = session.subscribe((e) => events.push(e))
    unsubscribe()
    session.start(makeEpisode('a'), 0, 1)
    audio.fireLoadedMetadata(600)
    expect(events).toEqual([])
  })

  test('stateChanged はスナップショットが変わるたび 1 回', () => {
    const events = recordEvents()
    session.start(makeEpisode('a'), 0, 1)
    audio.fireLoadedMetadata(600)
    expect(stateChangedStatuses(events)).toEqual(['loading', 'paused'])
  })
})

describe('state() のスナップショット', () => {
  test('同じ状態の間は同一参照で、凍結されている', async () => {
    await drive('paused', makeEpisode('a'))
    const s1 = session.state()
    const s2 = session.state()
    expect(s1).toBe(s2)
    expect(Object.isFrozen(s1)).toBe(true)
    expect(Reflect.set(s1 as object, 'status', 'idle')).toBe(false)
    expect(st().status).toBe('paused')
  })
})

// ---------------------------------------------------------------------------
// CI-C03（Session 側）: audioHandle の解放
// ---------------------------------------------------------------------------
describe('CI-C03 audioHandle の解放', () => {
  let log: string[]
  beforeEach(() => {
    log = []
  })

  for (const status of NON_IDLE) {
    test(`${status} で start(ep2{h2}) すると h1 が 1 回 release され、その時点の audio.src は新しい audioUrl`, async () => {
      const h1 = makeHandle(audio, log)
      const h2 = makeHandle(audio, log)
      const ep2 = makeEpisode('2', { audioHandle: h2 })
      await drive(status, makeEpisode('1', { audioHandle: h1 }))

      session.start(ep2, 0, 1)

      expect(h1.release).toHaveBeenCalledTimes(1)
      expect(log).toEqual([ep2.audioUrl])
      expect(h2.release).not.toHaveBeenCalled()
      expect(st().status).toBe('loading')
    })

    test(`${status} で stop() すると h1 が 1 回 release され（src は空）、もう一度 stop() しても増えない`, async () => {
      const h1 = makeHandle(audio, log)
      await drive(status, makeEpisode('1', { audioHandle: h1 }))

      session.stop()
      session.stop()

      expect(h1.release).toHaveBeenCalledTimes(1)
      expect(log).toEqual([''])
    })
  }

  test('errored からの再試行（play）では release しない', async () => {
    const h1 = makeHandle(audio, log)
    await drive('errored', makeEpisode('1', { audioHandle: h1 }))
    void session.play()
    expect(h1.release).not.toHaveBeenCalled()
  })

  test('保持中の同じ handle を同じ audioUrl の別 episode 値に載せて start しても release しない', async () => {
    const h1 = makeHandle(audio, log)
    const ep1 = makeEpisode('1', { audioHandle: h1 })
    await drive('paused', ep1)
    session.start({ ...ep1 }, 0, 1)
    expect(h1.release).not.toHaveBeenCalled()
  })

  test('handle を持たない episode から start(ep2{h2}) しても throw せず、h2 は stop で 1 回だけ release される', async () => {
    const h2 = makeHandle(audio, log)
    await drive('paused', makeEpisode('1'))
    expect(() => session.start(makeEpisode('2', { audioHandle: h2 }), 0, 1)).not.toThrow()
    expect(h2.release).not.toHaveBeenCalled()
    session.stop()
    expect(h2.release).toHaveBeenCalledTimes(1)
  })

  test('idle での stop() は何も release しない', () => {
    const h = makeHandle(audio, log)
    session.stop()
    expect(h.release).not.toHaveBeenCalled()
    expect(log).toEqual([])
  })

  test('切替列 h1 → h2 → h3 で各 handle は 1 回ずつ、保持期間の終わりの順（h1→h2→h3）で release される', () => {
    const order: string[] = []
    const mk = (name: string): AudioHandle => ({ release: vi.fn(() => void order.push(name)) })
    const h1 = mk('h1')
    const h2 = mk('h2')
    const h3 = mk('h3')
    const ep1 = makeEpisode('1', { audioHandle: h1 })

    session.start(ep1, 0, 1)
    session.start({ ...ep1 }, 0, 1) // 保持中 h1 の載せ替え（同じ audioUrl）
    session.start(makeEpisode('2', { audioHandle: h2 }), 0, 1)
    session.start(makeEpisode('3', { audioHandle: h3 }), 0, 1)
    session.stop()
    session.stop()

    expect(order).toEqual(['h1', 'h2', 'h3'])
  })
})

describe('CI-C03・CI-T1 release の例外は捕捉せず伝え、状態と AudioElement は事後条件を満たす', () => {
  const err = new Error('release failed')

  for (const status of ['paused', 'playing'] as const) {
    test(`start 経路（${status}）: 同じ例外が伝わり、状態は loading(ep2)・release は最後の 1 手・投げた handle は以後保持されない`, async () => {
      const log: string[] = []
      const h1 = makeThrowingHandle(audio, log, err)
      const h2 = makeHandle(audio, log)
      const ep2 = makeEpisode('2', { audioHandle: h2 })
      await drive(status, makeEpisode('1', { audioHandle: h1 }))
      const events = recordEvents()

      const caught = catchError(() => session.start(ep2, 0, 1))

      // (1) 同じ例外オブジェクトが呼出側へ伝わる
      expect(caught).toBe(err)
      // (2) release より前にすべて完了している
      expect(st().status).toBe('loading')
      expect(st().episode?.id).toBe('2')
      expect(audio.src).toBe(ep2.audioUrl)
      expect(log).toEqual([ep2.audioUrl])
      expect(stateChangedStatuses(events)).toContain('loading')
      // (3) 以後 h1 は保持されず、現 handle は h2
      expect(catchError(() => session.stop())).toBeUndefined()
      expect(h2.release).toHaveBeenCalledTimes(1)
      expect(h1.release).toHaveBeenCalledTimes(1)
    })
  }

  test('stop 経路（playing）: 同じ例外が伝わり、状態は idle・AudioElement は停止済み・2 回目の stop は throw せず再 release しない', async () => {
    const log: string[] = []
    const h1 = makeThrowingHandle(audio, log, err)
    await drive('playing', makeEpisode('1', { audioHandle: h1 }))
    const events = recordEvents()

    const caught = catchError(() => session.stop())

    expect(caught).toBe(err)
    expect(st().status).toBe('idle')
    expect(audio.paused).toBe(true)
    expect(audio.src).toBe('')
    expect(log).toEqual([''])
    expect(stateChangedStatuses(events)).toContain('idle')
    expect(catchError(() => session.stop())).toBeUndefined()
    expect(h1.release).toHaveBeenCalledTimes(1)
  })
})
