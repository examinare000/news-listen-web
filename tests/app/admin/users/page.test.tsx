import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import AdminUsersPage from '@/app/(app)/admin/users/page'
import { PreferencesProvider } from '@/contexts/PreferencesProvider'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'

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
vi.mock('@/contexts/AuthProvider', () => ({
  useAuth: () => ({ status: 'authenticated', user: authOverride.current, session: { kind: 'authenticated', user: authOverride.current }, login: vi.fn(), logout: vi.fn(), refreshMe: vi.fn() }),
}))

function renderPage() {
  return render(
    <PreferencesProvider store={memoryStore()}>
      <AdminUsersPage />
    </PreferencesProvider>
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
    await userEvent.type(screen.getByLabelText('新規パスワード'), 'Carol-Pass-123')
    await userEvent.click(screen.getByRole('button', { name: '追加' }))

    await waitFor(() =>
      expect(createUser).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'carol', password: 'Carol-Pass-123', role: 'user' }),
      ),
    )
  })

  describe('password policy (12〜20 characters, 3 or more classes)', () => {
    const VIOLATION = 'ユーザーIDと12〜20文字のパスワードを入力してください'

    async function submitWith(password: string) {
      renderPage()
      await waitFor(() => expect(listUsers).toHaveBeenCalled())
      await userEvent.type(screen.getByLabelText('新規ユーザーID'), 'carol')
      await userEvent.type(screen.getByLabelText('新規パスワード'), password)
      await userEvent.click(screen.getByRole('button', { name: '追加' }))
    }

    test.each([
      ['11 characters (too short)', 'Abc12345678'],
      ['21 characters (too long)', 'Abcdefghij12345678901'],
      ['12 characters with only 2 classes', 'abcdefgh1234'],
    ])('rejects %s without calling createUser', async (_label, password) => {
      await submitWith(password)

      expect(await screen.findByText(VIOLATION)).toBeInTheDocument()
      expect(createUser).not.toHaveBeenCalled()
    })

    test.each([
      ['12 characters', 'Abcd12345678'],
      ['20 characters', 'Abcdefghij1234567890'],
    ])('accepts %s with 3 classes', async (_label, password) => {
      createUser.mockResolvedValue({ username: 'carol', role: 'user', display_name: 'carol' })
      await submitWith(password)

      await waitFor(() => expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ password })))
      expect(screen.queryByText(VIOLATION)).not.toBeInTheDocument()
    })

    test('the password field placeholder states 12〜20 characters', async () => {
      renderPage()
      await waitFor(() => expect(listUsers).toHaveBeenCalled())

      expect(screen.getByPlaceholderText('パスワード（12〜20文字）')).toBeInTheDocument()
      expect(screen.queryByPlaceholderText('パスワード（8文字以上）')).not.toBeInTheDocument()
    })
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
