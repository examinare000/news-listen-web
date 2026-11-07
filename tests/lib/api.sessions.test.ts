import { describe, test, expect } from 'vitest'
import { getSessions, revokeOtherSessions, revokeSession } from '@/lib/api/auth'
import { createGatewayDouble } from '../helpers/gatewayDouble'

// issue #84: ログイン中のデバイス/セッション API（getSessions / revokeSession / revokeOtherSessions）。

describe('getSessions', () => {
  test('GET /api/backend/auth/sessions を呼び sessions を返す', async () => {
    const gw = createGatewayDouble()
    const body = {
      sessions: [
        {
          id: 'sid-current',
          device_label: 'Chrome on macOS',
          created_at: '2026-06-01T00:00:00Z',
          last_used_at: '2026-06-30T12:00:00Z',
          current: true,
        },
        {
          id: 'sid-other',
          device_label: 'Safari on iOS',
          created_at: '2026-05-01T00:00:00Z',
          last_used_at: null,
          current: false,
        },
      ],
    }
    gw.respond('GET', '/api/backend/auth/sessions', { ok: true, value: body })

    const res = await getSessions(gw)

    expect(gw.calls).toEqual([{ method: 'GET', path: '/api/backend/auth/sessions', body: undefined }])
    expect(res).toEqual({ ok: true, value: body })
  })
})

describe('revokeSession', () => {
  test('DELETE /api/backend/auth/sessions/{encoded_id} を呼ぶ', async () => {
    const gw = createGatewayDouble()
    const path = `/api/backend/auth/sessions/${encodeURIComponent('sid/with+special=chars')}`
    gw.respond('DELETE', path, { ok: true, value: { status: 'ok' } })

    const res = await revokeSession(gw, 'sid/with+special=chars')

    expect(gw.calls).toEqual([{ method: 'DELETE', path, body: undefined }])
    expect(res).toEqual({ ok: true, value: { status: 'ok' } })
  })
})

describe('revokeOtherSessions', () => {
  test('POST /api/backend/auth/sessions/revoke-others を呼び revoked_count を返す', async () => {
    const gw = createGatewayDouble()
    gw.respond('POST', '/api/backend/auth/sessions/revoke-others', { ok: true, value: { revoked_count: 3 } })

    const res = await revokeOtherSessions(gw)

    expect(gw.calls).toEqual([{ method: 'POST', path: '/api/backend/auth/sessions/revoke-others', body: undefined }])
    expect(res).toEqual({ ok: true, value: { revoked_count: 3 } })
  })
})
