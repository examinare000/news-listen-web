import { describe, test, expect, beforeEach } from 'vitest'
import { createFakeWebAuthnBrowserPort } from './fakeWebAuthnBrowserPort'
import type { WebAuthnPort } from '@/lib/account/application/ports'

describe('createFakeWebAuthnBrowserPort', () => {
  let port: WebAuthnPort

  beforeEach(() => {
    port = createFakeWebAuthnBrowserPort()
  })

  test('startRegistration() — デフォルトは credential-like オブジェクトを返す', async () => {
    const result = await port.startRegistration({})
    expect(result).toHaveProperty('id')
    expect((result as { type: string }).type).toBe('public-key')
  })

  test('startAuthentication() — デフォルトは credential-like オブジェクトを返す', async () => {
    const result = await port.startAuthentication({})
    expect(result).toHaveProperty('id')
    expect((result as { type: string }).type).toBe('public-key')
  })

  test('startRegistration をカスタム実装にオーバーライドできる', async () => {
    const custom = createFakeWebAuthnBrowserPort({
      startRegistration: async () => ({ id: 'custom-reg', type: 'public-key' }),
    })
    const result = await custom.startRegistration({})
    expect((result as { id: string }).id).toBe('custom-reg')
  })

  test('startAuthentication をカスタム実装にオーバーライドできる', async () => {
    const custom = createFakeWebAuthnBrowserPort({
      startAuthentication: async () => ({ id: 'custom-auth', type: 'public-key' }),
    })
    const result = await custom.startAuthentication({})
    expect((result as { id: string }).id).toBe('custom-auth')
  })

  test('startRegistration で NotAllowedError（ユーザーキャンセル）をシミュレートできる', async () => {
    const err = new DOMException('User cancelled', 'NotAllowedError')
    const cancelPort = createFakeWebAuthnBrowserPort({
      startRegistration: async () => { throw err },
    })
    await expect(cancelPort.startRegistration({})).rejects.toThrow('User cancelled')
  })

  test('startAuthentication で NotAllowedError（ユーザーキャンセル）をシミュレートできる', async () => {
    const err = new DOMException('User cancelled', 'NotAllowedError')
    const cancelPort = createFakeWebAuthnBrowserPort({
      startAuthentication: async () => { throw err },
    })
    await expect(cancelPort.startAuthentication({})).rejects.toThrow('User cancelled')
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
