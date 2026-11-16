// @vitest-environment node
// 再開時の確認の控え（ADR-109 決定 11）。episode ごとに、取り込みで置き換えた別の端末の位置を 1 件だけ持つ。
//
// RED 理由（実装前）: `@/lib/playback/application/resumeAdvisor` がまだ存在しない。
import { describe, expect, test } from 'vitest'
import { createResumeAdvisor } from '@/lib/playback/application/resumeAdvisor'
import type { ResumeAdvisor } from '@/lib/playback/application/resumeAdvisor'
import type { RemotePosition } from '@/lib/playback/application/ports'

const at = (positionSeconds: number, recordedAt: number): RemotePosition => ({ positionSeconds, recordedAt })

describe('shared-sync-10 / ADR-109 決定 11: episode ごとに最新の控えを 1 件持ち、clear で消え、reset で全部消える', () => {
  test('a に 500 と 600 を note すると pending(a) は 600、pending(b) は null', () => {
    const advisor: ResumeAdvisor = createResumeAdvisor()
    advisor.note('a', at(500, 1_000))
    expect(advisor.pending('a')).toEqual(at(500, 1_000))
    advisor.note('a', at(600, 2_000))
    expect(advisor.pending('a')).toEqual(at(600, 2_000))
    expect(advisor.pending('b')).toBeNull()
  })

  test('同じ値を 2 回 note しても 1 件（ほかの episode に影響しない）', () => {
    const advisor = createResumeAdvisor()
    advisor.note('b', at(10, 100))
    advisor.note('a', at(500, 1_000))
    advisor.note('a', at(500, 1_000))
    expect(advisor.pending('a')).toEqual(at(500, 1_000))
    expect(advisor.pending('b')).toEqual(at(10, 100))
  })

  test('clear(a) で a だけが null になり b は残る。無い id の clear は投げず、何度呼んでも同じ', () => {
    const advisor = createResumeAdvisor()
    advisor.note('a', at(500, 1_000))
    advisor.note('b', at(700, 1_000))
    advisor.clear('a')
    expect(advisor.pending('a')).toBeNull()
    expect(advisor.pending('b')).toEqual(at(700, 1_000))
    expect(() => advisor.clear('a')).not.toThrow()
    expect(() => advisor.clear('never')).not.toThrow()
    expect(advisor.pending('b')).toEqual(at(700, 1_000))
  })

  test('reset で全部 null になる。空の状態の reset も投げない', () => {
    const advisor = createResumeAdvisor()
    advisor.note('a', at(500, 1_000))
    advisor.note('b', at(700, 1_000))
    advisor.reset()
    expect(advisor.pending('a')).toBeNull()
    expect(advisor.pending('b')).toBeNull()
    expect(() => advisor.reset()).not.toThrow()
  })

  test('pending は読むだけで、何度読んでも値が変わらない', () => {
    const advisor = createResumeAdvisor()
    advisor.note('a', at(500, 1_000))
    expect(advisor.pending('a')).toEqual(advisor.pending('a'))
    expect(advisor.pending('a')).toEqual(at(500, 1_000))
  })

  test('2 つの advisor は独立している', () => {
    const first = createResumeAdvisor()
    const second = createResumeAdvisor()
    first.note('a', at(500, 1_000))
    expect(second.pending('a')).toBeNull()
    second.note('a', at(900, 2_000))
    first.reset()
    expect(first.pending('a')).toBeNull()
    expect(second.pending('a')).toEqual(at(900, 2_000))
  })
})
