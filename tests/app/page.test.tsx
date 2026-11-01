import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import RootPage from '@/app/page'
import { PreferencesProvider } from '@/contexts/PreferencesProvider'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'
import { ToastProvider } from '@/components/ui/Toast'
import type { AuthSession } from '@/lib/account/domain/authSession'

// next/navigation は setup.ts でグローバルにモック済み
// useRouter の戻り値を各テスト前に制御する
const mockReplace = vi.fn()

// 復元前（ready: false）は PreferencesProvider の mount effect が RTL の act で
// 即座に完了してしまい実 Provider では観測できないため、usePreferences のみ差し替え
// 可能な委譲モックを用意する（override 未設定時は実装へ委譲し他テストは無風）
const usePreferencesOverride = vi.hoisted(() => ({
  current: null as null | (() => unknown),
}))

vi.mock('@/contexts/PreferencesProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/PreferencesProvider')>()
  return {
    ...actual,
    usePreferences: () => (usePreferencesOverride.current ? usePreferencesOverride.current() : actual.usePreferences()),
  }
})

// 設定の保存先は、テストごとに新しい in-memory の KeyValueStore
const memoryStore = (): KeyValueStore => {
  const data = new Map<string, string>()
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

// 認証状態は useAuth をモックして制御する（AuthProvider の /auth/me 実呼び出しを避ける）。
// 既定は authenticated とし、設定済みテストが従来どおりフィードへ進むようにする。
// session は AuthSession のリテラルで切り替え、status は Provider と同じ写し方で session から導く
// （resolving・unavailable → 'unknown'、anonymous → 'unauthenticated'、authenticated → 'authenticated'）。
// domain は型だけを import する（値 import しない）。
const AUTHENTICATED: AuthSession = {
  kind: 'authenticated',
  user: { username: 'alice', role: 'user', display_name: 'Alice' },
}
const authSessionOverride = vi.hoisted(() => ({ current: null as unknown as AuthSession }))
const retryMock = vi.hoisted(() => vi.fn())
vi.mock('@/contexts/AuthProvider', () => ({
  useAuth: () => {
    const session = authSessionOverride.current
    const status =
      session.kind === 'authenticated' ? 'authenticated' : session.kind === 'anonymous' ? 'unauthenticated' : 'unknown'
    return {
      session,
      status,
      user: session.kind === 'authenticated' ? session.user : null,
      retry: retryMock,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      refreshMe: vi.fn(),
    }
  },
}))

beforeEach(async () => {
  vi.clearAllMocks()
  localStorage.clear()
  usePreferencesOverride.current = null
  authSessionOverride.current = AUTHENTICATED
  // setup.ts の vi.fn() に対して mockReturnValue で挙動を制御
  const { useRouter } = await import('next/navigation')
  vi.mocked(useRouter).mockReturnValue({ replace: mockReplace } as unknown as ReturnType<typeof useRouter>)
})

function renderRootPage() {
  return render(
    <PreferencesProvider store={memoryStore()}>
      <ToastProvider>
        <RootPage />
      </ToastProvider>
    </PreferencesProvider>
  )
}

// ==========================================================
// Entry Gate — 認証完了状態 (spec §10.1)
// ==========================================================
describe('RootPage — authenticated', () => {
  test('Given restore complete and authenticated, calls router.replace("/feed")', async () => {
    authSessionOverride.current = AUTHENTICATED
    renderRootPage()

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/feed')
    })
  })

  test('Given authenticated, does NOT show LoginModal', async () => {
    authSessionOverride.current = AUTHENTICATED
    renderRootPage()

    await waitFor(() => expect(mockReplace).toHaveBeenCalled())
    expect(screen.queryByRole('dialog', { name: 'ログイン' })).not.toBeInTheDocument()
  })
})

describe('RootPage — authenticated, onboarding gate', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('Given onboarding not completed, shows OnboardingSourcesModal and does not redirect', async () => {
    authSessionOverride.current = AUTHENTICATED
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ onboarding_completed: false }),
      }),
    )
    renderRootPage()

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
    expect(mockReplace).not.toHaveBeenCalled()
  })
})

// ==========================================================
// Entry Gate — 未接続/未ログイン → LandingPage（LP は設定の復元を待たず即座に表示）
// ==========================================================
describe('RootPage — unauthenticated', () => {
  test('Given unauthenticated, shows LandingPage with /signup CTA and does NOT auto-open LoginModal', async () => {
    authSessionOverride.current = { kind: 'anonymous' }
    renderRootPage()

    expect(await screen.findByTestId('lp-hero')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /新規登録|招待コードで登録/ })[0]).toHaveAttribute(
      'href',
      '/signup',
    )
    expect(screen.queryByRole('dialog', { name: 'ログイン' })).not.toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  test('未認証なら preferences が ready でなくても、スケルトンを待たずに LandingPage を即座に表示する', () => {
    authSessionOverride.current = { kind: 'anonymous' }
    usePreferencesOverride.current = () => ({
      ready: false,
      get: vi.fn(),
      set: vi.fn(),
    })

    render(<RootPage />)

    expect(screen.getByTestId('lp-hero')).toBeInTheDocument()
  })

  test('clicking ログイン opens the LoginModal, and its onClose hides it again', async () => {
    authSessionOverride.current = { kind: 'anonymous' }
    renderRootPage()
    const user = userEvent.setup()

    await user.click(screen.getAllByRole('button', { name: 'ログイン' })[0])
    const dialog = await screen.findByRole('dialog', { name: 'ログイン' })
    expect(dialog).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '閉じる' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'ログイン' })).not.toBeInTheDocument())
    // LP 自体は閉じた後も表示され続ける
    expect(screen.getByTestId('lp-hero')).toBeInTheDocument()
  })

  test('Given auth resolving, shows LandingPage (no redirect)', async () => {
    authSessionOverride.current = { kind: 'resolving' }
    renderRootPage()

    expect(await screen.findByTestId('lp-hero')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })
})

// ==========================================================
// Entry Gate — 認証状態を確認できない（unavailable）→ 再試行（web-dec-69 / shared-leave-03）
// ==========================================================
describe('RootPage — unavailable', () => {
  beforeEach(() => {
    authSessionOverride.current = { kind: 'unavailable', failure: { reason: 'network' } }
  })

  test('shared-leave-03: unavailable は LandingPage もログインモーダルも出さず、再試行ボタンを出す', () => {
    renderRootPage()

    expect(screen.getByText('接続できませんでした')).toBeInTheDocument()
    expect(screen.getByTestId('auth-retry')).toBeInTheDocument()
    expect(screen.queryByTestId('lp-hero')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  test('shared-leave-03: 再試行ボタンを押すと retry() を 1 回呼ぶ', async () => {
    renderRootPage()
    const user = userEvent.setup()

    await user.click(screen.getByTestId('auth-retry'))

    expect(retryMock).toHaveBeenCalledTimes(1)
  })

  test('resolving・anonymous では再試行ボタンを出さない（従来の描画のまま）', async () => {
    authSessionOverride.current = { kind: 'resolving' }
    const { unmount } = renderRootPage()
    expect(await screen.findByTestId('lp-hero')).toBeInTheDocument()
    expect(screen.queryByTestId('auth-retry')).not.toBeInTheDocument()
    unmount()

    authSessionOverride.current = { kind: 'anonymous' }
    renderRootPage()
    expect(await screen.findByTestId('lp-hero')).toBeInTheDocument()
    expect(screen.queryByTestId('auth-retry')).not.toBeInTheDocument()
  })
})
