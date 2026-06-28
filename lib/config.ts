// localStorage key constants — single source of truth to prevent key typos

/** Audio player volume (0.0–1.0). Falls back to 1.0 when absent or invalid. */
export const KEY_PLAYER_VOLUME = 'player_volume'

/** Podcast playback position key prefix. Full key: `podcast_position:{podcastId}` */
export const KEY_PODCAST_POSITION_PREFIX = 'podcast_position'

/** Default playback speed saved in settings */
export const KEY_DEFAULT_PLAYBACK_SPEED = 'default_playback_speed'

/**
 * UI theme ('dark' | 'light'). Key name must stay 'theme' to match the inline
 * theme-init script in app/layout.tsx (mirrors docs/design/app-ui.html L10-16).
 */
export const KEY_THEME = 'theme'

/** Time format preference for article dates ('absolute' | 'relative') */
export const KEY_TIME_FORMAT = 'time_format'

/** Build a per-podcast position key */
export function podcastPositionKey(podcastId: string): string {
  return `${KEY_PODCAST_POSITION_PREFIX}:${podcastId}`
}
