// 位置と完聴の送信 adapter の契約テスト（web-deriv-23・web-deriv-04）。
// path・method・body は旧実装（contexts/AudioPlayerContext.tsx の 2 箇所）と同じ。
//
// RED 理由: `@/lib/playback/infrastructure/gatewayFns` がまだ存在しない。
import { describe, test, expect } from 'vitest'
import { createPositionSync } from '@/lib/playback/infrastructure/gatewayFns'
import { createGatewayDouble } from '../../../helpers/gatewayDouble'

describe('verifies: CI-T40 createPositionSync（web-deriv-23）', () => {
  test('updatePosition は PATCH …/position に { position_seconds } を送り、成功は value undefined', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('PATCH', '/api/backend/podcasts/p1/position', { ok: true, value: { echoed: 12.5 } })
    const result = await createPositionSync(gateway).updatePosition('p1', 12.5)
    expect(gateway.calls).toEqual([
      { method: 'PATCH', path: '/api/backend/podcasts/p1/position', body: { position_seconds: 12.5 } },
    ])
    expect(result).toStrictEqual({ ok: true, value: undefined })
  })

  test('負の位置は 0 に丸めて送る', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('PATCH', '/api/backend/podcasts/p1/position', { ok: true, value: {} })
    await createPositionSync(gateway).updatePosition('p1', -3)
    expect(gateway.calls[0].body).toEqual({ position_seconds: 0 })
  })

  test('markCompleted は POST …/completed を body なしで送り、成功は value undefined', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('POST', '/api/backend/podcasts/p1/completed', { ok: true, value: { recorded: true } })
    const result = await createPositionSync(gateway).markCompleted('p1')
    expect(gateway.calls).toEqual([
      { method: 'POST', path: '/api/backend/podcasts/p1/completed', body: undefined },
    ])
    expect(result).toStrictEqual({ ok: true, value: undefined })
  })

  test('gateway の失敗はそのまま返す（2 操作とも）', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('PATCH', '/api/backend/podcasts/p1/position', { ok: false, failure: { kind: 'server', status: 500 } })
    gateway.respond('POST', '/api/backend/podcasts/p1/completed', { ok: false, failure: { kind: 'unauthorized' } })
    const sync = createPositionSync(gateway)
    expect(await sync.updatePosition('p1', 1)).toEqual({ ok: false, failure: { kind: 'server', status: 500 } })
    expect(await sync.markCompleted('p1')).toEqual({ ok: false, failure: { kind: 'unauthorized' } })
  })
})
