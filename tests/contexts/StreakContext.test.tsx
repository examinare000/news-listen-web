import React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { StreakProvider, useStreak } from '@/contexts/StreakContext'
import { createGatewayDouble } from '../helpers/gatewayDouble'
import type { GatewayDouble } from '../helpers/gatewayDouble'

const { playSfx } = vi.hoisted(() => ({
  playSfx: vi.fn(),
}))

const holder = vi.hoisted(() => ({ gw: undefined as GatewayDouble | undefined }))

vi.mock('@/lib/api/gateway', () => ({ createGateway: () => holder.gw }))

vi.mock('@/lib/sfx', () => ({ playSfx }))

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

    await waitFor(() => expect(result.current.streak?.current_streak_days).toBe(4))
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
    await waitFor(() => expect(result.current.streak?.current_streak_days).toBe(4))

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(callsTo('GET', STREAK_PATH)).toHaveLength(1)

    vi.mocked(Date.now).mockReturnValue(1_300_001)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => expect(result.current.streak?.current_streak_days).toBe(5))
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
    await waitFor(() => expect(result.current.streak?.current_streak_days).toBe(7))

    vi.mocked(Date.now).mockReturnValue(1_300_001)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => expect(callsTo('GET', STREAK_PATH)).toHaveLength(2))
    expect(result.current.streak?.current_streak_days).toBe(7)
  })
})
