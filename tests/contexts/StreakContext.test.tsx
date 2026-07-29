import React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { StreakProvider, useStreak } from '@/contexts/StreakContext'

const { getListeningStreak, playSfx } = vi.hoisted(() => ({
  getListeningStreak: vi.fn(),
  playSfx: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  createApiClient: () => ({ getListeningStreak }),
}))

vi.mock('@/lib/sfx', () => ({ playSfx }))

function wrapper({ children }: { children: React.ReactNode }) {
  return <StreakProvider>{children}</StreakProvider>
}

describe('StreakProvider shared listening streak', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
  })

  test('loads the streak once and exposes it to all shell consumers', async () => {
    getListeningStreak.mockResolvedValue({
      current_streak_days: 4,
      today_listened: true,
      last_listened_day: '2026-07-29',
    })

    const { result } = renderHook(() => useStreak(), { wrapper })

    await waitFor(() => expect(result.current.streak?.current_streak_days).toBe(4))
    expect(getListeningStreak).toHaveBeenCalledTimes(1)
    expect(playSfx).not.toHaveBeenCalled()
  })

  test('focus refreshes only after the shared value is five minutes stale', async () => {
    getListeningStreak
      .mockResolvedValueOnce({
        current_streak_days: 4,
        today_listened: true,
        last_listened_day: '2026-07-29',
      })
      .mockResolvedValueOnce({
        current_streak_days: 5,
        today_listened: true,
        last_listened_day: '2026-07-30',
      })

    const { result } = renderHook(() => useStreak(), { wrapper })
    await waitFor(() => expect(result.current.streak?.current_streak_days).toBe(4))

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(getListeningStreak).toHaveBeenCalledTimes(1)

    vi.mocked(Date.now).mockReturnValue(1_300_001)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => expect(result.current.streak?.current_streak_days).toBe(5))
    expect(getListeningStreak).toHaveBeenCalledTimes(2)
    expect(playSfx).toHaveBeenCalledWith('streak')
  })

  test('silently retains the prior streak when a stale refresh fails', async () => {
    getListeningStreak
      .mockResolvedValueOnce({
        current_streak_days: 7,
        today_listened: false,
        last_listened_day: '2026-07-28',
      })
      .mockRejectedValueOnce(new Error('network'))

    const { result } = renderHook(() => useStreak(), { wrapper })
    await waitFor(() => expect(result.current.streak?.current_streak_days).toBe(7))

    vi.mocked(Date.now).mockReturnValue(1_300_001)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => expect(getListeningStreak).toHaveBeenCalledTimes(2))
    expect(result.current.streak?.current_streak_days).toBe(7)
  })
})
