// Admin の query（web-query-admin-01〜04）。対応する gateway の読込 method を 1 回呼び、成功なら各要素をリードモデルに写して凍結した配列で返す。
// 失敗（not_found を含む）は同じ参照で返し、reject は握りつぶさず伝える。fake の record の category は gateway が正規化済みの前提で、値域内の文字列で書く。
//
// RED 理由（実装前）: `@/lib/admin/application/queries` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createAdminQueries } from '@/lib/admin/application/queries'
import type {
  AdminGateway,
  AdminUserRecord,
  FeaturedSiteRecord,
  InviteRecord,
  MetricsRecord,
} from '@/lib/admin/application/ports'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

const USER: AdminUserRecord = { username: 'alice', displayName: 'Alice', role: 'user' }
const INVITE: InviteRecord = {
  id: 'i1',
  note: null,
  status: 'expired',
  useCount: 2,
  maxUses: 3,
  expiresAt: null,
  createdBy: 'root',
}
const SITE: FeaturedSiteRecord = {
  id: 's1',
  name: 'Site',
  url: 'https://example.com',
  thumbnailUrl: null,
  description: null,
  category: 'sports',
  order: 0,
}
const METRICS: MetricsRecord = {
  date: '2026-11-01',
  d7: { rate: 0.5, retained: 5, eligible: 10 },
  d30: { rate: null, retained: null, eligible: null },
  completion: { rateStarted: 0.4, rateDelivered: 0.3 },
  weeklyStar: { avgPerActiveUser: 1.5 },
}

type ReadName = 'listUsers' | 'listInvites' | 'listFeaturedSites' | 'getMetrics'
const READS: ReadonlyArray<ReadName> = ['listUsers', 'listInvites', 'listFeaturedSites', 'getMetrics']

function fakeGateway(overrides: Partial<Record<ReadName, () => Promise<Result<unknown, ApiFailure>>>> = {}) {
  const calls: string[] = []
  const rec =
    (name: string, value: Result<unknown, ApiFailure>, override?: () => Promise<Result<unknown, ApiFailure>>) =>
    () => {
      calls.push(name)
      return override ? override() : Promise.resolve(value)
    }
  const unused = rec('unused', { ok: true, value: undefined })
  const gateway = {
    listUsers: rec('listUsers', { ok: true, value: [USER] }, overrides.listUsers),
    listInvites: rec('listInvites', { ok: true, value: [INVITE] }, overrides.listInvites),
    listFeaturedSites: rec('listFeaturedSites', { ok: true, value: [SITE] }, overrides.listFeaturedSites),
    getMetrics: rec('getMetrics', { ok: true, value: METRICS }, overrides.getMetrics),
    createUser: unused,
    updateUser: unused,
    deleteUser: unused,
    createInvite: unused,
    revokeInvite: unused,
    createFeaturedSite: unused,
    updateFeaturedSite: unused,
    deleteFeaturedSite: unused,
  } as unknown as AdminGateway
  return { gateway, calls }
}

describe('web-query-admin-01 listUsers', () => {
  test('gateway.listUsers を 1 回呼び、AdminUserRow の配列（値は record と同じ）で返す', async () => {
    const { gateway, calls } = fakeGateway()

    const result = await createAdminQueries({ gateway }).listUsers()

    expect(calls).toEqual(['listUsers'])
    expect(result).toEqual({ ok: true, value: [{ username: 'alice', displayName: 'Alice', role: 'user' }] })
  })
})

describe('web-query-admin-02 listInvites', () => {
  test('gateway.listInvites を 1 回呼び、InviteRow の配列で返す', async () => {
    const { gateway, calls } = fakeGateway()

    const result = await createAdminQueries({ gateway }).listInvites()

    expect(calls).toEqual(['listInvites'])
    expect(result).toEqual({ ok: true, value: [INVITE] })
  })
})

describe('web-query-admin-03 listFeaturedSites', () => {
  test('gateway.listFeaturedSites を 1 回呼び、thumbnailUrl・description の null は空文字、category は record のまま', async () => {
    const { gateway, calls } = fakeGateway()

    const result = await createAdminQueries({ gateway }).listFeaturedSites()

    expect(calls).toEqual(['listFeaturedSites'])
    expect(result).toEqual({
      ok: true,
      value: [{ ...SITE, thumbnailUrl: '', description: '', category: 'sports' }],
    })
  })
})

describe('web-query-admin-04 getMetrics', () => {
  test('gateway.getMetrics を 1 回呼び、MetricsView（record と同じ形）で返す', async () => {
    const { gateway, calls } = fakeGateway()

    const result = await createAdminQueries({ gateway }).getMetrics()

    expect(calls).toEqual(['getMetrics'])
    expect(result).toEqual({ ok: true, value: METRICS })
  })
})

describe('web-query-admin-04 失敗と reject', () => {
  test('gateway の失敗（not_found を含む）は同じ参照のまま返る（4 query とも）', async () => {
    const failure: Result<unknown, ApiFailure> = { ok: false, failure: { kind: 'not_found' } }
    const overrides = Object.fromEntries(READS.map((name) => [name, () => Promise.resolve(failure)]))
    const { gateway } = fakeGateway(overrides)
    const queries = createAdminQueries({ gateway })

    for (const name of READS) expect(await queries[name](), name).toBe(failure)
  })

  test('gateway が reject したら、握りつぶさず同じ理由で reject する（4 query とも）', async () => {
    const error = new Error('boom')
    const overrides = Object.fromEntries(READS.map((name) => [name, () => Promise.reject(error)]))
    const { gateway } = fakeGateway(overrides)
    const queries = createAdminQueries({ gateway })

    for (const name of READS) await expect(queries[name](), name).rejects.toBe(error)
  })

  test('2 回呼ぶと、戻りは値が等しく別の object（呼ぶたびに新しい値を作る）', async () => {
    const { gateway } = fakeGateway()
    const queries = createAdminQueries({ gateway })

    const first = await queries.getMetrics()
    const second = await queries.getMetrics()

    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    if (first.ok && second.ok) expect(first.value).not.toBe(second.value)
  })
})
