// @vitest-environment node
// 位置の記録の新旧比較と再開位置の候補（shared-dec-32 の規則はここだけに置く）。I/O なし。
//
// RED 理由（実装前）: `@/lib/playback/domain/positionRecord` がまだ存在しない。
import { describe, expect, test } from 'vitest'
import { isNewerRecord, pickCandidate } from '@/lib/playback/domain/positionRecord'

const T1 = 1_000
const T2 = 2_000

describe('shared-resume-08〜12 / ADR-109 決定 10（新規）: isNewerRecord と pickCandidate の表（時刻なしは最古・同時刻は端末・両方なしは端末）', () => {
  test.each<[string, number | null, number | null, boolean]>([
    ['candidate が厳密に新しい', T2, T1, true],
    ['candidate が古い', T1, T2, false],
    ['同時刻は新しくない', T1, T1, false],
    ['candidate の時刻なしは新しくない', null, T1, false],
    ['base の時刻なしなら、時刻のある candidate が新しい', T1, null, true],
    ['両方時刻なしは新しくない', null, null, false],
    ['時刻 0 も時刻として扱い、時刻なしより新しい', 0, null, true],
    ['時刻 0 は 1 より古い', 0, 1, false],
  ])('isNewerRecord: %s', (_name, candidateAt, baseAt, expected) => {
    expect(
      isNewerRecord({ positionSeconds: 80, recordedAt: candidateAt }, { positionSeconds: 50, recordedAt: baseAt }),
    ).toBe(expected)
  })

  test('isNewerRecord: 位置の大小は結果に影響しない（時刻だけで決まる）', () => {
    expect(isNewerRecord({ positionSeconds: 1, recordedAt: T2 }, { positionSeconds: 999, recordedAt: T1 })).toBe(true)
    expect(isNewerRecord({ positionSeconds: 999, recordedAt: T1 }, { positionSeconds: 1, recordedAt: T2 })).toBe(false)
  })

  test.each<[string, number | null, number | null, 'device' | 'server']>([
    ['サーバーが新しければサーバー', T1, T2, 'server'],
    ['端末が新しければ端末', T2, T1, 'device'],
    ['同時刻は端末', T1, T1, 'device'],
    ['サーバーの時刻なしは最古なので端末', T1, null, 'device'],
    ['端末の時刻なし（記録はある）でサーバーに時刻があればサーバー', null, T1, 'server'],
    ['両方時刻なしは端末', null, null, 'device'],
  ])('pickCandidate: %s', (_name, deviceAt, serverAt, winner) => {
    const device = { positionSeconds: 50, recordedAt: deviceAt }
    const server = { positionSeconds: 120, recordedAt: serverAt }
    expect(pickCandidate(device, server)).toEqual(winner === 'device' ? device : server)
  })

  test('pickCandidate: 端末の記録が無ければサーバー（時刻なしでも）', () => {
    const server = { positionSeconds: 120, recordedAt: null }
    expect(pickCandidate(null, server)).toEqual(server)
  })

  test('pickCandidate: 新しいサーバーの値が 0 ならその 0 を返す（0 を欠落扱いにしない）', () => {
    const server = { positionSeconds: 0, recordedAt: T2 }
    expect(pickCandidate({ positionSeconds: 50, recordedAt: T1 }, server)).toEqual(server)
  })

  test('pickCandidate: 古いサーバーの正の値は新しい端末の 0 に勝たない（旧い合成 server > 0 ? server : local の否定）', () => {
    const device = { positionSeconds: 0, recordedAt: T2 }
    expect(pickCandidate(device, { positionSeconds: 120, recordedAt: T1 })).toEqual(device)
  })
})
