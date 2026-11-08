// Preferences の gateway: port PreferencesGateway を ApiGateway の上に実装する（DTO ⇄ application の型）。
// 値の検査と既定値の補完は application の責務で、ここは写すだけにする。
import type { ApiGateway } from '@/lib/api/gateway'
import { getPreferences, updatePreferences } from '@/lib/api/settings'
import type { PreferencesGateway } from '@/lib/preferences/application/ports'

export function createPreferencesGateway(gateway: ApiGateway): PreferencesGateway {
  return {
    async get() {
      const result = await getPreferences(gateway)
      if (!result.ok) return result
      const dto = result.value
      return {
        ok: true,
        value: {
          defaultDifficulty: dto.default_difficulty,
          weeklyGoal: dto.weekly_goal_episodes ?? null,
          defaultPlaybackSpeed: dto.default_playback_speed,
          digest: { enabled: dto.digest_enabled, articleCount: dto.digest_article_count },
        },
      }
    },
    async patch(patch) {
      const body =
        patch.kind === 'defaultDifficulty'
          ? { default_difficulty: patch.value }
          : patch.kind === 'defaultPlaybackSpeed'
            ? { default_playback_speed: patch.value }
            : { weekly_goal_episodes: patch.value }
      const result = await updatePreferences(gateway, body)
      return result.ok ? { ok: true, value: undefined } : result
    },
  }
}
