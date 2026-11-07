// 位置と完聴の送信。path・method・body は lib/api/podcasts.ts が持つ。応答の本文は捨てる。
import type { ApiFailure, ApiGateway, Result } from '@/lib/api/gateway'
import { markCompleted, updatePosition } from '@/lib/api/podcasts'
import type { PositionSync } from '@/lib/playback/application/ports'

function discardBody(result: Result<unknown, ApiFailure>): Result<void, ApiFailure> {
  return result.ok ? { ok: true, value: undefined } : result
}

export function createPositionSync(gateway: ApiGateway): PositionSync {
  return {
    async updatePosition(id, seconds) {
      return discardBody(await updatePosition(gateway, id, Math.max(0, seconds)))
    },
    async markCompleted(id) {
      return discardBody(await markCompleted(gateway, id))
    },
  }
}
