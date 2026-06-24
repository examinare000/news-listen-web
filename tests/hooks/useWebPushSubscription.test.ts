import { describe, test, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWebPushSubscription } from '@/hooks/useWebPushSubscription'
import { createFakePushBrowserPort } from '@/lib/pushBrowserPort'

const mockGetVapidPublicKey = vi.fn().mockResolvedValue({ public_key: 'BNVa2nUfxEMGkLfDNj3test' })
const mockSubscribePush = vi.fn().mockResolvedValue({})
const mockUnsubscribePush = vi.fn().mockResolvedValue({})

vi.mock('@/contexts/AppContext', () => ({
  useApp: vi.fn(() => ({
    state: { baseUrl: 'https://api.example.com', apiKey: 'test-key', isConfigured: true, isRestoring: false, currentPodcast: null, playbackSpeed: 1.0 },
    dispatch: vi.fn(),
    configure: vi.fn(),
  })),
}))

vi.mock('@/lib/api', () => ({
  createApiClient: vi.fn(() => ({
    getVapidPublicKey: mockGetVapidPublicKey,
    subscribePush: mockSubscribePush,
    unsubscribePush: mockUnsubscribePush,
  })),
  ApiError: class ApiError extends Error { constructor(public status: number, public detail: string) { super(detail) } },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockGetVapidPublicKey.mockResolvedValue({ public_key: 'BNVa2nUfxEMGkLfDNj3test' })
  mockSubscribePush.mockResolvedValue({})
  mockUnsubscribePush.mockResolvedValue({})
})

describe('useWebPushSubscription — 初期化', () => {
  test('serviceWorker 非対応の場合 unsupported 状態になる', async () => {
    const port = createFakePushBrowserPort({ isSupported: () => false })
    const { result } = renderHook(() => useWebPushSubscription({ port }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(result.current.state).toBe('unsupported')
  })

  test('通知許可が denied の場合 denied 状態になる', async () => {
    const port = createFakePushBrowserPort({ getPermission: () => 'denied' })
    const { result } = renderHook(() => useWebPushSubscription({ port }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(result.current.state).toBe('denied')
  })

  test('既存購読がある場合 subscribed 状態になる（冪等）', async () => {
    const existing = { endpoint: 'https://fcm.example.com/existing', keys: { p256dh: 'p256dh-val', auth: 'auth-val' } }
    const port = createFakePushBrowserPort({ getExistingSubscription: async () => existing })
    const { result } = renderHook(() => useWebPushSubscription({ port }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(result.current.state).toBe('subscribed')
  })

  test('既存購読なし・許可 default の場合 unsubscribed 状態になる', async () => {
    const port = createFakePushBrowserPort()
    const { result } = renderHook(() => useWebPushSubscription({ port }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(result.current.state).toBe('unsubscribed')
  })
})

describe('useWebPushSubscription — subscribe 遷移', () => {
  test('subscribe() 呼び出しで subscribing → subscribed に遷移する', async () => {
    const port = createFakePushBrowserPort()
    const { result } = renderHook(() => useWebPushSubscription({ port }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(result.current.state).toBe('unsubscribed')
    await act(async () => { await result.current.subscribe() })
    expect(result.current.state).toBe('subscribed')
  })

  test('VAPID 公開鍵取得失敗時に error 状態になる', async () => {
    mockGetVapidPublicKey.mockRejectedValue(new Error('Network error'))
    const port = createFakePushBrowserPort()
    const { result } = renderHook(() => useWebPushSubscription({ port }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    await act(async () => { await result.current.subscribe() })
    expect(result.current.state).toBe('error')
  })

  test('subscribe() で許可が denied の場合 denied 状態になる', async () => {
    const port = createFakePushBrowserPort({ requestPermission: async () => 'denied' })
    const { result } = renderHook(() => useWebPushSubscription({ port }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    await act(async () => { await result.current.subscribe() })
    expect(result.current.state).toBe('denied')
  })
})

describe('useWebPushSubscription — unsubscribe 遷移', () => {
  test('unsubscribe() 呼び出しで unsubscribed に遷移する', async () => {
    const existing = { endpoint: 'https://fcm.example.com/existing', keys: { p256dh: 'p256dh-val', auth: 'auth-val' } }
    const port = createFakePushBrowserPort({
      getExistingSubscription: async () => existing,
      unsubscribe: async () => true,
    })
    const { result } = renderHook(() => useWebPushSubscription({ port }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(result.current.state).toBe('subscribed')
    await act(async () => { await result.current.unsubscribe() })
    expect(result.current.state).toBe('unsubscribed')
  })
})
