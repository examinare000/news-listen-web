import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React, { useState } from 'react'
import { PreferencesProvider } from '@/contexts/PreferencesProvider'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'
import { AuthProvider, useAuth } from '@/contexts/AuthProvider'
import { useApiClient } from '@/contexts/ApiClientProvider'
import { setupMockCaches } from '../helpers/mockCaches'
import { createGatewayDouble } from '../helpers/gatewayDouble'
import type { GatewayDouble } from '../helpers/gatewayDouble'

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

// web-contract-18（部分）: 失効経路（refreshMe の getMe 失敗）でも SW 管理キャッシュ（shell-*/api-*）を
// 消す。音声は主体別 audio-v1-{user_id}（ADR-104 決定 27 / web-dec-83）: 実行中の 401 では消さず（次回起動の回収が消す）、
// mount 後の最初の確定事象が 401 のとき（起動時の 401）は回収が audio-v1* を全削除する。
// C4: 既存 tests/contexts/AuthProvider.test.tsx は @/lib/swCacheCleanup・@/lib/playback/infrastructure/offlineLibrary を
// モジュールごと mock しているため実 cleanup を観測できない。本ファイルは @/lib/api/gateway の
// createGateway だけを gateway double に差し替え、実 clearManagedServiceWorkerCaches を通す。
const holder = vi.hoisted(() => ({ gw: undefined as GatewayDouble | undefined }))

vi.mock('@/lib/api/gateway', () => ({ createGateway: () => holder.gw }))

const ME_PATH = '/api/backend/auth/me'

let gw: GatewayDouble

function callsTo(method: string, path: string) {
  return gw.calls.filter((c) => c.method === method && c.path === path)
}

// web-contract-18 の失効 cleanup の発火条件は 2026-09-17 の user 裁定で候補 (b) に確定した
// （getMe が unauthorized の失敗を返したときのみ発火。直前の状態は問わない）。
// 候補 (a)/(c) は再提案しない（棄却済み）。T-T15b/T-T15c/T-T15f は (b) の期待値で固定する。

function Consumer() {
  const { view, refreshMe } = useAuth()
  const status = view.kind === 'authenticated' ? 'authenticated' : view.kind === 'anonymous' ? 'unauthenticated' : 'unknown'
  const [cleanup, setCleanup] = useState('')
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="cleanup">{cleanup}</span>
      <button
        onClick={() => {
          // 呼出前に前回の表示値をリセットする。連続呼出テスト（T-T15f）で
          // 「前回値が残ったまま waitFor が即成立する」誤検出を防ぐため。
          setCleanup('')
          refreshMe()
            .then((result) => setCleanup(result.cleanup))
            .catch(() => setCleanup('rejected'))
        }}
      >
        refresh
      </button>
    </div>
  )
}

function renderAuth(initial: 'authenticated' | 'resolving' = 'authenticated') {
  return render(
    <PreferencesProvider store={memoryStore()}>
      <AuthProvider
        // 'resolving' は initialSession を渡さず、AuthProvider の mount 時自動解決
        // （useEffect の void refreshMe()）を発火させる（T-T15c 用）。
        initialSession={
          initial === 'resolving'
            ? undefined
            : { kind: 'authenticated', user: { username: 'alice', role: 'user', display_name: 'Alice', userId: 'u-alice' } }
        }
      >
        <Consumer />
      </AuthProvider>
    </PreferencesProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  gw = createGatewayDouble()
  holder.gw = gw
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AuthProvider failure cleanup (verifies: web-contract-18)', () => {
  test('T-T15a: clears shell-*/api-* but keeps audio-v1-{userId} on a mid-session 401 (verifies: web-contract-18-1, web-contract-18-2, shared-leave-02)', async () => {
    const cacheStorage = setupMockCaches()
    await cacheStorage.open('audio-v1')
    await cacheStorage.open('audio-v1-u-alice')
    await cacheStorage.open('shell-pages-v1')
    await cacheStorage.open('api-v1')
    gw.respond('GET', ME_PATH, { ok: true, value: { user_id: 'u-alice', username: 'alice', role: 'user', display_name: 'Alice' } })
    renderAuth('resolving')
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    // 起動時の回収（旧名 audio-v1 を消す）が終わってから 401 にする。途中に 401 が入ると回収の keep が null になる。
    await waitFor(() => expect(cacheStorage.has('audio-v1')).resolves.toBe(false))
    gw.respond('GET', ME_PATH, { ok: false, failure: { kind: 'unauthorized' } })

    await userEvent.click(screen.getByText('refresh'))

    await waitFor(() => expect(screen.getByTestId('cleanup')).toHaveTextContent('done'))
    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    await expect(cacheStorage.has('shell-pages-v1')).resolves.toBe(false)
    await expect(cacheStorage.has('api-v1')).resolves.toBe(false)
    await expect(cacheStorage.has('audio-v1-u-alice')).resolves.toBe(true)
  })

  test('T-T15d: state transitions to unauthenticated and cleanup is reported incomplete when cache deletion fails (verifies: web-contract-18-3)', async () => {
    const cacheStorage = setupMockCaches()
    await cacheStorage.open('shell-pages-v1')
    vi.spyOn(cacheStorage, 'delete').mockRejectedValue(new Error('quota'))
    gw.respond('GET', ME_PATH, { ok: false, failure: { kind: 'unauthorized' } })
    renderAuth()

    await userEvent.click(screen.getByText('refresh'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(screen.getByTestId('cleanup')).toHaveTextContent('incomplete')
  })

  test('T-T15e: reclaims audio-v1 (non-current subjects) but keeps the current subject cache, shell and api when getMe succeeds (verifies: web-contract-18-4, shared-leave-08)', async () => {
    const cacheStorage = setupMockCaches()
    await cacheStorage.open('audio-v1')
    await cacheStorage.open('shell-pages-v1')
    await cacheStorage.open('api-v1')
    await cacheStorage.open('audio-v1-u-alice')
    gw.respond('GET', ME_PATH, { ok: true, value: { user_id: 'u-alice', username: 'alice', role: 'user', display_name: 'Alice' } })
    renderAuth()

    await userEvent.click(screen.getByText('refresh'))

    // status は初めから authenticated なので、回収まで終えて返る refreshMe の結果（cleanup 表示）で待つ
    await waitFor(() => expect(screen.getByTestId('cleanup')).toHaveTextContent('skipped'))
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    await expect(cacheStorage.has('audio-v1')).resolves.toBe(false)
    await expect(cacheStorage.has('audio-v1-u-alice')).resolves.toBe(true)
    await expect(cacheStorage.has('shell-pages-v1')).resolves.toBe(true)
    await expect(cacheStorage.has('api-v1')).resolves.toBe(true)
  })

  test('T-T15b: shared-leave-03: does not clear any cache and stays unavailable (status unknown) when getMe rejects with a non-401 failure (network error) (verifies: web-contract-18-2, web-contract-18-4)', async () => {
    const cacheStorage = setupMockCaches()
    await cacheStorage.open('audio-v1')
    await cacheStorage.open('shell-pages-v1')
    await cacheStorage.open('api-v1')
    gw.respond('GET', ME_PATH, { ok: false, failure: { kind: 'network' } })
    renderAuth()

    await userEvent.click(screen.getByText('refresh'))

    // shared-leave-03: 401 以外の失敗は未認証にしない（unavailable。status は 'unknown'）
    await waitFor(() => expect(screen.getByTestId('cleanup').textContent).toBe('skipped'))
    expect(screen.getByTestId('status').textContent).toBe('unknown')
    await expect(cacheStorage.has('audio-v1')).resolves.toBe(true)
    await expect(cacheStorage.has('shell-pages-v1')).resolves.toBe(true)
    await expect(cacheStorage.has('api-v1')).resolves.toBe(true)
  })

  test('T-T15c: clears shell-*/api-* and reclaims all audio-v1* on the initial mount auto-resolve when getMe rejects with an unauthorized (401) failure (verifies: web-contract-18-1, web-contract-18-2, shared-leave-08)', async () => {
    const cacheStorage = setupMockCaches()
    await cacheStorage.open('audio-v1')
    await cacheStorage.open('shell-pages-v1')
    await cacheStorage.open('api-v1')
    gw.respond('GET', ME_PATH, { ok: false, failure: { kind: 'unauthorized' } })
    renderAuth('resolving')

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    await expect(cacheStorage.has('shell-pages-v1')).resolves.toBe(false)
    await expect(cacheStorage.has('api-v1')).resolves.toBe(false)
    await waitFor(() => expect(cacheStorage.has('audio-v1')).resolves.toBe(false))
  })

  test('T-T15f: a second consecutive expiry cleanup is a no-op that still resolves as done and audio-v1 is already reclaimed (verifies: web-contract-18-6, shared-leave-08)', async () => {
    const cacheStorage = setupMockCaches()
    await cacheStorage.open('audio-v1')
    await cacheStorage.open('shell-pages-v1')
    await cacheStorage.open('api-v1')
    gw.respond('GET', ME_PATH, { ok: false, failure: { kind: 'unauthorized' } })
    renderAuth()

    await userEvent.click(screen.getByText('refresh'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(screen.getByTestId('cleanup')).toHaveTextContent('done')

    await userEvent.click(screen.getByText('refresh'))
    await waitFor(() => expect(screen.getByTestId('cleanup')).toHaveTextContent('done'))
    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    // 1 回目の 401 が最初の確定事象なので回収が全削除する。2 回目は回収が走らず、何も変わらない
    await expect(cacheStorage.has('audio-v1')).resolves.toBe(false)
  })
})

// Provider 経由の任意 API の unauthorized（ApiClientProvider の onUnauthorized → expire）。
// 後始末の回数は clearManagedServiceWorkerCaches が 1 回につき 1 回呼ぶ caches.keys() の spy で数える。
// 起動時の回収（reclaimOnce）が済んでから spy を仕掛ける。initialSession だと最初の expire() が回収を起動し
// audio-v1-u-alice が消えるので、getMe 成功で起動する。
describe('AuthProvider expire via ApiClientProvider (verifies: web-contract-18, shared-leave-05)', () => {
  const ALICE_ME = { user_id: 'u-alice', username: 'alice', role: 'user', display_name: 'Alice' }
  const OTHER_PATH = '/api/backend/podcasts'
  const OTHER_PATH_2 = '/api/backend/feed'
  const LOGIN_PATH = '/api/backend/auth/login'

  function Prober() {
    const { view, login } = useAuth()
    const status = view.kind === 'authenticated' ? 'authenticated' : view.kind === 'anonymous' ? 'unauthenticated' : 'unknown'
    const client = useApiClient()
    const [loginFailure, setLoginFailure] = useState('')
    return (
      <div>
        <span data-testid="status">{status}</span>
        <span data-testid="login-result">{loginFailure}</span>
        <button onClick={() => void client.request(OTHER_PATH)}>call-one</button>
        <button
          onClick={() => {
            void client.request(OTHER_PATH)
            void client.request(OTHER_PATH_2)
          }}
        >
          call-two
        </button>
        <button
          onClick={() => {
            void login('alice', 'wrong').then((r) => setLoginFailure(r.ok ? 'ok' : r.failure.kind))
          }}
        >
          login
        </button>
      </div>
    )
  }

  function renderProber() {
    return render(
      <PreferencesProvider store={memoryStore()}>
        <AuthProvider>
          <Prober />
        </AuthProvider>
      </PreferencesProvider>,
    )
  }

  async function startAuthenticated() {
    const cacheStorage = setupMockCaches()
    await cacheStorage.open('audio-v1')
    await cacheStorage.open('audio-v1-u-alice')
    await cacheStorage.open('shell-pages-v1')
    await cacheStorage.open('api-v1')
    gw.respond('GET', ME_PATH, { ok: true, value: ALICE_ME })
    renderProber()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    // 起動時の回収（旧名 audio-v1 を消す）が終わってから始める
    await waitFor(() => expect(cacheStorage.has('audio-v1')).resolves.toBe(false))
    return cacheStorage
  }

  test('T-T15g: an unauthorized from any API through the Provider moves authenticated to unauthenticated and clears shell-*/api-* but keeps audio-v1-{userId} (verifies: web-contract-18, shared-leave-02, shared-leave-05)', async () => {
    const cacheStorage = await startAuthenticated()
    gw.respond('GET', OTHER_PATH, { ok: false, failure: { kind: 'unauthorized' } })

    await userEvent.click(screen.getByText('call-one'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    await waitFor(() => expect(cacheStorage.has('shell-pages-v1')).resolves.toBe(false))
    await expect(cacheStorage.has('api-v1')).resolves.toBe(false)
    await expect(cacheStorage.has('audio-v1-u-alice')).resolves.toBe(true)
  })

  test('T-T15h: two simultaneous unauthorized responses run the cleanup exactly once (verifies: web-contract-18, shared-leave-05)', async () => {
    const cacheStorage = await startAuthenticated()
    const keys = vi.spyOn(cacheStorage, 'keys')
    gw.respond('GET', OTHER_PATH, { ok: false, failure: { kind: 'unauthorized' } })
    gw.respond('GET', OTHER_PATH_2, { ok: false, failure: { kind: 'unauthorized' } })

    await userEvent.click(screen.getByText('call-two'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    await waitFor(() => expect(keys).toHaveBeenCalled())
    // 後続の後始末が走る猶予を与えてから回数を確かめる
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(keys).toHaveBeenCalledTimes(1)
  })

  test('T-T15i: a login 401 while unauthenticated changes neither the state nor the cleanup (verifies: web-contract-18, shared-leave-05)', async () => {
    const cacheStorage = setupMockCaches()
    await cacheStorage.open('shell-pages-v1')
    gw.respond('GET', ME_PATH, { ok: false, failure: { kind: 'unauthorized' } })
    renderProber()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    // 起動時の 401 の後始末が済んでから spy を仕掛ける
    await waitFor(() => expect(cacheStorage.has('shell-pages-v1')).resolves.toBe(false))
    await new Promise((resolve) => setTimeout(resolve, 30))
    const keys = vi.spyOn(cacheStorage, 'keys')
    gw.respond('POST', LOGIN_PATH, { ok: false, failure: { kind: 'unauthorized' } })

    await userEvent.click(screen.getByText('login'))

    await waitFor(() => expect(screen.getByTestId('login-result')).toHaveTextContent('unauthorized'))
    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(keys).not.toHaveBeenCalled()
  })

  test('T-T15j: an unauthorized while resolving or unavailable changes neither the state nor the cleanup (verifies: web-contract-18, shared-leave-05)', async () => {
    const cacheStorage = setupMockCaches()
    await cacheStorage.open('shell-pages-v1')
    const keys = vi.spyOn(cacheStorage, 'keys')
    let settleMe: (() => void) | undefined
    gw.respondWith('GET', ME_PATH, () =>
      new Promise((resolve) => {
        settleMe = () => resolve({ ok: false, failure: { kind: 'network' } })
      }),
    )
    gw.respond('GET', OTHER_PATH, { ok: false, failure: { kind: 'unauthorized' } })
    renderProber()
    await waitFor(() => expect(callsTo('GET', ME_PATH)).toHaveLength(1))

    // resolving（getMe が未解決）
    await userEvent.click(screen.getByText('call-one'))
    await waitFor(() => expect(callsTo('GET', OTHER_PATH)).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(screen.getByTestId('status')).toHaveTextContent('unknown')
    expect(keys).not.toHaveBeenCalled()

    // unavailable（getMe が network で確定）
    settleMe?.()
    await new Promise((resolve) => setTimeout(resolve, 30))
    await userEvent.click(screen.getByText('call-one'))
    await waitFor(() => expect(callsTo('GET', OTHER_PATH)).toHaveLength(2))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(screen.getByTestId('status')).toHaveTextContent('unknown')
    expect(keys).not.toHaveBeenCalled()
    await expect(cacheStorage.has('shell-pages-v1')).resolves.toBe(true)
  })
})

describe('AuthProvider initialSession (verifies: web-contract-18)', () => {
  test('initialSession を渡したときは、refresh を押すまで getMe を呼ばない（自動解決しない）', async () => {
    gw.respond('GET', ME_PATH, { ok: true, value: { username: 'alice', role: 'user', display_name: 'Alice' } })
    renderAuth('authenticated')

    // 自動解決が走るなら effect が非同期に getMe を呼ぶ。描画後に十分待っても 0 回であること
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(callsTo('GET', ME_PATH)).toHaveLength(0)

    await userEvent.click(screen.getByText('refresh'))
    await waitFor(() => expect(callsTo('GET', ME_PATH)).toHaveLength(1))
  })

  test('initialSession を渡さないと、mount 時に getMe を 1 回呼んで解決する', async () => {
    gw.respond('GET', ME_PATH, { ok: true, value: { username: 'alice', role: 'user', display_name: 'Alice' } })
    renderAuth('resolving')

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
    expect(callsTo('GET', ME_PATH)).toHaveLength(1)
  })
})
