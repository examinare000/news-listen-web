// Catalog application の query: listEpisodes（web-query-catalog-02）・getEpisodeDetail（web-query-catalog-03）・watchGeneration（web-query-catalog-04）。
// 手書きの CatalogGateway fake を渡す。`generationWatch`・`readModels` は値で import しない（期待値は literal）。
//
// RED 理由（実装前）: `@/lib/catalog/application/queries` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createCatalogQueries } from '@/lib/catalog/application/queries'
import type { CatalogGateway, EpisodeRecord } from '@/lib/catalog/application/ports'
import type { ArticleRef } from '@/lib/catalog/domain/article'
import type { FeaturedSourceRef, SourceRef } from '@/lib/catalog/domain/source'
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

type FeedSnapshot = { readonly articles: ReadonlyArray<ArticleRef>; readonly starredIds: ReadonlyArray<string>; readonly date: string | null }

function fake(handlers: {
  list?: () => Promise<Result<ReadonlyArray<EpisodeRecord>, ApiFailure>>
  get?: (id: string) => Promise<Result<EpisodeRecord, ApiFailure>>
  /** n = その gateway で何回目の getFeed か（1 始まり） */
  feed?: (n: number) => Promise<Result<FeedSnapshot, ApiFailure>>
  starred?: (n: number) => Promise<Result<ReadonlyArray<ArticleRef>, ApiFailure>>
  sources?: () => Promise<Result<ReadonlyArray<SourceRef>, ApiFailure>>
  featured?: () => Promise<Result<ReadonlyArray<FeaturedSourceRef>, ApiFailure>>
  onboarding?: () => Promise<Result<{ readonly completed: boolean }, ApiFailure>>
}): FakeGateway {
  const calls: string[] = []
  let feedCount = 0
  let starredCount = 0
  // 変更系は記録してから reject する（query が呼べば calls に残る）
  const forbidden = (name: string) => () => {
    calls.push(name)
    return Promise.reject(new Error(`${name} は query から呼ばれない`))
  }
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
    getFeed: () => {
      calls.push('getFeed')
      feedCount += 1
      return handlers.feed?.(feedCount) ?? Promise.reject(new Error('getFeed を想定していない'))
    },
    getStarredArticles: () => {
      calls.push('getStarredArticles')
      starredCount += 1
      return handlers.starred?.(starredCount) ?? Promise.reject(new Error('getStarredArticles を想定していない'))
    },
    starArticle: forbidden('starArticle'),
    dismissArticle: forbidden('dismissArticle'),
    unstarArticle: forbidden('unstarArticle'),
    getSources: () => {
      calls.push('getSources')
      return handlers.sources?.() ?? Promise.reject(new Error('getSources を想定していない'))
    },
    addSource: forbidden('addSource'),
    deleteSource: forbidden('deleteSource'),
    getFeaturedSources: () => {
      calls.push('getFeaturedSources')
      return handlers.featured?.() ?? Promise.reject(new Error('getFeaturedSources を想定していない'))
    },
    getOnboardingStatus: () => {
      calls.push('getOnboardingStatus')
      return handlers.onboarding?.() ?? Promise.reject(new Error('getOnboardingStatus を想定していない'))
    },
    completeOnboarding: forbidden('completeOnboarding'),
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

// ---------------------------------------------------------------------------
// getFeed（web-query-catalog-01・web-dec-103・web-dec-105・web-dec-108）: 2 段で返し、古い取得は stale にする
// ---------------------------------------------------------------------------
function articleRef(id: string): ArticleRef {
  return { id, title: `title ${id}`, source: 'Site', url: `https://example.com/${id}`, score: 1, publishedAt: '2026-05-31T06:00:00Z' }
}

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(reason: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const feedOk = (ids: string[], starredIds: string[] = [], date: string | null = '2026-06-01'): Result<FeedSnapshot, ApiFailure> => ({
  ok: true,
  value: { articles: ids.map(articleRef), starredIds, date },
})

describe('getFeed (web-query-catalog-01)', () => {
  test('verifies: CI-FD1 — 呼出の直後（await の前）に getStarredArticles → getFeed の順で 1 回ずつ開始する', () => {
    const gateway = fake({
      feed: () => new Promise(() => {}),
      starred: () => new Promise(() => {}),
    })

    void createCatalogQueries({ gateway }).getFeed()

    expect(gateway.calls).toEqual(['getStarredArticles', 'getFeed'])
  })

  test('verifies: CI-FD2 — getStarredArticles が未解決でも 1 段目は解決し、feed は loaded', async () => {
    const starred = deferred<Result<ReadonlyArray<ArticleRef>, ApiFailure>>()
    const gateway = fake({ feed: () => Promise.resolve(feedOk(['a1', 'a2'], ['a1'], '2026-06-01')), starred: () => starred.promise })

    const view = await createCatalogQueries({ gateway }).getFeed()

    expect('feed' in view).toBe(true)
    if (!('feed' in view)) return
    expect(view.feed).toMatchObject({ articles: [{ id: 'a1', publishedAt: '2026-05-31T06:00:00Z' }, { id: 'a2' }], starredIds: ['a1'], date: '2026-06-01' })
    starred.resolve({ ok: true, value: [] })
    expect(await view.starred).toEqual({ articles: [] })
  })

  test('verifies: CI-FD3 — feed の failure は failed（同じ ApiFailure）、reject は loaded でも failed でもない', async () => {
    const failure: ApiFailure = { kind: 'server', status: 500 }
    const failed = await createCatalogQueries({
      gateway: fake({ feed: () => Promise.resolve({ ok: false, failure }), starred: () => Promise.resolve({ ok: true, value: [] }) }),
    }).getFeed()
    const rejected = await createCatalogQueries({
      gateway: fake({ feed: () => Promise.reject(new Error('boom')), starred: () => Promise.resolve({ ok: true, value: [] }) }),
    }).getFeed()

    if (!('feed' in failed) || !('feed' in rejected)) throw new Error('最新の取得は stale でない')
    expect('failure' in failed.feed && failed.feed.failure).toBe(failure)
    expect(failed.feed).not.toHaveProperty('articles')
    expect(rejected.feed).not.toHaveProperty('articles')
    expect(rejected.feed).not.toHaveProperty('failure')
  })

  test('verifies: CI-FD4 — starred: ok → articles、ok:false → not-ok（cause は同じ ApiFailure）', async () => {
    const failure: ApiFailure = { kind: 'timeout' }
    const ok = await createCatalogQueries({
      gateway: fake({ feed: () => Promise.resolve(feedOk([])), starred: () => Promise.resolve({ ok: true, value: [articleRef('s1')] }) }),
    }).getFeed()
    const notOk = await createCatalogQueries({
      gateway: fake({ feed: () => Promise.resolve(feedOk([])), starred: () => Promise.resolve({ ok: false, failure }) }),
    }).getFeed()

    if (!('feed' in ok) || !('feed' in notOk)) throw new Error('最新の取得は stale でない')
    expect(await ok.starred).toMatchObject({ articles: [{ id: 's1' }] })
    const outcome = await notOk.starred
    expect('cause' in outcome && outcome.cause).toBe(failure)
    expect(outcome).not.toHaveProperty('articles')
  })

  test('verifies: CI-FD4・FD5 — starred の reject は not-ok（cause = reject の値）に畳まれ、getFeed も starred も reject しない', async () => {
    const reason = new Error('starred boom')
    const view = await createCatalogQueries({
      gateway: fake({ feed: () => Promise.resolve(feedOk(['a1'])), starred: () => Promise.reject(reason) }),
    }).getFeed()

    if (!('feed' in view)) throw new Error('最新の取得は stale でない')
    const outcome = await view.starred
    expect('cause' in outcome && outcome.cause).toBe(reason)
  })

  test('verifies: CI-FD7 — feed が failed でも starred は ok で取れる', async () => {
    const view = await createCatalogQueries({
      gateway: fake({
        feed: () => Promise.resolve({ ok: false, failure: { kind: 'network' } }),
        starred: () => Promise.resolve({ ok: true, value: [articleRef('s1')] }),
      }),
    }).getFeed()

    if (!('feed' in view)) throw new Error('最新の取得は stale でない')
    expect(view.feed).toHaveProperty('failure')
    expect(await view.starred).toMatchObject({ articles: [{ id: 's1' }] })
  })

  test('verifies: CI-FD8 — getFeed() の後、gateway への記録に変更系 3 method が無い', async () => {
    const gateway = fake({ feed: () => Promise.resolve(feedOk(['a1'])), starred: () => Promise.resolve({ ok: true, value: [] }) })

    const view = await createCatalogQueries({ gateway }).getFeed()
    if ('feed' in view) await view.starred

    expect(gateway.calls).toEqual(['getStarredArticles', 'getFeed'])
  })

  test('verifies: CI-FD6 — 最新の取得の完了は stale でない（単独の取得、および先発の完了後の後発）', async () => {
    const gateway = fake({ feed: () => Promise.resolve(feedOk(['a1'])), starred: () => Promise.resolve({ ok: true, value: [] }) })
    const queries = createCatalogQueries({ gateway })

    const first = await queries.getFeed()
    const second = await queries.getFeed()

    expect('stale' in first).toBe(false)
    expect('stale' in second).toBe(false)
    expect(await ('starred' in second ? second.starred : Promise.resolve({ stale: true }))).not.toHaveProperty('stale')
  })

  test.each([
    ['成功', (): Result<FeedSnapshot, ApiFailure> => feedOk(['old'])],
    ['失敗', (): Result<FeedSnapshot, ApiFailure> => ({ ok: false, failure: { kind: 'server', status: 500 } })],
  ])('verifies: CI-FD6 — 後発が走れば先発の 1 段目は stale（先発の feed が %s）', async (_label, firstFeed) => {
    const feed1 = deferred<Result<FeedSnapshot, ApiFailure>>()
    const feed2 = deferred<Result<FeedSnapshot, ApiFailure>>()
    const gateway = fake({
      feed: (n) => (n === 1 ? feed1.promise : feed2.promise),
      starred: () => Promise.resolve({ ok: true, value: [] }),
    })
    const queries = createCatalogQueries({ gateway })

    const p1 = queries.getFeed()
    const p2 = queries.getFeed()
    feed2.resolve(feedOk(['new']))
    const second = await p2
    feed1.resolve(firstFeed())
    const first = await p1

    expect(first).toMatchObject({ stale: true })
    expect(first).not.toHaveProperty('feed')
    expect(second).not.toHaveProperty('stale')
    expect(await first.starred).toEqual({ stale: true })
  })

  test('verifies: CI-FD6 — 後発が走れば先発の feed の reject も stale', async () => {
    const feed1 = deferred<Result<FeedSnapshot, ApiFailure>>()
    const gateway = fake({
      feed: (n) => (n === 1 ? feed1.promise : Promise.resolve(feedOk(['new']))),
      starred: () => Promise.resolve({ ok: true, value: [] }),
    })
    const queries = createCatalogQueries({ gateway })

    const p1 = queries.getFeed()
    await queries.getFeed()
    feed1.reject(new Error('boom'))
    const first = await p1

    expect(first).toMatchObject({ stale: true })
    expect(first).not.toHaveProperty('feed')
  })

  test('verifies: CI-FD6 — 先発の starred が失敗していれば、stale でも cause を保つ', async () => {
    const failure: ApiFailure = { kind: 'server', status: 502 }
    const feed1 = deferred<Result<FeedSnapshot, ApiFailure>>()
    const gateway = fake({
      feed: (n) => (n === 1 ? feed1.promise : Promise.resolve(feedOk(['new']))),
      starred: (n) => (n === 1 ? Promise.resolve({ ok: false, failure }) : Promise.resolve({ ok: true, value: [] })),
    })
    const queries = createCatalogQueries({ gateway })

    const p1 = queries.getFeed()
    await queries.getFeed()
    feed1.resolve(feedOk(['old']))
    const first = await p1

    const outcome = await first.starred
    expect(outcome).toMatchObject({ stale: true })
    expect('cause' in outcome && outcome.cause).toBe(failure)
  })

  test('verifies: CI-FD6 — 1 段目が最新でも、starred の決着の前に新しい取得が始まれば starred は stale', async () => {
    const starred1 = deferred<Result<ReadonlyArray<ArticleRef>, ApiFailure>>()
    const gateway = fake({
      feed: () => Promise.resolve(feedOk(['a1'])),
      starred: (n) => (n === 1 ? starred1.promise : Promise.resolve({ ok: true, value: [] })),
    })
    const queries = createCatalogQueries({ gateway })

    const first = await queries.getFeed()
    expect(first).not.toHaveProperty('stale')
    void queries.getFeed()
    starred1.resolve({ ok: true, value: [articleRef('s1')] })

    expect(await first.starred).toMatchObject({ stale: true })
  })

  test('verifies: CI-FD6・FV2 — starred が（最新のうちに）先に決着し、その後に後発が始まって feed が遅れて決着 → 1 段目は stale で starred も StarredStale（cause を保つ）', async () => {
    const failure: ApiFailure = { kind: 'timeout' }
    const feed1 = deferred<Result<FeedSnapshot, ApiFailure>>()
    const gateway = fake({
      feed: (n) => (n === 1 ? feed1.promise : Promise.resolve(feedOk(['new']))),
      starred: (n) => (n === 1 ? Promise.resolve({ ok: false, failure }) : Promise.resolve({ ok: true, value: [] })),
    })
    const queries = createCatalogQueries({ gateway })

    const p1 = queries.getFeed()
    await Promise.resolve()
    await Promise.resolve()
    await queries.getFeed()
    feed1.resolve(feedOk(['old']))
    const first = await p1

    expect(first).toMatchObject({ stale: true })
    const outcome = await first.starred
    expect(outcome).toMatchObject({ stale: true })
    expect('cause' in outcome && outcome.cause).toBe(failure)
  })
})

// ---------------------------------------------------------------------------
// listSources・getFeaturedSources・getOnboardingStatus
// ---------------------------------------------------------------------------
const WRITE_CALLS = ['starArticle', 'dismissArticle', 'unstarArticle', 'addSource', 'deleteSource', 'completeOnboarding']

function isDeepFrozen(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return true
  if (!Object.isFrozen(value)) return false
  return Object.values(value).every(isDeepFrozen)
}

const featuredRef = (id: string, overrides: Partial<FeaturedSourceRef> = {}): FeaturedSourceRef => ({
  id,
  name: `name ${id}`,
  url: `https://example.com/${id}.xml`,
  category: 'tech',
  thumbnailUrl: null,
  description: null,
  ...overrides,
})

describe('listSources (web-query-catalog-05)', () => {
  test('web-query-catalog-05 — 購読一覧を gateway から 1 回だけ取り、{ name, url } の凍結した view を順序どおりに返す', async () => {
    const gateway = fake({
      sources: () =>
        Promise.resolve({
          ok: true,
          value: [
            { name: 'B', url: 'https://b.example/rss' },
            { name: 'A', url: 'https://a.example/rss' },
          ],
        }),
    })

    const result = await createCatalogQueries({ gateway }).listSources()

    expect(gateway.calls).toEqual(['getSources'])
    expect(result).toEqual({
      ok: true,
      value: [
        { name: 'B', url: 'https://b.example/rss' },
        { name: 'A', url: 'https://a.example/rss' },
      ],
    })
    expect(result.ok && isDeepFrozen(result.value)).toBe(true)
  })

  test('web-query-catalog-05 — 空の一覧は空のまま ok で、変更系は 1 回も呼ばれない', async () => {
    const gateway = fake({ sources: () => Promise.resolve({ ok: true, value: [] }) })

    expect(await createCatalogQueries({ gateway }).listSources()).toEqual({ ok: true, value: [] })
    for (const write of WRITE_CALLS) expect(gateway.calls).not.toContain(write)
  })

  test('web-query-catalog-05 — gateway の failure は同じ参照のまま返し、value を持たない', async () => {
    const failure: ApiFailure = { kind: 'server', status: 503 }
    const gateway = fake({ sources: () => Promise.resolve({ ok: false, failure }) })

    const result = await createCatalogQueries({ gateway }).listSources()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toBe(failure)
    expect(result).not.toHaveProperty('value')
  })

  test('web-query-catalog-05 — gateway の reject はそのまま伝わる', async () => {
    const gateway = fake({ sources: () => Promise.reject(new Error('boom')) })
    await expect(createCatalogQueries({ gateway }).listSources()).rejects.toThrow('boom')
  })

  test('web-query-catalog-05 — 呼ぶたびに別の凍結した値になり、gateway の object と参照を共有しない', async () => {
    const raw: SourceRef[] = [{ name: 'A', url: 'https://a.example/rss' }]
    const gateway = fake({ sources: () => Promise.resolve({ ok: true, value: raw }) })
    const queries = createCatalogQueries({ gateway })

    const first = await queries.listSources()
    const second = await queries.listSources()

    if (!first.ok || !second.ok) throw new Error('成功のはず')
    expect(first.value).not.toBe(raw)
    expect(first.value[0]).not.toBe(raw[0])
    expect(first.value).not.toBe(second.value)
    expect(first.value[0]).not.toBe(second.value[0])
    expect(isDeepFrozen(first.value)).toBe(true)
    expect(isDeepFrozen(second.value)).toBe(true)
  })
})

describe('getFeaturedSources (web-query-catalog-06)', () => {
  test('web-query-catalog-06 — featured を gateway から 1 回だけ取り、全 field を保った凍結 view を順序どおりに返す。購読一覧は引かない', async () => {
    const gateway = fake({
      featured: () =>
        Promise.resolve({
          ok: true,
          value: [
            featuredRef('f2', { category: 'sports', thumbnailUrl: 'https://img.example/f2.png', description: 'desc' }),
            featuredRef('f1'),
          ],
        }),
    })

    const result = await createCatalogQueries({ gateway }).getFeaturedSources()

    expect(gateway.calls).toEqual(['getFeaturedSources'])
    expect(gateway.calls).not.toContain('getSources')
    expect(result).toEqual({
      ok: true,
      value: [
        {
          id: 'f2',
          name: 'name f2',
          url: 'https://example.com/f2.xml',
          category: 'sports',
          thumbnailUrl: 'https://img.example/f2.png',
          description: 'desc',
        },
        { id: 'f1', name: 'name f1', url: 'https://example.com/f1.xml', category: 'tech', thumbnailUrl: null, description: null },
      ],
    })
    expect(result.ok && isDeepFrozen(result.value)).toBe(true)
  })

  test('web-query-catalog-06 — gateway の failure は同じ参照のまま返し、購読一覧は引かない', async () => {
    const failure: ApiFailure = { kind: 'network' }
    const gateway = fake({ featured: () => Promise.resolve({ ok: false, failure }) })

    const result = await createCatalogQueries({ gateway }).getFeaturedSources()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toBe(failure)
    expect(gateway.calls).toEqual(['getFeaturedSources'])
  })

  test('web-query-catalog-06 — gateway の reject はそのまま伝わる', async () => {
    const gateway = fake({ featured: () => Promise.reject(new Error('boom')) })
    await expect(createCatalogQueries({ gateway }).getFeaturedSources()).rejects.toThrow('boom')
  })

  test('web-query-catalog-06 — 呼ぶたびに別の凍結した値になり、gateway の object と参照を共有しない', async () => {
    const raw: FeaturedSourceRef[] = [featuredRef('f1')]
    const gateway = fake({ featured: () => Promise.resolve({ ok: true, value: raw }) })
    const queries = createCatalogQueries({ gateway })

    const first = await queries.getFeaturedSources()
    const second = await queries.getFeaturedSources()

    if (!first.ok || !second.ok) throw new Error('成功のはず')
    expect(first.value).not.toBe(raw)
    expect(first.value[0]).not.toBe(raw[0])
    expect(first.value).not.toBe(second.value)
    expect(first.value[0]).not.toBe(second.value[0])
    expect(isDeepFrozen(first.value)).toBe(true)
    expect(isDeepFrozen(second.value)).toBe(true)
  })
})

describe('getOnboardingStatus (web-query-catalog-07)', () => {
  test.each([true, false])('web-query-catalog-07 — completed=%s を gateway から 1 回だけ取り、{ completed } だけの凍結した値を返す', async (completed) => {
    const gateway = fake({ onboarding: () => Promise.resolve({ ok: true, value: { completed } }) })

    const result = await createCatalogQueries({ gateway }).getOnboardingStatus()

    expect(gateway.calls).toEqual(['getOnboardingStatus'])
    expect(result).toEqual({ ok: true, value: { completed } })
    if (!result.ok) return
    expect(Object.keys(result.value)).toEqual(['completed'])
    expect(isDeepFrozen(result.value)).toBe(true)
  })

  test('web-query-catalog-07 — gateway の failure は同じ参照のまま返す', async () => {
    const failure: ApiFailure = { kind: 'server', status: 500 }
    const gateway = fake({ onboarding: () => Promise.resolve({ ok: false, failure }) })

    const result = await createCatalogQueries({ gateway }).getOnboardingStatus()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toBe(failure)
  })

  test('web-query-catalog-07 — gateway の reject はそのまま伝わる', async () => {
    const gateway = fake({ onboarding: () => Promise.reject(new Error('boom')) })
    await expect(createCatalogQueries({ gateway }).getOnboardingStatus()).rejects.toThrow('boom')
  })

  test('web-query-catalog-07 — 呼ぶたびに別の凍結した値になり、gateway の object と参照を共有しない', async () => {
    const raw = { completed: true }
    const gateway = fake({ onboarding: () => Promise.resolve({ ok: true, value: raw }) })
    const queries = createCatalogQueries({ gateway })

    const first = await queries.getOnboardingStatus()
    const second = await queries.getOnboardingStatus()

    if (!first.ok || !second.ok) throw new Error('成功のはず')
    expect(first.value).not.toBe(raw)
    expect(first.value).not.toBe(second.value)
    expect(Object.isFrozen(first.value)).toBe(true)
    expect(Object.isFrozen(second.value)).toBe(true)
  })
})
