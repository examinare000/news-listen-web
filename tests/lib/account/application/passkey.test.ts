import { describe, test, expect, vi } from 'vitest'
import { registerPasskey, loginWithPasskey } from '@/lib/account/application/passkey'
import { createFakeWebAuthnBrowserPort } from '../../../helpers/fakeWebAuthnBrowserPort'

// fake 用の options JSON（gateway が parse して application に渡すので、client の既定値は parse 済みの object にする）
const FAKE_OPTIONS_STR = JSON.stringify({ challenge: 'test-challenge', rp: { name: 'test' } })
const FAKE_CHALLENGE_ID = 'challenge-abc-123'
const FAKE_CREDENTIAL = { id: 'cred-id', rawId: 'cred-id', type: 'public-key', response: {} }
const FAKE_USER = { username: 'alice', role: 'user' as const, display_name: 'Alice' }
const FAKE_LOGIN_RESPONSE = { token: 'token-xyz', user: FAKE_USER }

// passkey.ts に DI するクライアントのファクトリ
function makeFakeClient(overrides: Record<string, unknown> = {}) {
  return {
    getPasskeyRegisterOptions: vi.fn().mockResolvedValue({
      ok: true,
      value: { challenge_id: FAKE_CHALLENGE_ID, options: JSON.parse(FAKE_OPTIONS_STR) },
    }),
    verifyPasskeyRegistration: vi.fn().mockResolvedValue({ ok: true, value: { status: 'ok' } }),
    getPasskeyLoginOptions: vi.fn().mockResolvedValue({
      ok: true,
      value: { challenge_id: FAKE_CHALLENGE_ID, options: JSON.parse(FAKE_OPTIONS_STR) },
    }),
    verifyPasskeyLogin: vi.fn().mockResolvedValue({ ok: true, value: FAKE_LOGIN_RESPONSE }),
    ...overrides,
  }
}

// ══════════════════════════════════════════════════════════════════
// registerPasskey
// ══════════════════════════════════════════════════════════════════

describe('registerPasskey', () => {
  test('成功: options取得→JSON.parse→startRegistration→verify の順で呼ばれる', async () => {
    const startReg = vi.fn().mockResolvedValue(FAKE_CREDENTIAL)
    const client = makeFakeClient()
    const port = createFakeWebAuthnBrowserPort({ startRegistration: startReg })

    await registerPasskey(client, port)

    expect(client.getPasskeyRegisterOptions).toHaveBeenCalledOnce()
    // JSON.parse されたオブジェクトが port に渡る（文字列ではない）
    expect(startReg).toHaveBeenCalledWith(JSON.parse(FAKE_OPTIONS_STR))
    expect(client.verifyPasskeyRegistration).toHaveBeenCalledWith(FAKE_CHALLENGE_ID, FAKE_CREDENTIAL)
  })

  test('options API エラー時は伝播し verify を呼ばない', async () => {
    const client = makeFakeClient({
      getPasskeyRegisterOptions: vi.fn().mockResolvedValue({ ok: false, failure: { kind: 'server', status: 503 } }),
    })
    const port = createFakeWebAuthnBrowserPort()

    await expect(registerPasskey(client, port)).resolves.toEqual({ ok: false, failure: { kind: 'server', status: 503 } })
    expect(client.verifyPasskeyRegistration).not.toHaveBeenCalled()
  })

  test('ユーザーキャンセル (NotAllowedError) 時は伝播し verify を呼ばない', async () => {
    const notAllowed = new DOMException('User cancelled', 'NotAllowedError')
    const client = makeFakeClient()
    const port = createFakeWebAuthnBrowserPort({
      startRegistration: vi.fn().mockRejectedValue(notAllowed),
    })

    await expect(registerPasskey(client, port)).rejects.toThrow('User cancelled')
    expect(client.verifyPasskeyRegistration).not.toHaveBeenCalled()
  })

  test('verify API エラー時は伝播する', async () => {
    const client = makeFakeClient({
      verifyPasskeyRegistration: vi
        .fn()
        .mockResolvedValue({ ok: false, failure: { kind: 'validation', detail: 'Bad request' } }),
    })
    const port = createFakeWebAuthnBrowserPort()

    await expect(registerPasskey(client, port)).resolves.toEqual({ ok: false, failure: { kind: 'validation', detail: 'Bad request' } })
  })

  test('options の JSON 文字列を正しくパースして startRegistration に渡す', async () => {
    const innerOptions = { challenge: 'xyz-challenge', timeout: 60000, nested: { key: 'value' } }
    const startReg = vi.fn().mockResolvedValue(FAKE_CREDENTIAL)
    const client = makeFakeClient({
      getPasskeyRegisterOptions: vi.fn().mockResolvedValue({
        ok: true,
        value: { challenge_id: 'cid', options: innerOptions },
      }),
    })
    const port = createFakeWebAuthnBrowserPort({ startRegistration: startReg })

    await registerPasskey(client, port)

    expect(startReg).toHaveBeenCalledWith(innerOptions)
  })
})

// ══════════════════════════════════════════════════════════════════
// loginWithPasskey
// ══════════════════════════════════════════════════════════════════

describe('loginWithPasskey', () => {
  test('成功: options取得→JSON.parse→startAuthentication→verify→LoginResponse を返す', async () => {
    const startAuth = vi.fn().mockResolvedValue(FAKE_CREDENTIAL)
    const client = makeFakeClient()
    const port = createFakeWebAuthnBrowserPort({ startAuthentication: startAuth })

    const r = await loginWithPasskey(client, port)
    if (!r.ok) throw new Error('unexpected failure')
    const result = r.value

    expect(client.getPasskeyLoginOptions).toHaveBeenCalledOnce()
    expect(startAuth).toHaveBeenCalledWith(JSON.parse(FAKE_OPTIONS_STR))
    expect(client.verifyPasskeyLogin).toHaveBeenCalledWith(FAKE_CHALLENGE_ID, FAKE_CREDENTIAL)
    expect(result).toEqual(FAKE_LOGIN_RESPONSE)
  })

  test('options API エラー時は伝播し verify を呼ばない', async () => {
    const client = makeFakeClient({
      getPasskeyLoginOptions: vi.fn().mockResolvedValue({ ok: false, failure: { kind: 'server', status: 503 } }),
    })
    const port = createFakeWebAuthnBrowserPort()

    await expect(loginWithPasskey(client, port)).resolves.toEqual({ ok: false, failure: { kind: 'server', status: 503 } })
    expect(client.verifyPasskeyLogin).not.toHaveBeenCalled()
  })

  test('ユーザーキャンセル (NotAllowedError) 時は伝播し verify を呼ばない', async () => {
    const notAllowed = new DOMException('User cancelled', 'NotAllowedError')
    const client = makeFakeClient()
    const port = createFakeWebAuthnBrowserPort({
      startAuthentication: vi.fn().mockRejectedValue(notAllowed),
    })

    await expect(loginWithPasskey(client, port)).rejects.toThrow('User cancelled')
    expect(client.verifyPasskeyLogin).not.toHaveBeenCalled()
  })

  test('verify API エラー時は伝播する', async () => {
    const client = makeFakeClient({
      verifyPasskeyLogin: vi.fn().mockResolvedValue({ ok: false, failure: { kind: 'unauthorized' } }),
    })
    const port = createFakeWebAuthnBrowserPort()

    await expect(loginWithPasskey(client, port)).resolves.toEqual({ ok: false, failure: { kind: 'unauthorized' } })
  })

  test('戻り値のユーザー情報が正確に返る', async () => {
    const user = { username: 'bob', role: 'admin' as const, display_name: 'Bob' }
    const client = makeFakeClient({
      verifyPasskeyLogin: vi.fn().mockResolvedValue({ ok: true, value: { token: 'tok2', user } }),
    })
    const port = createFakeWebAuthnBrowserPort()

    const r = await loginWithPasskey(client, port)
    if (!r.ok) throw new Error('unexpected failure')
    const result = r.value

    expect(result.user).toEqual(user)
    expect(result.token).toBe('tok2')
  })
})
