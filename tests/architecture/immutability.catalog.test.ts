// @vitest-environment node
// Catalog の生成関数と decodeEpisode の不変性（web-check-06 の観点 1・2）。入力を全深さで複製し、戻り値を深く凍結する。
// リードモデル（listEpisodes・getEpisodeDetail の値）と生成の監視の戻り値も同じ観点で検査する（本ファイル末尾）。
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
import { classifyGenerationLimit } from '@/lib/catalog/domain/generationLimit'
import { detectCompleted, shouldStopWatching } from '@/lib/catalog/domain/generationWatch'
import {
  emptyStarState,
  markStarred,
  mergeServerStars,
  removeLost,
  starredArticles,
  unmarkStarred,
  visibleArticles,
} from '@/lib/catalog/domain/article'
import type { ArticleRef, StarState } from '@/lib/catalog/domain/article'
import { groupByCategoryInOrder } from '@/lib/catalog/domain/featuredCategory'
import { recommendedSources } from '@/lib/catalog/domain/source'
import type { FeaturedSourceRef, SourceRef } from '@/lib/catalog/domain/source'
import { createCatalogCommands } from '@/lib/catalog/application/commands'
import { createCatalogQueries } from '@/lib/catalog/application/queries'
import type { CatalogGateway, EpisodeRecord } from '@/lib/catalog/application/ports'
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
    label: { title: 'T', intro: 'イントロ' },
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

// ---------------------------------------------------------------------------
// classifyGenerationLimit: 戻り値は凍結され、書き換えを試みても次の呼出の結果は変わらない（入力はプリミティブだけ）
// ---------------------------------------------------------------------------
describe('web-check-06 classifyGenerationLimit: 戻り値は深く凍結され、書き換えを試みても再呼出の結果は変わらない', () => {
  test('戻り値は全深さで凍結され、strict mode の書込みは throw し、再呼出は同じ値を返す', () => {
    const result = classifyGenerationLimit('Monthly generation limit reached', 90000) as DeepMutable<
      ReturnType<typeof classifyGenerationLimit>
    >
    expectDeeplyFrozen('classifyGenerationLimit', result)

    expect(() => {
      result.period = 'daily'
    }).toThrow(TypeError)
    expect(() => {
      result.retryAfterSeconds = null
    }).toThrow(TypeError)

    // 正方向対照: 書込みが throw した後も値は元のまま、再呼出も同じ値
    expect(result).toEqual({ period: 'monthly', retryAfterSeconds: 90000 })
    expect(classifyGenerationLimit('Monthly generation limit reached', 90000)).toEqual({
      period: 'monthly',
      retryAfterSeconds: 90000,
    })
  })
})

// ---------------------------------------------------------------------------
// リードモデル: query の値は gateway の返した record と参照を共有せず、深く凍結される（web-check-06 観点 1〜3）
// ---------------------------------------------------------------------------
function mutableRecord(): DeepMutable<EpisodeRecord> {
  return {
    episode: {
      kind: 'playable',
      id: 'p1',
      title: 'T',
      label: { title: 'T', intro: 'イントロ' },
      audioUrl: 'https://example.com/p1.mp3',
      durationSeconds: 600,
      difficulty: 'toeic_600',
      createdAt: '2026-05-31T06:00:00Z',
      serverPositionSeconds: 7,
    },
    generation: 'completed',
    isDigest: false,
    intro: 'イントロ',
    label: { title: 'T', intro: 'イントロ' },
    difficulty: 'toeic_600',
    durationSeconds: 600,
    createdAt: '2026-05-31T06:00:00Z',
    transcript: [{ speaker: 'A', text: 'hello' }],
    glossary: [{ term: 'term', meaningJa: '語', example: 'ex' }],
    quiz: [{ question: 'q?', options: ['a', 'b'] }],
    sources: [{ articleId: 'art-1', title: 'Title A', url: 'https://example.com/a', siteName: 'Site A', showsShareAlikeNotice: true }],
  }
}

function queriesOver(records: DeepMutable<EpisodeRecord>[]) {
  const gateway: CatalogGateway = {
    listEpisodes: () => Promise.resolve({ ok: true, value: records }),
    getEpisode: () => Promise.resolve({ ok: true, value: records[0] }),
    getFeed: () => Promise.reject(new Error('getFeed を想定していない')),
    getStarredArticles: () => Promise.reject(new Error('getStarredArticles を想定していない')),
    starArticle: () => Promise.reject(new Error('starArticle を想定していない')),
    dismissArticle: () => Promise.reject(new Error('dismissArticle を想定していない')),
    unstarArticle: () => Promise.reject(new Error('unstarArticle を想定していない')),
    getSources: () => Promise.reject(new Error('getSources を想定していない')),
    addSource: () => Promise.reject(new Error('addSource を想定していない')),
    deleteSource: () => Promise.reject(new Error('deleteSource を想定していない')),
    getFeaturedSources: () => Promise.reject(new Error('getFeaturedSources を想定していない')),
    getOnboardingStatus: () => Promise.reject(new Error('getOnboardingStatus を想定していない')),
    completeOnboarding: () => Promise.reject(new Error('completeOnboarding を想定していない')),
  }
  return createCatalogQueries({ gateway })
}

describe('web-check-06 リードモデル: listEpisodes・getEpisodeDetail の値', () => {
  test('verifies: CI-Q1 CI-Q2 CI-RM1 CI-RM2 — 値は全深さで凍結される（配列・view・label・transcript・quiz の options・sources の要素）', async () => {
    const queries = queriesOver([mutableRecord()])

    const listed = await queries.listEpisodes()
    const detail = await queries.getEpisodeDetail('p1')

    expect(listed.ok && detail.ok).toBe(true)
    if (!listed.ok || !detail.ok) return
    expectDeeplyFrozen('listEpisodes', listed.value)
    expectDeeplyFrozen('getEpisodeDetail', detail.value)
  })

  test('verifies: CI-Q1 CI-Q2 — strict mode の書込みは throw し、throw した後も値は元のまま', async () => {
    const queries = queriesOver([mutableRecord()])
    const listed = await queries.listEpisodes()
    const detail = await queries.getEpisodeDetail('p1')
    if (!listed.ok || !detail.ok) throw new Error('成功を期待した')
    const list = listed.value as DeepMutable<typeof listed.value>
    const view = detail.value as DeepMutable<typeof detail.value>

    expect(() => list.push(list[0])).toThrow(TypeError)
    expect(() => {
      list[0].label.title = 'changed'
    }).toThrow(TypeError)
    expect(() => view.transcript.push({ speaker: 'X', text: 'added' })).toThrow(TypeError)
    expect(() => {
      view.quiz[0].options[0] = 'changed'
    }).toThrow(TypeError)
    expect(() => {
      view.sources[0].showsShareAlikeNotice = false
    }).toThrow(TypeError)

    expect(list).toHaveLength(1)
    expect(list[0].label.title).toBe('T')
    expect(view.quiz[0].options).toEqual(['a', 'b'])
    expect(view.sources[0].showsShareAlikeNotice).toBe(true)
  })

  test('verifies: CI-Q1 CI-Q2 CI-RM1 CI-RM2 — 呼ぶたびに別の object で、内容は等しい', async () => {
    const queries = queriesOver([mutableRecord()])

    const first = await queries.listEpisodes()
    const second = await queries.listEpisodes()
    const detailA = await queries.getEpisodeDetail('p1')
    const detailB = await queries.getEpisodeDetail('p1')

    if (!first.ok || !second.ok || !detailA.ok || !detailB.ok) throw new Error('成功を期待した')
    expect(second.value).not.toBe(first.value)
    expect(second.value[0]).not.toBe(first.value[0])
    expect(second.value[0].label).not.toBe(first.value[0].label)
    expect(second.value).toEqual(first.value)
    expect(detailB.value).not.toBe(detailA.value)
    expect(detailB.value.quiz[0].options).not.toBe(detailA.value.quiz[0].options)
    expect(detailB.value).toEqual(detailA.value)
  })

  test('verifies: CI-RM1 CI-RM2 — gateway の返した record と入れ子を共有せず、record を後で書き換えても値は変わらない', async () => {
    const record = mutableRecord()
    const queries = queriesOver([record])
    const listed = await queries.listEpisodes()
    const detail = await queries.getEpisodeDetail('p1')
    if (!listed.ok || !detail.ok) throw new Error('成功を期待した')
    const listedBefore = structuredClone(listed.value)
    const detailBefore = structuredClone(detail.value)

    // 参照を共有しない
    expect(listed.value[0].label).not.toBe(record.label)
    expect(detail.value.label).not.toBe(record.label)
    expect(detail.value.transcript).not.toBe(record.transcript)
    expect(detail.value.transcript[0]).not.toBe(record.transcript[0])
    expect(detail.value.glossary[0]).not.toBe(record.glossary[0])
    expect(detail.value.quiz).not.toBe(record.quiz)
    expect(detail.value.quiz[0].options).not.toBe(record.quiz[0].options)
    expect(detail.value.sources).not.toBe(record.sources)
    expect(detail.value.sources[0]).not.toBe(record.sources[0])

    // 後で書き換えても変わらない
    record.label.title = 'changed'
    record.intro = 'changed'
    record.transcript[0].text = 'changed'
    record.transcript.push({ speaker: 'X', text: 'added' })
    record.glossary[0].term = 'changed'
    record.quiz[0].options.push('added')
    record.sources[0].url = 'https://changed.example.com'
    record.sources[0].showsShareAlikeNotice = false
    record.sources.push({ articleId: 'art-9', title: 'C', url: 'https://example.com/c', siteName: 'S', showsShareAlikeNotice: true })

    expect(listed.value).toEqual(listedBefore)
    expect(detail.value).toEqual(detailBefore)
  })
})

// ---------------------------------------------------------------------------
// 生成の監視: watchGeneration・detectCompleted・shouldStopWatching の戻り値は凍結される
// ---------------------------------------------------------------------------
describe('web-check-06 生成の監視の戻り値は凍結される', () => {
  test('verifies: CI-Q3 CI-G1 CI-G2 — watchGeneration（completedIds を含む）・detectCompleted・shouldStopWatching は全深さで凍結された値を返す', () => {
    const queries = queriesOver([mutableRecord()])
    const watched = queries.watchGeneration(
      [{ id: 'a', generation: 'processing' }],
      [{ id: 'a', generation: 'completed' }],
    )

    expect(watched.completedIds).toEqual(['a'])
    expectDeeplyFrozen('watchGeneration', watched)
    expectDeeplyFrozen('detectCompleted', detectCompleted([{ id: 'a', generation: 'processing' }], [{ id: 'a', generation: 'completed' }]))
    expectDeeplyFrozen('detectCompleted(empty)', detectCompleted([], []))
    expectDeeplyFrozen('shouldStopWatching(stop)', shouldStopWatching({ baselineCount: 1, currentCount: 2, elapsedMs: 0 }))
    expectDeeplyFrozen('shouldStopWatching(continue)', shouldStopWatching({ baselineCount: 1, currentCount: 1, elapsedMs: 0 }))
  })

  test('verifies: CI-Q3 CI-G1 CI-G2 — 書込みは throw し、再呼出は書込みの影響を受けない。watchGeneration は呼ぶたびに別 object', () => {
    const queries = queriesOver([mutableRecord()])
    const previous = [{ id: 'a', generation: 'processing' as const }]
    const next = [{ id: 'a', generation: 'completed' as const }]
    const watched = queries.watchGeneration(previous, next) as DeepMutable<ReturnType<typeof queries.watchGeneration>>
    const stop = shouldStopWatching({ baselineCount: 1, currentCount: 2, elapsedMs: 0 }) as DeepMutable<
      ReturnType<typeof shouldStopWatching>
    >

    expect(() => watched.completedIds.push('x')).toThrow(TypeError)
    expect(() => {
      stop.stop = false
    }).toThrow(TypeError)

    expect(queries.watchGeneration(previous, next)).toEqual({ completedIds: ['a'] })
    expect(queries.watchGeneration(previous, next)).not.toBe(queries.watchGeneration(previous, next))
    expect(shouldStopWatching({ baselineCount: 1, currentCount: 2, elapsedMs: 0 })).toEqual({ stop: true, reason: 'new-podcast' })
  })
})

// ---------------------------------------------------------------------------
// article（web-rule-catalog-04）の関数: 入力を書き換えず、入力と参照を共有せず、全深さで凍結した値を返す（web-check-06）
// ---------------------------------------------------------------------------
function mutableRef(id: string): DeepMutable<ArticleRef> {
  return { id, title: `title ${id}`, source: 'Site', url: `https://example.com/${id}`, score: 1, publishedAt: '2026-05-31T06:00:00Z' }
}

function mutableState(): { starredIds: Set<string>; serverStarred: DeepMutable<ArticleRef>[]; optimistic: DeepMutable<ArticleRef>[] } {
  return { starredIds: new Set(['a1']), serverStarred: [mutableRef('a1')], optimistic: [mutableRef('a2')] }
}

describe('web-check-06 article の関数', () => {
  test('verifies: CI-AR9 — 戻り値の配列・記事は全深さで凍結され、starredIds は入力の Set と別の Set', () => {
    const articles = [mutableRef('a1'), mutableRef('a2'), mutableRef('a3')]
    const input = mutableState()
    const results: Array<[string, StarState]> = [
      ['emptyStarState', emptyStarState()],
      ['mergeServerStars', mergeServerStars(input, { feedStarredIds: ['a9'], serverStarred: [mutableRef('s1')] })],
      ['mergeServerStars(null)', mergeServerStars(input, { feedStarredIds: [], serverStarred: null })],
      ['markStarred', markStarred(input, 'a3', articles)],
      ['removeLost', removeLost(input, 'a1')],
      ['unmarkStarred', unmarkStarred(input, 'a1')],
    ]

    for (const [label, state] of results) {
      expectDeeplyFrozen(label, state)
      expect(state.starredIds, label).not.toBe(input.starredIds)
      expect(Object.isFrozen(state.starredIds), label).toBe(true)
    }
    expectDeeplyFrozen('starredArticles', starredArticles(input))
    expectDeeplyFrozen('visibleArticles(all)', visibleArticles('all', articles, emptyStarState()))
    expectDeeplyFrozen('visibleArticles(starred)', visibleArticles('starred', articles, input))
  })

  test('verifies: CI-AR9 — 入力（state・articles）を書き換えない', () => {
    const articles = [mutableRef('a1'), mutableRef('a2')]
    const input = mutableState()
    const articlesBefore = structuredClone(articles)
    const inputBefore = structuredClone({ ...input, starredIds: [...input.starredIds] })

    mergeServerStars(input, { feedStarredIds: ['a9'], serverStarred: [mutableRef('s1')] })
    markStarred(input, 'a2', articles)
    removeLost(input, 'a1')
    unmarkStarred(input, 'a1')
    starredArticles(input)
    visibleArticles('starred', articles, input)

    expect(articles).toEqual(articlesBefore)
    expect({ ...input, starredIds: [...input.starredIds] }).toEqual(inputBefore)
  })

  test('verifies: CI-AR9 — 入力の記事・Set を後から書き換えても、戻り値は変わらない（複製）', () => {
    const articles = [mutableRef('a1')]
    const input = mutableState()
    const marked = markStarred(input, 'a1', articles)
    const merged = mergeServerStars(input, { feedStarredIds: ['a1'], serverStarred: input.serverStarred })

    articles[0].title = 'changed'
    input.serverStarred[0].title = 'changed'
    input.starredIds.add('zz')

    expect(marked.optimistic.find((a) => a.id === 'a1')?.title).toBe('title a1')
    expect(merged.serverStarred[0].title).toBe('title a1')
    expect(marked.starredIds.has('zz')).toBe(false)
    expect(merged.starredIds.has('zz')).toBe(false)
  })

  test('verifies: CI-AR9 — 凍結した戻り値への書込みは throw し、値は元のまま', () => {
    const marked = markStarred(mutableState(), 'a1', [mutableRef('a1')]) as DeepMutable<StarState>

    expect(() => marked.optimistic.push(mutableRef('x'))).toThrow(TypeError)
    expect(() => {
      marked.serverStarred[0].title = 'changed'
    }).toThrow(TypeError)
    expect(marked.serverStarred[0].title).toBe('title a1')
  })
})

// ---------------------------------------------------------------------------
// getFeed()（web-query-catalog-01）の値: gateway の返した値と参照を共有せず、全深さで凍結される
// ---------------------------------------------------------------------------
function feedQueriesOver(feed: { articles: DeepMutable<ArticleRef>[]; starredIds: string[]; date: string | null }, starred: DeepMutable<ArticleRef>[]) {
  const reject = (name: string) => () => Promise.reject(new Error(`${name} を想定していない`))
  const gateway: CatalogGateway = {
    listEpisodes: reject('listEpisodes'),
    getEpisode: reject('getEpisode'),
    getFeed: () => Promise.resolve({ ok: true, value: feed }),
    getStarredArticles: () => Promise.resolve({ ok: true, value: starred }),
    starArticle: reject('starArticle'),
    dismissArticle: reject('dismissArticle'),
    unstarArticle: reject('unstarArticle'),
    getSources: reject('getSources'),
    addSource: reject('addSource'),
    deleteSource: reject('deleteSource'),
    getFeaturedSources: reject('getFeaturedSources'),
    getOnboardingStatus: reject('getOnboardingStatus'),
    completeOnboarding: reject('completeOnboarding'),
  }
  return createCatalogQueries({ gateway })
}

describe('web-check-06 getFeed() の値', () => {
  test('verifies: CI-FD3・FD4・FV3 — loaded の feed と starred ok の値は全深さで凍結され、gateway の値と参照を共有せず、後から書き換えても変わらない', async () => {
    const feed = { articles: [mutableRef('a1')], starredIds: ['a1'], date: '2026-06-01' }
    const starred = [mutableRef('s1')]
    const view = await feedQueriesOver(feed, starred).getFeed()
    if (!('feed' in view)) throw new Error('最新の取得は stale でない')
    const outcome = await view.starred
    if (!('articles' in outcome) || !('articles' in view.feed)) throw new Error('成功を期待した')
    const feedBefore = structuredClone(view.feed)
    const starredBefore = structuredClone(outcome)

    expectDeeplyFrozen('getFeed.feed', view.feed)
    expectDeeplyFrozen('getFeed.starred', outcome)
    expect(view.feed.articles).not.toBe(feed.articles)
    expect(view.feed.articles[0]).not.toBe(feed.articles[0])
    expect(view.feed.starredIds).not.toBe(feed.starredIds)
    expect(outcome.articles).not.toBe(starred)
    expect(outcome.articles[0]).not.toBe(starred[0])

    feed.articles[0].title = 'changed'
    feed.articles.push(mutableRef('a9'))
    feed.starredIds.push('a9')
    starred[0].title = 'changed'

    expect(view.feed).toEqual(feedBefore)
    expect(outcome).toEqual(starredBefore)
  })

  test('verifies: CI-FD3・FV3 — 呼ぶたびに別 object で、内容は等しい', async () => {
    const queries = feedQueriesOver({ articles: [mutableRef('a1')], starredIds: [], date: null }, [])

    const first = await queries.getFeed()
    const second = await queries.getFeed()

    if (!('feed' in first) || !('feed' in second)) throw new Error('逐次の取得は stale でない')
    expect(second.feed).not.toBe(first.feed)
    expect('articles' in second.feed && 'articles' in first.feed && second.feed.articles).not.toBe('articles' in first.feed && first.feed.articles)
    expect(second.feed).toEqual(first.feed)
  })
})

// ---------------------------------------------------------------------------
// 購読・おすすめ・onboarding: domain の純関数は入力を書き換えず、query / command の値は gateway の値と参照を共有せず、全深さで凍結される
// ---------------------------------------------------------------------------
function mutableSource(name: string, url = `https://${name}.example/rss`): DeepMutable<SourceRef> {
  return { name, url }
}

function mutableFeatured(id: string, overrides: Partial<DeepMutable<FeaturedSourceRef>> = {}): DeepMutable<FeaturedSourceRef> {
  return { id, name: `name ${id}`, url: `https://example.com/${id}.xml`, category: 'tech', thumbnailUrl: null, description: null, ...overrides }
}

/** 購読系の読み取り 3 method だけを実装し、他は呼ばれたら reject する gateway から作った query */
function sourceQueriesOver(data: {
  sources: DeepMutable<SourceRef>[]
  featured: DeepMutable<FeaturedSourceRef>[]
  onboarding: { completed: boolean }
}) {
  const reject = (name: string) => () => Promise.reject(new Error(`${name} を想定していない`))
  const gateway: CatalogGateway = {
    listEpisodes: reject('listEpisodes'),
    getEpisode: reject('getEpisode'),
    getFeed: reject('getFeed'),
    getStarredArticles: reject('getStarredArticles'),
    starArticle: reject('starArticle'),
    dismissArticle: reject('dismissArticle'),
    unstarArticle: reject('unstarArticle'),
    getSources: () => Promise.resolve({ ok: true, value: data.sources }),
    addSource: reject('addSource'),
    deleteSource: reject('deleteSource'),
    getFeaturedSources: () => Promise.resolve({ ok: true, value: data.featured }),
    getOnboardingStatus: () => Promise.resolve({ ok: true, value: data.onboarding }),
    completeOnboarding: reject('completeOnboarding'),
  }
  return createCatalogQueries({ gateway })
}

/** addSource・deleteSource が同じ可変の配列を返す gateway から作った command */
function sourceCommandsOver(sources: DeepMutable<SourceRef>[]) {
  const reject = (name: string) => () => Promise.reject(new Error(`${name} を想定していない`))
  const gateway: CatalogGateway = {
    listEpisodes: reject('listEpisodes'),
    getEpisode: reject('getEpisode'),
    getFeed: reject('getFeed'),
    getStarredArticles: reject('getStarredArticles'),
    starArticle: reject('starArticle'),
    dismissArticle: reject('dismissArticle'),
    unstarArticle: reject('unstarArticle'),
    getSources: reject('getSources'),
    addSource: () => Promise.resolve({ ok: true, value: sources }),
    deleteSource: () => Promise.resolve({ ok: true, value: sources }),
    getFeaturedSources: reject('getFeaturedSources'),
    getOnboardingStatus: reject('getOnboardingStatus'),
    completeOnboarding: reject('completeOnboarding'),
  }
  return createCatalogCommands({ gateway })
}

describe('web-check-06 recommendedSources・groupByCategoryInOrder (web-rule-catalog-08・web-rule-catalog-09)', () => {
  test('recommendedSources は入力の配列も要素も書き換えず、凍結した新しい配列を返す', () => {
    // 要素は application が凍結して渡した view なので、domain は要素の参照をそのまま運ぶ。
    const featured = [mutableFeatured('f1'), mutableFeatured('f2'), mutableFeatured('f3')].map((site) => Object.freeze(site))
    const subscribed = [mutableSource('s1', featured[1].url)]
    const featuredBefore = structuredClone(featured)
    const subscribedBefore = structuredClone(subscribed)

    const result = recommendedSources(featured, subscribed)

    expect(result.map((site) => site.id)).toEqual(['f1', 'f3'])
    expect(featured).toEqual(featuredBefore)
    expect(subscribed).toEqual(subscribedBefore)
    expect(result).not.toBe(featured)
    expectDeeplyFrozen('recommendedSources', result)
  })

  test('recommendedSources は空の入力でも凍結した空配列を返し、全件除かれても凍結している', () => {
    const none = recommendedSources([], [])
    const all = recommendedSources([mutableFeatured('f1')], [mutableSource('s1', 'https://example.com/f1.xml')])

    expect(none).toEqual([])
    expect(all).toEqual([])
    expectDeeplyFrozen('recommendedSources(empty)', none)
    expectDeeplyFrozen('recommendedSources(all removed)', all)
  })

  test('recommendedSources の戻りへの書込みは throw し、値は元のまま', () => {
    const result = recommendedSources([mutableFeatured('f1')], []) as DeepMutable<ReadonlyArray<FeaturedSourceRef>>

    expect(() => result.push(mutableFeatured('x'))).toThrow(TypeError)
    expect(result).toHaveLength(1)
  })

  test('groupByCategoryInOrder は入力を書き換えず、戻りの object と各配列を凍結する（5 つの key は空でも持つ）', () => {
    const items = [
      mutableFeatured('f1', { category: 'sports' }),
      mutableFeatured('f2', { category: 'tech' }),
      mutableFeatured('f3', { category: 'sports' }),
    ]
    const itemsBefore = structuredClone(items)

    const grouped = groupByCategoryInOrder(items)

    expect(items).toEqual(itemsBefore)
    expect(Object.keys(grouped).sort()).toEqual(['business', 'culture', 'entertainment', 'sports', 'tech'])
    expect(grouped.sports.map((site) => site.id)).toEqual(['f1', 'f3'])
    expect(grouped.culture).toEqual([])
    expect(Object.isFrozen(grouped)).toBe(true)
    for (const [category, list] of Object.entries(grouped)) expect(Object.isFrozen(list), category).toBe(true)
  })

  test('groupByCategoryInOrder の戻りへの書込みは throw し、値は元のまま', () => {
    const grouped = groupByCategoryInOrder([mutableFeatured('f1')]) as unknown as Record<string, FeaturedSourceRef[]>

    expect(() => grouped.tech.push(mutableFeatured('x'))).toThrow(TypeError)
    expect(() => {
      grouped.extra = []
    }).toThrow(TypeError)
    expect(grouped.tech).toHaveLength(1)
  })
})

describe('web-check-06 listSources・getFeaturedSources・getOnboardingStatus の値 (web-query-catalog-05・06・07)', () => {
  const data = () => ({
    sources: [mutableSource('a'), mutableSource('b')],
    featured: [mutableFeatured('f1', { thumbnailUrl: 'https://img.example/f1.png', description: 'desc' }), mutableFeatured('f2')],
    onboarding: { completed: true },
  })

  test('3 つの値は全深さで凍結され、gateway の値と参照を共有しない', async () => {
    const raw = data()
    const queries = sourceQueriesOver(raw)

    const sources = await queries.listSources()
    const featured = await queries.getFeaturedSources()
    const onboarding = await queries.getOnboardingStatus()

    if (!sources.ok || !featured.ok || !onboarding.ok) throw new Error('成功を期待した')
    expectDeeplyFrozen('listSources', sources.value)
    expectDeeplyFrozen('getFeaturedSources', featured.value)
    expectDeeplyFrozen('getOnboardingStatus', onboarding.value)
    expect(sources.value).not.toBe(raw.sources)
    expect(sources.value[0]).not.toBe(raw.sources[0])
    expect(featured.value).not.toBe(raw.featured)
    expect(featured.value[0]).not.toBe(raw.featured[0])
    expect(onboarding.value).not.toBe(raw.onboarding)
  })

  test('gateway の値を後から書き換えても、すでに返した値は変わらない', async () => {
    const raw = data()
    const queries = sourceQueriesOver(raw)
    const sources = await queries.listSources()
    const featured = await queries.getFeaturedSources()
    const onboarding = await queries.getOnboardingStatus()
    if (!sources.ok || !featured.ok || !onboarding.ok) throw new Error('成功を期待した')
    const before = structuredClone({ sources: sources.value, featured: featured.value, onboarding: onboarding.value })

    raw.sources[0].name = 'changed'
    raw.sources.push(mutableSource('z'))
    raw.featured[0].name = 'changed'
    raw.featured.push(mutableFeatured('f9'))
    raw.onboarding.completed = false

    expect({ sources: sources.value, featured: featured.value, onboarding: onboarding.value }).toEqual(before)
  })

  test('呼ぶたびに別の object で、内容は等しい', async () => {
    const queries = sourceQueriesOver(data())

    const [s1, s2] = [await queries.listSources(), await queries.listSources()]
    const [f1, f2] = [await queries.getFeaturedSources(), await queries.getFeaturedSources()]
    const [o1, o2] = [await queries.getOnboardingStatus(), await queries.getOnboardingStatus()]

    if (!s1.ok || !s2.ok || !f1.ok || !f2.ok || !o1.ok || !o2.ok) throw new Error('成功を期待した')
    expect(s2.value).not.toBe(s1.value)
    expect(s2.value[0]).not.toBe(s1.value[0])
    expect(f2.value).not.toBe(f1.value)
    expect(f2.value[0]).not.toBe(f1.value[0])
    expect(o2.value).not.toBe(o1.value)
    expect(s2.value).toEqual(s1.value)
    expect(f2.value).toEqual(f1.value)
    expect(o2.value).toEqual(o1.value)
  })

  test('strict mode の書込みは throw し、値は元のまま', async () => {
    const queries = sourceQueriesOver(data())
    const sources = await queries.listSources()
    const featured = await queries.getFeaturedSources()
    const onboarding = await queries.getOnboardingStatus()
    if (!sources.ok || !featured.ok || !onboarding.ok) throw new Error('成功を期待した')
    const list = sources.value as DeepMutable<typeof sources.value>
    const sites = featured.value as DeepMutable<typeof featured.value>
    const status = onboarding.value as DeepMutable<typeof onboarding.value>

    expect(() => list.push(mutableSource('x'))).toThrow(TypeError)
    expect(() => {
      list[0].name = 'changed'
    }).toThrow(TypeError)
    expect(() => {
      sites[0].description = 'changed'
    }).toThrow(TypeError)
    expect(() => {
      status.completed = false
    }).toThrow(TypeError)

    expect(list[0].name).toBe('a')
    expect(sites[0].description).toBe('desc')
    expect(status.completed).toBe(true)
  })
})

describe('web-check-06 addSource・subscribeFeatured・removeSource の成功の値 (web-cmd-catalog-05・06)', () => {
  test.each([
    ['addSource', (commands: ReturnType<typeof sourceCommandsOver>) => commands.addSource('n', 'https://example.com/rss')],
    ['subscribeFeatured', (commands: ReturnType<typeof sourceCommandsOver>) => commands.subscribeFeatured('n', 'https://example.com/rss')],
    ['removeSource', (commands: ReturnType<typeof sourceCommandsOver>) => commands.removeSource('https://a.example/rss')],
  ])('%s の成功の購読一覧は全深さで凍結した複製で、gateway の配列・要素と参照を共有せず、後から書き換えても変わらない', async (label, run) => {
    const raw = [mutableSource('a'), mutableSource('b')]
    const result = await run(sourceCommandsOver(raw))

    if (!result.ok) throw new Error('成功を期待した')
    const before = structuredClone(result.value)
    expectDeeplyFrozen(label, result.value)
    expect(result.value).not.toBe(raw)
    expect(result.value[0]).not.toBe(raw[0])

    raw[0].name = 'changed'
    raw.push(mutableSource('z'))

    expect(result.value).toEqual(before)
  })
})
