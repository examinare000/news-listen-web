import { describe, test, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PushNotificationSection } from '@/components/PushNotificationSection'
import { createFakePushBrowserPort } from '@/lib/pushBrowserPort'
import { createGatewayDouble } from '../helpers/gatewayDouble'
import type { GatewayDouble } from '../helpers/gatewayDouble'

const holder = vi.hoisted(() => ({ gw: undefined as GatewayDouble | undefined }))

vi.mock('@/lib/api/gateway', () => ({ createGateway: () => holder.gw }))

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
    expect(callsTo('POST', SUBSCRIPTIONS_PATH).length).toBeGreaterThan(0)
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
