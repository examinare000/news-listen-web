import { describe, test, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render as rtlRender, screen } from '@testing-library/react'
import type { RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import userEvent from '@testing-library/user-event'
import { PushNotificationSection } from '@/components/PushNotificationSection'
import { createFakePushBrowserPort } from '../helpers/fakePushBrowserPort'
import type { PushBrowserPort } from '@/lib/notifications/application/ports'
import { createGatewayDouble } from '../helpers/gatewayDouble'
import type { GatewayDouble } from '../helpers/gatewayDouble'

const render = (ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) =>
  rtlRender(ui, { wrapper: ApiClientProvider, ...options })

const holder = vi.hoisted(() => ({ gw: undefined as GatewayDouble | undefined }))
const portHolder = vi.hoisted(() => ({ port: undefined as PushBrowserPort | undefined }))

vi.mock('@/lib/api/gateway', () => ({ createGateway: () => holder.gw }))

vi.mock('@/lib/platform/pushBrowser', () => ({ createRealPushBrowserPort: () => portHolder.port }))

const VAPID_PATH = '/api/backend/notifications/vapid-public-key'
const SUBSCRIPTIONS_PATH = '/api/backend/notifications/subscriptions'

let gw: GatewayDouble

function callsTo(method: string, path: string) {
  return gw.calls.filter((c) => c.method === method && c.path === path)
}

beforeEach(() => {
  gw = createGatewayDouble()
  holder.gw = gw
  vi.clearAllMocks()
  gw.respond('GET', VAPID_PATH, { ok: true, value: { public_key: 'BNVa2nUfxEMGkLfDNj3test' } })
  gw.respond('POST', SUBSCRIPTIONS_PATH, { ok: true, value: {} })
})

describe('PushNotificationSection', () => {
  test('serviceWorker 非対応の場合「このブラウザは対応していません」を表示する', async () => {
    const port = createFakePushBrowserPort({ isSupported: () => false })
    portHolder.port = port
    render(<PushNotificationSection />)

    // 状態更新を待つ
    await screen.findByText(/このブラウザは対応していません/i)
  })

  test('unsubscribed 状態でプッシュ通知を有効にするボタンを表示する', async () => {
    const port = createFakePushBrowserPort()
    portHolder.port = port
    render(<PushNotificationSection />)

    const button = await screen.findByRole('button', { name: /通知を有効にする/i })
    expect(button).toBeInTheDocument()
  })

  test('subscribed 状態で通知が有効であることを示し、無効化ボタンを表示する', async () => {
    const existing = { endpoint: 'https://fcm.example.com/sub', keys: { p256dh: 'p256', auth: 'auth' } }
    const port = createFakePushBrowserPort({ getExistingSubscription: async () => existing })
    portHolder.port = port
    render(<PushNotificationSection />)

    const button = await screen.findByRole('button', { name: /通知を無効にする/i })
    expect(button).toBeInTheDocument()
  })

  test('denied 状態でブラウザ設定変更を促すメッセージを表示する', async () => {
    const port = createFakePushBrowserPort({ getPermission: () => 'denied' })
    portHolder.port = port
    render(<PushNotificationSection />)

    await screen.findByText(/通知が拒否されています/i)
  })

  test('通知を有効にするボタンクリックで subscribe が呼ばれる', async () => {
    // gateway は record から body を作り直すので、port の購読は実 port と同じ形の record を返す
    const mockSubscribe = vi.fn().mockResolvedValue({ endpoint: 'https://fcm.example.com/new', keys: { p256dh: 'p256dh-val', auth: 'auth-val' } })
    const port = createFakePushBrowserPort({
      requestPermission: async () => 'granted',
      subscribe: mockSubscribe,
    })
    portHolder.port = port
    render(<PushNotificationSection />)

    const button = await screen.findByRole('button', { name: /通知を有効にする/i })
    await userEvent.click(button)

    // 購読後、バックエンド登録が呼ばれることを確認
    expect(callsTo('POST', SUBSCRIPTIONS_PATH).length).toBeGreaterThan(0)
  })

  test('unsubscribed 状態の説明文を表示する', async () => {
    const port = createFakePushBrowserPort()
    portHolder.port = port
    render(<PushNotificationSection />)

    await screen.findByText(/プッシュ通知は無効です/i)
  })

  test('subscribed 状態の説明文を表示する', async () => {
    const existing = { endpoint: 'https://fcm.example.com/sub', keys: { p256dh: 'p256', auth: 'auth' } }
    const port = createFakePushBrowserPort({ getExistingSubscription: async () => existing })
    portHolder.port = port
    render(<PushNotificationSection />)

    await screen.findByText(/プッシュ通知は有効です/i)
  })
})
