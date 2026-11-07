import { describe, test, expect } from 'vitest'
import { createInvite, listInvites, revokeInvite } from '@/lib/api/admin'
import { createGatewayDouble } from '../helpers/gatewayDouble'

describe('createInvite', () => {
  test('POSTs note/max_uses/expires_in_days to /api/backend/admin/invites', async () => {
    const gw = createGatewayDouble()
    const created = {
      id: 'inv1',
      code: 'ABC123',
      invite_url: 'https://example.com/signup?invite=ABC123',
      note: 'for alice',
      max_uses: 1,
      expires_at: '2026-08-01T00:00:00Z',
      created_at: '2026-07-01T00:00:00Z',
    }
    gw.respond('POST', '/api/backend/admin/invites', { ok: true, value: created })

    const res = await createInvite(gw, { note: 'for alice', max_uses: 1, expires_in_days: 31 })

    expect(gw.calls).toEqual([
      {
        method: 'POST',
        path: '/api/backend/admin/invites',
        body: { note: 'for alice', max_uses: 1, expires_in_days: 31 },
      },
    ])
    expect(res).toEqual({ ok: true, value: created })
  })
})

describe('listInvites', () => {
  test('GETs /api/backend/admin/invites', async () => {
    const gw = createGatewayDouble()
    gw.respond('GET', '/api/backend/admin/invites', { ok: true, value: { invites: [] } })

    const res = await listInvites(gw)

    expect(gw.calls).toEqual([{ method: 'GET', path: '/api/backend/admin/invites', body: undefined }])
    expect(res).toEqual({ ok: true, value: { invites: [] } })
  })

  test('returns invites with the documented fields (interface contract)', async () => {
    const gw = createGatewayDouble()
    const body = {
      invites: [
        {
          id: 'inv1',
          note: 'for alice',
          created_by: 'admin',
          max_uses: 1,
          use_count: 0,
          used_by: [],
          expires_at: '2026-08-01T00:00:00Z',
          revoked_at: null,
          created_at: '2026-07-01T00:00:00Z',
          status: 'active',
        },
      ],
    }
    gw.respond('GET', '/api/backend/admin/invites', { ok: true, value: body })

    const res = await listInvites(gw)

    expect(res.ok).toBe(true)
    if (!res.ok) return
    const invite = res.value.invites[0]
    for (const field of ['id', 'note', 'created_by', 'max_uses', 'use_count', 'used_by', 'expires_at', 'revoked_at', 'created_at', 'status']) {
      expect(invite).toHaveProperty(field)
    }
  })
})

describe('revokeInvite', () => {
  test('DELETEs the id-scoped path', async () => {
    const gw = createGatewayDouble()
    gw.respond('DELETE', '/api/backend/admin/invites/inv1', { ok: true, value: { status: 'revoked', id: 'inv1' } })

    const res = await revokeInvite(gw, 'inv1')

    expect(gw.calls).toEqual([{ method: 'DELETE', path: '/api/backend/admin/invites/inv1', body: undefined }])
    expect(res.ok).toBe(true)
  })

  test('encodeURIComponent-escapes the id', async () => {
    const gw = createGatewayDouble()

    await revokeInvite(gw, 'inv/weird id')

    expect(gw.calls[0].path).toBe('/api/backend/admin/invites/inv%2Fweird%20id')
  })

  test('returns a not_found failure on 404 when the invite does not exist', async () => {
    const gw = createGatewayDouble()
    const failure = { kind: 'not_found' } as const
    gw.respond('DELETE', '/api/backend/admin/invites/missing', { ok: false, failure })

    const res = await revokeInvite(gw, 'missing')

    expect(res).toEqual({ ok: false, failure })
  })
})
