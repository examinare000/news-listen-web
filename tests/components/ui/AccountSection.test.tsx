import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { AccountSection } from '@/components/ui/AccountSection'
import type { PasskeyCredential } from '@/types/index'

// vi.hoisted で mock 変数を宣言する（vi.mock のホイスティングより前に評価される）
const {
  mockUpdateProfile,
  mockChangePassword,
  mockGetPasskeyCredentials,
  mockDeletePasskeyCredential,
  mockRegisterPasskey,
  mockLogout,
  mockRefreshMe,
} = vi.hoisted(() => ({
  mockUpdateProfile: vi.fn(),
  mockChangePassword: vi.fn(),
  mockGetPasskeyCredentials: vi.fn(),
  mockDeletePasskeyCredential: vi.fn(),
  mockRegisterPasskey: vi.fn(),
  mockLogout: vi.fn(),
  mockRefreshMe: vi.fn(),
}))

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

vi.mock('@/lib/api', () => ({
  createApiClient: vi.fn(() => ({
    updateProfile: mockUpdateProfile,
    changePassword: mockChangePassword,
    getPasskeyCredentials: mockGetPasskeyCredentials,
    deletePasskeyCredential: mockDeletePasskeyCredential,
  })),
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

// passkey.ts の registerPasskey をモック（browser port を使うため）
vi.mock('@/lib/passkey', () => ({
  registerPasskey: mockRegisterPasskey,
  loginWithPasskey: vi.fn(),
}))

// createRealWebAuthnBrowserPort はテスト不要なのでフェイクに差し替え
vi.mock('@/lib/webauthnBrowserPort', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/webauthnBrowserPort')>()
  return {
    ...actual,
    createRealWebAuthnBrowserPort: () => actual.createFakeWebAuthnBrowserPort(),
  }
})

const MOCK_USER = { username: 'alice', role: 'user' as const, display_name: 'Alice' }

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: MOCK_USER,
    logout: mockLogout,
    refreshMe: mockRefreshMe,
    loginWithPasskey: vi.fn(),
  })),
}))

// next/link mock
vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', props, children),
}))

const FAKE_CRED: PasskeyCredential = {
  credential_id: 'cred-abc-123',
  username: 'alice',
  name: 'My Passkey',
  transports: ['internal'],
  aaguid: null,
  sign_count: 3,
  created_at: '2025-01-15T10:00:00Z',
  last_used_at: '2025-06-01T12:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetPasskeyCredentials.mockResolvedValue({ credentials: [] })
})

describe('AccountSection — Passkey 登録', () => {
  test('「Passkey を登録」ボタンが表示される', async () => {
    render(<AccountSection />)
    expect(
      await screen.findByRole('button', { name: /passkey を登録/i }),
    ).toBeInTheDocument()
  })

  test('登録ボタンをクリックすると registerPasskey が呼ばれる', async () => {
    mockRegisterPasskey.mockResolvedValue(undefined)
    render(<AccountSection />)

    await userEvent.click(await screen.findByRole('button', { name: /passkey を登録/i }))

    await waitFor(() => expect(mockRegisterPasskey).toHaveBeenCalledOnce())
  })

  test('登録成功後に成功メッセージを表示し一覧を再取得する', async () => {
    mockRegisterPasskey.mockResolvedValue(undefined)
    mockGetPasskeyCredentials
      .mockResolvedValueOnce({ credentials: [] })
      .mockResolvedValueOnce({ credentials: [FAKE_CRED] })

    render(<AccountSection />)

    await userEvent.click(await screen.findByRole('button', { name: /passkey を登録/i }))

    await waitFor(() => screen.getByText(/登録しました/i))
    // 再取得後に一覧が更新される
    expect(mockGetPasskeyCredentials).toHaveBeenCalledTimes(2)
  })

  test('登録中キャンセル (NotAllowedError) 時は汎用エラーメッセージを表示する', async () => {
    mockRegisterPasskey.mockRejectedValue(
      new DOMException('User cancelled', 'NotAllowedError'),
    )
    render(<AccountSection />)

    await userEvent.click(await screen.findByRole('button', { name: /passkey を登録/i }))

    await waitFor(() => screen.getByText(/キャンセル/i))
  })

  test('登録 API エラー時は失敗メッセージを表示する', async () => {
    const { ApiError } = await import('@/lib/api')
    mockRegisterPasskey.mockRejectedValue(new ApiError(400, 'Bad request'))
    render(<AccountSection />)

    await userEvent.click(await screen.findByRole('button', { name: /passkey を登録/i }))

    await waitFor(() => screen.getByText(/失敗/i))
  })
})

describe('AccountSection — 登録済み Passkey 一覧', () => {
  test('クレデンシャルが表示される', async () => {
    mockGetPasskeyCredentials.mockResolvedValue({ credentials: [FAKE_CRED] })

    render(<AccountSection />)

    // name がある場合は name を表示
    await screen.findByText('My Passkey')
  })

  test('name が null の場合は credential_id を truncate して表示する', async () => {
    const credWithoutName: PasskeyCredential = { ...FAKE_CRED, name: null }
    mockGetPasskeyCredentials.mockResolvedValue({ credentials: [credWithoutName] })

    render(<AccountSection />)

    // credential_id の先頭部分が表示される
    await screen.findByText(new RegExp(FAKE_CRED.credential_id.slice(0, 8)))
  })

  test('クレデンシャルが 0 件のときは「登録済みなし」を表示する', async () => {
    mockGetPasskeyCredentials.mockResolvedValue({ credentials: [] })

    render(<AccountSection />)

    await screen.findByText(/登録済みの passkey はありません/i)
  })
})

describe('AccountSection — Passkey 削除', () => {
  test('削除ボタンをクリックすると確認 UI が表示される', async () => {
    mockGetPasskeyCredentials.mockResolvedValue({ credentials: [FAKE_CRED] })

    render(<AccountSection />)

    // 削除ボタンをクリック
    await userEvent.click(await screen.findByRole('button', { name: /削除/i }))

    // 確認 UI が表示される
    await waitFor(() => screen.getByText(/削除しますか/i))
    // API はまだ呼ばれていない
    expect(mockDeletePasskeyCredential).not.toHaveBeenCalled()
  })

  test('確認 UI で「削除する」をクリックすると API が呼ばれる', async () => {
    mockGetPasskeyCredentials.mockResolvedValue({ credentials: [FAKE_CRED] })
    mockDeletePasskeyCredential.mockResolvedValue({ status: 'ok' })

    render(<AccountSection />)

    // 削除ボタンをクリック
    await userEvent.click(await screen.findByRole('button', { name: /削除/i }))

    // 「削除する」ボタンをクリック（aria-label で検索）
    await userEvent.click(await screen.findByRole('button', { name: /My Passkey を削除/i }))

    await waitFor(() =>
      expect(mockDeletePasskeyCredential).toHaveBeenCalledWith(FAKE_CRED.credential_id),
    )
  })

  test('確認 UI で「キャンセル」をクリックすると削除されない', async () => {
    mockGetPasskeyCredentials.mockResolvedValue({ credentials: [FAKE_CRED] })

    render(<AccountSection />)

    // 削除ボタンをクリック
    await userEvent.click(await screen.findByRole('button', { name: /削除/i }))

    // 確認 UI が表示される
    await screen.findByText(/削除しますか/i)

    // 「キャンセル」をクリック
    await userEvent.click(await screen.findByRole('button', { name: /キャンセル/i }))

    // 確認 UI が閉じられる
    await waitFor(() => expect(screen.queryByText(/削除しますか/i)).not.toBeInTheDocument())
    // API は呼ばれていない
    expect(mockDeletePasskeyCredential).not.toHaveBeenCalled()
  })

  test('削除後に一覧が再取得される', async () => {
    mockGetPasskeyCredentials
      .mockResolvedValueOnce({ credentials: [FAKE_CRED] })
      .mockResolvedValueOnce({ credentials: [] })
    mockDeletePasskeyCredential.mockResolvedValue({ status: 'ok' })

    render(<AccountSection />)

    // 削除ボタンをクリック
    await userEvent.click(await screen.findByRole('button', { name: /削除/i }))

    // 「削除する」をクリック（aria-label で検索）
    await userEvent.click(await screen.findByRole('button', { name: /My Passkey を削除/i }))

    await waitFor(() => expect(mockGetPasskeyCredentials).toHaveBeenCalledTimes(2))
    await screen.findByText(/登録済みの passkey はありません/i)
  })
})
