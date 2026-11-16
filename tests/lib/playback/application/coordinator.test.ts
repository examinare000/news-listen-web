// Coordinator の契約: 実 Session ＋ MockAudio ＋ 実 PositionReporter。外界（保存庫・取得・端末の位置・送信）は関数 double。
// 待ちは手製の deferred と Promise.resolve の繰り返しで進める。
// 全シナリオの決着後に共有仕様の shared-inv-01（session が idle でなければ、その episode の id が current の id）を検査する。
// RED 理由（実装前）: `@/lib/playback/application/coordinator` がまだ存在しない。
import { describe, expect, test, vi } from 'vitest'
import { createPlaybackCoordinator } from '@/lib/playback/application/coordinator'
import { createPositionReporter } from '@/lib/playback/application/positionReporter'
import type { PositionOutbox } from '@/lib/playback/application/positionOutbox'
import type { ResumeAdvisor } from '@/lib/playback/application/resumeAdvisor'
import type {
  EpisodeSource,
  LocalPositionStore,
  OfflineLibrary,
  PositionSubject,
  PositionSync,
  RemotePosition,
  StoredPosition,
} from '@/lib/playback/application/ports'
import { createPlaybackSession } from '@/lib/playback/application/session'
import type { PlaybackSession } from '@/lib/playback/application/session'
import type { Episode, PlayableEpisode } from '@/lib/catalog/domain/episode'
import type { PlaybackSpeed } from '@/lib/playback/domain/session'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'
import { MockAudio } from '../../../helpers/mockAudio'

// ---------------------------------------------------------------------------
// 道具
// ---------------------------------------------------------------------------

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 40; i += 1) await Promise.resolve()
}

// 時計の基準（記録時刻）。resume の候補表は T1 < T2 の相対で書く。
const T0 = 1_000_000
const T1 = 2_000_000
const T2 = 3_000_000
const USER = 'u-a'

const NETWORK_FAILURE: ApiFailure = { kind: 'network' }
const OK_VOID: Result<void, ApiFailure> = { ok: true, value: undefined }

const playable = (id: string, extra: Partial<PlayableEpisode> = {}): PlayableEpisode => ({
  kind: 'playable',
  id,
  title: `display ${id}`,
  label: { title: `Title ${id}`, intro: `Intro ${id}` },
  audioUrl: `u-${id}`,
  durationSeconds: 100,
  difficulty: 'toeic_600',
  createdAt: '2026-01-01',
  serverPositionSeconds: 0,
  ...extra,
})

const entry = (id: string) => ({ id, title: `Title ${id}`, intro: `Intro ${id}` })

function take<T>(table: Map<string, Deferred<T>[]>, id: string): Deferred<T> | undefined {
  return table.get(id)?.shift()
}

function push<T>(table: Map<string, Deferred<T>[]>, id: string): Deferred<T> {
  const d = deferred<T>()
  const list = table.get(id) ?? []
  list.push(d)
  table.set(id, list)
  return d
}

function createWorld(options: { readonly online?: boolean } = {}) {
  const audio = new MockAudio()
  const real = createPlaybackSession(audio)
  const start = vi.fn((episode: PlayableEpisode, resume: number, speed: PlaybackSpeed): void => {
    real.start(episode, resume, speed)
  })
  const fail = vi.fn((ref: Parameters<PlaybackSession['fail']>[0], reason: Parameters<PlaybackSession['fail']>[1]): void => {
    real.fail(ref, reason)
  })
  const play = vi.fn((): Promise<void> => real.play())
  const seek = vi.fn((seconds: number): void => {
    real.seek(seconds)
  })
  const session: PlaybackSession = { ...real, start, fail, play, seek }

  const env = {
    online: options.online ?? true,
    speed: 1.0 as PlaybackSpeed,
    now: T0,
    recording: USER as string | null,
    sending: USER as string | null,
    foreground: true,
  }
  const saved = new Set<string>()
  const catalog = new Map<string, Episode>()
  const fetchFailures = new Set<string>()
  const nullGets = new Set<string>()
  // 端末の記録。key は `${userId}:${episodeId}`。
  const positions = new Map<string, StoredPosition>()
  const fetchHolds = new Map<string, Deferred<Result<Episode, ApiFailure>>[]>()
  const getHolds = new Map<string, Deferred<PlayableEpisode | null>[]>()
  const releases = new Map<string, ReturnType<typeof vi.fn<() => void>>>()
  const releaseOf = (id: string): ReturnType<typeof vi.fn<() => void>> => {
    const existing = releases.get(id)
    if (existing !== undefined) return existing
    const created = vi.fn<() => void>()
    releases.set(id, created)
    return created
  }
  const cached = (id: string, extra: Partial<PlayableEpisode> = {}): PlayableEpisode =>
    playable(id, { audioHandle: { release: releaseOf(id) }, ...extra })

  const fetch = vi.fn<EpisodeSource['fetch']>((id) => {
    const held = take(fetchHolds, id)
    if (held !== undefined) return held.promise
    if (fetchFailures.has(id)) return Promise.resolve({ ok: false, failure: NETWORK_FAILURE })
    return Promise.resolve({ ok: true, value: catalog.get(id) ?? playable(id) })
  })
  const rejectingHas = new Set<string>()
  const rejectingGets = new Set<string>()
  const has = vi.fn<OfflineLibrary['has']>((id) =>
    rejectingHas.has(id) ? Promise.reject(new Error('cache open failed')) : Promise.resolve(saved.has(id)),
  )
  const get = vi.fn<OfflineLibrary['get']>((id) => {
    if (rejectingGets.has(id)) return Promise.reject(new Error('cache read failed'))
    const held = take(getHolds, id)
    if (held !== undefined) return held.promise
    return Promise.resolve(nullGets.has(id) ? null : cached(id))
  })
  const offline: OfflineLibrary = {
    save: vi.fn<OfflineLibrary['save']>(() => Promise.resolve({ ok: true, value: undefined })),
    get,
    has,
    remove: vi.fn<OfflineLibrary['remove']>(() => Promise.resolve()),
    clear: vi.fn<OfflineLibrary['clear']>(() => Promise.resolve()),
    list: vi.fn<OfflineLibrary['list']>(() => Promise.resolve([])),
    usage: vi.fn<OfflineLibrary['usage']>(() => Promise.resolve(null)),
  }

  const updatePosition = vi.fn<PositionSync['updatePosition']>(() =>
    Promise.resolve({ ok: true, value: { positionSeconds: 0, recordedAt: null } }),
  )
  const markCompleted = vi.fn<PositionSync['markCompleted']>(() => Promise.resolve(OK_VOID))
  const read = vi.fn<LocalPositionStore['read']>((user, id) => positions.get(`${user}:${id}`) ?? null)
  const write = vi.fn<LocalPositionStore['write']>(() => true)
  const unsent = vi.fn<LocalPositionStore['unsent']>(() => [])
  const markSynced = vi.fn<LocalPositionStore['markSynced']>()
  const clearSubject = vi.fn<LocalPositionStore['clearSubject']>()
  const reclaim = vi.fn<LocalPositionStore['reclaim']>()
  const discardLegacy = vi.fn<LocalPositionStore['discardLegacy']>()
  const localPositions: LocalPositionStore = { read, write, unsent, markSynced, clearSubject, reclaim, discardLegacy }
  // outbox は手書きの fake（実物は値で import しない）。送信の経路を flush の呼出で観測する。
  const flush = vi.fn<PositionOutbox['flush']>(() => Promise.resolve(OK_VOID))
  const adopt = vi.fn<PositionOutbox['adopt']>()
  const subject: PositionSubject = { recording: () => env.recording, sending: () => env.sending }
  // 控えは手書きの fake（実物は値で import しない）。Map が控え、vi.fn が呼出の観測。
  const advice = new Map<string, RemotePosition>()
  const note = vi.fn<ResumeAdvisor['note']>((id, remote) => {
    advice.set(id, remote)
  })
  const pending = vi.fn<ResumeAdvisor['pending']>((id) => advice.get(id) ?? null)
  const clear = vi.fn<ResumeAdvisor['clear']>((id) => {
    advice.delete(id)
  })
  const resetAdvice = vi.fn<ResumeAdvisor['reset']>(() => {
    advice.clear()
  })
  const resumeAdvisor: ResumeAdvisor = { note, pending, clear, reset: resetAdvice }
  const positionReporter = createPositionReporter({
    sync: { updatePosition, markCompleted },
    outbox: { flush },
    local: localPositions,
    clock: () => env.now,
    subject,
    advisor: resumeAdvisor,
  })

  const coordinator = createPlaybackCoordinator({
    session,
    offline,
    positionReporter,
    episodes: { fetch },
    localPositions,
    subject,
    positionIntake: { adopt },
    resumeAdvisor,
    isForeground: () => env.foreground,
    isOnline: () => env.online,
    defaultSpeed: () => env.speed,
  })
  const notified = vi.fn()
  coordinator.subscribe(notified)

  return {
    audio,
    session,
    coordinator,
    env,
    saved,
    catalog,
    fetchFailures,
    nullGets,
    rejectingHas,
    rejectingGets,
    positions,
    start,
    fail,
    play,
    seek,
    advice,
    resumeAdvisor,
    advisorCalls: { note, pending, clear, reset: resetAdvice },
    fetch,
    has,
    get,
    updatePosition,
    markCompleted,
    read,
    write,
    markSynced,
    clearSubject,
    reclaim,
    discardLegacy,
    flush,
    adopt,
    notified,
    releaseOf,
    cached,
    holdFetch: (id: string) => push(fetchHolds, id),
    holdGet: (id: string) => push(getHolds, id),
    fetched: (id: string): Result<Episode, ApiFailure> => ({ ok: true, value: playable(id) }),
  }
}
type World = ReturnType<typeof createWorld>

async function beginPlayback(w: World): Promise<void> {
  // 再生への移行は Coordinator が行う（手で play() を呼ばない）。
  w.audio.fireLoadedMetadata(100)
  await settle()
}

async function startPlaying(w: World, id: string): Promise<void> {
  expect(await w.coordinator.startEpisode(id)).toEqual({ ok: true })
  await beginPlayback(w)
}

/** キュー [first, ...rest]・first 再生中。 */
async function playingWithQueue(w: World, first: string, ...rest: string[]): Promise<void> {
  await startPlaying(w, first)
  for (const id of rest) expect(await w.coordinator.addToQueue(entry(id))).toEqual({ ok: true })
}

async function endPlayback(w: World): Promise<void> {
  w.audio.fireEnded()
  await settle()
}

const stateOf = (w: World): { status: string; id: string | null } => {
  const s = w.session.state()
  return { status: s.status, id: s.status === 'idle' ? null : s.episode.id }
}
const currentId = (w: World): string | null => w.coordinator.nowPlaying()?.episodeId ?? null
const upNextIds = (w: World): string[] => w.coordinator.upNext().map((item) => item.id)
const calledIds = (mock: { readonly mock: { readonly calls: ReadonlyArray<ReadonlyArray<unknown>> } }): unknown[] =>
  mock.mock.calls.map((call) => call[0])
const startedIds = (w: World): string[] => w.start.mock.calls.map((call) => call[0].id)
/** Reporter が記録した episode の id（`local.write(user, id, record)` の第 2 引数）。 */
const writtenIds = (w: World): unknown[] => w.write.mock.calls.map((call) => call[1])
const record = (positionSeconds: number, recordedAt: number, synced = true): StoredPosition => ({
  positionSeconds,
  recordedAt,
  synced,
})

/** shared-inv-01: session が idle でなければ、その episode の id が current の id。id だけの errored は current を観測できないので対象外。 */
async function expectSharedInvariant(w: World): Promise<void> {
  await settle()
  const state = w.session.state()
  if (state.status === 'idle') return
  if (!('audioUrl' in state.episode)) return
  expect(currentId(w)).toBe(state.episode.id)
}

// ---------------------------------------------------------------------------
// 生成と利用者の開始
// ---------------------------------------------------------------------------

describe('PlaybackCoordinator の生成', () => {
  test('生成時に Reporter が先に事象を受ける: 完聴の送信は次の再生元の解決より先 (verifies: CI-T21, CI-T29; shared-session-01)', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'c')
    await endPlayback(w)

    expect(w.markCompleted).toHaveBeenCalledWith('a')
    const completedAt = w.markCompleted.mock.invocationCallOrder[0]
    const firstResolveAt = w.has.mock.invocationCallOrder[1]
    expect(completedAt).toBeLessThan(firstResolveAt)
    expect(startedIds(w)).toEqual(['a', 'c'])
    await expectSharedInvariant(w)
  })
})

describe('startEpisode', () => {
  test('オフラインで未保存なら取得せず offline_uncached を返し、キューも state も変えない (verifies: CI-T22; shared-session-13)', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'c')
    w.env.online = false
    const before = w.session.state()
    const queueBefore = w.coordinator.queueView()
    w.fetch.mockClear()
    w.get.mockClear()

    const result = await w.coordinator.startEpisode('b')

    expect(result).toEqual({ ok: false, notice: 'offline_uncached' })
    expect(w.fetch).not.toHaveBeenCalled()
    expect(w.get).not.toHaveBeenCalled()
    expect(w.session.state()).toBe(before)
    expect(w.coordinator.queueView()).toEqual(queueBefore)
    expect(w.fail).not.toHaveBeenCalled()
    await expectSharedInvariant(w)
  })

  test('保存済みなら offline.get だけ、未保存のオンラインなら episodes.fetch だけを呼ぶ (verifies: CI-T23; web-contract-07)', async () => {
    const w = createWorld()
    w.saved.add('s')

    expect(await w.coordinator.startEpisode('s')).toEqual({ ok: true })
    expect(calledIds(w.get)).toEqual(['s'])
    expect(w.fetch).not.toHaveBeenCalled()

    w.get.mockClear()
    expect(await w.coordinator.startEpisode('n')).toEqual({ ok: true })
    expect(calledIds(w.fetch)).toEqual(['n'])
    expect(w.get).not.toHaveBeenCalled()
    expect(stateOf(w).id).toBe('n')
    await expectSharedInvariant(w)
  })

  test.each([
    ['取得の失敗 (ok:false)', (w: World) => w.fetchFailures.add('b')],
    ['保存済みなのに get が null', (w: World) => (w.saved.add('b'), w.nullGets.add('b'))],
  ])('%s は fetch_failed を返し、キューも state も変えない (verifies: CI-T23; web-deriv-26, shared-session-13)', async (_name, arrange) => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'c')
    arrange(w)
    const before = w.session.state()
    const queueBefore = w.coordinator.queueView()

    const result = await w.coordinator.startEpisode('b')

    expect(result).toEqual({ ok: false, notice: 'fetch_failed' })
    expect(w.session.state()).toBe(before)
    expect(w.coordinator.queueView()).toEqual(queueBefore)
    expect(w.fail).not.toHaveBeenCalled()
    await expectSharedInvariant(w)
  })

  test.each([
    ['offline.has の reject', (w: World) => w.rejectingHas.add('b')],
    ['offline.get の reject', (w: World) => (w.saved.add('b'), w.rejectingGets.add('b'))],
  ])('保存庫の読み出し失敗 (%s) は fetch_failed を返し、キューも state も変えない (verifies: CI-T23)', async (_name, arrange) => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'c')
    arrange(w)
    const before = w.session.state()
    const queueBefore = w.coordinator.queueView()

    const result = await w.coordinator.startEpisode('b')

    expect(result).toEqual({ ok: false, notice: 'fetch_failed' })
    expect(w.session.state()).toBe(before)
    expect(w.coordinator.queueView()).toEqual(queueBefore)
    expect(w.fail).not.toHaveBeenCalled()
    await expectSharedInvariant(w)
  })

  test('再生できない episode (generating) は not_playable を返し、キューも state も変えない (verifies: CI-T24; shared-session-13)', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'c')
    w.catalog.set('g', { kind: 'generating', id: 'g', title: 't', difficulty: 'toeic_600', createdAt: '2026-01-01' })
    const before = w.session.state()
    const queueBefore = w.coordinator.queueView()

    const result = await w.coordinator.startEpisode('g')

    expect(result).toEqual({ ok: false, notice: 'not_playable' })
    expect(w.session.state()).toBe(before)
    expect(w.coordinator.queueView()).toEqual(queueBefore)
    await expectSharedInvariant(w)
  })

  test('新しい id は現在の次に挿入して再生し、待機列の c は残る。題は episode の label の原文 (verifies: CI-T25, CI-T03; web-contract-07)', async () => {
    const w = createWorld()
    w.catalog.set('x', playable('x', { title: 'display-title-x', label: { title: null, intro: 'i'.repeat(60) } }))
    await playingWithQueue(w, 'a', 'c')

    expect(await w.coordinator.startEpisode('x')).toEqual({ ok: true })

    expect(stateOf(w)).toEqual({ status: 'loading', id: 'x' })
    expect(currentId(w)).toBe('x')
    expect(upNextIds(w)).toEqual(['c'])
    expect(w.coordinator.nowPlaying()?.title).toBe('i'.repeat(50))
    await expectSharedInvariant(w)
  })

  test('既にキューにある id は jump で現在にし、重複して挿入しない (verifies: CI-T25; web-contract-07)', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'c', 'd')

    expect(await w.coordinator.startEpisode('d')).toEqual({ ok: true })

    expect(currentId(w)).toBe('d')
    expect(upNextIds(w)).toEqual([])
    await expectSharedInvariant(w)
  })

  describe('resume の候補: 時刻の新しい方（verifies: web-rule-playback-05・ADR-109 決定 10）', () => {
    // [名前, 端末の記録, サーバーの値, 期待する開始位置]。duration 300。結果は末尾 2 秒窓を通した後。
    test.each<[string, StoredPosition | null, { position: number; at?: number }, number]>([
      ['端末が新しければ端末', record(50, T2), { position: 120, at: T1 }, 50],
      ['サーバーが新しければサーバー', record(50, T1), { position: 120, at: T2 }, 120],
      ['サーバーの時刻が無ければ端末（時刻なしは最古）', record(50, T1), { position: 120 }, 50],
      ['同時刻なら端末', record(50, T1), { position: 120, at: T1 }, 50],
      ['端末に無ければサーバー（時刻なしでも）', null, { position: 120 }, 120],
      ['端末に無く、サーバーが 0 なら 0', null, { position: 0 }, 0],
      ['新しい端末の位置が末尾 2 秒以内なら 0（窓）', record(299, T2), { position: 0, at: T1 }, 0],
    ])('%s', async (_name, device, server, expected) => {
      const w = createWorld()
      w.catalog.set(
        'r',
        playable('r', {
          durationSeconds: 300,
          serverPositionSeconds: server.position,
          ...(server.at === undefined ? {} : { serverPositionRecordedAt: server.at }),
        }),
      )
      if (device !== null) w.positions.set(`${USER}:r`, device)

      await w.coordinator.startEpisode('r')

      expect(w.start).toHaveBeenCalledTimes(1)
      expect(w.start.mock.calls[0][1]).toBe(expected)
      await expectSharedInvariant(w)
    })

    test('記録の主体が null なら端末の記録は候補にしない（主体の記録も読まない）', async () => {
      const w = createWorld()
      w.catalog.set('r', playable('r', { durationSeconds: 300, serverPositionSeconds: 120 }))
      w.positions.set(`${USER}:r`, record(50, T2))
      w.env.recording = null

      await w.coordinator.startEpisode('r')

      expect(w.start.mock.calls[0][1]).toBe(120)
      expect(w.read).not.toHaveBeenCalled()
    })

    test('端末の記録は記録の主体のものだけを読む（別主体の新しい記録は候補にしない）', async () => {
      const w = createWorld()
      w.catalog.set('r', playable('r', { durationSeconds: 300, serverPositionSeconds: 120 }))
      w.positions.set('u-b:r', record(50, T2))

      await w.coordinator.startEpisode('r')

      expect(w.read).toHaveBeenCalledWith(USER, 'r')
      expect(w.start.mock.calls[0][1]).toBe(120)
    })
  })

  test('shared-sync-07: 開始前の再取得（network 経路）の位置を adopt へ渡し、保存済みの経路は渡さない', async () => {
    const w = createWorld()
    w.catalog.set('n', playable('n', { serverPositionSeconds: 80, serverPositionRecordedAt: T2 }))
    w.catalog.set('m', playable('m', { serverPositionSeconds: 30 }))

    expect(await w.coordinator.startEpisode('n')).toEqual({ ok: true })
    expect(w.adopt).toHaveBeenCalledTimes(1)
    expect(w.adopt).toHaveBeenLastCalledWith(USER, 'n', { positionSeconds: 80, recordedAt: T2 })

    // 時刻の無いサーバー値は recordedAt: null で渡す（取り込み側が最古として扱う）。
    expect(await w.coordinator.startEpisode('m')).toEqual({ ok: true })
    expect(w.adopt).toHaveBeenCalledTimes(2)
    expect(w.adopt).toHaveBeenLastCalledWith(USER, 'm', { positionSeconds: 30, recordedAt: null })

    // 保存済みの経路（offline.get）は入口でない。
    w.adopt.mockClear()
    w.saved.add('s')
    expect(await w.coordinator.startEpisode('s')).toEqual({ ok: true })
    expect(calledIds(w.get)).toEqual(['s'])
    expect(w.adopt).not.toHaveBeenCalled()
    await expectSharedInvariant(w)
  })

  test('shared-leave-14 / shared-sync-07: 開始前の再取得の応答の時点で送信の主体が変わっていれば adopt へ渡さない', async () => {
    const w = createWorld()
    w.catalog.set('n', playable('n', { serverPositionSeconds: 80, serverPositionRecordedAt: T2 }))
    const held = w.holdFetch('n')

    const starting = w.coordinator.startEpisode('n')
    await settle()
    w.env.sending = 'u-b'
    held.resolve({ ok: true, value: w.catalog.get('n') as Episode })
    await starting
    await settle()

    expect(w.adopt).not.toHaveBeenCalled()

    // 正方向の対照: 主体が変わらなければ同じ経路で渡る。
    const control = createWorld()
    control.catalog.set('n', playable('n', { serverPositionSeconds: 80, serverPositionRecordedAt: T2 }))
    const heldControl = control.holdFetch('n')
    const controlStarting = control.coordinator.startEpisode('n')
    await settle()
    heldControl.resolve({ ok: true, value: control.catalog.get('n') as Episode })
    await controlStarting
    expect(control.adopt).toHaveBeenCalledTimes(1)
    expect(control.adopt).toHaveBeenCalledWith(USER, 'n', { positionSeconds: 80, recordedAt: T2 })
  })

  test('shared-leave-14 / shared-sync-07: 送信の主体が無い（null）間の再取得は adopt へ渡さない', async () => {
    const w = createWorld()
    w.catalog.set('n', playable('n', { serverPositionSeconds: 80, serverPositionRecordedAt: T2 }))
    w.env.sending = null

    expect(await w.coordinator.startEpisode('n')).toEqual({ ok: true })

    expect(w.adopt).not.toHaveBeenCalled()
  })

  test('すべての開始で defaultSpeed() の値を使う。session の速度は引き継がない (verifies: CI-T37; shared-session-10)', async () => {
    const w = createWorld()
    w.env.speed = 1.5
    await startPlaying(w, 'a')
    expect(w.start.mock.calls[0][2]).toBe(1.5)

    w.session.setSpeed(2.0)
    await w.coordinator.startEpisode('b')

    expect(w.start.mock.calls[1][2]).toBe(1.5)
    await expectSharedInvariant(w)
  })

  test('後から始めた開始を優先する: b の保留中に d が先に決着すると d が再生され、b の解決は何も変えず { ok:true } (verifies: CI-T27; web-contract-08)', async () => {
    const w = createWorld()
    const heldB = w.holdFetch('b')
    const heldD = w.holdFetch('d')

    const first = w.coordinator.startEpisode('b')
    const second = w.coordinator.startEpisode('d')
    await settle()
    heldD.resolve(w.fetched('d'))
    expect(await second).toEqual({ ok: true })
    heldB.resolve(w.fetched('b'))
    expect(await first).toEqual({ ok: true })

    expect(startedIds(w)).toEqual(['d'])
    expect(stateOf(w).id).toBe('d')
    expect(upNextIds(w)).toEqual([])
    await expectSharedInvariant(w)
  })
})

// ---------------------------------------------------------------------------
// 利用者の開始と自動（onEnded）の優先
// ---------------------------------------------------------------------------

describe('利用者の開始と自動の優先', () => {
  test('利用者の開始の待ち中に ended が来ても次の取得を始めず、b の成功後はキューが [a,b,c] (verifies: CI-T28, CI-T36; shared-session-17, shared-session-04)', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'c')
    const heldB = w.holdFetch('b')

    const pending = w.coordinator.startEpisode('b')
    await settle()
    await endPlayback(w)

    expect(calledIds(w.fetch)).not.toContain('c')
    expect(calledIds(w.has)).not.toContain('c')
    expect(calledIds(w.get)).not.toContain('c')
    expect(currentId(w)).toBe('a')

    heldB.resolve(w.fetched('b'))
    expect(await pending).toEqual({ ok: true })

    expect(startedIds(w)).toEqual(['a', 'b'])
    expect(currentId(w)).toBe('b')
    expect(upNextIds(w)).toEqual(['c'])
    await expectSharedInvariant(w)
  })

  test('自動の待ち中に手動 b が来たら、同期部分で current を a に戻して購読者へ通知し、c の解決は何も始めない (verifies: CI-T28, CI-T54, CI-T36; shared-session-17, shared-session-04)', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'c')
    w.saved.add('c')
    const heldC = w.holdGet('c')
    const heldB = w.holdFetch('b')
    await endPlayback(w)
    expect(stateOf(w)).toEqual({ status: 'ended', id: 'a' })
    expect(currentId(w)).toBeNull()
    const notifiedBefore = w.notified.mock.calls.length

    const pending = w.coordinator.startEpisode('b')

    expect(currentId(w)).toBe('a')
    expect(w.notified.mock.calls.length).toBeGreaterThan(notifiedBefore)
    expect(upNextIds(w)).toEqual(['c'])

    heldC.resolve(w.cached('c'))
    await settle()
    expect(startedIds(w)).toEqual(['a'])
    expect(stateOf(w)).toEqual({ status: 'ended', id: 'a' })

    heldB.resolve(w.fetched('b'))
    expect(await pending).toEqual({ ok: true })
    expect(startedIds(w)).toEqual(['a', 'b'])
    expect(upNextIds(w)).toEqual(['c'])
    await expectSharedInvariant(w)
  })

  test('自動の待ち中の手動 b が再生不可でも、advance は戻り state は ended(a)・current a・待機列は [c] (verifies: CI-T54, CI-T28, CI-T34; shared-session-17, shared-session-04)', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'c')
    w.saved.add('c')
    const heldC = w.holdGet('c')
    await endPlayback(w)
    w.env.online = false

    const result = await w.coordinator.startEpisode('b')
    expect(result).toEqual({ ok: false, notice: 'offline_uncached' })
    heldC.resolve(w.cached('c'))
    await settle()

    expect(stateOf(w)).toEqual({ status: 'ended', id: 'a' })
    expect(currentId(w)).toBe('a')
    expect(upNextIds(w)).toEqual(['c'])
    expect(startedIds(w)).toEqual(['a'])
    await expectSharedInvariant(w)
  })

  test('利用者の待ち中の ended の後で、その開始が失敗しても自動を再開しない: state ended(a)・current a・c の取得 0 回 (verifies: CI-T28, CI-T34; shared-session-17, shared-session-04)', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'c')
    const heldB = w.holdFetch('b')

    const pending = w.coordinator.startEpisode('b')
    await settle()
    await endPlayback(w)
    heldB.resolve({ ok: false, failure: NETWORK_FAILURE })
    expect(await pending).toEqual({ ok: false, notice: 'fetch_failed' })
    await settle()

    expect(stateOf(w)).toEqual({ status: 'ended', id: 'a' })
    expect(currentId(w)).toBe('a')
    expect(calledIds(w.fetch)).not.toContain('c')
    expect(calledIds(w.has)).not.toContain('c')
    expect(upNextIds(w)).toEqual(['c'])
    await expectSharedInvariant(w)
  })

  test('自動の待ち中の skipToNext は c を飛ばさず、c を解決して開始する (d ではない) (verifies: CI-T54, CI-T31; shared-session-17, shared-session-14)', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'c', 'd')
    const heldAuto = w.holdFetch('c')
    await endPlayback(w)
    expect(calledIds(w.fetch)).toEqual(['a', 'c'])

    const skip = w.coordinator.skipToNext()
    expect(currentId(w)).toBe('a')
    expect(upNextIds(w)).toEqual(['c', 'd'])
    expect(await skip).toEqual({ ok: true })
    heldAuto.resolve(w.fetched('c'))
    await settle()

    expect(startedIds(w)).toEqual(['a', 'c'])
    expect(currentId(w)).toBe('c')
    expect(upNextIds(w)).toEqual(['d'])
    expect(calledIds(w.fetch)).not.toContain('d')
    await expectSharedInvariant(w)
  })

  test('捨てた取得結果の音源は 1 回だけ解放し、開始した episode は解放しない (verifies: CI-T53, CI-T27, CI-T28; shared-session-17)', async () => {
    const w = createWorld()
    w.saved.add('b')
    w.saved.add('d')
    const heldB = w.holdGet('b')

    const first = w.coordinator.startEpisode('b')
    await settle()
    expect(await w.coordinator.startEpisode('d')).toEqual({ ok: true })
    expect(startedIds(w)).toEqual(['d'])
    expect(w.releaseOf('d')).not.toHaveBeenCalled()

    heldB.resolve(w.cached('b'))
    expect(await first).toEqual({ ok: true })
    expect(w.releaseOf('b')).toHaveBeenCalledTimes(1)
    expect(startedIds(w)).toEqual(['d'])
    await expectSharedInvariant(w)

    const w2 = createWorld()
    await playingWithQueue(w2, 'a', 'c')
    w2.saved.add('c')
    const heldC = w2.holdGet('c')
    await endPlayback(w2)
    expect(await w2.coordinator.startEpisode('b')).toEqual({ ok: true })
    heldC.resolve(w2.cached('c'))
    await settle()
    expect(w2.releaseOf('c')).toHaveBeenCalledTimes(1)
    expect(startedIds(w2)).toEqual(['a', 'b'])
    await expectSharedInvariant(w2)
  })

  test('retry() は自動の待ち中 (session は ended) には何もせず、自動を捨てずに c が始まる (verifies: CI-T30, CI-T28; shared-session-02)', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'c')
    const heldC = w.holdFetch('c')
    await endPlayback(w)
    const hasCalls = w.has.mock.calls.length
    const fetchCalls = w.fetch.mock.calls.length

    await w.coordinator.retry()

    expect(w.has.mock.calls.length).toBe(hasCalls)
    expect(w.fetch.mock.calls.length).toBe(fetchCalls)
    heldC.resolve(w.fetched('c'))
    await settle()
    expect(startedIds(w)).toEqual(['a', 'c'])
    expect(currentId(w)).toBe('c')
    await expectSharedInvariant(w)
  })
})

// ---------------------------------------------------------------------------
// onEnded・retry・skipToNext
// ---------------------------------------------------------------------------

describe('onEnded', () => {
  test('次の取得に失敗したら current は b のまま errored(fetch_failed)。同期の完聴送信は応答を待たない (verifies: CI-T29, CI-T20; shared-session-01, shared-dec-15)', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'b')
    w.fetchFailures.add('b')
    await endPlayback(w)

    expect(w.fail).toHaveBeenCalledWith({ id: 'b' }, { kind: 'fetch_failed', failure: NETWORK_FAILURE })
    expect(stateOf(w)).toEqual({ status: 'errored', id: 'b' })
    w.fetchFailures.delete('b')
    w.fetch.mockClear()
    await w.coordinator.retry()
    expect(calledIds(w.fetch)).toEqual(['b'])
    await expectSharedInvariant(w)
  })

  test.each([
    ['オフラインで未保存', (w: World) => void (w.env.online = false), 0],
    ['generating', (w: World) => void w.catalog.set('b', { kind: 'generating', id: 'b', title: 't', difficulty: 'toeic_600', createdAt: '2026-01-01' }), 1],
    ['保存済みなのに get が null', (w: World) => (w.saved.add('b'), w.nullGets.add('b')), 0],
  ])('%s は session.fail(source_unavailable) になる (verifies: CI-T29; shared-session-01, shared-session-03)', async (_name, arrange, fetchCount) => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'b')
    arrange(w)
    w.fetch.mockClear()
    await endPlayback(w)

    expect(w.fail).toHaveBeenCalledTimes(1)
    expect(w.fail).toHaveBeenCalledWith({ id: 'b' }, { kind: 'source_unavailable' })
    expect(stateOf(w)).toEqual({ status: 'errored', id: 'b' })
    expect(w.fetch.mock.calls.length).toBe(fetchCount)
    await expectSharedInvariant(w)
  })

  test.each([
    ['offline.has の reject', (w: World) => w.rejectingHas.add('b')],
    ['offline.get の reject', (w: World) => (w.saved.add('b'), w.rejectingGets.add('b'))],
  ])('保存庫の読み出し失敗 (%s) は session.fail(source_unavailable) になり、current は次の回のまま (verifies: CI-T29)', async (_name, arrange) => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'b')
    arrange(w)
    await endPlayback(w)

    expect(w.fail).toHaveBeenCalledTimes(1)
    expect(w.fail).toHaveBeenCalledWith({ id: 'b' }, { kind: 'source_unavailable' })
    expect(stateOf(w)).toEqual({ status: 'errored', id: 'b' })
    expect(upNextIds(w)).toEqual([])
  })

  test('次が無い ended は何も変えず、完聴の送信だけが行われる (verifies: CI-T29; shared-session-01)', async () => {
    const w = createWorld()
    await startPlaying(w, 'a')
    const hasCalls = w.has.mock.calls.length

    await endPlayback(w)

    expect(stateOf(w)).toEqual({ status: 'ended', id: 'a' })
    expect(w.fail).not.toHaveBeenCalled()
    expect(w.has.mock.calls.length).toBe(hasCalls)
    expect(w.markCompleted).toHaveBeenCalledWith('a')
    expect(currentId(w)).toBe('a')
    await expectSharedInvariant(w)
  })

  test('送信が未決着でも次の開始は進む (verifies: CI-T35, CI-T29; shared-session-07)', async () => {
    const w = createWorld()
    w.markCompleted.mockReturnValue(new Promise(() => undefined))
    w.flush.mockReturnValue(new Promise(() => undefined))
    await playingWithQueue(w, 'a', 'c')

    await endPlayback(w)

    expect(startedIds(w)).toEqual(['a', 'c'])
    expect(currentId(w)).toBe('c')
    await expectSharedInvariant(w)
  })
})

describe('retry', () => {
  test('errored(b) で成功すれば b を開始し、失敗すれば再び errored。errored 以外と current 無しでは port を呼ばない (verifies: CI-T30; shared-session-02)', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'b')
    w.fetchFailures.add('b')
    await endPlayback(w)
    expect(stateOf(w)).toEqual({ status: 'errored', id: 'b' })

    await w.coordinator.retry()
    expect(w.fail).toHaveBeenCalledTimes(2)
    expect(stateOf(w)).toEqual({ status: 'errored', id: 'b' })

    w.fetchFailures.delete('b')
    await expect(w.coordinator.retry()).resolves.toBeUndefined()
    expect(startedIds(w)).toEqual(['a', 'b'])
    expect(currentId(w)).toBe('b')
    await expectSharedInvariant(w)

    const other = createWorld()
    await startPlaying(other, 'a')
    other.has.mockClear()
    other.fetch.mockClear()
    other.get.mockClear()
    await other.coordinator.retry()
    const empty = createWorld()
    await empty.coordinator.retry()
    expect(other.has).not.toHaveBeenCalled()
    expect(other.fetch).not.toHaveBeenCalled()
    expect(other.get).not.toHaveBeenCalled()
    expect(empty.has).not.toHaveBeenCalled()
    expect(empty.fetch).not.toHaveBeenCalled()
  })
})

describe('skipToNext', () => {
  test('b が再生可能なら a の位置を 1 回記録して送り、完聴を送らずに b を開始する (verifies: CI-T31; shared-session-14)', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'b')
    w.audio.fireTimeUpdate(7)

    expect(await w.coordinator.skipToNext()).toEqual({ ok: true })

    expect(w.write).toHaveBeenCalledTimes(1)
    expect(w.write).toHaveBeenCalledWith(USER, 'a', { positionSeconds: 7, recordedAt: T0, synced: false })
    expect(w.flush).toHaveBeenCalledTimes(1)
    expect(w.updatePosition).not.toHaveBeenCalled()
    expect(w.markCompleted).not.toHaveBeenCalled()
    expect(startedIds(w)).toEqual(['a', 'b'])
    expect(currentId(w)).toBe('b')
    await expectSharedInvariant(w)
  })

  test.each([
    ['再生不可', (w: World) => void w.catalog.set('b', { kind: 'generating', id: 'b', title: 't', difficulty: 'toeic_600', createdAt: '2026-01-01' }), 'not_playable'],
    ['取得の失敗', (w: World) => void w.fetchFailures.add('b'), 'fetch_failed'],
    ['保存済みなのに get が null', (w: World) => (w.saved.add('b'), w.nullGets.add('b')), 'fetch_failed'],
  ])('b が%sなら notice を返し、キューも再生中の a も変えない (verifies: CI-T31; shared-session-15)', async (_name, arrange, notice) => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'b')
    arrange(w)
    const before = w.session.state()

    expect(await w.coordinator.skipToNext()).toEqual({ ok: false, notice })

    expect(w.session.state()).toBe(before)
    expect(currentId(w)).toBe('a')
    expect(upNextIds(w)).toEqual(['b'])
    await expectSharedInvariant(w)
  })

  test('次が無ければ { ok:true } で何もしない (verifies: CI-T31; shared-session-16)', async () => {
    const w = createWorld()
    await startPlaying(w, 'a')
    const before = w.session.state()
    w.fetch.mockClear()

    expect(await w.coordinator.skipToNext()).toEqual({ ok: true })

    expect(w.session.state()).toBe(before)
    expect(w.fetch).not.toHaveBeenCalled()
    expect(w.flush).not.toHaveBeenCalled()
    await expectSharedInvariant(w)
  })

  test.each([
    ['c を remove', (w: World) => w.coordinator.removeFromQueue('c'), ['d']],
    ['c を末尾へ reorder', (w: World) => w.coordinator.reorder(0, 2), ['d', 'c']],
    ['x を playNext', (w: World) => void w.coordinator.playNext(entry('x')), ['x', 'c', 'd']],
  ])('次へ送りの待ち中に待機列の先頭が変わる (%s) と、何も開始せず解放して { ok:true } (verifies: CI-T31, CI-T53, CI-T34; shared-session-14, shared-session-04)', async (_name, operate, expectedUpNext) => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'c', 'd')
    w.saved.add('c')
    const heldC = w.holdGet('c')

    const skip = w.coordinator.skipToNext()
    await settle()
    operate(w)
    await settle()
    heldC.resolve(w.cached('c'))

    expect(await skip).toEqual({ ok: true })
    expect(startedIds(w)).toEqual(['a'])
    expect(currentId(w)).toBe('a')
    expect(upNextIds(w)).toEqual(expectedUpNext)
    expect(w.releaseOf('c')).toHaveBeenCalledTimes(1)
    await expectSharedInvariant(w)
  })

  test('対照: 待ち中に何もしなければ c が始まる (verifies: CI-T31; shared-session-14)', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'c', 'd')
    w.saved.add('c')
    const heldC = w.holdGet('c')

    const skip = w.coordinator.skipToNext()
    await settle()
    heldC.resolve(w.cached('c'))

    expect(await skip).toEqual({ ok: true })
    expect(startedIds(w)).toEqual(['a', 'c'])
    expect(w.releaseOf('c')).not.toHaveBeenCalled()
    expect(upNextIds(w)).toEqual(['d'])
    await expectSharedInvariant(w)
  })
})

// ---------------------------------------------------------------------------
// キュー操作
// ---------------------------------------------------------------------------

describe('addToQueue・playNext', () => {
  test('空のキューでは startEpisode と同じ手順で開始し結果を返す。失敗しても要素は残る (verifies: CI-T32; web-contract-07, web-deriv-11)', async () => {
    const w = createWorld()
    expect(await w.coordinator.addToQueue(entry('a'))).toEqual({ ok: true })
    expect(stateOf(w).id).toBe('a')
    await expectSharedInvariant(w)

    const failing = createWorld()
    failing.fetchFailures.add('a')
    expect(await failing.coordinator.addToQueue(entry('a'))).toEqual({ ok: false, notice: 'fetch_failed' })
    expect(upNextIds(failing)).toEqual(['a'])

    const next = createWorld()
    expect(await next.coordinator.playNext(entry('p'))).toEqual({ ok: true })
    expect(stateOf(next).id).toBe('p')
    await expectSharedInvariant(next)
  })

  test('current があれば取得せず { ok:true }。playNext は current の直後、addToQueue は末尾 (verifies: CI-T32; web-contract-07)', async () => {
    const w = createWorld()
    await startPlaying(w, 'a')
    w.fetch.mockClear()

    expect(await w.coordinator.addToQueue(entry('c'))).toEqual({ ok: true })
    expect(await w.coordinator.playNext(entry('x'))).toEqual({ ok: true })

    expect(w.fetch).not.toHaveBeenCalled()
    expect(upNextIds(w)).toEqual(['x', 'c'])
    await expectSharedInvariant(w)
  })
})

describe('removeFromQueue・reorder', () => {
  test('remove と reorder は Queue に委譲し、戻り値は void。再生中の current の削除は不変 (verifies: CI-T33; web-contract-09)', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'c', 'd', 'e')

    expect(w.coordinator.removeFromQueue('d')).toBeUndefined()
    expect(upNextIds(w)).toEqual(['c', 'e'])
    expect(w.coordinator.reorder(0, 2)).toBeUndefined()
    expect(upNextIds(w)).toEqual(['e', 'c'])

    const before = w.session.state()
    w.coordinator.removeFromQueue('a')
    expect(w.session.state()).toBe(before)
    expect(currentId(w)).toBe('a')
    expect(upNextIds(w)).toEqual(['e', 'c'])
    await expectSharedInvariant(w)
  })

  test('自動の待ち中は session の episode (ended の a) と current (c) の削除を拒み、キューは変わらない (verifies: CI-T33; web-contract-09)', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'c')
    const heldC = w.holdFetch('c')
    await endPlayback(w)

    w.coordinator.removeFromQueue('a')
    w.coordinator.removeFromQueue('c')
    w.env.online = false
    expect(await w.coordinator.startEpisode('b')).toEqual({ ok: false, notice: 'offline_uncached' })
    heldC.resolve(w.fetched('c'))
    await settle()

    expect(stateOf(w)).toEqual({ status: 'ended', id: 'a' })
    expect(currentId(w)).toBe('a')
    expect(upNextIds(w)).toEqual(['c'])
    await expectSharedInvariant(w)
  })
})

describe('自動の待ち中の playNext', () => {
  test('session の episode (ended の a) の playNext は何もせず、通知もしない。続く skipToNext は同期部分で a に戻し、c を開始する (verifies: CI-T32, CI-T54, CI-T31, CI-T56, CI-T53, CI-T34; shared-session-17, shared-session-04)', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'c')
    w.saved.add('c')
    const heldAuto = w.holdGet('c')
    const heldSkip = w.holdGet('c')
    await endPlayback(w)
    const queueBefore = w.coordinator.queueView()
    const notifiedBefore = w.notified.mock.calls.length

    expect(await w.coordinator.playNext(entry('a'))).toEqual({ ok: true })
    expect(w.coordinator.queueView()).toEqual(queueBefore)
    expect(w.notified.mock.calls.length).toBe(notifiedBefore)

    const skip = w.coordinator.skipToNext()
    expect(currentId(w)).toBe('a')
    expect(upNextIds(w)).toEqual(['c'])
    expect(w.notified.mock.calls.length).toBeGreaterThan(notifiedBefore)

    heldAuto.resolve(w.cached('c'))
    await settle()
    expect(startedIds(w)).toEqual(['a'])
    expect(w.releaseOf('c')).toHaveBeenCalledTimes(1)

    heldSkip.resolve(w.cached('c'))
    expect(await skip).toEqual({ ok: true })
    expect(startedIds(w)).toEqual(['a', 'c'])
    expect(currentId(w)).toBe('c')
    expect(upNextIds(w)).toEqual([])
    await expectSharedInvariant(w)
  })

  test('ended の a の playNext の後の手動 b は [a,b,c] を作り、待機列は [c] (verifies: CI-T32, CI-T54, CI-T56, CI-T25, CI-T34; shared-session-17, shared-session-04)', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'c')
    w.saved.add('c')
    const heldC = w.holdGet('c')
    await endPlayback(w)

    await w.coordinator.playNext(entry('a'))
    expect(await w.coordinator.startEpisode('b')).toEqual({ ok: true })
    heldC.resolve(w.cached('c'))
    await settle()

    expect(startedIds(w)).toEqual(['a', 'b'])
    expect(currentId(w)).toBe('b')
    expect(upNextIds(w)).toEqual(['c'])
    await expectSharedInvariant(w)
  })

  test.each([
    ['current より前の別の要素 z の playNext', (w: World) => void w.coordinator.playNext(entry('z'))],
    ['current より前の別の要素 z の remove', (w: World) => w.coordinator.removeFromQueue('z')],
  ])('%s の後でも、手動 b の失敗で戻した先は a で待機列の先頭は c (verifies: CI-T56, CI-T54, CI-T33, CI-T34; shared-session-17, shared-session-04, web-contract-09)', async (_name, operate) => {
    const w = createWorld()
    expect(await w.coordinator.startEpisode('z')).toEqual({ ok: true })
    await w.coordinator.addToQueue(entry('a'))
    await w.coordinator.addToQueue(entry('c'))
    expect(await w.coordinator.skipToNext()).toEqual({ ok: true })
    await beginPlayback(w)
    expect(currentId(w)).toBe('a')
    w.saved.add('c')
    const heldC = w.holdGet('c')
    await endPlayback(w)

    operate(w)
    w.env.online = false
    expect(await w.coordinator.startEpisode('b')).toEqual({ ok: false, notice: 'offline_uncached' })
    heldC.resolve(w.cached('c'))
    await settle()

    expect(stateOf(w)).toEqual({ status: 'ended', id: 'a' })
    expect(currentId(w)).toBe('a')
    expect(upNextIds(w)[0]).toBe('c')
    await expectSharedInvariant(w)
  })
})

describe('古い自動の決着と新しい自動の待ちの重なり', () => {
  test('1 回目の自動の決着は 2 回目の自動の印を消さず、後の手動は a でなく b へ戻す (verifies: CI-T29, CI-T27, CI-T54, CI-T34; shared-session-17, shared-session-04)', async () => {
    const w = createWorld({ online: true })
    await playingWithQueue(w, 'a', 'c')
    w.env.online = false
    w.saved.add('c')
    w.saved.add('b')
    const firstAuto = w.holdGet('c')
    await endPlayback(w)

    expect(await w.coordinator.startEpisode('b')).toEqual({ ok: true })
    expect(upNextIds(w)).toEqual(['c'])
    await beginPlayback(w)
    expect(stateOf(w)).toEqual({ status: 'playing', id: 'b' })
    const secondAuto = w.holdGet('c')
    await endPlayback(w)
    expect(stateOf(w)).toEqual({ status: 'ended', id: 'b' })

    firstAuto.resolve(w.cached('c'))
    await settle()
    expect(startedIds(w)).toEqual(['a', 'b'])
    expect(w.releaseOf('c')).toHaveBeenCalledTimes(1)

    expect(await w.coordinator.startEpisode('d')).toEqual({ ok: false, notice: 'offline_uncached' })
    expect(stateOf(w)).toEqual({ status: 'ended', id: 'b' })
    expect(currentId(w)).toBe('b')

    secondAuto.resolve(w.cached('c'))
    await settle()
    expect(startedIds(w)).toEqual(['a', 'b'])
    expect(w.releaseOf('c')).toHaveBeenCalledTimes(2)
    expect(stateOf(w)).toEqual({ status: 'ended', id: 'b' })
    await expectSharedInvariant(w)
  })
})

describe('retry・自動の開始の待ち中のキュー操作', () => {
  test('自動の待ち中の playNext・addToQueue・reorder・remove の後でも、待ち明けは c を開始し current は c (verifies: CI-T55, CI-T29, CI-T34; shared-session-04, web-contract-09)', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'c', 'd')
    const heldC = w.holdFetch('c')
    await endPlayback(w)
    w.fetch.mockClear()

    expect(await w.coordinator.playNext(entry('x'))).toEqual({ ok: true })
    expect(await w.coordinator.addToQueue(entry('y'))).toEqual({ ok: true })
    w.coordinator.reorder(0, 3)
    w.coordinator.removeFromQueue('d')
    heldC.resolve(w.fetched('c'))
    await settle()

    expect(startedIds(w)).toEqual(['a', 'c'])
    expect(currentId(w)).toBe('c')
    expect(upNextIds(w)).toEqual(['y', 'x'])
    expect(w.fetch).not.toHaveBeenCalled()
    await expectSharedInvariant(w)
  })

  test('retry の待ち中の playNext・addToQueue・reorder・remove(a) の後でも、待ち明けは b を開始し current は b (verifies: CI-T55, CI-T30, CI-T34; shared-session-02, shared-session-04, web-contract-09)', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'b', 'd')
    w.fetchFailures.add('b')
    await endPlayback(w)
    expect(stateOf(w)).toEqual({ status: 'errored', id: 'b' })
    w.fetchFailures.delete('b')
    const heldB = w.holdFetch('b')
    w.fetch.mockClear()

    const retrying = w.coordinator.retry()
    await settle()
    expect(await w.coordinator.playNext(entry('x'))).toEqual({ ok: true })
    expect(await w.coordinator.addToQueue(entry('y'))).toEqual({ ok: true })
    w.coordinator.reorder(0, 3)
    w.coordinator.removeFromQueue('a')
    heldB.resolve(w.fetched('b'))
    await retrying

    expect(startedIds(w)).toEqual(['a', 'b'])
    expect(currentId(w)).toBe('b')
    expect(upNextIds(w)).toEqual(['d', 'y', 'x'])
    expect(calledIds(w.fetch)).toEqual(['b'])
    await expectSharedInvariant(w)
  })
})

// ---------------------------------------------------------------------------
// query・購読
// ---------------------------------------------------------------------------

describe('query と subscribe', () => {
  test('query 5 つは現在の値を返し、状態も書く port も変えない (verifies: CI-T35, CI-T39; web-query-playback-01, web-query-playback-02, web-query-playback-03, web-query-playback-04, web-query-playback-05)', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'c')
    w.audio.fireTimeUpdate(7)
    w.positions.set(`${USER}:a`, record(42, T0))
    const stateBefore = w.session.state()
    w.write.mockClear()
    w.adopt.mockClear()
    w.flush.mockClear()

    const nowPlaying = {
      episodeId: 'a',
      title: 'Title a',
      difficulty: 'toeic_600',
      createdAt: '2026-01-01',
      durationSeconds: 100,
    }
    expect(w.coordinator.nowPlaying()).toEqual(nowPlaying)
    expect(w.coordinator.upNext()).toEqual([{ id: 'c', title: 'Title c' }])
    expect(w.coordinator.queueView()).toEqual({ nowPlaying, upNext: [{ id: 'c', title: 'Title c' }], canSkipNext: true })
    expect(w.coordinator.playbackView()).toEqual({
      status: 'playing',
      position: 7,
      duration: 100,
      speed: 1,
      primaryAction: 'pause',
      failure: null,
    })
    expect(w.coordinator.savedPosition('a', undefined)).toBe(42)
    expect(w.coordinator.savedPosition('zz', undefined)).toBeNull()

    expect(w.session.state()).toBe(stateBefore)
    expect(w.write).not.toHaveBeenCalled()
    expect(w.markSynced).not.toHaveBeenCalled()
    expect(w.adopt).not.toHaveBeenCalled()
    expect(w.flush).not.toHaveBeenCalled()
    await expectSharedInvariant(w)
  })

  test('savedPosition は記録の位置に末尾 2 秒窓を通し、0 より大きいときだけ値を返す。主体が無ければ null（書かない）', () => {
    const w = createWorld()
    w.positions.set(`${USER}:a`, record(42, T0))
    w.positions.set(`${USER}:near-end`, record(299, T0))
    w.positions.set(`${USER}:zero`, record(0, T0))

    expect(w.coordinator.savedPosition('a', 100)).toBe(42)
    expect(w.coordinator.savedPosition('near-end', 300)).toBeNull()
    expect(w.coordinator.savedPosition('near-end', undefined)).toBe(299)
    expect(w.coordinator.savedPosition('zero', 300)).toBeNull()

    w.env.recording = null
    expect(w.coordinator.savedPosition('a', 100)).toBeNull()
    expect(w.write).not.toHaveBeenCalled()
    expect(w.adopt).not.toHaveBeenCalled()
  })

  test('購読者はキューの変化と session の事象で引数なしに呼ばれ、解除後は呼ばれない (verifies: CI-T36; web-deriv-05)', async () => {
    const w = createWorld()
    await startPlaying(w, 'a')
    const listener = vi.fn()
    const unsubscribe = w.coordinator.subscribe(listener)

    await w.coordinator.addToQueue(entry('c'))
    expect(listener).toHaveBeenCalled()
    expect(listener).toHaveBeenCalledWith()

    listener.mockClear()
    w.audio.fireTimeUpdate(5)
    expect(listener).toHaveBeenCalled()

    unsubscribe()
    listener.mockClear()
    await w.coordinator.addToQueue(entry('d'))
    w.audio.fireTimeUpdate(6)
    expect(listener).not.toHaveBeenCalled()
    await expectSharedInvariant(w)
  })
})

// ---------------------------------------------------------------------------
// 開始の後の再生 (web-dec-40): 開始した回が paused に移ったら Coordinator が play() を 1 回呼ぶ
// ---------------------------------------------------------------------------

describe('開始の後の自動再生', () => {
  const routes: ReadonlyArray<readonly [string, (w: World) => Promise<void>]> = [
    ['startEpisode', async (w) => void (await w.coordinator.startEpisode('a'))],
    ['addToQueue (空のキュー)', async (w) => void (await w.coordinator.addToQueue(entry('a')))],
    ['playNext (空のキュー)', async (w) => void (await w.coordinator.playNext(entry('a')))],
    [
      'skipToNext',
      async (w) => {
        await playingWithQueue(w, 'z', 'a')
        w.play.mockClear()
        await w.coordinator.skipToNext()
      },
    ],
    [
      '自動の次へ送り',
      async (w) => {
        await playingWithQueue(w, 'z', 'a')
        w.play.mockClear()
        await endPlayback(w)
      },
    ],
    [
      'retry',
      async (w) => {
        await playingWithQueue(w, 'z', 'a')
        w.fetchFailures.add('a')
        await endPlayback(w)
        expect(stateOf(w)).toEqual({ status: 'errored', id: 'a' })
        w.fetchFailures.delete('a')
        w.play.mockClear()
        await w.coordinator.retry()
      },
    ],
  ]

  test.each(routes)(
    '%s のどの経路でも、loadedmetadata の後に play が 1 回呼ばれて playing になる。テストは手で play() を呼ばない (verifies: CI-P4-01; web-dec-40, T-P4-01)',
    async (_name, start) => {
      const w = createWorld()
      await start(w)
      expect(stateOf(w).status).toBe('loading')

      w.audio.fireLoadedMetadata(100)
      await settle()

      expect(w.play).toHaveBeenCalledTimes(1)
      expect(stateOf(w)).toEqual({ status: 'playing', id: 'a' })
      await expectSharedInvariant(w)
    },
  )

  test('一度 playing になった回で利用者が pause・seek しても、Coordinator は play を呼ばず paused のまま (verifies: CI-P4-02; web-dec-40, T-P4-02)', async () => {
    const w = createWorld()
    await startPlaying(w, 'a')
    expect(stateOf(w).status).toBe('playing')
    expect(w.play).toHaveBeenCalledTimes(1)

    w.session.pause()
    w.session.seek(10)
    await settle()

    expect(w.play).toHaveBeenCalledTimes(1)
    expect(stateOf(w)).toEqual({ status: 'paused', id: 'a' })
    await expectSharedInvariant(w)
  })

  test('置き換えられた開始では play を呼ばず、新しい開始だけが loadedmetadata の後に 1 回呼ぶ (verifies: CI-P4-03; web-dec-40, T-P4-03)', async () => {
    const w = createWorld()
    expect(await w.coordinator.startEpisode('a')).toEqual({ ok: true })
    expect(await w.coordinator.startEpisode('b')).toEqual({ ok: true })
    expect(w.play).not.toHaveBeenCalled()

    w.audio.fireLoadedMetadata(100)
    await settle()

    expect(w.play).toHaveBeenCalledTimes(1)
    expect(stateOf(w)).toEqual({ status: 'playing', id: 'b' })
    await expectSharedInvariant(w)
  })

  test('loading が音声の error で errored になった開始では play を呼ばない (verifies: CI-P4-03; web-dec-40, T-P4-03)', async () => {
    const w = createWorld()
    expect(await w.coordinator.startEpisode('a')).toEqual({ ok: true })

    w.audio.fireError()
    await settle()
    w.audio.fireLoadedMetadata(100)
    await settle()

    expect(w.play).not.toHaveBeenCalled()
    expect(stateOf(w)).toEqual({ status: 'errored', id: 'a' })
    const state = w.session.state()
    expect(state.status === 'errored' && state.reason.kind).toBe('media')
  })

  test('loading の間に stop (idle) になった開始では、その後の loadedmetadata でも play を呼ばない (verifies: CI-P4-03; web-dec-40, T-P4-03)', async () => {
    const w = createWorld()
    expect(await w.coordinator.startEpisode('a')).toEqual({ ok: true })

    w.session.stop()
    w.audio.fireLoadedMetadata(100)
    await settle()

    expect(w.play).not.toHaveBeenCalled()
    expect(stateOf(w)).toEqual({ status: 'idle', id: null })
  })

  test('loading の間に fail (errored) になった開始では play を呼ばない (verifies: CI-P4-03; web-dec-40, T-P4-03)', async () => {
    const w = createWorld()
    expect(await w.coordinator.startEpisode('a')).toEqual({ ok: true })

    w.session.fail({ id: 'a' }, { kind: 'source_unavailable' })
    w.audio.fireLoadedMetadata(100)
    await settle()

    expect(w.play).not.toHaveBeenCalled()
    expect(stateOf(w)).toEqual({ status: 'errored', id: 'a' })
  })

  test('loading 中の setSpeed (loading → loading) では待ちが解けず、loadedmetadata で play が 1 回呼ばれ、速度は setSpeed の値 (verifies: CI-P4-04; web-dec-40, T-P4-04)', async () => {
    const w = createWorld()
    expect(await w.coordinator.startEpisode('a')).toEqual({ ok: true })

    w.session.setSpeed(1.5)
    expect(stateOf(w).status).toBe('loading')
    expect(w.play).not.toHaveBeenCalled()
    w.audio.fireLoadedMetadata(100)
    await settle()

    expect(w.play).toHaveBeenCalledTimes(1)
    expect(stateOf(w)).toEqual({ status: 'playing', id: 'a' })
    expect(w.coordinator.playbackView().speed).toBe(1.5)
  })

  test.each([
    { name: 'NotAllowedError', rejection: new DOMException('', 'NotAllowedError'), kind: 'autoplay_blocked' },
    { name: 'それ以外の Error', rejection: new Error('x'), kind: 'media' },
  ])('play() が $name で reject されると reason は $kind になり、failure は media・主操作は retry で、fail は呼ばない (verifies: CI-P4-05; web-dec-41, T-P4-05)', async ({ rejection, kind }) => {
    const w = createWorld()
    vi.spyOn(w.audio, 'play').mockRejectedValueOnce(rejection)
    expect(await w.coordinator.startEpisode('a')).toEqual({ ok: true })

    w.audio.fireLoadedMetadata(100)
    await settle()

    const state = w.session.state()
    expect(state.status).toBe('errored')
    expect(state.status === 'errored' && state.reason.kind).toBe(kind)
    expect(w.coordinator.playbackView()).toMatchObject({ failure: 'media', primaryAction: 'retry' })
    expect(w.fail).not.toHaveBeenCalled()
  })

  test('自動で再生に進めても位置の送信は増えない (verifies: CI-P4-06; shared-session-05, T-P4-06)', async () => {
    const w = createWorld()
    expect(await w.coordinator.startEpisode('a')).toEqual({ ok: true })

    w.audio.fireLoadedMetadata(100)
    await settle()

    expect(stateOf(w).status).toBe('playing')
    expect(w.flush).not.toHaveBeenCalled()
  })

  test('loadedmetadata から入れ子で通知されるとき、Coordinator の購読者が最後に読む playbackView().status は playing (verifies: CI-P4-07; web-dec-40, T-P4-07)', async () => {
    const w = createWorld()
    const observed: string[] = []
    w.coordinator.subscribe(() => {
      observed.push(w.coordinator.playbackView().status)
    })
    expect(await w.coordinator.startEpisode('a')).toEqual({ ok: true })

    w.audio.fireLoadedMetadata(100)
    await settle()

    expect(observed.at(-1)).toBe('playing')
  })
})

describe('stopForSubjectLeave（web-cmd-playback-09・web-deriv-30）', () => {
  test('shared-leave-01: 再生中に呼ぶと session は idle・Queue は空・nowPlaying は null・購読者に通知・戻り値は undefined で、位置も完聴も送らない', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'b', 'c')
    w.audio.fireTimeUpdate(7)
    w.flush.mockClear()
    w.write.mockClear()
    const notifiedBefore = w.notified.mock.calls.length

    const result = w.coordinator.stopForSubjectLeave()

    expect(result).toBeUndefined()
    expect(stateOf(w)).toEqual({ status: 'idle', id: null })
    expect(upNextIds(w)).toEqual([])
    expect(w.coordinator.nowPlaying()).toBeNull()
    expect(w.notified.mock.calls.length).toBeGreaterThan(notifiedBefore)
    expect(w.flush).not.toHaveBeenCalled()
    expect(w.markCompleted).not.toHaveBeenCalled()
    expect(w.write).not.toHaveBeenCalled()
    await expectSharedInvariant(w)
  })

  test('web-dec-72: 自動の開始の待ち中に呼ぶと advance を戻さず Queue は空のまま、待ち明けの解決は 1 回だけ解放されて開始されない', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'b', 'c')
    w.saved.add('b')
    const heldB = w.holdGet('b')
    await endPlayback(w)
    w.flush.mockClear()
    w.write.mockClear()
    w.markCompleted.mockClear()

    w.coordinator.stopForSubjectLeave()
    heldB.resolve(w.cached('b'))
    await settle()

    expect(upNextIds(w)).toEqual([])
    expect(w.coordinator.nowPlaying()).toBeNull()
    expect(stateOf(w)).toEqual({ status: 'idle', id: null })
    expect(startedIds(w)).toEqual(['a'])
    expect(w.releaseOf('b')).toHaveBeenCalledTimes(1)
    expect(w.flush).not.toHaveBeenCalled()
    expect(w.write).not.toHaveBeenCalled()
    expect(w.markCompleted).not.toHaveBeenCalled()
    await expectSharedInvariant(w)
  })

  test('web-dec-72: 利用者の開始の待ち中に呼ぶと、待ち明けの b は始まらず session は idle のまま、b の音源は 1 回だけ解放される', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a')
    w.saved.add('b')
    const heldB = w.holdGet('b')
    const starting = w.coordinator.startEpisode('b')
    await settle()

    w.coordinator.stopForSubjectLeave()
    heldB.resolve(w.cached('b'))
    await starting
    await settle()

    expect(stateOf(w)).toEqual({ status: 'idle', id: null })
    expect(startedIds(w)).toEqual(['a'])
    expect(w.coordinator.nowPlaying()).toBeNull()
    expect(upNextIds(w)).toEqual([])
    expect(w.releaseOf('b')).toHaveBeenCalledTimes(1)
  })

  test('shared-leave-07: 停止の後に別の episode を再生して一時停止すると、その位置だけが送られ、停止前の a の位置・完聴は 1 回も送られない', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'b')
    w.audio.fireTimeUpdate(7)
    w.coordinator.stopForSubjectLeave()
    w.flush.mockClear()
    w.write.mockClear()
    w.markCompleted.mockClear()

    await startPlaying(w, 'd')
    w.audio.fireTimeUpdate(30)
    w.session.pause()

    expect(w.write).toHaveBeenCalledTimes(1)
    expect(w.write).toHaveBeenCalledWith(USER, 'd', { positionSeconds: 30, recordedAt: T0, synced: false })
    expect(w.flush).toHaveBeenCalledTimes(1)
    expect(writtenIds(w)).not.toContain('a')
    expect(w.markCompleted).not.toHaveBeenCalled()
  })

  test('web-cmd-playback-09: 2 回呼んでも idle・空のままで、送信は 0 回', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'b')
    w.audio.fireTimeUpdate(7)
    w.flush.mockClear()
    w.write.mockClear()

    w.coordinator.stopForSubjectLeave()
    w.coordinator.stopForSubjectLeave()

    expect(stateOf(w)).toEqual({ status: 'idle', id: null })
    expect(upNextIds(w)).toEqual([])
    expect(w.flush).not.toHaveBeenCalled()
    expect(w.write).not.toHaveBeenCalled()
    expect(w.markCompleted).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 再開時の確認（ADR-109 決定 11・12）
// ---------------------------------------------------------------------------

/** id を総時間 duration で読み込み、自動再生の後、位置 position で一時停止する。 */
async function pauseAt(w: World, id: string, position: number, duration = 600): Promise<void> {
  expect(await w.coordinator.startEpisode(id)).toEqual({ ok: true })
  w.audio.fireLoadedMetadata(duration)
  await settle()
  w.audio.fireTimeUpdate(position)
  w.session.pause()
  expect(stateOf(w)).toEqual({ status: 'paused', id })
}

const advise = (w: World, id: string, positionSeconds: number): void => {
  w.advice.set(id, { positionSeconds, recordedAt: T1 })
}

/** a を位置 100 で一時停止し、別の端末の位置 remote を控える。 */
async function pausedWithRemote(w: World, remote = 500): Promise<void> {
  await pauseAt(w, 'a', 100)
  advise(w, 'a', remote)
}

/** 確認を出した状態（choose を返した後）。 */
async function asked(w: World, remote = 500): Promise<void> {
  await pausedWithRemote(w, remote)
  expect(w.coordinator.requestResume()).toEqual({ kind: 'choose', remoteSeconds: remote, localSeconds: 100 })
}

const CHOICES = ['remote', 'local'] as const

describe('requestResume・chooseResume（ADR-109 決定 11・12 / shared-sync-10〜15）', () => {
  test('shared-sync-10 / ADR-109 決定 11: requestResume は条件がすべてそろったときだけ choose を返し、session.play を呼ばない', async () => {
    const w = createWorld()
    await pausedWithRemote(w)
    w.play.mockClear()

    const result = w.coordinator.requestResume()

    expect(result).toEqual({ kind: 'choose', remoteSeconds: 500, localSeconds: 100 })
    expect(Object.isFrozen(result)).toBe(true)
    expect(w.coordinator.requestResume()).not.toBe(result)
    expect(w.play).not.toHaveBeenCalled()
    expect(stateOf(w)).toEqual({ status: 'paused', id: 'a' })
    expect(w.advice.has('a')).toBe(true)
  })

  test.each<[string, (w: World) => Promise<void>, boolean]>([
    [
      '前面でない',
      async (w) => {
        await pausedWithRemote(w)
        w.env.foreground = false
      },
      false,
    ],
    ['控えが無い', async (w) => pauseAt(w, 'a', 100), false],
    ['差が 15 秒未満 (114.99)', async (w) => pausedWithRemote(w, 114.99), false],
    [
      'playing',
      async (w) => {
        await pausedWithRemote(w)
        await w.session.play()
      },
      true,
    ],
    [
      'ended',
      async (w) => {
        await pausedWithRemote(w)
        await w.session.play()
        await endPlayback(w)
      },
      true,
    ],
  ])('shared-sync-10: 前面でない・控え無し・15 秒未満・paused でないときは尋ねず再生する (%s)', async (_name, arrange, notPaused) => {
    const w = createWorld()
    await arrange(w)
    expect(stateOf(w).status === 'paused').toBe(!notPaused)
    w.play.mockClear()
    w.advisorCalls.clear.mockClear()

    const result = w.coordinator.requestResume()

    expect(result).toEqual({ kind: 'resumed' })
    expect(w.play).toHaveBeenCalledTimes(notPaused ? 0 : 1)
    // 尋ねずに再生したときは控えを消す。paused でないときは控えに触らない。
    if (notPaused) expect(w.advisorCalls.clear).not.toHaveBeenCalled()
    else expect(w.advice.has('a')).toBe(false)
  })

  test.each<[string, number, 'choose' | 'resumed']>([
    ['差 15 秒ちょうど (115)', 115, 'choose'],
    ['差 14.99 (114.99)', 114.99, 'resumed'],
  ])('shared-sync-10: %s', async (_name, remote, kind) => {
    const w = createWorld()
    await pausedWithRemote(w, remote)

    expect(w.coordinator.requestResume().kind).toBe(kind)
  })

  test.each<[string, number, number]>([
    ['窓の外の 500 はその位置', 500, 500],
    ['末尾 2 秒窓の中の 598 は 0', 598, 0],
  ])("shared-sync-12: chooseResume('remote') は resolveResumePosition（末尾 2 秒窓）を通した位置へ seek した後に play し、控えが消える（%s）", async (_name, remote, expectedSeek) => {
    const w = createWorld()
    await asked(w, remote)
    w.seek.mockClear()
    w.play.mockClear()
    w.write.mockClear()

    w.coordinator.chooseResume('remote')

    expect(w.seek).toHaveBeenCalledTimes(1)
    expect(w.seek).toHaveBeenCalledWith(expectedSeek)
    expect(w.play).toHaveBeenCalledTimes(1)
    expect(w.seek.mock.invocationCallOrder[0]).toBeLessThan(w.play.mock.invocationCallOrder[0])
    expect(w.resumeAdvisor.pending('a')).toBeNull()
    expect(w.write).not.toHaveBeenCalled()
    expect(stateOf(w)).toEqual({ status: 'playing', id: 'a' })
  })

  test('shared-sync-12: state の duration が 0 のときは episode の durationSeconds を総時間に使う', async () => {
    const w = createWorld()
    await pauseAt(w, 'a', 10, 0)
    advise(w, 'a', 99)
    expect(w.coordinator.requestResume()).toEqual({ kind: 'choose', remoteSeconds: 99, localSeconds: 10 })
    w.seek.mockClear()

    w.coordinator.chooseResume('remote')

    expect(w.seek).toHaveBeenCalledTimes(1)
    expect(w.seek).toHaveBeenCalledWith(0)
  })

  test("shared-sync-13: chooseResume('local') は seek せず play の後に recordCurrent を呼び、控えが消える", async () => {
    const w = createWorld()
    await asked(w)
    w.seek.mockClear()
    w.play.mockClear()
    const before = w.write.mock.calls.length

    w.coordinator.chooseResume('local')

    expect(w.write.mock.calls.length - before).toBe(1)
    expect(w.write).toHaveBeenCalledWith(USER, 'a', { positionSeconds: 100, recordedAt: T0, synced: false })
    expect(w.seek).not.toHaveBeenCalled()
    expect(w.play).toHaveBeenCalledTimes(1)
    expect(w.play.mock.invocationCallOrder[0]).toBeLessThan(w.write.mock.invocationCallOrder.at(-1)!)
    expect(w.resumeAdvisor.pending('a')).toBeNull()
    expect(stateOf(w)).toEqual({ status: 'playing', id: 'a' })
  })

  test('shared-sync-12: 閉じるでは何も呼ばず paused のまま・次の再生ボタンでまた尋ねる', async () => {
    const w = createWorld()
    await pausedWithRemote(w)
    const first = w.coordinator.requestResume()
    expect(first.kind).toBe('choose')
    w.seek.mockClear()
    w.play.mockClear()
    w.write.mockClear()

    // 閉じるための command は無い。何もしない。
    expect(stateOf(w)).toEqual({ status: 'paused', id: 'a' })
    expect(w.play).not.toHaveBeenCalled()
    expect(w.seek).not.toHaveBeenCalled()
    expect(w.write).not.toHaveBeenCalled()
    expect(w.coordinator.requestResume()).toEqual(first)
  })

  test('web-dec-183: 確認の後に控えが置き換わっても、確認を出した時点の位置を適用する', async () => {
    const w = createWorld()
    await asked(w, 500)
    w.advice.set('a', { positionSeconds: 800, recordedAt: T2 })
    w.seek.mockClear()

    w.coordinator.chooseResume('remote')

    expect(w.seek).toHaveBeenCalledTimes(1)
    expect(w.seek).toHaveBeenCalledWith(500)
  })

  describe('shared-sync-15: 確認の保留中に再生が始まった後の chooseResume は何もしない', () => {
    const interruptions: ReadonlyArray<readonly [string, (w: World) => Promise<void>]> = [
      ['直接の session.play()', async (w) => void (await w.session.play())],
      [
        '保留した別 episode の startEpisode(b) の解決',
        async (w) => {
          const held = w.holdFetch('b')
          const starting = w.coordinator.startEpisode('b')
          await settle()
          held.resolve(w.fetched('b'))
          await starting
        },
      ],
      [
        'skipToNext',
        async (w) => {
          expect(await w.coordinator.addToQueue(entry('b'))).toEqual({ ok: true })
          await w.coordinator.skipToNext()
        },
      ],
      ['session.fail', async (w) => w.session.fail({ id: 'a' }, { kind: 'fetch_failed', failure: NETWORK_FAILURE })],
      ['stopForSubjectLeave', async (w) => w.coordinator.stopForSubjectLeave()],
    ]

    test.each(interruptions)('%s の後の chooseResume(remote)・(local) は seek・play・write を増やさない', async (_name, interrupt) => {
      const w = createWorld()
      await asked(w)
      await interrupt(w)
      await settle()
      const seeks = w.seek.mock.calls.length
      const plays = w.play.mock.calls.length
      const writes = w.write.mock.calls.length

      for (const choice of CHOICES) w.coordinator.chooseResume(choice)

      expect(w.seek.mock.calls.length - seeks).toBe(0)
      expect(w.play.mock.calls.length - plays).toBe(0)
      expect(w.write.mock.calls.length - writes).toBe(0)
    })
  })

  test('shared-sync-15: paused のまま同じ episode の通知（確認中の seek）では保留を消さない', async () => {
    const w = createWorld()
    await asked(w)
    w.session.seek(10)
    w.seek.mockClear()
    w.play.mockClear()

    w.coordinator.chooseResume('remote')

    expect(w.seek).toHaveBeenCalledTimes(1)
    expect(w.seek).toHaveBeenCalledWith(500)
    expect(w.play).toHaveBeenCalledTimes(1)
  })

  test('web-dec-182: stopForSubjectLeave は控えと確認の保留を空にする', async () => {
    const w = createWorld()
    await asked(w)
    advise(w, 'b', 300)
    w.advisorCalls.reset.mockClear()

    w.coordinator.stopForSubjectLeave()

    expect(w.advisorCalls.reset).toHaveBeenCalledTimes(1)
    expect(w.resumeAdvisor.pending('a')).toBeNull()
    expect(w.resumeAdvisor.pending('b')).toBeNull()
  })

  describe('shared-sync-11 / ADR-109 決定 12: 控えがあり差が 15 秒以上でも、startEpisode・retry・skipToNext・自動の次は尋ねず、新しい方の位置から開始する', () => {
    // a・b ともサーバーの位置は 120（端末の記録は無い）。どの入口でも開始位置は pickCandidate の 120。
    const withServerPositions = (w: World): void => {
      for (const id of ['a', 'b']) {
        w.catalog.set(id, playable(id, { durationSeconds: 300, serverPositionSeconds: 120, serverPositionRecordedAt: T1 }))
      }
    }
    const lastStart = (w: World): { id: string; resume: number } => {
      const call = w.start.mock.calls.at(-1)
      if (call === undefined) throw new Error('start が呼ばれていない')
      return { id: call[0].id, resume: call[1] }
    }

    const entries: ReadonlyArray<readonly [string, (w: World) => Promise<void>, string]> = [
      ['startEpisode', async (w) => void (await w.coordinator.startEpisode('b')), 'b'],
      [
        'retry',
        async (w) => {
          w.session.fail({ id: 'a' }, { kind: 'fetch_failed', failure: NETWORK_FAILURE })
          await w.coordinator.retry()
        },
        'a',
      ],
      [
        'skipToNext',
        async (w) => {
          expect(await w.coordinator.addToQueue(entry('b'))).toEqual({ ok: true })
          await w.coordinator.skipToNext()
        },
        'b',
      ],
      [
        '自動の次',
        async (w) => {
          expect(await w.coordinator.addToQueue(entry('b'))).toEqual({ ok: true })
          await w.session.play()
          await endPlayback(w)
        },
        'b',
      ],
    ]

    test.each(entries)('%s は pending を読まず、新しい方の位置から開始する', async (_name, enter, expectedId) => {
      const w = createWorld()
      withServerPositions(w)
      await pausedWithRemote(w)
      w.advisorCalls.pending.mockClear()

      await enter(w)
      await settle()

      expect(w.advisorCalls.pending).not.toHaveBeenCalled()
      expect(lastStart(w)).toEqual({ id: expectedId, resume: 120 })

      // 正方向の対照: 同じ構成で requestResume は choose を返す（pending を読む）。
      const control = createWorld()
      withServerPositions(control)
      await pausedWithRemote(control)
      expect(control.coordinator.requestResume().kind).toBe('choose')
      expect(control.advisorCalls.pending).toHaveBeenCalled()
    })
  })

  test('shared-sync-10: chooseResume の連打は 1 回目だけ動く', async () => {
    const w = createWorld()
    await asked(w)
    w.seek.mockClear()
    w.play.mockClear()

    w.coordinator.chooseResume('remote')
    w.coordinator.chooseResume('remote')

    expect(w.seek).toHaveBeenCalledTimes(1)
    expect(w.play).toHaveBeenCalledTimes(1)
  })

  describe('shared-sync-15 / web-dec-183: 確認の後に一度 paused を外れて同じ episode の paused に戻っても、閉じた確認の選択は何もしない', () => {
    const roundTrips: ReadonlyArray<readonly [string, (w: World) => Promise<void>]> = [
      [
        '(i) play → pause',
        async (w) => {
          await asked(w)
          await w.session.play()
          w.session.pause()
        },
      ],
      [
        '(ii) 保留した startEpisode(a) の解決 → 自動再生 → pause',
        async (w) => {
          await pausedWithRemote(w)
          const held = w.holdFetch('a')
          const starting = w.coordinator.startEpisode('a')
          await settle()
          expect(w.coordinator.requestResume()).toEqual({ kind: 'choose', remoteSeconds: 500, localSeconds: 100 })
          held.resolve(w.fetched('a'))
          await starting
          w.audio.fireLoadedMetadata(600)
          await settle()
          expect(stateOf(w)).toEqual({ status: 'playing', id: 'a' })
          w.session.pause()
        },
      ],
    ]

    test.each(roundTrips)('%s', async (_name, roundTrip) => {
      const w = createWorld()
      await roundTrip(w)
      expect(stateOf(w)).toEqual({ status: 'paused', id: 'a' })
      await settle()
      const seeks = w.seek.mock.calls.length
      const plays = w.play.mock.calls.length
      const writes = w.write.mock.calls.length

      for (const choice of CHOICES) w.coordinator.chooseResume(choice)

      expect(w.seek.mock.calls.length - seeks).toBe(0)
      expect(w.play.mock.calls.length - plays).toBe(0)
      expect(w.write.mock.calls.length - writes).toBe(0)
    })
  })
})
