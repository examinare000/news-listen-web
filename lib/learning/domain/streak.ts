// ストリークの取り直しの窓と、増えたときだけの演出判定（web-rule-learning-01・product-learn-02・product-learn-17）。
const STALE_AFTER_MS = 5 * 60 * 1000

/** 取得から 5 分以上たっていれば古い。`now` は呼び手が渡す（時計は読まない）。 */
export function isStale(fetchedAt: number, now: number): boolean {
  return now - fetchedAt >= STALE_AFTER_MS
}

/** 前の値があり、日数が増えたときだけ true（初回・同値・減少は false）。 */
export function increased(previous: { readonly days: number } | null, next: { readonly days: number }): boolean {
  return previous !== null && next.days > previous.days
}
