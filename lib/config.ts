// localStorage key constants — single source of truth to prevent key typos

/** API base URL configured by the user */
export const KEY_API_BASE_URL = 'api_base_url'

/** API key configured by the user */
export const KEY_API_KEY = 'api_key'

/** Audio player volume (0.0–1.0). Falls back to 1.0 when absent or invalid. */
export const KEY_PLAYER_VOLUME = 'player_volume'

/** Podcast playback position key prefix. Full key: `podcast_position:{podcastId}` */
export const KEY_PODCAST_POSITION_PREFIX = 'podcast_position'

/** Default playback speed saved in settings */
export const KEY_DEFAULT_PLAYBACK_SPEED = 'default_playback_speed'

/** Build a per-podcast position key */
export function podcastPositionKey(podcastId: string): string {
  return `${KEY_PODCAST_POSITION_PREFIX}:${podcastId}`
}
