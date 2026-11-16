// 位置と完聴の送信 adapter の契約テスト（web-deriv-23・web-deriv-04）。
// path・method・body は旧実装（contexts/AudioPlayerContext.tsx の 2 箇所）と同じ。
//
// RED 理由: updatePosition が recorded_at を送らず、応答の位置と時刻（RemotePosition）を返さない。
import { describe, test, expect } from 'vitest'
import { createPositionSync } from '@/lib/playback/infrastructure/gatewayFns'
import { createGatewayDouble } from '../../../helpers/gatewayDouble'

describe('verifies: CI-T40 createPositionSync（web-deriv-23）', () => {
  const PATH = '/api/backend/podcasts/p1/position'
  const T0 = Date.UTC(2026, 10, 16, 0, 0, 0)

  test('ADR-109 決定 8（新規）: updatePosition は recorded_at を付けて送り、応答の位置と時刻を返す', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('PATCH', PATH, {
      ok: true,
      value: { playback_position_seconds: 30, playback_position_recorded_at: '2026-11-16T00:00:01.000Z' },
    })
    const result = await createPositionSync(gateway).updatePosition('p1', 12.5, T0)
    expect(gateway.calls).toEqual([
      { method: 'PATCH', path: PATH, body: { position_seconds: 12.5, recorded_at: '2026-11-16T00:00:00.000Z' } },
    ])
    expect(result).toStrictEqual({ ok: true, value: { positionSeconds: 30, recordedAt: T0 + 1000 } })
  })

  test('応答に時刻が無い・読めない・文字列でないときは成功で recordedAt が null', async () => {
    for (const time of [undefined, null, 'not-a-date', 12345]) {
      const gateway = createGatewayDouble()
      gateway.respond('PATCH', PATH, {
        ok: true,
        value: { playback_position_seconds: 30, playback_position_recorded_at: time },
      })
      expect(await createPositionSync(gateway).updatePosition('p1', 1, T0)).toStrictEqual({
        ok: true,
        value: { positionSeconds: 30, recordedAt: null },
      })
    }
    const gateway = createGatewayDouble()
    gateway.respond('PATCH', PATH, { ok: true, value: { playback_position_seconds: 30 } })
    expect(await createPositionSync(gateway).updatePosition('p1', 1, T0)).toStrictEqual({
      ok: true,
      value: { positionSeconds: 30, recordedAt: null },
    })
  })

  test('負の位置は 0 に丸めて送る', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('PATCH', PATH, { ok: true, value: { playback_position_seconds: 0 } })
    await createPositionSync(gateway).updatePosition('p1', -3, T0)
    expect(gateway.calls[0].body).toEqual({ position_seconds: 0, recorded_at: '2026-11-16T00:00:00.000Z' })
  })

  test('応答の形が違えば unknown 失敗', async () => {
    for (const value of [undefined, {}, { playback_position_seconds: 'x' }, 'text', null]) {
      const gateway = createGatewayDouble()
      gateway.respond('PATCH', PATH, { ok: true, value })
      expect(await createPositionSync(gateway).updatePosition('p1', 1, T0)).toEqual({
        ok: false,
        failure: { kind: 'unknown', status: 200 },
      })
    }
  })

  test('shared-sync-09: 時刻の読みは小数 0〜9 桁と `Z`・`+00:00` を受け、ミリ秒に切り捨てる', async () => {
    const base = Date.UTC(2026, 10, 16, 0, 0, 1)
    const cases: Array<[string, number | null]> = [
      ['2026-11-16T00:00:01.123456Z', base + 123],
      ['2026-11-16T00:00:01.123456789+00:00', base + 123],
      ['2026-11-16T00:00:01Z', base],
      ['2026-11-16T00:00:01.123456', null],
      ['broken', null],
    ]
    for (const [text, expected] of cases) {
      const gateway = createGatewayDouble()
      gateway.respond('PATCH', PATH, {
        ok: true,
        value: { playback_position_seconds: 1, playback_position_recorded_at: text },
      })
      const result = await createPositionSync(gateway).updatePosition('p1', 1, T0)
      expect(result, text).toStrictEqual({ ok: true, value: { positionSeconds: 1, recordedAt: expected } })
    }
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
    expect(await sync.updatePosition('p1', 1, 1000)).toEqual({ ok: false, failure: { kind: 'server', status: 500 } })
    expect(await sync.markCompleted('p1')).toEqual({ ok: false, failure: { kind: 'unauthorized' } })
  })
})
