/**
 * Pure function to resolve playback resume position from server and local storage.
 *
 * WHY this is pure:
 * - No React, no localStorage, no fetch
 * - Simple input/output logic
 * - Testable in isolation
 * - Deterministic: same inputs always produce same output
 */

/**
 * Determine which position to use for resuming playback.
 *
 * Priority:
 * 1. If server position > 0, use it (most recent/authoritative)
 * 2. Else if local position > 0, use it (fallback)
 * 3. Else 0 (start from beginning)
 *
 * Negative values are treated as invalid (clamped to 0 when needed).
 *
 * @param serverSeconds Server-stored position from backend (playback_position_seconds)
 * @param localSeconds Local position from localStorage (getSavedPosition)
 * @returns Position in seconds, guaranteed >= 0
 */
export function resolveResumePosition(serverSeconds: number, localSeconds: number): number {
  // Server position takes priority if positive
  if (serverSeconds > 0) {
    return serverSeconds
  }

  // Fall back to local position if positive
  if (localSeconds > 0) {
    return localSeconds
  }

  // Both zero or negative: start from beginning
  return 0
}
