import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render as rtlRender, screen, waitFor } from '@testing-library/react'
import type { RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import userEvent from '@testing-library/user-event'
import React from 'react'
import AdminUsersPage from '@/app/(app)/admin/users/page'
import { PreferencesProvider } from '@/contexts/PreferencesProvider'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'
import { createGatewayDouble } from '../../../helpers/gatewayDouble'
import type { GatewayDouble } from '../../../helpers/gatewayDouble'

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

const holder = vi.hoisted(() => ({ gw: undefined as GatewayDouble | undefined }))

vi.mock('@/lib/api/gateway', () => ({ createGateway: () => holder.gw }))

const USERS_PATH = '/api/backend/admin/users'
const userPath = (username: string) => `${USERS_PATH}/${encodeURIComponent(username)}`

let gw: GatewayDouble

function callsTo(method: string, path: string) {
  return gw.calls.filter((c) => c.method === method && c.path === path)
}

const authOverride = vi.hoisted(() => ({
  current: { username: 'admin', role: 'admin', display_name: 'Admin' },
}))
vi.mock('@/contexts/AuthProvider', () => ({
  useAuth: () => ({ view: { kind: 'authenticated', user: authOverride.current }, session: { kind: 'authenticated', user: authOverride.current }, login: vi.fn(), logout: vi.fn(), refreshMe: vi.fn() }),
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
  gw = createGatewayDouble()
  holder.gw = gw
  authOverride.current = { username: 'admin', role: 'admin', display_name: 'Admin' }
  gw.respond('GET', USERS_PATH, {
    ok: true,
    value: {
      users: [
        { username: 'admin', role: 'admin', display_name: 'Admin' },
        { username: 'bob', role: 'user', display_name: 'Bob' },
      ],
    },
  })
})

describe('AdminUsersPage', () => {
  test('lists users on mount', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/Bob（bob）/)).toBeInTheDocument())
    expect(callsTo('GET', USERS_PATH).length).toBeGreaterThan(0)
  })

  test('creates a user via the form', async () => {
    gw.respond('POST', USERS_PATH, {
      ok: true,
      value: { username: 'carol', role: 'user', display_name: 'carol' },
    })
    renderPage()
    await waitFor(() => expect(callsTo('GET', USERS_PATH).length).toBeGreaterThan(0))

    await userEvent.type(screen.getByLabelText('新規ユーザーID'), 'carol')
    await userEvent.type(screen.getByLabelText('新規パスワード'), 'Carol-Pass-123')
    await userEvent.click(screen.getByRole('button', { name: '追加' }))

    await waitFor(() =>
      expect(gw.calls).toContainEqual({
        method: 'POST',
        path: USERS_PATH,
        body: expect.objectContaining({ username: 'carol', password: 'Carol-Pass-123', role: 'user' }),
      }),
    )
  })

  describe('password policy (12〜20 characters, 3 or more classes)', () => {
    const VIOLATION = 'ユーザーIDと12〜20文字のパスワードを入力してください'

    async function submitWith(password: string) {
      renderPage()
      await waitFor(() => expect(callsTo('GET', USERS_PATH).length).toBeGreaterThan(0))
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
      expect(callsTo('POST', USERS_PATH)).toHaveLength(0)
    })

    test.each([
      ['12 characters', 'Abcd12345678'],
      ['20 characters', 'Abcdefghij1234567890'],
    ])('accepts %s with 3 classes', async (_label, password) => {
      gw.respond('POST', USERS_PATH, {
        ok: true,
        value: { username: 'carol', role: 'user', display_name: 'carol' },
      })
      await submitWith(password)

      await waitFor(() =>
        expect(gw.calls).toContainEqual({
          method: 'POST',
          path: USERS_PATH,
          body: expect.objectContaining({ password }),
        }),
      )
      expect(screen.queryByText(VIOLATION)).not.toBeInTheDocument()
    })

    test('the password field placeholder states 12〜20 characters', async () => {
      renderPage()
      await waitFor(() => expect(callsTo('GET', USERS_PATH).length).toBeGreaterThan(0))

      expect(screen.getByPlaceholderText('パスワード（12〜20文字）')).toBeInTheDocument()
      expect(screen.queryByPlaceholderText('パスワード（8文字以上）')).not.toBeInTheDocument()
    })
  })

  test('deletes another user but not self', async () => {
    gw.respond('DELETE', userPath('bob'), { ok: true, value: { status: 'deleted', username: 'bob' } })
    renderPage()
    await waitFor(() => expect(screen.getByText(/Bob（bob）/)).toBeInTheDocument())

    // 自分（admin）の削除・ロール変更ボタンは存在しない（自己ロックアウト防止）
    expect(screen.queryByLabelText('admin を削除')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('admin のロールを変更')).not.toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('bob を削除'))
    await waitFor(() =>
      expect(gw.calls).toContainEqual({ method: 'DELETE', path: userPath('bob'), body: undefined }),
    )
  })

  test('non-admin sees a forbidden message', async () => {
    authOverride.current = { username: 'bob', role: 'user', display_name: 'Bob' }
    renderPage()
    expect(screen.getByText(/管理者のみ利用できます/)).toBeInTheDocument()
    expect(callsTo('GET', USERS_PATH)).toHaveLength(0)
  })
})
