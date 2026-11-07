// Catalog application の query: listEpisodes（web-query-catalog-02）・getEpisodeDetail（web-query-catalog-03）・watchGeneration（web-query-catalog-04）。
// 手書きの CatalogGateway fake を渡す。`generationWatch`・`readModels` は値で import しない（期待値は literal）。
//
// RED 理由（実装前）: `@/lib/catalog/application/queries` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createCatalogQueries } from '@/lib/catalog/application/queries'
import type { CatalogGateway, EpisodeRecord } from '@/lib/catalog/application/ports'
import { sourceCredit } from '@/lib/catalog/domain/episode'
import type { SourceOrigin } from '@/lib/catalog/domain/episode'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

function record(id: string, overrides: Partial<EpisodeRecord> = {}): EpisodeRecord {
  return {
    episode: {
      kind: 'playable',
      id,
      title: `title ${id}`,
      label: { title: `title ${id}`, intro: `intro ${id}` },
      audioUrl: `https://example.com/${id}.mp3`,
      durationSeconds: 600,
      difficulty: 'toeic_600',
      createdAt: '2026-05-31T06:00:00Z',
      serverPositionSeconds: 0,
    },
    generation: 'completed',
    isDigest: false,
    intro: `intro ${id}`,
    label: { title: `title ${id}`, intro: `intro ${id}` },
    difficulty: 'toeic_600',
    durationSeconds: 600,
    createdAt: '2026-05-31T06:00:00Z',
    transcript: [{ speaker: 'A', text: 'hello' }],
    glossary: [{ term: 'term', meaningJa: '語', example: 'ex' }],
    quiz: [{ question: 'q?', options: ['a', 'b'] }],
    sources: [],
    ...overrides,
  }
}

interface FakeGateway extends CatalogGateway {
  readonly calls: string[]
}

function fake(handlers: {
  list?: () => Promise<Result<ReadonlyArray<EpisodeRecord>, ApiFailure>>
  get?: (id: string) => Promise<Result<EpisodeRecord, ApiFailure>>
}): FakeGateway {
  const calls: string[] = []
  return {
    calls,
    listEpisodes: () => {
      calls.push('listEpisodes')
      return handlers.list?.() ?? Promise.reject(new Error('listEpisodes を想定していない'))
    },
    getEpisode: (id) => {
      calls.push(`getEpisode:${id}`)
      return handlers.get?.(id) ?? Promise.reject(new Error('getEpisode を想定していない'))
    },
  }
}

describe('listEpisodes (web-query-catalog-02)', () => {
  test('verifies: CI-Q1 — 2 件の成功 → ok・gateway の順序どおりのカードの view。gateway は 1 回だけ呼ぶ', async () => {
    const gateway = fake({ list: () => Promise.resolve({ ok: true, value: [record('b'), record('a', { isDigest: true })] }) })

    const result = await createCatalogQueries({ gateway }).listEpisodes()

    expect(gateway.calls).toEqual(['listEpisodes'])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.map((v) => v.id)).toEqual(['b', 'a'])
    expect(result.value[1]).toMatchObject({ id: 'a', kind: 'playable', isDigest: true, intro: 'intro a', failureReason: null })
    // カードは詳細の内容を持たない
    expect(result.value[0]).not.toHaveProperty('transcript')
  })

  test('verifies: CI-Q1 — 空の一覧は空のまま ok', async () => {
    const gateway = fake({ list: () => Promise.resolve({ ok: true, value: [] }) })
    expect(await createCatalogQueries({ gateway }).listEpisodes()).toEqual({ ok: true, value: [] })
  })

  test('verifies: CI-Q1 — gateway の failure は同じ参照のまま返し、reject しない（view を作らない）', async () => {
    const failure: ApiFailure = { kind: 'server', status: 503 }
    const gateway = fake({ list: () => Promise.resolve({ ok: false, failure }) })

    const result = await createCatalogQueries({ gateway }).listEpisodes()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toBe(failure)
    expect(result).not.toHaveProperty('value')
  })

  test('verifies: CI-Q1 — gateway の reject はそのまま伝わる（page の catch が扱う）', async () => {
    const gateway = fake({ list: () => Promise.reject(new Error('boom')) })
    await expect(createCatalogQueries({ gateway }).listEpisodes()).rejects.toThrow('boom')
  })
})

describe('getEpisodeDetail (web-query-catalog-03)', () => {
  test('verifies: CI-Q2 — id を gateway に同じ値で渡し、値は詳細の view（内容 4 つを持つ）', async () => {
    const gateway = fake({ get: (id) => Promise.resolve({ ok: true, value: record(id) }) })

    const result = await createCatalogQueries({ gateway }).getEpisodeDetail('p1')

    expect(gateway.calls).toEqual(['getEpisode:p1'])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({
      id: 'p1',
      kind: 'playable',
      transcript: [{ speaker: 'A', text: 'hello' }],
      glossary: [{ term: 'term', meaningJa: '語', example: 'ex' }],
      quiz: [{ question: 'q?', options: ['a', 'b'] }],
      sources: [],
      showsShareAlikeNotice: false,
    })
  })

  test('verifies: CI-Q2 — not_found は同じ参照の failure のまま返す', async () => {
    const failure: ApiFailure = { kind: 'not_found', subject: 'podcast' }
    const gateway = fake({ get: () => Promise.resolve({ ok: false, failure }) })

    const result = await createCatalogQueries({ gateway }).getEpisodeDetail('missing')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toBe(failure)
  })

  test('verifies: CI-Q2 — gateway の reject はそのまま伝わる', async () => {
    const gateway = fake({ get: () => Promise.reject(new Error('boom')) })
    await expect(createCatalogQueries({ gateway }).getEpisodeDetail('p1')).rejects.toThrow('boom')
  })

  test.each([
    ['operator', true],
    ['user', false],
    ['unknown', false],
  ] as Array<[SourceOrigin, boolean]>)(
    'verifies: CI-Q2 (web-rule-catalog-10) — 出典の由来が %s なら CC BY-SA の通知は %s',
    async (origin, expected) => {
      const sources = [sourceCredit({ articleId: 'a', title: 't', url: 'https://example.com/a', siteName: 'S' }, origin)]
      const gateway = fake({ get: (id) => Promise.resolve({ ok: true, value: record(id, { sources }) }) })

      const result = await createCatalogQueries({ gateway }).getEpisodeDetail('p1')

      expect(result.ok && result.value.showsShareAlikeNotice).toBe(expected)
    },
  )

  test('verifies: CI-Q2 (web-rule-catalog-10) — 出典なしなら通知は偽', async () => {
    const gateway = fake({ get: (id) => Promise.resolve({ ok: true, value: record(id, { sources: [] }) }) })
    const result = await createCatalogQueries({ gateway }).getEpisodeDetail('p1')
    expect(result.ok && result.value.showsShareAlikeNotice).toBe(false)
  })
})

describe('watchGeneration (web-query-catalog-04)', () => {
  test('web-usecase-19 verifies: CI-Q3 — processing → completed の id を completedIds に返し、gateway を呼ばない', () => {
    const gateway = fake({})

    const result = createCatalogQueries({ gateway }).watchGeneration(
      [{ id: 'a', generation: 'processing' }],
      [{ id: 'a', generation: 'completed' }],
    )

    expect(result).toEqual({ completedIds: ['a'] })
    expect(gateway.calls).toEqual([])
  })

  test('verifies: CI-Q3 — 戻りは completedIds だけ（shouldStop を返さない。web-dec-102）', () => {
    const result = createCatalogQueries({ gateway: fake({}) }).watchGeneration([], [])
    expect(Object.keys(result)).toEqual(['completedIds'])
  })
})
