// @vitest-environment node
// Admin の query の戻り値の不変性（web-check-06）。4 query の戻り値は全深さで凍結され、
// gateway（fake）が返した record を後から書き換えても、生成済みの値は変わらない。
// 分類の理由: queries.ts（APP）だけを値で import するので、台帳の unit 分類で固定される。infrastructure は import しない。
//
// RED 理由（実装前）: `@/lib/admin/application/queries` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createAdminQueries } from '@/lib/admin/application/queries'
import type { AdminGateway } from '@/lib/admin/application/ports'

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
    for (const [key, child] of Object.entries(value)) found.push(...unfrozenNodes(child, `${where}.${key}`))
  }
  return found
}

function expectDeeplyFrozen(label: string, value: unknown): void {
  expect(unfrozenNodes(value, label), `${label} に凍結されていない node がある`).toEqual([])
}

describe('web-check-06 helper の自己点検: 深い凍結の判定', () => {
  test('完全に凍結した値は 0 件、凍結していない node は path つきで拾う', () => {
    expect(unfrozenNodes(Object.freeze({ a: Object.freeze([Object.freeze({ b: 1 })]) }))).toEqual([])
    expect(unfrozenNodes({ a: 1 })).toEqual(['$'])
  })
})

// fake は書き換え可能な record を保持し、読込 method が返す。
function setup() {
  const user = { username: 'alice', displayName: 'Alice', role: 'user' as 'user' | 'admin' }
  const invite = { id: 'i1', note: 'memo' as string | null, status: 'active' as const, useCount: 1, maxUses: 5, expiresAt: null, createdBy: 'root' }
  const site = { id: 's1', name: 'Site', url: 'https://example.com', thumbnailUrl: null, description: null, category: 'sports' as const, order: 0 }
  const metrics = {
    date: '2026-11-01',
    d7: { rate: 0.5 as number | null, retained: 5, eligible: 10 },
    d30: { rate: 0.2, retained: 2, eligible: 10 },
    completion: { rateStarted: 0.4, rateDelivered: 0.3 },
    weeklyStar: { avgPerActiveUser: 1.5 },
  }
  const unused = () => Promise.reject(new Error('not used'))
  const gateway: AdminGateway = {
    listUsers: () => Promise.resolve({ ok: true, value: [user] }),
    listInvites: () => Promise.resolve({ ok: true, value: [invite] }),
    listFeaturedSites: () => Promise.resolve({ ok: true, value: [site] }),
    getMetrics: () => Promise.resolve({ ok: true, value: metrics }),
    createUser: unused,
    updateUser: unused,
    deleteUser: unused,
    createInvite: unused,
    revokeInvite: unused,
    createFeaturedSite: unused,
    updateFeaturedSite: unused,
    deleteFeaturedSite: unused,
  }
  return { queries: createAdminQueries({ gateway }), user, invite, site, metrics }
}

describe('web-check-06 query の戻り値は全深さで凍結され、record の書き換えに影響されない', () => {
  test('web-query-admin-01 — listUsers', async () => {
    const { queries, user } = setup()
    const result = await queries.listUsers()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectDeeplyFrozen('listUsers', result.value)

    user.displayName = 'changed'
    user.role = 'admin'

    expect(result.value[0]).toEqual({ username: 'alice', displayName: 'Alice', role: 'user' })
  })

  test('web-query-admin-02 — listInvites', async () => {
    const { queries, invite } = setup()
    const result = await queries.listInvites()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectDeeplyFrozen('listInvites', result.value)

    invite.note = 'changed'
    invite.useCount = 99

    expect(result.value[0].note).toBe('memo')
    expect(result.value[0].useCount).toBe(1)
  })

  test('web-query-admin-03 — listFeaturedSites', async () => {
    const { queries, site } = setup()
    const result = await queries.listFeaturedSites()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectDeeplyFrozen('listFeaturedSites', result.value)

    site.name = 'changed'

    expect(result.value[0].name).toBe('Site')
  })

  test('web-query-admin-04 — getMetrics（入れ子を含む）', async () => {
    const { queries, metrics } = setup()
    const result = await queries.getMetrics()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectDeeplyFrozen('getMetrics', result.value)

    metrics.d7.rate = 0.99
    metrics.d7 = { rate: null, retained: 0, eligible: 0 }

    expect(result.value.d7.rate).toBe(0.5)
  })
})
