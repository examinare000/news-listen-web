import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { AccountSection } from '@/components/ui/AccountSection'
import { useAuth } from '@/contexts/AuthProvider'
import type { PasskeyCredential } from '@/types/index'
import { createGatewayDouble } from '../../helpers/gatewayDouble'
import type { GatewayDouble } from '../../helpers/gatewayDouble'

// vi.hoisted で mock 変数を宣言する（vi.mock のホイスティングより前に評価される）
const { mockRegisterPasskey, mockLogout, mockRefreshMe, mockRouterReplace } = vi.hoisted(() => ({
  mockRegisterPasskey: vi.fn(),
  mockLogout: vi.fn(),
  mockRefreshMe: vi.fn(),
  mockRouterReplace: vi.fn(),
}))

const holder = vi.hoisted(() => ({ gw: undefined as GatewayDouble | undefined }))

vi.mock('@/lib/api/gateway', () => ({ createGateway: () => holder.gw }))

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

const MOCK_USER = { username: 'alice', role: 'user' as const, display_name: 'Alice', userId: 'u-alice' }

vi.mock('@/contexts/AuthProvider', () => ({
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

const ME_PATH = '/api/backend/auth/me'
const PASSWORD_PATH = '/api/backend/auth/password'
const CREDENTIALS_PATH = '/api/backend/auth/passkey/credentials'
const CREDENTIALS_PREFIX = `${CREDENTIALS_PATH}/`
const SESSIONS_PATH = '/api/backend/auth/sessions'
const SESSIONS_PREFIX = `${SESSIONS_PATH}/`
const REVOKE_OTHERS_PATH = '/api/backend/auth/sessions/revoke-others'

const credentialPath = (id: string) => `${CREDENTIALS_PREFIX}${encodeURIComponent(id)}`
const sessionPath = (id: string) => `${SESSIONS_PREFIX}${encodeURIComponent(id)}`

let gw: GatewayDouble

function callsTo(method: string, path: string) {
  return gw.calls.filter((c) => c.method === method && c.path === path)
}

function callsToPrefix(method: string, prefix: string) {
  return gw.calls.filter((c) => c.method === method && c.path.startsWith(prefix))
}

beforeEach(() => {
  gw = createGatewayDouble()
  holder.gw = gw
  vi.clearAllMocks()
  gw.respond('GET', CREDENTIALS_PATH, { ok: true, value: { credentials: [] } })
  gw.respond('GET', SESSIONS_PATH, { ok: true, value: { sessions: [] } })
  gw.respond('DELETE', sessionPath('sid-other'), { ok: true, value: { status: 'ok' } })
  gw.respond('POST', REVOKE_OTHERS_PATH, { ok: true, value: { revoked_count: 0 } })
  // clearAllMocks はモック実装をリセットしないため、テスト間漏れを防ぐため明示的に reset する
  // （LogoutButton.test.tsx と同じ理由）。
  mockRouterReplace.mockReset()
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
    gw.respond('GET', SESSIONS_PATH, { ok: true, value: SESSIONS })
    render(<AccountSection />)

    expect(await screen.findByText('Chrome on macOS')).toBeInTheDocument()
    expect(screen.getByText('Safari on iOS')).toBeInTheDocument()
    expect(screen.getByText('現在のデバイス')).toBeInTheDocument()
  })

  test('現在のデバイスには個別ログアウトボタンが無く、他デバイスにはある', async () => {
    gw.respond('GET', SESSIONS_PATH, { ok: true, value: SESSIONS })
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
    gw.respond('GET', SESSIONS_PATH, { ok: true, value: SESSIONS })
    render(<AccountSection />)

    await screen.findByText('Safari on iOS')
    await userEvent.click(
      screen.getByRole('button', { name: /デバイスをログアウト: Safari on iOS/ }),
    )
    await userEvent.click(screen.getByRole('button', { name: /Safari on iOS をログアウト/ }))

    await waitFor(() =>
      expect(gw.calls).toContainEqual({ method: 'DELETE', path: sessionPath('sid-other'), body: undefined }),
    )
  })

  test('「他のデバイスからログアウト」は確認後に revokeOtherSessions を呼び件数を表示', async () => {
    gw.respond('GET', SESSIONS_PATH, { ok: true, value: SESSIONS })
    gw.respond('POST', REVOKE_OTHERS_PATH, { ok: true, value: { revoked_count: 2 } })
    render(<AccountSection />)

    await screen.findByText('Safari on iOS')
    await userEvent.click(screen.getByRole('button', { name: '他のデバイスからログアウト' }))
    // 確認ステップ
    await userEvent.click(
      screen.getByRole('button', { name: '他のデバイスからログアウトを実行' }),
    )

    await waitFor(() => expect(callsTo('POST', REVOKE_OTHERS_PATH)).not.toHaveLength(0))
    expect(await screen.findByText(/他の 2 台のデバイスからログアウトしました/)).toBeInTheDocument()
  })

  test('他デバイスが無ければ一括ログアウトボタンは無効', async () => {
    gw.respond('GET', SESSIONS_PATH, { ok: true, value: { sessions: [SESSIONS.sessions[0]] } }) // current のみ
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
    gw.respondWith('GET', CREDENTIALS_PATH, () =>
      Promise.resolve({
        ok: true,
        value: callsTo('GET', CREDENTIALS_PATH).length === 1 ? { credentials: [] } : { credentials: [FAKE_CRED] },
      }),
    )

    render(<AccountSection />)

    await userEvent.click(await screen.findByRole('button', { name: /passkey を登録/i }))

    await waitFor(() => screen.getByText(/登録しました/i))
    // 再取得後に一覧が更新される
    expect(callsTo('GET', CREDENTIALS_PATH)).toHaveLength(2)
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
    gw.respondWith('GET', CREDENTIALS_PATH, () => Promise.reject(new Error('network error')))
    render(<AccountSection />)

    await screen.findByText(/passkey 一覧の読み込みに失敗しました/i)
    expect(screen.queryByText(/登録済みの passkey はありません/i)).not.toBeInTheDocument()
  })

  test('再試行ボタンをクリックすると getPasskeyCredentials を再度呼び、成功すれば一覧を表示する', async () => {
    gw.respondWith('GET', CREDENTIALS_PATH, () =>
      callsTo('GET', CREDENTIALS_PATH).length === 1
        ? Promise.reject(new Error('network error'))
        : Promise.resolve({ ok: true, value: { credentials: [FAKE_CRED] } }),
    )
    render(<AccountSection />)

    await userEvent.click(
      await screen.findByRole('button', { name: /passkey 一覧を再試行/i }),
    )

    await waitFor(() => expect(callsTo('GET', CREDENTIALS_PATH)).toHaveLength(2))
    await screen.findByText('My Passkey')
    expect(screen.queryByText(/passkey 一覧の読み込みに失敗しました/i)).not.toBeInTheDocument()
  })
})

describe('AccountSection — ログイン中デバイス一覧の読み込み失敗（issue #164）', () => {
  test('読み込み失敗時はエラーメッセージと再試行ボタンを表示し、空一覧の文言は出さない', async () => {
    gw.respondWith('GET', SESSIONS_PATH, () => Promise.reject(new Error('network error')))
    render(<AccountSection />)

    await screen.findByText(/ログイン中のデバイスの読み込みに失敗しました/i)
    expect(screen.queryByText(/ログイン中のデバイスはありません/i)).not.toBeInTheDocument()
  })

  test('再試行ボタンをクリックすると getSessions を再度呼び、成功すれば一覧を表示する', async () => {
    gw.respondWith('GET', SESSIONS_PATH, () =>
      callsTo('GET', SESSIONS_PATH).length === 1
        ? Promise.reject(new Error('network error'))
        : Promise.resolve({ ok: true, value: SESSIONS }),
    )
    render(<AccountSection />)

    await userEvent.click(
      await screen.findByRole('button', { name: /ログイン中のデバイスを再試行/i }),
    )

    await waitFor(() => expect(callsTo('GET', SESSIONS_PATH)).toHaveLength(2))
    await screen.findByText('Chrome on macOS')
    expect(screen.queryByText(/ログイン中のデバイスの読み込みに失敗しました/i)).not.toBeInTheDocument()
  })
})

describe('AccountSection — 登録済み Passkey 一覧', () => {
  test('クレデンシャルが表示される', async () => {
    gw.respond('GET', CREDENTIALS_PATH, { ok: true, value: { credentials: [FAKE_CRED] } })

    render(<AccountSection />)

    // name がある場合は name を表示
    await screen.findByText('My Passkey')
  })

  test('name が null の場合は credential_id を truncate して表示する', async () => {
    const credWithoutName: PasskeyCredential = { ...FAKE_CRED, name: null }
    gw.respond('GET', CREDENTIALS_PATH, { ok: true, value: { credentials: [credWithoutName] } })

    render(<AccountSection />)

    // credential_id の先頭部分が表示される
    await screen.findByText(new RegExp(FAKE_CRED.credential_id.slice(0, 8)))
  })

  test('クレデンシャルが 0 件のときは「登録済みなし」を表示する', async () => {
    gw.respond('GET', CREDENTIALS_PATH, { ok: true, value: { credentials: [] } })

    render(<AccountSection />)

    await screen.findByText(/登録済みの passkey はありません/i)
  })
})

describe('AccountSection — Passkey 削除', () => {
  test('削除ボタンをクリックすると確認 UI が表示される', async () => {
    gw.respond('GET', CREDENTIALS_PATH, { ok: true, value: { credentials: [FAKE_CRED] } })

    render(<AccountSection />)

    // 削除ボタンをクリック
    await userEvent.click(await screen.findByRole('button', { name: /削除/i }))

    // 確認 UI が表示される
    await waitFor(() => screen.getByText(/削除しますか/i))
    // API はまだ呼ばれていない
    expect(callsToPrefix('DELETE', CREDENTIALS_PREFIX)).toHaveLength(0)
  })

  test('確認 UI で「削除する」をクリックすると API が呼ばれる', async () => {
    gw.respond('GET', CREDENTIALS_PATH, { ok: true, value: { credentials: [FAKE_CRED] } })
    gw.respond('DELETE', credentialPath(FAKE_CRED.credential_id), { ok: true, value: { status: 'ok' } })

    render(<AccountSection />)

    // 削除ボタンをクリック
    await userEvent.click(await screen.findByRole('button', { name: /削除/i }))

    // 「削除する」ボタンをクリック（aria-label で検索）
    await userEvent.click(await screen.findByRole('button', { name: /My Passkey を削除/i }))

    await waitFor(() =>
      expect(gw.calls).toContainEqual({
        method: 'DELETE',
        path: credentialPath(FAKE_CRED.credential_id),
        body: undefined,
      }),
    )
  })

  test('確認 UI で「キャンセル」をクリックすると削除されない', async () => {
    gw.respond('GET', CREDENTIALS_PATH, { ok: true, value: { credentials: [FAKE_CRED] } })

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
    expect(callsToPrefix('DELETE', CREDENTIALS_PREFIX)).toHaveLength(0)
  })

  test('削除後に一覧が再取得される', async () => {
    gw.respondWith('GET', CREDENTIALS_PATH, () =>
      Promise.resolve({
        ok: true,
        value: callsTo('GET', CREDENTIALS_PATH).length === 1 ? { credentials: [FAKE_CRED] } : { credentials: [] },
      }),
    )
    gw.respond('DELETE', credentialPath(FAKE_CRED.credential_id), { ok: true, value: { status: 'ok' } })

    render(<AccountSection />)

    // 削除ボタンをクリック
    await userEvent.click(await screen.findByRole('button', { name: /削除/i }))

    // 「削除する」をクリック（aria-label で検索）
    await userEvent.click(await screen.findByRole('button', { name: /My Passkey を削除/i }))

    await waitFor(() => expect(callsTo('GET', CREDENTIALS_PATH)).toHaveLength(2))
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
    expect(callsTo('POST', PASSWORD_PATH)).toHaveLength(0)
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
    expect(callsTo('POST', PASSWORD_PATH)).toHaveLength(0)
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
    expect(callsTo('POST', PASSWORD_PATH)).toHaveLength(0)
  })

  test('21文字のパスワード送信は前ブロックで拒否（上限20文字）', async () => {
    render(<AccountSection />)

    await userEvent.type(screen.getByLabelText('現在のパスワード'), 'current-password')
    // 小文字・大文字・数字の 3 種・21 文字
    await userEvent.type(screen.getByLabelText('新しいパスワード'), 'Abcdefghij12345678901')
    await userEvent.click(screen.getByRole('button', { name: 'パスワードを変更' }))

    await waitFor(() => screen.getByText('新しいパスワードは20文字以下にしてください'))
    expect(callsTo('POST', PASSWORD_PATH)).toHaveLength(0)
  })

  test.each([
    ['12文字', 'Abcd12345678'],
    ['20文字', 'Abcdefghij1234567890'],
  ])('%s（3種）のパスワードは送信される（境界値）', async (_label, password) => {
    gw.respond('POST', PASSWORD_PATH, { ok: true, value: { status: 'ok' } })
    render(<AccountSection />)

    await userEvent.type(screen.getByLabelText('現在のパスワード'), 'current-password')
    await userEvent.type(screen.getByLabelText('新しいパスワード'), password)
    await userEvent.click(screen.getByRole('button', { name: 'パスワードを変更' }))

    await waitFor(() =>
      expect(gw.calls).toContainEqual({
        method: 'POST',
        path: PASSWORD_PATH,
        body: { current_password: 'current-password', new_password: password },
      }),
    )
    expect(screen.queryByText('新しいパスワードは20文字以下にしてください')).not.toBeInTheDocument()
  })

  test('ヒント文言は 12〜20文字・3種類以上を示す', () => {
    render(<AccountSection />)

    expect(screen.getByText('12〜20文字・小文字/大文字/数字/記号のうち3種類以上')).toBeInTheDocument()
    expect(screen.queryByText('12文字以上・小文字/大文字/数字/記号のうち3種類以上')).not.toBeInTheDocument()
  })

  test('現在のパスワード空のまま送信時は前ブロックで拒否', async () => {
    render(<AccountSection />)

    // 現在のパスワードを入力しない
    await userEvent.type(screen.getByLabelText('新しいパスワード'), 'Abcd1234567!')
    await userEvent.click(screen.getByRole('button', { name: 'パスワードを変更' }))

    await waitFor(() =>
      screen.getByText('現在のパスワードを入力してください')
    )
    expect(callsTo('POST', PASSWORD_PATH)).toHaveLength(0)
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
      gw.respond('POST', PASSWORD_PATH, { ok: false, failure: { kind: 'validation', detail: englishDetail } })
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
      expect(callsTo('POST', PASSWORD_PATH)).not.toHaveLength(0)
    }
  )

  test('422 未知 detail → 原文付き文言を表示', async () => {
    gw.respond('POST', PASSWORD_PATH, { ok: false, failure: { kind: 'validation', detail: 'unknown error detail' } })
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
    gw.respond('POST', PASSWORD_PATH, { ok: false, failure: { kind: 'unknown', status: 400 } })
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
    gw.respond('POST', PASSWORD_PATH, { ok: true, value: { status: 'ok' } })
    render(<AccountSection />)

    const currentPwInput = screen.getByLabelText('現在のパスワード')
    const newPwInput = screen.getByLabelText('新しいパスワード')

    await userEvent.type(currentPwInput, 'current-password')
    await userEvent.type(newPwInput, 'Abcd1234567!')
    await userEvent.click(screen.getByRole('button', { name: 'パスワードを変更' }))

    await waitFor(() =>
      screen.getByText('パスワードを変更しました')
    )
    expect(gw.calls).toContainEqual({
      method: 'POST',
      path: PASSWORD_PATH,
      body: { current_password: 'current-password', new_password: 'Abcd1234567!' },
    })
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
    expect(callsTo('DELETE', ME_PATH)).toHaveLength(0)
  })

  test('確認 UI で「キャンセル」をクリックすると閉じて deleteAccount は呼ばれない', async () => {
    render(<AccountSection />)

    await userEvent.click(screen.getByRole('button', { name: '退会する' }))
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByText(/削除され、復元できません/)).not.toBeInTheDocument()
    expect(callsTo('DELETE', ME_PATH)).toHaveLength(0)
  })

  test('パスワードを入力して実行すると deleteAccount を呼び、成功後は認証状態をクリアしてログイン画面へ遷移する', async () => {
    gw.respond('DELETE', ME_PATH, { ok: true, value: undefined })
    render(<AccountSection />)

    await userEvent.click(screen.getByRole('button', { name: '退会する' }))
    await userEvent.type(screen.getByLabelText('退会確認用の現在のパスワード'), 'my-password')
    await userEvent.click(screen.getByRole('button', { name: '退会を実行する' }))

    await waitFor(() =>
      expect(gw.calls).toContainEqual({
        method: 'DELETE',
        path: ME_PATH,
        body: { current_password: 'my-password' },
      }),
    )
    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/'))
  })

  test('パスワードが誤っている場合（403）は専用のエラーメッセージを表示し、ログアウトや遷移は行わない', async () => {
    gw.respond('DELETE', ME_PATH, { ok: false, failure: { kind: 'forbidden' } })
    render(<AccountSection />)

    await userEvent.click(screen.getByRole('button', { name: '退会する' }))
    await userEvent.type(screen.getByLabelText('退会確認用の現在のパスワード'), 'wrong-password')
    await userEvent.click(screen.getByRole('button', { name: '退会を実行する' }))

    await waitFor(() => screen.getByText('パスワードが正しくありません'))
    expect(mockLogout).not.toHaveBeenCalled()
    expect(mockRouterReplace).not.toHaveBeenCalled()
  })

  test('最後の管理者の場合（409）は専用のエラーメッセージを表示する', async () => {
    gw.respond('DELETE', ME_PATH, { ok: false, failure: { kind: 'conflict' } })
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
    gw.respond('GET', CREDENTIALS_PATH, { ok: false, failure: { kind: 'server', status: 500 } })
    gw.respond('GET', SESSIONS_PATH, { ok: true, value: { sessions: [] } })

    render(<AccountSection />)

    await waitFor(() => {
      const errorDiv = screen.getByText(/Passkey 一覧の読み込みに失敗/)?.closest('.form-error')
      expect(errorDiv).toHaveAttribute('role', 'alert')
    })
  })

  test('Given sessions load fails, error message has role="alert"', async () => {
    gw.respond('GET', CREDENTIALS_PATH, { ok: true, value: { credentials: [] } })
    gw.respond('GET', SESSIONS_PATH, { ok: false, failure: { kind: 'server', status: 500 } })

    render(<AccountSection />)

    await waitFor(() => {
      const errorDiv = screen.getByText(/ログイン中のデバイスの読み込みに失敗/)?.closest('.form-error')
      expect(errorDiv).toHaveAttribute('role', 'alert')
    })
  })
})

// ==========================================================
// AccountSection — 管理者導線（ADR-075: 計測ダッシュボードへのリンク）
// ==========================================================
describe('AccountSection — admin metrics link (ADR-075)', () => {
  // WHY: mockReturnValue はテスト間で永続する（clearAllMocks は実装を消さない）ため、
  // このブロック専用に admin ロールへ張り替えた後、必ずデフォルト（一般ユーザー）へ戻す。
  afterEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      session: { kind: 'authenticated', user: MOCK_USER },
      retry: vi.fn(),
      status: 'authenticated',
      user: MOCK_USER,
      login: vi.fn(),
      logout: mockLogout,
      register: vi.fn(),
      refreshMe: mockRefreshMe,
      loginWithPasskey: vi.fn(),
      registerSubjectLeaveStep: vi.fn(() => () => {}),
      currentUserId: () => null,
    })
  })

  test('admin ユーザーには計測ダッシュボードへのリンクが表示される', async () => {
    vi.mocked(useAuth).mockReturnValue({
      session: { kind: 'authenticated', user: { username: 'admin', role: 'admin', display_name: 'Admin', userId: 'u-admin' } },
      retry: vi.fn(),
      status: 'authenticated',
      user: { username: 'admin', role: 'admin', display_name: 'Admin', userId: 'u-admin' },
      login: vi.fn(),
      logout: mockLogout,
      register: vi.fn(),
      refreshMe: mockRefreshMe,
      loginWithPasskey: vi.fn(),
      registerSubjectLeaveStep: vi.fn(() => () => {}),
      currentUserId: () => null,
    })

    render(<AccountSection />)

    const link = await screen.findByLabelText('計測ダッシュボードを開く')
    expect(link).toHaveAttribute('href', '/admin/metrics')
  })

  test('一般ユーザーには計測ダッシュボードへのリンクが表示されない', () => {
    render(<AccountSection />)

    expect(screen.queryByLabelText('計測ダッシュボードを開く')).not.toBeInTheDocument()
  })
})
