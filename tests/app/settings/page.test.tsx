import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import SettingsPage from '@/app/settings/page'
import { AppProvider, useApp } from '@/contexts/AppContext'
import { ToastProvider } from '@/components/ui/Toast'
import { PLAYBACK_SPEEDS } from '@/hooks/useAudioPlayer'
import type { createApiClient } from '@/lib/api'

vi.mock('@/lib/api', () => ({
  createApiClient: vi.fn(() => ({
    checkHealth: vi.fn(),
    updateProfile: vi.fn(),
    changePassword: vi.fn(),
    getPreferences: vi.fn(),
    updatePreferences: vi.fn(),
    getGenerationQuota: vi.fn(),
    getListeningStreak: vi.fn(),
  })),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public detail: string) {
      super(detail)
    }
  },
}))

// issue #167: オフラインキャッシュセクション用。既定は「未キャッシュ・容量取得不可」に倒す
// （lib/audioCache.ts の graceful degradation と同じデフォルト）。
const {
  listCachedEpisodes,
  estimateUsage,
  deleteAudio: mockDeleteAudio,
  deleteAllAudio: mockDeleteAllAudio,
} = vi.hoisted(() => ({
  listCachedEpisodes: vi.fn().mockResolvedValue([]),
  estimateUsage: vi.fn().mockResolvedValue(null),
  deleteAudio: vi.fn().mockResolvedValue(undefined),
  deleteAllAudio: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/audioCache', () => ({
  listCachedEpisodes,
  estimateUsage,
  deleteAudio: mockDeleteAudio,
  deleteAllAudio: mockDeleteAllAudio,
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

  // issue #164: 難易度保存失敗をサイレントにせず、エラートースト表示 + サーバー値へロールバックする
  test('Given updatePreferences fails, shows an error toast and reverts the select to the previous value', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPreferences: vi
        .fn()
        .mockResolvedValue({
          default_difficulty: 'toeic_600',
          default_playback_speed: 1.0,
          digest_enabled: true,
          digest_article_count: 10,
        }),
      updatePreferences: vi.fn().mockRejectedValue(new ApiError(500, 'Server error')),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSettingsPage()

    await waitFor(() => {
      expect(screen.getByRole<HTMLSelectElement>('combobox', { name: /難易度/i }).value).toBe(
        'toeic_600'
      )
    })

    const diffSelect = screen.getByRole<HTMLSelectElement>('combobox', { name: /難易度/i })
    await userEvent.selectOptions(diffSelect, 'eiken_p1')

    await waitFor(() => {
      expect(screen.getByText(/難易度設定の保存に失敗しました/)).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(diffSelect.value).toBe('toeic_600')
    })
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

  // D22 was superseded by issue #167 (PWA offline playback), whose acceptance criteria
  // explicitly require a cache usage/deletion UI in Settings. See the
  // 'SettingsPage — offline cache (issue #167)' describe block below for its coverage.
})

// ==========================================================
// Settings 画面 — 生成残回数の可視化（issue #164 / ADR-061）
// ==========================================================
describe('SettingsPage — generation quota (issue #164)', () => {
  test('Given limit > 0, shows remaining / limit', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPreferences: vi.fn().mockResolvedValue({
        default_difficulty: 'toeic_600',
        default_playback_speed: 1.0,
        digest_enabled: true,
        digest_article_count: 10,
      }),
      updatePreferences: vi.fn().mockResolvedValue({}),
      getGenerationQuota: vi.fn().mockResolvedValue({
        limit: 5,
        used: 2,
        remaining: 3,
        reset_at: '2026-07-07T00:00:00Z',
      }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSettingsPage()

    await waitFor(() => {
      expect(screen.getByText('本日の残り生成回数')).toBeInTheDocument()
      expect(screen.getByText('3 / 5 回')).toBeInTheDocument()
    })
  })

  test('Given limit === 0 (unlimited), hides the quota row', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPreferences: vi.fn().mockResolvedValue({
        default_difficulty: 'toeic_600',
        default_playback_speed: 1.0,
        digest_enabled: true,
        digest_article_count: 10,
      }),
      updatePreferences: vi.fn().mockResolvedValue({}),
      getGenerationQuota: vi.fn().mockResolvedValue({
        limit: 0,
        used: 12,
        remaining: null,
        reset_at: '2026-07-07T00:00:00Z',
      }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSettingsPage()

    await waitFor(() => {
      expect(screen.getByText('デフォルト難易度')).toBeInTheDocument()
    })
    expect(screen.queryByText('本日の残り生成回数')).not.toBeInTheDocument()
  })

  test('Given getGenerationQuota fails, shows an inline error with a retry button that refetches', async () => {
    const getGenerationQuota = vi
      .fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({
        limit: 5,
        used: 1,
        remaining: 4,
        reset_at: '2026-07-07T00:00:00Z',
      })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPreferences: vi.fn().mockResolvedValue({
        default_difficulty: 'toeic_600',
        default_playback_speed: 1.0,
        digest_enabled: true,
        digest_article_count: 10,
      }),
      updatePreferences: vi.fn().mockResolvedValue({}),
      getGenerationQuota,
    } as unknown as ReturnType<typeof createApiClient>)

    renderSettingsPage()

    await waitFor(() => screen.getByRole('button', { name: /残り生成回数を再読み込み/ }))
    await userEvent.click(screen.getByRole('button', { name: /残り生成回数を再読み込み/ }))

    await waitFor(() => expect(getGenerationQuota).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      expect(screen.getByText('4 / 5 回')).toBeInTheDocument()
    })
  })

  // Graceful degradation: 404（エンドポイント未実装）時は quota セクション非表示
  test('Given getGenerationQuota returns 404, hides quota section silently (graceful degradation)', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPreferences: vi.fn().mockResolvedValue({
        default_difficulty: 'toeic_600',
        default_playback_speed: 1.0,
        digest_enabled: true,
        digest_article_count: 10,
      }),
      updatePreferences: vi.fn().mockResolvedValue({}),
      getGenerationQuota: vi.fn().mockRejectedValue(new ApiError(404, 'Not Found')),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSettingsPage()

    await waitFor(() => {
      expect(screen.getByText('デフォルト難易度')).toBeInTheDocument()
    })
    // 404 時は quota セクション全体を非表示にする
    expect(screen.queryByText('本日の残り生成回数')).not.toBeInTheDocument()
    // エラーメッセージも表示しない
    expect(screen.queryByText(/残り生成回数の取得に失敗/)).not.toBeInTheDocument()
  })

  // 404 以外のエラーは既存どおり「エラー + 再試行」を出す
  test('Given getGenerationQuota returns 500, shows error banner with retry button (not graceful)', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPreferences: vi.fn().mockResolvedValue({
        default_difficulty: 'toeic_600',
        default_playback_speed: 1.0,
        digest_enabled: true,
        digest_article_count: 10,
      }),
      updatePreferences: vi.fn().mockResolvedValue({}),
      getGenerationQuota: vi.fn().mockRejectedValue(new ApiError(500, 'Server error')),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSettingsPage()

    await waitFor(() => {
      expect(screen.getByText(/残り生成回数の取得に失敗/)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /残り生成回数を再読み込み/ })).toBeInTheDocument()
  })
})

// ==========================================================
// Settings 画面 — 難易度変更のレース条件対策（issue #164）
// ==========================================================
// ==========================================================
// Settings 画面 — 聴取ストリークの可視化（issue #165 / ADR-062）
// ==========================================================
describe('SettingsPage — listening streak (issue #165)', () => {
  function mockClientWithStreak(getListeningStreak: ReturnType<typeof vi.fn>) {
    return {
      getPreferences: vi.fn().mockResolvedValue({
        default_difficulty: 'toeic_600',
        default_playback_speed: 1.0,
        digest_enabled: true,
        digest_article_count: 10,
      }),
      updatePreferences: vi.fn().mockResolvedValue({}),
      getGenerationQuota: vi.fn().mockResolvedValue({
        limit: 0,
        used: 0,
        remaining: null,
        reset_at: '2026-07-07T00:00:00Z',
      }),
      getListeningStreak,
    } as unknown as ReturnType<typeof createApiClient>
  }

  test('Given a positive streak and today already listened, shows the streak count and a today-done indicator', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue(
      mockClientWithStreak(
        vi.fn().mockResolvedValue({
          current_streak_days: 5,
          today_listened: true,
          last_listened_day: '2026-07-07',
        }),
      ),
    )

    renderSettingsPage()

    await waitFor(() => {
      expect(screen.getByText('連続聴取日数')).toBeInTheDocument()
      expect(screen.getByText('5日連続・本日分は聴取済み')).toBeInTheDocument()
    })
  })

  test('Given a positive streak but today not yet listened, shows the streak count without a today-done indicator', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue(
      mockClientWithStreak(
        vi.fn().mockResolvedValue({
          current_streak_days: 5,
          today_listened: false,
          last_listened_day: '2026-07-06',
        }),
      ),
    )

    renderSettingsPage()

    await waitFor(() => {
      expect(screen.getByText('5日連続')).toBeInTheDocument()
    })
    expect(screen.queryByText(/本日分は聴取済み/)).not.toBeInTheDocument()
  })

  test('Given current_streak_days is 0 with a non-null last_listened_day, shows the broken-streak message with the last listened date', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue(
      mockClientWithStreak(
        vi.fn().mockResolvedValue({
          current_streak_days: 0,
          today_listened: false,
          last_listened_day: '2026-07-01',
        }),
      ),
    )

    renderSettingsPage()

    await waitFor(() => {
      expect(screen.getByText('連続0日・最終聴取日 2026-07-01')).toBeInTheDocument()
    })
  })

  test('Given last_listened_day is null, shows a never-listened message', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue(
      mockClientWithStreak(
        vi.fn().mockResolvedValue({
          current_streak_days: 0,
          today_listened: false,
          last_listened_day: null,
        }),
      ),
    )

    renderSettingsPage()

    await waitFor(() => {
      expect(screen.getByText('まだ聴取記録がありません')).toBeInTheDocument()
    })
  })

  // Graceful degradation: 404（エンドポイント未実装）時は streak セクション非表示
  test('Given getListeningStreak returns 404, hides the streak section silently (graceful degradation)', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue(
      mockClientWithStreak(vi.fn().mockRejectedValue(new ApiError(404, 'Not Found'))),
    )

    renderSettingsPage()

    await waitFor(() => {
      expect(screen.getByText('デフォルト難易度')).toBeInTheDocument()
    })
    // 404 時はセクション全体を非表示にする
    expect(screen.queryByText('連続聴取日数')).not.toBeInTheDocument()
    // エラーメッセージも表示しない
    expect(screen.queryByText(/聴取ストリークの取得に失敗/)).not.toBeInTheDocument()
  })

  // 404 以外（500・ネットワーク断等）は一時障害として扱い、再試行手段を残す（quota と同じ設計）
  test('Given getListeningStreak returns 500, shows an inline error with a retry button that refetches', async () => {
    const getListeningStreak = vi
      .fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({
        current_streak_days: 5,
        today_listened: true,
        last_listened_day: '2026-07-07',
      })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue(mockClientWithStreak(getListeningStreak))

    renderSettingsPage()

    await waitFor(() => screen.getByRole('button', { name: /聴取ストリークを再読み込み/ }))
    expect(screen.getByText(/聴取ストリークの取得に失敗/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /聴取ストリークを再読み込み/ }))

    await waitFor(() => expect(getListeningStreak).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      expect(screen.getByText('5日連続・本日分は聴取済み')).toBeInTheDocument()
    })
  })
})

describe('SettingsPage — difficulty change race condition', () => {
  test('Given two difficulty changes in succession, only the latest response is applied (stale responses ignored)', async () => {
    const resolveStack: Array<() => void> = []

    const updatePreferences = vi.fn(async (params: { default_difficulty: string }) => {
      // 1回目（eiken_p1）は遅延、2回目（ielts_7）は即座に返す
      if (params.default_difficulty === 'eiken_p1') {
        return new Promise<void>((resolve) => {
          resolveStack.push(resolve)
        })
      }
      return Promise.resolve()
    })

    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPreferences: vi.fn().mockResolvedValue({
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

    const diffSelect = screen.getByRole<HTMLSelectElement>('combobox', { name: /難易度/i })

    // 1回目の変更（遅延中）
    await userEvent.selectOptions(diffSelect, 'eiken_p1')
    expect(diffSelect.value).toBe('eiken_p1')

    // 2回目の変更（即座に返る）
    await userEvent.selectOptions(diffSelect, 'ielts_7')
    expect(diffSelect.value).toBe('ielts_7')

    // 1回目のリクエストを遅延解決（stale）
    const staleResolve = resolveStack[0]
    if (staleResolve) {
      staleResolve()
    }

    // stale な 1回目の成功（eiken_p1）で UI が上書きされないことを確認
    // 最新の値（ielts_7）が保持される
    await waitFor(() => {
      expect(diffSelect.value).toBe('ielts_7')
    })
  })
})

// ==========================================================
// Settings 画面 — オフラインキャッシュ（issue #167）
// ==========================================================
describe('SettingsPage — offline cache (issue #167)', () => {
  test('shows an empty state when nothing is cached', async () => {
    renderSettingsPage()

    await waitFor(() => {
      expect(screen.getByText('オフラインキャッシュ')).toBeInTheDocument()
      expect(screen.getByText('キャッシュ済みのエピソードはありません')).toBeInTheDocument()
    })
  })

  test('lists cached episodes with title and duration', async () => {
    listCachedEpisodes.mockResolvedValue([
      { id: 'p1', title: 'オフライン用イントロ1', duration_seconds: 125 },
      { id: 'p2', title: 'オフライン用イントロ2', duration_seconds: 65 },
    ])

    renderSettingsPage()

    await waitFor(() => {
      expect(screen.getByText('オフライン用イントロ1')).toBeInTheDocument()
      expect(screen.getByText('オフライン用イントロ2')).toBeInTheDocument()
    })
    expect(screen.getByText('2:05')).toBeInTheDocument()
    expect(screen.getByText('1:05')).toBeInTheDocument()
  })

  test('shows storage usage when estimateUsage succeeds', async () => {
    estimateUsage.mockResolvedValue({ usage: 5 * 1024 * 1024, quota: 100 * 1024 * 1024 })

    renderSettingsPage()

    await waitFor(() => {
      expect(screen.getByText('5.0 MB / 100.0 MB')).toBeInTheDocument()
    })
  })

  test('hides the usage row when estimateUsage is unavailable (graceful degradation)', async () => {
    estimateUsage.mockResolvedValue(null)

    renderSettingsPage()

    await waitFor(() => {
      expect(screen.getByText('オフラインキャッシュ')).toBeInTheDocument()
    })
    expect(screen.queryByText(/MB \//)).not.toBeInTheDocument()
  })

  test('deletes a single cached episode and refreshes the list', async () => {
    listCachedEpisodes
      .mockResolvedValueOnce([{ id: 'p1', title: 'オフライン用イントロ1', duration_seconds: 125 }])
      .mockResolvedValueOnce([])

    renderSettingsPage()

    await waitFor(() => expect(screen.getByText('オフライン用イントロ1')).toBeInTheDocument())

    const row = screen.getByTestId('offline-cache-item-p1')
    await userEvent.click(within(row).getByRole('button', { name: '削除' }))

    expect(mockDeleteAudio).toHaveBeenCalledWith('p1')
    await waitFor(() => {
      expect(screen.queryByText('オフライン用イントロ1')).not.toBeInTheDocument()
      expect(screen.getByText('キャッシュ済みのエピソードはありません')).toBeInTheDocument()
    })
  })

  test('deletes every cached episode via "すべて削除"', async () => {
    listCachedEpisodes
      .mockResolvedValueOnce([
        { id: 'p1', title: 'オフライン用イントロ1', duration_seconds: 125 },
        { id: 'p2', title: 'オフライン用イントロ2', duration_seconds: 65 },
      ])
      .mockResolvedValueOnce([])

    renderSettingsPage()

    await waitFor(() => expect(screen.getByText('オフライン用イントロ1')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'すべて削除' }))

    expect(mockDeleteAllAudio).toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByText('キャッシュ済みのエピソードはありません')).toBeInTheDocument()
    })
  })
})

