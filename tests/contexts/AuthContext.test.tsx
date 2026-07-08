import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { AppProvider } from '@/contexts/AppContext'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'

const getMe = vi.fn()
const login = vi.fn()
const logout = vi.fn()
const register = vi.fn()

vi.mock('@/lib/api', () => ({
  createApiClient: () => ({ getMe, login, logout, register }),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public detail: string) {
      super(detail)
      this.name = 'ApiError'
    }
  },
}))

// issue #167: 共有端末でのユーザーデータ残留防止のため、ログアウト時にオフラインキャッシュを全消去する。
// WHY vi.hoisted: vi.mock() factories run before this file's own top-level statements
// (hoisted above imports), so referencing a bare outer const would hit a TDZ ReferenceError.
const { deleteAllAudio } = vi.hoisted(() => ({
  deleteAllAudio: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/audioCache', () => ({ deleteAllAudio }))

// review指摘2: audio-v1 だけでなく、SW 管理の api-v1（ユーザー固有 Podcast 一覧）/
// shell-pages-v1（閲覧済みページ）も共有端末での残留防止のため消す必要がある。
const { clearManagedServiceWorkerCaches } = vi.hoisted(() => ({
  clearManagedServiceWorkerCaches: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/swCacheCleanup', () => ({ clearManagedServiceWorkerCaches }))

function Consumer() {
  const { status, user, login: doLogin, logout: doLogout, register: doRegister } = useAuth()
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user?.username ?? '-'}</span>
      <button onClick={() => doLogin('alice', 'pw')}>login</button>
      <button onClick={() => doLogout()}>logout</button>
      <button
        onClick={() => {
          // register は失敗時に ApiError を throw する契約（呼び出し側で文言表示）。
          // ここではその契約どおり呼び出し側（Consumer）で捕捉し、テストの
          // unhandled rejection を防ぐ。
          doRegister({ username: 'newbie', password: 'Sup3r-Secret!!' }).catch(() => {})
        }}
      >
        register
      </button>
    </div>
  )
}

function renderAuth() {
  return render(
    <AppProvider>
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    </AppProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  deleteAllAudio.mockResolvedValue(undefined)
  clearManagedServiceWorkerCaches.mockResolvedValue(undefined)
  localStorage.clear()
})

describe('AuthProvider auto-resolution', () => {
  test('resolves authenticated when /auth/me succeeds', async () => {
    getMe.mockResolvedValue({ username: 'alice', role: 'user', display_name: 'Alice' })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    expect(screen.getByTestId('user')).toHaveTextContent('alice')
  })

  test('resolves unauthenticated when /auth/me fails (401)', async () => {
    getMe.mockRejectedValue(new Error('401'))
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(screen.getByTestId('user')).toHaveTextContent('-')
  })
})

describe('login / logout', () => {
  test('login success sets user and authenticated status', async () => {
    getMe.mockRejectedValue(new Error('401'))
    login.mockResolvedValue({ token: 't', user: { username: 'bob', role: 'admin', display_name: 'Bob' } })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))

    await userEvent.click(screen.getByText('login'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    expect(screen.getByTestId('user')).toHaveTextContent('bob')
  })

  test('logout clears user', async () => {
    getMe.mockResolvedValue({ username: 'alice', role: 'user', display_name: 'Alice' })
    logout.mockResolvedValue({ status: 'ok' })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))

    await userEvent.click(screen.getByText('logout'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(screen.getByTestId('user')).toHaveTextContent('-')
  })

  // issue #167: 共有端末でのユーザーデータ残留防止。
  test('logout clears all cached offline audio', async () => {
    getMe.mockResolvedValue({ username: 'alice', role: 'user', display_name: 'Alice' })
    logout.mockResolvedValue({ status: 'ok' })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))

    await userEvent.click(screen.getByText('logout'))

    await waitFor(() => expect(deleteAllAudio).toHaveBeenCalled())
  })

  // review指摘2: audio-v1 のみでは api-v1 / shell-pages-v1 が残り、共有端末で
  // ユーザー A のキャッシュがユーザー B に見えうる。
  test('logout also clears SW-managed caches (api-v1 / shell-pages-v1)', async () => {
    getMe.mockResolvedValue({ username: 'alice', role: 'user', display_name: 'Alice' })
    logout.mockResolvedValue({ status: 'ok' })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))

    await userEvent.click(screen.getByText('logout'))

    await waitFor(() => expect(clearManagedServiceWorkerCaches).toHaveBeenCalled())
  })

  // ログアウト自体はベストエフォート方針（サーバー失効に失敗してもローカル状態は落とす）。
  // キャッシュ消去もこの方針に揃え、失敗してもログアウト自体は完了させる。
  test('logout still completes even if clearing the cache fails', async () => {
    getMe.mockResolvedValue({ username: 'alice', role: 'user', display_name: 'Alice' })
    logout.mockResolvedValue({ status: 'ok' })
    deleteAllAudio.mockRejectedValueOnce(new Error('cache clear failed'))
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))

    await userEvent.click(screen.getByText('logout'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
  })

  // 上と同じベストエフォート方針が、追加した SW キャッシュ消去呼び出し側にも及ぶことを確認する。
  test('logout still completes even if clearing SW-managed caches fails', async () => {
    getMe.mockResolvedValue({ username: 'alice', role: 'user', display_name: 'Alice' })
    logout.mockResolvedValue({ status: 'ok' })
    clearManagedServiceWorkerCaches.mockRejectedValueOnce(new Error('sw cache clear failed'))
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))

    await userEvent.click(screen.getByText('logout'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
  })
})

describe('register', () => {
  test('register success sets user and authenticated status', async () => {
    getMe.mockRejectedValue(new Error('401'))
    register.mockResolvedValue({ token: 't', user: { username: 'newbie', role: 'user', display_name: 'Newbie' } })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))

    await userEvent.click(screen.getByText('register'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    expect(screen.getByTestId('user')).toHaveTextContent('newbie')
  })

  test('register failure propagates the error and stays unauthenticated', async () => {
    getMe.mockRejectedValue(new Error('401'))
    register.mockRejectedValue(new Error('409'))
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))

    await userEvent.click(screen.getByText('register'))

    // register の失敗は呼び出し側（Consumer）で握りつぶされないため画面上は変化しないが、
    // 状態は unauthenticated のまま据え置かれる（authenticated へ誤って進めない）。
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(screen.getByTestId('user')).toHaveTextContent('-')
  })
})
