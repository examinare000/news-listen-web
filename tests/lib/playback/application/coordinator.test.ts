// Coordinator の契約: 実 Session ＋ MockAudio ＋ 実 PositionReporter。外界（保存庫・取得・端末の位置・送信）は関数 double。
// 待ちは手製の deferred と Promise.resolve の繰り返しで進める。
// 全シナリオの決着後に共有仕様の shared-inv-01（session が idle でなければ、その episode の id が current の id）を検査する。
// RED 理由（実装前）: `@/lib/playback/application/coordinator` がまだ存在しない。
import { describe, expect, test, vi } from 'vitest'
import { createPlaybackCoordinator } from '@/lib/playback/application/coordinator'
import { createPositionReporter } from '@/lib/playback/application/positionReporter'
import type { EpisodeSource, LocalPositionStore, OfflineLibrary, PositionSync } from '@/lib/playback/application/ports'
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
  const session: PlaybackSession = { ...real, start, fail }

  const env = { online: options.online ?? true, speed: 1.0 as PlaybackSpeed }
  const saved = new Set<string>()
  const catalog = new Map<string, Episode>()
  const fetchFailures = new Set<string>()
  const nullGets = new Set<string>()
  const positions = new Map<string, number>()
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

  const updatePosition = vi.fn<PositionSync['updatePosition']>(() => Promise.resolve(OK_VOID))
  const markCompleted = vi.fn<PositionSync['markCompleted']>(() => Promise.resolve(OK_VOID))
  const read = vi.fn<LocalPositionStore['read']>((id) => positions.get(id) ?? null)
  const write = vi.fn<LocalPositionStore['write']>()
  const positionReporter = createPositionReporter({ sync: { updatePosition, markCompleted }, local: { read, write } })

  const coordinator = createPlaybackCoordinator({
    session,
    offline,
    positionReporter,
    episodes: { fetch },
    localPositions: { read, write },
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
    fetch,
    has,
    get,
    updatePosition,
    markCompleted,
    read,
    write,
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
  w.audio.fireLoadedMetadata(100)
  await w.session.play()
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

  test.each([
    ['server > 0 は端末の位置に勝つ', 120, 50, 120],
    ['server 0 なら端末の位置', 0, 50, 50],
    ['server 0・端末に無ければ 0', 0, null, 0],
    ['server が末尾 2 秒以内なら 0', 299, null, 0],
    ['端末の位置が末尾 2 秒以内でも 0', 0, 299, 0],
  ])('resume の合成: %s (verifies: CI-T26; web-rule-playback-05)', async (_name, server, local, expected) => {
    const w = createWorld()
    w.catalog.set('r', playable('r', { durationSeconds: 300, serverPositionSeconds: server }))
    if (local !== null) w.positions.set('r', local)

    await w.coordinator.startEpisode('r')

    expect(w.start).toHaveBeenCalledTimes(1)
    expect(w.start.mock.calls[0][1]).toBe(expected)
    await expectSharedInvariant(w)
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
    w.updatePosition.mockReturnValue(new Promise(() => undefined))
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
  test('b が再生可能なら a の位置を 1 回送り、完聴を送らずに b を開始する (verifies: CI-T31; shared-session-14)', async () => {
    const w = createWorld()
    await playingWithQueue(w, 'a', 'b')
    w.audio.fireTimeUpdate(7)

    expect(await w.coordinator.skipToNext()).toEqual({ ok: true })

    expect(w.updatePosition).toHaveBeenCalledTimes(1)
    expect(w.updatePosition).toHaveBeenCalledWith('a', 7)
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
    expect(w.updatePosition).not.toHaveBeenCalled()
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
    w.positions.set('a', 42)
    const stateBefore = w.session.state()
    w.write.mockClear()
    w.updatePosition.mockClear()

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
    expect(w.coordinator.savedPosition('a')).toBe(42)
    expect(w.coordinator.savedPosition('zz')).toBeNull()

    expect(w.session.state()).toBe(stateBefore)
    expect(w.write).not.toHaveBeenCalled()
    expect(w.updatePosition).not.toHaveBeenCalled()
    await expectSharedInvariant(w)
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
