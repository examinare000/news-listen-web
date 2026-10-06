/**
 * サーバー保存位置から再開位置を決める純関数。
 * 再生済み（末尾 2 秒以内）や不正値は先頭から再生する。
 */
const END_WINDOW_SECONDS = 2

export function resolveResumePosition(serverSeconds: number, durationSeconds: number): number {
  if (!(serverSeconds > 0)) return 0
  if (durationSeconds > 0 && serverSeconds >= durationSeconds - END_WINDOW_SECONDS) return 0
  return serverSeconds
}
