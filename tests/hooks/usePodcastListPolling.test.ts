import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePodcastListPolling } from '@/hooks/usePodcastListPolling'

// ==========================================================
// usePodcastListPolling — Hook lifecycle
// ==========================================================
describe('usePodcastListPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('Given enabled=true, calls fetchPodcasts at poll interval', async () => {
    const fetchPodcasts = vi.fn()
    const onUpdate = vi.fn()

    const { unmount } = renderHook(() =>
      usePodcastListPolling({ fetchPodcasts, onUpdate, enabled: true })
    )

    // Initial call
    expect(fetchPodcasts).toHaveBeenCalledTimes(1)

    // Advance 5 seconds (POLL_INTERVAL_MS)
    vi.advanceTimersByTime(5000)
    expect(fetchPodcasts).toHaveBeenCalledTimes(2)

    // Advance 5 more seconds
    vi.advanceTimersByTime(5000)
    expect(fetchPodcasts).toHaveBeenCalledTimes(3)

    unmount()
  })

  test('Given enabled=false, does not call fetchPodcasts', () => {
    const fetchPodcasts = vi.fn()
    const onUpdate = vi.fn()

    renderHook(() =>
      usePodcastListPolling({ fetchPodcasts, onUpdate, enabled: false })
    )

    expect(fetchPodcasts).not.toHaveBeenCalled()
  })

  test('Given unmount, clears interval and stops fetching', async () => {
    const fetchPodcasts = vi.fn()
    const onUpdate = vi.fn()

    const { unmount } = renderHook(() =>
      usePodcastListPolling({ fetchPodcasts, onUpdate, enabled: true })
    )

    expect(fetchPodcasts).toHaveBeenCalledTimes(1)

    // Advance timer and verify polling continues
    vi.advanceTimersByTime(5000)
    expect(fetchPodcasts).toHaveBeenCalledTimes(2)

    // Unmount
    unmount()

    // Advance timer — should NOT call fetchPodcasts again
    vi.advanceTimersByTime(5000)
    expect(fetchPodcasts).toHaveBeenCalledTimes(2)
  })

  test('Given enabled switches false, stops polling', async () => {
    const fetchPodcasts = vi.fn()
    const onUpdate = vi.fn()

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        usePodcastListPolling({ fetchPodcasts, onUpdate, enabled }),
      { initialProps: { enabled: true } }
    )

    expect(fetchPodcasts).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(5000)
    expect(fetchPodcasts).toHaveBeenCalledTimes(2)

    // Disable
    rerender({ enabled: false })

    vi.advanceTimersByTime(5000)
    // Should still be 2 because disabled
    expect(fetchPodcasts).toHaveBeenCalledTimes(2)
  })

  test('Given enabled changes to false, stops polling (no more calls)', () => {
    const fetchPodcasts = vi.fn().mockResolvedValue({ podcasts: [{ id: 'p1' }] })
    const onUpdate = vi.fn()

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        usePodcastListPolling({ fetchPodcasts, onUpdate, enabled }),
      { initialProps: { enabled: true } }
    )

    expect(fetchPodcasts).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(5000)
    expect(fetchPodcasts).toHaveBeenCalledTimes(2)

    // Disable polling
    rerender({ enabled: false })

    // No more calls should happen
    vi.advanceTimersByTime(10000)
    expect(fetchPodcasts).toHaveBeenCalledTimes(2)
  })
})
