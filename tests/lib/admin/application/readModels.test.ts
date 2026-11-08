// Admin のリードモデル生成関数（web-dec-137）。record を写して全深さで凍結した新しい値を返し、record と参照を共有しない。
// category は gateway が正規化済みの値で来る前提なので、readModels は値の検査をせずそのまま写す。
//
// RED 理由（実装前）: `@/lib/admin/application/readModels` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import {
  toAdminUserRow,
  toFeaturedSiteRow,
  toInviteReceipt,
  toInviteRow,
  toMetricsView,
} from '@/lib/admin/application/readModels'
import type {
  AdminUserRecord,
  FeaturedSiteRecord,
  InviteReceiptRecord,
  InviteRecord,
  MetricsRecord,
} from '@/lib/admin/application/ports'

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

const USER: AdminUserRecord = { username: 'alice', displayName: 'Alice', role: 'admin' }
const INVITE: InviteRecord = {
  id: 'i1',
  note: 'memo',
  status: 'active',
  useCount: 1,
  maxUses: 5,
  expiresAt: '2026-12-01T00:00:00Z',
  createdBy: 'alice',
}
const RECEIPT: InviteReceiptRecord = { id: 'i1', code: 'CODE', inviteUrl: 'https://example.com/invite/CODE' }
const SITE: FeaturedSiteRecord = {
  id: 's1',
  name: 'Site',
  url: 'https://example.com',
  thumbnailUrl: null,
  description: null,
  category: 'sports',
  order: 2,
}
const METRICS: MetricsRecord = {
  date: '2026-11-01',
  d7: { rate: 0.5, retained: 5, eligible: 10 },
  d30: { rate: null, retained: null, eligible: null },
  completion: { rateStarted: 0.4, rateDelivered: null },
  weeklyStar: { avgPerActiveUser: 1.25 },
}

describe('web-dec-137 toFeaturedSiteRow', () => {
  test('thumbnailUrl・description が null なら空文字に写す', () => {
    const row = toFeaturedSiteRow(SITE)
    expect(row.thumbnailUrl).toBe('')
    expect(row.description).toBe('')
  })

  test('値があればそのまま写し、他の field も写すだけ', () => {
    const row = toFeaturedSiteRow({ ...SITE, thumbnailUrl: 'https://example.com/t.png', description: 'desc' })
    expect(row).toEqual({
      id: 's1',
      name: 'Site',
      url: 'https://example.com',
      thumbnailUrl: 'https://example.com/t.png',
      description: 'desc',
      category: 'sports',
      order: 2,
    })
  })

  test('category は正規化せず record の値をそのまま写す（sports も tech も）', () => {
    expect(toFeaturedSiteRow({ ...SITE, category: 'sports' }).category).toBe('sports')
    expect(toFeaturedSiteRow({ ...SITE, category: 'tech' }).category).toBe('tech')
  })
})

describe('web-dec-137 生成関数は全深さで凍結した新しい値を返す', () => {
  test('toAdminUserRow・toInviteRow・toInviteReceipt: 値が同じで、凍結していて、record と別の object', () => {
    const user = toAdminUserRow(USER)
    const invite = toInviteRow(INVITE)
    const receipt = toInviteReceipt(RECEIPT)

    expect(user).toEqual(USER)
    expect(invite).toEqual(INVITE)
    expect(receipt).toEqual(RECEIPT)
    expect(user).not.toBe(USER)
    expect(invite).not.toBe(INVITE)
    expect(receipt).not.toBe(RECEIPT)
    for (const value of [user, invite, receipt]) expect(unfrozenNodes(value)).toEqual([])
  })

  test('toInviteReceipt: key は id・code・inviteUrl の 3 つだけ（余分な field を持ち込まない）', () => {
    const polluted = { ...RECEIPT, note: 'x', maxUses: 3 } as InviteReceiptRecord
    expect(Object.keys(toInviteReceipt(polluted)).sort()).toEqual(['code', 'id', 'inviteUrl'])
  })

  test('toFeaturedSiteRow: 凍結していて、record と別の object', () => {
    const row = toFeaturedSiteRow(SITE)
    expect(row).not.toBe(SITE)
    expect(unfrozenNodes(row)).toEqual([])
  })

  test('toMetricsView: 入れ子（d7・d30・completion・weeklyStar）まで凍結し、record の入れ子と別の object', () => {
    const view = toMetricsView(METRICS)

    expect(view).toEqual(METRICS)
    expect(unfrozenNodes(view)).toEqual([])
    expect(view).not.toBe(METRICS)
    expect(view.d7).not.toBe(METRICS.d7)
    expect(view.d30).not.toBe(METRICS.d30)
    expect(view.completion).not.toBe(METRICS.completion)
    expect(view.weeklyStar).not.toBe(METRICS.weeklyStar)
  })
})

describe('web-dec-137 生成済みの値は record の後からの書き換えに影響されない', () => {
  test('record（入れ子を含む）を書き換えても、生成済みの row・view は変わらない', () => {
    const user: { -readonly [K in keyof AdminUserRecord]: AdminUserRecord[K] } = { ...USER }
    const site: { -readonly [K in keyof FeaturedSiteRecord]: FeaturedSiteRecord[K] } = { ...SITE }
    const d7 = { ...METRICS.d7 }
    const metrics = { ...METRICS, d7 }

    const userRow = toAdminUserRow(user)
    const siteRow = toFeaturedSiteRow(site)
    const view = toMetricsView(metrics)

    user.displayName = 'changed'
    site.name = 'changed'
    d7.rate = 0.99

    expect(userRow.displayName).toBe('Alice')
    expect(siteRow.name).toBe('Site')
    expect(view.d7.rate).toBe(0.5)
  })
})
