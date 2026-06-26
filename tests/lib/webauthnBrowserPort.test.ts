import { describe, test, expect, vi, beforeEach } from 'vitest'
import { createFakeWebAuthnBrowserPort } from '@/lib/webauthnBrowserPort'
import type { WebAuthnBrowserPort } from '@/lib/webauthnBrowserPort'

// createRealWebAuthnBrowserPort が @simplewebauthn/browser に委譲することを検証する。
// vi.mock は**このファイルだけ**で行う。他テストは createFakeWebAuthnBrowserPort を使う。
vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: vi.fn().mockResolvedValue({ id: 'mocked-reg-id', type: 'public-key' }),
  startAuthentication: vi.fn().mockResolvedValue({ id: 'mocked-auth-id', type: 'public-key' }),
  browserSupportsWebAuthn: vi.fn().mockReturnValue(true),
}))

describe('createFakeWebAuthnBrowserPort', () => {
  let port: WebAuthnBrowserPort

  beforeEach(() => {
    port = createFakeWebAuthnBrowserPort()
  })

  test('startRegistration() — デフォルトは credential-like オブジェクトを返す', async () => {
    const result = await port.startRegistration({} as never)
    expect(result).toHaveProperty('id')
    expect((result as { type: string }).type).toBe('public-key')
  })

  test('startAuthentication() — デフォルトは credential-like オブジェクトを返す', async () => {
    const result = await port.startAuthentication({} as never)
    expect(result).toHaveProperty('id')
    expect((result as { type: string }).type).toBe('public-key')
  })

  test('startRegistration をカスタム実装にオーバーライドできる', async () => {
    const custom = createFakeWebAuthnBrowserPort({
      // テスト用の最小限オブジェクト。完全な RegistrationResponseJSON でなくてよいので never でキャスト。
      startRegistration: async () => ({ id: 'custom-reg', type: 'public-key' }) as never,
    })
    const result = await custom.startRegistration({} as never)
    expect((result as { id: string }).id).toBe('custom-reg')
  })

  test('startAuthentication をカスタム実装にオーバーライドできる', async () => {
    const custom = createFakeWebAuthnBrowserPort({
      startAuthentication: async () => ({ id: 'custom-auth', type: 'public-key' }) as never,
    })
    const result = await custom.startAuthentication({} as never)
    expect((result as { id: string }).id).toBe('custom-auth')
  })

  test('startRegistration で NotAllowedError（ユーザーキャンセル）をシミュレートできる', async () => {
    const err = new DOMException('User cancelled', 'NotAllowedError')
    const cancelPort = createFakeWebAuthnBrowserPort({
      startRegistration: async () => { throw err },
    })
    await expect(cancelPort.startRegistration({} as never)).rejects.toThrow('User cancelled')
  })

  test('startAuthentication で NotAllowedError（ユーザーキャンセル）をシミュレートできる', async () => {
    const err = new DOMException('User cancelled', 'NotAllowedError')
    const cancelPort = createFakeWebAuthnBrowserPort({
      startAuthentication: async () => { throw err },
    })
    await expect(cancelPort.startAuthentication({} as never)).rejects.toThrow('User cancelled')
  })

  test('supportsWebAuthn() — デフォルトは true を返す', () => {
    expect(port.supportsWebAuthn()).toBe(true)
  })

  test('supportsWebAuthn() をカスタム実装にオーバーライドできる（非対応環境シミュレーション）', () => {
    const unsupportedPort = createFakeWebAuthnBrowserPort({
      supportsWebAuthn: () => false,
    })
    expect(unsupportedPort.supportsWebAuthn()).toBe(false)
  })
})

describe('createRealWebAuthnBrowserPort', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('startRegistration は @simplewebauthn/browser の startRegistration に委譲する', async () => {
    const { createRealWebAuthnBrowserPort } = await import('@/lib/webauthnBrowserPort')
    const { startRegistration } = await import('@simplewebauthn/browser')
    const port = createRealWebAuthnBrowserPort()
    const options = {
      challenge: 'test-challenge',
      rp: { name: 'test' },
      user: { id: 'u', name: 'n', displayName: 'd' },
      pubKeyCredParams: [],
      timeout: 60000,
      attestation: 'none' as const,
      excludeCredentials: [],
      authenticatorSelection: {},
      extensions: {},
    }
    await port.startRegistration(options)
    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: options })
  })

  test('startAuthentication は @simplewebauthn/browser の startAuthentication に委譲する', async () => {
    const { createRealWebAuthnBrowserPort } = await import('@/lib/webauthnBrowserPort')
    const { startAuthentication } = await import('@simplewebauthn/browser')
    const port = createRealWebAuthnBrowserPort()
    const options = {
      challenge: 'test-challenge',
      rpId: 'localhost',
      allowCredentials: [],
      timeout: 60000,
      userVerification: 'preferred' as const,
      extensions: {},
    }
    await port.startAuthentication(options)
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: options })
  })

  test('supportsWebAuthn() は @simplewebauthn/browser の browserSupportsWebAuthn に委譲する', async () => {
    const { createRealWebAuthnBrowserPort } = await import('@/lib/webauthnBrowserPort')
    const { browserSupportsWebAuthn } = await import('@simplewebauthn/browser')
    const port = createRealWebAuthnBrowserPort()
    port.supportsWebAuthn()
    expect(browserSupportsWebAuthn).toHaveBeenCalledOnce()
  })
})
