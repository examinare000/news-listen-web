// Admin infrastructure の adminGateway: port AdminGateway を ApiGateway の上に実装する（DTO ⇄ record の写しと request の組み立て）。
// request の path・method・body は現行の page が出すものと同じ。page テストは body を expect.objectContaining で見るため、
// ここで toEqual の完全一致で固定する（余分な key・欠けた key を検出する）。category の正規化だけは gateway が境界で 1 度行う（web-dec-137）。
// adapter のテスト: `createGatewayDouble` を使い、application・domain は値で import しない。
//
// RED 理由（実装前）: `@/lib/admin/infrastructure/adminGateway` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createAdminGateway } from '@/lib/admin/infrastructure/adminGateway'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'
import { createGatewayDouble } from '../../../helpers/gatewayDouble'

const BASE = '/api/backend/admin'
const SITE_FIELDS = { name: 'N', url: 'https://example.com', thumbnailUrl: 'https://example.com/t.png', description: 'D', category: 'sports', order: 3 } as const
const SITE_BODY = { name: 'N', url: 'https://example.com', thumbnail_url: 'https://example.com/t.png', description: 'D', category: 'sports', order: 3 }

function setup() {
  const double = createGatewayDouble()
  return { double, gateway: createAdminGateway(double) }
}

describe('web-dec-137 adminGateway: users', () => {
  test('listUsers: GET /api/backend/admin/users を 1 回だけ呼び、display_name を displayName に写す', async () => {
    const { double, gateway } = setup()
    double.respond('GET', `${BASE}/users`, {
      ok: true,
      value: { users: [{ username: 'alice', role: 'admin', display_name: 'Alice' }] },
    })

    const result = await gateway.listUsers()

    expect(double.calls).toEqual([{ method: 'GET', path: `${BASE}/users`, body: undefined }])
    expect(result).toEqual({ ok: true, value: [{ username: 'alice', displayName: 'Alice', role: 'admin' }] })
  })

  test('createUser: POST /api/backend/admin/users、body は { username, password, display_name, role } の完全一致', async () => {
    const { double, gateway } = setup()
    double.respond('POST', `${BASE}/users`, { ok: true, value: { username: 'bob', role: 'user', display_name: 'Bob' } })

    const result = await gateway.createUser({ username: 'bob', password: 'pw-123456', displayName: 'Bob', role: 'user' })

    expect(double.calls).toEqual([
      { method: 'POST', path: `${BASE}/users`, body: { username: 'bob', password: 'pw-123456', display_name: 'Bob', role: 'user' } },
    ])
    expect(result).toEqual({ ok: true, value: undefined })
  })

  test('updateUser: PATCH /api/backend/admin/users/{encoded}、body は { role } だけ。deleteUser: DELETE 同 path', async () => {
    const { double, gateway } = setup()
    double.respond('PATCH', `${BASE}/users/a%20b`, { ok: true, value: { username: 'a b', role: 'admin', display_name: 'x' } })
    double.respond('DELETE', `${BASE}/users/a%20b`, { ok: true, value: { status: 'deleted', username: 'a b' } })

    const updated = await gateway.updateUser('a b', { role: 'admin' })
    const deleted = await gateway.deleteUser('a b')

    expect(double.calls).toEqual([
      { method: 'PATCH', path: `${BASE}/users/a%20b`, body: { role: 'admin' } },
      { method: 'DELETE', path: `${BASE}/users/a%20b`, body: undefined },
    ])
    expect(updated).toEqual({ ok: true, value: undefined })
    expect(deleted).toEqual({ ok: true, value: undefined })
  })
})

describe('web-dec-137 adminGateway: invites', () => {
  test('createInvite: POST /api/backend/admin/invites、body は { note, max_uses, expires_in_days } の完全一致。応答は id・code・inviteUrl の 3 つで、値を作り替えない', async () => {
    const { double, gateway } = setup()
    double.respond('POST', `${BASE}/invites`, {
      ok: true,
      value: {
        id: 'i1',
        code: 'CODE',
        invite_url: 'https://example.com/register?invite=CODE',
        note: 'memo',
        max_uses: 3,
        expires_at: null,
        created_at: '2026-11-01T00:00:00Z',
      },
    })

    const result = await gateway.createInvite({ note: 'memo', maxUses: 3, expiresInDays: 7 })

    expect(double.calls).toEqual([
      { method: 'POST', path: `${BASE}/invites`, body: { note: 'memo', max_uses: 3, expires_in_days: 7 } },
    ])
    expect(result).toEqual({
      ok: true,
      value: { id: 'i1', code: 'CODE', inviteUrl: 'https://example.com/register?invite=CODE' },
    })
    if (result.ok) expect(Object.keys(result.value).sort()).toEqual(['code', 'id', 'inviteUrl'])
  })

  test('listInvites: use_count・max_uses・expires_at・created_by を camelCase に写し、used_by・revoked_at・created_at は写さない。revokeInvite: DELETE /api/backend/admin/invites/{id}', async () => {
    const { double, gateway } = setup()
    double.respond('GET', `${BASE}/invites`, {
      ok: true,
      value: {
        invites: [
          {
            id: 'i1',
            note: null,
            created_by: 'root',
            max_uses: 5,
            use_count: 2,
            used_by: ['x'],
            expires_at: '2026-12-01T00:00:00Z',
            revoked_at: null,
            created_at: '2026-11-01T00:00:00Z',
            status: 'active',
          },
        ],
      },
    })
    double.respond('DELETE', `${BASE}/invites/i%2F1`, { ok: true, value: { status: 'revoked', id: 'i/1' } })

    const listed = await gateway.listInvites()
    const revoked = await gateway.revokeInvite('i/1')

    expect(double.calls).toEqual([
      { method: 'GET', path: `${BASE}/invites`, body: undefined },
      { method: 'DELETE', path: `${BASE}/invites/i%2F1`, body: undefined },
    ])
    expect(listed).toEqual({
      ok: true,
      value: [
        { id: 'i1', note: null, status: 'active', useCount: 2, maxUses: 5, expiresAt: '2026-12-01T00:00:00Z', createdBy: 'root' },
      ],
    })
    expect(revoked).toEqual({ ok: true, value: undefined })
  })
})

describe('web-dec-137 adminGateway: featured sites', () => {
  const dto = (overrides: Record<string, unknown>) => ({
    id: 's1',
    name: 'N',
    url: 'https://example.com',
    order: 0,
    ...overrides,
  })
  async function listOne(overrides: Record<string, unknown>) {
    const { double, gateway } = setup()
    double.respond('GET', `${BASE}/featured-sites`, { ok: true, value: { sites: [dto(overrides)] } })
    const result = await gateway.listFeaturedSites()
    if (!result.ok) throw new Error('一覧の成功を期待した')
    return result.value[0]
  }

  test('listFeaturedSites: GET を 1 回呼び、thumbnail_url・description の欠落と null は null に写す', async () => {
    const { double, gateway } = setup()
    double.respond('GET', `${BASE}/featured-sites`, {
      ok: true,
      value: {
        sites: [
          dto({ id: 'a', thumbnail_url: 'https://example.com/t.png', description: 'D', category: 'sports', order: 1 }),
          dto({ id: 'b', thumbnail_url: null, description: null, category: 'sports' }),
          dto({ id: 'c', category: 'sports' }),
        ],
      },
    })

    const result = await gateway.listFeaturedSites()

    expect(double.calls).toEqual([{ method: 'GET', path: `${BASE}/featured-sites`, body: undefined }])
    expect(result).toEqual({
      ok: true,
      value: [
        { id: 'a', name: 'N', url: 'https://example.com', thumbnailUrl: 'https://example.com/t.png', description: 'D', category: 'sports', order: 1 },
        { id: 'b', name: 'N', url: 'https://example.com', thumbnailUrl: null, description: null, category: 'sports', order: 0 },
        { id: 'c', name: 'N', url: 'https://example.com', thumbnailUrl: null, description: null, category: 'sports', order: 0 },
      ],
    })
  })

  test('category は境界で 1 度だけ正規化する: 値域外・null・欠落は tech、値域内（sports）はそのまま', async () => {
    expect((await listOne({ category: 'unknown' })).category).toBe('tech')
    expect((await listOne({ category: null })).category).toBe('tech')
    expect((await listOne({})).category).toBe('tech')
    expect((await listOne({ category: 'sports' })).category).toBe('sports')
  })

  test('createFeaturedSite: POST /api/backend/admin/featured-sites、body は 6 field の完全一致。updateFeaturedSite: PUT .../{id} に同じ 6 field。deleteFeaturedSite: DELETE', async () => {
    const { double, gateway } = setup()
    double.respond('POST', `${BASE}/featured-sites`, { ok: true, value: dto({}) })
    double.respond('PUT', `${BASE}/featured-sites/s%201`, { ok: true, value: dto({}) })
    double.respond('DELETE', `${BASE}/featured-sites/s%201`, { ok: true, value: { status: 'deleted', id: 's 1' } })

    const created = await gateway.createFeaturedSite(SITE_FIELDS)
    const updated = await gateway.updateFeaturedSite('s 1', SITE_FIELDS)
    const deleted = await gateway.deleteFeaturedSite('s 1')

    expect(double.calls).toEqual([
      { method: 'POST', path: `${BASE}/featured-sites`, body: SITE_BODY },
      { method: 'PUT', path: `${BASE}/featured-sites/s%201`, body: SITE_BODY },
      { method: 'DELETE', path: `${BASE}/featured-sites/s%201`, body: undefined },
    ])
    for (const result of [created, updated, deleted]) expect(result).toEqual({ ok: true, value: undefined })
  })
})

describe('web-dec-137 adminGateway: metrics', () => {
  test('getMetrics: GET /api/backend/admin/metrics を呼び、camelCase の MetricsRecord に写す。date は写すだけ', async () => {
    const { double, gateway } = setup()
    double.respond('GET', `${BASE}/metrics`, {
      ok: true,
      value: {
        date: '2026-11-01',
        d7: { rate: 0.5, retained: 5, eligible: 10 },
        d30: { rate: 0.2, retained: 2, eligible: 10 },
        completion: { rate_started: 0.4, rate_delivered: 0.3 },
        weekly_star: { avg_per_active_user: 1.5 },
        generated_at: '2026-11-01T00:00:00Z',
      },
    })

    const result = await gateway.getMetrics()

    expect(double.calls).toEqual([{ method: 'GET', path: `${BASE}/metrics`, body: undefined }])
    expect(result).toEqual({
      ok: true,
      value: {
        date: '2026-11-01',
        d7: { rate: 0.5, retained: 5, eligible: 10 },
        d30: { rate: 0.2, retained: 2, eligible: 10 },
        completion: { rateStarted: 0.4, rateDelivered: 0.3 },
        weeklyStar: { avgPerActiveUser: 1.5 },
      },
    })
  })

  test('欠落した field（d7: {}・weekly_star 無し・completion 無し）は null に倒す', async () => {
    const { double, gateway } = setup()
    double.respond('GET', `${BASE}/metrics`, {
      ok: true,
      value: { date: '2026-11-01', d7: {}, d30: { rate: 0.2 }, generated_at: 'x' },
    })

    const result = await gateway.getMetrics()

    expect(result).toEqual({
      ok: true,
      value: {
        date: '2026-11-01',
        d7: { rate: null, retained: null, eligible: null },
        d30: { rate: 0.2, retained: null, eligible: null },
        completion: { rateStarted: null, rateDelivered: null },
        weeklyStar: { avgPerActiveUser: null },
      },
    })
  })
})

describe('web-dec-137 adminGateway: 失敗の受け渡し', () => {
  test('応答が ok:false なら、12 method とも同じ参照のまま返る', async () => {
    const failure: Result<unknown, ApiFailure> = { ok: false, failure: { kind: 'forbidden' } }
    const double = createGatewayDouble()
    for (const [method, path] of [
      ['GET', `${BASE}/users`],
      ['POST', `${BASE}/users`],
      ['PATCH', `${BASE}/users/u`],
      ['DELETE', `${BASE}/users/u`],
      ['GET', `${BASE}/invites`],
      ['POST', `${BASE}/invites`],
      ['DELETE', `${BASE}/invites/i`],
      ['GET', `${BASE}/featured-sites`],
      ['POST', `${BASE}/featured-sites`],
      ['PUT', `${BASE}/featured-sites/s`],
      ['DELETE', `${BASE}/featured-sites/s`],
      ['GET', `${BASE}/metrics`],
    ] as const) {
      double.respond(method, path, failure)
    }
    const gateway = createAdminGateway(double)

    const results = [
      await gateway.listUsers(),
      await gateway.createUser({ username: 'u', password: 'p', displayName: undefined, role: 'user' }),
      await gateway.updateUser('u', { role: 'user' }),
      await gateway.deleteUser('u'),
      await gateway.listInvites(),
      await gateway.createInvite({ note: undefined, maxUses: undefined, expiresInDays: undefined }),
      await gateway.revokeInvite('i'),
      await gateway.listFeaturedSites(),
      await gateway.createFeaturedSite(SITE_FIELDS),
      await gateway.updateFeaturedSite('s', SITE_FIELDS),
      await gateway.deleteFeaturedSite('s'),
      await gateway.getMetrics(),
    ]

    expect(results).toHaveLength(12)
    for (const result of results) expect(result).toBe(failure)
  })

  test('下層が reject したら、握りつぶさず同じ理由で reject する', async () => {
    const error = new Error('boom')
    const double = createGatewayDouble()
    double.respondWith('GET', `${BASE}/users`, () => Promise.reject(error))

    await expect(createAdminGateway(double).listUsers()).rejects.toBe(error)
  })
})
