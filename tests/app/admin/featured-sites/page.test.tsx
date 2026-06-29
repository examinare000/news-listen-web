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
      { id: 'hn', name: 'Hacker News', url: 'https://news.ycombinator.com', thumbnail_url: null, description: null },
      { id: 'rss', name: 'RSS Feed', url: 'https://example.com/rss', thumbnail_url: 'https://example.com/thumb.png', description: 'A feed' },
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
    await waitFor(() => expect(listFeaturedSites).toHaveBeenCalled())

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
