// 再開時の確認の要否（ADR-109 決定 11）。別の端末の位置とこの端末の位置の差がこの秒数以上なら尋ねる。
export const RESUME_CONFIRM_THRESHOLD_SECONDS = 15

export function needsResumeChoice(remoteSeconds: number, localSeconds: number): boolean {
  return Math.abs(remoteSeconds - localSeconds) >= RESUME_CONFIRM_THRESHOLD_SECONDS
}
