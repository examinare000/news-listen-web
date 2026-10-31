import type { FailureReason } from '@/lib/catalog/domain/episode'

// 失敗の理由 → 利用者向け文言の唯一の写像（web-rule-catalog-11・web-dec-45）。
// 値域の畳み込みは decodeEpisode が閉じているので、ここでは再実装しない。
const MESSAGES: Record<FailureReason, string> = {
  generation_failed: '生成に失敗しました',
  quota_exhausted: '生成の上限に達したため、生成できませんでした',
}

export function failureMessage(reason: FailureReason): string {
  return MESSAGES[reason]
}
