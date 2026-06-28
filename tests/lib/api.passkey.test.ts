import { describe, test, expect, beforeEach, vi } from 'vitest'
import { createApiClient, ApiError } from '@/lib/api'

function makeClient() {
  return createApiClient()
}

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

function mockFetchError(status: number, detail: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: () => Promise.resolve({ detail }),
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

const FAKE_OPTIONS_RESPONSE = {
  challenge_id: 'cid-123',
  options: '{"challenge":"test-challenge","rp":{"name":"test"}}',
}

// ══════════════════════════════════════════════════════════════════
// getPasskeyRegisterOptions
// ══════════════════════════════════════════════════════════════════

describe('getPasskeyRegisterOptions', () => {
  test('POST /api/backend/auth/passkey/register/options を credentials:include で呼ぶ', async () => {
    mockFetchOk(FAKE_OPTIONS_RESPONSE)
    const res = await makeClient().getPasskeyRegisterOptions()

    const { path, init } = lastCall()
    expect(path).toBe('/api/backend/auth/passkey/register/options')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(res.challenge_id).toBe('cid-123')
    // options は JSON 文字列のまま返す（クライアント側で JSON.parse）
    expect(typeof res.options).toBe('string')
  })

  test('HTTP エラー時は ApiError を throw する', async () => {
    mockFetchError(401, 'Unauthorized')
    await expect(makeClient().getPasskeyRegisterOptions()).rejects.toBeInstanceOf(ApiError)
  })
})

// ══════════════════════════════════════════════════════════════════
// verifyPasskeyRegistration
// ══════════════════════════════════════════════════════════════════

describe('verifyPasskeyRegistration', () => {
  test('POST /api/backend/auth/passkey/register/verify に challenge_id と credential を送る', async () => {
    mockFetchOk({ status: 'ok' })
    const credential = { id: 'cred-id', type: 'public-key', response: {} }

    await makeClient().verifyPasskeyRegistration('cid-123', credential)

    const { path, init } = lastCall()
    expect(path).toBe('/api/backend/auth/passkey/register/verify')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ challenge_id: 'cid-123', credential })
    expect(init.credentials).toBe('include')
  })
})

// ══════════════════════════════════════════════════════════════════
// getPasskeyLoginOptions
// ══════════════════════════════════════════════════════════════════

describe('getPasskeyLoginOptions', () => {
  test('POST /api/backend/auth/passkey/login/options を呼ぶ（username は body に含まない）', async () => {
    mockFetchOk(FAKE_OPTIONS_RESPONSE)
    const res = await makeClient().getPasskeyLoginOptions()

    const { path, init } = lastCall()
    expect(path).toBe('/api/backend/auth/passkey/login/options')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    // discoverable フロー: body に username を含まない（body が無い場合と有る場合の両方で検証）
    if (init.body) {
      const body = JSON.parse(init.body as string)
      expect(body).not.toHaveProperty('username')
    } else {
      // WHY: 実装が無条件に body を省略している場合、body は undefined
      expect(init.body).toBeUndefined()
    }
    expect(res.challenge_id).toBe('cid-123')
    expect(typeof res.options).toBe('string')
  })
})

// ══════════════════════════════════════════════════════════════════
// verifyPasskeyLogin
// ══════════════════════════════════════════════════════════════════

describe('verifyPasskeyLogin', () => {
  test('POST /api/backend/auth/passkey/login/verify に challenge_id と credential を送り LoginResponse を返す', async () => {
    const loginResponse = {
      token: 'session-token',
      user: { username: 'alice', role: 'user', display_name: 'Alice' },
    }
    mockFetchOk(loginResponse)
    const credential = { id: 'cred-id', type: 'public-key' }

    const res = await makeClient().verifyPasskeyLogin('cid-123', credential)

    const { path, init } = lastCall()
    expect(path).toBe('/api/backend/auth/passkey/login/verify')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ challenge_id: 'cid-123', credential })
    expect(res.user.username).toBe('alice')
    expect(res.token).toBe('session-token')
  })

  test('401 時は ApiError を throw する', async () => {
    mockFetchError(401, 'Authentication failed')
    await expect(
      makeClient().verifyPasskeyLogin('cid', { id: 'x' })
    ).rejects.toBeInstanceOf(ApiError)
  })
})

// ══════════════════════════════════════════════════════════════════
// getPasskeyCredentials
// ══════════════════════════════════════════════════════════════════

describe('getPasskeyCredentials', () => {
  test('GET /api/backend/auth/passkey/credentials を呼ぶ', async () => {
    const credentialsResponse = {
      credentials: [
        {
          credential_id: 'cred-abc',
          username: 'alice',
          name: null,
          transports: ['internal'],
          aaguid: null,
          sign_count: 5,
          created_at: '2025-01-01T00:00:00Z',
          last_used_at: '2025-06-01T12:00:00Z',
        },
      ],
    }
    mockFetchOk(credentialsResponse)

    const res = await makeClient().getPasskeyCredentials()

    const { path, init } = lastCall()
    expect(path).toBe('/api/backend/auth/passkey/credentials')
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('include')
    expect(res.credentials).toHaveLength(1)
    expect(res.credentials[0].credential_id).toBe('cred-abc')
  })
})

// ══════════════════════════════════════════════════════════════════
// deletePasskeyCredential
// ══════════════════════════════════════════════════════════════════

describe('deletePasskeyCredential', () => {
  test('DELETE /api/backend/auth/passkey/credentials/{encoded_id} を呼ぶ', async () => {
    mockFetchOk({ status: 'ok' })

    await makeClient().deletePasskeyCredential('cred/id+with=special')

    const { path, init } = lastCall()
    expect(path).toBe(
      `/api/backend/auth/passkey/credentials/${encodeURIComponent('cred/id+with=special')}`,
    )
    expect(init.method).toBe('DELETE')
    expect(init.credentials).toBe('include')
  })

  test('通常の credential_id も encodeURIComponent される', async () => {
    mockFetchOk({ status: 'ok' })
    const credId = 'abc123-def456'

    await makeClient().deletePasskeyCredential(credId)

    expect(lastCall().path).toBe(
      `/api/backend/auth/passkey/credentials/${encodeURIComponent(credId)}`,
    )
  })
})
