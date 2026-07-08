import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import PodcastDetailPage from '@/app/(app)/podcast/[id]/page'
import { AppProvider } from '@/contexts/AppContext'
import { AudioPlayerProvider } from '@/contexts/AudioPlayerContext'
import { ToastProvider } from '@/components/ui/Toast'
import type { MockAudio } from '../../../helpers/mockAudio'
import { setupMockAudio } from '../../../helpers/mockAudio'

vi.mock('@/lib/api', () => ({
  createApiClient: vi.fn(() => ({
    getPodcast: vi.fn(),
  })),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public detail: string) {
      super(detail)
    }
  },
}))

// issue #167: オフライン保存ボタン用。既定は「未キャッシュ」に倒す。
// WHY the mock also stubs getCachedAudioUrl/getCachedPodcast (unused by this test file's
// assertions): AudioPlayerContext imports them from the same module, and a partial mock
// would leave them undefined — breaking the (real, unmocked) play flow these tests exercise.
const { isCached, downloadAudio, getCachedAudioUrl, getCachedPodcast } = vi.hoisted(() => ({
  isCached: vi.fn().mockResolvedValue(false),
  downloadAudio: vi.fn().mockResolvedValue(undefined),
  getCachedAudioUrl: vi.fn().mockResolvedValue(null),
  getCachedPodcast: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/audioCache', () => ({ isCached, downloadAudio, getCachedAudioUrl, getCachedPodcast }))

const SAMPLE_PODCAST = {
  id: 'p1',
  type: 'single',
  article_ids: ['a1', 'a2'],
  difficulty: 'ielts_7',
  audio_url: 'https://storage.example.com/audio.mp3',
  japanese_intro_text: 'これは日本語のイントロ全文です。詳細ページではすべてのテキストが表示されます。追加のテキストも含まれています。',
  duration_seconds: 1820,
  created_at: '2026-06-10T09:00:00+09:00',
  status: 'completed' as const,
  error_message: null,
  playback_position_seconds: 0,
}

let mockAudio: MockAudio

beforeEach(() => {
  vi.clearAllMocks()
  // WHY reset here (not rely on vi.clearAllMocks): clearAllMocks wipes call history but
  // keeps whatever resolved value a previous test's mockResolvedValue() left behind.
  isCached.mockResolvedValue(false)
  downloadAudio.mockResolvedValue(undefined)
  localStorage.clear()
  mockAudio = setupMockAudio()
})

function renderDetailPage(params = { id: 'p1' }) {
  return render(
    <AppProvider>
      <ToastProvider>
        <AudioPlayerProvider>
          <PodcastDetailPage params={Promise.resolve(params)} />
        </AudioPlayerProvider>
      </ToastProvider>
    </AppProvider>
  )
}

// ==========================================================
// Podcast 詳細 — 正常系
// ==========================================================
describe('PodcastDetailPage — normal', () => {
  test('Displays full japanese_intro_text (not truncated)', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcast: vi.fn().mockResolvedValue(SAMPLE_PODCAST),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      // 全文が表示されていること（詳細ページでは80文字制限なし）
      expect(screen.getByText(/追加のテキストも含まれています/)).toBeInTheDocument()
    })
  })

  test('Displays difficulty badge', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcast: vi.fn().mockResolvedValue(SAMPLE_PODCAST),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByText(/IELTS 7/)).toBeInTheDocument()
    })
  })

  test('Displays formatted duration', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcast: vi.fn().mockResolvedValue(SAMPLE_PODCAST),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      // 1820秒 → 30:20
      expect(screen.getByText(/30:20/)).toBeInTheDocument()
    })
  })

  test('Displays article IDs', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcast: vi.fn().mockResolvedValue(SAMPLE_PODCAST),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByText(/a1/)).toBeInTheDocument()
    })
  })

  test('Has a back link to the podcast list (/podcast)', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcast: vi.fn().mockResolvedValue(SAMPLE_PODCAST),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /一覧へ戻る/ })).toHaveAttribute('href', '/podcast')
    })
  })

  test('Has a play button', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcast: vi.fn().mockResolvedValue(SAMPLE_PODCAST),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /再生|play/i })).toBeInTheDocument()
    })
  })
})

// ==========================================================
// Podcast 詳細 — 再生フロー (spec §9 L151 / §10.3 L209)
// ==========================================================
describe('PodcastDetailPage — play flow', () => {
  test('handlePlay re-fetches fresh podcast via getPodcast (spec §9 L151: signed-URL must not be reused)', async () => {
    const getPodcastMock = vi.fn().mockResolvedValue(SAMPLE_PODCAST)
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({ getPodcast: getPodcastMock } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    // Wait for initial page load (first getPodcast call)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /再生|play/i })).toBeInTheDocument()
    })

    // Click play — triggers second getPodcast call for fresh signed URL
    await userEvent.click(screen.getByRole('button', { name: /再生|play/i }))

    // getPodcast must have been called at least twice: page load + play button
    await waitFor(() => {
      expect(getPodcastMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
  })

  test('handlePlay restores saved playback position from localStorage (spec §10.3 L201)', async () => {
    localStorage.setItem('podcast_position:p1', JSON.stringify(90))

    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcast: vi.fn().mockResolvedValue(SAMPLE_PODCAST),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /再生|play/i })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: /再生|play/i }))

    // Audio currentTime should reflect saved position 90, not 0
    await waitFor(() => {
      expect(mockAudio.currentTime).toBe(90)
    })
  })
})

// ==========================================================
// Podcast 詳細 — トランスクリプト表示 (issue #162)
// ==========================================================
describe('PodcastDetailPage — transcript', () => {
  test('Given segments, displays each speaker label and text', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcast: vi.fn().mockResolvedValue({
        ...SAMPLE_PODCAST,
        segments: [
          { speaker: 'A', text: 'Good morning, everyone.' },
          { speaker: 'B', text: 'Thanks for joining us today.' },
        ],
      }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByText('Good morning, everyone.')).toBeInTheDocument()
      expect(screen.getByText('Thanks for joining us today.')).toBeInTheDocument()
    })
    // 話者ラベルはA/Bそれぞれ1件ずつ表示される
    expect(screen.getAllByText('A')).toHaveLength(1)
    expect(screen.getAllByText('B')).toHaveLength(1)
  })

  test('Given segments is null, shows fallback message without crashing and keeps existing content', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcast: vi.fn().mockResolvedValue({ ...SAMPLE_PODCAST, segments: null }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByText(/トランスクリプトはありません/)).toBeInTheDocument()
    })
    // 既存表示（イントロ・再生ボタン）が壊れていないこと（回帰なし）
    expect(screen.getByText(/追加のテキストも含まれています/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /再生|play/i })).toBeInTheDocument()
  })

  test('Given segments field is entirely missing (legacy episode), shows fallback without crashing', async () => {
    const { createApiClient } = await import('@/lib/api')
    // segments フィールド自体が欠落した旧データを模擬
    vi.mocked(createApiClient).mockReturnValue({
      getPodcast: vi.fn().mockResolvedValue({ ...SAMPLE_PODCAST }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByText(/トランスクリプトはありません/)).toBeInTheDocument()
    })
  })
})

// ==========================================================
// Podcast 詳細 — 404
// ==========================================================
describe('PodcastDetailPage — 404', () => {
  test('Given 404, shows "エピソードが見つかりません" and link to list', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcast: vi.fn().mockRejectedValue(new ApiError(404, 'Podcast not found')),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage({ id: 'missing' })

    await waitFor(() => {
      expect(screen.getByText(/エピソードが見つかりません/)).toBeInTheDocument()
    })

    // 一覧へ戻るリンクが存在する
    expect(screen.getByRole('link', { name: /一覧|戻る/i })).toHaveAttribute('href', '/podcast')
  })
})

// ==========================================================
// Podcast 詳細 — オフライン保存（issue #167）
// ==========================================================
describe('PodcastDetailPage — offline download (issue #167)', () => {
  test('shows an オフライン保存 button once the episode is loaded (not yet cached)', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcast: vi.fn().mockResolvedValue(SAMPLE_PODCAST),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'オフライン保存' })).toBeInTheDocument()
    })
  })

  test('clicking it downloads the audio and switches to a "保存済み" state', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcast: vi.fn().mockResolvedValue(SAMPLE_PODCAST),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()
    await waitFor(() => screen.getByRole('button', { name: 'オフライン保存' }))

    await userEvent.click(screen.getByRole('button', { name: 'オフライン保存' }))

    expect(downloadAudio).toHaveBeenCalledWith('p1')
    await waitFor(() => {
      expect(screen.getByText('保存済み')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'オフライン保存' })).not.toBeInTheDocument()
    })
  })

  test('shows "保存済み" immediately when the episode is already cached (no re-download)', async () => {
    isCached.mockResolvedValue(true)
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcast: vi.fn().mockResolvedValue(SAMPLE_PODCAST),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByText('保存済み')).toBeInTheDocument()
    })
    expect(downloadAudio).not.toHaveBeenCalled()
  })

  test('given the download fails, shows an error toast and keeps the button retryable', async () => {
    downloadAudio.mockRejectedValueOnce(new Error('network error'))
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcast: vi.fn().mockResolvedValue(SAMPLE_PODCAST),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()
    await waitFor(() => screen.getByRole('button', { name: 'オフライン保存' }))

    await userEvent.click(screen.getByRole('button', { name: 'オフライン保存' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/オフライン保存に失敗しました/)
    })
    // 失敗時は保存済みにならず、再試行できる
    expect(screen.getByRole('button', { name: 'オフライン保存' })).toBeInTheDocument()
  })
})
