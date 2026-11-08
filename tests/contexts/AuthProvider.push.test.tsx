import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { PreferencesProvider } from '@/contexts/PreferencesProvider'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'
import { AuthProvider, useAuth } from '@/contexts/AuthProvider'
import { createFakePushBrowserPort } from '../helpers/fakePushBrowserPort'
import type { PushBrowserPort } from '@/lib/notifications/application/ports'
import type { PushSubscriptionJSON } from '@/types/index'
import { createGatewayDouble } from '../helpers/gatewayDouble'
import type { GatewayDouble } from '../helpers/gatewayDouble'

// 設定の保存先は、テストごとに新しい in-memory の KeyValueStore
const memoryStore = (initial: Record<string, string> = {}): KeyValueStore => {
  const data = new Map(Object.entries(initial))
  return {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => {
      data.set(key, value)
      return true
    },
    remove: (key) => {
      data.delete(key)
    },
  }
}

const holder = vi.hoisted(() => ({ gw: undefined as GatewayDouble | undefined }))

vi.mock('@/lib/api/gateway', () => ({ createGateway: () => holder.gw }))

const LOGOUT_PATH = '/api/backend/auth/logout'
const UNSUBSCRIBE_PREFIX = '/api/backend/notifications/subscriptions?endpoint='

let gw: GatewayDouble

function callsTo(method: string, path: string) {
  return gw.calls.filter((c) => c.method === method && c.path === path)
}

function callsStartingWith(method: string, prefix: string) {
  return gw.calls.filter((c) => c.method === method && c.path.startsWith(prefix))
}

function firstIndexOfCall(method: string, path: string) {
  return gw.calls.findIndex((c) => c.method === method && c.path === path)
}

function firstIndexStartingWith(method: string, prefix: string) {
  return gw.calls.findIndex((c) => c.method === method && c.path.startsWith(prefix))
}

// logout request の応答時点で、port の getExistingSubscription が何回呼ばれていたかを記録する
let existingCallsAtLogout: number | null = null

function respondLogoutRecording(existingCalls: () => number) {
  gw.respondWith('POST', LOGOUT_PATH, () => {
    existingCallsAtLogout = existingCalls()
    return Promise.resolve({ ok: true, value: { status: 'ok' } })
  })
}

const { reclaimAudioCaches, deleteSubjectAudio } = vi.hoisted(() => ({
  reclaimAudioCaches: vi.fn().mockResolvedValue(undefined),
  deleteSubjectAudio: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/playback/infrastructure/offlineLibrary', () => ({ reclaimAudioCaches, deleteSubjectAudio }))

const { clearManagedServiceWorkerCaches } = vi.hoisted(() => ({
  clearManagedServiceWorkerCaches: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/platform/swCacheCleanup', () => ({ clearManagedServiceWorkerCaches }))

const { fakePortHolder } = vi.hoisted(() => ({
  fakePortHolder: { port: null as PushBrowserPort | null },
}))
vi.mock('@/lib/platform/pushBrowser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/platform/pushBrowser')>()
  return {
    ...actual,
    createRealPushBrowserPort: () => fakePortHolder.port as PushBrowserPort,
  }
})

const EXISTING: PushSubscriptionJSON = {
  endpoint: 'https://fcm.example.com/existing',
  keys: { p256dh: 'p256dh-val', auth: 'auth-val' },
}

const EXISTING_UNSUBSCRIBE_PATH = `${UNSUBSCRIBE_PREFIX}${encodeURIComponent(EXISTING.endpoint)}`

function setLogoutPort(port: PushBrowserPort) {
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

interface AuthRef {
  current: ReturnType<typeof useAuth> | null
}

function Consumer({ authRef }: { authRef: AuthRef }) {
  const auth = useAuth()
  React.useEffect(() => {
    authRef.current = auth
  })
  return (
    <div>
      <span data-testid="status">{auth.view.kind === 'authenticated' ? 'authenticated' : auth.view.kind === 'anonymous' ? 'unauthenticated' : 'unknown'}</span>
      <button onClick={() => { auth.logout().catch(() => {}) }}>logout</button>
    </div>
  )
}

function renderAuth(authRef: AuthRef) {
  return render(
    <PreferencesProvider store={memoryStore()}>
      <AuthProvider initialSession={{ kind: 'authenticated', user: { username: 'alice', role: 'user', display_name: 'Alice', userId: 'u-alice' } }}>
        <Consumer authRef={authRef} />
      </AuthProvider>
    </PreferencesProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  gw = createGatewayDouble()
  holder.gw = gw
  existingCallsAtLogout = null
  fakePortHolder.port = null
  gw.respond('POST', LOGOUT_PATH, { ok: true, value: { status: 'ok' } })
  gw.respond('DELETE', EXISTING_UNSUBSCRIBE_PATH, { ok: true, value: undefined })
  reclaimAudioCaches.mockResolvedValue(undefined)
  deleteSubjectAudio.mockResolvedValue(undefined)
  clearManagedServiceWorkerCaches.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AuthProvider logout — push 購読解除（web-dec-04）', () => {
  // T50
  test('R4, CI-L1, CI-D2: 既存購読があれば client().logout() より前に unsubscribePush を呼ぶ。port.unsubscribe は呼ばない', async () => {
    const portUnsubscribe = vi.fn(async () => true)
    const getExistingSubscription = vi.fn(async () => EXISTING)
    setLogoutPort(createFakePushBrowserPort({ getExistingSubscription, unsubscribe: portUnsubscribe }))
    const authRef: AuthRef = { current: null }
    renderAuth(authRef)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))

    await userEvent.click(screen.getByText('logout'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(callsStartingWith('DELETE', UNSUBSCRIBE_PREFIX)).toHaveLength(1)
    expect(gw.calls).toContainEqual({ method: 'DELETE', path: EXISTING_UNSUBSCRIBE_PATH, body: undefined })
    expect(portUnsubscribe).not.toHaveBeenCalled()
    expect(firstIndexStartingWith('DELETE', UNSUBSCRIBE_PREFIX)).toBeLessThan(firstIndexOfCall('POST', LOGOUT_PATH))
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
  })

  // T51（改訂 9）
  test('R5, CI-L1, CI-L2: unsubscribePush が reject しても logout は続行する', async () => {
    const isSupported = vi.fn(() => true)
    const getExistingSubscription = vi.fn(async () => EXISTING)
    setLogoutPort(createFakePushBrowserPort({ isSupported, getExistingSubscription }))
    gw.respondWith('DELETE', EXISTING_UNSUBSCRIBE_PATH, () => Promise.reject(new Error('server error')))
    const authRef: AuthRef = { current: null }
    renderAuth(authRef)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))

    await userEvent.click(screen.getByText('logout'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(gw.calls).toContainEqual({ method: 'DELETE', path: EXISTING_UNSUBSCRIBE_PATH, body: undefined })
    expect(callsStartingWith('DELETE', UNSUBSCRIBE_PREFIX)).toHaveLength(1)
    expect(firstIndexStartingWith('DELETE', UNSUBSCRIBE_PREFIX)).toBeLessThan(firstIndexOfCall('POST', LOGOUT_PATH))
    expect(callsTo('POST', LOGOUT_PATH)).toHaveLength(1)
    // logout の後始末は await されない（web-dec-79 / shared-dec-28）ので、完了を待って確かめる
    await waitFor(() => expect(deleteSubjectAudio).toHaveBeenCalledTimes(1))
    expect(deleteSubjectAudio).toHaveBeenCalledWith(null, 'u-alice')
    await waitFor(() => expect(clearManagedServiceWorkerCaches).toHaveBeenCalledTimes(1))
    expect(isSupported).toHaveBeenCalledTimes(1)
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
  })

  // T52（改訂 9）
  test('R5, CI-L2: getExistingSubscription が reject しても logout は続行する', async () => {
    const isSupported = vi.fn(() => true)
    const getExistingSubscription = vi.fn(async () => { throw new Error('boom') })
    setLogoutPort(createFakePushBrowserPort({ isSupported, getExistingSubscription }))
    respondLogoutRecording(() => getExistingSubscription.mock.calls.length)
    const authRef: AuthRef = { current: null }
    renderAuth(authRef)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))

    await userEvent.click(screen.getByText('logout'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
    expect(existingCallsAtLogout).toBeGreaterThanOrEqual(1)
    expect(callsStartingWith('DELETE', UNSUBSCRIBE_PREFIX)).toHaveLength(0)
    expect(isSupported).toHaveBeenCalledTimes(1)
  })

  // T53（改訂 9）
  test('R5, CI-L2: 既存購読が無くても logout は完了する', async () => {
    const isSupported = vi.fn(() => true)
    const getExistingSubscription = vi.fn(async () => null)
    setLogoutPort(createFakePushBrowserPort({ isSupported, getExistingSubscription }))
    respondLogoutRecording(() => getExistingSubscription.mock.calls.length)
    const authRef: AuthRef = { current: null }
    renderAuth(authRef)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))

    await userEvent.click(screen.getByText('logout'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
    expect(existingCallsAtLogout).toBeGreaterThanOrEqual(1)
    expect(callsStartingWith('DELETE', UNSUBSCRIBE_PREFIX)).toHaveLength(0)
    expect(isSupported).toHaveBeenCalledTimes(1)
  })

  // T54（改訂 3。手順固定）
  test('R5, CI-L3, CI-D4: logout に待ち時間上限が無い（timeout を足していない）', async () => {
    const isSupported = vi.fn(() => true)
    const deferred = createDeferred<PushSubscriptionJSON | null>()
    const getExistingSubscription = vi.fn(() => deferred.promise)
    setLogoutPort(createFakePushBrowserPort({ isSupported, getExistingSubscription }))
    const authRef: AuthRef = { current: null }
    renderAuth(authRef)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))

    vi.useFakeTimers()
    let pending: Promise<void>
    await act(async () => {
      pending = authRef.current!.logout()
      await vi.advanceTimersByTimeAsync(600_000)
    })

    expect(callsTo('POST', LOGOUT_PATH)).toHaveLength(0)
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    expect(isSupported).toHaveBeenCalledTimes(1)
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
    await act(async () => {
      deferred.resolve(null)
      await pending
    })

    expect(callsTo('POST', LOGOUT_PATH)).toHaveLength(1)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(isSupported).toHaveBeenCalledTimes(1)
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
  })
})
