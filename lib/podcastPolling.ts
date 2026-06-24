/**
 * Pure function for podcast list polling logic.
 * Determines when to stop polling based on new podcast detection or timeout.
 */

export const POLL_INTERVAL_MS = 5000
export const POLL_TIMEOUT_MS = 120000

export interface PollingInput {
  baselineCount: number
  currentCount: number
  elapsedMs: number
  timeoutMs: number
}

export interface PollingResult {
  stop: boolean
  reason: 'new-podcast' | 'timeout' | null
}

/**
 * Determine whether to stop polling the podcast list.
 * Checked after each fetch interval.
 *
 * WHY this is pure:
 * - No React, no fetch, no side effects
 * - Only input/output logic
 * - Can be tested without hooks/components
 * - Testable in isolation
 *
 * @param input Polling state (baseline count from Star moment, current count, elapsed time)
 * @returns Whether to stop and the reason (new podcast detected or timeout)
 */
export function shouldStopPolling(input: PollingInput): PollingResult {
  const { baselineCount, currentCount, elapsedMs, timeoutMs } = input

  // Priority 1: New podcast detected (currentCount increased)
  if (currentCount > baselineCount) {
    return { stop: true, reason: 'new-podcast' }
  }

  // Priority 2: Timeout reached
  if (elapsedMs >= timeoutMs) {
    return { stop: true, reason: 'timeout' }
  }

  // Continue polling
  return { stop: false, reason: null }
}
