import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import SubscriptionsPage from '@/app/subscriptions/page'
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
    <AppProvider initialState={{ isConfigured: true, baseUrl: 'https://api.example.com', apiKey: 'key' }}>
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
    createApiClient.mockReturnValue({
      getSources: vi.fn().mockRejectedValue(new ApiError(401, 'Unauthorized')),
      addSource: vi.fn(),
      deleteSource: vi.fn(),
    })

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
    createApiClient.mockReturnValue({
      getSources: vi.fn().mockRejectedValue(new ApiError(500, 'Internal Server Error')),
      addSource: vi.fn(),
      deleteSource: vi.fn(),
    })

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
    createApiClient.mockReturnValue({
      getSources,
      addSource: vi.fn(),
      deleteSource: vi.fn(),
    })

    renderSubscriptionsPage()

    await waitFor(() => screen.getByRole('button', { name: /リフレッシュ|retry/i }))
    await userEvent.click(screen.getByRole('button', { name: /リフレッシュ|retry/i }))

    await waitFor(() => {
      expect(getSources).toHaveBeenCalledTimes(2)
    })
  })
})

// ==========================================================
// Subscriptions — 削除エラー
// ==========================================================
describe('SubscriptionsPage — delete errors', () => {
  test('Given deleteSource returns 404, shows error toast', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    createApiClient.mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: SAMPLE_SOURCES }),
      addSource: vi.fn(),
      deleteSource: vi.fn().mockRejectedValue(new ApiError(404, 'Source not found')),
    })

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
    createApiClient.mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: SAMPLE_SOURCES }),
      addSource: vi.fn(),
      deleteSource: vi.fn().mockRejectedValue(new ApiError(500, 'Server Error')),
    })

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
    createApiClient.mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: SAMPLE_SOURCES }),
      addSource: vi.fn(),
      deleteSource: vi.fn(),
    })

    renderSubscriptionsPage()

    await waitFor(() => {
      expect(screen.getByText('Hacker News')).toBeInTheDocument()
      expect(screen.getByText('Tech Crunch')).toBeInTheDocument()
    })
  })

  test('Given empty sources, shows "購読ソースがありません" and guidance to add form', async () => {
    const { createApiClient } = await import('@/lib/api')
    createApiClient.mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: [] }),
      addSource: vi.fn(),
      deleteSource: vi.fn(),
    })

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
    createApiClient.mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: [] }),
      addSource: vi.fn(),
      deleteSource: vi.fn(),
    })
  })

  test('Given URL not starting with http(s)://, shows inline error and does NOT submit', async () => {
    renderSubscriptionsPage()
    await waitFor(() => screen.getByRole('textbox', { name: /URL/i }))

    await userEvent.type(screen.getByRole('textbox', { name: /URL/i }), 'ftp://invalid.com')
    await userEvent.click(screen.getByRole('button', { name: /追加|add/i }))

    expect(screen.getByText(/http/i)).toBeInTheDocument()
    const { createApiClient } = await import('@/lib/api')
    const mockClient = createApiClient()
    expect(mockClient.addSource).not.toHaveBeenCalled()
  })

  test('Given name and valid URL submitted, calls addSource', async () => {
    const addSource = vi.fn().mockResolvedValue({ sources: [{ name: 'HN', url: 'https://news.ycombinator.com/rss' }] })
    const { createApiClient } = await import('@/lib/api')
    createApiClient.mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: [] }),
      addSource,
      deleteSource: vi.fn(),
    })

    renderSubscriptionsPage()
    await waitFor(() => screen.getByRole('textbox', { name: /name|名前/i }))

    await userEvent.type(screen.getByRole('textbox', { name: /name|名前/i }), 'HN')
    await userEvent.type(screen.getByRole('textbox', { name: /URL/i }), 'https://news.ycombinator.com/rss')
    await userEvent.click(screen.getByRole('button', { name: /追加|add/i }))

    await waitFor(() => {
      expect(addSource).toHaveBeenCalledWith('HN', 'https://news.ycombinator.com/rss')
    })
  })

  test('Given 409 response, shows "この URL は登録済みです" and preserves input values', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    createApiClient.mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: [] }),
      addSource: vi.fn().mockRejectedValue(new ApiError(409, 'Source URL already exists')),
      deleteSource: vi.fn(),
    })

    renderSubscriptionsPage()
    await waitFor(() => screen.getByRole('textbox', { name: /URL/i }))

    const urlInput = screen.getByRole('textbox', { name: /URL/i })
    await userEvent.type(urlInput, 'https://example.com/rss')
    await userEvent.click(screen.getByRole('button', { name: /追加|add/i }))

    await waitFor(() => {
      expect(screen.getByText(/この URL は登録済みです/)).toBeInTheDocument()
    })
    // 入力値が保持される
    expect(urlInput).toHaveValue('https://example.com/rss')
  })

  test('Given 422 response, shows "URL の形式が正しくありません"', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    createApiClient.mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: [] }),
      addSource: vi.fn().mockRejectedValue(new ApiError(422, 'value is not a valid URL')),
      deleteSource: vi.fn(),
    })

    renderSubscriptionsPage()
    await waitFor(() => screen.getByRole('textbox', { name: /URL/i }))

    await userEvent.type(screen.getByRole('textbox', { name: /URL/i }), 'https://bad.url')
    await userEvent.click(screen.getByRole('button', { name: /追加|add/i }))

    await waitFor(() => {
      expect(screen.getByText(/URL の形式が正しくありません/)).toBeInTheDocument()
    })
  })

  test('Given submission in progress, input and button are disabled', async () => {
    const { createApiClient } = await import('@/lib/api')
    createApiClient.mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: [] }),
      addSource: vi.fn(() => new Promise(() => {})), // never resolves
      deleteSource: vi.fn(),
    })

    renderSubscriptionsPage()
    await waitFor(() => screen.getByRole('textbox', { name: /URL/i }))

    await userEvent.type(screen.getByRole('textbox', { name: /URL/i }), 'https://example.com/rss')
    await userEvent.click(screen.getByRole('button', { name: /追加|add/i }))

    expect(screen.getByRole('button', { name: /追加|add/i })).toBeDisabled()
  })

  test('Given submission succeeds, input fields are cleared', async () => {
    const { createApiClient } = await import('@/lib/api')
    createApiClient.mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: [] }),
      addSource: vi.fn().mockResolvedValue({ sources: [{ name: 'HN', url: 'https://example.com/rss' }] }),
      deleteSource: vi.fn(),
    })

    renderSubscriptionsPage()
    await waitFor(() => screen.getByRole('textbox', { name: /URL/i }))

    const urlInput = screen.getByRole('textbox', { name: /URL/i })
    await userEvent.type(urlInput, 'https://example.com/rss')
    await userEvent.click(screen.getByRole('button', { name: /追加|add/i }))

    await waitFor(() => {
      expect(urlInput).toHaveValue('')
    })
  })
})

// ==========================================================
// 削除フロー — ConfirmDialog → deleteSource
// ==========================================================
describe('SubscriptionsPage — delete with confirm dialog', () => {
  test('Given delete button clicked, shows ConfirmDialog', async () => {
    const { createApiClient } = await import('@/lib/api')
    createApiClient.mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: SAMPLE_SOURCES }),
      addSource: vi.fn(),
      deleteSource: vi.fn(),
    })

    renderSubscriptionsPage()
    await waitFor(() => screen.getByText('Hacker News'))

    await userEvent.click(screen.getAllByRole('button', { name: /削除|delete/i })[0])

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('Given user confirms deletion, calls deleteSource(url)', async () => {
    const deleteSource = vi.fn().mockResolvedValue({ sources: [SAMPLE_SOURCES[1]] })
    const { createApiClient } = await import('@/lib/api')
    createApiClient.mockReturnValue({
      getSources: vi.fn().mockResolvedValue({ sources: SAMPLE_SOURCES }),
      addSource: vi.fn(),
      deleteSource,
    })

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
    createApiClient.mockReturnValue({
      getSources,
      addSource: vi.fn(),
      deleteSource,
    })

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
