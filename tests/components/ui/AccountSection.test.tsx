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
  mockGetSessions,
  mockRevokeSession,
  mockRevokeOtherSessions,
  mockRegisterPasskey,
  mockLogout,
  mockRefreshMe,
} = vi.hoisted(() => ({
  mockUpdateProfile: vi.fn(),
  mockChangePassword: vi.fn(),
  mockGetPasskeyCredentials: vi.fn(),
  mockDeletePasskeyCredential: vi.fn(),
  mockGetSessions: vi.fn(),
  mockRevokeSession: vi.fn(),
  mockRevokeOtherSessions: vi.fn(),
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
    getSessions: mockGetSessions,
    revokeSession: mockRevokeSession,
    revokeOtherSessions: mockRevokeOtherSessions,
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

// next/navigation は tests/setup.ts のグローバルモックで賄う（LogoutButton の useRouter 用）。

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
  mockGetSessions.mockResolvedValue({ sessions: [] })
  mockRevokeSession.mockResolvedValue({ status: 'ok' })
  mockRevokeOtherSessions.mockResolvedValue({ revoked_count: 0 })
})

const SESSIONS = {
  sessions: [
    {
      id: 'sid-current',
      device_label: 'Chrome on macOS',
      created_at: '2026-06-01T00:00:00Z',
      last_used_at: '2026-06-30T12:00:00Z',
      current: true,
    },
    {
      id: 'sid-other',
      device_label: 'Safari on iOS',
      created_at: '2026-05-01T00:00:00Z',
      last_used_at: null,
      current: false,
    },
  ],
}

describe('AccountSection — ログイン中のデバイス（#84）', () => {
  test('セッション一覧を表示し、現在のデバイスにバッジを付ける', async () => {
    mockGetSessions.mockResolvedValue(SESSIONS)
    render(<AccountSection />)

    expect(await screen.findByText('Chrome on macOS')).toBeInTheDocument()
    expect(screen.getByText('Safari on iOS')).toBeInTheDocument()
    expect(screen.getByText('現在のデバイス')).toBeInTheDocument()
  })

  test('現在のデバイスには個別ログアウトボタンが無く、他デバイスにはある', async () => {
    mockGetSessions.mockResolvedValue(SESSIONS)
    render(<AccountSection />)

    await screen.findByText('Safari on iOS')
    // 他デバイスの個別ログアウト
    expect(
      screen.getByRole('button', { name: /デバイスをログアウト: Safari on iOS/ }),
    ).toBeInTheDocument()
    // 現在のデバイスの個別ログアウトは無い
    expect(
      screen.queryByRole('button', { name: /デバイスをログアウト: Chrome on macOS/ }),
    ).not.toBeInTheDocument()
  })

  test('個別ログアウトは確認後に revokeSession を呼ぶ', async () => {
    mockGetSessions.mockResolvedValue(SESSIONS)
    render(<AccountSection />)

    await screen.findByText('Safari on iOS')
    await userEvent.click(
      screen.getByRole('button', { name: /デバイスをログアウト: Safari on iOS/ }),
    )
    await userEvent.click(screen.getByRole('button', { name: /Safari on iOS をログアウト/ }))

    await waitFor(() => expect(mockRevokeSession).toHaveBeenCalledWith('sid-other'))
  })

  test('「他のデバイスからログアウト」は確認後に revokeOtherSessions を呼び件数を表示', async () => {
    mockGetSessions.mockResolvedValue(SESSIONS)
    mockRevokeOtherSessions.mockResolvedValue({ revoked_count: 2 })
    render(<AccountSection />)

    await screen.findByText('Safari on iOS')
    await userEvent.click(screen.getByRole('button', { name: '他のデバイスからログアウト' }))
    // 確認ステップ
    await userEvent.click(
      screen.getByRole('button', { name: '他のデバイスからログアウトを実行' }),
    )

    await waitFor(() => expect(mockRevokeOtherSessions).toHaveBeenCalled())
    expect(await screen.findByText(/他の 2 台のデバイスからログアウトしました/)).toBeInTheDocument()
  })

  test('他デバイスが無ければ一括ログアウトボタンは無効', async () => {
    mockGetSessions.mockResolvedValue({ sessions: [SESSIONS.sessions[0]] }) // current のみ
    render(<AccountSection />)

    await screen.findByText('Chrome on macOS')
    expect(screen.getByRole('button', { name: '他のデバイスからログアウト' })).toBeDisabled()
  })
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
