import { describe, test, expect, beforeEach, vi } from 'vitest'
import { createApiClient } from '@/lib/api'

// issue #84: ログイン中のデバイス/セッション API（getSessions / revokeSession / revokeOtherSessions）。

function mockFetchOk(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    }),
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
})

function lastCall() {
  const [path, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
  return { path, init }
}

describe('getSessions', () => {
  test('GET /api/backend/auth/sessions を呼び sessions を返す', async () => {
    mockFetchOk({
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
    })

    const res = await createApiClient().getSessions()

    const { path, init } = lastCall()
    expect(path).toBe('/api/backend/auth/sessions')
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('include')
    expect(res.sessions).toHaveLength(2)
    expect(res.sessions[0].current).toBe(true)
  })
})

describe('revokeSession', () => {
  test('DELETE /api/backend/auth/sessions/{encoded_id} を呼ぶ', async () => {
    mockFetchOk({ status: 'ok' })

    await createApiClient().revokeSession('sid/with+special=chars')

    const { path, init } = lastCall()
    expect(path).toBe(
      `/api/backend/auth/sessions/${encodeURIComponent('sid/with+special=chars')}`,
    )
    expect(init.method).toBe('DELETE')
    expect(init.credentials).toBe('include')
  })
})

describe('revokeOtherSessions', () => {
  test('POST /api/backend/auth/sessions/revoke-others を呼び revoked_count を返す', async () => {
    mockFetchOk({ revoked_count: 3 })

    const res = await createApiClient().revokeOtherSessions()

    const { path, init } = lastCall()
    expect(path).toBe('/api/backend/auth/sessions/revoke-others')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(res.revoked_count).toBe(3)
  })
})
