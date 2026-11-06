import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import AdminFeaturedSitesPage from '@/app/(app)/admin/featured-sites/page'
import { PreferencesProvider } from '@/contexts/PreferencesProvider'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'
import { createGatewayDouble } from '../../../helpers/gatewayDouble'
import type { GatewayDouble } from '../../../helpers/gatewayDouble'
import type { ApiFailure, Result } from '@/lib/api/gateway'

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

const SITES_PATH = '/api/backend/admin/featured-sites'
const sitePath = (id: string) => `${SITES_PATH}/${encodeURIComponent(id)}`

let gw: GatewayDouble

function callsTo(method: string, path: string) {
  return gw.calls.filter((c) => c.method === method && c.path === path)
}

const authOverride = vi.hoisted(() => ({
  current: { username: 'admin', role: 'admin', display_name: 'Admin' },
}))
vi.mock('@/contexts/AuthProvider', () => ({
  useAuth: () => ({ status: 'authenticated', user: authOverride.current, session: { kind: 'authenticated', user: authOverride.current }, login: vi.fn(), logout: vi.fn(), refreshMe: vi.fn() }),
}))

function renderPage() {
  return render(
    <PreferencesProvider store={memoryStore()}>
      <AdminFeaturedSitesPage />
    </PreferencesProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  gw = createGatewayDouble()
  holder.gw = gw
  authOverride.current = { username: 'admin', role: 'admin', display_name: 'Admin' }
  gw.respond('GET', SITES_PATH, {
    ok: true,
    value: {
      sites: [
        { id: 'hn', name: 'Hacker News', url: 'https://news.ycombinator.com', thumbnail_url: null, description: null, order: 0 },
        { id: 'rss', name: 'RSS Feed', url: 'https://example.com/rss', thumbnail_url: 'https://example.com/thumb.png', description: 'A feed', order: 1 },
        { id: 'third', name: 'Third Source', url: 'https://third.example.com', thumbnail_url: null, description: null, order: 2 },
      ],
    },
  })
})

describe('AdminFeaturedSitesPage', () => {
  test('lists featured sites on mount', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Hacker News')).toBeInTheDocument())
    expect(callsTo('GET', SITES_PATH).length).toBeGreaterThan(0)
  })

  test('creates a featured site via the form', async () => {
    gw.respond('POST', SITES_PATH, { ok: true, value: { id: 'new', name: 'New Site', url: 'https://newsite.com' } })
    renderPage()
    // 一覧のロード完了（= 作成フォームが操作可能になるタイミング）を待つ
    await waitFor(() => expect(screen.getByText('Hacker News')).toBeInTheDocument())

    await userEvent.type(screen.getByLabelText('サイト名'), 'New Site')
    await userEvent.type(screen.getByLabelText('URL'), 'https://newsite.com')
    await userEvent.type(screen.getByLabelText('説明'), 'A new site')
    await userEvent.click(screen.getByRole('button', { name: '追加' }))

    await waitFor(() =>
      expect(gw.calls).toContainEqual({
        method: 'POST',
        path: SITES_PATH,
        body: expect.objectContaining({ name: 'New Site', url: 'https://newsite.com', description: 'A new site' }),
      })
    )
  })

  test('updates a featured site', async () => {
    gw.respond('PUT', sitePath('hn'), { ok: true, value: { id: 'hn', name: 'Updated HN', url: 'https://updated.hn.com' } })
    renderPage()
    await waitFor(() => expect(screen.getByText('Hacker News')).toBeInTheDocument())

    // "編集" ボタンをクリック（最初のサイトの）
    const editButtons = screen.getAllByRole('button', { name: /編集/ })
    await userEvent.click(editButtons[0])

    // 編集フォームが表示されるはず
    await waitFor(() => {
      const nameInputs = screen.getAllByDisplayValue('Hacker News')
      expect(nameInputs.length).toBeGreaterThan(0)
    })

    // URL を更新
    const urlInputs = screen.getAllByDisplayValue('https://news.ycombinator.com')
    await userEvent.clear(urlInputs[0])
    await userEvent.type(urlInputs[0], 'https://updated.hn.com')

    // 保存ボタンをクリック
    const saveButtons = screen.getAllByRole('button', { name: /保存/ })
    await userEvent.click(saveButtons[0])

    await waitFor(() =>
      expect(gw.calls).toContainEqual({ method: 'PUT', path: sitePath('hn'), body: expect.objectContaining({ name: 'Hacker News', url: 'https://updated.hn.com' }) })
    )
  })

  test('deletes a featured site after confirmation', async () => {
    gw.respond('DELETE', sitePath('hn'), { ok: true, value: { status: 'deleted', id: 'hn' } })
    renderPage()
    await waitFor(() => expect(screen.getByText('Hacker News')).toBeInTheDocument())

    // "削除" ボタンをクリック
    const deleteButtons = screen.getAllByRole('button', { name: /削除/ })
    await userEvent.click(deleteButtons[0])

    // 確認ダイアログが表示されるまで待機
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    // "確認" ボタンをクリック
    const confirmBtn = screen.getByRole('button', { name: /確認/ })
    await userEvent.click(confirmBtn)

    await waitFor(() => expect(gw.calls).toContainEqual({ method: 'DELETE', path: sitePath('hn'), body: undefined }))
  })

  test('editing and saving does not reset the order field to 0 (regression)', async () => {
    gw.respond('PUT', sitePath('rss'), { ok: true, value: { id: 'rss', name: 'RSS Feed', url: 'https://example.com/rss', order: 1 } })
    renderPage()
    await waitFor(() => expect(screen.getByText('RSS Feed')).toBeInTheDocument())

    // RSS Feed（order: 1）の編集ボタンをクリック
    const editButtons = screen.getAllByRole('button', { name: /編集/ })
    await userEvent.click(editButtons[1])

    await waitFor(() => {
      const nameInputs = screen.getAllByDisplayValue('RSS Feed')
      expect(nameInputs.length).toBeGreaterThan(0)
    })

    const saveButtons = screen.getAllByRole('button', { name: /保存/ })
    await userEvent.click(saveButtons[0])

    await waitFor(() =>
      expect(gw.calls).toContainEqual({ method: 'PUT', path: sitePath('rss'), body: expect.objectContaining({ order: 1 }) })
    )
  })

  test('creating a new site assigns order as the current max order + 1', async () => {
    gw.respond('POST', SITES_PATH, { ok: true, value: { id: 'new', name: 'New Site', url: 'https://newsite.com', order: 3 } })
    renderPage()
    // 一覧のロード完了（= 作成フォームが操作可能になるタイミング）を待つ
    await waitFor(() => expect(screen.getByText('Hacker News')).toBeInTheDocument())

    await userEvent.type(screen.getByLabelText('サイト名'), 'New Site')
    await userEvent.type(screen.getByLabelText('URL'), 'https://newsite.com')
    await userEvent.click(screen.getByRole('button', { name: '追加' }))

    await waitFor(() =>
      expect(gw.calls).toContainEqual({ method: 'POST', path: SITES_PATH, body: expect.objectContaining({ order: 3 }) })
    )
  })

  test('clicking down on a middle row swaps order only with the site below it', async () => {
    gw.respond('PUT', sitePath('rss'), { ok: true, value: {} })
    gw.respond('PUT', sitePath('third'), { ok: true, value: {} })
    renderPage()
    await waitFor(() => expect(screen.getByText('RSS Feed')).toBeInTheDocument())

    // RSS Feed（中間行）の「下へ」ボタンをクリック
    const downButtons = screen.getAllByRole('button', { name: /を下へ移動/ })
    await userEvent.click(downButtons[1])

    await waitFor(() => {
      expect(gw.calls).toContainEqual({ method: 'PUT', path: sitePath('rss'), body: expect.objectContaining({ order: 2 }) })
      expect(gw.calls).toContainEqual({ method: 'PUT', path: sitePath('third'), body: expect.objectContaining({ order: 1 }) })
    })
    expect(callsTo('PUT', sitePath('hn'))).toHaveLength(0)
  })

  test('並び替え失敗時のエラーメッセージは reload 完了後も表示され続ける（回帰テスト）', async () => {
    for (const id of ['hn', 'rss', 'third']) {
      gw.respondWith('PUT', sitePath(id), () => Promise.reject(new Error('update failed')))
    }
    renderPage()
    await waitFor(() => expect(screen.getByText('RSS Feed')).toBeInTheDocument())

    const downButtons = screen.getAllByRole('button', { name: /を下へ移動/ })
    await userEvent.click(downButtons[1])

    await waitFor(() => expect(screen.getByText('並び替えに失敗しました')).toBeInTheDocument())

    // handleMove の finally で reload() が発火し完了するのを待つ。
    // reload 自体は成功するため、reload の完了後もエラーメッセージが消されずに残ることを確認する。
    await waitFor(() => expect(callsTo('GET', SITES_PATH)).toHaveLength(2))
    expect(screen.getByText('並び替えに失敗しました')).toBeInTheDocument()
  })

  test('一覧ロード中は追加ボタンが無効化される', async () => {
    let resolveList: (value: Result<unknown, ApiFailure>) => void = () => {}
    gw.respondWith(
      'GET',
      SITES_PATH,
      () =>
        new Promise((resolve) => {
          resolveList = resolve
        })
    )
    renderPage()

    expect(screen.getByRole('button', { name: '追加' })).toBeDisabled()

    resolveList({
      ok: true,
      value: { sites: [{ id: 'hn', name: 'Hacker News', url: 'https://news.ycombinator.com', order: 0 }] },
    })

    await waitFor(() => expect(screen.getByRole('button', { name: '追加' })).not.toBeDisabled())
  })

  test('並べ替え処理中は追加ボタンと各行の編集・削除ボタンも無効化される', async () => {
    let resolveUpdate: (value: Result<unknown, ApiFailure>) => void = () => {}
    const pendingUpdate = new Promise<Result<unknown, ApiFailure>>((resolve) => {
      resolveUpdate = resolve
    })
    for (const id of ['hn', 'rss', 'third']) {
      gw.respondWith('PUT', sitePath(id), () => pendingUpdate)
    }
    renderPage()
    await waitFor(() => expect(screen.getByText('RSS Feed')).toBeInTheDocument())

    const downButtons = screen.getAllByRole('button', { name: /を下へ移動/ })
    await userEvent.click(downButtons[1])

    await waitFor(() => expect(screen.getByRole('button', { name: '追加' })).toBeDisabled())
    for (const btn of screen.getAllByRole('button', { name: /編集/ })) {
      expect(btn).toBeDisabled()
    }
    for (const btn of screen.getAllByRole('button', { name: /削除/ })) {
      expect(btn).toBeDisabled()
    }

    // pending だった PUT を解決し、後始末として並べ替え完了まで待つ（act 警告防止）
    resolveUpdate({ ok: true, value: {} })
    await waitFor(() => expect(screen.getByRole('button', { name: '追加' })).not.toBeDisabled())
  })

  test('disables the up button on the first row and the down button on the last row', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Hacker News')).toBeInTheDocument())

    const upButtons = screen.getAllByRole('button', { name: /を上へ移動/ })
    const downButtons = screen.getAllByRole('button', { name: /を下へ移動/ })

    expect(upButtons[0]).toBeDisabled()
    expect(downButtons[downButtons.length - 1]).toBeDisabled()
    expect(downButtons[0]).not.toBeDisabled()
    expect(upButtons[upButtons.length - 1]).not.toBeDisabled()
  })

  test('non-admin sees a forbidden message', async () => {
    authOverride.current = { username: 'bob', role: 'user', display_name: 'Bob' }
    renderPage()
    expect(screen.getByText(/管理者のみ利用できます/)).toBeInTheDocument()
    expect(callsTo('GET', SITES_PATH)).toHaveLength(0)
  })

  test('displays error message on load failure', async () => {
    gw.respondWith('GET', SITES_PATH, () => Promise.reject(new Error('Load failed')))
    renderPage()
    await waitFor(() => expect(screen.getByText(/一覧の取得に失敗しました/)).toBeInTheDocument())
  })

  test('loads on admin mount but not when mounted as non-admin', async () => {
    renderPage()
    await waitFor(() => expect(callsTo('GET', SITES_PATH).length).toBeGreaterThan(0))

    // 非admin で改めてマウントした場合は一覧取得しないことを確認する
    vi.clearAllMocks()
    const callsBefore = callsTo('GET', SITES_PATH).length
    authOverride.current = { username: 'bob', role: 'user', display_name: 'Bob' }
    renderPage()
    expect(callsTo('GET', SITES_PATH)).toHaveLength(callsBefore)
  })

  test('create form includes category select', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Hacker News')).toBeInTheDocument())
    expect(screen.getByLabelText('カテゴリ')).toBeInTheDocument()
  })

  test('create form sends category field when creating', async () => {
    gw.respond('POST', SITES_PATH, { ok: true, value: { id: 'new', name: 'New Site', url: 'https://newsite.com', category: 'business' } })
    renderPage()
    await waitFor(() => expect(screen.getByText('Hacker News')).toBeInTheDocument())

    await userEvent.type(screen.getByLabelText('サイト名'), 'New Site')
    await userEvent.type(screen.getByLabelText('URL'), 'https://newsite.com')
    await userEvent.selectOptions(screen.getByLabelText('カテゴリ'), 'business')
    await userEvent.click(screen.getByRole('button', { name: '追加' }))

    await waitFor(() =>
      expect(gw.calls).toContainEqual({
        method: 'POST',
        path: SITES_PATH,
        body: expect.objectContaining({ name: 'New Site', url: 'https://newsite.com', category: 'business' }),
      })
    )
  })

  test('edit form includes category select', async () => {
    gw.respond('GET', SITES_PATH, {
      ok: true,
      value: { sites: [{ id: 'hn', name: 'Hacker News', url: 'https://news.ycombinator.com', order: 0, category: 'tech' }] },
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('Hacker News')).toBeInTheDocument())

    const editButtons = screen.getAllByRole('button', { name: /編集/ })
    await userEvent.click(editButtons[0])

    await waitFor(() => {
      expect(screen.getAllByLabelText('カテゴリ').length).toBeGreaterThan(0)
    })
  })

  test('reorder (move down) includes category field in PUT payload', async () => {
    gw.respond('GET', SITES_PATH, {
      ok: true,
      value: {
        sites: [
          { id: 'hn', name: 'Hacker News', url: 'https://news.ycombinator.com', order: 0, category: 'tech' },
          { id: 'rss', name: 'RSS Feed', url: 'https://example.com/rss', order: 1, category: 'business' },
        ],
      },
    })
    gw.respond('PUT', sitePath('hn'), { ok: true, value: {} })
    gw.respond('PUT', sitePath('rss'), { ok: true, value: {} })
    renderPage()
    await waitFor(() => expect(screen.getByText('RSS Feed')).toBeInTheDocument())

    const downButtons = screen.getAllByRole('button', { name: /を下へ移動/ })
    await userEvent.click(downButtons[0])

    await waitFor(() => {
      expect(gw.calls).toContainEqual({
        method: 'PUT',
        path: sitePath('hn'),
        body: expect.objectContaining({ category: 'tech' }),
      })
      expect(gw.calls).toContainEqual({
        method: 'PUT',
        path: sitePath('rss'),
        body: expect.objectContaining({ category: 'business' }),
      })
    })
  })
})
