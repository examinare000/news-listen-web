/**
 * Pure function to decide where playback audio should come from (issue #167).
 *
 * WHY this is pure: no fetch/Cache API/navigator access — the caller resolves
 * hasCached/isOnline first, keeping this function deterministic and testable
 * in isolation (mirrors the resolveResumePosition pattern in playbackPosition.ts).
 */

export interface ResolvePlaybackInput {
  /** キャッシュ済み音声が存在するか（audioCache.isCached の結果）。 */
  hasCached: boolean
  /** オンライン状態か（navigator.onLine 等）。 */
  isOnline: boolean
}

export type PlaybackSource = 'cached' | 'network' | 'unavailable'

/**
 * キャッシュがあれば常に優先する。
 * 署名付き URL の期限切れ再取得（getPodcast）を避けられ、オフラインでも再生できるため。
 */
export function resolvePlaybackSource({ hasCached, isOnline }: ResolvePlaybackInput): PlaybackSource {
  if (hasCached) {
    return 'cached'
  }
  return isOnline ? 'network' : 'unavailable'
}
