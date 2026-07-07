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

  // 回帰テスト: 実際の呼び出し元（app/podcast/page.tsx）は onUpdate を毎レンダー新規の
  // アロー関数で渡している。これまでの実装は poll を [fetchPodcasts, onUpdate] に依存させて
  // おり、呼び出し元が再レンダーするたびに poll の参照が変わり、interval の再構築時に
  // 「即時 poll() 実行」が走っていた。これは fetchPodcasts → setState → 再レンダー → 新しい
  // onUpdate → 新しい poll → 即時 poll()... という無限ループを生み、実ブラウザの E2E で
  // 無限レンダーストーム（1つの再生ボタンクリックがスタックするほどの再描画）を引き起こした。
  test('Given onUpdate/fetchPodcasts identity changes every render (unstable caller), does not immediately re-poll beyond the interval', () => {
    const fetchPodcasts = vi.fn().mockResolvedValue({ podcasts: [{ id: 'p1' }] })

    const { rerender } = renderHook(
      () => usePodcastListPolling({ fetchPodcasts, onUpdate: () => {}, enabled: true }),
    )

    expect(fetchPodcasts).toHaveBeenCalledTimes(1)

    // 呼び出し元の再レンダーを模す: onUpdate を毎回新しいアロー関数で渡す。
    // interval のタイマーは一切進めていないので、正しい実装なら追加の呼び出しは発生しない。
    rerender()
    rerender()
    rerender()

    expect(fetchPodcasts).toHaveBeenCalledTimes(1)
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
