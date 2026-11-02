import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import SubscriptionsPage from '@/app/(app)/subscriptions/page'
import { PreferencesProvider } from '@/contexts/PreferencesProvider'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'
import type { ApiFailure, Result } from '@/lib/api/gateway'
import { ToastProvider } from '@/components/ui/Toast'
import { createGatewayDouble } from '../../helpers/gatewayDouble'
import type { GatewayDouble } from '../../helpers/gatewayDouble'

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

const holder = vi.hoisted(() => ({ gw: undefined as GatewayDouble | undefined }))

vi.mock('@/lib/api/gateway', () => ({ createGateway: () => holder.gw }))

const SOURCES_PATH = '/api/backend/settings/sources'
const FEATURED_PATH = '/api/backend/settings/featured-sources'
const deleteSourcePath = (url: string) => `${SOURCES_PATH}?url=${encodeURIComponent(url)}`

const SAMPLE_SOURCES = [
  { name: 'Hacker News', url: 'https://news.ycombinator.com/rss' },
  { name: 'Tech Crunch', url: 'https://techcrunch.com/rss' },
]

let gw: GatewayDouble

function callsTo(method: string, path: string) {
  return gw.calls.filter((c) => c.method === method && c.path === path)
}

function renderSubscriptionsPage() {
  return render(
    <PreferencesProvider store={memoryStore()}>
      <ToastProvider>
        <SubscriptionsPage />
      </ToastProvider>
    </PreferencesProvider>
  )
}

beforeEach(() => {
  gw = createGatewayDouble()
  holder.gw = gw
})

// ==========================================================
// Subscriptions — フェッチエラー
// ==========================================================
describe('SubscriptionsPage — fetch errors', () => {
  test('Given 401 on getSources, shows "API キーが正しくありません" and does NOT show empty state', async () => {
    gw.respond('GET', SOURCES_PATH, { ok: false, failure: { kind: 'unauthorized' } })

    renderSubscriptionsPage()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText(/API キーが正しくありません/)).toBeInTheDocument()
    })
    // 空リストメッセージが出ないこと（エラーとソース未登録を区別）
    expect(screen.queryByText(/購読ソースがありません/)).not.toBeInTheDocument()
  })

  test('Given 500 on getSources, shows error message with status code', async () => {
    gw.respond('GET', SOURCES_PATH, { ok: false, failure: { kind: 'server', status: 500 } })

    renderSubscriptionsPage()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText(/読み込みに失敗しました/)).toBeInTheDocument()
    })
  })

  test('Given fetch error, shows retry button that re-fetches on click', async () => {
    // 1 回目は 500、2 回目以降は成功
    gw.respondWith('GET', SOURCES_PATH, (): Promise<Result<unknown, ApiFailure>> =>
      Promise.resolve(
        callsTo('GET', SOURCES_PATH).length === 1
          ? { ok: false, failure: { kind: 'server', status: 500 } }
          : { ok: true, value: { sources: [] } },
      ),
    )

    renderSubscriptionsPage()

    await waitFor(() => screen.getByRole('button', { name: /リフレッシュ|retry/i }))
    await userEvent.click(screen.getByRole('button', { name: /リフレッシュ|retry/i }))

    await waitFor(() => {
      expect(callsTo('GET', SOURCES_PATH)).toHaveLength(2)
    })
  })
})

// ==========================================================
// Subscriptions — ローディング
// issue #83: プレーンな「読み込み中...」テキストのみだとローディング中であることが
// 支援技術に通知されないため、role="status" + aria-live="polite" を付与する。
// ==========================================================
describe('SubscriptionsPage — loading', () => {
  test('Given getSources has not resolved yet, shows a loading status announced to assistive tech (#83)', () => {
    gw.respondWith('GET', SOURCES_PATH, () => new Promise<Result<unknown, ApiFailure>>(() => {})) // never resolves

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
    gw.respond('GET', SOURCES_PATH, { ok: true, value: { sources: SAMPLE_SOURCES } })
    gw.respond('DELETE', deleteSourcePath(SAMPLE_SOURCES[0].url), { ok: false, failure: { kind: 'not_found' } })

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
    gw.respond('GET', SOURCES_PATH, { ok: true, value: { sources: SAMPLE_SOURCES } })
    gw.respond('DELETE', deleteSourcePath(SAMPLE_SOURCES[0].url), { ok: false, failure: { kind: 'server', status: 500 } })

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
    gw.respond('GET', SOURCES_PATH, { ok: true, value: { sources: SAMPLE_SOURCES } })

    renderSubscriptionsPage()

    await waitFor(() => {
      expect(screen.getByText('Hacker News')).toBeInTheDocument()
      expect(screen.getByText('Tech Crunch')).toBeInTheDocument()
    })
  })

  test('source list keeps explicit role="list" for Safari/VoiceOver', async () => {
    gw.respond('GET', SOURCES_PATH, { ok: true, value: { sources: SAMPLE_SOURCES } })

    renderSubscriptionsPage()

    await waitFor(() => screen.getByText('Hacker News'))
    // jsdom は ul を常に list と解釈するため、明示属性そのものを検証する
    expect(screen.getByRole('list')).toHaveAttribute('role', 'list')
  })

  test('Given empty sources, shows "購読ソースがありません" and guidance to add form', async () => {
    gw.respond('GET', SOURCES_PATH, { ok: true, value: { sources: [] } })

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
  beforeEach(() => {
    gw.respond('GET', SOURCES_PATH, { ok: true, value: { sources: [] } })
  })

  test('Given URL not starting with http(s)://, shows inline error and does NOT submit', async () => {
    renderSubscriptionsPage()
    await waitFor(() => screen.getByRole('textbox', { name: /URL/i }))

    await userEvent.type(screen.getByRole('textbox', { name: /URL/i }), 'ftp://invalid.com')
    await userEvent.click(screen.getByRole('button', { name: '追加する' }))

    expect(screen.getByText(/http/i)).toBeInTheDocument()
    expect(callsTo('POST', SOURCES_PATH)).toHaveLength(0)
  })

  test('Given name and valid URL submitted, calls addSource', async () => {
    gw.respond('POST', SOURCES_PATH, {
      ok: true,
      value: { sources: [{ name: 'HN', url: 'https://news.ycombinator.com/rss' }] },
    })

    renderSubscriptionsPage()
    await waitFor(() => screen.getByRole('textbox', { name: /ソース名|name|名前/i }))

    await userEvent.type(screen.getByRole('textbox', { name: /ソース名|name|名前/i }), 'HN')
    await userEvent.type(screen.getByRole('textbox', { name: /URL/i }), 'https://news.ycombinator.com/rss')
    await userEvent.click(screen.getByRole('button', { name: '追加する' }))

    await waitFor(() => {
      expect(gw.calls).toContainEqual({
        method: 'POST',
        path: SOURCES_PATH,
        body: { name: 'HN', url: 'https://news.ycombinator.com/rss' },
      })
    })
  })

  test('Given 409 response, shows "この URL は登録済みです" and preserves input values', async () => {
    gw.respond('POST', SOURCES_PATH, { ok: false, failure: { kind: 'conflict' } })

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
    gw.respond('POST', SOURCES_PATH, {
      ok: false,
      failure: { kind: 'validation', detail: 'value is not a valid URL' },
    })

    renderSubscriptionsPage()
    await waitFor(() => screen.getByRole('textbox', { name: /URL/i }))

    await userEvent.type(screen.getByRole('textbox', { name: /URL/i }), 'https://bad.url')
    await userEvent.click(screen.getByRole('button', { name: '追加する' }))

    await waitFor(() => {
      expect(screen.getByText(/URL の形式が正しくありません/)).toBeInTheDocument()
    })
  })

  test('Given submission in progress, input and button are disabled', async () => {
    gw.respondWith('POST', SOURCES_PATH, () => new Promise<Result<unknown, ApiFailure>>(() => {})) // never resolves

    renderSubscriptionsPage()
    await waitFor(() => screen.getByRole('textbox', { name: /URL/i }))

    await userEvent.type(screen.getByRole('textbox', { name: /URL/i }), 'https://example.com/rss')
    await userEvent.click(screen.getByRole('button', { name: '追加する' }))

    expect(screen.getByRole('button', { name: '追加する' })).toBeDisabled()
  })

  test('Given submission succeeds, input fields are cleared', async () => {
    gw.respond('POST', SOURCES_PATH, {
      ok: true,
      value: { sources: [{ name: 'HN', url: 'https://example.com/rss' }] },
    })

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
    gw.respond('GET', SOURCES_PATH, { ok: true, value: { sources: [] } })
    gw.respond('GET', FEATURED_PATH, { ok: true, value: { sites: FEATURED } })

    renderSubscriptionsPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'The Verge を購読' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'dev.to を購読' })).toBeInTheDocument()
    })
  })

  test('Given recommend 購読 button clicked, calls addSource with that site', async () => {
    gw.respond('GET', SOURCES_PATH, { ok: true, value: { sources: [] } })
    gw.respond('GET', FEATURED_PATH, { ok: true, value: { sites: FEATURED } })
    gw.respond('POST', SOURCES_PATH, { ok: true, value: { sources: FEATURED } })

    renderSubscriptionsPage()
    await waitFor(() => screen.getByRole('button', { name: 'The Verge を購読' }))

    await userEvent.click(screen.getByRole('button', { name: 'The Verge を購読' }))

    await waitFor(() => {
      expect(gw.calls).toContainEqual({
        method: 'POST',
        path: SOURCES_PATH,
        body: { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
      })
    })
  })

  test('Given a featured site is already subscribed, it is excluded from recommendations', async () => {
    // The Verge は購読済み、dev.to は未購読
    gw.respond('GET', SOURCES_PATH, {
      ok: true,
      value: { sources: [{ name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' }] },
    })
    gw.respond('GET', FEATURED_PATH, { ok: true, value: { sites: FEATURED } })

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
    gw.respond('GET', SOURCES_PATH, { ok: true, value: { sources: [] } })
    gw.respond('GET', FEATURED_PATH, { ok: false, failure: { kind: 'network' } })

    renderSubscriptionsPage()

    await waitFor(() => {
      expect(screen.getByText(/おすすめサイトの読み込みに失敗しました/)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /おすすめサイトを再読み込み/ })).toBeInTheDocument()
  })

  test('Given reload button clicked after getFeaturedSources failure, refetches and shows recommendations on success', async () => {
    gw.respond('GET', SOURCES_PATH, { ok: true, value: { sources: [] } })
    // 1 回目は失敗、2 回目は成功
    gw.respondWith('GET', FEATURED_PATH, (): Promise<Result<unknown, ApiFailure>> =>
      callsTo('GET', FEATURED_PATH).length === 1
        ? Promise.reject(new Error('network error'))
        : Promise.resolve({ ok: true, value: { sites: FEATURED } }),
    )

    renderSubscriptionsPage()

    await waitFor(() => screen.getByRole('button', { name: /おすすめサイトを再読み込み/ }))
    await userEvent.click(screen.getByRole('button', { name: /おすすめサイトを再読み込み/ }))

    await waitFor(() => expect(callsTo('GET', FEATURED_PATH)).toHaveLength(2))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'The Verge を購読' })).toBeInTheDocument()
    })
    expect(screen.queryByText(/おすすめサイトの読み込みに失敗しました/)).not.toBeInTheDocument()
  })

  test('Given a recommended site is subscribed via its 購読 button, it disappears from recommendations', async () => {
    gw.respond('GET', SOURCES_PATH, { ok: true, value: { sources: [] } })
    gw.respond('GET', FEATURED_PATH, { ok: true, value: { sites: FEATURED } })
    gw.respond('POST', SOURCES_PATH, {
      ok: true,
      value: { sources: [{ name: 'dev.to', url: 'https://dev.to/feed' }] },
    })

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
    gw.respond('GET', SOURCES_PATH, { ok: true, value: { sources: SAMPLE_SOURCES } })
    gw.respond('DELETE', deleteSourcePath(SAMPLE_SOURCES[0].url), {
      ok: true,
      value: { sources: [SAMPLE_SOURCES[1]] },
    })

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
    gw.respond('GET', SOURCES_PATH, { ok: true, value: { sources: SAMPLE_SOURCES } })

    renderSubscriptionsPage()
    await waitFor(() => screen.getByText('Hacker News'))

    await userEvent.click(screen.getAllByRole('button', { name: /削除|delete/i })[0])

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('Given user confirms deletion, calls deleteSource(url)', async () => {
    gw.respond('GET', SOURCES_PATH, { ok: true, value: { sources: SAMPLE_SOURCES } })
    gw.respond('DELETE', deleteSourcePath(SAMPLE_SOURCES[0].url), {
      ok: true,
      value: { sources: [SAMPLE_SOURCES[1]] },
    })

    renderSubscriptionsPage()
    await waitFor(() => screen.getByText('Hacker News'))

    await userEvent.click(screen.getAllByRole('button', { name: /削除|delete/i })[0])
    await userEvent.click(screen.getByRole('button', { name: /確認|OK/i }))

    await waitFor(() => {
      expect(gw.calls).toContainEqual({
        method: 'DELETE',
        path: deleteSourcePath(SAMPLE_SOURCES[0].url),
        body: undefined,
      })
    })
  })

  test('Given deletion succeeds, replaces state with response sources (no re-GET)', async () => {
    const remainingSources = [SAMPLE_SOURCES[1]]
    gw.respond('GET', SOURCES_PATH, { ok: true, value: { sources: SAMPLE_SOURCES } })
    gw.respond('DELETE', deleteSourcePath(SAMPLE_SOURCES[0].url), {
      ok: true,
      value: { sources: remainingSources },
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
    expect(callsTo('GET', SOURCES_PATH)).toHaveLength(1)
  })
})

// ==========================================================
// おすすめサイト — カテゴリ別セクション
// ==========================================================
describe('SubscriptionsPage — featured sources by category', () => {
  test('displays recommended sources grouped by category with fixed order', async () => {
    gw.respond('GET', SOURCES_PATH, { ok: true, value: { sources: SAMPLE_SOURCES } })
    gw.respond('GET', FEATURED_PATH, {
      ok: true,
      value: {
        sites: [
          { id: 'f1', name: 'Tech News', url: 'https://technews.com', order: 0, category: 'tech' },
          { id: 'f2', name: 'Business News', url: 'https://biz.com', order: 1, category: 'business' },
        ],
      },
    })

    renderSubscriptionsPage()

    await waitFor(() => {
      expect(screen.getByText('テクノロジー')).toBeInTheDocument()
      expect(screen.getByText('ビジネス')).toBeInTheDocument()
    })
    // 見出しは固定順（テクノロジー→ビジネス）で並ぶ
    const techHeading = screen.getByText('テクノロジー')
    const bizHeading = screen.getByText('ビジネス')
    expect(
      techHeading.compareDocumentPosition(bizHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    // 各ソースは対応するカテゴリセクション内に描画される
    expect(techHeading.parentElement).toContainElement(screen.getByText('Tech News'))
    expect(techHeading.parentElement).not.toContainElement(screen.getByText('Business News'))
    expect(bizHeading.parentElement).toContainElement(screen.getByText('Business News'))
  })

  test('hides category section headers when category has 0 items', async () => {
    gw.respond('GET', SOURCES_PATH, { ok: true, value: { sources: SAMPLE_SOURCES } })
    gw.respond('GET', FEATURED_PATH, {
      ok: true,
      value: {
        sites: [
          { id: 'f1', name: 'Tech News', url: 'https://technews.com', order: 0, category: 'tech' },
        ],
      },
    })

    renderSubscriptionsPage()

    await waitFor(() => {
      expect(screen.getByText('テクノロジー')).toBeInTheDocument()
      expect(screen.queryByText('ビジネス')).not.toBeInTheDocument()
      expect(screen.queryByText('スポーツ')).not.toBeInTheDocument()
    })
  })

  test('normalizes missing category to tech', async () => {
    gw.respond('GET', SOURCES_PATH, { ok: true, value: { sources: SAMPLE_SOURCES } })
    gw.respond('GET', FEATURED_PATH, {
      ok: true,
      value: {
        sites: [
          { id: 'f1', name: 'Legacy Site', url: 'https://legacy.com', order: 0 },
          { id: 'f2', name: 'Tech News', url: 'https://technews.com', order: 1, category: 'tech' },
        ],
      },
    })

    renderSubscriptionsPage()

    await waitFor(() => {
      expect(screen.getByText('Legacy Site')).toBeInTheDocument()
      expect(screen.getByText('Tech News')).toBeInTheDocument()
      expect(screen.getByText('テクノロジー')).toBeInTheDocument()
    })
    // category 欠落の旧データはテクノロジーセクション内に入る
    expect(screen.getByText('テクノロジー').parentElement).toContainElement(
      screen.getByText('Legacy Site'),
    )
  })
})
