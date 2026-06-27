import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { LoginModal } from '@/components/ui/LoginModal'

const mockLogin = vi.fn()
const mockLoginWithPasskey = vi.fn()

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    login: mockLogin,
    loginWithPasskey: mockLoginWithPasskey,
    status: 'unauthenticated',
    user: null,
    logout: vi.fn(),
    refreshMe: vi.fn(),
  }),
}))

// ApiError は status を見るため実クラスを使う
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return actual
})

// createRealWebAuthnBrowserPort は LoginModal 内部で使用するのでモック
vi.mock('@/lib/webauthnBrowserPort', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/webauthnBrowserPort')>()
  return {
    ...actual,
    createRealWebAuthnBrowserPort: () => actual.createFakeWebAuthnBrowserPort(),
  }
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('LoginModal — Passkey ボタン', () => {
  test('「Passkey でログイン」ボタンが表示される', () => {
    render(<LoginModal />)
    expect(
      screen.getByRole('button', { name: /passkey でログイン/i }),
    ).toBeInTheDocument()
  })

  test('ボタンをクリックすると loginWithPasskey が呼ばれる', async () => {
    mockLoginWithPasskey.mockResolvedValue(undefined)
    render(<LoginModal />)

    await userEvent.click(screen.getByRole('button', { name: /passkey でログイン/i }))

    await waitFor(() => expect(mockLoginWithPasskey).toHaveBeenCalledOnce())
  })

  test('処理中は「認証中…」テキストが表示され重複クリックを防ぐ', async () => {
    let resolveLogin!: () => void
    mockLoginWithPasskey.mockReturnValue(
      new Promise<void>((res) => { resolveLogin = res }),
    )
    render(<LoginModal />)

    await userEvent.click(screen.getByRole('button', { name: /passkey でログイン/i }))

    expect(screen.getByRole('button', { name: /認証中/i })).toBeDisabled()

    resolveLogin()
  })

  test('NotAllowedError（ユーザーキャンセル）時は情報漏洩しない汎用エラーを表示する', async () => {
    mockLoginWithPasskey.mockRejectedValue(
      new DOMException('User cancelled', 'NotAllowedError'),
    )
    render(<LoginModal />)

    await userEvent.click(screen.getByRole('button', { name: /passkey でログイン/i }))

    // ユーザー存在を漏洩しない汎用文言
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/キャンセル/),
    )
  })

  test('API エラー時は汎用失敗メッセージを表示する', async () => {
    const { ApiError } = await import('@/lib/api')
    mockLoginWithPasskey.mockRejectedValue(new ApiError(401, 'Authentication failed'))
    render(<LoginModal />)

    await userEvent.click(screen.getByRole('button', { name: /passkey でログイン/i }))

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/passkey/i),
    )
  })

  test('既存のパスワードログインは引き続き機能する', async () => {
    mockLogin.mockResolvedValue(undefined)
    render(<LoginModal />)

    await userEvent.type(screen.getByLabelText('ユーザーID'), 'alice')
    await userEvent.type(screen.getByLabelText('パスワード'), 'secret-pw')
    await userEvent.click(screen.getByRole('button', { name: /^ログイン$/i }))

    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith('alice', 'secret-pw'))
  })
})
