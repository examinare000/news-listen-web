import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import SettingsPage from '@/app/settings/page'
import { AppProvider, useApp } from '@/contexts/AppContext'
import { ToastProvider } from '@/components/ui/Toast'
import { PLAYBACK_SPEEDS } from '@/hooks/useAudioPlayer'

vi.mock('@/lib/api', () => ({
  createApiClient: vi.fn(() => ({
    checkHealth: vi.fn(),
    updateProfile: vi.fn(),
    changePassword: vi.fn(),
    getPreferences: vi.fn(),
    updatePreferences: vi.fn(),
  })),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public detail: string) {
      super(detail)
    }
  },
}))

// AccountSection が useAuth を使うためモックする（管理者ユーザーでログイン中とする）。
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    status: 'authenticated',
    user: { username: 'admin', role: 'admin', display_name: 'Admin' },
    login: vi.fn(),
    logout: vi.fn(),
    refreshMe: vi.fn(),
  }),
}))

function renderSettingsPage() {
  return render(
    <AppProvider>
      <ToastProvider>
        <SettingsPage />
      </ToastProvider>
    </AppProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

// ==========================================================
// Settings 画面 — 表示
// ==========================================================
describe('SettingsPage — display', () => {
  test('Displays difficulty selector label', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPreferences: vi
        .fn()
        .mockResolvedValue({
          default_difficulty: 'toeic_600',
          default_playback_speed: 1.0,
          digest_enabled: true,
          digest_article_count: 10,
        }),
      updatePreferences: vi.fn().mockResolvedValue({}),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSettingsPage()
    await waitFor(() => {
      expect(screen.getByText(/デフォルト難易度/)).toBeInTheDocument()
    })
  })

  test('Renders speed selector with 8 options', async () => {
    renderSettingsPage()
    const speedSelect = screen.getByRole('combobox', { name: /速度|speed/i })
    expect(speedSelect).toBeInTheDocument()
  })
})

// ==========================================================
// Settings 画面 — 設定保存
// ==========================================================
describe('SettingsPage — save settings', () => {
  test('Given speed changed, updates localStorage', async () => {
    renderSettingsPage()
    const speedSelect = screen.getByRole('combobox', { name: /速度|speed/i })

    await userEvent.selectOptions(speedSelect, '1.5')

    expect(localStorage.getItem('default_playback_speed')).toBe(JSON.stringify(1.5))
  })

  test('Given speed changed, dispatches SET_SPEED to AppContext immediately (spec §10.5)', async () => {
    // Wrap SettingsPage with AppProvider and read back state to verify dispatch
    let capturedState: { playbackSpeed: number } | null = null

    function TestConsumer() {
      const { state } = useApp()
      capturedState = { playbackSpeed: state.playbackSpeed }
      return null
    }

    render(
      <AppProvider>
        <ToastProvider>
          <SettingsPage />
          <TestConsumer />
        </ToastProvider>
      </AppProvider>
    )

    const speedSelect = screen.getByRole('combobox', { name: /速度|speed/i })
    await userEvent.selectOptions(speedSelect, '1.75')

    await waitFor(() => {
      expect(capturedState?.playbackSpeed).toBe(1.75)
    })
  })
})

// ==========================================================
// Settings 画面 — リスタイル（セクションカード構造）
// ==========================================================
describe('SettingsPage — restyle (section card structure)', () => {
  test('Shows page subtitle "アプリの動作をカスタマイズ"', () => {
    renderSettingsPage()
    expect(screen.getByText('アプリの動作をカスタマイズ')).toBeInTheDocument()
  })

  test('Shows section title "Podcast 生成"', () => {
    renderSettingsPage()
    expect(screen.getByText('Podcast 生成')).toBeInTheDocument()
  })

  test('Speed selector is decorated with .select-input', () => {
    renderSettingsPage()
    const speedSelect = screen.getByRole('combobox', { name: /速度|speed/i })
    expect(speedSelect.classList.contains('select-input')).toBe(true)
  })
})

// ==========================================================
// Settings 画面 — デフォルト難易度（C群#13）
// ==========================================================
describe('SettingsPage — default difficulty (C群#13)', () => {
  test('Renders difficulty selector with 6 difficulty levels', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPreferences: vi
        .fn()
        .mockResolvedValue({
          default_difficulty: 'toeic_900',
          default_playback_speed: 1.0,
          digest_enabled: true,
          digest_article_count: 10,
        }),
      updatePreferences: vi.fn().mockResolvedValue({}),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSettingsPage()

    await waitFor(() => {
      const diffSelect = screen.getByRole<HTMLSelectElement>('combobox', { name: /難易度/i })
      expect(diffSelect).toBeInTheDocument()
    })
  })

  test('Displays option labels as text (not nested components)', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPreferences: vi
        .fn()
        .mockResolvedValue({
          default_difficulty: 'toeic_600',
          default_playback_speed: 1.0,
          digest_enabled: true,
          digest_article_count: 10,
        }),
      updatePreferences: vi.fn().mockResolvedValue({}),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSettingsPage()

    await waitFor(() => {
      // Verify label text is visible (not component nesting)
      expect(screen.getByText('TOEIC 600')).toBeInTheDocument()
      expect(screen.getByText('TOEIC 900')).toBeInTheDocument()
      expect(screen.getByText('IELTS 7.0')).toBeInTheDocument()
    })
  })

  test('Loads initial difficulty from getPreferences', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPreferences: vi
        .fn()
        .mockResolvedValue({
          default_difficulty: 'ielts_7',
          default_playback_speed: 1.0,
          digest_enabled: true,
          digest_article_count: 10,
        }),
      updatePreferences: vi.fn().mockResolvedValue({}),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSettingsPage()

    await waitFor(() => {
      const diffSelect = screen.getByRole<HTMLSelectElement>('combobox', { name: /難易度/i })
      expect(diffSelect.value).toBe('ielts_7')
    })
  })

  test('Calls updatePreferences when difficulty changes', async () => {
    const updatePreferences = vi.fn().mockResolvedValue({})
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPreferences: vi
        .fn()
        .mockResolvedValue({
          default_difficulty: 'toeic_600',
          default_playback_speed: 1.0,
          digest_enabled: true,
          digest_article_count: 10,
        }),
      updatePreferences,
    } as unknown as ReturnType<typeof createApiClient>)

    renderSettingsPage()

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /難易度/i })).toBeInTheDocument()
    })

    const diffSelect = screen.getByRole('combobox', { name: /難易度/i })
    await userEvent.selectOptions(diffSelect, 'eiken_p1')

    await waitFor(() => {
      expect(updatePreferences).toHaveBeenCalledWith({ default_difficulty: 'eiken_p1' })
    })
  })

  test('Falls back to toeic_600 if getPreferences fails', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPreferences: vi.fn().mockRejectedValue(new ApiError(500, 'Server error')),
      updatePreferences: vi.fn().mockResolvedValue({}),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSettingsPage()

    await waitFor(() => {
      const diffSelect = screen.getByRole<HTMLSelectElement>('combobox', { name: /難易度/i })
      expect(diffSelect.value).toBe('toeic_600')
    })
  })

  // issue #164: 設定読み込み失敗をサイレントにせず、トースト表示と再試行導線を出す
  test('Given getPreferences fails, shows an error toast and a retry affordance', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPreferences: vi.fn().mockRejectedValue(new ApiError(500, 'Server error')),
      updatePreferences: vi.fn().mockResolvedValue({}),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSettingsPage()

    // WHY: トースト（Toast コンポーネント）とインライン再試行導線の両方に
    // 同文言が出るため getAllByText で許容する
    await waitFor(() => {
      expect(screen.getAllByText(/設定の読み込みに失敗しました/).length).toBeGreaterThan(0)
    })
    expect(screen.getByRole('button', { name: /設定を再読み込み/ })).toBeInTheDocument()
  })

  test('Given retry button clicked after getPreferences failure, refetches and clears the error on success', async () => {
    const getPreferences = vi
      .fn()
      .mockRejectedValueOnce(new (await import('@/lib/api')).ApiError(500, 'Server error'))
      .mockResolvedValueOnce({
        default_difficulty: 'ielts_7',
        default_playback_speed: 1.0,
        digest_enabled: true,
        digest_article_count: 10,
      })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPreferences,
      updatePreferences: vi.fn().mockResolvedValue({}),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSettingsPage()

    await waitFor(() => screen.getByRole('button', { name: /設定を再読み込み/ }))
    await userEvent.click(screen.getByRole('button', { name: /設定を再読み込み/ }))

    await waitFor(() => expect(getPreferences).toHaveBeenCalledTimes(2))
    // WHY: エラートーストは TOAST_DURATION_MS (3秒) 経過まで実タイマーで残るため、
    // 消滅を待つのではなく、成功時にのみ消える再試行ボタンの有無で復帰を検証する。
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /設定を再読み込み/ })).not.toBeInTheDocument()
    })
    const diffSelect = screen.getByRole<HTMLSelectElement>('combobox', { name: /難易度/i })
    expect(diffSelect.value).toBe('ielts_7')
  })
})

// ==========================================================
// Settings 画面 — デザインとの乖離決定（D21 / D22）
// リグレッション防止: デザインモックにある UI を誤って実装しないこと
// ==========================================================
describe('SettingsPage — design divergences (D21/D22)', () => {

  test('D21: speed selector keeps the 8 PLAYBACK_SPEEDS options (no continuous slider)', () => {
    renderSettingsPage()
    const speedSelect = screen.getByRole('combobox', { name: /速度|speed/i })
    const options = within(speedSelect).getAllByRole('option')
    expect(options.map((o) => o.getAttribute('value'))).toEqual(PLAYBACK_SPEEDS.map(String))
    // デザインの連続値スライダーは採用しない
    expect(document.querySelector('input[type="range"]')).not.toBeInTheDocument()
  })

  test('D22: no cache management UI', () => {
    renderSettingsPage()
    expect(screen.queryByRole('button', { name: /キャッシュ/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/キャッシュ/)).not.toBeInTheDocument()
  })
})

