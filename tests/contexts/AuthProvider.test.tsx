import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { PreferencesProvider } from '@/contexts/PreferencesProvider'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'
import { AuthProvider, useAuth } from '@/contexts/AuthProvider'
import { ApiError } from '@/lib/api'

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
const { clearOfflineAudio } = vi.hoisted(() => ({
  clearOfflineAudio: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/playback/infrastructure/offlineLibrary', () => ({ clearOfflineAudio }))

// review指摘2: audio-v1 だけでなく、SW 管理の api-v1（ユーザー固有 Podcast 一覧）/
// shell-pages-v1（閲覧済みページ）も共有端末での残留防止のため消す必要がある。
const { clearManagedServiceWorkerCaches } = vi.hoisted(() => ({
  clearManagedServiceWorkerCaches: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/swCacheCleanup', () => ({ clearManagedServiceWorkerCaches }))

function Consumer() {
  const { status, user, session, retry, login: doLogin, logout: doLogout, register: doRegister } = useAuth()
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="kind">{session.kind}</span>
      <span data-testid="reason">{session.kind === 'unavailable' ? session.failure.reason : '-'}</span>
      <button onClick={() => void retry()}>retry</button>
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
    <PreferencesProvider store={memoryStore()}>
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    </PreferencesProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  clearOfflineAudio.mockResolvedValue(undefined)
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
    getMe.mockRejectedValue(new ApiError(401, 'Unauthorized'))
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(screen.getByTestId('user')).toHaveTextContent('-')
  })
})

describe('login / logout', () => {
  test('login success sets user and authenticated status', async () => {
    getMe.mockRejectedValue(new ApiError(401, 'Unauthorized'))
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

    await waitFor(() => expect(clearOfflineAudio).toHaveBeenCalled())
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
    clearOfflineAudio.mockRejectedValueOnce(new Error('cache clear failed'))
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
    getMe.mockRejectedValue(new ApiError(401, 'Unauthorized'))
    register.mockResolvedValue({ token: 't', user: { username: 'newbie', role: 'user', display_name: 'Newbie' } })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))

    await userEvent.click(screen.getByText('register'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    expect(screen.getByTestId('user')).toHaveTextContent('newbie')
  })

  test('register failure propagates the error and stays unauthenticated', async () => {
    getMe.mockRejectedValue(new ApiError(401, 'Unauthorized'))
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

// web-dec-67・68 / shared-leave-03: getMe の失敗は 401 だけが未認証。それ以外は unavailable で、cleanup もしない。
describe('起動時の getMe 失敗の分類 (verifies: web-contract-18, shared-leave-03)', () => {
  test.each([
    ['ApiError(0)（network・timeout）', new ApiError(0, 'Network error'), 'network'],
    ['ApiError(503)（server）', new ApiError(503, 'Service Unavailable'), 'server'],
    ['TypeError（ApiError 以外）', new TypeError('boom'), 'unknown'],
    ['ApiError(404)（401 以外の 4xx）', new ApiError(404, 'Not Found'), 'unknown'],
  ])('shared-leave-03: %s は unavailable（reason=%s）で、anonymous にも cleanup にもしない', async (_label, error, reason) => {
    getMe.mockRejectedValue(error)
    renderAuth()

    // mount 直後の resolving で成り立たないよう、unavailable になるのを完全一致で待つ
    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('unavailable'))
    expect(screen.getByTestId('status').textContent).toBe('unknown')
    expect(screen.getByTestId('reason').textContent).toBe(reason)
    expect(screen.getByTestId('user').textContent).toBe('-')
    expect(clearManagedServiceWorkerCaches).not.toHaveBeenCalled()
    expect(logout).not.toHaveBeenCalled()
  })

  test('401 は anonymous（status=unauthenticated）で、既存の cleanup を行う', async () => {
    getMe.mockRejectedValue(new ApiError(401, 'Unauthorized'))
    renderAuth()

    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('anonymous'))
    expect(screen.getByTestId('status').textContent).toBe('unauthenticated')
    expect(clearManagedServiceWorkerCaches).toHaveBeenCalled()
  })
})

describe('retry (verifies: web-contract-18, web-dec-68)', () => {
  test('unavailable から retry すると resolving を経て、成功すれば authenticated になる', async () => {
    getMe.mockRejectedValueOnce(new ApiError(0, 'Network error'))
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('unavailable'))

    let resolveSecond: (me: { username: string; role: string; display_name: string }) => void = () => {}
    getMe.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSecond = resolve
      })
    )

    await userEvent.click(screen.getByText('retry'))

    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('resolving'))
    expect(screen.getByTestId('status').textContent).toBe('unknown')

    resolveSecond({ username: 'alice', role: 'user', display_name: 'Alice' })

    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('authenticated'))
    expect(screen.getByTestId('user').textContent).toBe('alice')
    expect(getMe).toHaveBeenCalledTimes(2)
  })
})
