import { describe, test, expect, beforeEach } from 'vitest'
import { createFakePushBrowserPort } from '@/lib/pushBrowserPort'
import type { PushBrowserPort } from '@/lib/pushBrowserPort'

// fake ポートが PushBrowserPort インターフェースを満たすことを型レベルでも保証する
describe('createFakePushBrowserPort', () => {
  let port: PushBrowserPort

  beforeEach(() => {
    port = createFakePushBrowserPort()
  })

  test('isSupported() — デフォルトは true を返す', () => {
    expect(port.isSupported()).toBe(true)
  })

  test('getPermission() — デフォルトは "default" を返す', () => {
    expect(port.getPermission()).toBe('default')
  })

  test('requestPermission() — デフォルトは "granted" を返す', async () => {
    const result = await port.requestPermission()
    expect(result).toBe('granted')
  })

  test('registerServiceWorker() — デフォルトは成功する', async () => {
    await expect(port.registerServiceWorker('/sw.js')).resolves.not.toThrow()
  })

  test('getExistingSubscription() — デフォルトは null を返す', async () => {
    const result = await port.getExistingSubscription()
    expect(result).toBeNull()
  })

  test('subscribe() — デフォルトは PushSubscriptionJSON を返す', async () => {
    const result = await port.subscribe({ applicationServerKey: new Uint8Array([1, 2, 3]) })
    expect(result).toHaveProperty('endpoint')
    expect(result).toHaveProperty('keys.p256dh')
    expect(result).toHaveProperty('keys.auth')
  })

  test('unsubscribe() — デフォルトは true を返す', async () => {
    const result = await port.unsubscribe('https://fcm.example.com/test')
    expect(result).toBe(true)
  })

  // オーバーライド機能のテスト
  test('fake port はカスタム動作に上書きできる', async () => {
    const port = createFakePushBrowserPort({
      isSupported: () => false,
      getPermission: () => 'denied',
    })
    expect(port.isSupported()).toBe(false)
    expect(port.getPermission()).toBe('denied')
  })

  test('fake port の subscribe でエラーをシミュレートできる', async () => {
    const port = createFakePushBrowserPort({
      subscribe: async () => { throw new Error('Push subscription failed') },
    })
    await expect(port.subscribe({ applicationServerKey: new Uint8Array([1]) })).rejects.toThrow(
      'Push subscription failed'
    )
  })

  test('fake port の getExistingSubscription で既存購読をシミュレートできる', async () => {
    const existing = {
      endpoint: 'https://fcm.example.com/existing',
      keys: { p256dh: 'p256dh-val', auth: 'auth-val' },
    }
    const port = createFakePushBrowserPort({
      getExistingSubscription: async () => existing,
    })
    const result = await port.getExistingSubscription()
    expect(result).toEqual(existing)
  })
})
