// @vitest-environment node
// Queue と Session の不変性（TA-V6 の観点 4 (a)〜(d)）。外へ渡す値と外から受けた値を凍結した写しにする。
// 正本: docs/design/modules/web/2026-09-30-implementation-spec-target-architecture.md §7 TA-V6、§5.0（生成関数は入力を複製して深く凍結する）。
// 観点 1〜3 の一般形と 4 (e) は W-S2a2（リードモデル）の範囲。本テストは state() の同一参照（既存テスト）を変えない。
//
// RED 理由（実装前）: `@/lib/playback/domain/*` が無い（module not found）。移した後も、返す値が凍結されていない・
// 受けた値の写しを作らないので落ちる。
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  add,
  advance,
  current,
  emptyQueue,
  jump,
  moveUpNext,
  playNext,
  remove,
  setQueue,
  start,
  upNext,
} from '@/lib/playback/domain/queue'
import type { QueueState } from '@/lib/playback/domain/queue'
import { createPlaybackSession, isPlayableEpisode } from '@/lib/playback/domain/session'
import type { PlayableEpisode, PlaybackEvent, PlaybackSession, PlaybackState } from '@/lib/playback/domain/session'
import type { Podcast } from '@/types'
import { MockAudio } from '../helpers/mockAudio'

// ---------------------------------------------------------------------------
// 深い凍結の検査 helper: plain object と配列をすべての深さで辿り、凍結済みの node でも再帰を止めない。
// 飛ばすのは key `audioHandle` の値だけ（解放の操作だけを持つ不透明な値は凍結の対象にしない）。
// ---------------------------------------------------------------------------
const isPlain = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function unfrozenNodes(value: unknown, where = '$'): string[] {
  const found: string[] = []
  if (Array.isArray(value)) {
    if (!Object.isFrozen(value)) found.push(where)
    ;(value as unknown[]).forEach((item, index) => found.push(...unfrozenNodes(item, `${where}[${index}]`)))
  } else if (isPlain(value)) {
    if (!Object.isFrozen(value)) found.push(where)
    for (const [key, child] of Object.entries(value)) {
      if (key === 'audioHandle') continue
      found.push(...unfrozenNodes(child, `${where}.${key}`))
    }
  }
  return found
}

function expectDeeplyFrozen(label: string, value: unknown): void {
  expect(unfrozenNodes(value, label), `${label} に凍結されていない node がある`).toEqual([])
}

describe('TA-V6 helper の自己点検: 深い凍結の判定', () => {
  test('完全に凍結した値は 0 件、凍結していない node は path つきで拾う', () => {
    expect(unfrozenNodes(Object.freeze({ a: Object.freeze([Object.freeze({ b: 1 })]) }))).toEqual([])
    expect(unfrozenNodes({ a: 1 })).toEqual(['$'])
  })

  test('浅く凍結して入れ子が可変な値を「凍結されていない」と判定する（凍結済みの node でも再帰を止めない）', () => {
    const shallow = Object.freeze({ id: 'a', segments: [{ speaker: 's', text: 't' }] })
    expect(unfrozenNodes(shallow)).toEqual(['$.segments', '$.segments[0]'])
    const frozenArrayWithMutableItem = Object.freeze([{ x: 1 }])
    expect(unfrozenNodes(frozenArrayWithMutableItem)).toEqual(['$[0]'])
  })

  test('key audioHandle の値だけを飛ばす', () => {
    const handle = { release: vi.fn() }
    expect(unfrozenNodes(Object.freeze({ audioHandle: handle, other: { n: 1 } }))).toEqual(['$.other'])
  })
})

// ---------------------------------------------------------------------------
// fixture: 入れ子の配列を持つ要素（凍結されていないもの・浅く凍結したもの）
// ---------------------------------------------------------------------------
function pod(id: string): Podcast {
  return {
    id,
    type: 'single',
    article_ids: [`art-${id}`],
    difficulty: 'toeic_900',
    audio_url: `https://example.com/${id}.wav`,
    title: `title ${id}`,
    japanese_intro_text: `intro ${id}`,
    segments: [{ speaker: 'A', text: `hello ${id}` }],
    vocabulary: [{ term: 'term', meaning_ja: '語', example: 'ex' }],
    quiz: [{ question: 'q?', options: ['a', 'b'] }],
    source_articles: [{ article_id: `art-${id}`, title: 't', url: 'https://example.com', source: 's' }],
    source_kind: 'featured',
    duration_seconds: 120,
    created_at: '2026-05-31T06:00:00Z',
    status: 'completed',
    error_message: null,
    playback_position_seconds: 0,
  }
}

const shallowFrozen = (id: string): Podcast => Object.freeze(pod(id))

const ids = (q: { items: ReadonlyArray<Podcast> }): string[] => q.items.map((p) => p.id)

const VARIANTS: ReadonlyArray<readonly [string, (id: string) => Podcast]> = [
  ['凍結されていない要素', pod],
  ['浅く凍結した要素', shallowFrozen],
]

/** 手で組んだ凍結されていない状態（不変条件は満たす）。 */
function handBuilt(items: Podcast[], currentIndex: number | null): QueueState<Podcast> {
  return { items, currentIndex }
}

// ---------------------------------------------------------------------------
// TA-V6 4(a): 戻り値の凍結
// ---------------------------------------------------------------------------
describe('TA-V6 4(a) Queue の 11 操作の全戻り値は深く凍結済み', () => {
  test.each(VARIANTS)('emptyQueue から到達した状態（%s）: 状態・items・各要素（入れ子の全深さ）と、upNext の配列・jump/advance の結果と next', (_name, make) => {
    const q = setQueue([make('a'), make('b'), make('c')], 1)
    expectDeeplyFrozen('setQueue', q)

    const results: Array<[string, unknown]> = [
      ['emptyQueue', emptyQueue],
      ['setQueue(空)', setQueue([], 0)],
      ['start', start(emptyQueue, make('s'))],
      ['add(変える)', add(q, make('d'))],
      ['add(重複 = no-op)', add(q, make('a'))],
      ['playNext(変える)', playNext(q, make('e'))],
      ['playNext(現在 id = no-op)', playNext(q, make('b'))],
      ['jump(found)', jump(q, 'a')],
      ['jump(not found)', jump(q, 'zzz')],
      ['advance(次あり)', advance(q)],
      ['advance(末尾)', advance(advance(q).queue)],
      ['advance(空)', advance(emptyQueue)],
      ['remove(削除あり)', remove(q, 'a')],
      ['remove(not found)', remove(q, 'zzz')],
      ['moveUpNext(範囲内)', moveUpNext(setQueue([make('a'), make('b'), make('c')], 0), 0, 2)],
      ['moveUpNext(範囲外 = no-op)', moveUpNext(q, 9, 0)],
      ['current', current(q)],
      ['upNext', upNext(q)],
      ['upNext(再生前)', upNext(setQueue([make('a'), make('b')], 0))],
    ]
    for (const [label, value] of results) expectDeeplyFrozen(label, value)
    // 非縮退性: 現在の要素と待機の要素が実際に返っている（空の戻り値だけで通らない）
    expect(current(q)?.id).toBe('b')
    expect(upNext(q).map((p) => p.id)).toEqual(['c'])
    expect(current(q)?.segments).toHaveLength(1)
  })

  test('手で組んだ凍結されていない状態を操作に渡しても、新しく作られた状態の要素と next は凍結済みで、呼出側の podA・podB とは !== （podA・podB は凍結されない）', () => {
    const podA = pod('a')
    const podB = pod('b')
    const hand = handBuilt([podA, podB], 0)

    const advanced = advance(hand)
    expect(advanced.next?.id).toBe('b')
    expectDeeplyFrozen('advance().next', advanced.next)
    expectDeeplyFrozen('advance().queue', advanced.queue)
    expect(advanced.next).not.toBe(podB)
    advanced.queue.items.forEach((item) => expect([podA, podB]).not.toContain(item))

    const jumped = jump(hand, 'b')
    expect(jumped.found).toBe(true)
    expectDeeplyFrozen('jump().queue', jumped.queue)
    jumped.queue.items.forEach((item) => expect([podA, podB]).not.toContain(item))

    const removed = remove(hand, 'a')
    expect(ids(removed)).toEqual(['b'])
    expectDeeplyFrozen('remove', removed)
    expect(removed.items[0]).not.toBe(podB)

    const moved = moveUpNext(handBuilt([podA, podB, pod('c')], 0), 0, 2)
    expect(ids(moved)).toEqual(['a', 'c', 'b'])
    expectDeeplyFrozen('moveUpNext', moved)

    const added = add(hand, pod('c'))
    expectDeeplyFrozen('add', added)
    added.items.forEach((item) => expect([podA, podB]).not.toContain(item))

    const next = playNext(hand, pod('d'))
    expect(ids(next)).toEqual(['a', 'd', 'b'])
    expectDeeplyFrozen('playNext', next)
    next.items.forEach((item) => expect([podA, podB]).not.toContain(item))

    const cur = current(hand)
    expect(cur?.id).toBe('a')
    expectDeeplyFrozen('current', cur)
    expect(cur).not.toBe(podA)
    const up = upNext(hand)
    expectDeeplyFrozen('upNext', up)
    expect(up[0]).not.toBe(podB)

    // 呼出側の object は凍結しない・書き換えない
    for (const original of [podA, podB]) {
      expect(Object.isFrozen(original)).toBe(false)
      expect(Object.isFrozen(original.segments)).toBe(false)
    }
  })

  test('no-op は入力の状態をそのまま返す（同一参照。手で組んだ状態でも）', () => {
    const hand = handBuilt([pod('a'), pod('b')], 0)
    expect(add(hand, pod('a'))).toBe(hand)
    expect(playNext(hand, pod('a'))).toBe(hand)
    expect(jump(hand, 'zzz').queue).toBe(hand)
    expect(remove(hand, 'zzz')).toBe(hand)
    expect(moveUpNext(hand, 5, 0)).toBe(hand)
    const last = handBuilt([pod('a')], 0)
    expect(advance(last).queue).toBe(last)
    expect(advance(last).next).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// TA-V6 4(b): 入力からの隔離
// ---------------------------------------------------------------------------
describe('TA-V6 4(b) 渡した配列・要素を後で書き換えても状態は変わらない', () => {
  test.each(VARIANTS)('setQueue（%s）: 入力の配列の push・要素の差し替え・要素の field と入れ子の書き換えが current・upNext に届かない', (_name, make) => {
    const input = [make('a'), make('b')]
    const q = setQueue(input, 0)
    const expectedCurrent = structuredClone(current(q))
    const expectedUpNext = structuredClone(upNext(q))

    input.push(make('c'))
    input[0] = make('z')
    input[1].segments?.push({ speaker: 'X', text: 'added' })
    input[1].article_ids.push('added')
    if (!Object.isFrozen(input[1])) (input[1] as { title?: string }).title = 'changed'

    expect(current(q)).toEqual(expectedCurrent)
    expect(upNext(q)).toEqual(expectedUpNext)
    expect(ids(q)).toEqual(['a', 'b'])
    // 渡した object・その入れ子とは別の object で、状態の側は凍結済み
    expect(q.items[1]).not.toBe(input[1])
    expect(q.items[1].segments).not.toBe(input[1].segments)
    expectDeeplyFrozen('q', q)
  })

  test('setQueue: prototype が null の要素と入れ子も、写しを深く凍結し、呼出側の値と参照を共有しない', () => {
    const nested = Object.assign(Object.create(null) as Record<string, unknown>, { speaker: 'X', text: 'original' })
    const element = Object.assign(Object.create(null) as Record<string, unknown>, { ...pod('a'), segments: [nested] })
    const q = setQueue([element as unknown as Podcast], 0)

    nested.text = 'changed'

    expectDeeplyFrozen('q', q)
    expect(q.items[0]).not.toBe(element)
    expect(q.items[0].segments?.[0]).not.toBe(nested)
    expect(q.items[0].segments?.[0]?.text).toBe('original')
  })

  test('凍結されていない入力の要素は Queue に凍結されない', () => {
    const input = [pod('a'), pod('b')]
    setQueue(input, 0)
    for (const el of input) {
      expect(Object.isFrozen(el)).toBe(false)
      expect(Object.isFrozen(el.segments)).toBe(false)
    }
  })

  test.each(VARIANTS)('start・add・playNext（%s）: 渡した要素の入れ子を書き換えても current・upNext に届かない', (_name, make) => {
    const el = make('x')
    const s = start(emptyQueue, el)
    const base = setQueue([pod('a')], 0)
    const added = add(base, make('y'))
    const addedEl = make('n')
    const played = playNext(setQueue([pod('a'), pod('b')], 0), addedEl)

    const beforeStart = structuredClone(current(s))
    const beforePlayed = structuredClone(upNext(played))
    el.segments?.push({ speaker: 'X', text: 'late' })
    addedEl.segments?.push({ speaker: 'X', text: 'late' })

    expect(current(s)).toEqual(beforeStart)
    expect(upNext(played)).toEqual(beforePlayed)
    expect(current(s)?.segments).toHaveLength(1)
    expect(current(s)).not.toBe(el)
    expect(current(s)?.segments).not.toBe(el.segments)
    expect(added.items[1]).not.toBeUndefined()
    expectDeeplyFrozen('start', s)
    expectDeeplyFrozen('add', added)
    expectDeeplyFrozen('playNext', played)
  })

  test('Queue が作った写しを別の状態に渡すと、新しい状態の末尾の要素はその写しと同じ参照（例外。深く凍結済みなので共有してよい）', () => {
    const q1 = setQueue([pod('a'), pod('b')], 0)
    const copy = current(q1)
    expect(copy).not.toBeNull()
    const q2 = setQueue([pod('x')], 0)
    const q3 = add(q2, copy!)
    expect(q3.items[q3.items.length - 1]).toBe(copy)
    expectDeeplyFrozen('q3', q3)
  })
})

// ---------------------------------------------------------------------------
// TA-V6 4(c): 新旧の分離と no-op の同一参照
// ---------------------------------------------------------------------------
describe('TA-V6 4(c) 状態を変える操作は新旧の items が別の配列で、no-op は同じ参照を返す', () => {
  test('jump(found)・advance(次あり)・add・playNext・remove・moveUpNext・setQueue・start は入力と別の items を返し、入力は変わらない', () => {
    const q = setQueue([pod('a'), pod('b'), pod('c')], 0)
    const beforeIds = ids(q)
    const changed: Array<[string, QueueState<Podcast>]> = [
      ['jump(found)', jump(q, 'b').queue],
      ['advance(次あり)', advance(q).queue],
      ['add', add(q, pod('d'))],
      ['playNext', playNext(q, pod('d'))],
      ['remove', remove(q, 'b')],
      ['moveUpNext', moveUpNext(q, 0, 2)],
    ]
    for (const [label, next] of changed) {
      expect(next.items, `${label} の items が入力と同じ配列`).not.toBe(q.items)
    }
    expect(setQueue([pod('a')], 0).items).not.toBe(q.items)
    expect(start(q, pod('s')).items).not.toBe(q.items)
    expect(ids(q)).toEqual(beforeIds)
  })

  test('no-op（add の重複・playNext の現在 id・jump の not found・advance の末尾と空・remove の not found・moveUpNext の範囲外）は新しい object を返さない', () => {
    const q = setQueue([pod('a'), pod('b')], 1)
    expect(add(q, pod('a'))).toBe(q)
    expect(playNext(q, pod('b'))).toBe(q)
    expect(jump(q, 'zzz').queue).toBe(q)
    expect(advance(q).queue).toBe(q)
    expect(advance(emptyQueue).queue).toBe(emptyQueue)
    expect(remove(q, 'zzz')).toBe(q)
    expect(moveUpNext(q, 0, 0)).toBe(q)
  })
})

// ---------------------------------------------------------------------------
// TA-V6 4(d): Session
// ---------------------------------------------------------------------------
type MutableEpisode = { -readonly [K in keyof PlayableEpisode]: PlayableEpisode[K] }

function makeEpisode(id: string): MutableEpisode {
  return {
    id,
    title: `title ${id}`,
    audioUrl: `https://example.com/${id}.mp3`,
    durationSeconds: 600,
    difficulty: 'toeic_600',
    createdAt: '2026-05-31T06:00:00Z',
    serverPositionSeconds: 0,
    transcript: [{ speaker: 'A', text: `hello ${id}` }],
    vocabulary: [{ term: 'term', meaning_ja: '語', example: 'ex' }],
    quiz: [{ question: 'q?', options: ['a', 'b'] }],
    sources: [{ article_id: `art-${id}`, title: 't', url: 'https://example.com', source: 's' }],
    sourceKind: 'featured',
    audioHandle: { release: vi.fn() },
  }
}

const episodeOf = (state: PlaybackState): PlayableEpisode | undefined =>
  state.status === 'idle' || !isPlayableEpisode(state.episode) ? undefined : state.episode

let audio: MockAudio
let session: PlaybackSession
let events: PlaybackEvent[]

beforeEach(() => {
  audio = new MockAudio()
  session = createPlaybackSession(audio)
  events = []
  session.subscribe((e) => events.push(e))
})

const stateEvents = (from: number): PlaybackState[] =>
  events.slice(from).flatMap((e) => (e.type === 'stateChanged' ? [e.state] : []))

/** `start(ep)` の呼出の中で出た loading の状態の episode = その start が作った写し。 */
function startAndGetCopy(ep: PlayableEpisode, resume = 0): PlayableEpisode {
  const before = events.length
  session.start(ep, resume, 1)
  const loading = stateEvents(before).find((s) => s.status === 'loading')
  const copy = loading === undefined ? undefined : episodeOf(loading)
  if (copy === undefined) throw new Error('start の中で loading の状態が出なかった')
  return copy
}

describe('TA-V6 4(d) Session の start は episode の写しを深く凍結して保持する', () => {
  test.each([
    ['凍結されていない episode', (ep: MutableEpisode): PlayableEpisode => ep],
    ['浅く凍結した episode', (ep: MutableEpisode): PlayableEpisode => Object.freeze(ep)],
  ])('%s: start の後で呼出側の field と入れ子を書き換えても state().episode は変わらない', (_name, freeze) => {
    const ep = makeEpisode('a')
    const given = freeze(ep)
    const expectedTitle = ep.title
    const expectedTranscript = structuredClone(ep.transcript)
    const expectedQuiz = structuredClone(ep.quiz)

    session.start(given, 0, 1)

    if (!Object.isFrozen(given)) ep.title = 'changed'
    ep.transcript?.push({ speaker: 'X', text: 'added' })
    if (ep.transcript?.[0] !== undefined) ep.transcript[0].text = 'changed'
    ep.quiz?.[0].options.push('added')

    const state = session.state()
    const held = episodeOf(state)
    expect(state.status).toBe('loading')
    expect(held?.title).toBe(expectedTitle)
    expect(held?.transcript).toEqual(expectedTranscript)
    expect(held?.quiz).toEqual(expectedQuiz)
    // 写しは深く凍結済みで、呼出側の入れ子とは別の object。audioHandle だけは同じ参照
    expectDeeplyFrozen('state()', state)
    expect(held?.transcript).not.toBe(ep.transcript)
    expect(held?.audioHandle).toBe(ep.audioHandle)
    expect(held).not.toBe(given)
  })

  test('state().episode は渡した episode と内容が等しい（toEqual）', () => {
    const ep = makeEpisode('a')
    session.start(ep, 30, 1.5)
    expect(episodeOf(session.state())).toEqual(ep)
  })

  test('prototype が null の入れ子を持つ episode も、写しを深く凍結して保持し、呼出側の値と参照を共有しない', () => {
    const ep = makeEpisode('a')
    const nullProto = Object.assign(Object.create(null) as Record<string, unknown>, { speaker: 'X', text: 'original' })
    const given = { ...ep, transcript: [nullProto] } as unknown as PlayableEpisode

    session.start(given, 0, 1)
    nullProto.text = 'changed'

    const held = episodeOf(session.state())
    expectDeeplyFrozen('state()', session.state())
    expect(held?.transcript?.[0]).not.toBe(nullProto)
    expect(held?.transcript?.[0]?.text).toBe('original')
  })

  test('呼出側の episode は凍結されない（凍結されていなかった入力は書き換え可能なまま）', () => {
    const ep = makeEpisode('a')
    session.start(ep, 0, 1)
    expect(Object.isFrozen(ep)).toBe(false)
    expect(Object.isFrozen(ep.transcript)).toBe(false)
  })
})

describe('TA-V6 4(d) Session の state() と stateChanged の値は、すべての状態で深く凍結済み', () => {
  async function driveThroughAllStatuses(ep: PlayableEpisode): Promise<PlaybackState[]> {
    const seen: PlaybackState[] = [session.state()]
    const record = (): void => void seen.push(session.state())
    session.start(ep, 10, 1)
    record() // loading
    audio.fireLoadedMetadata(600)
    record() // paused
    await session.play()
    record() // playing
    audio.fireTimeUpdate(20)
    record() // playing（位置の更新）
    audio.fireError()
    record() // errored
    await session.play() // errored からの再読込
    record() // loading
    audio.fireLoadedMetadata(600)
    await session.play()
    audio.fireEnded()
    record() // ended
    session.stop()
    record() // idle
    return seen
  }

  test('start から loading・paused・playing・errored・ended・idle まで動かし、すべての state() と stateChanged の state が深く凍結済みで、episode は start が作った写しである', async () => {
    const ep1 = makeEpisode('ep1')
    const seen = await driveThroughAllStatuses(ep1)

    expect(new Set(seen.map((s) => s.status))).toEqual(new Set(['idle', 'loading', 'paused', 'playing', 'errored', 'ended']))
    seen.forEach((s, i) => expectDeeplyFrozen(`state()#${i}(${s.status})`, s))
    const emitted = stateEvents(0)
    expect(emitted.length).toBeGreaterThan(5)
    emitted.forEach((s, i) => expectDeeplyFrozen(`stateChanged#${i}(${s.status})`, s))

    // episode を持つすべての状態の episode は、start が作った写しと同じ参照（ep1 そのものではない）
    const copies = emitted.filter((s) => s.status === 'loading').map(episodeOf)
    const first = copies[0]
    expect(first).toBeDefined()
    expect(first).not.toBe(ep1)
    for (const s of [...seen, ...emitted]) {
      const held = episodeOf(s)
      if (held !== undefined) expect(held, `${s.status} の episode が start の写しと別の参照`).toBe(first)
    }
  })

  test('playing の間に start(ep2) を呼ぶと、途中で出る paused は ep1 の写しを持ち、loading 以降は ep2 の写しを持つ（写しの引き継ぎ）', async () => {
    const ep1 = makeEpisode('ep1')
    const ep2 = makeEpisode('ep2')
    const copy1 = startAndGetCopy(ep1)
    audio.fireLoadedMetadata(600)
    await session.play()
    expect(session.state().status).toBe('playing')

    const before = events.length
    const copy2 = startAndGetCopy(ep2)
    const emitted = stateEvents(before)
    expect(emitted.map((s) => s.status)).toEqual(['paused', 'loading'])
    expect(episodeOf(emitted[0])).toBe(copy1)
    expect(episodeOf(emitted[1])).toBe(copy2)
    expect(copy2).not.toBe(copy1)
    emitted.forEach((s) => expectDeeplyFrozen(s.status, s))

    audio.fireLoadedMetadata(600)
    expect(episodeOf(session.state())).toBe(copy2)
    expectDeeplyFrozen('paused(ep2)', session.state())
  })

  test('loading の間に start(ep2) を呼ぶと、途中で出る idle は episode を持たず、loading は ep2 の写しを持つ（idle は episode を持たない）', () => {
    const copy1 = startAndGetCopy(makeEpisode('ep1'))
    expect(session.state().status).toBe('loading')

    const before = events.length
    const copy2 = startAndGetCopy(makeEpisode('ep2'))
    const emitted = stateEvents(before)
    expect(emitted.map((s) => s.status)).toEqual(['idle', 'loading'])
    expect('episode' in emitted[0]).toBe(false)
    expect(episodeOf(emitted[1])).toBe(copy2)
    expect(copy2).not.toBe(copy1)
    emitted.forEach((s) => expectDeeplyFrozen(s.status, s))
  })
})

describe('TA-V6 4(d) Session の fail は ref と reason の写しを深く凍結して保持し、呼出側の値は凍結しない', () => {
  test('fail の後で渡した ref を書き換えても state().episode は変わらず、保持された episode は凍結済み、ref は凍結されない', () => {
    const ref = { id: 'a' }

    session.fail(ref, { kind: 'source_unavailable' })
    ref.id = 'changed'

    const state = session.state()
    const held = state.status === 'errored' ? state.episode : undefined
    expect(held?.id).toBe('a')
    expectDeeplyFrozen('state()', state)
    expect(Object.isFrozen(ref)).toBe(false)
  })

  test('fail の後で渡した reason.failure を書き換えても state().reason は変わらず、保持された reason は凍結済み、reason と failure は凍結されない', () => {
    const failure = { kind: 'validation' as const, detail: 'd' }
    const reason = { kind: 'fetch_failed' as const, failure }

    session.fail({ id: 'a' }, reason)
    failure.detail = 'changed'

    const state = session.state()
    const held = state.status === 'errored' ? state.reason : undefined
    expect(held).toEqual({ kind: 'fetch_failed', failure: { kind: 'validation', detail: 'd' } })
    expectDeeplyFrozen('state()', state)
    expect(Object.isFrozen(reason)).toBe(false)
    expect(Object.isFrozen(failure)).toBe(false)
  })
})
