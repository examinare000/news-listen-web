import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React, { useState } from 'react'
import { AppProvider } from '@/contexts/AppContext'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { setupMockCaches } from '../helpers/mockCaches'

// CI-T15（部分）: 失効経路（refreshMe の getMe 失敗）でも SW 管理キャッシュ（shell-*/api-*）を
// 消す。audio-v1 は失効経路では消さない（棄却済み: 主体付き key・SW 一元化）。
// C4: 既存 tests/contexts/AuthContext.test.tsx は @/lib/swCacheCleanup・@/lib/audioCache を
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

// SG-S0-1（失効 cleanup の発火条件）は 2026-09-17 の user 裁定で候補 (b) に確定した
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

function renderAuth(initialStatus: 'authenticated' | 'unknown' = 'authenticated') {
  return render(
    <AppProvider>
      <AuthProvider
        // 'unknown' は initialStatus を渡さず、AuthProvider の mount 時自動解決
        // （useEffect の void refreshMe()）を発火させる（T-T15c 用）。
        initialStatus={initialStatus === 'unknown' ? undefined : initialStatus}
        initialUser={{ username: 'alice', role: 'user', display_name: 'Alice' }}
      >
        <Consumer />
      </AuthProvider>
    </AppProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AuthContext failure cleanup (verifies: CI-T15)', () => {
  test('T-T15a: clears shell-*/api-* but keeps audio-v1 when getMe rejects with ApiError(401) (verifies: CI-T15-1, CI-T15-2)', async () => {
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

  test('T-T15d: state transitions to unauthenticated and cleanup is reported incomplete when cache deletion fails (verifies: CI-T15-3)', async () => {
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

  test('T-T15e: does not touch caches and reports cleanup skipped when getMe succeeds (verifies: CI-T15-4)', async () => {
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

  test('T-T15b: does not clear any cache when getMe rejects with a non-401 ApiError (network error) (verifies: CI-T15-2, CI-T15-4)', async () => {
    const cacheStorage = setupMockCaches()
    await cacheStorage.open('audio-v1')
    await cacheStorage.open('shell-pages-v1')
    await cacheStorage.open('api-v1')
    const { ApiError } = await import('@/lib/api')
    getMe.mockRejectedValue(new ApiError(0, 'Network error'))
    renderAuth()

    await userEvent.click(screen.getByText('refresh'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(screen.getByTestId('cleanup')).toHaveTextContent('skipped')
    await expect(cacheStorage.has('audio-v1')).resolves.toBe(true)
    await expect(cacheStorage.has('shell-pages-v1')).resolves.toBe(true)
    await expect(cacheStorage.has('api-v1')).resolves.toBe(true)
  })

  test('T-T15c: clears shell-*/api-* on the initial mount auto-resolve when getMe rejects with ApiError(401) (verifies: CI-T15-1, CI-T15-2)', async () => {
    const cacheStorage = setupMockCaches()
    await cacheStorage.open('audio-v1')
    await cacheStorage.open('shell-pages-v1')
    await cacheStorage.open('api-v1')
    const { ApiError } = await import('@/lib/api')
    getMe.mockRejectedValue(new ApiError(401, 'Unauthorized'))
    renderAuth('unknown')

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    await expect(cacheStorage.has('shell-pages-v1')).resolves.toBe(false)
    await expect(cacheStorage.has('api-v1')).resolves.toBe(false)
    await expect(cacheStorage.has('audio-v1')).resolves.toBe(true)
  })

  test('T-T15f: a second consecutive expiry cleanup is a no-op that still resolves as done (verifies: CI-T15-6)', async () => {
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
