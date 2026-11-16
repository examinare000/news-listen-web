// 端末の記録とサーバーの値の新旧比較。時刻の無い値は最古として扱う（shared-dec-32）。
export type PositionRecord = {
  readonly positionSeconds: number
  readonly recordedAt: number | null
}

export function isNewerRecord(candidate: PositionRecord, base: PositionRecord): boolean {
  if (candidate.recordedAt === null) return false
  if (base.recordedAt === null) return true
  return candidate.recordedAt > base.recordedAt
}

/** 厳密に新しいサーバー値だけが端末に勝つ。同時刻・両方時刻なしは端末。 */
export function pickCandidate(
  device: PositionRecord | null,
  server: PositionRecord,
): PositionRecord | null {
  if (device === null) return server
  return isNewerRecord(server, device) ? server : device
}
