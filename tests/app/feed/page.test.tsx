import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import FeedPage from '@/app/feed/page'
import { AppProvider } from '@/contexts/AppContext'
import { ToastProvider } from '@/components/ui/Toast'

vi.mock('@/lib/api', () => ({
  createApiClient: vi.fn(() => ({
    getFeed: vi.fn(),
    starArticle: vi.fn(),
    dismissArticle: vi.fn(),
  })),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public detail: string) {
      super(detail)
    }
  },
}))

const SAMPLE_ARTICLES = [
  {
    id: 'a1',
    title: 'TypeScript 5.5 Released',
    url: 'https://devblogs.microsoft.com/typescript',
    source: 'Microsoft Blog',
    score: 0.95,
    published_at: '2026-06-10T09:00:00+09:00',
  },
  {
    id: 'a2',
    title: 'Next.js 15 Features',
    url: 'https://nextjs.org/blog',
    source: 'Next.js Blog',
    score: 0.80,
    published_at: '2026-06-10T08:00:00+09:00',
  },
]

function renderFeedPage() {
  return render(
    <AppProvider initialState={{
      isConfigured: true,
      baseUrl: 'https://api.example.com',
      apiKey: 'test-key',
    }}>
      <ToastProvider>
        <FeedPage />
      </ToastProvider>
    </AppProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ==========================================================
// Feed 画面 — データ取得・表示
// ==========================================================
describe('FeedPage — data fetching', () => {
  test('Given loading state, displays SkeletonCard', async () => {
    const { createApiClient } = await import('@/lib/api')
    createApiClient.mockReturnValue({
      getFeed: vi.fn(() => new Promise(() => {})), // never resolves
      starArticle: vi.fn(),
      dismissArticle: vi.fn(),
    })

    renderFeedPage()
    expect(screen.getByTestId('skeleton-card')).toBeInTheDocument()
  })

  test('Given articles returned, renders article cards', async () => {
    const { createApiClient } = await import('@/lib/api')
    createApiClient.mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle: vi.fn(),
      dismissArticle: vi.fn(),
    })

    renderFeedPage()

    await waitFor(() => {
      expect(screen.getByText('TypeScript 5.5 Released')).toBeInTheDocument()
      expect(screen.getByText('Next.js 15 Features')).toBeInTheDocument()
    })
  })

  test('Given empty articles array, displays empty state message', async () => {
    const { createApiClient } = await import('@/lib/api')
    createApiClient.mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: [], date: '2026-06-10' }),
      starArticle: vi.fn(),
      dismissArticle: vi.fn(),
    })

    renderFeedPage()

    await waitFor(() => {
      expect(screen.getByText(/まだ記事がありません/)).toBeInTheDocument()
      expect(screen.getByText(/06:00/)).toBeInTheDocument()
    })
  })
})

// ==========================================================
// Feed 画面 — Star 操作
// ==========================================================
describe('FeedPage — Star', () => {
  test('Given star succeeds, shows toast "Star しました" and keeps card in list', async () => {
    const starArticle = vi.fn().mockResolvedValue({ status: 'starred', article_id: 'a1' })
    const { createApiClient } = await import('@/lib/api')
    createApiClient.mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle,
      dismissArticle: vi.fn(),
    })

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await userEvent.click(screen.getAllByRole('button', { name: /star|★/i })[0])

    await waitFor(() => {
      expect(screen.getByText(/Star しました/)).toBeInTheDocument()
    })
    // カードはリストに残る
    expect(screen.getByText('TypeScript 5.5 Released')).toBeInTheDocument()
  })

  test('Given star returns 404, shows "記事が見つかりません" toast and removes card', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    createApiClient.mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle: vi.fn().mockRejectedValue(new ApiError(404, 'Article not found')),
      dismissArticle: vi.fn(),
    })

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await userEvent.click(screen.getAllByRole('button', { name: /star|★/i })[0])

    await waitFor(() => {
      expect(screen.getByText(/記事が見つかりません/)).toBeInTheDocument()
    })
  })

  test('Given star returns 401, shows API key error toast', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    createApiClient.mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle: vi.fn().mockRejectedValue(new ApiError(401, 'Invalid or missing API key')),
      dismissArticle: vi.fn(),
    })

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await userEvent.click(screen.getAllByRole('button', { name: /star|★/i })[0])

    await waitFor(() => {
      expect(screen.getByText(/API キー/)).toBeInTheDocument()
    })
  })
})

// ==========================================================
// Feed 画面 — Dismiss 操作
// ==========================================================
describe('FeedPage — Dismiss', () => {
  test('Given dismiss succeeds, removes card from list immediately', async () => {
    const { createApiClient } = await import('@/lib/api')
    createApiClient.mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle: vi.fn(),
      dismissArticle: vi.fn().mockResolvedValue({ status: 'dismissed', article_id: 'a1' }),
    })

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await userEvent.click(screen.getAllByRole('button', { name: /dismiss|×|非表示/i })[0])

    await waitFor(() => {
      expect(screen.queryByText('TypeScript 5.5 Released')).not.toBeInTheDocument()
    })
  })
})

// ==========================================================
// Feed 画面 — リフレッシュボタン
// ==========================================================
describe('FeedPage — Refresh', () => {
  test('Given refresh button clicked, calls getFeed again', async () => {
    const getFeed = vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' })
    const { createApiClient } = await import('@/lib/api')
    createApiClient.mockReturnValue({
      getFeed,
      starArticle: vi.fn(),
      dismissArticle: vi.fn(),
    })

    renderFeedPage()
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    await userEvent.click(screen.getByRole('button', { name: /リフレッシュ|更新|refresh/i }))

    expect(getFeed).toHaveBeenCalledTimes(2)
  })
})

// ==========================================================
// Feed 画面 — ネットワークエラー
// ==========================================================
describe('FeedPage — Network error', () => {
  test('Given network error (status=0), shows "サーバーに接続できません"', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    createApiClient.mockReturnValue({
      getFeed: vi.fn().mockRejectedValue(new ApiError(0, 'Network error')),
      starArticle: vi.fn(),
      dismissArticle: vi.fn(),
    })

    renderFeedPage()

    await waitFor(() => {
      expect(screen.getByText(/サーバーに接続できません/)).toBeInTheDocument()
    })
  })
})
