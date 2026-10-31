// localStorage key constants — single source of truth to prevent key typos
// 端末設定の key は lib/preferences/infrastructure が持つ。

/** Podcast playback position key prefix. Full key: `podcast_position:{podcastId}` */
export const KEY_PODCAST_POSITION_PREFIX = 'podcast_position'

/** Build a per-podcast position key */
export function podcastPositionKey(podcastId: string): string {
  return `${KEY_PODCAST_POSITION_PREFIX}:${podcastId}`
}
