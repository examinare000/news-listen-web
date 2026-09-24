import { describe, test, expect, vi, afterEach } from 'vitest'
import { createFakePushBrowserPort } from '@/lib/pushBrowserPort'
import { urlBase64ToUint8Array } from '@/lib/webpush'
import { createPushRegistration } from '@/lib/push/pushRegistration'
import type { PushBrowserPort } from '@/lib/pushBrowserPort'
import type { PushSubscriptionJSON } from '@/types/index'
import * as pushRegistrationModule from '@/lib/push/pushRegistration'

// spec.md §3.2 の公開インターフェースを、テスト側で実装から独立して書く。
// createPushRegistration をこの型へ代入することで、実装が spec の形を満たすことを
// コンパイル時に確かめる（実装が export する型を import すると、実装の変更に追従して
// しまい、spec との不一致を検出できないため）。
interface PushRegistrationApi {
  getVapidPublicKey(): Promise<{ public_key: string }>
  subscribePush(subscription: PushSubscriptionJSON): Promise<unknown>
  unsubscribePush(endpoint: string): Promise<unknown>
}
interface PushRegistration {
  resolve(): Promise<'unsupported' | 'denied' | 'unsubscribed' | 'subscribed' | 'error'>
  subscribe(): Promise<'subscribed' | 'denied' | 'unsubscribed' | 'error'>
  unsubscribe(): Promise<'unsubscribed' | 'error'>
  reregister(): Promise<void>
  detachFromSubject(): Promise<void>
}
const createRegistration: (deps: {
  port: PushBrowserPort
  client: PushRegistrationApi
}) => PushRegistration = createPushRegistration

const EXISTING: PushSubscriptionJSON = {
  endpoint: 'https://fcm.example.com/existing',
  keys: { p256dh: 'p256dh-val', auth: 'auth-val' },
}

function createClient(overrides: Partial<PushRegistrationApi> = {}): PushRegistrationApi {
  return {
    getVapidPublicKey: vi.fn().mockResolvedValue({ public_key: 'BNVa2nUfxEMGkLfDNj3test' }),
    subscribePush: vi.fn().mockResolvedValue({}),
    unsubscribePush: vi.fn().mockResolvedValue({}),
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

// T10
test('R1: 公開する操作は 5 つだけ。値の export は createPushRegistration だけ', () => {
  const registration = createRegistration({ port: createFakePushBrowserPort(), client: createClient() })
  expect(Object.keys(registration).sort()).toEqual(
    ['detachFromSubject', 'reregister', 'resolve', 'subscribe', 'unsubscribe'].sort()
  )
  expect(Object.keys(pushRegistrationModule).sort()).toEqual(['createPushRegistration'])
})

describe('resolve()', () => {
  // T11
  test('CI-R1: isSupported が false なら unsupported。getExistingSubscription は呼ばれない', async () => {
    const isSupported = vi.fn(() => false)
    const getExistingSubscription = vi.fn(async () => null)
    const port = createFakePushBrowserPort({ isSupported, getExistingSubscription })
    const registration = createRegistration({ port, client: createClient() })

    await expect(registration.resolve()).resolves.toBe('unsupported')
    expect(isSupported).toHaveBeenCalledTimes(1)
    expect(getExistingSubscription).not.toHaveBeenCalled()
  })

  // T12
  test('CI-R1: getPermission が denied なら denied', async () => {
    const getPermission = vi.fn((): NotificationPermission => 'denied')
    const port = createFakePushBrowserPort({ getPermission })
    const registration = createRegistration({ port, client: createClient() })

    await expect(registration.resolve()).resolves.toBe('denied')
    expect(getPermission).toHaveBeenCalledTimes(1)
  })

  // T13
  test('CI-R1: 既存購読があれば subscribed', async () => {
    const getExistingSubscription = vi.fn(async () => EXISTING)
    const port = createFakePushBrowserPort({ getExistingSubscription })
    const registration = createRegistration({ port, client: createClient() })

    await expect(registration.resolve()).resolves.toBe('subscribed')
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
  })

  // T14（改訂 10）
  test('CI-R1: 既定の fake（購読なし）なら unsubscribed', async () => {
    const getExistingSubscription = vi.fn(async () => null)
    const port = createFakePushBrowserPort({ getExistingSubscription })
    const registration = createRegistration({ port, client: createClient() })

    await expect(registration.resolve()).resolves.toBe('unsubscribed')
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
  })

  // T15
  test('CI-R2: getExistingSubscription が reject しても error で resolve する', async () => {
    const getExistingSubscription = vi.fn(async () => { throw new Error('boom') })
    const port = createFakePushBrowserPort({ getExistingSubscription })
    const registration = createRegistration({ port, client: createClient() })

    await expect(registration.resolve()).resolves.toBe('error')
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
  })

  // T37
  test('CI-R2, R14: getPermission が同期例外を投げても error で resolve する（reject しない）', async () => {
    const getPermission = vi.fn((): NotificationPermission => { throw new ReferenceError('Notification is not defined') })
    const getExistingSubscription = vi.fn(async () => null)
    const port = createFakePushBrowserPort({ getPermission, getExistingSubscription })
    const registration = createRegistration({ port, client: createClient() })

    await expect(registration.resolve()).resolves.toBe('error')
    expect(getPermission).toHaveBeenCalledTimes(1)
    expect(getExistingSubscription).not.toHaveBeenCalled()
  })

  // T38
  test('CI-R2, R14: isSupported が同期例外を投げても error で resolve する', async () => {
    const isSupported = vi.fn((): boolean => { throw new TypeError('boom') })
    const port = createFakePushBrowserPort({ isSupported })
    const registration = createRegistration({ port, client: createClient() })

    await expect(registration.resolve()).resolves.toBe('error')
    expect(isSupported).toHaveBeenCalledTimes(1)
  })
})

describe('subscribe()', () => {
  // T16（改訂 9・10）
  test('CI-S2, CI-S4: 正しい順序・引数で呼び出し subscribed を返す', async () => {
    const requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'granted')
    const registerServiceWorker = vi.fn(async () => {})
    const subscribeResult: PushSubscriptionJSON = { endpoint: 'https://fcm.example.com/x', keys: { p256dh: 'p', auth: 'a' } }
    const portSubscribe = vi.fn<PushBrowserPort['subscribe']>(async () => subscribeResult)
    const getExistingSubscription = vi.fn(async () => null)
    const port = createFakePushBrowserPort({
      requestPermission,
      registerServiceWorker,
      subscribe: portSubscribe,
      getExistingSubscription,
    })
    const getVapidPublicKey = vi.fn().mockResolvedValue({ public_key: 'BNVa2nUfxEMGkLfDNj3test' })
    const subscribePush = vi.fn().mockResolvedValue({})
    const client = createClient({ getVapidPublicKey, subscribePush })
    const registration = createRegistration({ port, client })

    await expect(registration.subscribe()).resolves.toBe('subscribed')

    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(registerServiceWorker).toHaveBeenCalledTimes(1)
    expect(registerServiceWorker).toHaveBeenCalledWith('/sw.js')
    expect(getVapidPublicKey).toHaveBeenCalledTimes(1)
    expect(portSubscribe).toHaveBeenCalledTimes(1)
    expect(subscribePush).toHaveBeenCalledTimes(1)
    expect(getExistingSubscription).not.toHaveBeenCalled()

    expect(requestPermission.mock.invocationCallOrder[0]).toBeLessThan(registerServiceWorker.mock.invocationCallOrder[0])
    expect(registerServiceWorker.mock.invocationCallOrder[0]).toBeLessThan(getVapidPublicKey.mock.invocationCallOrder[0])
    expect(getVapidPublicKey.mock.invocationCallOrder[0]).toBeLessThan(portSubscribe.mock.invocationCallOrder[0])
    expect(portSubscribe.mock.invocationCallOrder[0]).toBeLessThan(subscribePush.mock.invocationCallOrder[0])

    const callArgs = portSubscribe.mock.calls[0][0]
    expect(Object.keys(callArgs)).toEqual(['applicationServerKey'])
    expect(callArgs.applicationServerKey).toBeInstanceOf(Uint8Array)
    const expected = urlBase64ToUint8Array('BNVa2nUfxEMGkLfDNj3test')
    expect(Array.from(callArgs.applicationServerKey)).toEqual(Array.from(expected))
    expect(callArgs.applicationServerKey.length).toBeGreaterThan(0)

    expect(subscribePush).toHaveBeenCalledWith(subscribeResult)
    expect(subscribePush.mock.calls[0][0]).toBe(subscribeResult)
  })

  // T17（改訂 5・10）
  test('CI-S1: requestPermission が denied なら denied。後続は呼ばれない', async () => {
    const requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'denied')
    const registerServiceWorker = vi.fn(async () => {})
    const portSubscribe = vi.fn(async () => EXISTING)
    const port = createFakePushBrowserPort({ requestPermission, registerServiceWorker, subscribe: portSubscribe })
    const getVapidPublicKey = vi.fn().mockResolvedValue({ public_key: 'BNVa2nUfxEMGkLfDNj3test' })
    const subscribePush = vi.fn().mockResolvedValue({})
    const registration = createRegistration({ port, client: createClient({ getVapidPublicKey, subscribePush }) })

    await expect(registration.subscribe()).resolves.toBe('denied')
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(registerServiceWorker).not.toHaveBeenCalled()
    expect(getVapidPublicKey).not.toHaveBeenCalled()
    expect(portSubscribe).not.toHaveBeenCalled()
    expect(subscribePush).not.toHaveBeenCalled()
  })

  // T18（改訂 5・10）
  test('CI-S1: requestPermission が default なら unsubscribed。後続は呼ばれない', async () => {
    const requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'default')
    const registerServiceWorker = vi.fn(async () => {})
    const portSubscribe = vi.fn(async () => EXISTING)
    const port = createFakePushBrowserPort({ requestPermission, registerServiceWorker, subscribe: portSubscribe })
    const getVapidPublicKey = vi.fn().mockResolvedValue({ public_key: 'BNVa2nUfxEMGkLfDNj3test' })
    const subscribePush = vi.fn().mockResolvedValue({})
    const registration = createRegistration({ port, client: createClient({ getVapidPublicKey, subscribePush }) })

    await expect(registration.subscribe()).resolves.toBe('unsubscribed')
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(registerServiceWorker).not.toHaveBeenCalled()
    expect(getVapidPublicKey).not.toHaveBeenCalled()
    expect(portSubscribe).not.toHaveBeenCalled()
    expect(subscribePush).not.toHaveBeenCalled()
  })

  // T19（改訂 10）
  test('CI-S3: requestPermission が granted で getVapidPublicKey が reject なら error。後続は呼ばれない', async () => {
    const requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'granted')
    const getVapidPublicKey = vi.fn(async () => { throw new Error('network') })
    const portSubscribe = vi.fn(async () => EXISTING)
    const subscribePush = vi.fn().mockResolvedValue({})
    const port = createFakePushBrowserPort({ requestPermission, subscribe: portSubscribe })
    const registration = createRegistration({ port, client: createClient({ getVapidPublicKey, subscribePush }) })

    await expect(registration.subscribe()).resolves.toBe('error')
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(getVapidPublicKey).toHaveBeenCalledTimes(1)
    expect(portSubscribe).not.toHaveBeenCalled()
    expect(subscribePush).not.toHaveBeenCalled()
  })

  // T20（改訂 10）
  test('CI-S3: subscribePush が reject なら error', async () => {
    const subscribePush = vi.fn(async () => { throw new Error('server down') })
    const registration = createRegistration({ port: createFakePushBrowserPort(), client: createClient({ subscribePush }) })

    await expect(registration.subscribe()).resolves.toBe('error')
    expect(subscribePush).toHaveBeenCalledTimes(1)
  })

  // T61（改訂 3・5・10）
  test('CI-S3: requestPermission が reject なら error。後続は呼ばれない', async () => {
    const requestPermission = vi.fn(async (): Promise<NotificationPermission> => { throw new Error('denied by user agent') })
    const registerServiceWorker = vi.fn(async () => {})
    const portSubscribe = vi.fn(async () => EXISTING)
    const getVapidPublicKey = vi.fn().mockResolvedValue({ public_key: 'BNVa2nUfxEMGkLfDNj3test' })
    const subscribePush = vi.fn().mockResolvedValue({})
    const port = createFakePushBrowserPort({ requestPermission, registerServiceWorker, subscribe: portSubscribe })
    const registration = createRegistration({ port, client: createClient({ getVapidPublicKey, subscribePush }) })

    await expect(registration.subscribe()).resolves.toBe('error')
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(registerServiceWorker).not.toHaveBeenCalled()
    expect(getVapidPublicKey).not.toHaveBeenCalled()
    expect(portSubscribe).not.toHaveBeenCalled()
    expect(subscribePush).not.toHaveBeenCalled()
  })

  // T66（改訂 4・10）
  test('CI-S3: registerServiceWorker が reject なら error。後続は呼ばれない', async () => {
    const requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'granted')
    const registerServiceWorker = vi.fn(async () => { throw new Error('sw register failed') })
    const portSubscribe = vi.fn(async () => EXISTING)
    const getVapidPublicKey = vi.fn().mockResolvedValue({ public_key: 'BNVa2nUfxEMGkLfDNj3test' })
    const subscribePush = vi.fn().mockResolvedValue({})
    const port = createFakePushBrowserPort({ requestPermission, registerServiceWorker, subscribe: portSubscribe })
    const registration = createRegistration({ port, client: createClient({ getVapidPublicKey, subscribePush }) })

    await expect(registration.subscribe()).resolves.toBe('error')
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(registerServiceWorker).toHaveBeenCalledTimes(1)
    expect(getVapidPublicKey).not.toHaveBeenCalled()
    expect(portSubscribe).not.toHaveBeenCalled()
    expect(subscribePush).not.toHaveBeenCalled()
  })

  // T67（改訂 4・10）
  test('CI-S3: port.subscribe が reject なら error。subscribePush は呼ばれない', async () => {
    const requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'granted')
    const portSubscribe = vi.fn(async () => { throw new Error('browser rejected') })
    const getVapidPublicKey = vi.fn().mockResolvedValue({ public_key: 'BNVa2nUfxEMGkLfDNj3test' })
    const subscribePush = vi.fn().mockResolvedValue({})
    const port = createFakePushBrowserPort({ requestPermission, subscribe: portSubscribe })
    const registration = createRegistration({ port, client: createClient({ getVapidPublicKey, subscribePush }) })

    await expect(registration.subscribe()).resolves.toBe('error')
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(portSubscribe).toHaveBeenCalledTimes(1)
    expect(subscribePush).not.toHaveBeenCalled()
  })

  // T68（改訂 4・10）: 不正な base64 で atob が例外を投げる
  test('CI-S3: 変換の例外（atob）で error。後続は呼ばれない', async () => {
    const requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'granted')
    const portSubscribe = vi.fn(async () => EXISTING)
    const getVapidPublicKey = vi.fn().mockResolvedValue({ public_key: '!!!!' })
    const subscribePush = vi.fn().mockResolvedValue({})
    const port = createFakePushBrowserPort({ requestPermission, subscribe: portSubscribe })
    const registration = createRegistration({ port, client: createClient({ getVapidPublicKey, subscribePush }) })

    await expect(registration.subscribe()).resolves.toBe('error')
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(getVapidPublicKey).toHaveBeenCalledTimes(1)
    expect(portSubscribe).not.toHaveBeenCalled()
    expect(subscribePush).not.toHaveBeenCalled()
  })

  // T78（改訂 12。third_vote 6 回目 反証 1）
  test('CI-S4: port.subscribe が undefined を返しても検証せず subscribePush へ渡す', async () => {
    const requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'granted')
    const registerServiceWorker = vi.fn(async () => {})
    const portSubscribe = vi.fn(async () => undefined as unknown as PushSubscriptionJSON)
    const getExistingSubscription = vi.fn(async () => null)
    const port = createFakePushBrowserPort({
      requestPermission,
      registerServiceWorker,
      subscribe: portSubscribe,
      getExistingSubscription,
    })
    const getVapidPublicKey = vi.fn().mockResolvedValue({ public_key: 'BNVa2nUfxEMGkLfDNj3test' })
    const subscribePush = vi.fn().mockResolvedValue({})
    const registration = createRegistration({ port, client: createClient({ getVapidPublicKey, subscribePush }) })

    await expect(registration.subscribe()).resolves.toBe('subscribed')

    expect(subscribePush).toHaveBeenCalledTimes(1)
    expect(subscribePush.mock.calls[0].length).toBe(1)
    expect(subscribePush.mock.calls[0][0]).toBeUndefined()
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(registerServiceWorker).toHaveBeenCalledTimes(1)
    expect(getVapidPublicKey).toHaveBeenCalledTimes(1)
    expect(portSubscribe).toHaveBeenCalledTimes(1)
    expect(getExistingSubscription).not.toHaveBeenCalled()
  })

  // T79（改訂 12。third_vote 6 回目 反証 1）
  test('CI-S4: port.subscribe が endpoint・keys を持たないオブジェクトを返しても組み立て直さない', async () => {
    const bare = {} as PushSubscriptionJSON
    const requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'granted')
    const registerServiceWorker = vi.fn(async () => {})
    const portSubscribe = vi.fn(async () => bare)
    const getExistingSubscription = vi.fn(async () => null)
    const port = createFakePushBrowserPort({
      requestPermission,
      registerServiceWorker,
      subscribe: portSubscribe,
      getExistingSubscription,
    })
    const getVapidPublicKey = vi.fn().mockResolvedValue({ public_key: 'BNVa2nUfxEMGkLfDNj3test' })
    const subscribePush = vi.fn().mockResolvedValue({})
    const registration = createRegistration({ port, client: createClient({ getVapidPublicKey, subscribePush }) })

    await expect(registration.subscribe()).resolves.toBe('subscribed')

    expect(subscribePush).toHaveBeenCalledTimes(1)
    expect(subscribePush.mock.calls[0][0]).toBe(bare)
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(registerServiceWorker).toHaveBeenCalledTimes(1)
    expect(getVapidPublicKey).toHaveBeenCalledTimes(1)
    expect(portSubscribe).toHaveBeenCalledTimes(1)
    expect(getExistingSubscription).not.toHaveBeenCalled()
  })
})

describe('unsubscribe()', () => {
  // T21（改訂 10）
  test('CI-U1: 既存購読があれば port → server の順で解除して unsubscribed を返す', async () => {
    const getExistingSubscription = vi.fn(async () => EXISTING)
    const portUnsubscribe = vi.fn(async () => true)
    const unsubscribePush = vi.fn().mockResolvedValue({})
    const port = createFakePushBrowserPort({ getExistingSubscription, unsubscribe: portUnsubscribe })
    const registration = createRegistration({ port, client: createClient({ unsubscribePush }) })

    await expect(registration.unsubscribe()).resolves.toBe('unsubscribed')
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
    expect(portUnsubscribe).toHaveBeenCalledTimes(1)
    expect(unsubscribePush).toHaveBeenCalledTimes(1)
    expect(portUnsubscribe.mock.invocationCallOrder[0]).toBeLessThan(unsubscribePush.mock.invocationCallOrder[0])
  })

  // T22（改訂 10）
  test('CI-U1: 購読が無ければ unsubscribed。port.unsubscribe・unsubscribePush は呼ばれない', async () => {
    const getExistingSubscription = vi.fn(async () => null)
    const portUnsubscribe = vi.fn(async () => true)
    const unsubscribePush = vi.fn().mockResolvedValue({})
    const port = createFakePushBrowserPort({ getExistingSubscription, unsubscribe: portUnsubscribe })
    const registration = createRegistration({ port, client: createClient({ unsubscribePush }) })

    await expect(registration.unsubscribe()).resolves.toBe('unsubscribed')
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
    expect(portUnsubscribe).not.toHaveBeenCalled()
    expect(unsubscribePush).not.toHaveBeenCalled()
  })

  // T23（改訂 10）
  test('CI-U2: unsubscribePush が reject なら error', async () => {
    const getExistingSubscription = vi.fn(async () => EXISTING)
    const unsubscribePush = vi.fn(async () => { throw new Error('server error') })
    const port = createFakePushBrowserPort({ getExistingSubscription })
    const registration = createRegistration({ port, client: createClient({ unsubscribePush }) })

    await expect(registration.unsubscribe()).resolves.toBe('error')
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
    expect(unsubscribePush).toHaveBeenCalledTimes(1)
  })

  // T62（改訂 3・10）
  test('CI-U2: getExistingSubscription が reject なら error。後続は呼ばれない', async () => {
    const getExistingSubscription = vi.fn(async () => { throw new Error('boom') })
    const portUnsubscribe = vi.fn(async () => true)
    const unsubscribePush = vi.fn().mockResolvedValue({})
    const port = createFakePushBrowserPort({ getExistingSubscription, unsubscribe: portUnsubscribe })
    const registration = createRegistration({ port, client: createClient({ unsubscribePush }) })

    await expect(registration.unsubscribe()).resolves.toBe('error')
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
    expect(portUnsubscribe).not.toHaveBeenCalled()
    expect(unsubscribePush).not.toHaveBeenCalled()
  })

  // T63（改訂 4・10）
  test('CI-U2: port.unsubscribe が reject なら error（reject しない）。unsubscribePush は呼ばれない', async () => {
    const getExistingSubscription = vi.fn(async () => EXISTING)
    const portUnsubscribe = vi.fn(async () => { throw new Error('browser error') })
    const unsubscribePush = vi.fn().mockResolvedValue({})
    const port = createFakePushBrowserPort({ getExistingSubscription, unsubscribe: portUnsubscribe })
    const registration = createRegistration({ port, client: createClient({ unsubscribePush }) })

    await expect(registration.unsubscribe()).resolves.toBe('error')
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
    expect(portUnsubscribe).toHaveBeenCalledTimes(1)
    expect(unsubscribePush).not.toHaveBeenCalled()
  })
})

describe('reregister()', () => {
  // T24（改訂・10）
  test('CI-RR1, CI-RR3: 既存購読があり許可済みなら subscribePush を 1 回、正しい順序で呼ぶ', async () => {
    const getPermission = vi.fn((): NotificationPermission => 'granted')
    const getExistingSubscription = vi.fn(async () => EXISTING)
    const requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'granted')
    const registerServiceWorker = vi.fn(async () => {})
    const portSubscribe = vi.fn(async () => EXISTING)
    const portUnsubscribe = vi.fn(async () => true)
    const port = createFakePushBrowserPort({
      getPermission,
      getExistingSubscription,
      requestPermission,
      registerServiceWorker,
      subscribe: portSubscribe,
      unsubscribe: portUnsubscribe,
    })
    const getVapidPublicKey = vi.fn().mockResolvedValue({ public_key: 'BNVa2nUfxEMGkLfDNj3test' })
    const subscribePush = vi.fn().mockResolvedValue({})
    const unsubscribePush = vi.fn().mockResolvedValue({})
    const registration = createRegistration({
      port,
      client: createClient({ getVapidPublicKey, subscribePush, unsubscribePush }),
    })

    await registration.reregister()

    expect(subscribePush).toHaveBeenCalledTimes(1)
    expect(subscribePush).toHaveBeenCalledWith(EXISTING)
    expect(getPermission.mock.invocationCallOrder[0]).toBeLessThan(getExistingSubscription.mock.invocationCallOrder[0])
    expect(getExistingSubscription.mock.invocationCallOrder[0]).toBeLessThan(subscribePush.mock.invocationCallOrder[0])
    expect(requestPermission).not.toHaveBeenCalled()
    expect(registerServiceWorker).not.toHaveBeenCalled()
    expect(getVapidPublicKey).not.toHaveBeenCalled()
    expect(portSubscribe).not.toHaveBeenCalled()
    expect(portUnsubscribe).not.toHaveBeenCalled()
    expect(unsubscribePush).not.toHaveBeenCalled()
    expect(getPermission).toHaveBeenCalledTimes(1)
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
  })

  // T25（改訂 10）
  test('CI-RR2, CI-RR3: 購読が無ければ subscribePush・requestPermission を呼ばない', async () => {
    const getExistingSubscription = vi.fn(async () => null)
    const requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'granted')
    const subscribePush = vi.fn().mockResolvedValue({})
    const port = createFakePushBrowserPort({ getExistingSubscription, requestPermission })
    const registration = createRegistration({ port, client: createClient({ subscribePush }) })

    await registration.reregister()

    expect(subscribePush).not.toHaveBeenCalled()
    expect(requestPermission).not.toHaveBeenCalled()
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
  })

  // T26（改訂 10）
  test('CI-RR2: isSupported が false なら getExistingSubscription・subscribePush を呼ばない', async () => {
    const isSupported = vi.fn(() => false)
    const getExistingSubscription = vi.fn(async () => EXISTING)
    const subscribePush = vi.fn().mockResolvedValue({})
    const port = createFakePushBrowserPort({ isSupported, getExistingSubscription })
    const registration = createRegistration({ port, client: createClient({ subscribePush }) })

    await registration.reregister()

    expect(getExistingSubscription).not.toHaveBeenCalled()
    expect(subscribePush).not.toHaveBeenCalled()
    expect(isSupported).toHaveBeenCalledTimes(1)
  })

  // T27（改訂 9・10）
  test('CI-RR4, CI-RR5: getExistingSubscription が reject しても resolve し、タイマーを持たない', async () => {
    vi.useFakeTimers()
    const getExistingSubscription = vi.fn(async () => { throw new Error('boom') })
    const subscribePush = vi.fn().mockResolvedValue({})
    const port = createFakePushBrowserPort({ getExistingSubscription })
    const registration = createRegistration({ port, client: createClient({ subscribePush }) })

    await expect(registration.reregister()).resolves.toBeUndefined()
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
    expect(subscribePush).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  // T28（改訂 10）
  test('CI-RR4, CI-RR5: subscribePush が reject しても resolve し、タイマーを持たない', async () => {
    vi.useFakeTimers()
    const getExistingSubscription = vi.fn(async () => EXISTING)
    const subscribePush = vi.fn(async () => { throw new Error('server down') })
    const port = createFakePushBrowserPort({ getExistingSubscription })
    const registration = createRegistration({ port, client: createClient({ subscribePush }) })

    await expect(registration.reregister()).resolves.toBeUndefined()
    expect(subscribePush).toHaveBeenCalledTimes(1)
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  // T29（改訂 10）
  test('CI-RR6: 呼ぶたびに毎回再送する（重複を抑える状態を持たない）', async () => {
    const getExistingSubscription = vi.fn(async () => EXISTING)
    const subscribePush = vi.fn().mockResolvedValue({})
    const port = createFakePushBrowserPort({ getExistingSubscription })
    const registration = createRegistration({ port, client: createClient({ subscribePush }) })

    await registration.reregister()
    await registration.reregister()

    expect(subscribePush).toHaveBeenCalledTimes(2)
    expect(getExistingSubscription).toHaveBeenCalledTimes(2)
  })

  // T35
  test('R13, CI-RR2: 既存購読があっても getPermission が denied なら再送しない', async () => {
    const getPermission = vi.fn((): NotificationPermission => 'denied')
    const getExistingSubscription = vi.fn(async () => EXISTING)
    const subscribePush = vi.fn().mockResolvedValue({})
    const port = createFakePushBrowserPort({ getPermission, getExistingSubscription })
    const registration = createRegistration({ port, client: createClient({ subscribePush }) })

    await registration.reregister()

    expect(getExistingSubscription).not.toHaveBeenCalled()
    expect(subscribePush).not.toHaveBeenCalled()
    expect(getPermission).toHaveBeenCalledTimes(1)
  })

  // T36
  test('CI-RR4: getPermission の同期例外でも resolve する（reject しない）', async () => {
    const getPermission = vi.fn((): NotificationPermission => { throw new ReferenceError('Notification is not defined') })
    const getExistingSubscription = vi.fn(async () => EXISTING)
    const subscribePush = vi.fn().mockResolvedValue({})
    const port = createFakePushBrowserPort({ getPermission, getExistingSubscription })
    const registration = createRegistration({ port, client: createClient({ subscribePush }) })

    await expect(registration.reregister()).resolves.toBeUndefined()
    expect(getExistingSubscription).not.toHaveBeenCalled()
    expect(subscribePush).not.toHaveBeenCalled()
    expect(getPermission).toHaveBeenCalledTimes(1)
  })

  // T59（改訂 3・10）
  test('CI-RR4, R14: isSupported の同期例外でも resolve する。以降は何も呼ばれない', async () => {
    const isSupported = vi.fn((): boolean => { throw new TypeError('boom') })
    const getPermission = vi.fn((): NotificationPermission => 'granted')
    const getExistingSubscription = vi.fn(async () => EXISTING)
    const subscribePush = vi.fn().mockResolvedValue({})
    const port = createFakePushBrowserPort({ isSupported, getPermission, getExistingSubscription })
    const registration = createRegistration({ port, client: createClient({ subscribePush }) })

    await expect(registration.reregister()).resolves.toBeUndefined()
    expect(getPermission).not.toHaveBeenCalled()
    expect(getExistingSubscription).not.toHaveBeenCalled()
    expect(subscribePush).not.toHaveBeenCalled()
    expect(isSupported).toHaveBeenCalledTimes(1)
  })
})

describe('detachFromSubject()', () => {
  // T30（改訂 10）
  test('CI-D1, CI-D2: 既存購読があれば unsubscribePush だけを 1 回呼ぶ', async () => {
    const getExistingSubscription = vi.fn(async () => EXISTING)
    const portUnsubscribe = vi.fn(async () => true)
    const subscribePush = vi.fn().mockResolvedValue({})
    const requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'granted')
    const unsubscribePush = vi.fn().mockResolvedValue({})
    const port = createFakePushBrowserPort({ getExistingSubscription, unsubscribe: portUnsubscribe, requestPermission })
    const registration = createRegistration({
      port,
      client: createClient({ subscribePush, unsubscribePush }),
    })

    await expect(registration.detachFromSubject()).resolves.toBeUndefined()

    expect(unsubscribePush).toHaveBeenCalledTimes(1)
    expect(unsubscribePush).toHaveBeenCalledWith(EXISTING.endpoint)
    expect(portUnsubscribe).not.toHaveBeenCalled()
    expect(subscribePush).not.toHaveBeenCalled()
    expect(requestPermission).not.toHaveBeenCalled()
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
  })

  // T31（改訂 10）
  test('CI-D1: 購読が無ければ unsubscribePush は呼ばれない', async () => {
    const getExistingSubscription = vi.fn(async () => null)
    const unsubscribePush = vi.fn().mockResolvedValue({})
    const port = createFakePushBrowserPort({ getExistingSubscription })
    const registration = createRegistration({ port, client: createClient({ unsubscribePush }) })

    await expect(registration.detachFromSubject()).resolves.toBeUndefined()
    expect(unsubscribePush).not.toHaveBeenCalled()
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
  })

  // T32（改訂 10）
  test('CI-D1: isSupported が false なら getExistingSubscription・unsubscribePush を呼ばない', async () => {
    const isSupported = vi.fn(() => false)
    const getExistingSubscription = vi.fn(async () => EXISTING)
    const unsubscribePush = vi.fn().mockResolvedValue({})
    const port = createFakePushBrowserPort({ isSupported, getExistingSubscription })
    const registration = createRegistration({ port, client: createClient({ unsubscribePush }) })

    await expect(registration.detachFromSubject()).resolves.toBeUndefined()
    expect(getExistingSubscription).not.toHaveBeenCalled()
    expect(unsubscribePush).not.toHaveBeenCalled()
    expect(isSupported).toHaveBeenCalledTimes(1)
  })

  // T33（改訂 10）
  test('CI-D3: getExistingSubscription の reject をそのまま伝える。unsubscribePush は呼ばれない', async () => {
    const err = new Error('boom')
    const getExistingSubscription = vi.fn(async () => { throw err })
    const unsubscribePush = vi.fn().mockResolvedValue({})
    const port = createFakePushBrowserPort({ getExistingSubscription })
    const registration = createRegistration({ port, client: createClient({ unsubscribePush }) })

    await expect(registration.detachFromSubject()).rejects.toBe(err)
    expect(unsubscribePush).not.toHaveBeenCalled()
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
  })

  // T34（改訂 10）
  test('CI-D2, CI-D3: unsubscribePush の reject をそのまま伝える。port.unsubscribe は呼ばれない', async () => {
    const err = new Error('server error')
    const getExistingSubscription = vi.fn(async () => EXISTING)
    const portUnsubscribe = vi.fn(async () => true)
    const unsubscribePush = vi.fn(async () => { throw err })
    const port = createFakePushBrowserPort({ getExistingSubscription, unsubscribe: portUnsubscribe })
    const registration = createRegistration({ port, client: createClient({ unsubscribePush }) })

    await expect(registration.detachFromSubject()).rejects.toBe(err)
    expect(portUnsubscribe).not.toHaveBeenCalled()
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
    expect(unsubscribePush).toHaveBeenCalledTimes(1)
  })

  // T39
  test('CI-D1: getPermission が denied でも許可状態を見ずに解除する', async () => {
    const getPermission = vi.fn((): NotificationPermission => 'denied')
    const getExistingSubscription = vi.fn(async () => EXISTING)
    const unsubscribePush = vi.fn().mockResolvedValue({})
    const port = createFakePushBrowserPort({ getPermission, getExistingSubscription })
    const registration = createRegistration({ port, client: createClient({ unsubscribePush }) })

    await expect(registration.detachFromSubject()).resolves.toBeUndefined()
    expect(unsubscribePush).toHaveBeenCalledTimes(1)
    expect(unsubscribePush).toHaveBeenCalledWith(EXISTING.endpoint)
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
    expect(getPermission).not.toHaveBeenCalled()
  })

  // T69（改訂 4・10）
  test('CI-D3: isSupported の同期例外をそのまま伝える', async () => {
    const err = new TypeError('boom')
    const isSupported = vi.fn((): boolean => { throw err })
    const getExistingSubscription = vi.fn(async () => EXISTING)
    const unsubscribePush = vi.fn().mockResolvedValue({})
    const port = createFakePushBrowserPort({ isSupported, getExistingSubscription })
    const registration = createRegistration({ port, client: createClient({ unsubscribePush }) })

    await expect(registration.detachFromSubject()).rejects.toBe(err)
    expect(getExistingSubscription).not.toHaveBeenCalled()
    expect(unsubscribePush).not.toHaveBeenCalled()
    expect(isSupported).toHaveBeenCalledTimes(1)
  })
})
