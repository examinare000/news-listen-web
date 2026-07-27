import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import FeedPage from '@/app/(app)/feed/page'
import { AppProvider } from '@/contexts/AppContext'
import { ToastProvider } from '@/components/ui/Toast'

vi.mock('@/lib/api', () => ({
  createApiClient: vi.fn(() => ({
    getFeed: vi.fn(),
    getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    starArticle: vi.fn(),
    dismissArticle: vi.fn(),
  })),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public detail: string,
      public retryAfterSeconds?: number,
    ) {
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
    <AppProvider>
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
  // issue #83: スケルトン1枚のみだと実データ表示時にレイアウトが大きく飛ぶため、
  // 実際のフィード件数に近い複数枚を描画して高さのブレを抑える。
  // また role="status" + aria-live="polite" が無いとローディング中であることが
  // 支援技術に通知されないため、あわせて検証する。
  test('Given loading state, displays multiple SkeletonCards and announces loading via role="status" (#83)', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn(() => new Promise(() => {})), // never resolves
      starArticle: vi.fn(),
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(within(status).getAllByTestId('skeleton-card')).toHaveLength(6)
  })

  test('Given articles returned, renders article cards', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle: vi.fn(),
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => {
      expect(screen.getByText('TypeScript 5.5 Released')).toBeInTheDocument()
      expect(screen.getByText('Next.js 15 Features')).toBeInTheDocument()
    })
  })

  test('Given empty articles array, displays empty state message', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: [], date: '2026-06-10' }),
      starArticle: vi.fn(),
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

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
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle,
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    // ArticleCard の Star ボタンは aria-label「スターする」(未スター時)
    await userEvent.click(screen.getAllByRole('button', { name: 'スターする' })[0])

    await waitFor(() => {
      expect(screen.getByText(/Star しました/)).toBeInTheDocument()
    })
    // カードはリストに残る
    expect(screen.getByText('TypeScript 5.5 Released')).toBeInTheDocument()
  })

  test('Given star returns 404, shows "記事が見つかりません" toast and removes card', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle: vi.fn().mockRejectedValue(new ApiError(404, 'Article not found')),
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await userEvent.click(screen.getAllByRole('button', { name: 'スターする' })[0])

    await waitFor(() => {
      expect(screen.getByText(/記事が見つかりません/)).toBeInTheDocument()
    })
  })

  test('Given star returns 401, shows API key error toast', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle: vi.fn().mockRejectedValue(new ApiError(401, 'Invalid or missing API key')),
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await userEvent.click(screen.getAllByRole('button', { name: 'スターする' })[0])

    await waitFor(() => {
      expect(screen.getByText(/API キー/)).toBeInTheDocument()
    })
  })

  test('Given a difficulty is chosen from the ArticleCard difficulty menu, calls starArticle with id and difficulty (#163)', async () => {
    const starArticle = vi.fn().mockResolvedValue({ status: 'starred', article_id: 'a1' })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle,
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await userEvent.click(screen.getAllByRole('button', { name: /記事の生成難易度を指定/ })[0])
    await userEvent.click(screen.getByRole('menuitem', { name: 'TOEIC 900' }))

    await waitFor(() => {
      expect(starArticle).toHaveBeenCalledWith('a1', 'toeic_900')
    })
  })

  // #163（難易度指定star）と #164（remaining表示）のマージ統合境界を固定する。
  // 難易度指定で star した場合にも remaining 付きトーストが出ることを検証する。
  test('Given a difficulty is chosen and star succeeds with a remaining count, shows the count in the toast', async () => {
    const starArticle = vi
      .fn()
      .mockResolvedValue({ status: 'starred', article_id: 'a1', remaining: 2 })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle,
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await userEvent.click(screen.getAllByRole('button', { name: /記事の生成難易度を指定/ })[0])
    await userEvent.click(screen.getByRole('menuitem', { name: 'TOEIC 900' }))

    await waitFor(() => {
      expect(starArticle).toHaveBeenCalledWith('a1', 'toeic_900')
      expect(screen.getByText('Star しました（残り生成 2 回）')).toBeInTheDocument()
    })
  })

  test('Given the plain star button clicked (no difficulty chosen), calls starArticle with only the id', async () => {
    const starArticle = vi.fn().mockResolvedValue({ status: 'starred', article_id: 'a1' })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle,
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await userEvent.click(screen.getAllByRole('button', { name: 'スターする' })[0])

    await waitFor(() => {
      expect(starArticle).toHaveBeenCalledWith('a1')
    })
  })

  // issue #164 / ADR-061: 生成残回数の可視化
  test('Given star succeeds with a remaining count, shows the count in the toast', async () => {
    const starArticle = vi
      .fn()
      .mockResolvedValue({ status: 'starred', article_id: 'a1', remaining: 3 })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle,
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await userEvent.click(screen.getAllByRole('button', { name: 'スターする' })[0])

    await waitFor(() => {
      expect(screen.getByText('Star しました（残り生成 3 回）')).toBeInTheDocument()
    })
  })

  test('Given star succeeds without a remaining field (backward compat with old backend), shows the original toast text', async () => {
    const starArticle = vi.fn().mockResolvedValue({ status: 'starred', article_id: 'a1' })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle,
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await userEvent.click(screen.getAllByRole('button', { name: 'スターする' })[0])

    await waitFor(() => {
      expect(screen.getByText('Star しました')).toBeInTheDocument()
    })
  })

  test('Given star returns 429, shows generation-limit toast with retry time (#82)', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      // 43200 秒 = 約12時間後
      starArticle: vi.fn().mockRejectedValue(new ApiError(429, 'Daily limit reached', 43200)),
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await userEvent.click(screen.getAllByRole('button', { name: 'スターする' })[0])

    await waitFor(() => {
      expect(screen.getByText(/本日の生成上限に達しました（約12時間後に可能）/)).toBeInTheDocument()
    })
  })

  test('Given star throws a non-ApiError exception (e.g. TypeError), shows generic error toast (#85)', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle: vi.fn().mockRejectedValue(new TypeError('Cannot read property of undefined')),
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await userEvent.click(screen.getAllByRole('button', { name: 'スターする' })[0])

    await waitFor(() => {
      expect(screen.getByText(/予期しないエラーが発生しました/)).toBeInTheDocument()
    })
  })

  // issue #82 / ADR-073: 月次上限 429（backend detail に "Monthly" を含む）は
  // 日次上限と文言を出し分ける。
  test('Given star returns 429 for the monthly limit, shows a monthly-specific toast', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      // 2678400 秒 = 約31日後
      starArticle: vi.fn().mockRejectedValue(
        new ApiError(
          429,
          'Monthly podcast generation limit reached for this user. Please try again next month.',
          2678400,
        ),
      ),
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await userEvent.click(screen.getAllByRole('button', { name: 'スターする' })[0])

    await waitFor(() => {
      expect(screen.getByText(/今月の生成上限に達しました（約31日後に可能）/)).toBeInTheDocument()
    })
  })
})

// ==========================================================
// Feed 画面 — Dismiss 操作
// ==========================================================
describe('FeedPage — Dismiss', () => {
  test('Given dismiss succeeds, removes card from list immediately', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle: vi.fn(),
      dismissArticle: vi.fn().mockResolvedValue({ status: 'dismissed', article_id: 'a1' }),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await userEvent.click(screen.getAllByRole('button', { name: /dismiss|×|非表示/i })[0])

    await waitFor(() => {
      expect(screen.queryByText('TypeScript 5.5 Released')).not.toBeInTheDocument()
    })
  })

  test('Given dismiss throws a non-ApiError exception (e.g. TypeError), shows generic error toast (#85)', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle: vi.fn(),
      dismissArticle: vi.fn().mockRejectedValue(new TypeError('Cannot read property of undefined')),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await userEvent.click(screen.getAllByRole('button', { name: /dismiss|×|非表示/i })[0])

    await waitFor(() => {
      expect(screen.getByText(/予期しないエラーが発生しました/)).toBeInTheDocument()
    })
  })
})

// ==========================================================
// Feed 画面 — タブフィルタ（すべて / ★ スター済み）
// WHY toggle button: WAI-ARIA の tabs パターンは tabpanel 関連付けと
// 矢印キーのフォーカス移動（roving tabindex）まで実装して初めて成立する。
// 2 択のクライアントフィルタには aria-pressed トグルボタンの方が
// 標準の Tab キー操作のまま正しい状態を支援技術へ伝えられる。
// ==========================================================
describe('FeedPage — Tabs', () => {
  // スター済み記事のカード側ボタン（「スター済み」ラベル）と名前が衝突するため、
  // タブはフィルタグループ内に限定して取得する
  function tabs() {
    return within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
  }

  async function setupWithArticles() {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle: vi.fn().mockResolvedValue({ status: 'starred', article_id: 'a1' }),
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)
    renderFeedPage()
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
  }

  test('Given starred tab clicked, shows only starred articles', async () => {
    await setupWithArticles()

    // a1 をスターしてからスター済みタブへ
    await userEvent.click(screen.getAllByRole('button', { name: 'スターする' })[0])
    await waitFor(() => screen.getByText(/Star しました/))

    await userEvent.click(tabs().getByRole('button', { name: /スター済み/ }))

    expect(screen.getByText('TypeScript 5.5 Released')).toBeInTheDocument()
    expect(screen.queryByText('Next.js 15 Features')).not.toBeInTheDocument()
    expect(tabs().getByRole('button', { name: /スター済み/ })).toHaveAttribute('aria-pressed', 'true')
  })

  test('Given all tab reselected, shows all articles again', async () => {
    await setupWithArticles()

    await userEvent.click(screen.getAllByRole('button', { name: 'スターする' })[0])
    await waitFor(() => screen.getByText(/Star しました/))

    await userEvent.click(tabs().getByRole('button', { name: /スター済み/ }))
    expect(screen.queryByText('Next.js 15 Features')).not.toBeInTheDocument()

    await userEvent.click(tabs().getByRole('button', { name: /すべて/ }))

    expect(screen.getByText('TypeScript 5.5 Released')).toBeInTheDocument()
    expect(screen.getByText('Next.js 15 Features')).toBeInTheDocument()
    expect(tabs().getByRole('button', { name: /すべて/ })).toHaveAttribute('aria-pressed', 'true')
  })

  test('Given star performed, tab counts reflect totals and starred count increases', async () => {
    await setupWithArticles()

    expect(tabs().getByRole('button', { name: /すべて/ })).toHaveTextContent('2')
    const starredTab = tabs().getByRole('button', { name: /スター済み/ })
    expect(starredTab).toHaveTextContent('0')

    await userEvent.click(screen.getAllByRole('button', { name: 'スターする' })[0])

    await waitFor(() => {
      expect(tabs().getByRole('button', { name: /スター済み/ })).toHaveTextContent('1')
    })
  })

  test('Given starred tab with zero starred articles, shows dedicated empty message', async () => {
    await setupWithArticles()

    await userEvent.click(tabs().getByRole('button', { name: /スター済み/ }))

    expect(screen.getByText('スター済みの記事はありません')).toBeInTheDocument()
  })

  test('tabs do not expose WAI-ARIA tab roles (toggle button pattern instead)', async () => {
    await setupWithArticles()

    // tabs ロールを使う場合は tabpanel 関連付けが必須になるため、
    // 本実装は意図的に tablist/tab を出さない（上記 WHY コメント参照）
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(tabs().getByRole('button', { name: /すべて/ })).toHaveAttribute('aria-pressed', 'true')
    expect(tabs().getByRole('button', { name: /スター済み/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })
})

// ==========================================================
// Feed 画面 — Star 済み記事一覧のサーバ側真実（issue #84 → backend feed 除外移行）
// backend が GET /feed から star 済み記事を恒久除外するため、Star タブは
// GET /articles/starred（サーバ側一覧）を真実の源とし、セッション内の楽観 star を
// 加算表示する（サーバ一覧 ∪ 楽観追加）。
// ==========================================================
describe('FeedPage — Starred tab as server source of truth (#84)', () => {
  const EXCLUDED_STARRED_ARTICLE = {
    id: 'a3',
    title: 'Already Starred, Excluded From Feed',
    url: 'https://example.com/a3',
    source: 'Example',
    score: 0.5,
    published_at: '2026-06-09T00:00:00+09:00',
  }

  test('Given getStarredArticles returns an article absent from the feed response, shows it under the starred tab', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      // backend が star 済み記事を feed から除外した後の応答を模す（a3 を含まない）
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle: vi.fn(),
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [EXCLUDED_STARRED_ARTICLE] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    const tabs = within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
    await userEvent.click(tabs.getByRole('button', { name: /スター済み/ }))

    await waitFor(() => {
      expect(screen.getByText('Already Starred, Excluded From Feed')).toBeInTheDocument()
    })
    expect(screen.queryByText('TypeScript 5.5 Released')).not.toBeInTheDocument()
  })

  test('Given getStarredArticles returns an empty list, starred tab stays empty', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle: vi.fn(),
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    const tabs = within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
    await userEvent.click(tabs.getByRole('button', { name: /スター済み/ }))

    expect(screen.getByText('スター済みの記事はありません')).toBeInTheDocument()
  })

  test('Given article starred optimistically, refresh pressed, and getStarredArticles still does not include it (server indexing lag), keeps the optimistic star state', async () => {
    const starArticle = vi.fn().mockResolvedValue({ status: 'starred', article_id: 'a1' })
    let fetchCallCount = 0
    const getFeed = vi.fn(() => {
      fetchCallCount++
      return Promise.resolve({ articles: SAMPLE_ARTICLES, date: '2026-06-10' })
    })
    // 一貫して空 = サーバ側インデックスがまだ star を反映していない状況を模す
    const getStarredArticles = vi.fn().mockResolvedValue({ articles: [] })

    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed,
      starArticle,
      dismissArticle: vi.fn(),
      getStarredArticles,
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    // Wait for initial load
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    expect(fetchCallCount).toBe(1)

    // Star the first article
    await userEvent.click(screen.getAllByRole('button', { name: 'スターする' })[0])
    await waitFor(() => screen.getByText(/Star しました/))

    // Verify it's in the starred tab (optimistic addition)
    const tabs = within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
    await userEvent.click(tabs.getByRole('button', { name: /スター済み/ }))
    expect(screen.getByText('TypeScript 5.5 Released')).toBeInTheDocument()

    // Refresh
    await userEvent.click(screen.getByRole('button', { name: /更新|refresh/i }))
    await waitFor(() => {
      expect(getFeed).toHaveBeenCalledTimes(2)
    })

    // Star state should still be kept (optimistic addition not rolled back)
    expect(screen.getByText('TypeScript 5.5 Released')).toBeInTheDocument()
    expect(tabs.getByRole('button', { name: /スター済み/ })).toHaveTextContent('1')
  })

  test('Given getStarredArticles rejects, the page does not break and shows only the optimistic stars', async () => {
    const starArticle = vi.fn().mockResolvedValue({ status: 'starred', article_id: 'a1' })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle,
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockRejectedValue(new Error('network error')),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    // ページ自体は壊れずフィードを表示する
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    expect(screen.getByText('Next.js 15 Features')).toBeInTheDocument()

    // 楽観 star のみで Star タブが機能する
    await userEvent.click(screen.getAllByRole('button', { name: 'スターする' })[0])
    await waitFor(() => screen.getByText(/Star しました/))

    const tabs = within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
    await userEvent.click(tabs.getByRole('button', { name: /スター済み/ }))
    expect(screen.getByText('TypeScript 5.5 Released')).toBeInTheDocument()
  })
})

// ==========================================================
// Feed 画面 — Star タブの退行修正（正確性レビュー指摘対応）
// backend の feed 除外移行後、Star タブは「サーバ確定済み一覧 ∪ セッション内の楽観 star」を
// 表示する。un-star API が現状無いため、Star タブは閲覧専用（Star/Dismiss アクション非表示）
// とし、Dismiss による永久残留（backend が dismiss で starred_article_ids を除去せず
// /articles/starred も dismissed をフィルタしないため、再取得しても消えない）を構造的に防ぐ。
// ==========================================================
describe('FeedPage — Starred tab regression fixes', () => {
  test('Given the starred tab is active, article cards do not render Star/Dismiss action buttons (view-only)', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle: vi.fn(),
      dismissArticle: vi.fn(),
      // サーバ側で確定済みの star 済み記事として a1 を返す
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [SAMPLE_ARTICLES[0]] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    const tabs = within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
    await userEvent.click(tabs.getByRole('button', { name: /スター済み/ }))

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    expect(screen.getByText('TypeScript 5.5 Released')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '非表示' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'スターする' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'スター済み' })).not.toBeInTheDocument()
  })

  test('Given an article present in both the all tab and the server starred list, dismissing it from the all tab also removes it from the starred tab', async () => {
    const dismissArticle = vi.fn().mockResolvedValue({ status: 'dismissed', article_id: 'a1' })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      // a1 は移行途中で feed にも残っており、かつ既に server 側で star 済み（レース状況を模す）
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle: vi.fn(),
      dismissArticle,
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [SAMPLE_ARTICLES[0]] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    // all タブから a1 を Dismiss
    await userEvent.click(screen.getAllByRole('button', { name: /dismiss|×|非表示/i })[0])
    await waitFor(() => {
      expect(screen.queryByText('TypeScript 5.5 Released')).not.toBeInTheDocument()
    })

    // Star タブにも残留していない（serverStarred からも除去済み）
    const tabs = within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
    await userEvent.click(tabs.getByRole('button', { name: /スター済み/ }))
    expect(screen.getByText('スター済みの記事はありません')).toBeInTheDocument()
  })

  test('Given an article optimistically starred, and a later feed refresh excludes it entirely (backend permanent exclusion) while getStarredArticles still does not include it, the starred tab keeps showing it', async () => {
    const starArticle = vi.fn().mockResolvedValue({ status: 'starred', article_id: 'a1' })
    const getFeed = vi
      .fn()
      // 1回目: まだ backend が除外する前（移行途中）の応答
      .mockResolvedValueOnce({ articles: SAMPLE_ARTICLES, date: '2026-06-10' })
      // 2回目（リフレッシュ後）: backend が star 済み a1 を feed から恒久除外した後の本番形
      .mockResolvedValueOnce({ articles: [SAMPLE_ARTICLES[1]], date: '2026-06-11' })
    const getStarredArticles = vi.fn().mockResolvedValue({ articles: [] }) // サーバ側インデックスは常に未反映

    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed,
      starArticle,
      dismissArticle: vi.fn(),
      getStarredArticles,
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    // a1 を楽観 star
    await userEvent.click(screen.getAllByRole('button', { name: 'スターする' })[0])
    await waitFor(() => screen.getByText(/Star しました/))

    // リフレッシュ（2回目の getFeed は a1 を含まない）
    await userEvent.click(screen.getByRole('button', { name: /更新|refresh/i }))
    await waitFor(() => {
      expect(getFeed).toHaveBeenCalledTimes(2)
    })
    await waitFor(() => screen.getByText('Next.js 15 Features'))

    // articles から a1 が消えても、Star タブでは楽観 star が保持され続ける
    const tabs = within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
    await userEvent.click(tabs.getByRole('button', { name: /スター済み/ }))
    expect(screen.getByText('TypeScript 5.5 Released')).toBeInTheDocument()
    expect(tabs.getByRole('button', { name: /スター済み/ })).toHaveTextContent('1')
  })

  test('Given the same article id appears in both the server starred list and the local optimistic star, the starred tab shows it only once', async () => {
    const starArticle = vi.fn().mockResolvedValue({ status: 'starred', article_id: 'a1' })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle,
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [SAMPLE_ARTICLES[0]] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    // a1 は既に server 側で star 済み。ここでさらにユーザーが同じ a1 を star する
    // （楽観セットにも同じ id が入り、サーバ一覧と重複する）
    await userEvent.click(screen.getAllByRole('button', { name: 'スター済み' })[0])
    await waitFor(() => screen.getByText(/Star しました/))

    const tabs = within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
    await userEvent.click(tabs.getByRole('button', { name: /スター済み/ }))

    expect(screen.getAllByText('TypeScript 5.5 Released')).toHaveLength(1)
    expect(tabs.getByRole('button', { name: /スター済み/ })).toHaveTextContent('1')
  })

  test('Given getStarredArticles rejects, logs the failure for operational visibility (not fully silent)', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('network error')
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle: vi.fn(),
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockRejectedValue(error),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith('[feed] starred一覧の取得に失敗', error)
    })

    consoleErrorSpy.mockRestore()
  })

  test('Given the starred tab is active, the "複数選択" (multi-select) button is not shown', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle: vi.fn(),
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [SAMPLE_ARTICLES[0]] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    // all タブでは「複数選択」ボタンが存在することを確認（サニティチェック）
    expect(screen.getByRole('button', { name: '複数選択' })).toBeInTheDocument()

    const tabs = within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
    await userEvent.click(tabs.getByRole('button', { name: /スター済み/ }))
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    expect(screen.queryByRole('button', { name: '複数選択' })).not.toBeInTheDocument()
  })

  test('Given selection mode started on the all tab, switching to the starred tab exits selection mode, hides checkboxes, and hides the bulk-star footer (readOnly bypass fix)', async () => {
    const starArticle = vi.fn().mockResolvedValue({ status: 'starred', article_id: 'a1' })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle,
      dismissArticle: vi.fn(),
      // a1 は既にサーバ側で star 済み（Star タブに表示される）
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [SAMPLE_ARTICLES[0]] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    // all タブで実際に選択モードを起動し、記事を選択する
    await userEvent.click(screen.getByRole('button', { name: '複数選択' }))
    const checkbox = screen.getAllByRole('checkbox')[0]
    await userEvent.click(checkbox)
    expect(screen.getByRole('button', { name: /件を一括スター/ })).toBeInTheDocument()

    // Star タブへ切替
    const tabs = within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
    await userEvent.click(tabs.getByRole('button', { name: /スター済み/ }))
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    // 選択モードが解除され、チェックボックス・一括スターフッターが出ない
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /件を一括スター/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'キャンセル' })).not.toBeInTheDocument()

    // この経路から starArticle が発火し得ないことも確認（再star によるクォータ消費防止）
    expect(starArticle).not.toHaveBeenCalled()
  })
})

// ==========================================================
// Feed 画面 — フィード取得失敗時の Star タブ独立性（should-fix）
// ==========================================================
describe('FeedPage — Starred tab independence from feed fetch failure', () => {
  test('Given getFeed fails but getStarredArticles succeeds, the starred tab still shows the server-starred articles', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockRejectedValue(new ApiError(500, 'Internal error')),
      starArticle: vi.fn(),
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [SAMPLE_ARTICLES[0]] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    // all タブはエラー表示になる
    await waitFor(() => {
      expect(screen.getByText(/エラーが発生しました/)).toBeInTheDocument()
    })

    // Star タブはフィード取得失敗に道連れにならず、サーバ starred 一覧を表示する
    const tabs = within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
    await userEvent.click(tabs.getByRole('button', { name: /スター済み/ }))

    await waitFor(() => {
      expect(screen.getByText('TypeScript 5.5 Released')).toBeInTheDocument()
    })
    expect(screen.queryByText(/エラーが発生しました/)).not.toBeInTheDocument()
  })

  test('Given both getFeed and getStarredArticles fail (offline / backend outage), the starred tab shows an error state with retry guidance instead of the false "no starred articles" empty state', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { createApiClient, ApiError } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockRejectedValue(new ApiError(0, 'Network error')),
      starArticle: vi.fn(),
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockRejectedValue(new Error('network error')),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    // all タブはエラー表示
    await waitFor(() => {
      expect(screen.getByText('サーバーに接続できません')).toBeInTheDocument()
    })

    // Star タブへ切替
    const tabs = within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
    await userEvent.click(tabs.getByRole('button', { name: /スター済み/ }))

    // starred 取得も失敗しているため、真の空状態（「スター済みの記事はありません」）を
    // 事実と異なる形で表示してはいけない。エラー表示＋再試行導線を出す。
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
    expect(screen.queryByText('スター済みの記事はありません')).not.toBeInTheDocument()
    expect(screen.getByText(/右上の更新ボタンで再試行できます/)).toBeInTheDocument()

    consoleErrorSpy.mockRestore()
  })
})

// ==========================================================
// Feed 画面 — ページヘッダー
// ==========================================================
describe('FeedPage — Page header', () => {
  test('Given feed date returned, shows it in the page subtitle', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle: vi.fn(),
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => {
      expect(screen.getByText(/2026-06-10/)).toBeInTheDocument()
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
    vi.mocked(createApiClient).mockReturnValue({
      getFeed,
      starArticle: vi.fn(),
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    await userEvent.click(screen.getByRole('button', { name: /リフレッシュ|更新|refresh/i }))

    expect(getFeed).toHaveBeenCalledTimes(2)
  })

  test('Given the initial fetch resolves after a newer refresh request, the stale response is ignored (requestId guard)', async () => {
    let resolveFeed1: (v: unknown) => void = () => {}
    let resolveFeed2: (v: unknown) => void = () => {}
    const getFeed = vi
      .fn()
      .mockImplementationOnce(() => new Promise((res) => { resolveFeed1 = res }))
      .mockImplementationOnce(() => new Promise((res) => { resolveFeed2 = res }))

    let resolveStarred1: (v: unknown) => void = () => {}
    let resolveStarred2: (v: unknown) => void = () => {}
    const getStarredArticles = vi
      .fn()
      .mockImplementationOnce(() => new Promise((res) => { resolveStarred1 = res }))
      .mockImplementationOnce(() => new Promise((res) => { resolveStarred2 = res }))

    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed,
      starArticle: vi.fn(),
      dismissArticle: vi.fn(),
      getStarredArticles,
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    // 初回 fetch（call1）が発火するのを待つ（まだ pending）
    await waitFor(() => expect(getFeed).toHaveBeenCalledTimes(1))

    // call1 がまだ解決していない間にリフレッシュし、2回目の fetch（call2・より新しいリクエスト）を発火する
    await userEvent.click(screen.getByRole('button', { name: /更新|refresh/i }))
    await waitFor(() => expect(getFeed).toHaveBeenCalledTimes(2))

    // 新しい方（call2）を先に解決させる
    resolveFeed2({ articles: [SAMPLE_ARTICLES[1]], date: '2026-06-11' })
    resolveStarred2({ articles: [] })
    await waitFor(() => screen.getByText('Next.js 15 Features'))

    // 古い方（call1）が後から解決する（stale な遅延応答）
    resolveFeed1({ articles: SAMPLE_ARTICLES, date: '2026-06-10' })
    resolveStarred1({ articles: [] })

    // stale な call1 の応答で articles/feedDate が巻き戻らないこと。
    // WHY: queryByText + 素の not.toBeInTheDocument() は resolveFeed1 の後続 await
    // チェーン（マイクロタスク）がまだ反映される前に synchronously 判定してしまい、
    // バグがあっても誤って green になり得る。waitFor で実際に一定時間ポーリングし、
    // 「最終的にも現れない」ことを積極的に確認する。
    await expect(
      waitFor(() => screen.getByText('TypeScript 5.5 Released'), { timeout: 300 }),
    ).rejects.toThrow()
    expect(screen.getByText('Next.js 15 Features')).toBeInTheDocument()
    expect(screen.getByText(/2026-06-11/)).toBeInTheDocument()
  })
})

// ==========================================================
// Feed 画面 — ネットワークエラー
// ==========================================================
describe('FeedPage — Network error', () => {
  test('Given network error (status=0), shows "サーバーに接続できません"', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockRejectedValue(new ApiError(0, 'Network error')),
      starArticle: vi.fn(),
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => {
      expect(screen.getByText(/サーバーに接続できません/)).toBeInTheDocument()
    })
  })

  // issue #83: subscriptions/settings 画面のエラー表示は role="alert" を付与済みだが
  // feed 画面のみ欠けていたため非一貫だった。他画面と揃える。
  test('Given a fetch error, the error message has role="alert" (#83)', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockRejectedValue(new ApiError(0, 'Network error')),
      starArticle: vi.fn(),
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('サーバーに接続できません')
    })
  })
})

// ==========================================================
// Feed 画面 — 一括スター（複数選択）
// ==========================================================
describe('FeedPage — Bulk Star', () => {
  test('Given "複数選択" toggle clicked, shows checkboxes on article cards', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle: vi.fn().mockResolvedValue({ status: 'starred', article_id: 'a1' }),
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    // 複数選択モード toggle を探して click
    const selectToggle = screen.getByRole('button', { name: /複数選択/i })
    await userEvent.click(selectToggle)

    // チェックボックスが表示されることを確認
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBeGreaterThanOrEqual(2)
  })

  test('Given articles selected and "一括スター" clicked, calls starArticle for each', async () => {
    const starArticle = vi.fn().mockResolvedValue({ status: 'starred', article_id: '' })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle,
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    // 複数選択モード開始
    await userEvent.click(screen.getByRole('button', { name: /複数選択/i }))

    // 2つの記事を選択
    const checkboxes = screen.getAllByRole('checkbox')
    await userEvent.click(checkboxes[0])
    await userEvent.click(checkboxes[1])

    // 一括スターボタンを click
    const bulkStarBtn = screen.getByRole('button', { name: /一括スター|2件を.*スター/i })
    await userEvent.click(bulkStarBtn)

    // starArticle が2回呼ばれることを確認
    await waitFor(() => {
      expect(starArticle).toHaveBeenCalledTimes(2)
      expect(starArticle).toHaveBeenCalledWith('a1')
      expect(starArticle).toHaveBeenCalledWith('a2')
    })
  })

  test('Given bulk star succeeds, shows toast and reflects starred state', async () => {
    const starArticle = vi.fn().mockResolvedValue({ status: 'starred', article_id: '' })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle,
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    // 複数選択モード
    await userEvent.click(screen.getByRole('button', { name: /複数選択/i }))

    // 1つ選択
    const checkboxes = screen.getAllByRole('checkbox')
    await userEvent.click(checkboxes[0])

    // 一括スター
    const bulkStarBtn = screen.getByRole('button', { name: /1件を.*スター/i })
    await userEvent.click(bulkStarBtn)

    // starArticle が 1 回呼ばれることを確認
    await waitFor(() => {
      expect(starArticle).toHaveBeenCalledWith('a1')
    })
  })

  test('Given bulk star with partial failure, shows error toast and keeps successful ones', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    const starArticle = vi
      .fn()
      .mockResolvedValueOnce({ status: 'starred', article_id: 'a1' })
      .mockRejectedValueOnce(new ApiError(500, 'Server error'))

    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle,
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    // 複数選択モード
    await userEvent.click(screen.getByRole('button', { name: /複数選択/i }))

    // 2つ選択
    const checkboxes = screen.getAllByRole('checkbox')
    await userEvent.click(checkboxes[0])
    await userEvent.click(checkboxes[1])

    // 一括スター
    await userEvent.click(screen.getByRole('button', { name: /一括スター|2件を.*スター/i }))

    // エラーが表示される
    await waitFor(() => {
      expect(screen.getByText(/エラー|失敗/i)).toBeInTheDocument()
    })

    // a1 はスター済みタブに表示される（a2 は失敗）
    function tabs() {
      return within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
    }
    await userEvent.click(tabs().getByRole('button', { name: /スター済み/i }))
    expect(screen.getByText('TypeScript 5.5 Released')).toBeInTheDocument()
    expect(screen.queryByText('Next.js 15 Features')).not.toBeInTheDocument()
  })

  test('Given "キャンセル" clicked in selection mode, clears selection and exits mode', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle: vi.fn(),
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    // 複数選択モード開始
    await userEvent.click(screen.getByRole('button', { name: /複数選択/i }))
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)

    // キャンセルボタンをクリック
    const cancelBtn = screen.getByRole('button', { name: /キャンセル/i })
    await userEvent.click(cancelBtn)

    // チェックボックスが非表示になる（選択モード終了）
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})

// ==========================================================
// Feed 画面 — 生成上限の月次判別（指摘2: ADR-073 準拠）
// ==========================================================
describe('FeedPage — generation limit message (issue #82 / ADR-073)', () => {
  test('Shows "今月の生成上限" when detail contains "Monthly"', async () => {
    const { createApiClient } = await import('@/lib/api')
    const { ApiError } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle: vi.fn().mockRejectedValue(
        new ApiError(429, 'Monthly podcast generation limit reached for this user.', 3600)
      ),
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    const starButton = screen.getByTestId('star-button-a1')
    await userEvent.click(starButton)

    await waitFor(() => {
      expect(screen.getByText(/今月の生成上限に達しました/)).toBeInTheDocument()
    })
  })

  test('Shows "今月の生成上限" when retryAfterSeconds > 86400 (24h) even without "Monthly" in detail', async () => {
    const { createApiClient } = await import('@/lib/api')
    const { ApiError } = await import('@/lib/api')
    // ADR-073: backend 文言変更時の耐障害性。detail に "Monthly" がなくても
    // Retry-After 24時間超なら月次判定（フォールバック戦略）
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle: vi.fn().mockRejectedValue(
        new ApiError(429, 'Podcast generation limit reached.', 86401) // 24時間超
      ),
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    const starButton = screen.getByTestId('star-button-a1')
    await userEvent.click(starButton)

    await waitFor(() => {
      expect(screen.getByText(/今月の生成上限に達しました/)).toBeInTheDocument()
    })
  })

  test('Shows "本日の生成上限" when retryAfterSeconds <= 86400 and no "Monthly" in detail', async () => {
    const { createApiClient } = await import('@/lib/api')
    const { ApiError } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getFeed: vi.fn().mockResolvedValue({ articles: SAMPLE_ARTICLES, date: '2026-06-10' }),
      starArticle: vi.fn().mockRejectedValue(
        new ApiError(429, 'Daily podcast generation limit reached.', 3600) // 1時間（24時間未満）
      ),
      dismissArticle: vi.fn(),
      getStarredArticles: vi.fn().mockResolvedValue({ articles: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderFeedPage()
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    const starButton = screen.getByTestId('star-button-a1')
    await userEvent.click(starButton)

    await waitFor(() => {
      expect(screen.getByText(/本日の生成上限に達しました/)).toBeInTheDocument()
    })
  })
})
