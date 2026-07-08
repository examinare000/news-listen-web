import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import AdminUsersPage from '@/app/(app)/admin/users/page'
import { AppProvider } from '@/contexts/AppContext'

const listUsers = vi.fn()
const createUser = vi.fn()
const deleteUser = vi.fn()
const updateUser = vi.fn()

vi.mock('@/lib/api', () => ({
  createApiClient: () => ({ listUsers, createUser, deleteUser, updateUser }),
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
      <AdminUsersPage />
    </AppProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  authOverride.current = { username: 'admin', role: 'admin', display_name: 'Admin' }
  listUsers.mockResolvedValue({
    users: [
      { username: 'admin', role: 'admin', display_name: 'Admin' },
      { username: 'bob', role: 'user', display_name: 'Bob' },
    ],
  })
})

describe('AdminUsersPage', () => {
  test('lists users on mount', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/Bob（bob）/)).toBeInTheDocument())
    expect(listUsers).toHaveBeenCalled()
  })

  test('creates a user via the form', async () => {
    createUser.mockResolvedValue({ username: 'carol', role: 'user', display_name: 'carol' })
    renderPage()
    await waitFor(() => expect(listUsers).toHaveBeenCalled())

    await userEvent.type(screen.getByLabelText('新規ユーザーID'), 'carol')
    await userEvent.type(screen.getByLabelText('新規パスワード'), 'carol-pass')
    await userEvent.click(screen.getByRole('button', { name: '追加' }))

    await waitFor(() =>
      expect(createUser).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'carol', password: 'carol-pass', role: 'user' }),
      ),
    )
  })

  test('deletes another user but not self', async () => {
    deleteUser.mockResolvedValue({ status: 'deleted', username: 'bob' })
    renderPage()
    await waitFor(() => expect(screen.getByText(/Bob（bob）/)).toBeInTheDocument())

    // 自分（admin）の削除・ロール変更ボタンは存在しない（自己ロックアウト防止）
    expect(screen.queryByLabelText('admin を削除')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('admin のロールを変更')).not.toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('bob を削除'))
    await waitFor(() => expect(deleteUser).toHaveBeenCalledWith('bob'))
  })

  test('non-admin sees a forbidden message', async () => {
    authOverride.current = { username: 'bob', role: 'user', display_name: 'Bob' }
    renderPage()
    expect(screen.getByText(/管理者のみ利用できます/)).toBeInTheDocument()
    expect(listUsers).not.toHaveBeenCalled()
  })
})
