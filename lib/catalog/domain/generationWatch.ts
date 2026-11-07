// 生成の監視（web-rule-catalog-06・web-usecase-19）: 完了の検知とポーリングの停止の条件を 1 箇所に置く。純関数で、他の module を import しない。

export const GENERATION_WATCH_INTERVAL_MS = 5000
export const GENERATION_WATCH_TIMEOUT_MS = 120000

export interface GenerationSnapshot {
  readonly id: string
  readonly generation: 'completed' | 'processing' | 'failed'
}

export interface WatchStopInput {
  readonly baselineCount: number
  readonly currentCount: number
  readonly elapsedMs: number
}

export interface WatchStopDecision {
  readonly stop: boolean
  readonly reason: 'new-podcast' | 'timeout' | null
}

/** previous が空（初回）なら空。previous に無い id は「前回は完了でない」として扱う。kind は見ない（web-dec-97）。 */
export function detectCompleted(
  previous: ReadonlyArray<GenerationSnapshot>,
  next: ReadonlyArray<GenerationSnapshot>,
): ReadonlyArray<string> {
  if (previous.length === 0) return Object.freeze([])
  const before = new Map(previous.map((p) => [p.id, p.generation]))
  return Object.freeze(next.filter((n) => before.get(n.id) !== 'completed' && n.generation === 'completed').map((n) => n.id))
}

/** 件数の増加を timeout より優先する。件数の減少では停止しない。 */
export function shouldStopWatching(input: WatchStopInput): WatchStopDecision {
  if (input.currentCount > input.baselineCount) return Object.freeze({ stop: true, reason: 'new-podcast' })
  if (input.elapsedMs >= GENERATION_WATCH_TIMEOUT_MS) return Object.freeze({ stop: true, reason: 'timeout' })
  return Object.freeze({ stop: false, reason: null })
}
