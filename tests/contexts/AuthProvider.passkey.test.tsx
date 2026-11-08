/**
 * AuthProvider の passkey ログイン経路テスト。
 *
 * @/lib/api/gateway の createGateway を gateway double に差し替えて通信を記録・応答し、
 * createFakeWebAuthnBrowserPort() でブラウザ境界をフェイク化する。
 * AuthProvider + passkey.ts の連携を統合的に検証する
 * （passkey モジュールはモックしない）。
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { PreferencesProvider } from '@/contexts/PreferencesProvider'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'
import { AuthProvider, useAuth } from '@/contexts/AuthProvider'
import { createFakeWebAuthnBrowserPort } from '../helpers/fakeWebAuthnBrowserPort'
import { setupMockCaches } from '../helpers/mockCaches'
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

const FAKE_OPTIONS = { challenge_id: 'cid-test', options: '{"challenge":"abc"}' }
const FAKE_USER = { username: 'alice', role: 'user' as const, display_name: 'Alice' }

const holder = vi.hoisted(() => ({ gw: undefined as GatewayDouble | undefined }))

vi.mock('@/lib/api/gateway', () => ({ createGateway: () => holder.gw }))

const ME_PATH = '/api/backend/auth/me'
const OPTIONS_PATH = '/api/backend/auth/passkey/login/options'
const VERIFY_PATH = '/api/backend/auth/passkey/login/verify'

let gw: GatewayDouble

function callsTo(method: string, path: string) {
  return gw.calls.filter((c) => c.method === method && c.path === path)
}

/** passkey ログインボタンをもつ Consumer。port は fake を直接注入。 */
function PasskeyConsumer() {
  const { view, loginWithPasskey } = useAuth()
  const status = view.kind === 'authenticated' ? 'authenticated' : view.kind === 'anonymous' ? 'unauthenticated' : 'unknown'
  const user = view.user
  const [error, setError] = React.useState<string | null>(null)

  async function handleClick() {
    try {
      await loginWithPasskey()
    } catch {
      setError('failed')
    }
  }

  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user?.username ?? '-'}</span>
      {error && <span data-testid="error">{error}</span>}
      <button onClick={handleClick}>passkey-login</button>
    </div>
  )
}

function renderAuth() {
  return render(
    <PreferencesProvider store={memoryStore()}>
      <AuthProvider webAuthnPort={createFakeWebAuthnBrowserPort()}>
        <PasskeyConsumer />
      </AuthProvider>
    </PreferencesProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  gw = createGatewayDouble()
  holder.gw = gw
  // 初期 /auth/me は 401（未認証状態から開始）
  gw.respond('GET', ME_PATH, { ok: false, failure: { kind: 'unauthorized' } })
})

// shared-leave-09 の場面だけ setupMockCaches() で global の caches を差し替えるので、既存の場面へ漏らさない
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AuthProvider — loginWithPasskey 状態遷移', () => {
  test('成功: authenticated に遷移し user がセットされる', async () => {
    gw.respond('POST', OPTIONS_PATH, { ok: true, value: FAKE_OPTIONS })
    gw.respond('POST', VERIFY_PATH, { ok: true, value: { token: 'tok', user: FAKE_USER } })

    renderAuth()
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'),
    )

    await userEvent.click(screen.getByText('passkey-login'))

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated'),
    )
    expect(screen.getByTestId('user')).toHaveTextContent('alice')
  })

  test('失敗: status は変わらず error が伝播する', async () => {
    gw.respondWith('POST', OPTIONS_PATH, () => Promise.reject(new Error('503')))

    renderAuth()
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'),
    )

    await userEvent.click(screen.getByText('passkey-login'))

    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('failed'))
    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    expect(screen.getByTestId('user')).toHaveTextContent('-')
  })

  test('verifyPasskeyLogin 401 失敗: status は変わらず error が伝播する', async () => {
    gw.respond('POST', OPTIONS_PATH, { ok: true, value: FAKE_OPTIONS })
    gw.respondWith('POST', VERIFY_PATH, () => Promise.reject(new Error('401 Unauthorized')))

    renderAuth()
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'),
    )

    await userEvent.click(screen.getByText('passkey-login'))

    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('failed'))
    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
  })
})

describe('AuthProvider — 未確定の後の passkey 成功で回収 (verifies: shared-leave-09)', () => {
  test('shared-leave-09: getMe が通信断（unavailable）の後の passkey 成功で、現在の主体 B 以外の audio-v1* を 1 回回収する', async () => {
    const cacheStorage = setupMockCaches()
    await cacheStorage.open('audio-v1')
    await cacheStorage.open('audio-v1-u-a')
    await cacheStorage.open('audio-v1-u-b')
    await cacheStorage.open('shell-pages-v1')
    gw.respond('GET', ME_PATH, { ok: false, failure: { kind: 'network' } })
    gw.respond('POST', OPTIONS_PATH, { ok: true, value: FAKE_OPTIONS })
    gw.respond('POST', VERIFY_PATH, { ok: true, value: { token: 'tok', user: { ...FAKE_USER, user_id: 'u-b' } } })
    renderAuth()
    await waitFor(() => expect(callsTo('GET', ME_PATH)).toHaveLength(1))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unknown'))
    // 通信断では回収しない
    await expect(cacheStorage.has('audio-v1')).resolves.toBe(true)

    await userEvent.click(screen.getByText('passkey-login'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    await waitFor(() => expect(cacheStorage.has('audio-v1')).resolves.toBe(false))
    await expect(cacheStorage.has('audio-v1-u-a')).resolves.toBe(false)
    await expect(cacheStorage.has('audio-v1-u-b')).resolves.toBe(true)
    await expect(cacheStorage.has('shell-pages-v1')).resolves.toBe(true)
  })
})
