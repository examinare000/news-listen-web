import { describe, test, expect, beforeEach, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React, { useEffect } from 'react'
import { PreferencesProvider } from '@/contexts/PreferencesProvider'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'
import { AuthProvider, useAuth } from '@/contexts/AuthProvider'
import { ApiError } from '@/lib/api'

// 設定の保存先は、テストごとに新しい in-memory の KeyValueStore
const memoryStoreWithData = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial))
  const store: KeyValueStore = {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => {
      data.set(key, value)
      return true
    },
    remove: (key) => {
      data.delete(key)
    },
  }
  return { store, data }
}
const memoryStore = (initial: Record<string, string> = {}): KeyValueStore => memoryStoreWithData(initial).store

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

// 主体離脱の音声消去（shared-leave-01・web-dec-74）と起動時の回収（shared-leave-08・09・web-dec-85）。
// WHY vi.hoisted: vi.mock() factories run before this file's own top-level statements
// (hoisted above imports), so referencing a bare outer const would hit a TDZ ReferenceError.
const { reclaimAudioCaches, deleteSubjectAudio } = vi.hoisted(() => ({
  reclaimAudioCaches: vi.fn().mockResolvedValue(undefined),
  deleteSubjectAudio: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/playback/infrastructure/offlineLibrary', () => ({ reclaimAudioCaches, deleteSubjectAudio }))

// review指摘2: audio-v1 だけでなく、SW 管理の api-v1（ユーザー固有 Podcast 一覧）/
// shell-pages-v1（閲覧済みページ）も共有端末での残留防止のため消す必要がある。
const { clearManagedServiceWorkerCaches } = vi.hoisted(() => ({
  clearManagedServiceWorkerCaches: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/swCacheCleanup', () => ({ clearManagedServiceWorkerCaches }))

let auth: ReturnType<typeof useAuth>

function Consumer() {
  const current = useAuth()
  useEffect(() => {
    auth = current
  })
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

function renderAuth(store: KeyValueStore = memoryStore()) {
  return render(
    <PreferencesProvider store={store}>
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    </PreferencesProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  reclaimAudioCaches.mockResolvedValue(undefined)
  deleteSubjectAudio.mockResolvedValue(undefined)
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
  test('logout deletes the audio cache of the departing subject (shared-leave-01)', async () => {
    getMe.mockResolvedValue({ user_id: 'u-a', username: 'alice', role: 'user', display_name: 'Alice' })
    logout.mockResolvedValue({ status: 'ok' })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))

    await userEvent.click(screen.getByText('logout'))

    await waitFor(() => expect(deleteSubjectAudio).toHaveBeenCalledTimes(1))
    expect(deleteSubjectAudio).toHaveBeenCalledWith(null, 'u-a')
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
    getMe.mockResolvedValue({ user_id: 'u-a', username: 'alice', role: 'user', display_name: 'Alice' })
    logout.mockResolvedValue({ status: 'ok' })
    deleteSubjectAudio.mockRejectedValueOnce(new Error('cache clear failed'))
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

const ME_A = { user_id: 'u-a', username: 'alice', role: 'user', display_name: 'Alice' }
const AUTH_B = (userId?: string) => ({
  token: 't',
  user: { ...(userId === undefined ? {} : { user_id: userId }), username: 'bob', role: 'user', display_name: 'Bob' },
})

const lastKeep = (): (() => string | null) => {
  const calls = reclaimAudioCaches.mock.calls
  return calls[calls.length - 1][1] as () => string | null
}

describe('起動時の回収: 最初の確定事象で 1 回 (verifies: shared-leave-08, shared-leave-10)', () => {
  test('shared-leave-08: getMe 成功で 1 回、keep() は user_id を返す', async () => {
    getMe.mockResolvedValue(ME_A)
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('authenticated'))

    await waitFor(() => expect(reclaimAudioCaches).toHaveBeenCalledTimes(1))
    expect(lastKeep()()).toBe('u-a')
  })

  test('shared-leave-08: getMe が 401 で 1 回、keep() は null', async () => {
    getMe.mockRejectedValue(new ApiError(401, 'Unauthorized'))
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('anonymous'))

    await waitFor(() => expect(reclaimAudioCaches).toHaveBeenCalledTimes(1))
    expect(lastKeep()()).toBeNull()
  })

  test('shared-leave-08: getMe が通信断（unavailable）なら 0 回。retry でも走らない', async () => {
    getMe.mockRejectedValueOnce(new ApiError(0, 'Network error'))
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('unavailable'))
    expect(reclaimAudioCaches).not.toHaveBeenCalled()

    getMe.mockRejectedValueOnce(new ApiError(0, 'Network error'))
    await userEvent.click(screen.getByText('retry'))
    await waitFor(() => expect(getMe).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('unavailable'))
    expect(reclaimAudioCaches).not.toHaveBeenCalled()
  })

  test('shared-leave-10: getMe の user_id が形式不正なら 1 回走り、keep() は null（未認証と同じ回収）', async () => {
    getMe.mockResolvedValue({ ...ME_A, user_id: 'a b' })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('authenticated'))

    await waitFor(() => expect(reclaimAudioCaches).toHaveBeenCalledTimes(1))
    expect(lastKeep()()).toBeNull()
  })

  test('shared-leave-08: 成功の後の refreshMe（2 回目の確定事象）では回収を繰り返さない', async () => {
    getMe.mockResolvedValue(ME_A)
    renderAuth()
    await waitFor(() => expect(reclaimAudioCaches).toHaveBeenCalledTimes(1))

    await act(async () => {
      await auth.refreshMe()
    })

    expect(reclaimAudioCaches).toHaveBeenCalledTimes(1)
  })
})

describe('未確定の後の確定で回収 (verifies: shared-leave-09)', () => {
  test('shared-leave-09: unavailable の後の login 成功で 1 回、keep() は B', async () => {
    getMe.mockRejectedValue(new ApiError(0, 'Network error'))
    login.mockResolvedValue(AUTH_B('u-b'))
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('unavailable'))

    await userEvent.click(screen.getByText('login'))

    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('authenticated'))
    expect(reclaimAudioCaches).toHaveBeenCalledTimes(1)
    expect(lastKeep()()).toBe('u-b')
  })

  test('shared-leave-09: unavailable の後の register 成功でも 1 回、keep() は B', async () => {
    getMe.mockRejectedValue(new ApiError(0, 'Network error'))
    register.mockResolvedValue(AUTH_B('u-b'))
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('unavailable'))

    await userEvent.click(screen.getByText('register'))

    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('authenticated'))
    expect(reclaimAudioCaches).toHaveBeenCalledTimes(1)
    expect(lastKeep()()).toBe('u-b')
  })

  test('shared-leave-09: 401 の後の login 成功でも回収は合計 1 回（401 のときの 1 回だけ）', async () => {
    getMe.mockRejectedValue(new ApiError(401, 'Unauthorized'))
    login.mockResolvedValue(AUTH_B('u-b'))
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('anonymous'))
    await waitFor(() => expect(reclaimAudioCaches).toHaveBeenCalledTimes(1))

    await userEvent.click(screen.getByText('login'))

    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('authenticated'))
    expect(reclaimAudioCaches).toHaveBeenCalledTimes(1)
  })
})

describe('web-dec-85 回収を保留したまま B が確立する', () => {
  test('回収の呼出は 1 回のまま、渡された keep は login の前は null・後は B を返す。回収を再開しても追加の呼出は無い', async () => {
    let finishReclaim: () => void = () => {}
    reclaimAudioCaches.mockReturnValue(
      new Promise<void>((resolve) => {
        finishReclaim = resolve
      }),
    )
    getMe.mockRejectedValue(new ApiError(401, 'Unauthorized'))
    login.mockResolvedValue(AUTH_B('u-b'))
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('anonymous'))
    await waitFor(() => expect(reclaimAudioCaches).toHaveBeenCalledTimes(1))
    const keep = lastKeep()
    expect(keep()).toBeNull()

    await userEvent.click(screen.getByText('login'))
    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('authenticated'))

    expect(reclaimAudioCaches).toHaveBeenCalledTimes(1)
    expect(keep()).toBe('u-b')

    await act(async () => {
      finishReclaim()
    })
    expect(reclaimAudioCaches).toHaveBeenCalledTimes(1)
  })
})

describe('logout の後始末 (verifies: shared-leave-01, web-dec-79, web-dec-84)', () => {
  test('shared-leave-01: 音声・SW キャッシュ・主体依存の端末設定が消え、theme と他の端末設定は残る', async () => {
    const prefs = memoryStoreWithData({
      default_playback_speed: '1.5',
      seen_achievement_ids: '["x"]',
      theme: 'light',
      sfx_enabled: 'false',
    })
    localStorage.setItem('podcast_position:p1', '12')
    localStorage.setItem('podcast_position:p2', '34')
    localStorage.setItem('unrelated_key', 'keep')
    getMe.mockResolvedValue(ME_A)
    logout.mockResolvedValue({ status: 'ok' })
    renderAuth(prefs.store)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))

    await userEvent.click(screen.getByText('logout'))

    await waitFor(() => expect(deleteSubjectAudio).toHaveBeenCalledWith(null, 'u-a'))
    await waitFor(() => expect(clearManagedServiceWorkerCaches).toHaveBeenCalled())
    await waitFor(() => expect(prefs.data.has('default_playback_speed')).toBe(false))
    expect(prefs.data.has('seen_achievement_ids')).toBe(false)
    expect(prefs.data.get('theme')).toBe('light')
    expect(prefs.data.get('sfx_enabled')).toBe('false')
    await waitFor(() => expect(localStorage.getItem('podcast_position:p1')).toBeNull())
    expect(localStorage.getItem('podcast_position:p2')).toBeNull()
    expect(localStorage.getItem('unrelated_key')).toBe('keep')
  })

  test('shared-leave-01: 全 4 手順を呼ぶ。deleteSubjectAudio が reject しても unauthenticated になり、SW キャッシュ消去は実行される', async () => {
    getMe.mockResolvedValue(ME_A)
    logout.mockResolvedValue({ status: 'ok' })
    deleteSubjectAudio.mockRejectedValue(new Error('cache clear failed'))
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))

    await userEvent.click(screen.getByText('logout'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    await waitFor(() => expect(clearManagedServiceWorkerCaches).toHaveBeenCalled())
  })

  test('web-dec-79: deleteSubjectAudio が未解決でも logout() は解決して unauthenticated になる（後始末を待たない）', async () => {
    getMe.mockResolvedValue(ME_A)
    logout.mockResolvedValue({ status: 'ok' })
    deleteSubjectAudio.mockReturnValue(new Promise<void>(() => {}))
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))

    let settled = false
    await act(async () => {
      await auth.logout()
      settled = true
    })

    expect(settled).toBe(true)
    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
  })

  test('web-dec-84: 登録した再生停止が deleteSubjectAudio より先に呼ばれる', async () => {
    getMe.mockResolvedValue(ME_A)
    logout.mockResolvedValue({ status: 'ok' })
    const order: string[] = []
    deleteSubjectAudio.mockImplementation(() => {
      order.push('deleteAudio')
      return Promise.resolve()
    })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    act(() => {
      auth.registerSubjectLeaveStep(() => {
        order.push('stopPlayback')
      })
    })

    await userEvent.click(screen.getByText('logout'))

    await waitFor(() => expect(deleteSubjectAudio).toHaveBeenCalledTimes(1))
    expect(order).toEqual(['stopPlayback', 'deleteAudio'])
  })

  test('shared-leave-01: logout の後始末は旧実装の端末全体の音声消去を残さない（reclaim は logout では走らない）', async () => {
    getMe.mockResolvedValue(ME_A)
    logout.mockResolvedValue({ status: 'ok' })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    await waitFor(() => expect(reclaimAudioCaches).toHaveBeenCalledTimes(1))

    await userEvent.click(screen.getByText('logout'))
    await waitFor(() => expect(deleteSubjectAudio).toHaveBeenCalledTimes(1))

    expect(reclaimAudioCaches).toHaveBeenCalledTimes(1)
  })
})

describe('registerSubjectLeaveStep (verifies: web-dec-73)', () => {
  test('登録した停止は logout で 1 回呼ばれ、解除した後の logout では呼ばれない', async () => {
    getMe.mockResolvedValue(ME_A)
    logout.mockResolvedValue({ status: 'ok' })
    const stop = vi.fn()
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    let unregister: () => void = () => {}
    act(() => {
      unregister = auth.registerSubjectLeaveStep(stop)
    })

    await userEvent.click(screen.getByText('logout'))
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1))

    // 同じ Provider でもう一度主体を確立し、解除後の logout を確かめる
    getMe.mockResolvedValue(ME_A)
    await act(async () => {
      await auth.refreshMe()
    })
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    unregister()
    stop.mockClear()
    await userEvent.click(screen.getByText('logout'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    await waitFor(() => expect(deleteSubjectAudio).toHaveBeenCalledTimes(2))
    expect(stop).not.toHaveBeenCalled()
  })

  test('古い登録の解除関数は、後から登録された停止を外さない', async () => {
    getMe.mockResolvedValue(ME_A)
    logout.mockResolvedValue({ status: 'ok' })
    const first = vi.fn()
    const second = vi.fn()
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    let unregisterFirst: () => void = () => {}
    act(() => {
      unregisterFirst = auth.registerSubjectLeaveStep(first)
      auth.registerSubjectLeaveStep(second)
      unregisterFirst()
    })

    await userEvent.click(screen.getByText('logout'))

    await waitFor(() => expect(second).toHaveBeenCalledTimes(1))
    expect(first).not.toHaveBeenCalled()
  })

  test('停止が throw する状態で refreshMe が 401（A あり）なら { cleanup: incomplete }', async () => {
    getMe.mockResolvedValueOnce(ME_A)
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    act(() => {
      auth.registerSubjectLeaveStep(() => {
        throw new Error('stop failed')
      })
    })
    getMe.mockRejectedValueOnce(new ApiError(401, 'Unauthorized'))

    let result: Awaited<ReturnType<typeof auth.refreshMe>> | undefined
    await act(async () => {
      result = await auth.refreshMe()
    })

    expect(result).toEqual({ cleanup: 'incomplete' })
    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
  })

  test('shared-leave-02: 実行中の 401（A あり）は (b)(c)(d) だけで、音声は消さず、回収も走らせない。cleanup は done', async () => {
    getMe.mockResolvedValueOnce(ME_A)
    renderAuth()
    await waitFor(() => expect(reclaimAudioCaches).toHaveBeenCalledTimes(1))
    const stop = vi.fn()
    act(() => {
      auth.registerSubjectLeaveStep(stop)
    })
    getMe.mockRejectedValueOnce(new ApiError(401, 'Unauthorized'))

    let result: Awaited<ReturnType<typeof auth.refreshMe>> | undefined
    await act(async () => {
      result = await auth.refreshMe()
    })

    expect(result).toEqual({ cleanup: 'done' })
    expect(stop).toHaveBeenCalledTimes(1)
    expect(clearManagedServiceWorkerCaches).toHaveBeenCalledTimes(1)
    expect(deleteSubjectAudio).not.toHaveBeenCalled()
    expect(reclaimAudioCaches).toHaveBeenCalledTimes(1)
  })
})

describe('currentUserId (verifies: web-dec-80)', () => {
  test('getMe 成功で A、通信断（unavailable）の後も A のまま、続く 401 で null。関数の同一性は保たれる', async () => {
    getMe.mockResolvedValueOnce(ME_A)
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('authenticated'))
    const identity = auth.currentUserId
    expect(auth.currentUserId()).toBe('u-a')

    getMe.mockRejectedValueOnce(new ApiError(0, 'Network error'))
    await act(async () => {
      await auth.refreshMe()
    })
    expect(screen.getByTestId('kind').textContent).toBe('unavailable')
    expect(auth.currentUserId()).toBe('u-a')

    getMe.mockRejectedValueOnce(new ApiError(401, 'Unauthorized'))
    await act(async () => {
      await auth.refreshMe()
    })
    expect(auth.currentUserId()).toBeNull()
    expect(auth.currentUserId).toBe(identity)
  })

  test('logout の後は null', async () => {
    getMe.mockResolvedValue(ME_A)
    logout.mockResolvedValue({ status: 'ok' })
    renderAuth()
    await waitFor(() => expect(auth.currentUserId()).toBe('u-a'))

    await userEvent.click(screen.getByText('logout'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(auth.currentUserId()).toBeNull()
  })

  test('起動時の解決前（getMe 保留）は null', async () => {
    getMe.mockReturnValue(new Promise(() => {}))
    renderAuth()
    await waitFor(() => expect(getMe).toHaveBeenCalled())
    expect(screen.getByTestId('kind').textContent).toBe('resolving')
    expect(auth.currentUserId()).toBeNull()
  })

  test('login 成功の直後から B を返す。user_id が形式不正なら null', async () => {
    getMe.mockRejectedValue(new ApiError(401, 'Unauthorized'))
    login.mockResolvedValueOnce(AUTH_B('u-b')).mockResolvedValueOnce(AUTH_B('a/b'))
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('anonymous'))

    await userEvent.click(screen.getByText('login'))
    await waitFor(() => expect(auth.currentUserId()).toBe('u-b'))

    getMe.mockRejectedValue(new ApiError(0, 'Network error'))
    await act(async () => {
      await auth.refreshMe()
    })
    await userEvent.click(screen.getByText('login'))
    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('authenticated'))
    expect(auth.currentUserId()).toBeNull()
  })
})

describe('遷移④ 主体の交代の後始末 (verifies: web-dec-77, shared-leave-07, web-dec-84)', () => {
  async function signInA() {
    getMe.mockResolvedValueOnce(ME_A)
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('authenticated'))
    await waitFor(() => expect(reclaimAudioCaches).toHaveBeenCalledTimes(1))
  }
  async function goUnavailable() {
    getMe.mockRejectedValueOnce(new ApiError(0, 'Network error'))
    await act(async () => {
      await auth.refreshMe()
    })
    expect(screen.getByTestId('kind').textContent).toBe('unavailable')
  }

  test('A → unavailable → B の login で deleteSubjectAudio が A で 1 回、B では 0 回。回収は追加で呼ばれず、停止が音声削除より先', async () => {
    const order: string[] = []
    deleteSubjectAudio.mockImplementation((_store: unknown, id: string) => {
      order.push(`deleteAudio:${id}`)
      return Promise.resolve()
    })
    login.mockResolvedValue(AUTH_B('u-b'))
    await signInA()
    act(() => {
      auth.registerSubjectLeaveStep(() => {
        order.push('stopPlayback')
      })
    })
    await goUnavailable()

    await userEvent.click(screen.getByText('login'))

    await waitFor(() => expect(deleteSubjectAudio).toHaveBeenCalledTimes(1))
    expect(deleteSubjectAudio).toHaveBeenCalledWith(null, 'u-a')
    expect(deleteSubjectAudio).not.toHaveBeenCalledWith(null, 'u-b')
    expect(reclaimAudioCaches).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['stopPlayback', 'deleteAudio:u-a'])
    expect(auth.currentUserId()).toBe('u-b')
  })

  test('web-dec-79 shared-leave-07: deleteSubjectAudio が未解決でも login は解決して B で authenticated になる', async () => {
    deleteSubjectAudio.mockReturnValue(new Promise<void>(() => {}))
    login.mockResolvedValue(AUTH_B('u-b'))
    await signInA()
    await goUnavailable()

    await userEvent.click(screen.getByText('login'))

    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('authenticated'))
    expect(screen.getByTestId('user')).toHaveTextContent('bob')
    expect(deleteSubjectAudio).toHaveBeenCalledWith(null, 'u-a')
  })

  test('web-dec-77: A の user_id が無い（null の主体）なら deleteSubjectAudio は 0 回で、SW キャッシュ消去は行われる', async () => {
    login.mockResolvedValue(AUTH_B('u-b'))
    getMe.mockResolvedValueOnce({ username: 'alice', role: 'user', display_name: 'Alice' })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('authenticated'))
    await goUnavailable()

    await userEvent.click(screen.getByText('login'))

    await waitFor(() => expect(clearManagedServiceWorkerCaches).toHaveBeenCalled())
    expect(deleteSubjectAudio).not.toHaveBeenCalled()
  })

  test('web-dec-77: B の user_id が無くても A が非 null なら deleteSubjectAudio(A) が 1 回走る', async () => {
    login.mockResolvedValue(AUTH_B())
    await signInA()
    await goUnavailable()

    await userEvent.click(screen.getByText('login'))

    await waitFor(() => expect(deleteSubjectAudio).toHaveBeenCalledTimes(1))
    expect(deleteSubjectAudio).toHaveBeenCalledWith(null, 'u-a')
  })

  test('web-dec-77: A と B がともに同じ user_id なら deleteSubjectAudio も SW キャッシュ消去も 0 回', async () => {
    login.mockResolvedValue(AUTH_B('u-a'))
    await signInA()
    await goUnavailable()
    const stop = vi.fn()
    act(() => {
      auth.registerSubjectLeaveStep(stop)
    })

    await userEvent.click(screen.getByText('login'))

    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('authenticated'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(deleteSubjectAudio).not.toHaveBeenCalled()
    expect(clearManagedServiceWorkerCaches).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
  })

  test('web-dec-77: 直前の主体が無い（起動時 401 の後の login）なら何も後始末しない', async () => {
    getMe.mockRejectedValue(new ApiError(401, 'Unauthorized'))
    login.mockResolvedValue(AUTH_B('u-b'))
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('anonymous'))
    clearManagedServiceWorkerCaches.mockClear()

    await userEvent.click(screen.getByText('login'))

    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('authenticated'))
    expect(deleteSubjectAudio).not.toHaveBeenCalled()
    expect(clearManagedServiceWorkerCaches).not.toHaveBeenCalled()
  })
})
