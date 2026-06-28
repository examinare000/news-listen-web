/**
 * AuthContext の passkey ログイン経路テスト。
 *
 * vi.mock('@/lib/api') でクライアントをモック化し、
 * createFakeWebAuthnBrowserPort() でブラウザ境界をフェイク化する。
 * AuthContext + passkey.ts の連携を統合的に検証する
 * （passkey モジュールはモックしない）。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { AppProvider } from '@/contexts/AppContext'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { createFakeWebAuthnBrowserPort } from '@/lib/webauthnBrowserPort'

const FAKE_OPTIONS = { challenge_id: 'cid-test', options: '{"challenge":"abc"}' }
const FAKE_USER = { username: 'alice', role: 'user' as const, display_name: 'Alice' }

const mockGetMe = vi.fn()
const mockGetPasskeyLoginOptions = vi.fn()
const mockVerifyPasskeyLogin = vi.fn()

vi.mock('@/lib/api', () => ({
  createApiClient: () => ({
    getMe: mockGetMe,
    login: vi.fn(),
    logout: vi.fn(),
    getPasskeyLoginOptions: mockGetPasskeyLoginOptions,
    verifyPasskeyLogin: mockVerifyPasskeyLogin,
  }),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public detail: string,
    ) {
      super(detail)
      this.name = 'ApiError'
    }
  },
}))

/** passkey ログインボタンをもつ Consumer。port は fake を直接注入。 */
function PasskeyConsumer() {
  const { status, user, loginWithPasskey } = useAuth()
  const fakePort = createFakeWebAuthnBrowserPort()
  const [error, setError] = React.useState<string | null>(null)

  async function handleClick() {
    try {
      await loginWithPasskey(fakePort)
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
    <AppProvider
    >
      <AuthProvider>
        <PasskeyConsumer />
      </AuthProvider>
    </AppProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // 初期 /auth/me は 401（未認証状態から開始）
  mockGetMe.mockRejectedValue(new Error('401'))
})

describe('AuthProvider — loginWithPasskey 状態遷移', () => {
  test('成功: authenticated に遷移し user がセットされる', async () => {
    mockGetPasskeyLoginOptions.mockResolvedValue(FAKE_OPTIONS)
    mockVerifyPasskeyLogin.mockResolvedValue({ token: 'tok', user: FAKE_USER })

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
    mockGetPasskeyLoginOptions.mockRejectedValue(new Error('503'))

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
    mockGetPasskeyLoginOptions.mockResolvedValue(FAKE_OPTIONS)
    mockVerifyPasskeyLogin.mockRejectedValue(new Error('401 Unauthorized'))

    renderAuth()
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'),
    )

    await userEvent.click(screen.getByText('passkey-login'))

    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('failed'))
    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
  })
})
