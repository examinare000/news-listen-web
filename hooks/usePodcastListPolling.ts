import { useEffect, useRef, useCallback } from 'react'
import { shouldStopPolling, POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from '@/lib/podcastPolling'

interface UsePodcastListPollingOptions {
  fetchPodcasts: () => Promise<{ podcasts: Array<{ id: string }> }>
  onUpdate: () => void
  enabled: boolean
}

/**
 * Hook to manage podcast list polling.
 *
 * WHY this hook exists:
 * - Separates timer/interval logic (React concern) from polling decision logic (pure)
 * - fetchPodcasts is async, so it must live in a hook (can't be pure function)
 * - Timer management (setInterval/clearInterval) is React effect concern
 * - Polling logic (shouldStopPolling) is pure and testable separately
 *
 * Flow:
 * 1. User stars an article → fetchPodcasts is called
 * 2. If new podcast detected via shouldStopPolling, call onUpdate
 * 3. onUpdate callback is responsible for stopping the hook (e.g., by passing enabled=false)
 * 4. Hook clears interval on unmount or when enabled=false
 *
 * @param options Polling configuration
 */
export function usePodcastListPolling({ fetchPodcasts, onUpdate, enabled }: UsePodcastListPollingOptions) {
  const baselineCountRef = useRef<number | null>(null)
  const startTimeRef = useRef<number | null>(null)
  const intervalIdRef = useRef<NodeJS.Timeout | null>(null)

  // WHY refs for the latest callbacks (regression fix): the real caller (app/podcast/page.tsx)
  // passes a brand-new `onUpdate` arrow function on every render, which is a normal and
  // legitimate thing for a component to do — this hook should not require callers to memoize
  // their callbacks. Previously `poll` was a useCallback depending on [fetchPodcasts, onUpdate],
  // so any caller re-render changed `poll`'s identity, which made the setup effect below
  // (keyed on `poll`) tear down and immediately re-invoke `poll()` — bypassing POLL_INTERVAL_MS
  // entirely. Combined with `poll()` itself eventually calling setState (via fetchPodcasts），
  // that immediate re-poll caused another re-render, forming an unbounded fetch/render feedback
  // loop (observed in production as e2e/main-flow.e2e.ts never stabilizing: thousands of
  // GET /api/backend/podcasts calls in seconds). Storing the callbacks in refs lets `poll`
  // always invoke the latest versions while keeping `poll`'s own identity — and therefore the
  // interval lifecycle — stable across unrelated re-renders.
  const fetchPodcastsRef = useRef(fetchPodcasts)
  const onUpdateRef = useRef(onUpdate)
  useEffect(() => {
    fetchPodcastsRef.current = fetchPodcasts
    onUpdateRef.current = onUpdate
  })

  const poll = useCallback(async () => {
    try {
      const result = await fetchPodcastsRef.current()
      const currentCount = result.podcasts.length

      // Initialize baseline and start time on first poll
      if (baselineCountRef.current === null) {
        baselineCountRef.current = currentCount
        startTimeRef.current = Date.now()
      }

      const elapsedMs = Date.now() - (startTimeRef.current || 0)
      const { stop } = shouldStopPolling({
        baselineCount: baselineCountRef.current,
        currentCount,
        elapsedMs,
        timeoutMs: POLL_TIMEOUT_MS,
      })

      if (stop) {
        // Stop polling condition met
        if (intervalIdRef.current) {
          clearInterval(intervalIdRef.current)
          intervalIdRef.current = null
        }
        baselineCountRef.current = null
        startTimeRef.current = null
        onUpdateRef.current()
      }
    } catch {
      // Silently ignore polling errors to avoid breaking the UI
      // (network failures, API errors, etc.)
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      // Clear interval when disabled
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current)
        intervalIdRef.current = null
      }
      baselineCountRef.current = null
      startTimeRef.current = null
      return
    }

    // Start polling immediately, then at interval
    poll()

    intervalIdRef.current = setInterval(() => {
      poll()
    }, POLL_INTERVAL_MS)

    // Cleanup on unmount or when enabled changes
    return () => {
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current)
        intervalIdRef.current = null
      }
    }
  }, [enabled, poll])
}
