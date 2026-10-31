// 生成の上限（429）の種別の判定（web-rule-catalog-03・ADR-073）。
// ADR-073: backend 文言変更・版ずれ時の耐障害性のため、detail の "monthly" 文言判定と
// Retry-After 24 時間（86400 秒）超の両方で月次判定を行う（フォールバック戦略）。

export interface GenerationLimit {
  readonly period: 'monthly' | 'daily'
  readonly retryAfterSeconds: number | null
}

export function classifyGenerationLimit(detail: string, retryAfterSeconds: number | undefined): GenerationLimit {
  const isMonthly = /monthly/i.test(detail) || (retryAfterSeconds ?? 0) > 86400
  return Object.freeze({
    period: isMonthly ? 'monthly' : 'daily',
    retryAfterSeconds: retryAfterSeconds ?? null,
  })
}
