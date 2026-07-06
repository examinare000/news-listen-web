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
  mockDeleteAccount,
  mockRouterReplace,
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
  mockDeleteAccount: vi.fn(),
  mockRouterReplace: vi.fn(),
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
    deleteAccount: mockDeleteAccount,
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

// next/navigation: アカウント削除成功後の router.replace('/') を検証するため、
// tests/setup.ts のグローバルモック（呼び出しごとに新しい vi.fn() を返す）を
// このファイル内では固定参照の mockRouterReplace で上書きする（LogoutButton.test.tsx と同じ手法）。
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    replace: mockRouterReplace,
    push: vi.fn(),
  })),
  usePathname: vi.fn(() => '/'),
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
  mockGetSessions.mockResolvedValue({ sessions: [] })
  mockRevokeSession.mockResolvedValue({ status: 'ok' })
  mockRevokeOtherSessions.mockResolvedValue({ revoked_count: 0 })
  // clearAllMocks はモック実装をリセットしないため、テスト間漏れを防ぐため明示的に reset する
  // （LogoutButton.test.tsx と同じ理由）。
  mockRouterReplace.mockReset()
  mockDeleteAccount.mockReset()
  mockChangePassword.mockReset()
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

describe('AccountSection — Passkey 一覧の読み込み失敗（issue #164）', () => {
  test('読み込み失敗時はエラーメッセージと再試行ボタンを表示し、空一覧の文言は出さない', async () => {
    mockGetPasskeyCredentials.mockRejectedValue(new Error('network error'))
    render(<AccountSection />)

    await screen.findByText(/passkey 一覧の読み込みに失敗しました/i)
    expect(screen.queryByText(/登録済みの passkey はありません/i)).not.toBeInTheDocument()
  })

  test('再試行ボタンをクリックすると getPasskeyCredentials を再度呼び、成功すれば一覧を表示する', async () => {
    mockGetPasskeyCredentials
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ credentials: [FAKE_CRED] })
    render(<AccountSection />)

    await userEvent.click(
      await screen.findByRole('button', { name: /passkey 一覧を再試行/i }),
    )

    await waitFor(() => expect(mockGetPasskeyCredentials).toHaveBeenCalledTimes(2))
    await screen.findByText('My Passkey')
    expect(screen.queryByText(/passkey 一覧の読み込みに失敗しました/i)).not.toBeInTheDocument()
  })
})

describe('AccountSection — ログイン中デバイス一覧の読み込み失敗（issue #164）', () => {
  test('読み込み失敗時はエラーメッセージと再試行ボタンを表示し、空一覧の文言は出さない', async () => {
    mockGetSessions.mockRejectedValue(new Error('network error'))
    render(<AccountSection />)

    await screen.findByText(/ログイン中のデバイスの読み込みに失敗しました/i)
    expect(screen.queryByText(/ログイン中のデバイスはありません/i)).not.toBeInTheDocument()
  })

  test('再試行ボタンをクリックすると getSessions を再度呼び、成功すれば一覧を表示する', async () => {
    mockGetSessions
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(SESSIONS)
    render(<AccountSection />)

    await userEvent.click(
      await screen.findByRole('button', { name: /ログイン中のデバイスを再試行/i }),
    )

    await waitFor(() => expect(mockGetSessions).toHaveBeenCalledTimes(2))
    await screen.findByText('Chrome on macOS')
    expect(screen.queryByText(/ログイン中のデバイスの読み込みに失敗しました/i)).not.toBeInTheDocument()
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

describe('AccountSection — パスワード変更', () => {
  test('11文字のパスワード送信は前ブロックで拒否', async () => {
    render(<AccountSection />)

    await userEvent.type(
      screen.getByLabelText('現在のパスワード'),
      'current-password'
    )
    await userEvent.type(screen.getByLabelText('新しいパスワード'), 'Abc12345678')
    await userEvent.click(screen.getByRole('button', { name: 'パスワードを変更' }))

    await waitFor(() =>
      screen.getByText('新しいパスワードは12文字以上にしてください')
    )
    expect(mockChangePassword).not.toHaveBeenCalled()
  })

  test('12文字で2クラスのみのパスワード送信は前ブロックで拒否', async () => {
    render(<AccountSection />)

    await userEvent.type(
      screen.getByLabelText('現在のパスワード'),
      'current-password'
    )
    // 大文字・数字のみ（小文字・記号なし・12文字）
    await userEvent.type(screen.getByLabelText('新しいパスワード'), 'ABCD12345678')
    await userEvent.click(screen.getByRole('button', { name: 'パスワードを変更' }))

    await waitFor(() =>
      screen.getByText('小文字・大文字・数字・記号のうち3種類以上を含めてください')
    )
    expect(mockChangePassword).not.toHaveBeenCalled()
  })

  test('空白を含む12文字2クラスのパスワード送信は前ブロックで拒否（backend と一致）', async () => {
    render(<AccountSection />)

    await userEvent.type(
      screen.getByLabelText('現在のパスワード'),
      'current-password'
    )
    // 大文字・小文字・空白のみ（数字・記号なし・12文字）— 空白は記号に数えない
    await userEvent.type(screen.getByLabelText('新しいパスワード'), 'MyPassword Is')
    await userEvent.click(screen.getByRole('button', { name: 'パスワードを変更' }))

    await waitFor(() =>
      screen.getByText('小文字・大文字・数字・記号のうち3種類以上を含めてください')
    )
    expect(mockChangePassword).not.toHaveBeenCalled()
  })

  test('現在のパスワード空のまま送信時は前ブロックで拒否', async () => {
    render(<AccountSection />)

    // 現在のパスワードを入力しない
    await userEvent.type(screen.getByLabelText('新しいパスワード'), 'Abcd1234567!')
    await userEvent.click(screen.getByRole('button', { name: 'パスワードを変更' }))

    await waitFor(() =>
      screen.getByText('現在のパスワードを入力してください')
    )
    expect(mockChangePassword).not.toHaveBeenCalled()
  })

  test.each([
    [
      'password must be at least 12 characters long',
      '新しいパスワードは12文字以上にしてください',
    ],
    [
      'password must contain at least 3 of: lowercase, uppercase, digit, symbol',
      '小文字・大文字・数字・記号のうち3種類以上を含めてください',
    ],
    ['password is too common', 'よく使われるパスワードのため使用できません'],
    [
      'password must not contain the username',
      'ユーザー名を含むパスワードは使用できません',
    ],
  ])(
    '422 %s → 日本語対訳を表示',
    async (englishDetail, japaneseExpected) => {
      const { ApiError } = await import('@/lib/api')
      mockChangePassword.mockRejectedValue(new ApiError(422, englishDetail))
      render(<AccountSection />)

      await userEvent.type(
        screen.getByLabelText('現在のパスワード'),
        'current-password'
      )
      await userEvent.type(
        screen.getByLabelText('新しいパスワード'),
        'Abcd1234567!'
      )
      await userEvent.click(screen.getByRole('button', { name: 'パスワードを変更' }))

      await waitFor(() => screen.getByText(japaneseExpected))
      expect(mockChangePassword).toHaveBeenCalled()
    }
  )

  test('422 未知 detail → 原文付き文言を表示', async () => {
    const { ApiError } = await import('@/lib/api')
    mockChangePassword.mockRejectedValue(new ApiError(422, 'unknown error detail'))
    render(<AccountSection />)

    await userEvent.type(
      screen.getByLabelText('現在のパスワード'),
      'current-password'
    )
    await userEvent.type(
      screen.getByLabelText('新しいパスワード'),
      'Abcd1234567!'
    )
    await userEvent.click(screen.getByRole('button', { name: 'パスワードを変更' }))

    await waitFor(() =>
      screen.getByText('パスワード変更に失敗しました（unknown error detail）')
    )
  })

  test('400 → 「現在のパスワードが正しくありません」を表示', async () => {
    const { ApiError } = await import('@/lib/api')
    mockChangePassword.mockRejectedValue(new ApiError(400, 'Invalid password'))
    render(<AccountSection />)

    await userEvent.type(
      screen.getByLabelText('現在のパスワード'),
      'wrong-password'
    )
    await userEvent.type(
      screen.getByLabelText('新しいパスワード'),
      'Abcd1234567!'
    )
    await userEvent.click(screen.getByRole('button', { name: 'パスワードを変更' }))

    await waitFor(() =>
      screen.getByText('現在のパスワードが正しくありません')
    )
  })

  test('成功後は成功文言を表示し入力をクリア', async () => {
    mockChangePassword.mockResolvedValue({ status: 'ok' })
    render(<AccountSection />)

    const currentPwInput = screen.getByLabelText('現在のパスワード')
    const newPwInput = screen.getByLabelText('新しいパスワード')

    await userEvent.type(currentPwInput, 'current-password')
    await userEvent.type(newPwInput, 'Abcd1234567!')
    await userEvent.click(screen.getByRole('button', { name: 'パスワードを変更' }))

    await waitFor(() =>
      screen.getByText('パスワードを変更しました')
    )
    expect(mockChangePassword).toHaveBeenCalledWith('current-password', 'Abcd1234567!')
    // 入力フィールドがクリアされていることを確認
    expect(currentPwInput).toHaveValue('')
    expect(newPwInput).toHaveValue('')
  })
})

describe('AccountSection — アカウント削除（退会・issue #133）', () => {
  test('「退会する」をクリックすると警告文と現在のパスワード入力欄を表示し、API はまだ呼ばれない', async () => {
    render(<AccountSection />)

    await userEvent.click(screen.getByRole('button', { name: '退会する' }))

    expect(screen.getByText(/削除され、復元できません/)).toBeInTheDocument()
    expect(screen.getByLabelText('退会確認用の現在のパスワード')).toBeInTheDocument()
    expect(mockDeleteAccount).not.toHaveBeenCalled()
  })

  test('確認 UI で「キャンセル」をクリックすると閉じて deleteAccount は呼ばれない', async () => {
    render(<AccountSection />)

    await userEvent.click(screen.getByRole('button', { name: '退会する' }))
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByText(/削除され、復元できません/)).not.toBeInTheDocument()
    expect(mockDeleteAccount).not.toHaveBeenCalled()
  })

  test('パスワードを入力して実行すると deleteAccount を呼び、成功後は認証状態をクリアしてログイン画面へ遷移する', async () => {
    mockDeleteAccount.mockResolvedValue(undefined)
    render(<AccountSection />)

    await userEvent.click(screen.getByRole('button', { name: '退会する' }))
    await userEvent.type(screen.getByLabelText('退会確認用の現在のパスワード'), 'my-password')
    await userEvent.click(screen.getByRole('button', { name: '退会を実行する' }))

    await waitFor(() => expect(mockDeleteAccount).toHaveBeenCalledWith('my-password'))
    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/'))
  })

  test('パスワードが誤っている場合（403）は専用のエラーメッセージを表示し、ログアウトや遷移は行わない', async () => {
    const { ApiError } = await import('@/lib/api')
    mockDeleteAccount.mockRejectedValue(new ApiError(403, 'Invalid password'))
    render(<AccountSection />)

    await userEvent.click(screen.getByRole('button', { name: '退会する' }))
    await userEvent.type(screen.getByLabelText('退会確認用の現在のパスワード'), 'wrong-password')
    await userEvent.click(screen.getByRole('button', { name: '退会を実行する' }))

    await waitFor(() => screen.getByText('パスワードが正しくありません'))
    expect(mockLogout).not.toHaveBeenCalled()
    expect(mockRouterReplace).not.toHaveBeenCalled()
  })

  test('最後の管理者の場合（409）は専用のエラーメッセージを表示する', async () => {
    const { ApiError } = await import('@/lib/api')
    mockDeleteAccount.mockRejectedValue(new ApiError(409, 'Cannot delete the last admin account'))
    render(<AccountSection />)

    await userEvent.click(screen.getByRole('button', { name: '退会する' }))
    await userEvent.type(screen.getByLabelText('退会確認用の現在のパスワード'), 'my-password')
    await userEvent.click(screen.getByRole('button', { name: '退会を実行する' }))

    await waitFor(() => screen.getByText('最後の管理者は削除できません'))
    expect(mockLogout).not.toHaveBeenCalled()
  })
})

// ==========================================================
// AccountSection — アクセシビリティ（issue #164）
// ==========================================================
describe('AccountSection — accessibility', () => {
  test('Given Passkey credentials load fails, error message has role="alert"', async () => {
    const { ApiError } = await import('@/lib/api')
    mockGetPasskeyCredentials.mockRejectedValue(new ApiError(500, 'Server error'))
    mockGetSessions.mockResolvedValue({ sessions: [] })

    render(<AccountSection />)

    await waitFor(() => {
      const errorDiv = screen.getByText(/Passkey 一覧の読み込みに失敗/)?.closest('.form-error')
      expect(errorDiv).toHaveAttribute('role', 'alert')
    })
  })

  test('Given sessions load fails, error message has role="alert"', async () => {
    const { ApiError } = await import('@/lib/api')
    mockGetPasskeyCredentials.mockResolvedValue({ credentials: [] })
    mockGetSessions.mockRejectedValue(new ApiError(500, 'Server error'))

    render(<AccountSection />)

    await waitFor(() => {
      const errorDiv = screen.getByText(/ログイン中のデバイスの読み込みに失敗/)?.closest('.form-error')
      expect(errorDiv).toHaveAttribute('role', 'alert')
    })
  })
})
