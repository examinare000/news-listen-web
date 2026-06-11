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

beforeEach(async () => {
  vi.clearAllMocks()
  localStorage.clear()
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
