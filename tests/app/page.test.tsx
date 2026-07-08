import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import RootPage from '@/app/page'
import { AppProvider } from '@/contexts/AppContext'
import { ToastProvider } from '@/components/ui/Toast'

// next/navigation は setup.ts でグローバルにモック済み
// useRouter の戻り値を各テスト前に制御する
const mockReplace = vi.fn()

// 復元中（isRestoring: true）は AppProvider の restore effect が RTL の act で
// 即座に完了してしまい実 Provider では観測できないため、useApp のみ差し替え
// 可能な委譲モックを用意する（override 未設定時は実装へ委譲し他テストは無風）
const useAppOverride = vi.hoisted(() => ({
  current: null as null | (() => unknown),
}))

vi.mock('@/contexts/AppContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/AppContext')>()
  return {
    ...actual,
    useApp: () => (useAppOverride.current ? useAppOverride.current() : actual.useApp()),
  }
})

// 認証状態は useAuth をモックして制御する（AuthProvider の /auth/me 実呼び出しを避ける）。
// 既定は 'authenticated' とし、設定済みテストが従来どおりフィードへ進むようにする。
const authStatusOverride = vi.hoisted(() => ({ current: 'authenticated' }))
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    status: authStatusOverride.current,
    user: null,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    refreshMe: vi.fn(),
  }),
}))

beforeEach(async () => {
  vi.clearAllMocks()
  localStorage.clear()
  useAppOverride.current = null
  authStatusOverride.current = 'authenticated'
  // setup.ts の vi.fn() に対して mockReturnValue で挙動を制御
  const { useRouter } = await import('next/navigation')
  vi.mocked(useRouter).mockReturnValue({ replace: mockReplace } as unknown as ReturnType<typeof useRouter>)
})

function renderRootPage(initialState: Record<string, unknown> = {}) {
  return render(
    <AppProvider initialState={initialState}>
      <ToastProvider>
        <RootPage />
      </ToastProvider>
    </AppProvider>
  )
}

// ==========================================================
// Entry Gate — 認証完了状態 (spec §10.1)
// ==========================================================
describe('RootPage — authenticated', () => {
  test('Given restore complete and authenticated, calls router.replace("/feed")', async () => {
    authStatusOverride.current = 'authenticated'
    renderRootPage({ isRestoring: false })

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/feed')
    })
  })

  test('Given authenticated, does NOT show LoginModal', async () => {
    authStatusOverride.current = 'authenticated'
    renderRootPage({ isRestoring: false })

    await waitFor(() => expect(mockReplace).toHaveBeenCalled())
    expect(screen.queryByRole('dialog', { name: 'ログイン' })).not.toBeInTheDocument()
  })
})

describe('RootPage — authenticated, onboarding gate', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('Given onboarding not completed, shows OnboardingSourcesModal and does not redirect', async () => {
    authStatusOverride.current = 'authenticated'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ onboarding_completed: false }),
      }),
    )
    renderRootPage({ isRestoring: false })

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
    expect(mockReplace).not.toHaveBeenCalled()
  })
})

// ==========================================================
// Entry Gate — 未接続/未ログイン → LandingPage（LP は isRestoring を待たず即座に表示）
// ==========================================================
describe('RootPage — unauthenticated', () => {
  test('Given unauthenticated, shows LandingPage with /signup CTA and does NOT auto-open LoginModal', async () => {
    authStatusOverride.current = 'unauthenticated'
    renderRootPage({ isRestoring: false })

    expect(await screen.findByTestId('lp-hero')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /新規登録|招待コードで登録/ })[0]).toHaveAttribute(
      'href',
      '/signup',
    )
    expect(screen.queryByRole('dialog', { name: 'ログイン' })).not.toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  test('Given unauthenticated even while isRestoring, shows LandingPage immediately (no skeleton wait)', () => {
    authStatusOverride.current = 'unauthenticated'
    useAppOverride.current = () => ({
      state: { isRestoring: true },
      dispatch: vi.fn(),
      setTimeFormat: vi.fn(),
    })

    render(<RootPage />)

    expect(screen.getByTestId('lp-hero')).toBeInTheDocument()
  })

  test('clicking ログイン opens the LoginModal, and its onClose hides it again', async () => {
    authStatusOverride.current = 'unauthenticated'
    renderRootPage({ isRestoring: false })
    const user = userEvent.setup()

    await user.click(screen.getAllByRole('button', { name: 'ログイン' })[0])
    const dialog = await screen.findByRole('dialog', { name: 'ログイン' })
    expect(dialog).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '閉じる' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'ログイン' })).not.toBeInTheDocument())
    // LP 自体は閉じた後も表示され続ける
    expect(screen.getByTestId('lp-hero')).toBeInTheDocument()
  })

  test('Given auth unknown, shows LandingPage (no redirect)', async () => {
    authStatusOverride.current = 'unknown'
    renderRootPage({ isRestoring: false })

    expect(await screen.findByTestId('lp-hero')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })
})
