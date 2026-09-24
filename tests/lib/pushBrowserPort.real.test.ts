import { describe, test, expect, afterEach } from 'vitest'
import { createRealPushBrowserPort } from '@/lib/pushBrowserPort'

/**
 * 実 port（createRealPushBrowserPort）の getExistingSubscription() テスト。
 *
 * SG-C5: navigator.serviceWorker.ready ではなく getRegistration() を使う（待たずに取得）。
 * spec.md §4.1 CI-P1〜CI-P4、§4.10 T1〜T8。
 */
describe('createRealPushBrowserPort — getExistingSubscription', () => {
  afterEach(() => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker
    expect('serviceWorker' in navigator).toBe(false)
  })

  function stubServiceWorker(getRegistration: () => Promise<unknown>) {
    let readyAccessed = false
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration,
        get ready() {
          readyAccessed = true
          return Promise.resolve({})
        },
      },
      configurable: true,
    })
    return () => readyAccessed
  }

  // T1
  test('CI-P1, CI-P3: 登録が無ければ待たずに null を返し、ready を参照しない', async () => {
    let calls = 0
    const readyAccessed = stubServiceWorker(() => {
      calls += 1
      return Promise.resolve(undefined)
    })

    const port = createRealPushBrowserPort()
    const result = await port.getExistingSubscription()

    expect(result).toBeNull()
    expect(calls).toBe(1)
    expect(readyAccessed()).toBe(false)
  })

  // T2（改訂 8・10）
  test('CI-P2, CI-P3: 揃っていれば余分なフィールドを持たずに組み立て直して返す', async () => {
    let getRegistrationCalls = 0
    let getSubscriptionCalls = 0
    const registration = {
      pushManager: {
        getSubscription: () => {
          getSubscriptionCalls += 1
          return Promise.resolve({
            toJSON: () => ({
              endpoint: 'https://e',
              expirationTime: null,
              keys: { p256dh: 'p', auth: 'a', extra: 'x' },
            }),
          })
        },
      },
    }
    const readyAccessed = stubServiceWorker(() => {
      getRegistrationCalls += 1
      return Promise.resolve(registration)
    })

    const port = createRealPushBrowserPort()
    const result = await port.getExistingSubscription()

    expect(result).toStrictEqual({ endpoint: 'https://e', keys: { p256dh: 'p', auth: 'a' } })
    expect(readyAccessed()).toBe(false)
    expect(getRegistrationCalls).toBe(1)
    expect(getSubscriptionCalls).toBe(1)
  })

  // T3
  test('CI-P2: 購読が無ければ null を返す', async () => {
    let getRegistrationCalls = 0
    let getSubscriptionCalls = 0
    const registration = {
      pushManager: {
        getSubscription: () => {
          getSubscriptionCalls += 1
          return Promise.resolve(null)
        },
      },
    }
    stubServiceWorker(() => {
      getRegistrationCalls += 1
      return Promise.resolve(registration)
    })

    const port = createRealPushBrowserPort()
    const result = await port.getExistingSubscription()

    expect(result).toBeNull()
    expect(getRegistrationCalls).toBe(1)
    expect(getSubscriptionCalls).toBe(1)
  })

  // T4（改訂 7）: keys.auth だけが欠けている
  test('CI-P2: keys.auth が欠ければ null を返す', async () => {
    let getRegistrationCalls = 0
    let getSubscriptionCalls = 0
    const registration = {
      pushManager: {
        getSubscription: () => {
          getSubscriptionCalls += 1
          return Promise.resolve({ toJSON: () => ({ endpoint: 'https://e', keys: { p256dh: 'p' } }) })
        },
      },
    }
    stubServiceWorker(() => {
      getRegistrationCalls += 1
      return Promise.resolve(registration)
    })

    const port = createRealPushBrowserPort()
    const result = await port.getExistingSubscription()

    expect(result).toBeNull()
    expect(getRegistrationCalls).toBe(1)
    expect(getSubscriptionCalls).toBe(1)
  })

  // T5
  test('CI-P4: メソッド集合は 7 つのまま変わらない', () => {
    const port = createRealPushBrowserPort()
    expect(Object.keys(port).sort()).toEqual(
      [
        'getExistingSubscription',
        'getPermission',
        'isSupported',
        'registerServiceWorker',
        'requestPermission',
        'subscribe',
        'unsubscribe',
      ].sort()
    )
  })

  // T6（改訂 7）: endpoint だけが欠けている
  test('CI-P2: endpoint が欠ければ null を返す', async () => {
    let getRegistrationCalls = 0
    let getSubscriptionCalls = 0
    const registration = {
      pushManager: {
        getSubscription: () => {
          getSubscriptionCalls += 1
          return Promise.resolve({ toJSON: () => ({ keys: { p256dh: 'p', auth: 'a' } }) })
        },
      },
    }
    stubServiceWorker(() => {
      getRegistrationCalls += 1
      return Promise.resolve(registration)
    })

    const port = createRealPushBrowserPort()
    const result = await port.getExistingSubscription()

    expect(result).toBeNull()
    expect(getRegistrationCalls).toBe(1)
    expect(getSubscriptionCalls).toBe(1)
  })

  // T7（改訂 7）: keys.p256dh だけが欠けている
  test('CI-P2: keys.p256dh が欠ければ null を返す', async () => {
    let getRegistrationCalls = 0
    let getSubscriptionCalls = 0
    const registration = {
      pushManager: {
        getSubscription: () => {
          getSubscriptionCalls += 1
          return Promise.resolve({ toJSON: () => ({ endpoint: 'https://e', keys: { auth: 'a' } }) })
        },
      },
    }
    stubServiceWorker(() => {
      getRegistrationCalls += 1
      return Promise.resolve(registration)
    })

    const port = createRealPushBrowserPort()
    const result = await port.getExistingSubscription()

    expect(result).toBeNull()
    expect(getRegistrationCalls).toBe(1)
    expect(getSubscriptionCalls).toBe(1)
  })

  // T8（改訂 7）: keys 自体が無い
  test('CI-P2: keys 自体が無ければ null で resolve する（TypeError で reject しない）', async () => {
    let getRegistrationCalls = 0
    let getSubscriptionCalls = 0
    const registration = {
      pushManager: {
        getSubscription: () => {
          getSubscriptionCalls += 1
          return Promise.resolve({ toJSON: () => ({ endpoint: 'https://e' }) })
        },
      },
    }
    stubServiceWorker(() => {
      getRegistrationCalls += 1
      return Promise.resolve(registration)
    })

    const port = createRealPushBrowserPort()
    await expect(port.getExistingSubscription()).resolves.toBeNull()
    expect(getRegistrationCalls).toBe(1)
    expect(getSubscriptionCalls).toBe(1)
  })
})
