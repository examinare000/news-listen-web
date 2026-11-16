// 取り込みで端末の記録が置き換わった位置の控え（episode ごとに最新の 1 件）。永続化しない（ADR-109 決定 11）。
import type { RemotePosition } from '@/lib/playback/application/ports'

export interface ResumeAdvisor {
  note(episodeId: string, remote: RemotePosition): void
  pending(episodeId: string): RemotePosition | null
  clear(episodeId: string): void
  reset(): void
}

export function createResumeAdvisor(): ResumeAdvisor {
  const advice = new Map<string, RemotePosition>()
  return {
    note: (episodeId, remote) => {
      advice.set(episodeId, remote)
    },
    pending: (episodeId) => advice.get(episodeId) ?? null,
    clear: (episodeId) => {
      advice.delete(episodeId)
    },
    reset: () => advice.clear(),
  }
}
