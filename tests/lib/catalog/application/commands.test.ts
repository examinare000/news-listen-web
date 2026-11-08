// Catalog application の command（web-cmd-catalog-01〜04・web-rule-catalog-05）: starArticle・bulkStar・dismissArticle・unstarArticle。
// 手書きの CatalogGateway fake を渡す。`createCatalogGateway`・`createGatewayDouble` は import しない（unit が infrastructure を値で import すると forbiddenDependency）。
// `classifyGenerationLimit` も値で import しない（GenerationLimit の期待値は literal）。
//
// RED 理由（実装前）: `@/lib/catalog/application/commands` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createCatalogCommands, UNSTAR_IGNORED } from '@/lib/catalog/application/commands'
import type { AddSourceGatewayFailure, CatalogGateway } from '@/lib/catalog/application/ports'
import type { SourceRef } from '@/lib/catalog/domain/source'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

type StarResult = Result<{ readonly remaining: number | null }, ApiFailure>
type VoidResult = Result<void, ApiFailure>
type AddResult = Result<ReadonlyArray<SourceRef>, AddSourceGatewayFailure>
type SourcesResult = Result<ReadonlyArray<SourceRef>, ApiFailure>

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

interface Harness {
  readonly gateway: CatalogGateway
  readonly starCalls: Array<readonly unknown[]>
  readonly unstarCalls: string[]
  readonly dismissCalls: string[]
  /** addSource の引数（name, url）を呼出順に記録する */
  readonly addCalls: Array<readonly unknown[]>
  readonly deleteCalls: string[]
  readonly completeCalls: number[]
}

function harness(handlers: {
  star?: (id: string, difficulty?: string) => Promise<StarResult>
  dismiss?: (id: string) => Promise<VoidResult>
  unstar?: (id: string, n: number) => Promise<VoidResult>
  add?: (name: string, url: string) => Promise<AddResult>
  remove?: (url: string) => Promise<SourcesResult>
  complete?: () => Promise<VoidResult>
}): Harness {
  const starCalls: Array<readonly unknown[]> = []
  const unstarCalls: string[] = []
  const dismissCalls: string[] = []
  const addCalls: Array<readonly unknown[]> = []
  const deleteCalls: string[] = []
  const completeCalls: number[] = []
  const unexpected = (name: string) => () => Promise.reject(new Error(`${name} を想定していない`))
  const gateway: CatalogGateway = {
    listEpisodes: unexpected('listEpisodes'),
    getEpisode: unexpected('getEpisode'),
    getFeed: unexpected('getFeed'),
    getStarredArticles: unexpected('getStarredArticles'),
    // 引数の個数を見るため rest で受ける
    starArticle: (...args: [string, string?]) => {
      starCalls.push(args)
      return handlers.star?.(...args) ?? Promise.reject(new Error('starArticle を想定していない'))
    },
    dismissArticle: (id) => {
      dismissCalls.push(id)
      return handlers.dismiss?.(id) ?? Promise.reject(new Error('dismissArticle を想定していない'))
    },
    unstarArticle: (id) => {
      unstarCalls.push(id)
      return handlers.unstar?.(id, unstarCalls.length) ?? Promise.reject(new Error('unstarArticle を想定していない'))
    },
    getSources: unexpected('getSources'),
    addSource: (name, url) => {
      addCalls.push([name, url])
      return handlers.add?.(name, url) ?? Promise.reject(new Error('addSource を想定していない'))
    },
    deleteSource: (url) => {
      deleteCalls.push(url)
      return handlers.remove?.(url) ?? Promise.reject(new Error('deleteSource を想定していない'))
    },
    getFeaturedSources: unexpected('getFeaturedSources'),
    getOnboardingStatus: unexpected('getOnboardingStatus'),
    completeOnboarding: () => {
      completeCalls.push(completeCalls.length + 1)
      return handlers.complete?.() ?? Promise.reject(new Error('completeOnboarding を想定していない'))
    },
  }
  return { gateway, starCalls, unstarCalls, dismissCalls, addCalls, deleteCalls, completeCalls }
}

const starOk = (remaining: number | null = null): StarResult => ({ ok: true, value: { remaining } })
const rateLimited = (detail: string, retryAfterSeconds: number | undefined = undefined): StarResult => ({
  ok: false,
  failure: { kind: 'rate_limited', retryAfterSeconds, scope: 'unknown', detail },
})

describe('starArticle (web-cmd-catalog-01)', () => {
  test('verifies: CI-CM1 — difficulty があれば gateway へ渡し、無ければ引数 1 個で呼ぶ（difficulty を渡さない）', async () => {
    const { gateway, starCalls } = harness({ star: () => Promise.resolve(starOk()) })
    const commands = createCatalogCommands({ gateway })

    await commands.starArticle('a1', 'toeic_900')
    await commands.starArticle('a1')

    expect(starCalls[0]).toEqual(['a1', 'toeic_900'])
    expect(starCalls[1]).toHaveLength(1)
    expect(starCalls[1]).toEqual(['a1'])
  })

  test('verifies: CI-CM1 — remaining は数値のときだけその値、null は null', async () => {
    const commands = (value: number | null) =>
      createCatalogCommands({ gateway: harness({ star: () => Promise.resolve(starOk(value)) }).gateway })

    expect(await commands(3).starArticle('a1')).toEqual({ ok: true, value: { remaining: 3 } })
    expect(await commands(0).starArticle('a1')).toEqual({ ok: true, value: { remaining: 0 } })
    expect(await commands(null).starArticle('a1')).toEqual({ ok: true, value: { remaining: null } })
  })

  test('verifies: CI-CM1 — remaining が数値でない（欠落）応答は null', async () => {
    const { gateway } = harness({ star: () => Promise.resolve({ ok: true, value: {} } as unknown as StarResult) })
    const result = await createCatalogCommands({ gateway }).starArticle('a1')
    expect(result).toEqual({ ok: true, value: { remaining: null } })
  })

  test('verifies: CI-CM2 — not_found・unauthorized は種別だけの failure', async () => {
    const run = (failure: ApiFailure) =>
      createCatalogCommands({ gateway: harness({ star: () => Promise.resolve({ ok: false, failure }) }).gateway }).starArticle('a1')

    expect(await run({ kind: 'not_found', subject: 'article' })).toEqual({ ok: false, failure: { kind: 'not_found' } })
    expect(await run({ kind: 'unauthorized' })).toEqual({ ok: false, failure: { kind: 'unauthorized' } })
  })

  test('verifies: CI-CM2 — rate_limited は generation_limit（detail・retryAfterSeconds から期間を分類）', async () => {
    const run = (result: StarResult) =>
      createCatalogCommands({ gateway: harness({ star: () => Promise.resolve(result) }).gateway }).starArticle('a1')

    expect(await run(rateLimited('Monthly generation limit reached', 3600))).toEqual({
      ok: false,
      failure: { kind: 'generation_limit', limit: { period: 'monthly', retryAfterSeconds: 3600 } },
    })
    expect(await run(rateLimited('daily limit'))).toEqual({
      ok: false,
      failure: { kind: 'generation_limit', limit: { period: 'daily', retryAfterSeconds: null } },
    })
  })

  test('verifies: CI-CM2 — それ以外（server 500）は failed で、ApiFailure は同じ参照', async () => {
    const failure: ApiFailure = { kind: 'server', status: 500 }
    const result = await createCatalogCommands({
      gateway: harness({ star: () => Promise.resolve({ ok: false, failure }) }).gateway,
    }).starArticle('a1')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('failed')
    expect(result.failure.kind === 'failed' && result.failure.failure).toBe(failure)
  })

  test('verifies: CI-CM6 — gateway の reject を握りつぶさずそのまま reject する（starArticle・dismissArticle）', async () => {
    const commands = createCatalogCommands({
      gateway: harness({ star: () => Promise.reject(new Error('boom star')), dismiss: () => Promise.reject(new Error('boom dismiss')) }).gateway,
    })

    await expect(commands.starArticle('a1')).rejects.toThrow('boom star')
    await expect(commands.dismissArticle('a1')).rejects.toThrow('boom dismiss')
  })
})

describe('dismissArticle (web-cmd-catalog-03)', () => {
  test('verifies: CI-CM3 — ok と failure を変えずに返す（failure は同じ参照）', async () => {
    const failure: ApiFailure = { kind: 'forbidden' }
    const okCommands = createCatalogCommands({
      gateway: harness({ dismiss: () => Promise.resolve({ ok: true, value: undefined }) }).gateway,
    })
    const ngCommands = createCatalogCommands({
      gateway: harness({ dismiss: () => Promise.resolve({ ok: false, failure }) }).gateway,
    })

    expect(await okCommands.dismissArticle('a1')).toEqual({ ok: true, value: undefined })
    const ng = await ngCommands.dismissArticle('a1')
    expect(!ng.ok && ng.failure).toBe(failure)
  })
})

describe('unstarArticle (web-cmd-catalog-04・web-dec-106)', () => {
  test('verifies: CI-CM4 — 進行中の同じ id は gateway を呼ばず UNSTAR_IGNORED（同じ参照）を返す。1 回目は UNSTAR_IGNORED でない', async () => {
    const pending = deferred<VoidResult>()
    const { gateway, unstarCalls } = harness({ unstar: () => pending.promise })
    const commands = createCatalogCommands({ gateway })

    const first = commands.unstarArticle('a1')
    const second = commands.unstarArticle('a1')

    expect(first).not.toBe(UNSTAR_IGNORED)
    expect(second).toBe(UNSTAR_IGNORED)
    expect(await second).toEqual({ kind: 'ignored' })
    expect(unstarCalls).toEqual(['a1'])
    pending.resolve({ ok: true, value: undefined })
    expect(await first).toEqual({ ok: true, value: undefined })
  })

  test('verifies: CI-CM4 — 正方向対照: 別の id は呼ぶ。1 回目が終わった後の同じ id も呼ぶ（UNSTAR_IGNORED でない）', async () => {
    const pending = deferred<VoidResult>()
    const { gateway, unstarCalls } = harness({ unstar: () => pending.promise })
    const commands = createCatalogCommands({ gateway })

    const first = commands.unstarArticle('a1')
    const other = commands.unstarArticle('a2')
    expect(other).not.toBe(UNSTAR_IGNORED)
    expect(unstarCalls).toEqual(['a1', 'a2'])

    pending.resolve({ ok: true, value: undefined })
    await first
    await other
    const again = commands.unstarArticle('a1')
    expect(again).not.toBe(UNSTAR_IGNORED)
    expect(unstarCalls).toEqual(['a1', 'a2', 'a1'])
    await again
  })

  test('verifies: CI-CM4 — ok と failure を変えずに返す（failure は同じ参照）', async () => {
    const failure: ApiFailure = { kind: 'not_found' }
    const commands = createCatalogCommands({
      gateway: harness({ unstar: () => Promise.resolve({ ok: false, failure }) }).gateway,
    })

    const result = await commands.unstarArticle('a1')

    expect('ok' in result && !result.ok && result.failure).toBe(failure)
  })

  test('verifies: CI-CM4・CM6 — 1 回目が failure でも reject でも集合から外れ、次の同じ id は gateway を呼ぶ（reject は伝わる）', async () => {
    const { gateway, unstarCalls } = harness({
      unstar: (_id, n) =>
        n === 1 ? Promise.resolve({ ok: false, failure: { kind: 'server', status: 500 } }) : n === 2 ? Promise.reject(new Error('boom')) : Promise.resolve({ ok: true, value: undefined }),
    })
    const commands = createCatalogCommands({ gateway })

    await commands.unstarArticle('a1')
    const rejected = commands.unstarArticle('a1')
    expect(rejected).not.toBe(UNSTAR_IGNORED)
    await expect(rejected).rejects.toThrow('boom')
    const third = commands.unstarArticle('a1')

    expect(third).not.toBe(UNSTAR_IGNORED)
    expect(await third).toEqual({ ok: true, value: undefined })
    expect(unstarCalls).toEqual(['a1', 'a1', 'a1'])
  })
})

describe('bulkStar (web-cmd-catalog-02・web-rule-catalog-05)', () => {
  test('web-rule-catalog-05 verifies: CI-CM5 (i) — difficulty を渡さず starArticle を全 id に 1 回ずつ、入力順に開始する', async () => {
    const { gateway, starCalls } = harness({ star: () => Promise.resolve(starOk()) })

    await createCatalogCommands({ gateway }).bulkStar(['a1', 'a2', 'a3'])

    expect(starCalls).toEqual([['a1'], ['a2'], ['a3']])
    for (const args of starCalls) expect(args).toHaveLength(1)
  })

  test('web-rule-catalog-05 verifies: CI-CM5 (ii)(vii) — 3 件中 2 件成功・1 件 429 → starred・failed は入力順、limit あり', async () => {
    const { gateway } = harness({
      star: (id) => Promise.resolve(id === 'a2' ? rateLimited('daily limit', 120) : starOk()),
    })

    const receipt = await createCatalogCommands({ gateway }).bulkStar(['a1', 'a2', 'a3'])

    expect(receipt).toEqual({ starred: ['a1', 'a3'], failed: ['a2'], limit: { period: 'daily', retryAfterSeconds: 120 } })
  })

  test('web-rule-catalog-05 verifies: CI-CM5 (iii) — 429 が無い失敗だけなら limit は null', async () => {
    const { gateway } = harness({
      star: (id) => Promise.resolve(id === 'a1' ? { ok: false, failure: { kind: 'server', status: 500 } } : starOk()),
    })

    const receipt = await createCatalogCommands({ gateway }).bulkStar(['a1', 'a2'])

    expect(receipt).toEqual({ starred: ['a2'], failed: ['a1'], limit: null })
  })

  test('web-rule-catalog-05 verifies: CI-CM5 (iv) — starArticle が reject しても failed に数え、bulkStar 自体は reject しない', async () => {
    const { gateway } = harness({
      star: (id) => (id === 'a2' ? Promise.reject(new Error('boom')) : Promise.resolve(starOk())),
    })

    const receipt = await createCatalogCommands({ gateway }).bulkStar(['a1', 'a2'])

    expect(receipt).toEqual({ starred: ['a1'], failed: ['a2'], limit: null })
  })

  test('web-rule-catalog-05 verifies: CI-CM5 (v) — 429 が複数あれば入力順で最初のものから limit を作る（日次 → 月次、入れ替えで逆）', async () => {
    const run = (order: Array<[string, string]>) =>
      createCatalogCommands({
        gateway: harness({ star: (id) => Promise.resolve(rateLimited(order.find(([i]) => i === id)![1])) }).gateway,
      }).bulkStar(order.map(([id]) => id))

    const dailyFirst = await run([['a1', 'daily limit'], ['a2', 'Monthly limit']])
    const monthlyFirst = await run([['a1', 'Monthly limit'], ['a2', 'daily limit']])

    expect(dailyFirst.limit?.period).toBe('daily')
    expect(monthlyFirst.limit?.period).toBe('monthly')
  })

  test('web-rule-catalog-05 verifies: CI-CM5 (vi) — 空の ids は gateway を呼ばず空の receipt', async () => {
    const { gateway, starCalls } = harness({})

    const receipt = await createCatalogCommands({ gateway }).bulkStar([])

    expect(starCalls).toEqual([])
    expect(receipt).toEqual({ starred: [], failed: [], limit: null })
  })

  test('web-rule-catalog-05 verifies: CI-CM5 (vii) — 完了順が入力順と逆でも starred・failed は入力順', async () => {
    const pending = new Map<string, Deferred<StarResult>>(['a1', 'a2', 'a3'].map((id) => [id, deferred<StarResult>()]))
    const { gateway } = harness({ star: (id) => pending.get(id)!.promise })

    const done = createCatalogCommands({ gateway }).bulkStar(['a1', 'a2', 'a3'])
    pending.get('a3')!.resolve(starOk())
    pending.get('a2')!.resolve({ ok: false, failure: { kind: 'server', status: 500 } })
    pending.get('a1')!.resolve(starOk())

    expect(await done).toEqual({ starred: ['a1', 'a3'], failed: ['a2'], limit: null })
  })
})

describe('戻り値の凍結', () => {
  test('verifies: CI-CM7 — receipt・Result・StarFailure が凍結されている', async () => {
    const { gateway } = harness({
      star: (id) => Promise.resolve(id === 'a2' ? rateLimited('daily') : starOk(1)),
    })
    const commands = createCatalogCommands({ gateway })

    const receipt = await commands.bulkStar(['a1', 'a2'])
    const starred = await commands.starArticle('a1')
    const limited = await commands.starArticle('a2')

    expect(Object.isFrozen(receipt)).toBe(true)
    expect(Object.isFrozen(receipt.starred)).toBe(true)
    expect(Object.isFrozen(receipt.failed)).toBe(true)
    expect(Object.isFrozen(starred)).toBe(true)
    expect(starred.ok && Object.isFrozen(starred.value)).toBe(true)
    expect(Object.isFrozen(limited)).toBe(true)
    expect(!limited.ok && Object.isFrozen(limited.failure)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// addSource・subscribeFeatured・removeSource・completeOnboarding
// ---------------------------------------------------------------------------
const SOURCES: ReadonlyArray<SourceRef> = [
  { name: 'A', url: 'https://a.example/rss' },
  { name: 'B', url: 'https://b.example/rss' },
]
const addOk = (sources: ReadonlyArray<SourceRef> = SOURCES): AddResult => ({ ok: true, value: sources })

describe('addSource (web-cmd-catalog-05)', () => {
  test.each(['ftp://x', 'HTTP://x', ' https://x', '', '//x', 'example.com/rss'])(
    'web-cmd-catalog-05 — 形式が不正な URL %j は gateway を呼ばず invalid_url を返す',
    async (url) => {
      const { gateway, addCalls } = harness({ add: () => Promise.resolve(addOk()) })

      const result = await createCatalogCommands({ gateway }).addSource('n', url)

      expect(addCalls).toHaveLength(0)
      expect(result).toEqual({ ok: false, failure: { kind: 'invalid_url' } })
    },
  )

  test('web-cmd-catalog-05 — 正しい URL は (name, url) をそのまま gateway へ 1 回渡し、購読一覧を返す。正方向対照: 同じ経路で不正 URL は 0 回', async () => {
    const { gateway, addCalls } = harness({ add: () => Promise.resolve(addOk()) })
    const commands = createCatalogCommands({ gateway })

    const result = await commands.addSource('Feed', 'https://example.com/rss')

    expect(addCalls).toEqual([['Feed', 'https://example.com/rss']])
    expect(result).toEqual({
      ok: true,
      value: [
        { name: 'A', url: 'https://a.example/rss' },
        { name: 'B', url: 'https://b.example/rss' },
      ],
    })
    await commands.addSource('Feed', 'ftp://example.com/rss')
    expect(addCalls).toHaveLength(1)
  })

  test('web-cmd-catalog-05 — 成功の値は凍結した複製で、gateway の配列・要素と参照を共有せず、name・url だけを持つ', async () => {
    const raw = [{ name: 'A', url: 'https://a.example/rss', extra: 'x' }] as unknown as ReadonlyArray<SourceRef>
    const { gateway } = harness({ add: () => Promise.resolve(addOk(raw)) })

    const result = await createCatalogCommands({ gateway }).addSource('n', 'https://a.example/rss')

    if (!result.ok) throw new Error('成功のはず')
    expect(result.value).not.toBe(raw)
    expect(result.value[0]).not.toBe(raw[0])
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.value)).toBe(true)
    expect(Object.isFrozen(result.value[0])).toBe(true)
    expect(Object.keys(result.value[0])).toEqual(['name', 'url'])
  })

  test.each<[string, AddSourceGatewayFailure]>([
    ['already_registered', { kind: 'already_registered' }],
    ['invalid_feed', { kind: 'invalid_feed' }],
    ['failed', { kind: 'failed', failure: { kind: 'server', status: 500 } }],
  ])('web-cmd-catalog-05 — gateway の %s は変えずにそのまま返す（同じ参照）', async (_label, failure) => {
    const { gateway } = harness({ add: () => Promise.resolve({ ok: false, failure }) })

    const result = await createCatalogCommands({ gateway }).addSource('n', 'https://example.com/rss')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toBe(failure)
  })

  test('web-cmd-catalog-05 — gateway の reject を握りつぶさずそのまま reject する', async () => {
    const { gateway } = harness({ add: () => Promise.reject(new Error('boom add')) })
    await expect(createCatalogCommands({ gateway }).addSource('n', 'https://example.com/rss')).rejects.toThrow('boom add')
  })
})

describe('subscribeFeatured (web-cmd-catalog-05)', () => {
  test('web-cmd-catalog-05 — URL を検査せず、ftp:// でも gateway を 1 回呼ぶ。正方向対照: 同じ値を addSource に渡すと呼ばない', async () => {
    const { gateway, addCalls } = harness({ add: () => Promise.resolve(addOk()) })
    const commands = createCatalogCommands({ gateway })

    const subscribed = await commands.subscribeFeatured('n', 'ftp://x')
    expect(addCalls).toEqual([['n', 'ftp://x']])
    expect(subscribed.ok).toBe(true)

    const added = await commands.addSource('n', 'ftp://x')
    expect(addCalls).toHaveLength(1)
    expect(added).toEqual({ ok: false, failure: { kind: 'invalid_url' } })
  })

  test.each<[string, AddSourceGatewayFailure]>([
    ['already_registered', { kind: 'already_registered' }],
    ['invalid_feed', { kind: 'invalid_feed' }],
    ['failed', { kind: 'failed', failure: { kind: 'network' } }],
  ])('web-cmd-catalog-05 — gateway の %s は変えずにそのまま返す（同じ参照。invalid_url に変えない）', async (_label, failure) => {
    const { gateway } = harness({ add: () => Promise.resolve({ ok: false, failure }) })

    const result = await createCatalogCommands({ gateway }).subscribeFeatured('n', 'https://example.com/rss')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toBe(failure)
  })

  test('web-cmd-catalog-05 — 成功の値は凍結した複製で、gateway の配列・要素と参照を共有しない', async () => {
    const raw: ReadonlyArray<SourceRef> = [{ name: 'A', url: 'https://a.example/rss' }]
    const { gateway } = harness({ add: () => Promise.resolve(addOk(raw)) })

    const result = await createCatalogCommands({ gateway }).subscribeFeatured('A', 'https://a.example/rss')

    if (!result.ok) throw new Error('成功のはず')
    expect(result.value).toEqual([{ name: 'A', url: 'https://a.example/rss' }])
    expect(result.value).not.toBe(raw)
    expect(result.value[0]).not.toBe(raw[0])
    expect(Object.isFrozen(result.value)).toBe(true)
    expect(Object.isFrozen(result.value[0])).toBe(true)
  })

  test('web-cmd-catalog-05 — gateway の reject を握りつぶさずそのまま reject する', async () => {
    const { gateway } = harness({ add: () => Promise.reject(new Error('boom subscribe')) })
    await expect(createCatalogCommands({ gateway }).subscribeFeatured('n', 'https://x')).rejects.toThrow('boom subscribe')
  })
})

describe('removeSource (web-cmd-catalog-06)', () => {
  test('web-cmd-catalog-06 — url を deleteSource へそのまま 1 回渡し、凍結した複製の購読一覧を返す', async () => {
    const { gateway, deleteCalls } = harness({ remove: () => Promise.resolve({ ok: true, value: SOURCES }) })

    const result = await createCatalogCommands({ gateway }).removeSource('https://a.example/rss?x=1')

    expect(deleteCalls).toEqual(['https://a.example/rss?x=1'])
    expect(result).toEqual({
      ok: true,
      value: [
        { name: 'A', url: 'https://a.example/rss' },
        { name: 'B', url: 'https://b.example/rss' },
      ],
    })
    if (!result.ok) return
    expect(result.value).not.toBe(SOURCES)
    expect(result.value[0]).not.toBe(SOURCES[0])
    expect(Object.isFrozen(result.value)).toBe(true)
    expect(Object.isFrozen(result.value[0])).toBe(true)
  })

  test('web-cmd-catalog-06 — 空になった一覧も ok で返す', async () => {
    const { gateway } = harness({ remove: () => Promise.resolve({ ok: true, value: [] }) })
    expect(await createCatalogCommands({ gateway }).removeSource('https://a.example/rss')).toEqual({ ok: true, value: [] })
  })

  test('web-cmd-catalog-06 — 失敗は ApiFailure を同じ参照のまま返し、reject は握りつぶさず伝える', async () => {
    const failure: ApiFailure = { kind: 'server', status: 502 }
    const failing = harness({ remove: () => Promise.resolve({ ok: false, failure }) })
    const rejecting = harness({ remove: () => Promise.reject(new Error('boom remove')) })

    const result = await createCatalogCommands({ gateway: failing.gateway }).removeSource('https://a.example/rss')

    expect(result.ok).toBe(false)
    expect(!result.ok && result.failure).toBe(failure)
    await expect(createCatalogCommands({ gateway: rejecting.gateway }).removeSource('https://a.example/rss')).rejects.toThrow('boom remove')
  })
})

describe('completeOnboarding (web-cmd-catalog-07)', () => {
  test('web-cmd-catalog-07 — gateway を 1 回呼び、成功の Result をそのまま返す', async () => {
    const { gateway, completeCalls } = harness({ complete: () => Promise.resolve({ ok: true, value: undefined }) })

    const result = await createCatalogCommands({ gateway }).completeOnboarding()

    expect(completeCalls).toHaveLength(1)
    expect(result).toEqual({ ok: true, value: undefined })
  })

  test('web-cmd-catalog-07 — 失敗は同じ参照のまま返し、reject は握りつぶさず伝える', async () => {
    const failure: ApiFailure = { kind: 'server', status: 500 }
    const failing = harness({ complete: () => Promise.resolve({ ok: false, failure }) })
    const rejecting = harness({ complete: () => Promise.reject(new Error('boom complete')) })

    const result = await createCatalogCommands({ gateway: failing.gateway }).completeOnboarding()

    expect(!result.ok && result.failure).toBe(failure)
    await expect(createCatalogCommands({ gateway: rejecting.gateway }).completeOnboarding()).rejects.toThrow('boom complete')
  })
})
