// @vitest-environment node
// Catalog の query の分離（web-check-07）。本 slice の分: web-query-catalog-02〜04。
// (a) CatalogQueries の入口の名前の集合 = 4（listEpisodes・getEpisodeDetail・watchGeneration・getFeed）と、CatalogCommands の入口 = 4（starArticle・bulkStar・dismissArticle・unstarArticle）。型の等価と実行時の両方で過不足なく一致する。
// (b) 呼出を記録する手書きの CatalogGateway の fake（書き込み系 3 method は記録してから reject する）を渡し、query を全部呼んでも fake への記録は読み取り 4 種類だけ。
// (c) 戻り値がリードモデルの型（Result の中身を含む）。command の戻り値はリードモデルでない（bulkStar の receipt は id の配列と GenerationLimit だけ）。
// 型の等価は `npm run typecheck` が検査する（等価でなければ代入が TS2322 で落ちる）。実行時の検査は vitest が行う。
// createCatalogGateway・createGatewayDouble は import しない（unit が infrastructure を値で import すると forbiddenDependency になる）。
// ApiGateway レベルで GET だけであることは catalogGateway.test.ts（adapter）が持つ。
//
// RED 理由（実装前）: `@/lib/catalog/application/commands`（createCatalogCommands・CatalogCommands）が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createCatalogCommands } from '@/lib/catalog/application/commands'
import type { CatalogCommands } from '@/lib/catalog/application/commands'
import { createCatalogQueries } from '@/lib/catalog/application/queries'
import type { CatalogQueries, GenerationWatchResult } from '@/lib/catalog/application/queries'
import type { CatalogGateway, EpisodeRecord } from '@/lib/catalog/application/ports'
import type { EpisodeCardView, EpisodeDetailView } from '@/lib/catalog/application/readModels'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

// ---------------------------------------------------------------------------
// 型の等価（実行しない。typecheck だけが読む）
// ---------------------------------------------------------------------------
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

type QueryNames = 'listEpisodes' | 'getEpisodeDetail' | 'watchGeneration' | 'getFeed'
type CommandNames = 'starArticle' | 'bulkStar' | 'dismissArticle' | 'unstarArticle'

function typeProbes(queries: CatalogQueries): void {
  // (a) 名前の集合が過不足なく一致する
  const queryKeys: Equals<keyof CatalogQueries, QueryNames> = true
  // deps は gateway だけ（Playback の query を取らない）
  const depKeys: Equals<keyof Parameters<typeof createCatalogQueries>[0], 'gateway'> = true
  // (c) 戻り値はリードモデル（Result の中身を含む）
  const list: Equals<ReturnType<CatalogQueries['listEpisodes']>, Promise<Result<ReadonlyArray<EpisodeCardView>, ApiFailure>>> = true
  const detail: Equals<ReturnType<CatalogQueries['getEpisodeDetail']>, Promise<Result<EpisodeDetailView, ApiFailure>>> = true
  const watch: Equals<ReturnType<CatalogQueries['watchGeneration']>, GenerationWatchResult> = true
  const watchShape: Equals<GenerationWatchResult, { readonly completedIds: ReadonlyArray<string> }> = true
  const created: CatalogQueries = createCatalogQueries({ gateway: undefined as unknown as CatalogGateway })
  // command の入口の名前の集合と deps
  const commandKeys: Equals<keyof CatalogCommands, CommandNames> = true
  const commandDepKeys: Equals<keyof Parameters<typeof createCatalogCommands>[0], 'gateway'> = true
  const createdCommands: CatalogCommands = createCatalogCommands({ gateway: undefined as unknown as CatalogGateway })
  void [queries, queryKeys, depKeys, list, detail, watch, watchShape, created, commandKeys, commandDepKeys, createdCommands]
}
void typeProbes

// ---------------------------------------------------------------------------
// 呼出を記録する fake（書き込み系 3 method は記録してから reject する。記録しなければ (b) に識別力が無い）
// ---------------------------------------------------------------------------
const READ_CALLS: ReadonlySet<string> = new Set(['listEpisodes', 'getEpisode', 'getFeed', 'getStarredArticles'])

const RECORD: EpisodeRecord = {
  episode: {
    kind: 'playable',
    id: 'p1',
    title: 'T',
    label: { title: 'T', intro: 'イントロ' },
    audioUrl: 'https://example.com/p1.mp3',
    durationSeconds: 600,
    difficulty: 'toeic_600',
    createdAt: '2026-05-31T06:00:00Z',
    serverPositionSeconds: 0,
  },
  generation: 'completed',
  isDigest: false,
  intro: 'イントロ',
  label: { title: 'T', intro: 'イントロ' },
  difficulty: 'toeic_600',
  durationSeconds: 600,
  createdAt: '2026-05-31T06:00:00Z',
  transcript: [],
  glossary: [],
  quiz: [],
  sources: [],
}

function harness() {
  const calls: string[] = []
  const gateway: CatalogGateway = {
    listEpisodes: () => {
      calls.push('listEpisodes')
      return Promise.resolve({ ok: true, value: [RECORD] })
    },
    getEpisode: () => {
      calls.push('getEpisode')
      return Promise.resolve({ ok: true, value: RECORD })
    },
    getFeed: () => {
      calls.push('getFeed')
      return Promise.resolve({ ok: true, value: { articles: [], starredIds: [], date: null } })
    },
    getStarredArticles: () => {
      calls.push('getStarredArticles')
      return Promise.resolve({ ok: true, value: [] })
    },
    starArticle: () => {
      calls.push('starArticle')
      return Promise.resolve({ ok: true, value: { remaining: null } })
    },
    dismissArticle: () => {
      calls.push('dismissArticle')
      return Promise.resolve({ ok: true, value: undefined })
    },
    unstarArticle: () => {
      calls.push('unstarArticle')
      return Promise.resolve({ ok: true, value: undefined })
    },
  }
  return { queries: createCatalogQueries({ gateway }), calls, gateway }
}

// ---------------------------------------------------------------------------
// (a) 名前の集合
// ---------------------------------------------------------------------------
describe('web-check-07 (a) query 4 つは過不足なく公開される', () => {
  test('verifies: CI-Q4 (web-check-07, web-query-catalog-02) — 戻り値の key は listEpisodes・getEpisodeDetail・watchGeneration・getFeed の 4 つだけで、すべて関数', () => {
    const { queries } = harness()
    const names: readonly QueryNames[] = ['listEpisodes', 'getEpisodeDetail', 'watchGeneration', 'getFeed']

    expect(names).toHaveLength(4)
    expect(Object.keys(queries).sort()).toEqual([...names].sort())
    for (const name of names) expect(typeof queries[name], name).toBe('function')
  })
})

describe('web-check-07 (a) command 4 つは過不足なく公開される', () => {
  test('verifies: CI-RL4 (web-check-07, web-cmd-catalog-01) — 戻り値の key は starArticle・bulkStar・dismissArticle・unstarArticle の 4 つだけで、すべて関数', () => {
    const { gateway } = harness()
    const commands = createCatalogCommands({ gateway })
    const names: readonly CommandNames[] = ['starArticle', 'bulkStar', 'dismissArticle', 'unstarArticle']

    expect(Object.keys(commands).sort()).toEqual([...names].sort())
    for (const name of names) expect(typeof commands[name], name).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// (b) query は読むだけ
// ---------------------------------------------------------------------------
describe('web-check-07 (b) query を全部呼んでも、gateway への呼出は読み取りだけ', () => {
  test('verifies: CI-Q4 — 正方向対照: listEpisodes() を呼べば fake に listEpisodes が 1 回だけ記録される（記録が配線されている）', async () => {
    const { queries, calls } = harness()

    await queries.listEpisodes()

    expect(calls).toEqual(['listEpisodes'])
  })

  test('verifies: CI-Q4 — 正方向対照: getFeed() を呼べば fake に getFeed・getStarredArticles が 1 回ずつ記録される（記録が配線されている）', async () => {
    const { queries, calls } = harness()

    const view = await queries.getFeed()
    if ('feed' in view) await view.starred

    expect([...calls].sort()).toEqual(['getFeed', 'getStarredArticles'])
  })

  test('verifies: CI-Q4 — 4 つの query を全部呼んでも、記録は読み取り 4 種類だけ（書き込み系 3 つは 1 回も呼ばれない。watchGeneration は gateway を呼ばない）', async () => {
    const { queries, calls, gateway } = harness()

    await queries.listEpisodes()
    await queries.getEpisodeDetail('p1')
    queries.watchGeneration([], [{ id: 'p1', generation: 'completed' }])
    const view = await queries.getFeed()
    if ('feed' in view) await view.starred

    expect([...calls].sort()).toEqual(['getEpisode', 'getFeed', 'getStarredArticles', 'listEpisodes'])
    expect(calls.every((name) => READ_CALLS.has(name))).toBe(true)
    for (const write of ['starArticle', 'dismissArticle', 'unstarArticle']) expect(calls).not.toContain(write)
    // fake は 7 method を持ち（書き込み系は記録してから reject する形で用意している）、query が呼べば記録に残る
    expect(Object.keys(gateway).sort()).toEqual([
      'dismissArticle',
      'getEpisode',
      'getFeed',
      'getStarredArticles',
      'listEpisodes',
      'starArticle',
      'unstarArticle',
    ])
  })
})

// ---------------------------------------------------------------------------
// (c) 戻り値はリードモデル
// ---------------------------------------------------------------------------
describe('web-check-07 (c) 戻り値はリードモデルで、record・DTO・Episode ではない', () => {
  test('verifies: CI-Q4 — listEpisodes・getEpisodeDetail の値は episode を持たず、watchGeneration は completedIds だけを持つ', async () => {
    const { queries } = harness()

    const listed = await queries.listEpisodes()
    const detail = await queries.getEpisodeDetail('p1')

    expect(listed.ok).toBe(true)
    expect(detail.ok).toBe(true)
    if (!listed.ok || !detail.ok) return
    expect(listed.value[0]).not.toHaveProperty('episode')
    expect(detail.value).not.toHaveProperty('episode')
    expect(Object.keys(queries.watchGeneration([], []))).toEqual(['completedIds'])
  })
})

describe('web-check-07 (c) command の戻り値はリードモデルでない', () => {
  test('verifies: CI-RL4 (web-rule-catalog-05) — bulkStar の receipt は starred・failed（id の配列）と limit だけ', async () => {
    const { gateway } = harness()
    const commands = createCatalogCommands({ gateway })

    const receipt = await commands.bulkStar(['a1', 'a2'])

    expect(Object.keys(receipt).sort()).toEqual(['failed', 'limit', 'starred'])
    expect(receipt.starred).toEqual(['a1', 'a2'])
    expect(receipt.failed).toEqual([])
    expect(receipt.limit).toBeNull()
    for (const id of [...receipt.starred, ...receipt.failed]) expect(typeof id).toBe('string')
  })

  test('verifies: CI-RL4 — starArticle の値は remaining だけで、記事のリードモデル（title など）を持たない', async () => {
    const { gateway } = harness()
    const result = await createCatalogCommands({ gateway }).starArticle('a1')

    expect(result.ok && Object.keys(result.value)).toEqual(['remaining'])
  })
})
