// @vitest-environment node
// Catalog の生成関数と decodeEpisode の不変性（web-check-06 の観点 1・2）。入力を全深さで複製し、戻り値を深く凍結する。
// 正本: docs/design/modules/web/2026-09-30-implementation-spec-target-architecture.md §7 web-check-06、§5.0（値の生成）。
// key `audioHandle` の値だけは、解放の操作を持つ不透明な値なので凍結せず、入力と同じ参照を保つ。
//
// RED 理由（実装前）: `@/lib/catalog/domain/episode`・`@/lib/catalog/infrastructure/episodeMapper` が無い（module not found）。
import { describe, expect, test, vi } from 'vitest'
import {
  classifyEpisode,
  failedEpisode,
  generatingEpisode,
  playableEpisode,
  queuedEpisode,
  sourceCredit,
} from '@/lib/catalog/domain/episode'
import { decodeEpisode } from '@/lib/catalog/infrastructure/episodeMapper'
import type { Podcast } from '@/types'

// 呼出側が入れ子を書き換える状況を作るため、readonly を全深さで外す（関数は辿らない）
type DeepMutable<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends ReadonlyArray<infer U>
    ? DeepMutable<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
      : T

// ---------------------------------------------------------------------------
// 深い凍結の検査 helper: plain object と配列をすべての深さで辿り、凍結済みの node でも再帰を止めない。
// 飛ばすのは key `audioHandle` の値だけ。
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

/** audioHandle（関数を持つ）を除いた写し。structuredClone は関数を複製できない。 */
function snapshotWithoutHandle(value: object): unknown {
  const rest: Record<string, unknown> = { ...value }
  delete rest.audioHandle
  return structuredClone(rest)
}

describe('web-check-06 helper の自己点検: 深い凍結の判定', () => {
  test('完全に凍結した値は 0 件、凍結していない node は path つきで拾う（凍結済みの親の下の可変な入れ子も拾う）', () => {
    expect(unfrozenNodes(Object.freeze({ a: Object.freeze([Object.freeze({ b: 1 })]) }))).toEqual([])
    expect(unfrozenNodes({ a: 1 })).toEqual(['$'])
    expect(unfrozenNodes(Object.freeze({ list: [{ x: 1 }] }))).toEqual(['$.list', '$.list[0]'])
  })

  test('key audioHandle の値だけを飛ばす', () => {
    expect(unfrozenNodes(Object.freeze({ audioHandle: { release: vi.fn() }, other: { n: 1 } }))).toEqual(['$.other'])
  })
})

// ---------------------------------------------------------------------------
// fixture: 呼出側が後から書き換える可変の入力
// ---------------------------------------------------------------------------
function mutableSources(): { articleId: string; title: string; url: string; siteName: string }[] {
  return [
    { articleId: 'art-1', title: 'Title A', url: 'https://example.com/a', siteName: 'Site A' },
    { articleId: 'art-2', title: 'Title B', url: 'https://example.com/b', siteName: 'Site B' },
  ]
}

function playableInput(handle: { release: () => void }) {
  return {
    id: 'p1',
    title: 'T',
    audioUrl: 'https://example.com/p1.mp3',
    durationSeconds: 600,
    difficulty: 'toeic_600' as const,
    createdAt: '2026-05-31T06:00:00Z',
    serverPositionSeconds: 7,
    transcript: [{ speaker: 'A', text: 'hello' }],
    vocabulary: [{ term: 'term', meaningJa: '語', example: 'ex' }],
    quiz: [{ question: 'q?', options: ['a', 'b'] }],
    sources: [{ ...mutableSources()[0], showsShareAlikeNotice: true }],
    audioHandle: handle,
  }
}

function readoutInput() {
  return {
    id: 'p1',
    title: 'T',
    intro: 'イントロ',
    status: 'completed' as const,
    audioUrl: 'https://example.com/p1.mp3',
    failure: null,
    difficulty: 'toeic_600' as const,
    createdAt: '2026-05-31T06:00:00Z',
    durationSeconds: 600,
    serverPositionSeconds: 7,
    transcript: [{ speaker: 'A', text: 'hello' }],
    vocabulary: [{ term: 'term', meaningJa: '語', example: 'ex' }],
    quiz: [{ question: 'q?', options: ['a', 'b'] }],
    sources: mutableSources(),
    sourceOrigin: 'operator' as const,
  }
}

function podcastDto(): Podcast {
  return {
    id: 'p1',
    type: 'daily',
    article_ids: ['art-1'],
    difficulty: 'toeic_600',
    audio_url: 'https://example.com/p1.mp3',
    title: 'T',
    japanese_intro_text: 'イントロ',
    segments: [{ speaker: 'A', text: 'hello', role: 'fact' }],
    vocabulary: [{ term: 'term', meaning_ja: '語', example: 'ex' }],
    quiz: [{ question: 'q?', options: ['a', 'b'] }],
    source_articles: [{ article_id: 'art-1', title: 'Title A', url: 'https://example.com/a', source: 'Site A' }],
    source_kind: 'featured',
    duration_seconds: 600,
    created_at: '2026-05-31T06:00:00Z',
    status: 'completed',
    error_message: null,
    playback_position_seconds: 7,
  }
}

// ---------------------------------------------------------------------------
// 観点 1: 複製（呼出の後で入力を書き換えても戻り値は変わらない）
// ---------------------------------------------------------------------------
describe('web-check-06 観点 1: 生成関数は入力を複製する（呼出の後で入力を書き換えても戻り値は変わらない）', () => {
  test('playableEpisode: 入力の field・入れ子を書き換えても戻り値は変わらず、入れ子は別の参照。audioHandle だけは同じ参照', () => {
    const handle = { release: vi.fn() }
    const input = playableInput(handle)
    const result = playableEpisode(input)
    const before = snapshotWithoutHandle(result)

    input.title = 'changed'
    input.transcript.push({ speaker: 'X', text: 'added' })
    input.transcript[0].text = 'changed'
    input.vocabulary[0].term = 'changed'
    input.quiz[0].options.push('added')
    input.sources[0].url = 'https://changed.example.com'

    expect(snapshotWithoutHandle(result)).toEqual(before)
    expect(result).not.toBe(input)
    expect(result.transcript).not.toBe(input.transcript)
    expect(result.transcript?.[0]).not.toBe(input.transcript[0])
    expect(result.quiz?.[0].options).not.toBe(input.quiz[0].options)
    expect(result.sources).not.toBe(input.sources)
    expect(result.audioHandle).toBe(handle)
  })

  test('generatingEpisode・failedEpisode・queuedEpisode: 入力を書き換えても戻り値は変わらない', () => {
    const generatingIn = { id: 'g1', title: 'T', difficulty: 'toeic_900' as const, createdAt: '2026-05-31T06:00:00Z' }
    const generating = generatingEpisode(generatingIn)
    const generatingBefore = structuredClone(generating)
    generatingIn.title = 'changed'
    expect(generating).toEqual(generatingBefore)

    const failedIn = { id: 'f1', title: 'T', reason: 'quota_exhausted' as 'quota_exhausted' | 'generation_failed' }
    const failed = failedEpisode(failedIn)
    const failedBefore = structuredClone(failed)
    failedIn.reason = 'generation_failed'
    failedIn.title = 'changed'
    expect(failed).toEqual(failedBefore)

    const queuedIn = { id: 'q1', title: 'T' as string | null, intro: 'イントロ' }
    const queued = queuedEpisode(queuedIn)
    const queuedBefore = structuredClone(queued)
    queuedIn.title = 'changed'
    queuedIn.intro = 'changed'
    expect(queued).toEqual(queuedBefore)
    expect(queued.label).not.toBe(queuedIn)
  })

  test('sourceCredit: 入力を書き換えても戻り値は変わらない', () => {
    const input = mutableSources()[0]
    const result = sourceCredit(input, 'operator')
    const before = structuredClone(result)
    input.title = 'changed'
    input.url = 'https://changed.example.com'
    expect(result).toEqual(before)
  })

  test('classifyEpisode: 入力の入れ子を書き換えても戻り値は変わらず、入れ子は別の参照', () => {
    const input = readoutInput()
    const result = classifyEpisode(input)
    expect(result.kind).toBe('playable')
    const before = structuredClone(result)

    input.transcript.push({ speaker: 'X', text: 'added' })
    input.transcript[0].text = 'changed'
    input.quiz[0].options.push('added')
    input.sources[0].siteName = 'changed'
    input.sources.push({ articleId: 'art-3', title: 'C', url: 'https://example.com/c', siteName: 'Site C' })
    input.title = 'changed'

    expect(result).toEqual(before)
    if (result.kind !== 'playable') return
    expect(result.transcript).not.toBe(input.transcript)
    expect(result.quiz?.[0].options).not.toBe(input.quiz[0].options)
    expect(result.sources).not.toBe(input.sources)
  })
})

// ---------------------------------------------------------------------------
// 観点 2: 凍結（戻り値は全深さで凍結され、strict mode の書込みは throw する）
// ---------------------------------------------------------------------------
describe('web-check-06 観点 2: 戻り値は audioHandle を除く全深さで凍結される', () => {
  const handle = { release: vi.fn() }

  test('playableEpisode・classifyEpisode(Playable)・generatingEpisode・failedEpisode・queuedEpisode・sourceCredit は凍結された値を返す', () => {
    const playable = playableEpisode(playableInput(handle))
    const classified = classifyEpisode(readoutInput())
    expect(classified.kind).toBe('playable')
    expectDeeplyFrozen('playableEpisode', playable)
    expectDeeplyFrozen('classifyEpisode', classified)
    expectDeeplyFrozen(
      'generatingEpisode',
      generatingEpisode({ id: 'g1', title: 'T', difficulty: 'toeic_900', createdAt: '2026-05-31T06:00:00Z' }),
    )
    expectDeeplyFrozen('failedEpisode', failedEpisode({ id: 'f1', title: 'T', reason: 'generation_failed' }))
    expectDeeplyFrozen('queuedEpisode', queuedEpisode({ id: 'q1', title: null, intro: 'イントロ' }))
    expectDeeplyFrozen('sourceCredit', sourceCredit(mutableSources()[0], 'user'))
  })

  test('strict mode の書込みは throw する: transcript.push・options の代入・showsShareAlikeNotice の代入・label.title の代入', () => {
    const playable = playableEpisode(playableInput(handle)) as DeepMutable<ReturnType<typeof playableEpisode>>
    const queued = queuedEpisode({ id: 'q1', title: 'T', intro: 'イントロ' }) as DeepMutable<ReturnType<typeof queuedEpisode>>

    expect(() => playable.transcript?.push({ speaker: 'X', text: 'added' })).toThrow(TypeError)
    expect(() => {
      if (playable.quiz !== undefined) playable.quiz[0].options[0] = 'changed'
    }).toThrow(TypeError)
    expect(() => {
      if (playable.sources !== undefined) playable.sources[0].showsShareAlikeNotice = false
    }).toThrow(TypeError)
    expect(() => {
      queued.label.title = 'changed'
    }).toThrow(TypeError)
    // 正方向対照: 書込みが throw した後も値は元のまま
    expect(playable.sources?.[0].showsShareAlikeNotice).toBe(true)
    expect(queued.label.title).toBe('T')
  })

  test('audioHandle は凍結されず、入力と同じ参照を持つ（release を呼べる）', () => {
    const input = playableInput(handle)
    const playable = playableEpisode(input)
    expect(playable.audioHandle).toBe(handle)
    expect(Object.isFrozen(handle)).toBe(false)
    playable.audioHandle?.release()
    expect(handle.release).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// decodeEpisode: DTO と参照を共有しない
// ---------------------------------------------------------------------------
describe('web-check-06 decodeEpisode: 戻り値は DTO と参照を共有せず、深く凍結される', () => {
  test('decode の後で DTO の入れ子を書き換えても戻り値は変わらない', () => {
    const dto = podcastDto()
    const result = decodeEpisode(dto)
    expect(result.kind).toBe('playable')
    const before = structuredClone(result)

    dto.segments![0].text = 'changed'
    dto.segments!.push({ speaker: 'X', text: 'added' })
    dto.quiz![0].options.push('added')
    dto.vocabulary![0].term = 'changed'
    dto.source_articles![0].url = 'https://changed.example.com'

    expect(result).toEqual(before)
    if (result.kind !== 'playable') return
    expect(result.transcript?.[0].text).toBe('hello')
    expect(result.transcript).toHaveLength(1)
    expect(result.quiz?.[0].options).toEqual(['a', 'b'])
    expect(result.quiz?.[0].options).not.toBe(dto.quiz![0].options)
  })

  test('戻り値は全深さで凍結されている（Playable・Generating・Failed）', () => {
    expectDeeplyFrozen('playable', decodeEpisode(podcastDto()))
    expectDeeplyFrozen('generating', decodeEpisode({ ...podcastDto(), status: 'processing' }))
    expectDeeplyFrozen('failed', decodeEpisode({ ...podcastDto(), status: 'partial_failed' }))
  })
})
