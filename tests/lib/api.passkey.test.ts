import { describe, test, expect, beforeEach, vi } from 'vitest'
import {
  deletePasskeyCredential,
  getPasskeyCredentials,
  getPasskeyLoginOptions,
  getPasskeyRegisterOptions,
  verifyPasskeyLogin,
  verifyPasskeyRegistration,
} from '@/lib/api/auth'
import { createGateway } from '@/lib/api/gateway'
import { createGatewayDouble } from '../helpers/gatewayDouble'

beforeEach(() => {
  vi.restoreAllMocks()
})

const FAKE_OPTIONS_RESPONSE = {
  challenge_id: 'cid-123',
  options: '{"challenge":"test-challenge","rp":{"name":"test"}}',
}

// ══════════════════════════════════════════════════════════════════
// getPasskeyRegisterOptions
// ══════════════════════════════════════════════════════════════════

describe('getPasskeyRegisterOptions', () => {
  // credentials は gateway の責務だが、名前が主張するので実 gateway で保つ。
  test('POST /api/backend/auth/passkey/register/options を credentials:include で呼ぶ', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(FAKE_OPTIONS_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await getPasskeyRegisterOptions(createGateway())

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/backend/auth/passkey/register/options')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(res).toEqual({ ok: true, value: FAKE_OPTIONS_RESPONSE })
    // options は JSON 文字列のまま返す（クライアント側で JSON.parse）
    expect(res.ok && typeof res.value.options).toBe('string')
  })

  test('HTTP エラー時は失敗の Result を返す', async () => {
    const gw = createGatewayDouble()
    gw.respond('POST', '/api/backend/auth/passkey/register/options', { ok: false, failure: { kind: 'unauthorized' } })

    const res = await getPasskeyRegisterOptions(gw)

    expect(res).toEqual({ ok: false, failure: { kind: 'unauthorized' } })
  })
})

// ══════════════════════════════════════════════════════════════════
// verifyPasskeyRegistration
// ══════════════════════════════════════════════════════════════════

describe('verifyPasskeyRegistration', () => {
  test('POST /api/backend/auth/passkey/register/verify に challenge_id と credential を送る', async () => {
    const gw = createGatewayDouble()
    const credential = { id: 'cred-id', type: 'public-key', response: {} }
    gw.respond('POST', '/api/backend/auth/passkey/register/verify', { ok: true, value: { status: 'ok' } })

    const res = await verifyPasskeyRegistration(gw, 'cid-123', credential)

    expect(gw.calls).toEqual([
      {
        method: 'POST',
        path: '/api/backend/auth/passkey/register/verify',
        body: { challenge_id: 'cid-123', credential },
      },
    ])
    expect(res).toEqual({ ok: true, value: { status: 'ok' } })
  })
})

// ══════════════════════════════════════════════════════════════════
// getPasskeyLoginOptions
// ══════════════════════════════════════════════════════════════════

describe('getPasskeyLoginOptions', () => {
  test('POST /api/backend/auth/passkey/login/options を呼ぶ（username は body に含まない）', async () => {
    const gw = createGatewayDouble()
    gw.respond('POST', '/api/backend/auth/passkey/login/options', { ok: true, value: FAKE_OPTIONS_RESPONSE })

    const res = await getPasskeyLoginOptions(gw)

    expect(gw.calls).toHaveLength(1)
    expect(gw.calls[0].method).toBe('POST')
    expect(gw.calls[0].path).toBe('/api/backend/auth/passkey/login/options')
    // discoverable フロー: body に username を含まない（body が無い場合と有る場合の両方で検証）
    const body = gw.calls[0].body
    if (body !== undefined) {
      expect(body).not.toHaveProperty('username')
    }
    expect(res).toEqual({ ok: true, value: FAKE_OPTIONS_RESPONSE })
  })
})

// ══════════════════════════════════════════════════════════════════
// verifyPasskeyLogin
// ══════════════════════════════════════════════════════════════════

describe('verifyPasskeyLogin', () => {
  test('POST /api/backend/auth/passkey/login/verify に challenge_id と credential を送り LoginResponse を返す', async () => {
    const gw = createGatewayDouble()
    const loginResponse = {
      token: 'session-token',
      user: { username: 'alice', role: 'user', display_name: 'Alice' },
    }
    gw.respond('POST', '/api/backend/auth/passkey/login/verify', { ok: true, value: loginResponse })
    const credential = { id: 'cred-id', type: 'public-key' }

    const res = await verifyPasskeyLogin(gw, 'cid-123', credential)

    expect(gw.calls).toEqual([
      {
        method: 'POST',
        path: '/api/backend/auth/passkey/login/verify',
        body: { challenge_id: 'cid-123', credential },
      },
    ])
    expect(res).toEqual({ ok: true, value: loginResponse })
  })

  test('401 時は失敗の Result を返す', async () => {
    const gw = createGatewayDouble()
    gw.respond('POST', '/api/backend/auth/passkey/login/verify', { ok: false, failure: { kind: 'unauthorized' } })

    const res = await verifyPasskeyLogin(gw, 'cid', { id: 'x' })

    expect(res).toEqual({ ok: false, failure: { kind: 'unauthorized' } })
  })
})

// ══════════════════════════════════════════════════════════════════
// getPasskeyCredentials
// ══════════════════════════════════════════════════════════════════

describe('getPasskeyCredentials', () => {
  test('GET /api/backend/auth/passkey/credentials を呼ぶ', async () => {
    const gw = createGatewayDouble()
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
    gw.respond('GET', '/api/backend/auth/passkey/credentials', { ok: true, value: credentialsResponse })

    const res = await getPasskeyCredentials(gw)

    expect(gw.calls).toEqual([{ method: 'GET', path: '/api/backend/auth/passkey/credentials', body: undefined }])
    expect(res).toEqual({ ok: true, value: credentialsResponse })
  })
})

// ══════════════════════════════════════════════════════════════════
// deletePasskeyCredential
// ══════════════════════════════════════════════════════════════════

describe('deletePasskeyCredential', () => {
  test('DELETE /api/backend/auth/passkey/credentials/{encoded_id} を呼ぶ', async () => {
    const gw = createGatewayDouble()
    const path = `/api/backend/auth/passkey/credentials/${encodeURIComponent('cred/id+with=special')}`
    gw.respond('DELETE', path, { ok: true, value: { status: 'ok' } })

    const res = await deletePasskeyCredential(gw, 'cred/id+with=special')

    expect(gw.calls).toEqual([{ method: 'DELETE', path, body: undefined }])
    expect(res).toEqual({ ok: true, value: { status: 'ok' } })
  })

  test('通常の credential_id も encodeURIComponent される', async () => {
    const gw = createGatewayDouble()
    const credId = 'abc123-def456'

    await deletePasskeyCredential(gw, credId)

    expect(gw.calls[0].path).toBe(`/api/backend/auth/passkey/credentials/${encodeURIComponent(credId)}`)
  })
})
