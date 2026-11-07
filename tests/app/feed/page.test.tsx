import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render as rtlRender, screen, waitFor, within, act, fireEvent } from '@testing-library/react'
import type { RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import userEvent from '@testing-library/user-event'
import React from 'react'
import FeedPage from '@/app/(app)/feed/page'
import { PreferencesProvider } from '@/contexts/PreferencesProvider'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'
import { ToastProvider } from '@/components/ui/Toast'
import type { ApiFailure, Result } from '@/lib/api/gateway'
import { createGatewayDouble } from '../../helpers/gatewayDouble'
import type { GatewayDouble } from '../../helpers/gatewayDouble'

const render = (ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) =>
  rtlRender(ui, { wrapper: ApiClientProvider, ...options })

// 設定の保存先は、テストごとに新しい in-memory の KeyValueStore
const memoryStore = (initial: Record<string, string> = {}): KeyValueStore => {
  const data = new Map(Object.entries(initial))
  return {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => {
      data.set(key, value)
      return true
    },
    remove: (key) => {
      data.delete(key)
    },
  }
}

const { playSfx, prepareSfx } = vi.hoisted(() => ({ playSfx: vi.fn(), prepareSfx: vi.fn() }))

vi.mock('@/lib/sfx', () => ({ playSfx, prepareSfx, configureSfx: vi.fn() }))

const holder = vi.hoisted(() => ({ gw: undefined as GatewayDouble | undefined }))

vi.mock('@/lib/api/gateway', () => ({ createGateway: () => holder.gw }))

const FEED_PATH = '/api/backend/feed'
const STARRED_PATH = '/api/backend/articles/starred'
const starPath = (id: string) => `/api/backend/articles/${id}/star`
const dismissPath = (id: string) => `/api/backend/articles/${id}/dismiss`

let gw: GatewayDouble

function callsTo(method: string, path: string) {
  return gw.calls.filter((c) => c.method === method && c.path === path)
}

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
    <PreferencesProvider store={memoryStore()}>
      <ToastProvider>
        <FeedPage />
      </ToastProvider>
    </PreferencesProvider>
  )
}

beforeEach(() => {
  gw = createGatewayDouble()
  holder.gw = gw
  gw.respond('GET', STARRED_PATH, { ok: true, value: { articles: [] } })
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
  test('Given loading state, displays multiple SkeletonCards and announces loading via role="status" (#83)', () => {
    gw.respondWith('GET', FEED_PATH, () => new Promise<Result<unknown, ApiFailure>>(() => {})) // never resolves

    renderFeedPage()

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(within(status).getAllByTestId('skeleton-card')).toHaveLength(6)
  })

  test('Given articles returned, renders article cards', async () => {
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })

    renderFeedPage()

    await waitFor(() => {
      expect(screen.getByText('TypeScript 5.5 Released')).toBeInTheDocument()
      expect(screen.getByText('Next.js 15 Features')).toBeInTheDocument()
    })
  })

  test('Given empty articles array, displays empty state message', async () => {
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: [], date: '2026-06-10' } })

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
    gw.respond('POST', starPath('a1'), { ok: true, value: { status: 'starred', article_id: 'a1' } })
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    // ArticleCard の Star ボタンは aria-label「スターする」(未スター時)
    await userEvent.click(screen.getAllByRole('button', { name: 'スターする' })[0])

    // WHY: 即時報酬。Sound/Visual 演出は fetch 結果を待たずクリック同期で実行
    expect(prepareSfx).toHaveBeenCalled()
    expect(playSfx).toHaveBeenCalledWith('swipe')
    await waitFor(() => {
      expect(screen.getByText(/Star しました/)).toBeInTheDocument()
    })
    // カードはリストに残る
    expect(screen.getByText('TypeScript 5.5 Released')).toBeInTheDocument()
  })

  test('Given star returns 404, shows "記事が見つかりません" toast and removes card', async () => {
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respond('POST', starPath('a1'), { ok: false, failure: { kind: 'not_found' } })

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await userEvent.click(screen.getAllByRole('button', { name: 'スターする' })[0])

    await waitFor(() => {
      expect(screen.getByText(/記事が見つかりません/)).toBeInTheDocument()
    })
  })

  test('Given star returns 401, shows API key error toast', async () => {
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respond('POST', starPath('a1'), { ok: false, failure: { kind: 'unauthorized' } })

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await userEvent.click(screen.getAllByRole('button', { name: 'スターする' })[0])

    await waitFor(() => {
      expect(screen.getByText(/API キー/)).toBeInTheDocument()
    })
  })

  test('Given a difficulty is chosen from the ArticleCard difficulty menu, calls starArticle with id and difficulty (#163)', async () => {
    gw.respond('POST', starPath('a1'), { ok: true, value: { status: 'starred', article_id: 'a1' } })
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await userEvent.click(screen.getAllByRole('button', { name: /記事の生成難易度を指定/ })[0])
    await userEvent.click(screen.getByRole('menuitem', { name: 'TOEIC 900' }))

    await waitFor(() => {
      expect(gw.calls).toContainEqual({ method: 'POST', path: starPath('a1'), body: { difficulty: 'toeic_900' } })
    })
  })

  // #163（難易度指定star）と #164（remaining表示）のマージ統合境界を固定する。
  // 難易度指定で star した場合にも remaining 付きトーストが出ることを検証する。
  test('Given a difficulty is chosen and star succeeds with a remaining count, shows the count in the toast', async () => {
    gw.respond('POST', starPath('a1'), { ok: true, value: { status: 'starred', article_id: 'a1', remaining: 2 } })
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await userEvent.click(screen.getAllByRole('button', { name: /記事の生成難易度を指定/ })[0])
    await userEvent.click(screen.getByRole('menuitem', { name: 'TOEIC 900' }))

    await waitFor(() => {
      expect(gw.calls).toContainEqual({ method: 'POST', path: starPath('a1'), body: { difficulty: 'toeic_900' } })
      expect(screen.getByText('Star しました（残り生成 2 回）')).toBeInTheDocument()
    })
  })

  test('Given the plain star button clicked (no difficulty chosen), calls starArticle with only the id', async () => {
    gw.respond('POST', starPath('a1'), { ok: true, value: { status: 'starred', article_id: 'a1' } })
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await userEvent.click(screen.getAllByRole('button', { name: 'スターする' })[0])

    await waitFor(() => {
      expect(gw.calls).toContainEqual({ method: 'POST', path: starPath('a1'), body: undefined })
    })
  })

  // issue #164 / ADR-061: 生成残回数の可視化
  test('Given star succeeds with a remaining count, shows the count in the toast', async () => {
    gw.respond('POST', starPath('a1'), { ok: true, value: { status: 'starred', article_id: 'a1', remaining: 3 } })
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await userEvent.click(screen.getAllByRole('button', { name: 'スターする' })[0])

    await waitFor(() => {
      expect(screen.getByText('Star しました（残り生成 3 回）')).toBeInTheDocument()
    })
  })

  test('Given star succeeds without a remaining field (backward compat with old backend), shows the original toast text', async () => {
    gw.respond('POST', starPath('a1'), { ok: true, value: { status: 'starred', article_id: 'a1' } })
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await userEvent.click(screen.getAllByRole('button', { name: 'スターする' })[0])

    await waitFor(() => {
      expect(screen.getByText('Star しました')).toBeInTheDocument()
    })
  })

  test('Given star returns 429, shows generation-limit toast with retry time (#82)', async () => {
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    // 43200 秒 = 約12時間後
    gw.respond('POST', starPath('a1'), { ok: false, failure: { kind: 'rate_limited', retryAfterSeconds: 43200, scope: 'unknown', detail: 'Daily limit reached' } })

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await userEvent.click(screen.getAllByRole('button', { name: 'スターする' })[0])

    await waitFor(() => {
      expect(screen.getByText(/本日の生成上限に達しました（約12時間後に可能）/)).toBeInTheDocument()
    })
  })

  test('Given star throws an unexpected exception (e.g. TypeError), shows generic error toast (#85)', async () => {
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respondWith('POST', starPath('a1'), () => Promise.reject(new TypeError('Cannot read property of undefined')))

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
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respond('POST', starPath('a1'), {
      ok: false,
      failure: {
        kind: 'rate_limited',
        // 2678400 秒 = 約31日後
        retryAfterSeconds: 2678400,
        scope: 'unknown',
        detail: 'Monthly podcast generation limit reached for this user. Please try again next month.',
      },
    })

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
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respond('POST', dismissPath('a1'), { ok: true, value: { status: 'dismissed', article_id: 'a1' } })

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await userEvent.click(screen.getAllByRole('button', { name: /dismiss|×|非表示/i })[0])

    await waitFor(() => {
      expect(screen.queryByText('TypeScript 5.5 Released')).not.toBeInTheDocument()
    })
  })

  test('Given dismiss throws an unexpected exception (e.g. TypeError), shows generic error toast (#85)', async () => {
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respondWith('POST', dismissPath('a1'), () => Promise.reject(new TypeError('Cannot read property of undefined')))

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
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respond('POST', starPath('a1'), { ok: true, value: { status: 'starred', article_id: 'a1' } })
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
    // backend が star 済み記事を feed から除外した後の応答を模す（a3 を含まない）
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respond('GET', STARRED_PATH, { ok: true, value: { articles: [EXCLUDED_STARRED_ARTICLE] } })

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
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    const tabs = within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
    await userEvent.click(tabs.getByRole('button', { name: /スター済み/ }))

    expect(screen.getByText('スター済みの記事はありません')).toBeInTheDocument()
  })

  test('Given article starred optimistically, refresh pressed, and getStarredArticles still does not include it (server indexing lag), keeps the optimistic star state', async () => {
    gw.respond('POST', starPath('a1'), { ok: true, value: { status: 'starred', article_id: 'a1' } })
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    // 一貫して空 = サーバ側インデックスがまだ star を反映していない状況を模す
    gw.respond('GET', STARRED_PATH, { ok: true, value: { articles: [] } })

    renderFeedPage()

    // Wait for initial load
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    expect(callsTo('GET', FEED_PATH)).toHaveLength(1)

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
      expect(callsTo('GET', FEED_PATH)).toHaveLength(2)
    })

    // Star state should still be kept (optimistic addition not rolled back)
    expect(screen.getByText('TypeScript 5.5 Released')).toBeInTheDocument()
    expect(tabs.getByRole('button', { name: /スター済み/ })).toHaveTextContent('1')
  })

  test('Given getStarredArticles rejects, the page does not break and shows only the optimistic stars', async () => {
    gw.respond('POST', starPath('a1'), { ok: true, value: { status: 'starred', article_id: 'a1' } })
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respondWith('GET', STARRED_PATH, () => Promise.reject(new Error('network error')))

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
// 表示する。Star タブは閲覧専用（Star/Dismiss アクション非表示）とし、Dismiss による
// 永久残留（backend が dismiss で starred_article_ids を除去せず /articles/starred も
// dismissed をフィルタしないため、再取得しても消えない）を構造的に防ぐ。
// un-star 導線（DELETE /articles/{id}/star）のみ閲覧専用ゲートとは独立に表示する。
// ==========================================================
describe('FeedPage — Starred tab regression fixes', () => {
  test('Given the starred tab is active, article cards do not render Star/Dismiss action buttons but do render the unstar button (view-only)', async () => {
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    // サーバ側で確定済みの star 済み記事として a1 を返す
    gw.respond('GET', STARRED_PATH, { ok: true, value: { articles: [SAMPLE_ARTICLES[0]] } })

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    const tabs = within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
    await userEvent.click(tabs.getByRole('button', { name: /スター済み/ }))

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    expect(screen.getByText('TypeScript 5.5 Released')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '非表示' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'スターする' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'スター済み' })).not.toBeInTheDocument()
    expect(screen.getByTestId(`unstar-button-${SAMPLE_ARTICLES[0].id}`)).toBeInTheDocument()
  })

  test('Given an article present in both the all tab and the server starred list, dismissing it from the all tab also removes it from the starred tab', async () => {
    gw.respond('POST', dismissPath('a1'), { ok: true, value: { status: 'dismissed', article_id: 'a1' } })
    // a1 は移行途中で feed にも残っており、かつ既に server 側で star 済み（レース状況を模す）
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respond('GET', STARRED_PATH, { ok: true, value: { articles: [SAMPLE_ARTICLES[0]] } })

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
    gw.respond('POST', starPath('a1'), { ok: true, value: { status: 'starred', article_id: 'a1' } })
    gw.respondWith('GET', FEED_PATH, (): Promise<Result<unknown, ApiFailure>> =>
      Promise.resolve(
        callsTo('GET', FEED_PATH).length === 1
          // 1回目: まだ backend が除外する前（移行途中）の応答
          ? { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } }
          // 2回目（リフレッシュ後）: backend が star 済み a1 を feed から恒久除外した後の本番形
          : { ok: true, value: { articles: [SAMPLE_ARTICLES[1]], date: '2026-06-11' } },
      ),
    )
    gw.respond('GET', STARRED_PATH, { ok: true, value: { articles: [] } }) // サーバ側インデックスは常に未反映

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    // a1 を楽観 star
    await userEvent.click(screen.getAllByRole('button', { name: 'スターする' })[0])
    await waitFor(() => screen.getByText(/Star しました/))

    // リフレッシュ（2回目の getFeed は a1 を含まない）
    await userEvent.click(screen.getByRole('button', { name: /更新|refresh/i }))
    await waitFor(() => {
      expect(callsTo('GET', FEED_PATH)).toHaveLength(2)
    })
    await waitFor(() => screen.getByText('Next.js 15 Features'))

    // articles から a1 が消えても、Star タブでは楽観 star が保持され続ける
    const tabs = within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
    await userEvent.click(tabs.getByRole('button', { name: /スター済み/ }))
    expect(screen.getByText('TypeScript 5.5 Released')).toBeInTheDocument()
    expect(tabs.getByRole('button', { name: /スター済み/ })).toHaveTextContent('1')
  })

  test('Given the same article id appears in both the server starred list and the local optimistic star, the starred tab shows it only once', async () => {
    gw.respond('POST', starPath('a1'), { ok: true, value: { status: 'starred', article_id: 'a1' } })
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respond('GET', STARRED_PATH, { ok: true, value: { articles: [SAMPLE_ARTICLES[0]] } })

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
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respondWith('GET', STARRED_PATH, () => Promise.reject(error))

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith('[feed] starred一覧の取得に失敗', error)
    })

    consoleErrorSpy.mockRestore()
  })

  test('Given the starred tab is active, the "複数選択" (multi-select) button is not shown', async () => {
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respond('GET', STARRED_PATH, { ok: true, value: { articles: [SAMPLE_ARTICLES[0]] } })

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
    gw.respond('POST', starPath('a1'), { ok: true, value: { status: 'starred', article_id: 'a1' } })
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    // a1 は既にサーバ側で star 済み（Star タブに表示される）
    gw.respond('GET', STARRED_PATH, { ok: true, value: { articles: [SAMPLE_ARTICLES[0]] } })

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
    expect(callsTo('POST', starPath('a1'))).toHaveLength(0)
  })
})

// ==========================================================
// Feed 画面 — Starタブのun-star導線（backend DELETE /articles/{id}/star）
// ==========================================================
describe('FeedPage — Unstar', () => {
  test('Given the all tab is active, article cards do not render the unstar button', async () => {
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respond('GET', STARRED_PATH, { ok: true, value: { articles: [SAMPLE_ARTICLES[0]] } })

    renderFeedPage()

    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    expect(screen.queryByTestId(`unstar-button-${SAMPLE_ARTICLES[0].id}`)).not.toBeInTheDocument()
  })

  test('Given the user confirms the unstar dialog, sends DELETE, removes the article from the starred tab, decrements the count, and shows a success toast', async () => {
    gw.respond('DELETE', starPath('a1'), { ok: true, value: undefined })
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respond('GET', STARRED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES } })

    renderFeedPage()
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    const tabs = within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
    await userEvent.click(tabs.getByRole('button', { name: /スター済み/ }))
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))
    expect(tabs.getByRole('button', { name: /スター済み/ })).toHaveTextContent('2')

    await userEvent.click(screen.getByTestId(`unstar-button-${SAMPLE_ARTICLES[0].id}`))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('スターを解除しますか？')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: '確認' }))

    await waitFor(() => {
      expect(gw.calls).toContainEqual({ method: 'DELETE', path: starPath(SAMPLE_ARTICLES[0].id), body: undefined })
    })
    await waitFor(() => {
      expect(screen.queryByText('TypeScript 5.5 Released')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Next.js 15 Features')).toBeInTheDocument()
    expect(tabs.getByRole('button', { name: /スター済み/ })).toHaveTextContent('1')
    expect(screen.getByText('スターを解除しました')).toBeInTheDocument()
  })

  test('Given the user cancels the unstar dialog, does not call unstarArticle and the article remains', async () => {
    gw.respond('DELETE', starPath('a1'), { ok: true, value: undefined })
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respond('GET', STARRED_PATH, { ok: true, value: { articles: [SAMPLE_ARTICLES[0]] } })

    renderFeedPage()
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    const tabs = within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
    await userEvent.click(tabs.getByRole('button', { name: /スター済み/ }))
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    await userEvent.click(screen.getByTestId(`unstar-button-${SAMPLE_ARTICLES[0].id}`))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(callsTo('DELETE', starPath('a1'))).toHaveLength(0)
    expect(screen.getByText('TypeScript 5.5 Released')).toBeInTheDocument()
  })

  test('Given the last starred article is unstarred, shows the empty starred state', async () => {
    gw.respond('DELETE', starPath('a1'), { ok: true, value: undefined })
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respond('GET', STARRED_PATH, { ok: true, value: { articles: [SAMPLE_ARTICLES[0]] } })

    renderFeedPage()
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    const tabs = within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
    await userEvent.click(tabs.getByRole('button', { name: /スター済み/ }))
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    await userEvent.click(screen.getByTestId(`unstar-button-${SAMPLE_ARTICLES[0].id}`))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '確認' }))

    await waitFor(() => {
      expect(screen.getByText('スター済みの記事はありません')).toBeInTheDocument()
    })
  })

  test('Given unstarArticle rejects with a 500 error, keeps the article visible and shows an error toast', async () => {
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respond('DELETE', starPath('a1'), { ok: false, failure: { kind: 'server', status: 500 } })
    gw.respond('GET', STARRED_PATH, { ok: true, value: { articles: [SAMPLE_ARTICLES[0]] } })

    renderFeedPage()
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    const tabs = within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
    await userEvent.click(tabs.getByRole('button', { name: /スター済み/ }))
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    await userEvent.click(screen.getByTestId(`unstar-button-${SAMPLE_ARTICLES[0].id}`))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '確認' }))

    await waitFor(() => {
      expect(screen.getByText('エラーが発生しました (500)')).toBeInTheDocument()
    })
    expect(screen.getByText('TypeScript 5.5 Released')).toBeInTheDocument()
  })

  test('Given unstarArticle rejects with a 404 error (article no longer exists), removes it from the starred tab locally', async () => {
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respond('DELETE', starPath('a1'), { ok: false, failure: { kind: 'not_found' } })
    gw.respond('GET', STARRED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES } })

    renderFeedPage()
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    const tabs = within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
    await userEvent.click(tabs.getByRole('button', { name: /スター済み/ }))
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    await userEvent.click(screen.getByTestId(`unstar-button-${SAMPLE_ARTICLES[0].id}`))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '確認' }))

    await waitFor(() => {
      expect(screen.queryByText('TypeScript 5.5 Released')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Next.js 15 Features')).toBeInTheDocument()
    expect(tabs.getByRole('button', { name: /スター済み/ })).toHaveTextContent('1')
  })

  test('Given unstarArticle is still pending (busyIds), the unstar button is disabled to prevent a duplicate DELETE', async () => {
    let resolveUnstar: (v: Result<unknown, ApiFailure>) => void = () => {}
    gw.respondWith('DELETE', starPath('a1'), () => new Promise<Result<unknown, ApiFailure>>((res) => { resolveUnstar = res }))
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respond('GET', STARRED_PATH, { ok: true, value: { articles: [SAMPLE_ARTICLES[0]] } })

    renderFeedPage()
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    const tabs = within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
    await userEvent.click(tabs.getByRole('button', { name: /スター済み/ }))
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    await userEvent.click(screen.getByTestId(`unstar-button-${SAMPLE_ARTICLES[0].id}`))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '確認' }))

    await waitFor(() => {
      expect(screen.getByTestId(`unstar-button-${SAMPLE_ARTICLES[0].id}`)).toBeDisabled()
    })

    // WHY: pending中のPromiseを未決着のまま終了するとテスト境界を越えてstate更新が
    // 走りact警告・flakinessの原因になる。テスト内で確実に解決させる。唯一のstarred
    // 記事を解除するため、解決後はボタンではなく空状態に遷移することを確認する。
    resolveUnstar({ ok: true, value: undefined })
    await waitFor(() => {
      expect(screen.getByText('スター済みの記事はありません')).toBeInTheDocument()
    })
  })

  test('Given handleUnstarConfirm is invoked while the article is already busy (in-flight DELETE), does not send a second DELETE (double-confirm-click guard)', async () => {
    let resolveUnstar: (v: Result<unknown, ApiFailure>) => void = () => {}
    gw.respondWith('DELETE', starPath('a1'), () => new Promise<Result<unknown, ApiFailure>>((res) => { resolveUnstar = res }))
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respond('GET', STARRED_PATH, { ok: true, value: { articles: [SAMPLE_ARTICLES[0]] } })

    renderFeedPage()
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    const tabs = within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
    await userEvent.click(tabs.getByRole('button', { name: /スター済み/ }))
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    await userEvent.click(screen.getByTestId(`unstar-button-${SAMPLE_ARTICLES[0].id}`))
    const confirmButton = within(screen.getByRole('dialog')).getByRole('button', { name: '確認' })

    // WHY: ConfirmDialogの「確認」ボタン自体はbusyIdsに連動して無効化されない
    // （ArticleCard側の非表示ボタンとは別コンポーネント）。React の再レンダー・
    // ダイアログのアンマウントが確定する前に2回連続クリックが処理される競合を、
    // 単一の act() 内で2回 fireEvent.click することで模す（間に await を挟むと
    // 1回目の act() が同期的に反映されダイアログが既にアンマウントされてしまい、
    // 本来検知したい競合を再現できない）。
    await act(async () => {
      fireEvent.click(confirmButton)
      fireEvent.click(confirmButton)
    })

    expect(callsTo('DELETE', starPath('a1'))).toHaveLength(1)

    // WHY: pendingのPromiseを未決着のまま終えるとテスト境界を越えてstate更新が走り
    // act警告・flakinessの原因になるため、テスト内で確実に解決させる。唯一のstarred
    // 記事を解除するため、解決後はボタンではなく空状態に遷移することを確認する。
    resolveUnstar({ ok: true, value: undefined })
    await waitFor(() => {
      expect(screen.getByText('スター済みの記事はありません')).toBeInTheDocument()
    })
  })

  test('Given an article unstarred from the starred tab, switching to the all tab shows its star button as not starred', async () => {
    gw.respond('DELETE', starPath('a1'), { ok: true, value: undefined })
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respond('GET', STARRED_PATH, { ok: true, value: { articles: [SAMPLE_ARTICLES[0]] } })

    renderFeedPage()
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    const tabs = within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
    await userEvent.click(tabs.getByRole('button', { name: /スター済み/ }))
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    await userEvent.click(screen.getByTestId(`unstar-button-${SAMPLE_ARTICLES[0].id}`))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '確認' }))
    await waitFor(() => {
      expect(screen.getByText('スター済みの記事はありません')).toBeInTheDocument()
    })

    await userEvent.click(tabs.getByRole('button', { name: /すべて/ }))
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    expect(screen.getAllByRole('button', { name: 'スターする' })[0]).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'スター済み' })).not.toBeInTheDocument()
  })
})

// ==========================================================
// Feed 画面 — フィード取得失敗時の Star タブ独立性（should-fix）
// ==========================================================
describe('FeedPage — Starred tab independence from feed fetch failure', () => {
  test('Given getFeed fails but getStarredArticles succeeds, the starred tab still shows the server-starred articles', async () => {
    gw.respond('GET', FEED_PATH, { ok: false, failure: { kind: 'server', status: 500 } })
    gw.respond('GET', STARRED_PATH, { ok: true, value: { articles: [SAMPLE_ARTICLES[0]] } })

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
    gw.respond('GET', FEED_PATH, { ok: false, failure: { kind: 'network' } })
    gw.respondWith('GET', STARRED_PATH, () => Promise.reject(new Error('network error')))

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
// Feed 画面 — getStarredArticles の契約耐性（PR #99 CI e2e failure対応）
// e2e のcatch-allスタブは未スタブの /api/backend/** に 200 + {} を返す。移行期・プロキシ経由で
// getStarredArticles() が articles を含まない 200 応答を返しても画面全体を壊さない。
// ==========================================================
describe('FeedPage — getStarredArticles contract resilience', () => {
  test('Given getStarredArticles resolves a 200 body without an articles array (e.g. {}), the page does not crash: feed articles render and the starred tab shows the true empty state', async () => {
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    // 未スタブ経路のcatch-allスタブ等が返しうる、契約外の {} 応答を模す
    gw.respond('GET', STARRED_PATH, { ok: true, value: {} })

    renderFeedPage()

    // all タブのフィード記事が表示され、画面全体がクラッシュしない
    await waitFor(() => {
      expect(screen.getByText('TypeScript 5.5 Released')).toBeInTheDocument()
    })
    expect(screen.getByText('Next.js 15 Features')).toBeInTheDocument()

    // Star タブは（エラーではなく）本当の空状態を表示する
    const tabs = within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
    await userEvent.click(tabs.getByRole('button', { name: /スター済み/ }))
    expect(screen.getByText('スター済みの記事はありません')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

// ==========================================================
// Feed 画面 — ページヘッダー
// ==========================================================
describe('FeedPage — Page header', () => {
  test('Given feed date returned, shows it in the page subtitle', async () => {
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })

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
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })

    renderFeedPage()
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    await userEvent.click(screen.getByRole('button', { name: /リフレッシュ|更新|refresh/i }))

    expect(callsTo('GET', FEED_PATH)).toHaveLength(2)
  })

  test('Given the initial fetch resolves after a newer refresh request, the stale response is ignored (requestId guard)', async () => {
    let resolveFeed1: (v: Result<unknown, ApiFailure>) => void = () => {}
    let resolveFeed2: (v: Result<unknown, ApiFailure>) => void = () => {}
    const feed1 = new Promise<Result<unknown, ApiFailure>>((res) => { resolveFeed1 = res })
    const feed2 = new Promise<Result<unknown, ApiFailure>>((res) => { resolveFeed2 = res })
    gw.respondWith('GET', FEED_PATH, () => (callsTo('GET', FEED_PATH).length === 1 ? feed1 : feed2))

    let resolveStarred1: (v: Result<unknown, ApiFailure>) => void = () => {}
    let resolveStarred2: (v: Result<unknown, ApiFailure>) => void = () => {}
    const starred1 = new Promise<Result<unknown, ApiFailure>>((res) => { resolveStarred1 = res })
    const starred2 = new Promise<Result<unknown, ApiFailure>>((res) => { resolveStarred2 = res })
    gw.respondWith('GET', STARRED_PATH, () => (callsTo('GET', STARRED_PATH).length === 1 ? starred1 : starred2))


    renderFeedPage()

    // 初回 fetch（call1）が発火するのを待つ（まだ pending）
    await waitFor(() => expect(callsTo('GET', FEED_PATH)).toHaveLength(1))

    // call1 がまだ解決していない間にリフレッシュし、2回目の fetch（call2・より新しいリクエスト）を発火する
    await userEvent.click(screen.getByRole('button', { name: /更新|refresh/i }))
    await waitFor(() => expect(callsTo('GET', FEED_PATH)).toHaveLength(2))

    // 新しい方（call2）を先に解決させる
    resolveFeed2({ ok: true, value: { articles: [SAMPLE_ARTICLES[1]], date: '2026-06-11' } })
    resolveStarred2({ ok: true, value: { articles: [] } })
    await waitFor(() => screen.getByText('Next.js 15 Features'))

    // 古い方（call1）が後から解決する（stale な遅延応答）
    resolveFeed1({ ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    resolveStarred1({ ok: true, value: { articles: [] } })

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
    gw.respond('GET', FEED_PATH, { ok: false, failure: { kind: 'network' } })

    renderFeedPage()

    await waitFor(() => {
      expect(screen.getByText(/サーバーに接続できません/)).toBeInTheDocument()
    })
  })

  // issue #83: subscriptions/settings 画面のエラー表示は role="alert" を付与済みだが
  // feed 画面のみ欠けていたため非一貫だった。他画面と揃える。
  test('Given a fetch error, the error message has role="alert" (#83)', async () => {
    gw.respond('GET', FEED_PATH, { ok: false, failure: { kind: 'network' } })

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
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respond('POST', starPath('a1'), { ok: true, value: { status: 'starred', article_id: 'a1' } })

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
    gw.respond('POST', starPath('a1'), { ok: true, value: { status: 'starred', article_id: '' } })
    gw.respond('POST', starPath('a2'), { ok: true, value: { status: 'starred', article_id: '' } })
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })

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
      expect(gw.calls.filter((c) => c.method === 'POST')).toHaveLength(2)
      expect(gw.calls).toContainEqual({ method: 'POST', path: starPath('a1'), body: undefined })
      expect(gw.calls).toContainEqual({ method: 'POST', path: starPath('a2'), body: undefined })
    })
  })

  test('Given bulk star succeeds, shows toast and reflects starred state', async () => {
    gw.respond('POST', starPath('a1'), { ok: true, value: { status: 'starred', article_id: '' } })
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })

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
      expect(gw.calls).toContainEqual({ method: 'POST', path: starPath('a1'), body: undefined })
    })
  })

  test('Given bulk star with partial failure, shows error toast and keeps successful ones', async () => {
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    // 記事ごとに path が違うので、呼出順ではなく id で応答を決める
    gw.respond('POST', starPath('a1'), { ok: true, value: { status: 'starred', article_id: 'a1' } })
    gw.respond('POST', starPath('a2'), { ok: false, failure: { kind: 'server', status: 500 } })

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
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })

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
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respond('POST', starPath('a1'), {
      ok: false,
      failure: { kind: 'rate_limited', retryAfterSeconds: 3600, scope: 'unknown', detail: 'Monthly podcast generation limit reached for this user.' },
    })

    renderFeedPage()
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    const starButton = screen.getByTestId('star-button-a1')
    await userEvent.click(starButton)

    await waitFor(() => {
      expect(screen.getByText(/今月の生成上限に達しました/)).toBeInTheDocument()
    })
  })

  test('Shows "今月の生成上限" when retryAfterSeconds > 86400 (24h) even without "Monthly" in detail', async () => {
    // ADR-073: backend 文言変更時の耐障害性。detail に "Monthly" がなくても
    // Retry-After 24時間超なら月次判定（フォールバック戦略）
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respond('POST', starPath('a1'), {
      ok: false,
      failure: { kind: 'rate_limited', retryAfterSeconds: 86401, scope: 'unknown', detail: 'Podcast generation limit reached.' },
    }) // 24時間超

    renderFeedPage()
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    const starButton = screen.getByTestId('star-button-a1')
    await userEvent.click(starButton)

    await waitFor(() => {
      expect(screen.getByText(/今月の生成上限に達しました/)).toBeInTheDocument()
    })
  })

  test('Shows "本日の生成上限" when retryAfterSeconds <= 86400 and no "Monthly" in detail', async () => {
    gw.respond('GET', FEED_PATH, { ok: true, value: { articles: SAMPLE_ARTICLES, date: '2026-06-10' } })
    gw.respond('POST', starPath('a1'), {
      ok: false,
      failure: { kind: 'rate_limited', retryAfterSeconds: 3600, scope: 'unknown', detail: 'Daily podcast generation limit reached.' },
    }) // 1時間（24時間未満）

    renderFeedPage()
    await waitFor(() => screen.getByText('TypeScript 5.5 Released'))

    const starButton = screen.getByTestId('star-button-a1')
    await userEvent.click(starButton)

    await waitFor(() => {
      expect(screen.getByText(/本日の生成上限に達しました/)).toBeInTheDocument()
    })
  })
})

// ==========================================================
// Feed 画面 — web-slice-catalog-03 の pin（挙動不変の固定。実装前の page で green、実装後も green）
// ==========================================================
type GwResult = Result<unknown, ApiFailure>

interface DeferredResponse {
  promise: Promise<GwResult>
  resolve: (value: GwResult) => void
  reject: (reason: unknown) => void
}

function deferResponse(): DeferredResponse {
  let resolve!: (value: GwResult) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<GwResult>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const feedOk = (articles: unknown[] = SAMPLE_ARTICLES, date = '2026-06-10'): GwResult => ({ ok: true, value: { articles, date } })
const starredOk = (articles: unknown[]): GwResult => ({ ok: true, value: { articles } })
const ART1 = SAMPLE_ARTICLES[0]
const ART2 = SAMPLE_ARTICLES[1]
const A1_TITLE = 'TypeScript 5.5 Released'
const A2_TITLE = 'Next.js 15 Features'

function feedTabs() {
  return within(screen.getByRole('group', { name: 'フィードの絞り込み' }))
}

function toastTexts(): string[] {
  return Array.from(document.querySelectorAll('.toast > span')).map((el) => el.textContent ?? '')
}

function cardOf(id: string): HTMLElement {
  const card = screen.getByTestId(`star-button-${id}`).closest('.article-card')
  if (!(card instanceof HTMLElement)) throw new Error(`card ${id} が無い`)
  return card
}

async function openStarredTab() {
  await userEvent.click(feedTabs().getByRole('button', { name: /スター済み/ }))
}

/** Star タブを開き、a1 の解除ボタンを押して確認ダイアログを開く。 */
async function openUnstarDialogForA1() {
  renderFeedPage()
  await waitFor(() => screen.getByText(A1_TITLE))
  await openStarredTab()
  await waitFor(() => screen.getByTestId('unstar-button-a1'))
  await userEvent.click(screen.getByTestId('unstar-button-a1'))
  return within(screen.getByRole('dialog')).getByRole('button', { name: '確認' })
}

function respondStarredA1Unstar(result: GwResult | (() => Promise<GwResult>)) {
  gw.respond('GET', FEED_PATH, feedOk([{ ...ART1, is_starred: true }, ART2]))
  gw.respond('GET', STARRED_PATH, starredOk([ART1]))
  if (typeof result === 'function') gw.respondWith('DELETE', starPath('a1'), result)
  else gw.respond('DELETE', starPath('a1'), result)
}

describe('FeedPage — web-slice-catalog-03 pins', () => {
  test('web-slice-catalog-03 verifies: CI-PG7.4 — タブを切り替えても request は出ない（GET feed・GET starred の件数が切替の前後で同じ）', async () => {
    gw.respond('GET', FEED_PATH, feedOk())

    renderFeedPage()
    await waitFor(() => screen.getByText(A1_TITLE))
    const before = { feed: callsTo('GET', FEED_PATH).length, starred: callsTo('GET', STARRED_PATH).length }

    await openStarredTab()
    await userEvent.click(feedTabs().getByRole('button', { name: /すべて/ }))
    await userEvent.click(feedTabs().getByRole('button', { name: /スター済み/ }))

    expect(before).toEqual({ feed: 1, starred: 1 })
    expect(callsTo('GET', FEED_PATH)).toHaveLength(before.feed)
    expect(callsTo('GET', STARRED_PATH)).toHaveLength(before.starred)
  })

  test('web-slice-catalog-03 verifies: CI-PG2.3 — getFeed が unauthorized → 「API キーが正しくありません」', async () => {
    gw.respond('GET', FEED_PATH, { ok: false, failure: { kind: 'unauthorized' } })

    renderFeedPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('API キーが正しくありません')
  })

  test('web-slice-catalog-03 verifies: CI-PG1.5 — getFeed が reject → 「予期しないエラーが発生しました」', async () => {
    gw.respondWith('GET', FEED_PATH, () => Promise.reject(new Error('boom')))

    renderFeedPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('予期しないエラーが発生しました')
  })

  test('web-slice-catalog-03 verifies: CI-PG1.8・1.10 — getStarredArticles が ok:false → Star タブの空状態に「スター済み記事の取得に失敗しました」、console.error に失敗が渡る', async () => {
    const failure: ApiFailure = { kind: 'server', status: 500 }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      gw.respond('GET', FEED_PATH, feedOk())
      gw.respond('GET', STARRED_PATH, { ok: false, failure })

      renderFeedPage()
      await waitFor(() => screen.getByText(A1_TITLE))
      await openStarredTab()

      expect(await screen.findByText('スター済み記事の取得に失敗しました')).toBeInTheDocument()
      expect(spy).toHaveBeenCalledWith('[feed] starred一覧の取得に失敗', failure)
    } finally {
      spy.mockRestore()
    }
  })

  test('web-slice-catalog-03 verifies: CI-PG6.4・CM5 — 一括 Star で 1 件が reject → 「1件をスターしました」と「1件のスターに失敗しました」', async () => {
    gw.respond('GET', FEED_PATH, feedOk())
    gw.respond('POST', starPath('a1'), { ok: true, value: { status: 'starred', article_id: 'a1' } })
    gw.respondWith('POST', starPath('a2'), () => Promise.reject(new Error('boom')))

    renderFeedPage()
    await waitFor(() => screen.getByText(A1_TITLE))
    await userEvent.click(screen.getByRole('button', { name: /複数選択/ }))
    for (const box of screen.getAllByRole('checkbox')) await userEvent.click(box)
    await userEvent.click(screen.getByRole('button', { name: /2件を一括スター/ }))

    await waitFor(() => expect(toastTexts()).toHaveLength(2))
    expect(toastTexts()).toEqual(['1件をスターしました', '1件のスターに失敗しました'])
  })

  test('web-slice-catalog-03 verifies: CI-PG6.2〜6.7 — 一括 Star の成功の toast の後に失敗の toast。終了後は選択モードが終わり、失敗した記事の操作は enabled で、選択は空', async () => {
    gw.respond('GET', FEED_PATH, feedOk())
    gw.respond('POST', starPath('a1'), { ok: true, value: { status: 'starred', article_id: 'a1' } })
    gw.respond('POST', starPath('a2'), { ok: false, failure: { kind: 'server', status: 500 } })

    renderFeedPage()
    await waitFor(() => screen.getByText(A1_TITLE))
    await userEvent.click(screen.getByRole('button', { name: /複数選択/ }))
    for (const box of screen.getAllByRole('checkbox')) await userEvent.click(box)
    await userEvent.click(screen.getByRole('button', { name: /2件を一括スター/ }))

    await waitFor(() => expect(toastTexts()).toHaveLength(2))
    expect(toastTexts()).toEqual(['1件をスターしました', '1件のスターに失敗しました'])
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('star-button-a2')).toBeEnabled())
    expect(within(cardOf('a2')).getByRole('button', { name: '非表示' })).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: /複数選択/ }))
    for (const box of screen.getAllByRole('checkbox')) expect(box).not.toBeChecked()
  })

  test.each([
    ['日次 → 月次', 'Daily podcast generation limit reached.', 'Monthly podcast generation limit reached.', '本日の生成上限に達しました', '今月の生成上限'],
    ['月次 → 日次', 'Monthly podcast generation limit reached.', 'Daily podcast generation limit reached.', '今月の生成上限に達しました', '本日の生成上限'],
  ])('web-slice-catalog-03 verifies: CI-PG6.3・CM5 — 一括 Star で 429 が %s の順なら、最初のものの文言だけを出す', async (_label, firstDetail, secondDetail, expected, other) => {
    gw.respond('GET', FEED_PATH, feedOk())
    gw.respond('POST', starPath('a1'), {
      ok: false,
      failure: { kind: 'rate_limited', retryAfterSeconds: 3600, scope: 'unknown', detail: firstDetail },
    })
    gw.respond('POST', starPath('a2'), {
      ok: false,
      failure: { kind: 'rate_limited', retryAfterSeconds: 3600, scope: 'unknown', detail: secondDetail },
    })

    renderFeedPage()
    await waitFor(() => screen.getByText(A1_TITLE))
    await userEvent.click(screen.getByRole('button', { name: /複数選択/ }))
    for (const box of screen.getAllByRole('checkbox')) await userEvent.click(box)
    await userEvent.click(screen.getByRole('button', { name: /2件を一括スター/ }))

    await waitFor(() => expect(toastTexts()).toHaveLength(1))
    expect(toastTexts()[0]).toContain(expected)
    expect(toastTexts()[0]).not.toContain(other)
  })

  test('web-slice-catalog-03 verifies: CI-PG1.6・1.7・FD2 — getStarredArticles が未解決でも getFeed の記事が出て読み込み中が解け、starred は解決後に Star タブへ反映される', async () => {
    const starred = deferResponse()
    gw.respond('GET', FEED_PATH, feedOk())
    gw.respondWith('GET', STARRED_PATH, () => starred.promise)

    renderFeedPage()

    await waitFor(() => screen.getByText(A1_TITLE))
    expect(screen.queryByRole('status', { name: '読み込み中' })).not.toBeInTheDocument()
    await act(async () => {
      starred.resolve(starredOk([ART2]))
    })
    await waitFor(() => expect(feedTabs().getByRole('button', { name: /スター済み/ })).toHaveTextContent('1'))
    await openStarredTab()
    expect(screen.getByText(A2_TITLE)).toBeInTheDocument()
    expect(screen.queryByText(A1_TITLE)).not.toBeInTheDocument()
  })

  test('web-slice-catalog-03 verifies: CI-PG5.3・5.10・CM4 — 解除の確認を同じ tick に 2 回押しても DELETE は 1 回で、解除ボタンは busy のまま、toast は 1 回目の結果の 1 件だけ', async () => {
    const del = deferResponse()
    respondStarredA1Unstar(() => del.promise)

    const confirmButton = await openUnstarDialogForA1()
    await act(async () => {
      fireEvent.click(confirmButton)
      fireEvent.click(confirmButton)
    })

    expect(callsTo('DELETE', starPath('a1'))).toHaveLength(1)
    expect(screen.getByTestId('unstar-button-a1')).toBeDisabled()
    expect(toastTexts()).toEqual([])

    await act(async () => {
      del.resolve({ ok: true, value: undefined })
    })
    await waitFor(() => expect(toastTexts()).toEqual(['スターを解除しました']))
  })

  test('web-slice-catalog-03 verifies: CI-PG1.9・1.10・FD6 — 古い取得が starred の reject を伴って決着しても、表示は後発のままで、starred の失敗のログは出る', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const feed1 = deferResponse()
      const feed2 = deferResponse()
      const starred1 = deferResponse()
      const starred2 = deferResponse()
      gw.respondWith('GET', FEED_PATH, () => (callsTo('GET', FEED_PATH).length === 1 ? feed1.promise : feed2.promise))
      gw.respondWith('GET', STARRED_PATH, () => (callsTo('GET', STARRED_PATH).length === 1 ? starred1.promise : starred2.promise))

      renderFeedPage()
      await waitFor(() => expect(callsTo('GET', FEED_PATH)).toHaveLength(1))
      await userEvent.click(screen.getByRole('button', { name: /更新/ }))
      await waitFor(() => expect(callsTo('GET', FEED_PATH)).toHaveLength(2))

      await act(async () => {
        feed2.resolve(feedOk([ART2], '2026-06-11'))
        starred2.resolve(starredOk([]))
      })
      await waitFor(() => screen.getByText(A2_TITLE))
      const reason = new Error('starred1 boom')
      await act(async () => {
        feed1.resolve(feedOk(SAMPLE_ARTICLES, '2026-06-10'))
        starred1.reject(reason)
      })

      await waitFor(() => expect(spy).toHaveBeenCalledWith('[feed] starred一覧の取得に失敗', reason))
      await expect(waitFor(() => screen.getByText(A1_TITLE), { timeout: 300 })).rejects.toThrow()
      expect(screen.getByText(A2_TITLE)).toBeInTheDocument()
      expect(screen.getByText(/2026-06-11/)).toBeInTheDocument()
    } finally {
      spy.mockRestore()
    }
  })

  test('web-slice-catalog-03 verifies: CI-PG2.2 — getFeed が timeout → 「サーバーに接続できません」', async () => {
    gw.respond('GET', FEED_PATH, { ok: false, failure: { kind: 'timeout' } })

    renderFeedPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('サーバーに接続できません')
  })

  test('web-slice-catalog-03 verifies: CI-PG2.4 — getFeed が server 500 → 完全一致で「エラーが発生しました (500)」', async () => {
    gw.respond('GET', FEED_PATH, { ok: false, failure: { kind: 'server', status: 500 } })

    renderFeedPage()

    expect((await screen.findByRole('alert')).textContent).toBe('エラーが発生しました (500)')
  })

  test('web-slice-catalog-03 verifies: CI-PG2.5 — getFeed が forbidden → 完全一致で「エラーが発生しました」', async () => {
    gw.respond('GET', FEED_PATH, { ok: false, failure: { kind: 'forbidden' } })

    renderFeedPage()

    expect((await screen.findByRole('alert')).textContent).toBe('エラーが発生しました')
  })

  test('web-slice-catalog-03 verifies: CI-PG1.9・FD6 — 先発の feed が（最新のうちに）決着して描いた後、更新で後発が始まり、その後で先発の starred が決着しても Star タブへ反映しない', async () => {
    const starred1 = deferResponse()
    const starred2 = deferResponse()
    const feed2 = deferResponse()
    gw.respondWith('GET', FEED_PATH, () => (callsTo('GET', FEED_PATH).length === 1 ? Promise.resolve(feedOk()) : feed2.promise))
    gw.respondWith('GET', STARRED_PATH, () => (callsTo('GET', STARRED_PATH).length === 1 ? starred1.promise : starred2.promise))

    renderFeedPage()
    await waitFor(() => screen.getByText(A1_TITLE))
    await userEvent.click(screen.getByRole('button', { name: /更新/ }))
    await waitFor(() => expect(callsTo('GET', FEED_PATH)).toHaveLength(2))

    await act(async () => {
      starred1.resolve(starredOk([ART1]))
    })
    await act(async () => {
      feed2.resolve(feedOk())
      starred2.resolve(starredOk([]))
    })
    await waitFor(() => screen.getByText(A1_TITLE))
    await openStarredTab()

    expect(screen.getByText('スター済みの記事はありません')).toBeInTheDocument()
    expect(screen.queryByText(A1_TITLE)).not.toBeInTheDocument()
  })

  test('web-slice-catalog-03 verifies: CI-PG3.7・3.10 — Star が server 500 → 「エラーが発生しました (500)」。応答が未解決の間は star ボタンが disabled で、決着後に enabled', async () => {
    const star = deferResponse()
    gw.respond('GET', FEED_PATH, feedOk())
    gw.respondWith('POST', starPath('a1'), () => star.promise)

    renderFeedPage()
    await waitFor(() => screen.getByText(A1_TITLE))
    await userEvent.click(screen.getByTestId('star-button-a1'))
    await waitFor(() => expect(screen.getByTestId('star-button-a1')).toBeDisabled())

    await act(async () => {
      star.resolve({ ok: false, failure: { kind: 'server', status: 500 } })
    })

    await waitFor(() => expect(toastTexts()).toEqual(['エラーが発生しました (500)']))
    await waitFor(() => expect(screen.getByTestId('star-button-a1')).toBeEnabled())
  })

  test('web-slice-catalog-03 verifies: CI-PG3.8 — Star が forbidden → 完全一致で「エラーが発生しました」', async () => {
    gw.respond('GET', FEED_PATH, feedOk())
    gw.respond('POST', starPath('a1'), { ok: false, failure: { kind: 'forbidden' } })

    renderFeedPage()
    await waitFor(() => screen.getByText(A1_TITLE))
    await userEvent.click(screen.getByTestId('star-button-a1'))

    await waitFor(() => expect(toastTexts()).toEqual(['エラーが発生しました']))
  })

  test('web-slice-catalog-03 verifies: CI-PG4.2・4.5 — Dismiss が server 500 → 「エラーが発生しました (500)」。toast の後に a1 の「非表示」が enabled', async () => {
    gw.respond('GET', FEED_PATH, feedOk())
    gw.respond('POST', dismissPath('a1'), { ok: false, failure: { kind: 'server', status: 500 } })

    renderFeedPage()
    await waitFor(() => screen.getByText(A1_TITLE))
    await userEvent.click(within(cardOf('a1')).getByRole('button', { name: '非表示' }))

    await waitFor(() => expect(toastTexts()).toEqual(['エラーが発生しました (500)']))
    await waitFor(() => expect(within(cardOf('a1')).getByRole('button', { name: '非表示' })).toBeEnabled())
  })

  test('web-slice-catalog-03 verifies: CI-PG4.3・4.5 — Dismiss が unauthorized → 完全一致で「エラーが発生しました」（unauthorized の分岐は無い）。toast の後に a1 の「非表示」が enabled', async () => {
    gw.respond('GET', FEED_PATH, feedOk())
    gw.respond('POST', dismissPath('a1'), { ok: false, failure: { kind: 'unauthorized' } })

    renderFeedPage()
    await waitFor(() => screen.getByText(A1_TITLE))
    await userEvent.click(within(cardOf('a1')).getByRole('button', { name: '非表示' }))

    await waitFor(() => expect(toastTexts()).toEqual(['エラーが発生しました']))
    await waitFor(() => expect(within(cardOf('a1')).getByRole('button', { name: '非表示' })).toBeEnabled())
  })

  test('web-slice-catalog-03 verifies: CI-PG5.5 — Unstar が not_found → 「記事が見つかりません」。すべてタブからも除かれ、更新で戻った a1 は starredIds からも除かれていて「スターする」', async () => {
    respondStarredA1Unstar({ ok: false, failure: { kind: 'not_found' } })

    const confirmButton = await openUnstarDialogForA1()
    await userEvent.click(confirmButton)

    await waitFor(() => expect(toastTexts()).toEqual(['記事が見つかりません']))
    await userEvent.click(feedTabs().getByRole('button', { name: /すべて/ }))
    expect(screen.queryByText(A1_TITLE)).not.toBeInTheDocument()
    expect(screen.getByText(A2_TITLE)).toBeInTheDocument()

    gw.respond('GET', FEED_PATH, feedOk())
    gw.respond('GET', STARRED_PATH, starredOk([]))
    await userEvent.click(screen.getByRole('button', { name: /更新/ }))
    await waitFor(() => expect(screen.getByTestId('star-button-a1')).toBeInTheDocument())
    expect(screen.getByTestId('star-button-a1')).toHaveAttribute('aria-label', 'スターする')
  })

  test('web-slice-catalog-03 verifies: CI-PG5.6・5.10 — Unstar が unauthorized → 「API キーが正しくありません」。toast の後に解除ボタンが enabled', async () => {
    respondStarredA1Unstar({ ok: false, failure: { kind: 'unauthorized' } })

    await userEvent.click(await openUnstarDialogForA1())

    await waitFor(() => expect(toastTexts()).toEqual(['API キーが正しくありません']))
    await waitFor(() => expect(screen.getByTestId('unstar-button-a1')).toBeEnabled())
  })

  test('web-slice-catalog-03 verifies: CI-PG5.8・5.10 — Unstar が forbidden → 完全一致で「エラーが発生しました」。toast の後に解除ボタンが enabled', async () => {
    respondStarredA1Unstar({ ok: false, failure: { kind: 'forbidden' } })

    await userEvent.click(await openUnstarDialogForA1())

    await waitFor(() => expect(toastTexts()).toEqual(['エラーが発生しました']))
    await waitFor(() => expect(screen.getByTestId('unstar-button-a1')).toBeEnabled())
  })

  test('web-slice-catalog-03 verifies: CI-PG5.9・5.10 — Unstar が reject → 「予期しないエラーが発生しました」。toast の後に解除ボタンが enabled', async () => {
    respondStarredA1Unstar(() => Promise.reject(new Error('boom')))

    await userEvent.click(await openUnstarDialogForA1())

    await waitFor(() => expect(toastTexts()).toEqual(['予期しないエラーが発生しました']))
    await waitFor(() => expect(screen.getByTestId('unstar-button-a1')).toBeEnabled())
  })

  test('web-slice-catalog-03 verifies: CI-PG5.7・5.10 — Unstar が server 500 → 「エラーが発生しました (500)」。toast の後に解除ボタンが enabled', async () => {
    respondStarredA1Unstar({ ok: false, failure: { kind: 'server', status: 500 } })

    await userEvent.click(await openUnstarDialogForA1())

    await waitFor(() => expect(toastTexts()).toEqual(['エラーが発生しました (500)']))
    await waitFor(() => expect(screen.getByTestId('unstar-button-a1')).toBeEnabled())
  })

  test('web-slice-catalog-03 verifies: CI-PG1.12・1.13・1.7 — 更新で feed は ok・starred は未解決のとき、feed と starred のエラー表示は開始時に消えていて、starred を解決すると反映される', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      gw.respond('GET', FEED_PATH, { ok: false, failure: { kind: 'network' } })
      gw.respond('GET', STARRED_PATH, { ok: false, failure: { kind: 'network' } })

      renderFeedPage()
      expect(await screen.findByRole('alert')).toHaveTextContent('サーバーに接続できません')

      const starred = deferResponse()
      gw.respond('GET', FEED_PATH, feedOk())
      gw.respondWith('GET', STARRED_PATH, () => starred.promise)
      await userEvent.click(screen.getByRole('button', { name: /更新/ }))
      await waitFor(() => screen.getByText(A1_TITLE))

      expect(screen.queryByText('サーバーに接続できません')).not.toBeInTheDocument()
      await openStarredTab()
      expect(screen.queryByText('スター済み記事の取得に失敗しました')).not.toBeInTheDocument()
      expect(screen.getByText('スター済みの記事はありません')).toBeInTheDocument()

      await act(async () => {
        starred.resolve(starredOk([ART1]))
      })
      await waitFor(() => expect(screen.getByText(A1_TITLE)).toBeInTheDocument())
    } finally {
      spy.mockRestore()
    }
  })

  test('web-slice-catalog-03 verifies: CI-PG10・PG3.3 — a1・a2 の Star が未解決のまま a2 → a1 の順に解決しても、Star タブに a1・a2 の両方が出る', async () => {
    const star1 = deferResponse()
    const star2 = deferResponse()
    gw.respond('GET', FEED_PATH, feedOk())
    gw.respondWith('POST', starPath('a1'), () => star1.promise)
    gw.respondWith('POST', starPath('a2'), () => star2.promise)

    renderFeedPage()
    await waitFor(() => screen.getByText(A1_TITLE))
    await userEvent.click(screen.getByTestId('star-button-a1'))
    await userEvent.click(screen.getByTestId('star-button-a2'))

    await act(async () => {
      star2.resolve({ ok: true, value: { status: 'starred', article_id: 'a2' } })
    })
    await act(async () => {
      star1.resolve({ ok: true, value: { status: 'starred', article_id: 'a1' } })
    })
    await openStarredTab()

    expect(screen.getByText(A1_TITLE)).toBeInTheDocument()
    expect(screen.getByText(A2_TITLE)).toBeInTheDocument()
    expect(feedTabs().getByRole('button', { name: /スター済み/ })).toHaveTextContent('2')
  })

  test('web-slice-catalog-03 verifies: CI-PG10・PG1.7 — feed は解決・starred は未解決で a1 の Star が未解決のまま、starred を [a2] で解決し、その後 Star を解決 → Star タブに a2 と a1 の両方', async () => {
    const starred = deferResponse()
    const star1 = deferResponse()
    gw.respond('GET', FEED_PATH, feedOk())
    gw.respondWith('GET', STARRED_PATH, () => starred.promise)
    gw.respondWith('POST', starPath('a1'), () => star1.promise)

    renderFeedPage()
    await waitFor(() => screen.getByText(A1_TITLE))
    await userEvent.click(screen.getByTestId('star-button-a1'))
    await act(async () => {
      starred.resolve(starredOk([ART2]))
    })
    await act(async () => {
      star1.resolve({ ok: true, value: { status: 'starred', article_id: 'a1' } })
    })
    await openStarredTab()

    expect(screen.getByText(A2_TITLE)).toBeInTheDocument()
    expect(screen.getByText(A1_TITLE)).toBeInTheDocument()
  })

  test('web-slice-catalog-03 verifies: CI-PG1.3・PG7.2・AR2 — feed の a1 が is_starred なら「スター済み」。is_starred が欠落した更新でも「スター済み」のまま', async () => {
    gw.respond('GET', FEED_PATH, feedOk([{ ...ART1, is_starred: true }, ART2]))

    renderFeedPage()
    await waitFor(() => expect(screen.getByTestId('star-button-a1')).toHaveAttribute('aria-label', 'スター済み'))

    gw.respond('GET', FEED_PATH, feedOk([ART1, ART2]))
    await userEvent.click(screen.getByRole('button', { name: /更新/ }))
    await waitFor(() => expect(callsTo('GET', FEED_PATH)).toHaveLength(2))
    await waitFor(() => expect(screen.getByTestId('star-button-a1')).toBeInTheDocument())

    expect(screen.getByTestId('star-button-a1')).toHaveAttribute('aria-label', 'スター済み')
    expect(screen.getByTestId('star-button-a2')).toHaveAttribute('aria-label', 'スターする')
  })

  test('web-slice-catalog-03 verifies: CI-PG3.4 — すべてタブの「スター済み」の a1 を押して 404 → 「記事が見つかりません」。両タブから除かれ、更新で戻った a1 は（404 は starredIds を残すので）「スター済み」のまま', async () => {
    gw.respond('GET', FEED_PATH, feedOk([{ ...ART1, is_starred: true }, ART2]))
    gw.respond('GET', STARRED_PATH, starredOk([ART1]))
    gw.respond('POST', starPath('a1'), { ok: false, failure: { kind: 'not_found' } })

    renderFeedPage()
    await waitFor(() => expect(screen.getByTestId('star-button-a1')).toHaveAttribute('aria-label', 'スター済み'))
    await userEvent.click(screen.getByTestId('star-button-a1'))

    await waitFor(() => expect(toastTexts()).toEqual(['記事が見つかりません']))
    expect(screen.queryByText(A1_TITLE)).not.toBeInTheDocument()
    await openStarredTab()
    expect(screen.queryByText(A1_TITLE)).not.toBeInTheDocument()

    gw.respond('GET', FEED_PATH, feedOk([ART1, ART2]))
    gw.respond('GET', STARRED_PATH, starredOk([]))
    await userEvent.click(feedTabs().getByRole('button', { name: /すべて/ }))
    await userEvent.click(screen.getByRole('button', { name: /更新/ }))
    await waitFor(() => expect(screen.getByTestId('star-button-a1')).toBeInTheDocument())

    expect(screen.getByTestId('star-button-a1')).toHaveAttribute('aria-label', 'スター済み')
  })

  test('web-slice-catalog-03 verifies: CI-PG1.2 — 先発の feed が後発より後に決着しても、後発が未解決の間は loading を解かず、先発の記事も出さない', async () => {
    const feed1 = deferResponse()
    const feed2 = deferResponse()
    gw.respondWith('GET', FEED_PATH, () => (callsTo('GET', FEED_PATH).length === 1 ? feed1.promise : feed2.promise))

    renderFeedPage()
    await waitFor(() => expect(callsTo('GET', FEED_PATH)).toHaveLength(1))
    await userEvent.click(screen.getByRole('button', { name: /更新/ }))
    await waitFor(() => expect(callsTo('GET', FEED_PATH)).toHaveLength(2))

    await act(async () => {
      feed1.resolve(feedOk(SAMPLE_ARTICLES, '2026-06-10'))
    })

    await expect(waitFor(() => screen.getByText(A1_TITLE), { timeout: 300 })).rejects.toThrow()
    expect(screen.getByRole('status', { name: '読み込み中' })).toBeInTheDocument()

    await act(async () => {
      feed2.resolve(feedOk([ART2], '2026-06-11'))
    })
    await waitFor(() => screen.getByText(A2_TITLE))
    expect(screen.queryByText(A1_TITLE)).not.toBeInTheDocument()
  })

  test('web-slice-catalog-03 verifies: CI-PG4.6 — a1 を Star → Dismiss した後、更新で is_starred 無しで戻った a1 は（Dismiss は starredIds を残すので）「スター済み」', async () => {
    gw.respond('GET', FEED_PATH, feedOk())
    gw.respond('POST', starPath('a1'), { ok: true, value: { status: 'starred', article_id: 'a1' } })
    gw.respond('POST', dismissPath('a1'), { ok: true, value: { status: 'dismissed', article_id: 'a1' } })

    renderFeedPage()
    await waitFor(() => screen.getByText(A1_TITLE))
    await userEvent.click(screen.getByTestId('star-button-a1'))
    await waitFor(() => expect(screen.getByTestId('star-button-a1')).toHaveAttribute('aria-label', 'スター済み'))
    await userEvent.click(within(cardOf('a1')).getByRole('button', { name: '非表示' }))
    await waitFor(() => expect(screen.queryByText(A1_TITLE)).not.toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /更新/ }))
    await waitFor(() => expect(callsTo('GET', FEED_PATH)).toHaveLength(2))
    await waitFor(() => expect(screen.getByTestId('star-button-a1')).toBeInTheDocument())

    expect(screen.getByTestId('star-button-a1')).toHaveAttribute('aria-label', 'スター済み')
  })

  test('web-slice-catalog-03 verifies: CI-PG5.3・CM4 — 同じ tick の「確認」→ 解除ボタン →「確認」でも、2 回目の確認は何もせず、解除ボタンで開き直した確認ダイアログは開いたまま。DELETE は 1 回・toast は解決後の 1 件', async () => {
    const del = deferResponse()
    respondStarredA1Unstar(() => del.promise)

    const confirmButton = await openUnstarDialogForA1()
    const unstarButton = screen.getByTestId('unstar-button-a1')
    await act(async () => {
      fireEvent.click(confirmButton)
      fireEvent.click(unstarButton)
      fireEvent.click(confirmButton)
    })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(callsTo('DELETE', starPath('a1'))).toHaveLength(1)
    expect(toastTexts()).toEqual([])

    await act(async () => {
      del.resolve({ ok: true, value: undefined })
    })
    await waitFor(() => expect(toastTexts()).toEqual(['スターを解除しました']))
  })
})
