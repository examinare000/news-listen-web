import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React, { useState } from 'react'
import { PreferencesProvider } from '@/contexts/PreferencesProvider'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'
import { AuthProvider, useAuth } from '@/contexts/AuthProvider'
import { setupMockCaches } from '../helpers/mockCaches'

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
// 消す。audio-v1 は失効経路では消さない（棄却済み: 主体付き key・SW 一元化）。
// C4: 既存 tests/contexts/AuthProvider.test.tsx は @/lib/swCacheCleanup・@/lib/playback/infrastructure/offlineLibrary を
// モジュールごと mock しているため実 cleanup を観測できない。本ファイルは @/lib/api のみ
// createApiClient を差し替え、実 ApiError・実 clearManagedServiceWorkerCaches を通す。
const getMe = vi.fn()

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    createApiClient: () => ({ getMe }),
  }
})

// web-contract-18 の失効 cleanup の発火条件は 2026-09-17 の user 裁定で候補 (b) に確定した
// （`err instanceof ApiError && err.status === 401` のときのみ発火。直前 status は問わない）。
// 候補 (a)/(c) は再提案しない（棄却済み）。T-T15b/T-T15c/T-T15f は (b) の期待値で固定する。

function Consumer() {
  const { status, refreshMe } = useAuth()
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
            : { kind: 'authenticated', user: { username: 'alice', role: 'user', display_name: 'Alice' } }
        }
      >
        <Consumer />
      </AuthProvider>
    </PreferencesProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AuthProvider failure cleanup (verifies: web-contract-18)', () => {
  test('T-T15a: clears shell-*/api-* but keeps audio-v1 when getMe rejects with ApiError(401) (verifies: web-contract-18-1, web-contract-18-2)', async () => {
    const cacheStorage = setupMockCaches()
    await cacheStorage.open('audio-v1')
    await cacheStorage.open('shell-pages-v1')
    await cacheStorage.open('api-v1')
    const { ApiError } = await import('@/lib/api')
    getMe.mockRejectedValue(new ApiError(401, 'Unauthorized'))
    renderAuth()

    await userEvent.click(screen.getByText('refresh'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    await expect(cacheStorage.has('shell-pages-v1')).resolves.toBe(false)
    await expect(cacheStorage.has('api-v1')).resolves.toBe(false)
    await expect(cacheStorage.has('audio-v1')).resolves.toBe(true)
    expect(screen.getByTestId('cleanup')).toHaveTextContent('done')
  })

  test('T-T15d: state transitions to unauthenticated and cleanup is reported incomplete when cache deletion fails (verifies: web-contract-18-3)', async () => {
    const cacheStorage = setupMockCaches()
    await cacheStorage.open('shell-pages-v1')
    vi.spyOn(cacheStorage, 'delete').mockRejectedValue(new Error('quota'))
    const { ApiError } = await import('@/lib/api')
    getMe.mockRejectedValue(new ApiError(401, 'Unauthorized'))
    renderAuth()

    await userEvent.click(screen.getByText('refresh'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(screen.getByTestId('cleanup')).toHaveTextContent('incomplete')
  })

  test('T-T15e: does not touch caches and reports cleanup skipped when getMe succeeds (verifies: web-contract-18-4)', async () => {
    const cacheStorage = setupMockCaches()
    await cacheStorage.open('audio-v1')
    await cacheStorage.open('shell-pages-v1')
    await cacheStorage.open('api-v1')
    getMe.mockResolvedValue({ username: 'alice', role: 'user', display_name: 'Alice' })
    renderAuth()

    await userEvent.click(screen.getByText('refresh'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    expect(screen.getByTestId('cleanup')).toHaveTextContent('skipped')
    await expect(cacheStorage.has('audio-v1')).resolves.toBe(true)
    await expect(cacheStorage.has('shell-pages-v1')).resolves.toBe(true)
    await expect(cacheStorage.has('api-v1')).resolves.toBe(true)
  })

  test('T-T15b: shared-leave-03: does not clear any cache and stays unavailable (status unknown) when getMe rejects with a non-401 ApiError (network error) (verifies: web-contract-18-2, web-contract-18-4)', async () => {
    const cacheStorage = setupMockCaches()
    await cacheStorage.open('audio-v1')
    await cacheStorage.open('shell-pages-v1')
    await cacheStorage.open('api-v1')
    const { ApiError } = await import('@/lib/api')
    getMe.mockRejectedValue(new ApiError(0, 'Network error'))
    renderAuth()

    await userEvent.click(screen.getByText('refresh'))

    // shared-leave-03: 401 以外の失敗は未認証にしない（unavailable。status は 'unknown'）
    await waitFor(() => expect(screen.getByTestId('cleanup').textContent).toBe('skipped'))
    expect(screen.getByTestId('status').textContent).toBe('unknown')
    await expect(cacheStorage.has('audio-v1')).resolves.toBe(true)
    await expect(cacheStorage.has('shell-pages-v1')).resolves.toBe(true)
    await expect(cacheStorage.has('api-v1')).resolves.toBe(true)
  })

  test('T-T15c: clears shell-*/api-* on the initial mount auto-resolve when getMe rejects with ApiError(401) (verifies: web-contract-18-1, web-contract-18-2)', async () => {
    const cacheStorage = setupMockCaches()
    await cacheStorage.open('audio-v1')
    await cacheStorage.open('shell-pages-v1')
    await cacheStorage.open('api-v1')
    const { ApiError } = await import('@/lib/api')
    getMe.mockRejectedValue(new ApiError(401, 'Unauthorized'))
    renderAuth('resolving')

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    await expect(cacheStorage.has('shell-pages-v1')).resolves.toBe(false)
    await expect(cacheStorage.has('api-v1')).resolves.toBe(false)
    await expect(cacheStorage.has('audio-v1')).resolves.toBe(true)
  })

  test('T-T15f: a second consecutive expiry cleanup is a no-op that still resolves as done (verifies: web-contract-18-6)', async () => {
    const cacheStorage = setupMockCaches()
    await cacheStorage.open('audio-v1')
    await cacheStorage.open('shell-pages-v1')
    await cacheStorage.open('api-v1')
    const { ApiError } = await import('@/lib/api')
    getMe.mockRejectedValue(new ApiError(401, 'Unauthorized'))
    renderAuth()

    await userEvent.click(screen.getByText('refresh'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(screen.getByTestId('cleanup')).toHaveTextContent('done')

    await userEvent.click(screen.getByText('refresh'))
    await waitFor(() => expect(screen.getByTestId('cleanup')).toHaveTextContent('done'))
    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    await expect(cacheStorage.has('audio-v1')).resolves.toBe(true)
  })
})

describe('AuthProvider initialSession (verifies: web-contract-18)', () => {
  test('initialSession を渡したときは、refresh を押すまで getMe を呼ばない（自動解決しない）', async () => {
    getMe.mockResolvedValue({ username: 'alice', role: 'user', display_name: 'Alice' })
    renderAuth('authenticated')

    // 自動解決が走るなら effect が非同期に getMe を呼ぶ。描画後に十分待っても 0 回であること
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(getMe).toHaveBeenCalledTimes(0)

    await userEvent.click(screen.getByText('refresh'))
    await waitFor(() => expect(getMe).toHaveBeenCalledTimes(1))
  })

  test('initialSession を渡さないと、mount 時に getMe を 1 回呼んで解決する', async () => {
    getMe.mockResolvedValue({ username: 'alice', role: 'user', display_name: 'Alice' })
    renderAuth('resolving')

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
    expect(getMe).toHaveBeenCalledTimes(1)
  })
})
