import { describe, test, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PushNotificationSection } from '@/components/PushNotificationSection'
import { createFakePushBrowserPort } from '@/lib/pushBrowserPort'

// AppContext の mock
vi.mock('@/contexts/AppContext', () => ({
  useApp: vi.fn(() => ({
    state: {
      baseUrl: 'https://api.example.com',
      apiKey: 'test-key',
      isRestoring: false,
      currentPodcast: null,
      playbackSpeed: 1.0,
    },
    dispatch: vi.fn(),
    configure: vi.fn(),
  })),
}))

// API の mock
const mockGetVapidPublicKey = vi.fn().mockResolvedValue({ public_key: 'BNVa2nUfxEMGkLfDNj3test' })
const mockSubscribePush = vi.fn().mockResolvedValue({})
const mockUnsubscribePush = vi.fn().mockResolvedValue({})

vi.mock('@/lib/api', () => ({
  createApiClient: vi.fn(() => ({
    getVapidPublicKey: mockGetVapidPublicKey,
    subscribePush: mockSubscribePush,
    unsubscribePush: mockUnsubscribePush,
  })),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public detail: string) {
      super(detail)
    }
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockGetVapidPublicKey.mockResolvedValue({ public_key: 'BNVa2nUfxEMGkLfDNj3test' })
  mockSubscribePush.mockResolvedValue({})
  mockUnsubscribePush.mockResolvedValue({})
})

describe('PushNotificationSection', () => {
  test('serviceWorker 非対応の場合「このブラウザは対応していません」を表示する', async () => {
    const port = createFakePushBrowserPort({ isSupported: () => false })
    render(<PushNotificationSection port={port} />)

    // 状態更新を待つ
    await screen.findByText(/このブラウザは対応していません/i)
  })

  test('unsubscribed 状態でプッシュ通知を有効にするボタンを表示する', async () => {
    const port = createFakePushBrowserPort()
    render(<PushNotificationSection port={port} />)

    const button = await screen.findByRole('button', { name: /通知を有効にする/i })
    expect(button).toBeInTheDocument()
  })

  test('subscribed 状態で通知が有効であることを示し、無効化ボタンを表示する', async () => {
    const existing = { endpoint: 'https://fcm.example.com/sub', keys: { p256dh: 'p256', auth: 'auth' } }
    const port = createFakePushBrowserPort({ getExistingSubscription: async () => existing })
    render(<PushNotificationSection port={port} />)

    const button = await screen.findByRole('button', { name: /通知を無効にする/i })
    expect(button).toBeInTheDocument()
  })

  test('denied 状態でブラウザ設定変更を促すメッセージを表示する', async () => {
    const port = createFakePushBrowserPort({ getPermission: () => 'denied' })
    render(<PushNotificationSection port={port} />)

    await screen.findByText(/通知が拒否されています/i)
  })

  test('通知を有効にするボタンクリックで subscribe が呼ばれる', async () => {
    const mockSubscribe = vi.fn().mockResolvedValue(undefined)
    const port = createFakePushBrowserPort({
      requestPermission: async () => 'granted',
      subscribe: mockSubscribe,
    })
    render(<PushNotificationSection port={port} />)

    const button = await screen.findByRole('button', { name: /通知を有効にする/i })
    await userEvent.click(button)

    // 購読後、バックエンド登録が呼ばれることを確認
    expect(mockSubscribePush).toHaveBeenCalled()
  })

  test('unsubscribed 状態の説明文を表示する', async () => {
    const port = createFakePushBrowserPort()
    render(<PushNotificationSection port={port} />)

    await screen.findByText(/プッシュ通知は無効です/i)
  })

  test('subscribed 状態の説明文を表示する', async () => {
    const existing = { endpoint: 'https://fcm.example.com/sub', keys: { p256dh: 'p256', auth: 'auth' } }
    const port = createFakePushBrowserPort({ getExistingSubscription: async () => existing })
    render(<PushNotificationSection port={port} />)

    await screen.findByText(/プッシュ通知は有効です/i)
  })
})
