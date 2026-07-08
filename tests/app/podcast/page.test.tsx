import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import PodcastPage from '@/app/(app)/podcast/page'
import { AppProvider } from '@/contexts/AppContext'
import { AudioPlayerProvider } from '@/contexts/AudioPlayerContext'
import { ToastProvider } from '@/components/ui/Toast'
import { setupMockAudio } from '../../helpers/mockAudio'

vi.mock('@/lib/api', () => ({
  createApiClient: vi.fn(() => ({
    getPodcasts: vi.fn(),
    getPodcast: vi.fn(),
  })),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public detail: string) {
      super(detail)
    }
  },
}))

// issue #167: オフライン保存ボタン用。既定は「未キャッシュ」に倒す。
// WHY the mock also stubs getCachedAudioUrl/getCachedPodcast (unused by most of this test
// file's assertions): AudioPlayerContext imports them from the same module, and a partial
// mock would leave them undefined — breaking the (real, unmocked) play flow other tests exercise.
const { isCached, downloadAudio, getCachedAudioUrl, getCachedPodcast } = vi.hoisted(() => ({
  isCached: vi.fn().mockResolvedValue(false),
  downloadAudio: vi.fn().mockResolvedValue(undefined),
  getCachedAudioUrl: vi.fn().mockResolvedValue(null),
  getCachedPodcast: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/audioCache', () => ({ isCached, downloadAudio, getCachedAudioUrl, getCachedPodcast }))

const SAMPLE_PODCASTS = [
  {
    id: 'p1',
    type: 'single',
    article_ids: ['a1'],
    difficulty: 'toeic_900',
    audio_url: 'https://storage.example.com/audio.mp3',
    japanese_intro_text: 'これはテスト用のポッドキャストイントロです。',
    duration_seconds: 300,
    created_at: '2026-06-10T09:00:00+09:00',
    status: 'completed' as const,
    error_message: null,
    playback_position_seconds: 0,
  },
]

// 再生中強調（D24）の検証用: 複数カードのうち 1 枚だけが強調されることを確認する
const TWO_PODCASTS = [
  SAMPLE_PODCASTS[0],
  {
    id: 'p2',
    type: 'digest',
    article_ids: ['a2', 'a3'],
    difficulty: 'eiken_2',
    audio_url: 'https://storage.example.com/audio2.mp3',
    japanese_intro_text: '二つ目のポッドキャストのイントロです。',
    duration_seconds: 600,
    created_at: '2026-06-09T09:00:00+09:00',
    status: 'completed' as const,
    error_message: null,
    playback_position_seconds: 0,
  },
]

let mockAudio: ReturnType<typeof setupMockAudio>

beforeEach(() => {
  vi.clearAllMocks()
  // WHY reset here (not rely on vi.clearAllMocks): clearAllMocks wipes call history but
  // keeps whatever resolved value a previous test's mockResolvedValue() left behind.
  isCached.mockResolvedValue(false)
  downloadAudio.mockResolvedValue(undefined)
  localStorage.clear()
  mockAudio = setupMockAudio()
})

function renderPodcastPage(extraState = {}) {
  return render(
    <AppProvider initialState={{
      ...extraState,
    }}>
      <ToastProvider>
        <AudioPlayerProvider>
          <PodcastPage />
        </AudioPlayerProvider>
      </ToastProvider>
    </AppProvider>
  )
}

// ==========================================================
// Podcast 一覧 — 表示
// ==========================================================
describe('PodcastPage — listing', () => {
  test('Given podcasts returned, renders podcast cards', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcasts: vi.fn().mockResolvedValue({ podcasts: SAMPLE_PODCASTS }),
      getPodcast: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderPodcastPage()

    await waitFor(() => {
      expect(screen.getByText(/これはテスト用のポッドキャストイントロ/)).toBeInTheDocument()
    })
  })

  test('Given empty podcasts array, displays empty state message', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcasts: vi.fn().mockResolvedValue({ podcasts: [] }),
      getPodcast: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderPodcastPage()

    await waitFor(() => {
      expect(screen.getByText(/Podcast がまだありません/)).toBeInTheDocument()
      expect(screen.getByText(/Star/)).toBeInTheDocument()
    })
  })

  test('Given loading state, shows skeleton', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcasts: vi.fn(() => new Promise(() => {})),
      getPodcast: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderPodcastPage()

    expect(screen.getByTestId('skeleton-card')).toBeInTheDocument()
  })
})

// ==========================================================
// Podcast 一覧 — 再生（D7: 再生前に getPodcast で URL 再取得）
// ==========================================================
describe('PodcastPage — play with fresh URL', () => {
  test('Given play button clicked, calls getPodcast(id) to get fresh URL before playing', async () => {
    const freshPodcast = { ...SAMPLE_PODCASTS[0], audio_url: 'https://storage.example.com/fresh.mp3' }
    const getPodcast = vi.fn().mockResolvedValue(freshPodcast)
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcasts: vi.fn().mockResolvedValue({ podcasts: SAMPLE_PODCASTS }),
      getPodcast,
    } as unknown as ReturnType<typeof createApiClient>)

    renderPodcastPage()
    await waitFor(() => screen.getByText(/これはテスト用のポッドキャストイントロ/))

    await userEvent.click(screen.getByRole('button', { name: '再生' }))

    // 一覧取得時の audio_url を使わず、getPodcast を呼び直すこと
    expect(getPodcast).toHaveBeenCalledWith(SAMPLE_PODCASTS[0].id)
  })

  test('Given play with saved position, restores position from localStorage', async () => {
    localStorage.setItem('podcast_position:p1', JSON.stringify(120))
    const freshPodcast = { ...SAMPLE_PODCASTS[0] }
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcasts: vi.fn().mockResolvedValue({ podcasts: SAMPLE_PODCASTS }),
      getPodcast: vi.fn().mockResolvedValue(freshPodcast),
    } as unknown as ReturnType<typeof createApiClient>)

    renderPodcastPage()
    await waitFor(() => screen.getByText(/これはテスト用のポッドキャストイントロ/))

    await userEvent.click(screen.getByRole('button', { name: '再生' }))

    await waitFor(() => {
      // 保存済み位置 120 が currentTime に反映される
      expect(mockAudio.currentTime).toBe(120)
    })
  })
})

// ==========================================================
// Podcast 一覧 — 再生中強調（D24）
// ==========================================================
describe('PodcastPage — playing highlight (D24)', () => {
  test('Given currentPodcast matches podcast A, only A\'s card shows 再生中 indicator', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcasts: vi.fn().mockResolvedValue({ podcasts: TWO_PODCASTS }),
      getPodcast: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderPodcastPage({ currentPodcast: TWO_PODCASTS[0] })

    await waitFor(() => {
      expect(screen.getByText(/二つ目のポッドキャストのイントロ/)).toBeInTheDocument()
    })

    // 「再生中」表示は currentPodcast に一致するカード 1 枚のみ
    const playingLabels = screen.getAllByText('再生中')
    expect(playingLabels).toHaveLength(1)
    expect(playingLabels[0].closest('.podcast-card')).toHaveTextContent(
      /これはテスト用のポッドキャストイントロ/
    )
  })

  test('Given currentPodcast is null, no card shows 再生中 indicator', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcasts: vi.fn().mockResolvedValue({ podcasts: TWO_PODCASTS }),
      getPodcast: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderPodcastPage({ currentPodcast: null })

    await waitFor(() => {
      expect(screen.getByText(/二つ目のポッドキャストのイントロ/)).toBeInTheDocument()
    })

    expect(screen.queryByText('再生中')).not.toBeInTheDocument()
  })
})

// ==========================================================
// Podcast 一覧 — リフレッシュボタン
// ==========================================================
describe('PodcastPage — refresh', () => {
  test('Given refresh button clicked, calls getPodcasts again', async () => {
    const getPodcasts = vi.fn().mockResolvedValue({ podcasts: SAMPLE_PODCASTS })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcasts,
      getPodcast: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderPodcastPage()
    await waitFor(() => screen.getByText(/これはテスト用のポッドキャストイントロ/))

    const initialCallCount = getPodcasts.mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: /リフレッシュ|更新|refresh/i }))

    // Refresh button should trigger at least one more call (polling may also call in background)
    expect(getPodcasts.mock.calls.length).toBeGreaterThan(initialCallCount)
  })
})

// ==========================================================
// Podcast 一覧 — ポーリング（#11 生成完了待ち）
// ==========================================================
describe('PodcastPage — polling for new podcasts (#11)', () => {
  test('Polling hook is used and enabled on mount', async () => {
    const getPodcasts = vi.fn().mockResolvedValue({ podcasts: SAMPLE_PODCASTS })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcasts,
      getPodcast: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderPodcastPage()

    // Polling should be enabled on mount: fetchPodcasts called for initial load
    // plus polling calls will increment over time. Just verify it starts.
    await waitFor(() => {
      expect(getPodcasts).toHaveBeenCalled()
    })
  })

  test('Page renders list after initial fetch completes', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcasts: vi.fn().mockResolvedValue({ podcasts: SAMPLE_PODCASTS }),
      getPodcast: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderPodcastPage()

    await waitFor(() => {
      expect(screen.getByText(/これはテスト用のポッドキャストイントロ/)).toBeInTheDocument()
    })
  })
})

// ==========================================================
// Podcast 一覧 — オフライン保存（issue #167）
// ==========================================================
describe('PodcastPage — offline download (issue #167)', () => {
  test('shows an オフライン保存 button on each card when not cached', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcasts: vi.fn().mockResolvedValue({ podcasts: SAMPLE_PODCASTS }),
      getPodcast: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderPodcastPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'オフライン保存' })).toBeInTheDocument()
    })
  })

  test('clicking it downloads the audio and switches that card to a "保存済み" state', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcasts: vi.fn().mockResolvedValue({ podcasts: SAMPLE_PODCASTS }),
      getPodcast: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderPodcastPage()
    await waitFor(() => screen.getByRole('button', { name: 'オフライン保存' }))

    await userEvent.click(screen.getByRole('button', { name: 'オフライン保存' }))

    expect(downloadAudio).toHaveBeenCalledWith('p1')
    await waitFor(() => {
      expect(screen.getByText('保存済み')).toBeInTheDocument()
    })
  })

  test('shows "保存済み" immediately for episodes already cached (no re-download)', async () => {
    isCached.mockResolvedValue(true)
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcasts: vi.fn().mockResolvedValue({ podcasts: SAMPLE_PODCASTS }),
      getPodcast: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderPodcastPage()

    await waitFor(() => {
      expect(screen.getByText('保存済み')).toBeInTheDocument()
    })
    expect(downloadAudio).not.toHaveBeenCalled()
  })

  // 回帰テスト: E2E (e2e/main-flow.e2e.ts) が実ブラウザで無限レンダーループに陥り
  // タイムアウトしていた不具合の再現。原因は、このキャッシュ有無チェック用 useEffect が
  // `podcasts`（配列の参照）を依存配列に持つこと。getPodcasts() は HTTP 経由の JSON レスポンス
  // なので毎回新しい配列参照を返す（内容が同じでも `Object.is` では別物）。usePodcastListPolling
  // 側には既存の別バグ（onUpdate がインラインなので poll の再生成→即時再実行を誘発する）があり、
  // このコンポーネントが「内容が同じでも参照が変わるたびに再実行される」経路を持つと、その既存バグと
  // 相互作用して再レンダーの連鎖が実質無限ループ化する。テストでは fetch の都度、内容は同じだが
  // 参照が異なる配列を返すモックで再現する。
  test('does not run away re-checking cache status when podcasts array reference changes without content changes (regression)', async () => {
    const getPodcasts = vi.fn().mockImplementation(async () => ({ podcasts: [...SAMPLE_PODCASTS] }))
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcasts,
      getPodcast: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderPodcastPage()

    await waitFor(() => {
      expect(screen.getByText(/これはテスト用のポッドキャストイントロ/)).toBeInTheDocument()
    })

    // POLL_INTERVAL_MS (5000ms) より十分短い実時間だけ待つ。正常なケースでは
    // この間に追加のポーリングは発生しないはず。暴走時はマイクロタスク駆動で
    // 数百〜数千回呼ばれる。
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(getPodcasts.mock.calls.length).toBeLessThanOrEqual(2)
  })
})
