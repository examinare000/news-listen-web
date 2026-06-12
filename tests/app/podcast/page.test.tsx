import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import PodcastPage from '@/app/podcast/page'
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
  },
]

let mockAudio: ReturnType<typeof setupMockAudio>

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mockAudio = setupMockAudio()
})

function renderPodcastPage(extraState = {}) {
  return render(
    <AppProvider initialState={{
      isConfigured: true,
      baseUrl: 'https://api.example.com',
      apiKey: 'test-key',
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
    createApiClient.mockReturnValue({
      getPodcasts: vi.fn().mockResolvedValue({ podcasts: SAMPLE_PODCASTS }),
      getPodcast: vi.fn(),
    })

    renderPodcastPage()

    await waitFor(() => {
      expect(screen.getByText(/これはテスト用のポッドキャストイントロ/)).toBeInTheDocument()
    })
  })

  test('Given empty podcasts array, displays empty state message', async () => {
    const { createApiClient } = await import('@/lib/api')
    createApiClient.mockReturnValue({
      getPodcasts: vi.fn().mockResolvedValue({ podcasts: [] }),
      getPodcast: vi.fn(),
    })

    renderPodcastPage()

    await waitFor(() => {
      expect(screen.getByText(/Podcast がまだありません/)).toBeInTheDocument()
      expect(screen.getByText(/Star/)).toBeInTheDocument()
    })
  })

  test('Given loading state, shows skeleton', async () => {
    const { createApiClient } = await import('@/lib/api')
    createApiClient.mockReturnValue({
      getPodcasts: vi.fn(() => new Promise(() => {})),
      getPodcast: vi.fn(),
    })

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
    createApiClient.mockReturnValue({
      getPodcasts: vi.fn().mockResolvedValue({ podcasts: SAMPLE_PODCASTS }),
      getPodcast,
    })

    renderPodcastPage()
    await waitFor(() => screen.getByText(/これはテスト用のポッドキャストイントロ/))

    await userEvent.click(screen.getByRole('button', { name: /再生|play/i }))

    // 一覧取得時の audio_url を使わず、getPodcast を呼び直すこと
    expect(getPodcast).toHaveBeenCalledWith(SAMPLE_PODCASTS[0].id)
  })

  test('Given play with saved position, restores position from localStorage', async () => {
    localStorage.setItem('podcast_position:p1', JSON.stringify(120))
    const freshPodcast = { ...SAMPLE_PODCASTS[0] }
    const { createApiClient } = await import('@/lib/api')
    createApiClient.mockReturnValue({
      getPodcasts: vi.fn().mockResolvedValue({ podcasts: SAMPLE_PODCASTS }),
      getPodcast: vi.fn().mockResolvedValue(freshPodcast),
    })

    renderPodcastPage()
    await waitFor(() => screen.getByText(/これはテスト用のポッドキャストイントロ/))

    await userEvent.click(screen.getByRole('button', { name: /再生|play/i }))

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
    createApiClient.mockReturnValue({
      getPodcasts: vi.fn().mockResolvedValue({ podcasts: TWO_PODCASTS }),
      getPodcast: vi.fn(),
    })

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
    createApiClient.mockReturnValue({
      getPodcasts: vi.fn().mockResolvedValue({ podcasts: TWO_PODCASTS }),
      getPodcast: vi.fn(),
    })

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
    createApiClient.mockReturnValue({
      getPodcasts,
      getPodcast: vi.fn(),
    })

    renderPodcastPage()
    await waitFor(() => screen.getByText(/これはテスト用のポッドキャストイントロ/))

    await userEvent.click(screen.getByRole('button', { name: /リフレッシュ|更新|refresh/i }))

    expect(getPodcasts).toHaveBeenCalledTimes(2)
  })
})
