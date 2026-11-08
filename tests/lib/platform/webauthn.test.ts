import { describe, test, expect, vi, beforeEach } from 'vitest'

// createRealWebAuthnBrowserPort が @simplewebauthn/browser に委譲することを検証する。
// vi.mock は**このファイルだけ**で行う。他テストは createFakeWebAuthnBrowserPort を使う。
vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: vi.fn().mockResolvedValue({ id: 'mocked-reg-id', type: 'public-key' }),
  startAuthentication: vi.fn().mockResolvedValue({ id: 'mocked-auth-id', type: 'public-key' }),
  browserSupportsWebAuthn: vi.fn().mockReturnValue(true),
}))

describe('createRealWebAuthnBrowserPort', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('startRegistration は @simplewebauthn/browser の startRegistration に委譲する', async () => {
    const { createRealWebAuthnBrowserPort } = await import('@/lib/platform/webauthn')
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
    const { createRealWebAuthnBrowserPort } = await import('@/lib/platform/webauthn')
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
    const { createRealWebAuthnBrowserPort } = await import('@/lib/platform/webauthn')
    const { browserSupportsWebAuthn } = await import('@simplewebauthn/browser')
    const port = createRealWebAuthnBrowserPort()
    port.supportsWebAuthn()
    expect(browserSupportsWebAuthn).toHaveBeenCalledOnce()
  })
})
