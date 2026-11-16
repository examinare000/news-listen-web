import React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { StreakProvider, useStreak } from '@/contexts/StreakProvider'
import { createGatewayDouble } from '../helpers/gatewayDouble'
import type { GatewayDouble } from '../helpers/gatewayDouble'

const { playSfx } = vi.hoisted(() => ({
  playSfx: vi.fn(),
}))

const holder = vi.hoisted(() => ({ gw: undefined as GatewayDouble | undefined }))

vi.mock('@/lib/api/gateway', () => ({ createGateway: () => holder.gw }))

vi.mock('@/contexts/SfxProvider', () => ({ useSfx: () => ({ play: playSfx, prepare: vi.fn() }) }))

const STREAK_PATH = '/api/backend/users/me/listening-streak'

let gw: GatewayDouble

function callsTo(method: string, path: string) {
  return gw.calls.filter((c) => c.method === method && c.path === path)
}

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <ApiClientProvider>
      <StreakProvider>{children}</StreakProvider>
    </ApiClientProvider>
  )
}

describe('StreakProvider shared listening streak', () => {
  beforeEach(() => {
    gw = createGatewayDouble()
    holder.gw = gw
    vi.clearAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
  })

  test('loads the streak once and exposes it to all shell consumers', async () => {
    gw.respond('GET', STREAK_PATH, {
      ok: true,
      value: {
        current_streak_days: 4,
        today_listened: true,
        last_listened_day: '2026-07-29',
      },
    })

    const { result } = renderHook(() => useStreak(), { wrapper })

    await waitFor(() => expect(result.current.streak?.days).toBe(4))
    expect(callsTo('GET', STREAK_PATH)).toHaveLength(1)
    expect(playSfx).not.toHaveBeenCalled()
  })

  test('focus refreshes only after the shared value is five minutes stale', async () => {
    gw.respondWith('GET', STREAK_PATH, () =>
      Promise.resolve(
        callsTo('GET', STREAK_PATH).length === 1
          ? {
              ok: true,
              value: {
                current_streak_days: 4,
                today_listened: true,
                last_listened_day: '2026-07-29',
              },
            }
          : {
              ok: true,
              value: {
                current_streak_days: 5,
                today_listened: true,
                last_listened_day: '2026-07-30',
              },
            },
      ),
    )

    const { result } = renderHook(() => useStreak(), { wrapper })
    await waitFor(() => expect(result.current.streak?.days).toBe(4))

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(callsTo('GET', STREAK_PATH)).toHaveLength(1)

    vi.mocked(Date.now).mockReturnValue(1_300_001)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => expect(result.current.streak?.days).toBe(5))
    expect(callsTo('GET', STREAK_PATH)).toHaveLength(2)
    expect(playSfx).toHaveBeenCalledWith('streak')
  })

  test('silently retains the prior streak when a stale refresh fails', async () => {
    gw.respondWith('GET', STREAK_PATH, () =>
      callsTo('GET', STREAK_PATH).length === 1
        ? Promise.resolve({
            ok: true,
            value: {
              current_streak_days: 7,
              today_listened: false,
              last_listened_day: '2026-07-28',
            },
          })
        : Promise.reject(new Error('network')),
    )

    const { result } = renderHook(() => useStreak(), { wrapper })
    await waitFor(() => expect(result.current.streak?.days).toBe(7))

    vi.mocked(Date.now).mockReturnValue(1_300_001)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => expect(callsTo('GET', STREAK_PATH)).toHaveLength(2))
    expect(result.current.streak?.days).toBe(7)
  })
})

// ストリークの全分岐（product-learn-01・product-learn-02・product-learn-17・web-dec-172・web-dec-175）。
const STALE_NOW = 1_300_001

function streakDto(days: number) {
  return { current_streak_days: days, today_listened: true, last_listened_day: '2026-07-29' }
}

function respondStreaks(...outcomes: Array<{ days: number } | 'fail'>) {
  gw.respondWith('GET', STREAK_PATH, () => {
    const outcome = outcomes[Math.min(callsTo('GET', STREAK_PATH).length - 1, outcomes.length - 1)]
    return Promise.resolve(
      outcome === 'fail' ? { ok: false, failure: { kind: 'network' } } : { ok: true, value: streakDto(outcome.days) },
    )
  })
}

function focus() {
  act(() => {
    window.dispatchEvent(new Event('focus'))
  })
}

describe('StreakProvider refresh の全分岐', () => {
  beforeEach(() => {
    gw = createGatewayDouble()
    holder.gw = gw
    vi.clearAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
  })

  test('verifies: CI-LD16 — 4 → 5 に増えたら streak 効果音を 1 回鳴らし、isPulsing が true になって 300ms 後に false に戻る', async () => {
    respondStreaks({ days: 4 }, { days: 5 })
    const { result } = renderHook(() => useStreak(), { wrapper })
    await waitFor(() => expect(result.current.streak?.days).toBe(4))
    expect(result.current.isPulsing).toBe(false)

    vi.mocked(Date.now).mockReturnValue(STALE_NOW)
    focus()

    await waitFor(() => expect(result.current.streak?.days).toBe(5))
    expect(playSfx).toHaveBeenCalledTimes(1)
    expect(playSfx).toHaveBeenCalledWith('streak')
    expect(result.current.isPulsing).toBe(true)
    await waitFor(() => expect(result.current.isPulsing).toBe(false), { timeout: 1500 })
  })

  test('verifies: CI-LD16 — 5 → 5（同値）は効果音も pulse も出さない', async () => {
    respondStreaks({ days: 5 }, { days: 5 })
    const { result } = renderHook(() => useStreak(), { wrapper })
    await waitFor(() => expect(result.current.streak?.days).toBe(5))

    vi.mocked(Date.now).mockReturnValue(STALE_NOW)
    focus()
    await waitFor(() => expect(callsTo('GET', STREAK_PATH)).toHaveLength(2))

    expect(playSfx).not.toHaveBeenCalled()
    expect(result.current.isPulsing).toBe(false)
  })

  test('verifies: CI-LD16 — 5 → 3（減少）も効果音を出さず、表示は新しい値に更新される', async () => {
    respondStreaks({ days: 5 }, { days: 3 })
    const { result } = renderHook(() => useStreak(), { wrapper })
    await waitFor(() => expect(result.current.streak?.days).toBe(5))

    vi.mocked(Date.now).mockReturnValue(STALE_NOW)
    focus()

    await waitFor(() => expect(result.current.streak?.days).toBe(3))
    expect(playSfx).not.toHaveBeenCalled()
  })

  test('verifies: CI-LD16 — 飛行中に refresh を 2 回呼んでも request は 1 回（同じ promise を共有する）', async () => {
    let release: (() => void) | undefined
    gw.respondWith('GET', STREAK_PATH, () => {
      if (callsTo('GET', STREAK_PATH).length === 1) return Promise.resolve({ ok: true, value: streakDto(4) })
      return new Promise((resolve) => {
        release = () => resolve({ ok: true, value: streakDto(5) })
      })
    })
    const { result } = renderHook(() => useStreak(), { wrapper })
    await waitFor(() => expect(result.current.streak?.days).toBe(4))

    vi.mocked(Date.now).mockReturnValue(STALE_NOW)
    let first: Promise<void> | undefined
    let second: Promise<void> | undefined
    act(() => {
      first = result.current.refresh()
      second = result.current.refresh()
    })
    expect(callsTo('GET', STREAK_PATH)).toHaveLength(2)
    await act(async () => {
      release?.()
      await Promise.all([first, second])
    })

    expect(callsTo('GET', STREAK_PATH)).toHaveLength(2)
    expect(result.current.streak?.days).toBe(5)
  })

  test('verifies: CI-LD16 — 失敗した取得は取得時刻を更新しないので、次の focus ですぐ取り直せる（前の値は保つ）', async () => {
    respondStreaks({ days: 7 }, 'fail', { days: 8 })
    const { result } = renderHook(() => useStreak(), { wrapper })
    await waitFor(() => expect(result.current.streak?.days).toBe(7))

    vi.mocked(Date.now).mockReturnValue(STALE_NOW)
    focus()
    await waitFor(() => expect(callsTo('GET', STREAK_PATH)).toHaveLength(2))
    expect(result.current.streak?.days).toBe(7)

    // 時刻を進めない（5 分の窓の内側）まま focus しても、失敗は取得時刻を更新していないので取り直す。
    focus()
    await waitFor(() => expect(result.current.streak?.days).toBe(8))
    expect(callsTo('GET', STREAK_PATH)).toHaveLength(3)
  })

  test('verifies: CI-LD16・CI-LD19 — streak は camelCase の 4 項目（days・todayListened・lastListenedDay・justIncreased）で、snake_case を持たない', async () => {
    respondStreaks({ days: 4 })
    const { result } = renderHook(() => useStreak(), { wrapper })

    await waitFor(() => expect(result.current.streak).not.toBeNull())

    expect(Object.keys(result.current.streak!).sort()).toEqual(['days', 'justIncreased', 'lastListenedDay', 'todayListened'])
    expect(result.current.streak).toMatchObject({ days: 4, todayListened: true, lastListenedDay: '2026-07-29' })
  })

  test('verifies: CI-LD16 — StreakProvider の外の useStreak() は throw する', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => renderHook(() => useStreak())).toThrow()
  })
})
