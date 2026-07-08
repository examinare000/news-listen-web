import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import AdminInvitesPage from '@/app/(app)/admin/invites/page'
import { AppProvider } from '@/contexts/AppContext'
import { ToastProvider } from '@/components/ui/Toast'

const listInvites = vi.fn()
const createInvite = vi.fn()
const revokeInvite = vi.fn()

vi.mock('@/lib/api', () => ({
  createApiClient: () => ({ listInvites, createInvite, revokeInvite }),
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
  useAuth: () => ({ status: 'authenticated', user: authOverride.current, login: vi.fn(), logout: vi.fn(), register: vi.fn(), refreshMe: vi.fn() }),
}))

const writeText = vi.fn().mockResolvedValue(undefined)

function renderPage() {
  return render(
    <AppProvider>
      <ToastProvider>
        <AdminInvitesPage />
      </ToastProvider>
    </AppProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  writeText.mockClear().mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { writeText } })
  authOverride.current = { username: 'admin', role: 'admin', display_name: 'Admin' }
  listInvites.mockResolvedValue({
    invites: [
      {
        id: 'inv1',
        note: 'for alice',
        created_by: 'admin',
        max_uses: 1,
        use_count: 0,
        used_by: [],
        expires_at: '2026-08-01T00:00:00Z',
        revoked_at: null,
        created_at: '2026-07-01T00:00:00Z',
        status: 'active',
      },
    ],
  })
})

describe('AdminInvitesPage', () => {
  test('non-admin sees a forbidden message and does not load invites', () => {
    authOverride.current = { username: 'bob', role: 'user', display_name: 'Bob' }
    renderPage()
    expect(screen.getByText(/管理者のみ利用できます/)).toBeInTheDocument()
    expect(listInvites).not.toHaveBeenCalled()
  })

  test('lists invites on mount', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('for alice')).toBeInTheDocument())
    expect(listInvites).toHaveBeenCalled()
  })

  test('creating an invite shows the invite_url once, with a copy button', async () => {
    createInvite.mockResolvedValue({
      id: 'inv2',
      code: 'NEWCODE',
      invite_url: 'https://example.com/signup?invite=NEWCODE',
      note: 'for bob',
      max_uses: 1,
      expires_at: null,
      created_at: '2026-07-08T00:00:00Z',
    })
    renderPage()
    await waitFor(() => expect(listInvites).toHaveBeenCalled())

    await userEvent.type(screen.getByLabelText('メモ'), 'for bob')
    await userEvent.click(screen.getByRole('button', { name: '招待コードを作成' }))

    await waitFor(() =>
      expect(screen.getByText('https://example.com/signup?invite=NEWCODE')).toBeInTheDocument(),
    )

    await userEvent.click(screen.getByRole('button', { name: 'コピー' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://example.com/signup?invite=NEWCODE'))
    expect(await screen.findByText('招待URLをコピーしました')).toBeInTheDocument()
  })

  test('revoking an invite calls the API after confirmation', async () => {
    revokeInvite.mockResolvedValue(undefined)
    renderPage()
    await waitFor(() => expect(screen.getByText('for alice')).toBeInTheDocument())

    await userEvent.click(screen.getByLabelText('for alice を失効'))
    await userEvent.click(screen.getByRole('button', { name: '確認' }))

    await waitFor(() => expect(revokeInvite).toHaveBeenCalledWith('inv1'))
  })
})
