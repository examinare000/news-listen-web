// 位置と完聴の送信。path・method・body は旧 contexts/AudioPlayerContext.tsx の 2 箇所と同じ。応答の本文は捨てる。
import type { ApiFailure, ApiGateway, Result } from '@/lib/api/gateway'
import type { PositionSync } from '@/lib/playback/application/ports'

function discardBody(result: Result<unknown, ApiFailure>): Result<void, ApiFailure> {
  return result.ok ? { ok: true, value: undefined } : result
}

export function createPositionSync(gateway: ApiGateway): PositionSync {
  return {
    async updatePosition(id, seconds) {
      return discardBody(
        await gateway.request<unknown>(`/api/backend/podcasts/${id}/position`, {
          method: 'PATCH',
          body: { position_seconds: Math.max(0, seconds) },
        }),
      )
    },
    async markCompleted(id) {
      return discardBody(await gateway.request<unknown>(`/api/backend/podcasts/${id}/completed`, { method: 'POST' }))
    },
  }
}
