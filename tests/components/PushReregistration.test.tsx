import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook, act, waitFor } from '@testing-library/react'
import React from 'react'
import { PushReregistration } from '@/components/PushReregistration'
import { useWebPushSubscription } from '@/hooks/useWebPushSubscription'
import { createFakePushBrowserPort } from '@/lib/pushBrowserPort'
import type { PushBrowserPort } from '@/lib/pushBrowserPort'
import type { PushSubscriptionJSON } from '@/types/index'
import type { ApiFailure, Result } from '@/lib/api/gateway'
import { createGatewayDouble } from '../helpers/gatewayDouble'
import type { GatewayDouble } from '../helpers/gatewayDouble'

type AuthStatus = 'unknown' | 'authenticated' | 'unauthenticated'

const { authState, mockUseAuth, fakePortHolder } = vi.hoisted(() => {
  const authState: { status: AuthStatus } = { status: 'unknown' }
  const mockUseAuth = vi.fn(() => ({ status: authState.status }))
  const fakePortHolder: { port: PushBrowserPort | null } = { port: null }
  return { authState, mockUseAuth, fakePortHolder }
})

const holder = vi.hoisted(() => ({ gw: undefined as GatewayDouble | undefined }))

vi.mock('@/contexts/AuthProvider', () => ({ useAuth: mockUseAuth }))

vi.mock('@/lib/pushBrowserPort', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pushBrowserPort')>()
  return {
    ...actual,
    createRealPushBrowserPort: () => fakePortHolder.port as PushBrowserPort,
  }
})

vi.mock('@/lib/api/gateway', () => ({ createGateway: () => holder.gw }))

const EXISTING: PushSubscriptionJSON = {
  endpoint: 'https://fcm.example.com/existing',
  keys: { p256dh: 'p256dh-val', auth: 'auth-val' },
}

const VAPID_PATH = '/api/backend/notifications/vapid-public-key'
const SUBSCRIPTIONS_PATH = '/api/backend/notifications/subscriptions'
const UNSUBSCRIBE_PREFIX = `${SUBSCRIPTIONS_PATH}?endpoint=`
const UNSUBSCRIBE_PATH = `${UNSUBSCRIBE_PREFIX}${encodeURIComponent(EXISTING.endpoint)}`

let gw: GatewayDouble

function callsTo(method: string, path: string) {
  return gw.calls.filter((c) => c.method === method && c.path === path)
}

function vapidCalls() {
  return callsTo('GET', VAPID_PATH)
}

function subscribeCalls() {
  return callsTo('POST', SUBSCRIPTIONS_PATH)
}

// endpoint は path に入るので、引数を問わず DELETE ＋ 前方一致で数える
function unsubscribeCalls() {
  return gw.calls.filter((c) => c.method === 'DELETE' && c.path.startsWith(UNSUBSCRIBE_PREFIX))
}

function setComponentPort(port: PushBrowserPort) {
  fakePortHolder.port = port
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flushMacrotask() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** waitFor で回数に達するのを待ち、1 macrotask 流した後も同じ回数であることを確かめる（改訂 10）。 */
async function expectStableCallCount(
  target: { mock: { calls: unknown[] } } | (() => number),
  times: number,
) {
  const getCount = 'mock' in target ? () => target.mock.calls.length : target
  await waitFor(() => expect(getCount()).toBe(times))
  await flushMacrotask()
  expect(getCount()).toBe(times)
}

type UnhandledRejectionListener = (reason: unknown, promise: Promise<unknown>) => void
let unhandledRejectionSpy: ReturnType<typeof vi.fn<UnhandledRejectionListener>> | null = null
function watchUnhandledRejection() {
  const spy = vi.fn<UnhandledRejectionListener>()
  unhandledRejectionSpy = spy
  process.on('unhandledRejection', spy)
  return spy
}

beforeEach(() => {
  gw = createGatewayDouble()
  holder.gw = gw
  vi.clearAllMocks()
  authState.status = 'unknown'
  fakePortHolder.port = null
  gw.respond('GET', VAPID_PATH, { ok: true, value: { public_key: 'BNVa2nUfxEMGkLfDNj3test' } })
  gw.respond('POST', SUBSCRIPTIONS_PATH, { ok: true, value: {} })
  gw.respond('DELETE', UNSUBSCRIBE_PATH, { ok: true, value: {} })
})

afterEach(() => {
  if (unhandledRejectionSpy) {
    process.off('unhandledRejection', unhandledRejectionSpy)
    unhandledRejectionSpy = null
  }
})

describe('PushReregistration — 部品（useAuth().status を渡すだけ）', () => {
  // T40
  test('CI-C1: unknown のとき null を描画する（resolve() だけが走る）', async () => {
    const getExistingSubscription = vi.fn(async () => null)
    setComponentPort(createFakePushBrowserPort({ getExistingSubscription }))
    authState.status = 'unknown'

    const { container } = render(<PushReregistration />)

    await expectStableCallCount(getExistingSubscription, 1)
    expect(container.firstChild).toBeNull()
    expect(mockUseAuth.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  // T41
  test('R2, CI-H2, CI-C1: unknown → authenticated で再送する。container は常に空', async () => {
    const getExistingSubscription = vi.fn(async () => EXISTING)
    setComponentPort(createFakePushBrowserPort({ getExistingSubscription }))
    authState.status = 'unknown'

    const { container, rerender } = render(<PushReregistration />)
    await expectStableCallCount(getExistingSubscription, 1)
    expect(subscribeCalls()).toHaveLength(0)
    expect(container.firstChild).toBeNull()

    authState.status = 'authenticated'
    rerender(<PushReregistration />)

    await expectStableCallCount(() => subscribeCalls().length, 1)
    expect(gw.calls).toContainEqual({ method: 'POST', path: SUBSCRIPTIONS_PATH, body: EXISTING })
    expect(vapidCalls()).toHaveLength(0)
    expect(container.firstChild).toBeNull()
    await expectStableCallCount(getExistingSubscription, 2)
    expect(mockUseAuth.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  // T42（改訂 3・8）
  test('R2, CI-H2, CI-C1: mount 時点で authenticated なら再送する。container は空', async () => {
    const getExistingSubscription = vi.fn(async () => EXISTING)
    setComponentPort(createFakePushBrowserPort({ getExistingSubscription }))
    authState.status = 'authenticated'

    const { container } = render(<PushReregistration />)

    await expectStableCallCount(() => subscribeCalls().length, 1)
    expect(gw.calls).toContainEqual({ method: 'POST', path: SUBSCRIPTIONS_PATH, body: EXISTING })
    expect(vapidCalls()).toHaveLength(0)
    expect(container.firstChild).toBeNull()
    await expectStableCallCount(getExistingSubscription, 2)
    expect(mockUseAuth.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  // T43
  test('R2, CI-RR2: 購読が無ければ mount 時 authenticated でも subscribePush を呼ばない', async () => {
    const getExistingSubscription = vi.fn(async () => null)
    setComponentPort(createFakePushBrowserPort({ getExistingSubscription }))
    authState.status = 'authenticated'

    render(<PushReregistration />)

    await expectStableCallCount(getExistingSubscription, 2)
    expect(subscribeCalls()).toHaveLength(0)
    expect(mockUseAuth.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  // T44（改訂 8）
  test('R3, CI-H3, CI-C1: unknown で mount すると subscribePush を呼ばない。container は空', async () => {
    const getExistingSubscription = vi.fn(async () => EXISTING)
    setComponentPort(createFakePushBrowserPort({ getExistingSubscription }))
    authState.status = 'unknown'

    const { container } = render(<PushReregistration />)

    await expectStableCallCount(getExistingSubscription, 1)
    expect(subscribeCalls()).toHaveLength(0)
    expect(container.firstChild).toBeNull()
    expect(mockUseAuth.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  // T45（改訂 8）
  test('R3, CI-H3, CI-C1: unauthenticated で mount すると subscribePush を呼ばない。container は空', async () => {
    const getExistingSubscription = vi.fn(async () => EXISTING)
    setComponentPort(createFakePushBrowserPort({ getExistingSubscription }))
    authState.status = 'unauthenticated'

    const { container } = render(<PushReregistration />)

    await expectStableCallCount(getExistingSubscription, 1)
    expect(subscribeCalls()).toHaveLength(0)
    expect(container.firstChild).toBeNull()
    expect(mockUseAuth.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  // T46
  test('R6, CI-RR3, CI-RR4: 再送の subscribePush が reject しても throw せず unhandled rejection も出ない', async () => {
    const spy = watchUnhandledRejection()
    const getExistingSubscription = vi.fn(async () => EXISTING)
    gw.respondWith('POST', SUBSCRIPTIONS_PATH, () => Promise.reject(new Error('server down')))
    setComponentPort(createFakePushBrowserPort({ getExistingSubscription }))
    authState.status = 'authenticated'

    expect(() => render(<PushReregistration />)).not.toThrow()

    await expectStableCallCount(() => subscribeCalls().length, 1)
    expect(vapidCalls()).toHaveLength(0)
    expect(spy).not.toHaveBeenCalled()
    await expectStableCallCount(getExistingSubscription, 2)
    expect(mockUseAuth.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  // T47
  test('CI-H2: authenticated → unauthenticated → authenticated で 2 回再送する', async () => {
    const getExistingSubscription = vi.fn(async () => EXISTING)
    setComponentPort(createFakePushBrowserPort({ getExistingSubscription }))
    authState.status = 'authenticated'

    const { rerender } = render(<PushReregistration />)
    await expectStableCallCount(() => subscribeCalls().length, 1)

    authState.status = 'unauthenticated'
    rerender(<PushReregistration />)
    await flushMacrotask()
    expect(subscribeCalls()).toHaveLength(1)

    authState.status = 'authenticated'
    rerender(<PushReregistration />)
    await expectStableCallCount(() => subscribeCalls().length, 2)

    await expectStableCallCount(getExistingSubscription, 3)
    expect(mockUseAuth.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  // T48
  test('CI-H2: 同じ authenticated のまま rerender しても再送を増やさない', async () => {
    const getExistingSubscription = vi.fn(async () => EXISTING)
    setComponentPort(createFakePushBrowserPort({ getExistingSubscription }))
    authState.status = 'authenticated'

    const { rerender } = render(<PushReregistration />)
    await expectStableCallCount(() => subscribeCalls().length, 1)
    await expectStableCallCount(getExistingSubscription, 2)

    rerender(<PushReregistration />)
    await flushMacrotask()

    expect(subscribeCalls()).toHaveLength(1)
    expect(getExistingSubscription.mock.calls.length).toBe(2)
    expect(mockUseAuth.mock.calls.length).toBeGreaterThanOrEqual(1)
  })
})

describe('useWebPushSubscription({ port, authStatus }) — hook 単体', () => {
  // T49
  test('CI-H3: authStatus 省略時は reregister() を呼ばない', async () => {
    const getExistingSubscription = vi.fn(async () => EXISTING)
    const port = createFakePushBrowserPort({ getExistingSubscription })

    renderHook(() => useWebPushSubscription({ port }))

    await expectStableCallCount(getExistingSubscription, 1)
    expect(subscribeCalls()).toHaveLength(0)
  })

  // T60（改訂 3）
  test('R2, CI-H1, CI-H2: 既存購読ありの authenticated mount で再送する', async () => {
    const getExistingSubscription = vi.fn(async () => EXISTING)
    const port = createFakePushBrowserPort({ getExistingSubscription })

    const { result } = renderHook(() => useWebPushSubscription({ port, authStatus: 'authenticated' }))

    await waitFor(() => expect(result.current.state).toBe('subscribed'))
    await expectStableCallCount(() => subscribeCalls().length, 1)
    await expectStableCallCount(getExistingSubscription, 2)
  })

  // T64（改訂 4）
  test('CI-H5, CI-H2: 再送の完了で state を上書きしない', async () => {
    const getExistingSubscription = vi.fn(async () => EXISTING)
    const portUnsubscribe = vi.fn(async () => true)
    const port = createFakePushBrowserPort({ getExistingSubscription, unsubscribe: portUnsubscribe })
    const deferred = createDeferred<Result<unknown, ApiFailure>>()
    gw.respondWith('POST', SUBSCRIPTIONS_PATH, () => deferred.promise)

    const { result, rerender } = renderHook(
      ({ s }: { s: AuthStatus }) => useWebPushSubscription({ port, authStatus: s }),
      { initialProps: { s: 'unknown' as AuthStatus } }
    )
    await waitFor(() => expect(result.current.state).toBe('subscribed'))

    await act(async () => {
      await result.current.unsubscribe()
    })
    expect(result.current.state).toBe('unsubscribed')

    rerender({ s: 'authenticated' })
    await waitFor(() => expect(subscribeCalls()).toHaveLength(1))

    await act(async () => {
      deferred.resolve({ ok: true, value: {} })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(result.current.state).toBe('unsubscribed')
    await expectStableCallCount(getExistingSubscription, 3)
    expect(portUnsubscribe).toHaveBeenCalledTimes(1)
  })

  // T65（改訂 4・5）
  test('CI-H5, CI-RR4: 再送の失敗で state を error にしない', async () => {
    const getExistingSubscription = vi.fn(async () => EXISTING)
    const port = createFakePushBrowserPort({ getExistingSubscription })
    const deferred = createDeferred<Result<unknown, ApiFailure>>()
    gw.respondWith('POST', SUBSCRIPTIONS_PATH, () => deferred.promise)

    const { result } = renderHook(() => useWebPushSubscription({ port, authStatus: 'authenticated' }))

    await waitFor(() => {
      expect(result.current.state).toBe('subscribed')
      expect(subscribeCalls()).toHaveLength(1)
    })

    await act(async () => {
      deferred.reject(new Error('x'))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(result.current.state).toBe('subscribed')
    await expectStableCallCount(getExistingSubscription, 2)
  })

  // T55
  test('R14, CI-H1, CI-R2, CI-RR4: getPermission の同期例外で render は throw せず error になる', async () => {
    const spy = watchUnhandledRejection()
    const isSupported = vi.fn(() => true)
    const getPermission = vi.fn((): NotificationPermission => {
      throw new ReferenceError('Notification is not defined')
    })
    const getExistingSubscription = vi.fn(async () => EXISTING)
    const port = createFakePushBrowserPort({ isSupported, getPermission, getExistingSubscription })
    setComponentPort(port)
    authState.status = 'authenticated'

    expect(() => render(<PushReregistration />)).not.toThrow()
    const { result } = renderHook(() => useWebPushSubscription({ port }))

    await expectStableCallCount(isSupported, 3)
    await waitFor(() => expect(result.current.state).toBe('error'))

    expect(spy).not.toHaveBeenCalled()
    expect(subscribeCalls()).toHaveLength(0)
    expect(getPermission.mock.calls.length).toBe(3)
    expect(getExistingSubscription).not.toHaveBeenCalled()
    expect(mockUseAuth.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  // T56
  test('CI-H6: subscribe() の完了前は subscribing、完了後は戻り値になる', async () => {
    const requestPermissionDeferred = createDeferred<NotificationPermission>()
    const requestPermission = vi.fn(() => requestPermissionDeferred.promise)
    const port = createFakePushBrowserPort({ requestPermission })

    const { result } = renderHook(() => useWebPushSubscription({ port }))
    await waitFor(() => expect(result.current.state).toBe('unsubscribed'))

    act(() => {
      void result.current.subscribe()
    })
    expect(result.current.state).toBe('subscribing')

    await act(async () => {
      requestPermissionDeferred.resolve('granted')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await waitFor(() => expect(result.current.state).toBe('subscribed'))
    expect(requestPermission).toHaveBeenCalledTimes(1)
  })

  // T57（改訂 3）
  test('CI-H1: getExistingSubscription が未解決の間は unsubscribed のまま', async () => {
    const deferred = createDeferred<PushSubscriptionJSON | null>()
    const getExistingSubscription = vi.fn(() => deferred.promise)
    const port = createFakePushBrowserPort({ getExistingSubscription })

    const { result } = renderHook(() => useWebPushSubscription({ port }))
    expect(result.current.state).toBe('unsubscribed')

    await act(async () => {
      deferred.resolve(EXISTING)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await waitFor(() => expect(result.current.state).toBe('subscribed'))
    await expectStableCallCount(getExistingSubscription, 1)
  })

  // T58（改訂 3）
  test('CI-H7: unsubscribe() の完了後、state は戻り値（error）になる', async () => {
    const getExistingSubscription = vi.fn(async () => EXISTING)
    const portUnsubscribe = vi.fn(async () => true)
    const port = createFakePushBrowserPort({ getExistingSubscription, unsubscribe: portUnsubscribe })
    gw.respondWith('DELETE', UNSUBSCRIBE_PATH, () => Promise.reject(new Error('server error')))

    const { result } = renderHook(() => useWebPushSubscription({ port }))
    await waitFor(() => expect(result.current.state).toBe('subscribed'))

    await act(async () => {
      await result.current.unsubscribe()
    })

    expect(result.current.state).toBe('error')
    await expectStableCallCount(getExistingSubscription, 2)
    expect(portUnsubscribe).toHaveBeenCalledTimes(1)
    expect(unsubscribeCalls()).toHaveLength(1)
  })

  // T70（改訂 8）
  test('CI-H8: 戻り値の形は { state, subscribe, unsubscribe } のまま。subscribe/unsubscribe は undefined で resolve', async () => {
    const port = createFakePushBrowserPort()

    const { result } = renderHook(() => useWebPushSubscription({ port }))
    await waitFor(() => expect(result.current.state).toBe('unsubscribed'))

    let v1: unknown
    let v2: unknown
    await act(async () => {
      v1 = await result.current.subscribe()
      v2 = await result.current.unsubscribe()
    })

    expect(Object.keys(result.current).sort()).toEqual(['state', 'subscribe', 'unsubscribe'])
    expect(v1).toBeUndefined()
    expect(v2).toBeUndefined()
    await expectStableCallCount(() => vapidCalls().length, 1)
  })

  // T71（改訂 11）
  test('CI-H6: subscribe() の戻り値 unsubscribed をそのまま state に入れる', async () => {
    const requestPermissionDeferred = createDeferred<NotificationPermission>()
    const requestPermission = vi.fn(() => requestPermissionDeferred.promise)
    const registerServiceWorker = vi.fn(async () => {})
    const portSubscribe = vi.fn(async () => EXISTING)
    const getExistingSubscription = vi.fn(async () => null)
    const port = createFakePushBrowserPort({
      requestPermission,
      registerServiceWorker,
      subscribe: portSubscribe,
      getExistingSubscription,
    })

    const { result } = renderHook(() => useWebPushSubscription({ port }))
    await waitFor(() => expect(result.current.state).toBe('unsubscribed'))

    let pending: Promise<void>
    act(() => {
      pending = result.current.subscribe()
    })
    expect(result.current.state).toBe('subscribing')

    await act(async () => {
      requestPermissionDeferred.resolve('default')
      await pending
    })

    expect(result.current.state).toBe('unsubscribed')
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(registerServiceWorker).not.toHaveBeenCalled()
    expect(vapidCalls()).toHaveLength(0)
    expect(portSubscribe).not.toHaveBeenCalled()
    expect(subscribeCalls()).toHaveLength(0)
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
  })

  // T72（改訂 11）
  test('CI-H6: subscribe() の戻り値 denied をそのまま state に入れる', async () => {
    const requestPermissionDeferred = createDeferred<NotificationPermission>()
    const requestPermission = vi.fn(() => requestPermissionDeferred.promise)
    const registerServiceWorker = vi.fn(async () => {})
    const portSubscribe = vi.fn(async () => EXISTING)
    const getExistingSubscription = vi.fn(async () => null)
    const port = createFakePushBrowserPort({
      requestPermission,
      registerServiceWorker,
      subscribe: portSubscribe,
      getExistingSubscription,
    })

    const { result } = renderHook(() => useWebPushSubscription({ port }))
    await waitFor(() => expect(result.current.state).toBe('unsubscribed'))

    let pending: Promise<void>
    act(() => {
      pending = result.current.subscribe()
    })
    expect(result.current.state).toBe('subscribing')

    await act(async () => {
      requestPermissionDeferred.resolve('denied')
      await pending
    })

    expect(result.current.state).toBe('denied')
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(registerServiceWorker).not.toHaveBeenCalled()
    expect(vapidCalls()).toHaveLength(0)
    expect(portSubscribe).not.toHaveBeenCalled()
    expect(subscribeCalls()).toHaveLength(0)
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
  })

  // T73（改訂 11）
  test('CI-H6: VAPID 取得失敗の戻り値 error をそのまま state に入れる', async () => {
    const requestPermissionDeferred = createDeferred<NotificationPermission>()
    const requestPermission = vi.fn(() => requestPermissionDeferred.promise)
    const registerServiceWorker = vi.fn(async () => {})
    const portSubscribe = vi.fn(async () => EXISTING)
    const getExistingSubscription = vi.fn(async () => null)
    const port = createFakePushBrowserPort({
      requestPermission,
      registerServiceWorker,
      subscribe: portSubscribe,
      getExistingSubscription,
    })
    gw.respondWith('GET', VAPID_PATH, () => Promise.reject(new Error('x')))

    const { result } = renderHook(() => useWebPushSubscription({ port }))
    await waitFor(() => expect(result.current.state).toBe('unsubscribed'))

    let pending: Promise<void>
    act(() => {
      pending = result.current.subscribe()
    })
    expect(result.current.state).toBe('subscribing')

    await act(async () => {
      requestPermissionDeferred.resolve('granted')
      await pending
    })

    expect(result.current.state).toBe('error')
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(registerServiceWorker).toHaveBeenCalledWith('/sw.js')
    expect(vapidCalls()).toHaveLength(1)
    expect(portSubscribe).not.toHaveBeenCalled()
    expect(subscribeCalls()).toHaveLength(0)
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
  })

  // T74（改訂 11）
  test('CI-H7: unsubscribe() の戻り値 unsubscribed をそのまま state に入れる', async () => {
    const getExistingSubscription = vi.fn(async () => EXISTING)
    const portUnsubscribe = vi.fn(async () => true)
    const port = createFakePushBrowserPort({ getExistingSubscription, unsubscribe: portUnsubscribe })

    const { result } = renderHook(() => useWebPushSubscription({ port }))
    await waitFor(() => expect(result.current.state).toBe('subscribed'))

    await act(async () => {
      await result.current.unsubscribe()
    })

    expect(result.current.state).toBe('unsubscribed')
    expect(getExistingSubscription).toHaveBeenCalledTimes(2)
    expect(portUnsubscribe).toHaveBeenCalledWith(EXISTING.endpoint)
    expect(gw.calls).toContainEqual({ method: 'DELETE', path: UNSUBSCRIBE_PATH, body: undefined })
  })

  // T75（改訂 11）
  test('CI-H1: isSupported が false なら state は unsupported', async () => {
    const isSupported = vi.fn(() => false)
    const getExistingSubscription = vi.fn(async () => null)
    const port = createFakePushBrowserPort({ isSupported, getExistingSubscription })

    const { result } = renderHook(() => useWebPushSubscription({ port }))

    await waitFor(() => expect(result.current.state).toBe('unsupported'))
    expect(isSupported).toHaveBeenCalledTimes(1)
    expect(getExistingSubscription).not.toHaveBeenCalled()
  })

  // T76（改訂 11）
  test('CI-H1: getPermission が denied なら state は denied', async () => {
    const getPermission = vi.fn((): NotificationPermission => 'denied')
    const getExistingSubscription = vi.fn(async () => null)
    const port = createFakePushBrowserPort({ getPermission, getExistingSubscription })

    const { result } = renderHook(() => useWebPushSubscription({ port }))

    await waitFor(() => expect(result.current.state).toBe('denied'))
    expect(getPermission).toHaveBeenCalledTimes(1)
    expect(getExistingSubscription).not.toHaveBeenCalled()
  })

  // T77（改訂 11）
  test('CI-H1: 購読なしなら state は unsubscribed', async () => {
    const getExistingSubscription = vi.fn(async () => null)
    const port = createFakePushBrowserPort({ getExistingSubscription })

    const { result } = renderHook(() => useWebPushSubscription({ port }))

    await waitFor(() => expect(result.current.state).toBe('unsubscribed'))
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
  })
})
