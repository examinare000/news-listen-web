import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import AdminFeaturedSitesPage from '@/app/admin/featured-sites/page'
import { AppProvider } from '@/contexts/AppContext'

const listFeaturedSites = vi.fn()
const createFeaturedSite = vi.fn()
const deleteFeaturedSite = vi.fn()
const updateFeaturedSite = vi.fn()

vi.mock('@/lib/api', () => ({
  createApiClient: () => ({
    listFeaturedSites,
    createFeaturedSite,
    deleteFeaturedSite,
    updateFeaturedSite,
  }),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public detail: string) {
      super(detail)
    }
  },
}))

const authOverride = vi.hoisted(() => ({
  current: { username: 'admin', role: 'admin', display_name: 'Admin' },
}))
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', user: authOverride.current, login: vi.fn(), logout: vi.fn(), refreshMe: vi.fn() }),
}))

function renderPage() {
  return render(
    <AppProvider>
      <AdminFeaturedSitesPage />
    </AppProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  authOverride.current = { username: 'admin', role: 'admin', display_name: 'Admin' }
  listFeaturedSites.mockResolvedValue({
    sites: [
      { id: 'hn', name: 'Hacker News', url: 'https://news.ycombinator.com', thumbnail_url: null, description: null, order: 0 },
      { id: 'rss', name: 'RSS Feed', url: 'https://example.com/rss', thumbnail_url: 'https://example.com/thumb.png', description: 'A feed', order: 1 },
      { id: 'third', name: 'Third Source', url: 'https://third.example.com', thumbnail_url: null, description: null, order: 2 },
    ],
  })
})

describe('AdminFeaturedSitesPage', () => {
  test('lists featured sites on mount', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Hacker News')).toBeInTheDocument())
    expect(listFeaturedSites).toHaveBeenCalled()
  })

  test('creates a featured site via the form', async () => {
    createFeaturedSite.mockResolvedValue({ id: 'new', name: 'New Site', url: 'https://newsite.com' })
    renderPage()
    // 一覧のロード完了（= 作成フォームが操作可能になるタイミング）を待つ
    await waitFor(() => expect(screen.getByText('Hacker News')).toBeInTheDocument())

    await userEvent.type(screen.getByLabelText('サイト名'), 'New Site')
    await userEvent.type(screen.getByLabelText('URL'), 'https://newsite.com')
    await userEvent.type(screen.getByLabelText('説明'), 'A new site')
    await userEvent.click(screen.getByRole('button', { name: '追加' }))

    await waitFor(() =>
      expect(createFeaturedSite).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Site', url: 'https://newsite.com', description: 'A new site' })
      )
    )
  })

  test('updates a featured site', async () => {
    updateFeaturedSite.mockResolvedValue({ id: 'hn', name: 'Updated HN', url: 'https://updated.hn.com' })
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
      expect(updateFeaturedSite).toHaveBeenCalledWith('hn', expect.objectContaining({ name: 'Hacker News', url: 'https://updated.hn.com' }))
    )
  })

  test('deletes a featured site after confirmation', async () => {
    deleteFeaturedSite.mockResolvedValue({ status: 'deleted', id: 'hn' })
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

    await waitFor(() => expect(deleteFeaturedSite).toHaveBeenCalledWith('hn'))
  })

  test('editing and saving does not reset the order field to 0 (regression)', async () => {
    updateFeaturedSite.mockResolvedValue({ id: 'rss', name: 'RSS Feed', url: 'https://example.com/rss', order: 1 })
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
      expect(updateFeaturedSite).toHaveBeenCalledWith('rss', expect.objectContaining({ order: 1 }))
    )
  })

  test('creating a new site assigns order as the current max order + 1', async () => {
    createFeaturedSite.mockResolvedValue({ id: 'new', name: 'New Site', url: 'https://newsite.com', order: 3 })
    renderPage()
    // 一覧のロード完了（= 作成フォームが操作可能になるタイミング）を待つ
    await waitFor(() => expect(screen.getByText('Hacker News')).toBeInTheDocument())

    await userEvent.type(screen.getByLabelText('サイト名'), 'New Site')
    await userEvent.type(screen.getByLabelText('URL'), 'https://newsite.com')
    await userEvent.click(screen.getByRole('button', { name: '追加' }))

    await waitFor(() =>
      expect(createFeaturedSite).toHaveBeenCalledWith(expect.objectContaining({ order: 3 }))
    )
  })

  test('clicking down on a middle row swaps order only with the site below it', async () => {
    updateFeaturedSite.mockResolvedValue({})
    renderPage()
    await waitFor(() => expect(screen.getByText('RSS Feed')).toBeInTheDocument())

    // RSS Feed（中間行）の「下へ」ボタンをクリック
    const downButtons = screen.getAllByRole('button', { name: /を下へ移動/ })
    await userEvent.click(downButtons[1])

    await waitFor(() => {
      expect(updateFeaturedSite).toHaveBeenCalledWith('rss', expect.objectContaining({ order: 2 }))
      expect(updateFeaturedSite).toHaveBeenCalledWith('third', expect.objectContaining({ order: 1 }))
    })
    expect(updateFeaturedSite).not.toHaveBeenCalledWith('hn', expect.anything())
  })

  test('並び替え失敗時のエラーメッセージは reload 完了後も表示され続ける（回帰テスト）', async () => {
    updateFeaturedSite.mockRejectedValue(new Error('update failed'))
    renderPage()
    await waitFor(() => expect(screen.getByText('RSS Feed')).toBeInTheDocument())

    const downButtons = screen.getAllByRole('button', { name: /を下へ移動/ })
    await userEvent.click(downButtons[1])

    await waitFor(() => expect(screen.getByText('並び替えに失敗しました')).toBeInTheDocument())

    // handleMove の finally で reload() が発火し完了するのを待つ。
    // reload 自体は成功するため、reload の完了後もエラーメッセージが消されずに残ることを確認する。
    await waitFor(() => expect(listFeaturedSites).toHaveBeenCalledTimes(2))
    expect(screen.getByText('並び替えに失敗しました')).toBeInTheDocument()
  })

  test('一覧ロード中は追加ボタンが無効化される', async () => {
    let resolveList: (value: { sites: unknown[] }) => void = () => {}
    listFeaturedSites.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve
        })
    )
    renderPage()

    expect(screen.getByRole('button', { name: '追加' })).toBeDisabled()

    resolveList({
      sites: [{ id: 'hn', name: 'Hacker News', url: 'https://news.ycombinator.com', order: 0 }],
    })

    await waitFor(() => expect(screen.getByRole('button', { name: '追加' })).not.toBeDisabled())
  })

  test('並べ替え処理中は追加ボタンと各行の編集・削除ボタンも無効化される', async () => {
    let resolveUpdate: (value: unknown) => void = () => {}
    const pendingUpdate = new Promise((resolve) => {
      resolveUpdate = resolve
    })
    updateFeaturedSite.mockImplementation(() => pendingUpdate)
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

    // pending だった updateFeaturedSite を解決し、後始末として並べ替え完了まで待つ（act 警告防止）
    resolveUpdate({})
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
    expect(listFeaturedSites).not.toHaveBeenCalled()
  })

  test('displays error message on load failure', async () => {
    listFeaturedSites.mockRejectedValue(new Error('Load failed'))
    renderPage()
    await waitFor(() => expect(screen.getByText(/一覧の取得に失敗しました/)).toBeInTheDocument())
  })

  test('loads on admin mount but not when mounted as non-admin', async () => {
    renderPage()
    await waitFor(() => expect(listFeaturedSites).toHaveBeenCalled())

    // 非admin で改めてマウントした場合は一覧取得しないことを確認する
    vi.clearAllMocks()
    authOverride.current = { username: 'bob', role: 'user', display_name: 'Bob' }
    renderPage()
    expect(listFeaturedSites).not.toHaveBeenCalled()
  })
})
