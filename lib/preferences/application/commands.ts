// Preferences の command: web-cmd-prefs-02（難易度。最新の要求だけを反映する: web-rule-prefs-03）・web-cmd-prefs-03（週の目標）・web-cmd-prefs-04（既定の再生速度）。
// 元の値へ戻す・toast を出すのは presentation。ここは stale の判定だけを持つ。
import type { PlaybackSpeed } from '@/lib/playback/domain/session'
import type { LocalSettingsPort, PreferencesGateway } from '@/lib/preferences/application/ports'
import { defaultPlaybackSpeed, type WeeklyGoal as WeeklyGoalChoice } from '@/lib/preferences/domain/settings'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { DifficultyLevel } from '@/lib/shared/difficulty'
import type { Result } from '@/lib/shared/result'

export interface PreferencesCommands {
  /** stale: true は「先に送った古い要求の結果」で、presentation は何もしない。最新の reject は握りつぶさず再 throw する。 */
  setDefaultDifficulty(level: DifficultyLevel): Promise<Result<{ readonly stale: boolean }, ApiFailure>>
  /** 端末へ即時に書いてから保存する。失敗しても端末は戻さない（戻しは presentation）。stale の意味は setDefaultDifficulty と同じ。 */
  setDefaultPlaybackSpeed(speed: PlaybackSpeed): Promise<Result<{ readonly stale: boolean }, ApiFailure>>
  setWeeklyGoal(goal: WeeklyGoalChoice): Promise<Result<void, ApiFailure>>
}

const STALE = Object.freeze({ stale: true })
const LATEST = Object.freeze({ stale: false })

export function createPreferencesCommands({
  gateway,
  localSettings,
}: {
  readonly gateway: PreferencesGateway
  readonly localSettings: LocalSettingsPort
}): PreferencesCommands {
  // 連打や提案の適用で要求が重なったとき、最新の要求だけを反映するための連番。instance ごとの closure に置く。
  // 難易度と速度は互いの要求を stale にしないよう、別の連番にする。
  let latestDifficultyRequest = 0
  let latestSpeedRequest = 0

  async function settle(
    send: () => Promise<Result<void, ApiFailure>>,
    isLatest: () => boolean,
  ): Promise<Result<{ readonly stale: boolean }, ApiFailure>> {
    let result: Result<void, ApiFailure>
    try {
      result = await send()
    } catch (error) {
      if (isLatest()) throw error
      return { ok: true, value: STALE }
    }
    if (!isLatest()) return { ok: true, value: STALE }
    return result.ok ? { ok: true, value: LATEST } : result
  }

  return {
    setDefaultDifficulty(level) {
      const requestId = ++latestDifficultyRequest
      return settle(
        () => gateway.patch({ kind: 'defaultDifficulty', value: level }),
        () => requestId === latestDifficultyRequest,
      )
    },
    setDefaultPlaybackSpeed(speed) {
      const requestId = ++latestSpeedRequest
      localSettings.set(defaultPlaybackSpeed, speed)
      return settle(
        () => gateway.patch({ kind: 'defaultPlaybackSpeed', value: speed }),
        () => requestId === latestSpeedRequest,
      )
    },
    async setWeeklyGoal(goal) {
      return gateway.patch({ kind: 'weeklyGoal', value: goal })
    },
  }
}
