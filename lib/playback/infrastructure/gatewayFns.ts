// 位置と完聴の送信。path・method・body は lib/api/podcasts.ts が持つ。完聴の応答の本文は捨てる。
import type { ApiGateway } from '@/lib/api/gateway'
import type { Result } from '@/lib/shared/result'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import { markCompleted, updatePosition } from '@/lib/api/podcasts'
import type { PositionSync, RemotePosition } from '@/lib/playback/application/ports'
import { parseRecordedAt } from '@/lib/shared/recordedAt'

function discardBody(result: Result<unknown, ApiFailure>): Result<void, ApiFailure> {
  return result.ok ? { ok: true, value: undefined } : result
}

// 200 でも本文が Podcast の形でなければ取り込めないので、失敗として返す（空の本文を成功にしない）。
function readRemote(body: unknown): RemotePosition | null {
  if (typeof body !== 'object' || body === null) return null
  const { playback_position_seconds: position, playback_position_recorded_at: at } = body as Record<string, unknown>
  if (typeof position !== 'number' || !Number.isFinite(position)) return null
  return { positionSeconds: position, recordedAt: typeof at === 'string' ? parseRecordedAt(at) : null }
}

export function createPositionSync(gateway: ApiGateway): PositionSync {
  return {
    async updatePosition(id, seconds, recordedAt) {
      const result = await updatePosition(gateway, id, Math.max(0, seconds), new Date(recordedAt).toISOString())
      if (!result.ok) return result
      const remote = readRemote(result.value)
      return remote === null ? { ok: false, failure: { kind: 'unknown', status: 200 } } : { ok: true, value: remote }
    },
    async markCompleted(id) {
      return discardBody(await markCompleted(gateway, id))
    },
  }
}
