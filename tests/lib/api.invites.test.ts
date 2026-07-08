import { describe, test, expect, beforeEach, vi } from 'vitest'
import { createApiClient, ApiError } from '@/lib/api'

function makeClient() {
  return createApiClient()
}

function mockFetchOk(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    }),
  )
}

function mockFetchNoContent() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: () => Promise.reject(new Error('must not parse JSON body on 204 No Content')),
      text: () => Promise.resolve(''),
    }),
  )
}

function mockFetchError(status: number, detail: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: () => Promise.resolve({ detail }),
      text: () => Promise.resolve(JSON.stringify({ detail })),
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

describe('createInvite', () => {
  test('POSTs note/max_uses/expires_in_days to /api/backend/admin/invites', async () => {
    mockFetchOk(
      {
        id: 'inv1',
        code: 'ABC123',
        invite_url: 'https://example.com/signup?invite=ABC123',
        note: 'for alice',
        max_uses: 1,
        expires_at: '2026-08-01T00:00:00Z',
        created_at: '2026-07-01T00:00:00Z',
      },
      201,
    )
    const res = await makeClient().createInvite({ note: 'for alice', max_uses: 1, expires_in_days: 31 })

    const { path, init } = lastCall()
    expect(path).toBe('/api/backend/admin/invites')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ note: 'for alice', max_uses: 1, expires_in_days: 31 })
    expect(res.code).toBe('ABC123')
    expect(res.invite_url).toBe('https://example.com/signup?invite=ABC123')
  })
})

describe('listInvites', () => {
  test('GETs /api/backend/admin/invites', async () => {
    mockFetchOk({ invites: [] })
    const res = await makeClient().listInvites()
    const { path, init } = lastCall()
    expect(path).toBe('/api/backend/admin/invites')
    expect(init.method).toBe('GET')
    expect(res.invites).toEqual([])
  })

  test('returns invites with the documented fields (interface contract)', async () => {
    mockFetchOk({
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
    })
    const res = await makeClient().listInvites()
    const invite = res.invites[0]
    for (const field of ['id', 'note', 'created_by', 'max_uses', 'use_count', 'used_by', 'expires_at', 'revoked_at', 'created_at', 'status']) {
      expect(invite).toHaveProperty(field)
    }
  })
})

describe('revokeInvite', () => {
  test('DELETEs the id-scoped path', async () => {
    mockFetchNoContent()
    await makeClient().revokeInvite('inv1')
    const { path, init } = lastCall()
    expect(path).toBe('/api/backend/admin/invites/inv1')
    expect(init.method).toBe('DELETE')
  })

  test('encodeURIComponent-escapes the id', async () => {
    mockFetchNoContent()
    await makeClient().revokeInvite('inv/weird id')
    expect(lastCall().path).toBe('/api/backend/admin/invites/inv%2Fweird%20id')
  })

  test('throws ApiError on 404 when the invite does not exist', async () => {
    mockFetchError(404, 'Invite not found')
    try {
      await makeClient().revokeInvite('missing')
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      expect((e as ApiError).status).toBe(404)
    }
  })
})
