/**
 * 再生音声の取得元を決める純関数（issue #167）。
 *
 * 純関数にする理由: ネットワーク・Cache API・navigator には触れない。呼出側が
 * hasCached / isOnline を先に解決するので、この関数は決定的で単独でテストできる。
 */

export interface ResolvePlaybackInput {
  /** キャッシュ済み音声が存在するか。 */
  hasCached: boolean
  /** オンライン状態か（navigator.onLine 等）。 */
  isOnline: boolean
}

export type PlaybackSource = 'cached' | 'network' | 'unavailable'

/**
 * キャッシュがあれば常に優先する。
 * 署名付き URL の期限切れ再取得を避けられ、オフラインでも再生できるため。
 */
export function resolvePlaybackSource({ hasCached, isOnline }: ResolvePlaybackInput): PlaybackSource {
  if (hasCached) {
    return 'cached'
  }
  return isOnline ? 'network' : 'unavailable'
}
