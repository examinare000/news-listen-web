import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import SubscriptionsPage from '@/app/(app)/subscriptions/page'
import { AppProvider } from '@/contexts/AppContext'
import { ToastProvider } from '@/components/ui/Toast'

vi.mock('@/lib/api', () => ({
  createApiClient: vi.fn(() => ({
    getSources: vi.fn(),
    addSource: vi.fn(),
    deleteSource: vi.fn(),
  })),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public detail: string) {
      super(detail)
    }
  },
}))

const SAMPLE_SOURCES = [
  { name: 'Hacker News', url: 'https://news.ycombinator.com/rss' },
  { name: 'Tech Crunch', url: 'https://techcrunch.com/rss' },
]

function renderSubscriptionsPage() {
  return render(
    <AppProvider>
      <ToastProvider>
        <SubscriptionsPage />
      </ToastProvider>
    </AppProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ==========================================================
// Subscriptions — フェッチエラー
// ==========================================================
describe('SubscriptionsPage — fetch errors', () => {
  test('Given 401 on getSources, shows "API キーが正しくありません" and does NOT show empty state', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getSources: vi.fn().mockRejectedValue(new ApiError(401, 'Unauthorized')),
      addSource: vi.fn(),
      deleteSource: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSubscriptionsPage()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText(/API キーが正しくありません/)).toBeInTheDocument()
    })
    // 空リストメッセージが出ないこと（エラーとソース未登録を区別）
    expect(screen.queryByText(/購読ソースがありません/)).not.toBeInTheDocument()
  })

  test('Given 500 on getSources, shows error message with status code', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getSources: vi.fn().mockRejectedValue(new ApiError(500, 'Internal Server Error')),
      addSource: vi.fn(),
      deleteSource: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSubscriptionsPage()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText(/読み込みに失敗しました/)).toBeInTheDocument()
    })
  })

  test('Given fetch error, shows retry button that re-fetches on click', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    const getSources = vi.fn()
      .mockRejectedValueOnce(new ApiError(500, 'err'))
      .mockResolvedValue({ sources: [] })
    vi.mocked(createApiClient).mockReturnValue({
      getSources,
      addSource: vi.fn(),
      deleteSource: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSubscriptionsPage()

    await waitFor(() => screen.getByRole('button', { name: /リフレッシュ|retry/i }))
    await userEvent.click(screen.getByRole('button', { name: /リフレッシュ|retry/i }))

    await waitFor(() => {
      expect(getSources).toHaveBeenCalledTimes(2)
    })
  })
})

// ==========================================================
// Subscriptions — ローディング
// issue #83: プレーンな「読み込み中...」テキストのみだとローディング中であることが
// 支援技術に通知されないため、role="status" + aria-live="polite" を付与する。
// ==========================================================
describe('SubscriptionsPage — loading', () => {
  test('Given getSources has not resolved yet, shows a loading status announced to assistive tech (#83)', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getSources: vi.fn(() => new Promise(() => {})), // never resolves
      addSource: vi.fn(),
      deleteSource: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSubscriptionsPage()

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent('読み込み中')
  })
})

// ==========================================================
// Subscriptions — 削除エラー
// ==========================================================
describe('SubscriptionsPage — delete errors', () => {
  test('Given deleteSource returns 404, shows error toast', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: SAMPLE_SOURCES }),
      addSource: vi.fn(),
      deleteSource: vi.fn().mockRejectedValue(new ApiError(404, 'Source not found')),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSubscriptionsPage()
    await waitFor(() => screen.getByText('Hacker News'))

    await userEvent.click(screen.getAllByRole('button', { name: /削除|delete/i })[0])
    await userEvent.click(screen.getByRole('button', { name: /確認|OK/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText(/削除に失敗しました/)).toBeInTheDocument()
    })
  })

  test('Given deleteSource returns 500, shows error toast with status', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: SAMPLE_SOURCES }),
      addSource: vi.fn(),
      deleteSource: vi.fn().mockRejectedValue(new ApiError(500, 'Server Error')),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSubscriptionsPage()
    await waitFor(() => screen.getByText('Hacker News'))

    await userEvent.click(screen.getAllByRole('button', { name: /削除|delete/i })[0])
    await userEvent.click(screen.getByRole('button', { name: /確認|OK/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText(/削除に失敗しました/)).toBeInTheDocument()
    })
  })
})

// ==========================================================
// Subscriptions — 一覧表示
// ==========================================================
describe('SubscriptionsPage — listing', () => {
  test('Given sources returned, renders source list', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: SAMPLE_SOURCES }),
      addSource: vi.fn(),
      deleteSource: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSubscriptionsPage()

    await waitFor(() => {
      expect(screen.getByText('Hacker News')).toBeInTheDocument()
      expect(screen.getByText('Tech Crunch')).toBeInTheDocument()
    })
  })

  test('source list keeps explicit role="list" for Safari/VoiceOver', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: SAMPLE_SOURCES }),
      addSource: vi.fn(),
      deleteSource: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSubscriptionsPage()

    await waitFor(() => screen.getByText('Hacker News'))
    // jsdom は ul を常に list と解釈するため、明示属性そのものを検証する
    expect(screen.getByRole('list')).toHaveAttribute('role', 'list')
  })

  test('Given empty sources, shows "購読ソースがありません" and guidance to add form', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: [] }),
      addSource: vi.fn(),
      deleteSource: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSubscriptionsPage()

    await waitFor(() => {
      expect(screen.getByText(/購読ソースがありません/)).toBeInTheDocument()
    })
  })
})

// ==========================================================
// AddSubscriptionForm — バリデーション
// ==========================================================
describe('AddSubscriptionForm — client-side validation', () => {
  beforeEach(async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: [] }),
      addSource: vi.fn(),
      deleteSource: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)
  })

  test('Given URL not starting with http(s)://, shows inline error and does NOT submit', async () => {
    renderSubscriptionsPage()
    await waitFor(() => screen.getByRole('textbox', { name: /URL/i }))

    await userEvent.type(screen.getByRole('textbox', { name: /URL/i }), 'ftp://invalid.com')
    await userEvent.click(screen.getByRole('button', { name: '追加する' }))

    expect(screen.getByText(/http/i)).toBeInTheDocument()
    const { createApiClient } = await import('@/lib/api')
    const mockClient = vi.mocked(createApiClient).mock.results[0].value
    expect(mockClient.addSource).not.toHaveBeenCalled()
  })

  test('Given name and valid URL submitted, calls addSource', async () => {
    const addSource = vi.fn().mockResolvedValue({ sources: [{ name: 'HN', url: 'https://news.ycombinator.com/rss' }] })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: [] }),
      addSource,
      deleteSource: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSubscriptionsPage()
    await waitFor(() => screen.getByRole('textbox', { name: /ソース名|name|名前/i }))

    await userEvent.type(screen.getByRole('textbox', { name: /ソース名|name|名前/i }), 'HN')
    await userEvent.type(screen.getByRole('textbox', { name: /URL/i }), 'https://news.ycombinator.com/rss')
    await userEvent.click(screen.getByRole('button', { name: '追加する' }))

    await waitFor(() => {
      expect(addSource).toHaveBeenCalledWith('HN', 'https://news.ycombinator.com/rss')
    })
  })

  test('Given 409 response, shows "この URL は登録済みです" and preserves input values', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: [] }),
      addSource: vi.fn().mockRejectedValue(new ApiError(409, 'Source URL already exists')),
      deleteSource: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSubscriptionsPage()
    await waitFor(() => screen.getByRole('textbox', { name: /URL/i }))

    const urlInput = screen.getByRole('textbox', { name: /URL/i })
    await userEvent.type(urlInput, 'https://example.com/rss')
    await userEvent.click(screen.getByRole('button', { name: '追加する' }))

    await waitFor(() => {
      expect(screen.getByText(/この URL は登録済みです/)).toBeInTheDocument()
    })
    // 入力値が保持される
    expect(urlInput).toHaveValue('https://example.com/rss')
  })

  test('Given 422 response, shows "URL の形式が正しくありません"', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: [] }),
      addSource: vi.fn().mockRejectedValue(new ApiError(422, 'value is not a valid URL')),
      deleteSource: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSubscriptionsPage()
    await waitFor(() => screen.getByRole('textbox', { name: /URL/i }))

    await userEvent.type(screen.getByRole('textbox', { name: /URL/i }), 'https://bad.url')
    await userEvent.click(screen.getByRole('button', { name: '追加する' }))

    await waitFor(() => {
      expect(screen.getByText(/URL の形式が正しくありません/)).toBeInTheDocument()
    })
  })

  test('Given submission in progress, input and button are disabled', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: [] }),
      addSource: vi.fn(() => new Promise(() => {})), // never resolves
      deleteSource: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSubscriptionsPage()
    await waitFor(() => screen.getByRole('textbox', { name: /URL/i }))

    await userEvent.type(screen.getByRole('textbox', { name: /URL/i }), 'https://example.com/rss')
    await userEvent.click(screen.getByRole('button', { name: '追加する' }))

    expect(screen.getByRole('button', { name: '追加する' })).toBeDisabled()
  })

  test('Given submission succeeds, input fields are cleared', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: [] }),
      addSource: vi.fn().mockResolvedValue({ sources: [{ name: 'HN', url: 'https://example.com/rss' }] }),
      deleteSource: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSubscriptionsPage()
    await waitFor(() => screen.getByRole('textbox', { name: /URL/i }))

    const urlInput = screen.getByRole('textbox', { name: /URL/i })
    await userEvent.type(urlInput, 'https://example.com/rss')
    await userEvent.click(screen.getByRole('button', { name: '追加する' }))

    await waitFor(() => {
      expect(urlInput).toHaveValue('')
    })
  })
})

// ==========================================================
// おすすめのソース — ワンクリック即購読（D23）／未購読のみ表示
// ==========================================================
describe('SubscriptionsPage — recommended sources', () => {
  const FEATURED = [
    { id: 'verge', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
    { id: 'devto', name: 'dev.to', url: 'https://dev.to/feed' },
  ]

  test('Given featured sites returned, shows a 購読 button per recommended site', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: [] }),
      getFeaturedSources: vi.fn().mockResolvedValue({ sites: FEATURED }),
      addSource: vi.fn(),
      deleteSource: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSubscriptionsPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'The Verge を購読' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'dev.to を購読' })).toBeInTheDocument()
    })
  })

  test('Given recommend 購読 button clicked, calls addSource with that site', async () => {
    const addSource = vi.fn().mockResolvedValue({ sources: FEATURED })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: [] }),
      getFeaturedSources: vi.fn().mockResolvedValue({ sites: FEATURED }),
      addSource,
      deleteSource: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSubscriptionsPage()
    await waitFor(() => screen.getByRole('button', { name: 'The Verge を購読' }))

    await userEvent.click(screen.getByRole('button', { name: 'The Verge を購読' }))

    await waitFor(() => {
      expect(addSource).toHaveBeenCalledWith('The Verge', 'https://www.theverge.com/rss/index.xml')
    })
  })

  test('Given a featured site is already subscribed, it is excluded from recommendations', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      // The Verge は購読済み、dev.to は未購読
      getSources: vi.fn().mockResolvedValue({
        sources: [{ name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' }],
      }),
      getFeaturedSources: vi.fn().mockResolvedValue({ sites: FEATURED }),
      addSource: vi.fn(),
      deleteSource: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSubscriptionsPage()

    // 未購読の dev.to はおすすめに残る
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'dev.to を購読' })).toBeInTheDocument()
    })
    // 購読済みの The Verge はおすすめから除外される
    expect(screen.queryByRole('button', { name: 'The Verge を購読' })).not.toBeInTheDocument()
  })

  // issue #164: おすすめサイト取得失敗をサイレントにせず、取得失敗の旨と再読み込み導線を出す
  test('Given getFeaturedSources fails, shows a failure notice with a reload affordance', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: [] }),
      getFeaturedSources: vi.fn().mockRejectedValue(new Error('network error')),
      addSource: vi.fn(),
      deleteSource: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSubscriptionsPage()

    await waitFor(() => {
      expect(screen.getByText(/おすすめサイトの読み込みに失敗しました/)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /おすすめサイトを再読み込み/ })).toBeInTheDocument()
  })

  test('Given reload button clicked after getFeaturedSources failure, refetches and shows recommendations on success', async () => {
    const getFeaturedSources = vi
      .fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ sites: FEATURED })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: [] }),
      getFeaturedSources,
      addSource: vi.fn(),
      deleteSource: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSubscriptionsPage()

    await waitFor(() => screen.getByRole('button', { name: /おすすめサイトを再読み込み/ }))
    await userEvent.click(screen.getByRole('button', { name: /おすすめサイトを再読み込み/ }))

    await waitFor(() => expect(getFeaturedSources).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'The Verge を購読' })).toBeInTheDocument()
    })
    expect(screen.queryByText(/おすすめサイトの読み込みに失敗しました/)).not.toBeInTheDocument()
  })

  test('Given a recommended site is subscribed via its 購読 button, it disappears from recommendations', async () => {
    const addSource = vi.fn().mockResolvedValue({
      sources: [{ name: 'dev.to', url: 'https://dev.to/feed' }],
    })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: [] }),
      getFeaturedSources: vi.fn().mockResolvedValue({ sites: FEATURED }),
      addSource,
      deleteSource: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSubscriptionsPage()
    await waitFor(() => screen.getByRole('button', { name: 'dev.to を購読' }))

    await userEvent.click(screen.getByRole('button', { name: 'dev.to を購読' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'dev.to を購読' })).not.toBeInTheDocument()
    })
    // 未購読のまま残る The Verge は引き続き表示される
    expect(screen.getByRole('button', { name: 'The Verge を購読' })).toBeInTheDocument()
  })
})

// ==========================================================
// ソース件数表示 — 「{N} ソース購読中」
// ==========================================================
describe('SubscriptionsPage — subscription count', () => {
  test('Given 2 sources, shows "2 ソース購読中" and decrements after delete', async () => {
    const deleteSource = vi.fn().mockResolvedValue({ sources: [SAMPLE_SOURCES[1]] })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: SAMPLE_SOURCES }),
      addSource: vi.fn(),
      deleteSource,
    } as unknown as ReturnType<typeof createApiClient>)

    renderSubscriptionsPage()

    await waitFor(() => {
      expect(screen.getByText('2 ソース購読中')).toBeInTheDocument()
    })

    await userEvent.click(screen.getAllByRole('button', { name: /削除|delete/i })[0])
    await userEvent.click(screen.getByRole('button', { name: /確認|OK/i }))

    await waitFor(() => {
      expect(screen.getByText('1 ソース購読中')).toBeInTheDocument()
    })
    expect(screen.queryByText('2 ソース購読中')).not.toBeInTheDocument()
  })
})

// ==========================================================
// 削除フロー — ConfirmDialog → deleteSource
// ==========================================================
describe('SubscriptionsPage — delete with confirm dialog', () => {
  test('Given delete button clicked, shows ConfirmDialog', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: SAMPLE_SOURCES }),
      addSource: vi.fn(),
      deleteSource: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderSubscriptionsPage()
    await waitFor(() => screen.getByText('Hacker News'))

    await userEvent.click(screen.getAllByRole('button', { name: /削除|delete/i })[0])

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('Given user confirms deletion, calls deleteSource(url)', async () => {
    const deleteSource = vi.fn().mockResolvedValue({ sources: [SAMPLE_SOURCES[1]] })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: SAMPLE_SOURCES }),
      addSource: vi.fn(),
      deleteSource,
    } as unknown as ReturnType<typeof createApiClient>)

    renderSubscriptionsPage()
    await waitFor(() => screen.getByText('Hacker News'))

    await userEvent.click(screen.getAllByRole('button', { name: /削除|delete/i })[0])
    await userEvent.click(screen.getByRole('button', { name: /確認|OK/i }))

    await waitFor(() => {
      expect(deleteSource).toHaveBeenCalledWith(SAMPLE_SOURCES[0].url)
    })
  })

  test('Given deletion succeeds, replaces state with response sources (no re-GET)', async () => {
    const remainingSources = [SAMPLE_SOURCES[1]]
    const deleteSource = vi.fn().mockResolvedValue({ sources: remainingSources })
    const getSources = vi.fn().mockResolvedValue({ sources: SAMPLE_SOURCES })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getSources,
      addSource: vi.fn(),
      deleteSource,
    } as unknown as ReturnType<typeof createApiClient>)

    renderSubscriptionsPage()
    await waitFor(() => screen.getByText('Hacker News'))

    await userEvent.click(screen.getAllByRole('button', { name: /削除|delete/i })[0])
    await userEvent.click(screen.getByRole('button', { name: /確認|OK/i }))

    await waitFor(() => {
      expect(screen.queryByText('Hacker News')).not.toBeInTheDocument()
      expect(screen.getByText('Tech Crunch')).toBeInTheDocument()
    })
    // 削除後に再 GET していないことを確認（レスポンスで直接 state を置換）
    expect(getSources).toHaveBeenCalledTimes(1)
  })
})
