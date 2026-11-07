// @vitest-environment node
// Catalog の query の分離（web-check-07）。本 slice の分: web-query-catalog-02〜04。
// (a) CatalogQueries の入口の名前の集合 = 3（listEpisodes・getEpisodeDetail・watchGeneration）。型の等価と実行時の両方で過不足なく一致する。
// (b) 呼出を記録する手書きの CatalogGateway の fake（読み取り 2 種類だけを持つ）を渡し、query を全部呼んでも fake への呼出は読み取りだけ。
// (c) 戻り値がリードモデルの型（Result の中身を含む）。
// 型の等価は `npm run typecheck` が検査する（等価でなければ代入が TS2322 で落ちる）。実行時の検査は vitest が行う。
// createCatalogGateway・createGatewayDouble は import しない（unit が infrastructure を値で import すると forbiddenDependency になる）。
// ApiGateway レベルで GET だけであることは catalogGateway.test.ts（adapter）が持つ。
//
// RED 理由（実装前）: `@/lib/catalog/application/queries`（createCatalogQueries・CatalogQueries）が無い（module not found）。
import { describe, expect, test } from 'vitest'
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

type QueryNames = 'listEpisodes' | 'getEpisodeDetail' | 'watchGeneration'

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
  void [queries, queryKeys, depKeys, list, detail, watch, watchShape, created]
}
void typeProbes

// ---------------------------------------------------------------------------
// 呼出を記録する fake（読み取り 2 種類だけ。書き込み系のメソッドを持たない）
// ---------------------------------------------------------------------------
const READ_CALLS: ReadonlySet<string> = new Set(['listEpisodes', 'getEpisode'])

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
  }
  return { queries: createCatalogQueries({ gateway }), calls, gateway }
}

// ---------------------------------------------------------------------------
// (a) 名前の集合
// ---------------------------------------------------------------------------
describe('web-check-07 (a) query 3 つは過不足なく公開される', () => {
  test('verifies: CI-Q4 (web-check-07, web-query-catalog-02) — 戻り値の key は listEpisodes・getEpisodeDetail・watchGeneration の 3 つだけで、すべて関数', () => {
    const { queries } = harness()
    const names: readonly QueryNames[] = ['listEpisodes', 'getEpisodeDetail', 'watchGeneration']

    expect(names).toHaveLength(3)
    expect(Object.keys(queries).sort()).toEqual([...names].sort())
    for (const name of names) expect(typeof queries[name], name).toBe('function')
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

  test('verifies: CI-Q4 — 3 つの query を全部呼んでも、記録は読み取り 2 種類だけ（watchGeneration は gateway を呼ばない）', async () => {
    const { queries, calls, gateway } = harness()

    await queries.listEpisodes()
    await queries.getEpisodeDetail('p1')
    queries.watchGeneration([], [{ id: 'p1', generation: 'completed' }])

    expect(calls).toEqual(['listEpisodes', 'getEpisode'])
    expect(calls.every((name) => READ_CALLS.has(name))).toBe(true)
    // fake は読み取りの 2 つしか持たない（書き込み系のメソッドがあれば、ここで増える）
    expect(Object.keys(gateway).sort()).toEqual(['getEpisode', 'listEpisodes'])
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
