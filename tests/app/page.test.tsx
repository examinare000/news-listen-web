import { describe, test, expect, beforeEach, vi } from 'vitest'
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

beforeEach(async () => {
  vi.clearAllMocks()
  localStorage.clear()
  useAppOverride.current = null
  // setup.ts の vi.fn() に対して mockReturnValue で挙動を制御
  const { useRouter } = await import('next/navigation')
  useRouter.mockReturnValue({ replace: mockReplace })
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
// Entry Gate — 未設定状態 (spec §10.1-c)
// ==========================================================
describe('RootPage — unconfigured', () => {
  test('Given not configured and restore complete, shows SetupModal', async () => {
    // isRestoring: false を渡すことで復元完了後の状態を直接テスト
    // (testing-library は useEffect をフラッシュするため isRestoring: true は中間状態にすぎない)
    renderRootPage({ isConfigured: false, isRestoring: false })

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  test('Given no credentials in localStorage, shows SetupModal after restore', async () => {
    // localStorage は空のため、AppProvider の復元 effect は RESTORE_DONE のみ dispatch
    // → isConfigured: false のまま → SetupModal 表示
    renderRootPage()

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
    expect(mockReplace).not.toHaveBeenCalled()
  })
})

// ==========================================================
// Entry Gate — 復元中スケルトン (spec §10.1-a)
// ==========================================================
describe('RootPage — restoring', () => {
  test('Given isRestoring, shows card-shaped skeleton placeholders', () => {
    useAppOverride.current = () => ({
      state: { isRestoring: true, isConfigured: false },
      dispatch: vi.fn(),
      configure: vi.fn(),
    })

    render(<RootPage />)

    const loading = screen.getByLabelText('読み込み中')
    // カード形状のプレースホルダー — 単一ブロックでなく複数の .skeleton 要素で構成される
    expect(loading.querySelectorAll('.skeleton').length).toBeGreaterThanOrEqual(2)
    // 復元中はモーダルもリダイレクトも発生しない
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })
})

// ==========================================================
// Entry Gate — 設定済み状態 (spec §10.1-b)
// ==========================================================
describe('RootPage — configured', () => {
  test('Given configured and restore complete, calls router.replace("/feed")', async () => {
    renderRootPage({ isConfigured: true, isRestoring: false })

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/feed')
    })
  })

  test('Given configured, does NOT show SetupModal', async () => {
    renderRootPage({ isConfigured: true, isRestoring: false })

    await waitFor(() => expect(mockReplace).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

// ==========================================================
// Entry Gate — SetupModal から設定保存後に遷移 (spec §10.1-c → b)
// ==========================================================
describe('RootPage — configure via modal', () => {
  test('Given SetupModal onConfigure called, persists credentials to localStorage', async () => {
    renderRootPage({ isConfigured: false, isRestoring: false })

    await waitFor(() => screen.getByRole('dialog'))

    await userEvent.type(screen.getByLabelText(/Base URL/i), 'https://api.example.com')
    await userEvent.type(screen.getByLabelText(/API Key/i), 'my-api-key')
    await userEvent.click(screen.getByRole('button', { name: /保存|save/i }))

    await waitFor(() => {
      expect(localStorage.getItem('api_base_url')).toBe(JSON.stringify('https://api.example.com'))
      expect(localStorage.getItem('api_key')).toBe(JSON.stringify('my-api-key'))
    })
  })
})
