import type {
  GenerationQuota,
  ListeningStreak,
  DifficultySuggestion,
  LearningDashboard,
} from '@/types/index'
import { request } from '@/lib/api/legacyRequest'

/** 生成残回数。limit=0 は無制限（remaining は null）。issue #164 / ADR-061。 */
export function getGenerationQuota() {
  return request<GenerationQuota>('/api/backend/users/me/generation-quota', { method: 'GET' })
}

/** 聴取ストリーク。current_streak_days=0 でも last_listened_day が非null の場合がある（途切れ）。issue #165 / ADR-062。 */
export function getListeningStreak() {
  return request<ListeningStreak>('/api/backend/users/me/listening-streak', { method: 'GET' })
}

/** 難易度自動適応の推奨。常に 200・has_suggestion=false で推奨なしを表現する。ADR-071 F3。 */
export function getDifficultySuggestion() {
  return request<DifficultySuggestion>('/api/backend/users/me/difficulty-suggestion', { method: 'GET' })
}

/** 学習ダッシュボード（ストリーク・週次目標・実績・エピソード数・語彙・クイズ成績・月別活動・難易度）。
 *  既存シグナルの read-only 集約。常に200・新規ユーザーは全ゼロ/null/空配列（ADR-072 / F4）。 */
export function getLearningDashboard() {
  return request<LearningDashboard>('/api/backend/users/me/learning-dashboard', { method: 'GET' })
}
