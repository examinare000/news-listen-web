import { describe, test, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { AccountSection } from '@/components/ui/AccountSection'

// ── グローバルモック（lib/api は実装を使う） ────────────────────────────

// AppContext mock
vi.mock('@/contexts/AppContext', () => ({
  useApp: vi.fn(() => ({
    state: {
      baseUrl: 'https://api.example.com',
      apiKey: 'test-key',
      isRestoring: false,
    },
    dispatch: vi.fn(),
  })),
}))

// AuthContext mock
const mockLogout = vi.fn()
const mockRefreshMe = vi.fn()
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { username: 'alice', role: 'user' as const, display_name: 'Alice' },
    logout: mockLogout,
    refreshMe: mockRefreshMe,
    loginWithPasskey: vi.fn(),
  })),
}))

// passkey.ts mock
vi.mock('@/lib/passkey', () => ({
  registerPasskey: vi.fn(),
  loginWithPasskey: vi.fn(),
}))

// createRealWebAuthnBrowserPort mock
vi.mock('@/lib/webauthnBrowserPort', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/webauthnBrowserPort')>()
  return {
    ...actual,
    createRealWebAuthnBrowserPort: () => actual.createFakeWebAuthnBrowserPort(),
  }
})

// next/link mock
vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', props, children),
}))

// next/navigation mock
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    replace: vi.fn(),
    push: vi.fn(),
  })),
  usePathname: vi.fn(() => '/'),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AccountSection — 結合テスト：fetch が 422 FastAPI エラー配列を返す → UI に日本語対訳を表示', () => {
  test('fetch が {detail:[{msg:"Value error, password must be at least 12 characters long",...}]} 422 を返し、UI に日本語メッセージを表示', async () => {
    // グローバル fetch をスタブ：changePassword エンドポイントが 422 を返す
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        // GET /api/backend/auth/passkey/credentials と GET /api/backend/auth/sessions はモック成功
        if (url === '/api/backend/auth/passkey/credentials') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ credentials: [] }),
            headers: { get: () => null },
          } as unknown as Response)
        }
        if (url === '/api/backend/auth/sessions') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ sessions: [] }),
            headers: { get: () => null },
          } as unknown as Response)
        }
        // POST /api/backend/auth/password は 422 を返す（FastAPI Pydantic validation error）
        if (url === '/api/backend/auth/password' && init?.method === 'POST') {
          return Promise.resolve({
            ok: false,
            status: 422,
            json: () => Promise.resolve({
              detail: [
                {
                  msg: 'Value error, password must be at least 12 characters long',
                  type: 'value_error',
                },
              ],
            }),
            headers: { get: () => null },
          } as unknown as Response)
        }
        // その他はデフォルト成功応答
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
          headers: { get: () => null },
        } as unknown as Response)
      })
    )

    render(<AccountSection />)

    // パスワード変更フォームに入力
    const currentPwInput = await screen.findByLabelText('現在のパスワード')
    const newPwInput = await screen.findByLabelText('新しいパスワード')

    await userEvent.type(currentPwInput, 'current-password')
    await userEvent.type(newPwInput, 'Abcd1234567!')

    await userEvent.click(screen.getByRole('button', { name: 'パスワードを変更' }))

    // 422 レスポンス後、translatePasswordPolicyDetail で対訳された日本語メッセージが表示される
    // （「Value error, 」プレフィックスが削除され、対訳テーブルで「password must be at least 12 characters long」が「新しいパスワードは12文字以上にしてください」に変換）
    await waitFor(() =>
      screen.getByText('新しいパスワードは12文字以上にしてください')
    )
  })
})
