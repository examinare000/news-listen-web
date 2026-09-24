import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { AppProvider } from '@/contexts/AppContext'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { createFakePushBrowserPort } from '@/lib/pushBrowserPort'
import type { PushBrowserPort } from '@/lib/pushBrowserPort'
import type { PushSubscriptionJSON } from '@/types/index'

const getMe = vi.fn()
const login = vi.fn()
const logout = vi.fn()
const register = vi.fn()
const unsubscribePush = vi.fn()

vi.mock('@/lib/api', () => ({
  createApiClient: () => ({ getMe, login, logout, register, unsubscribePush }),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public detail: string) {
      super(detail)
      this.name = 'ApiError'
    }
  },
}))

const { deleteAllAudio } = vi.hoisted(() => ({
  deleteAllAudio: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/audioCache', () => ({ deleteAllAudio }))

const { clearManagedServiceWorkerCaches } = vi.hoisted(() => ({
  clearManagedServiceWorkerCaches: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/swCacheCleanup', () => ({ clearManagedServiceWorkerCaches }))

const { fakePortHolder } = vi.hoisted(() => ({
  fakePortHolder: { port: null as PushBrowserPort | null },
}))
vi.mock('@/lib/pushBrowserPort', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pushBrowserPort')>()
  return {
    ...actual,
    createRealPushBrowserPort: () => fakePortHolder.port as PushBrowserPort,
  }
})

const EXISTING: PushSubscriptionJSON = {
  endpoint: 'https://fcm.example.com/existing',
  keys: { p256dh: 'p256dh-val', auth: 'auth-val' },
}

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
      <span data-testid="status">{auth.status}</span>
      <button onClick={() => { auth.logout().catch(() => {}) }}>logout</button>
    </div>
  )
}

function renderAuth(authRef: AuthRef) {
  return render(
    <AppProvider>
      <AuthProvider initialStatus="authenticated" initialUser={{ username: 'alice', role: 'user', display_name: 'Alice' }}>
        <Consumer authRef={authRef} />
      </AuthProvider>
    </AppProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  fakePortHolder.port = null
  logout.mockResolvedValue({ status: 'ok' })
  deleteAllAudio.mockResolvedValue(undefined)
  clearManagedServiceWorkerCaches.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AuthProvider logout — push 購読解除（SG-C6）', () => {
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
    expect(unsubscribePush).toHaveBeenCalledTimes(1)
    expect(unsubscribePush).toHaveBeenCalledWith(EXISTING.endpoint)
    expect(portUnsubscribe).not.toHaveBeenCalled()
    expect(unsubscribePush.mock.invocationCallOrder[0]).toBeLessThan(logout.mock.invocationCallOrder[0])
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
  })

  // T51（改訂 9）
  test('R5, CI-L1, CI-L2: unsubscribePush が reject しても logout は続行する', async () => {
    const isSupported = vi.fn(() => true)
    const getExistingSubscription = vi.fn(async () => EXISTING)
    setLogoutPort(createFakePushBrowserPort({ isSupported, getExistingSubscription }))
    unsubscribePush.mockRejectedValue(new Error('server error'))
    const authRef: AuthRef = { current: null }
    renderAuth(authRef)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))

    await userEvent.click(screen.getByText('logout'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(unsubscribePush).toHaveBeenCalledWith(EXISTING.endpoint)
    expect(unsubscribePush).toHaveBeenCalledTimes(1)
    expect(unsubscribePush.mock.invocationCallOrder[0]).toBeLessThan(logout.mock.invocationCallOrder[0])
    expect(logout).toHaveBeenCalledTimes(1)
    expect(deleteAllAudio).toHaveBeenCalledTimes(1)
    expect(clearManagedServiceWorkerCaches).toHaveBeenCalledTimes(1)
    expect(isSupported).toHaveBeenCalledTimes(1)
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
  })

  // T52（改訂 9）
  test('R5, CI-L2: getExistingSubscription が reject しても logout は続行する', async () => {
    const isSupported = vi.fn(() => true)
    const getExistingSubscription = vi.fn(async () => { throw new Error('boom') })
    setLogoutPort(createFakePushBrowserPort({ isSupported, getExistingSubscription }))
    const authRef: AuthRef = { current: null }
    renderAuth(authRef)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))

    await userEvent.click(screen.getByText('logout'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
    expect(getExistingSubscription.mock.invocationCallOrder[0]).toBeLessThan(logout.mock.invocationCallOrder[0])
    expect(unsubscribePush).not.toHaveBeenCalled()
    expect(isSupported).toHaveBeenCalledTimes(1)
  })

  // T53（改訂 9）
  test('R5, CI-L2: 既存購読が無くても logout は完了する', async () => {
    const isSupported = vi.fn(() => true)
    const getExistingSubscription = vi.fn(async () => null)
    setLogoutPort(createFakePushBrowserPort({ isSupported, getExistingSubscription }))
    const authRef: AuthRef = { current: null }
    renderAuth(authRef)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))

    await userEvent.click(screen.getByText('logout'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
    expect(getExistingSubscription.mock.invocationCallOrder[0]).toBeLessThan(logout.mock.invocationCallOrder[0])
    expect(unsubscribePush).not.toHaveBeenCalled()
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

    expect(logout).not.toHaveBeenCalled()
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    expect(isSupported).toHaveBeenCalledTimes(1)
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
    await act(async () => {
      deferred.resolve(null)
      await pending
    })

    expect(logout).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(isSupported).toHaveBeenCalledTimes(1)
    expect(getExistingSubscription).toHaveBeenCalledTimes(1)
  })
})
