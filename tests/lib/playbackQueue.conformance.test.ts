// 正本仕様準拠テスト（issue #138）。
// docs/design/shared-playback-spec.md §4.1 正本テストケース表（Q-01〜Q-32）の全行を、
// テスト名先頭の行 ID で機械的・目視双方に照合可能な形で実装する。
//
// moveUpNext(from, toOffset) は正本では「削除前オフセット」方式（SwiftUI onMove 規約）。
// web の現行 API は reorderUpNext(q, from, to) のみのため、本ファイルでは
// reorderUpNext を正本の moveUpNext として直接呼び出す（アダプタ変換はしない）。
// 正本と web 実装の乖離（Q-26/Q-28/Q-32）は spec 制定と同時に実装修正済み・現在は green。
import { describe, test, expect } from 'vitest'
import {
  emptyQueue,
  current,
  upNext,
  start,
  setQueue,
  add,
  playNext,
  jump,
  advance,
  remove,
  reorderUpNext as moveUpNext,
} from '@/lib/playbackQueue'
import type { Podcast } from '@/types'

function pod(id: string): Podcast {
  return {
    id,
    type: 'single',
    article_ids: [],
    difficulty: 'toeic_900',
    audio_url: `https://example.com/${id}.wav`,
    japanese_intro_text: `intro ${id}`,
    duration_seconds: 120,
    created_at: '2026-05-31T06:00:00Z',
    status: 'completed',
    error_message: null,
    playback_position_seconds: 0,
  }
}

const ids = (q: { items: Podcast[] }) => q.items.map((p) => p.id)
const upNextIds = (q: Parameters<typeof upNext>[0]) => upNext(q).map((p) => p.id)

describe('playbackQueue conformance (docs/design/shared-playback-spec.md §4.1)', () => {
  test('Q-01: [a,*b*,c] current/upNext → current=b, upNext=[c]', () => {
    const q = setQueue([pod('a'), pod('b'), pod('c')], 1)
    expect(current(q)?.id).toBe('b')
    expect(upNextIds(q)).toEqual(['c'])
  })

  test('Q-02: [a,b] ci=null current/upNext → current=null, upNext=[a,b]', () => {
    const q: { items: Podcast[]; currentIndex: number | null } = {
      items: [pod('a'), pod('b')],
      currentIndex: null,
    }
    expect(current(q)).toBeNull()
    expect(upNextIds(q)).toEqual(['a', 'b'])
  })

  test('Q-03: [*x*,y] start(z) → items=[z], current=z', () => {
    const initial = setQueue([pod('x'), pod('y')], 0)
    const q = start(initial, pod('z'))
    expect(ids(q)).toEqual(['z'])
    expect(current(q)?.id).toBe('z')
  })

  test('Q-04: empty setQueue([a,b,c], 1) → items=[a,b,c], current=b, upNext=[c]', () => {
    const q = setQueue([pod('a'), pod('b'), pod('c')], 1)
    expect(ids(q)).toEqual(['a', 'b', 'c'])
    expect(current(q)?.id).toBe('b')
    expect(upNextIds(q)).toEqual(['c'])
  })

  test('Q-05: empty setQueue([a,b,c], -5) → currentIndex=0 (clamp), current=a', () => {
    const q = setQueue([pod('a'), pod('b'), pod('c')], -5)
    expect(q.currentIndex).toBe(0)
    expect(current(q)?.id).toBe('a')
  })

  test('Q-06: empty setQueue([a,b,c], 10) → currentIndex=2 (clamp), current=c, upNext=[]', () => {
    const q = setQueue([pod('a'), pod('b'), pod('c')], 10)
    expect(q.currentIndex).toBe(2)
    expect(current(q)?.id).toBe('c')
    expect(upNextIds(q)).toEqual([])
  })

  test('Q-07: empty setQueue([], 0) → items=[], currentIndex=null', () => {
    const q = setQueue([], 0)
    expect(ids(q)).toEqual([])
    expect(q.currentIndex).toBeNull()
  })

  test('Q-08: [*a*] add(b) → items=[a,b], upNext=[b]', () => {
    let q = setQueue([pod('a')], 0)
    q = add(q, pod('b'))
    expect(ids(q)).toEqual(['a', 'b'])
    expect(upNextIds(q)).toEqual(['b'])
  })

  test('Q-09: [*a*,b] add(b) → no-op, items=[a,b] (dedup)', () => {
    let q = setQueue([pod('a'), pod('b')], 0)
    q = add(q, pod('b'))
    expect(ids(q)).toEqual(['a', 'b'])
  })

  test('Q-10: [a,*b*,c] playNext(d) → items=[a,b,d,c], current=b, upNext=[d,c]', () => {
    let q = setQueue([pod('a'), pod('b'), pod('c')], 1)
    q = playNext(q, pod('d'))
    expect(ids(q)).toEqual(['a', 'b', 'd', 'c'])
    expect(current(q)?.id).toBe('b')
    expect(upNextIds(q)).toEqual(['d', 'c'])
  })

  test('Q-11: [*a*,b,c] playNext(c) → items=[a,c,b], current=a, upNext=[c,b] (moves existing dup)', () => {
    let q = setQueue([pod('a'), pod('b'), pod('c')], 0)
    q = playNext(q, pod('c'))
    expect(ids(q)).toEqual(['a', 'c', 'b'])
    expect(current(q)?.id).toBe('a')
    expect(upNextIds(q)).toEqual(['c', 'b'])
  })

  test('Q-12: [*a*,b,c] playNext(a) → no-op (current episode)', () => {
    let q = setQueue([pod('a'), pod('b'), pod('c')], 0)
    const before = ids(q)
    q = playNext(q, pod('a'))
    expect(ids(q)).toEqual(before)
    expect(current(q)?.id).toBe('a')
  })

  test('Q-13: [a,b] ci=null playNext(c) → items=[c,a,b], currentIndex=null (no current → insert at head)', () => {
    const initial: { items: Podcast[]; currentIndex: number | null } = {
      items: [pod('a'), pod('b')],
      currentIndex: null,
    }
    const q = playNext(initial, pod('c'))
    expect(ids(q)).toEqual(['c', 'a', 'b'])
    expect(q.currentIndex).toBeNull()
  })

  test('Q-14: [*a*,b,c] jump(c) → found=true, current=c', () => {
    const q = setQueue([pod('a'), pod('b'), pod('c')], 0)
    const r = jump(q, 'c')
    expect(r.found).toBe(true)
    expect(current(r.queue)?.id).toBe('c')
  })

  test('Q-15: [*a*,b,c] jump(zzz) → found=false, current=a (unchanged)', () => {
    const q = setQueue([pod('a'), pod('b'), pod('c')], 0)
    const r = jump(q, 'zzz')
    expect(r.found).toBe(false)
    expect(current(r.queue)?.id).toBe('a')
  })

  test('Q-16: [a,b,c] ci=null advance() → next=a, currentIndex=0', () => {
    const initial: { items: Podcast[]; currentIndex: number | null } = {
      items: [pod('a'), pod('b'), pod('c')],
      currentIndex: null,
    }
    const r = advance(initial)
    expect(r.next?.id).toBe('a')
    expect(r.queue.currentIndex).toBe(0)
  })

  test('Q-17: [*a*,b,c] advance() → next=b, currentIndex=1', () => {
    const q = setQueue([pod('a'), pod('b'), pod('c')], 0)
    const r = advance(q)
    expect(r.next?.id).toBe('b')
    expect(r.queue.currentIndex).toBe(1)
  })

  test('Q-18: [a,b,*c*] advance() → next=null (stop), current=c (stays at end)', () => {
    const q = setQueue([pod('a'), pod('b'), pod('c')], 2)
    const r = advance(q)
    expect(r.next).toBeNull()
    expect(current(r.queue)?.id).toBe('c')
  })

  test('Q-19: empty ci=null advance() → next=null', () => {
    const r = advance(emptyQueue)
    expect(r.next).toBeNull()
  })

  test('Q-20: [a,b,*c*] remove(a) → items=[b,c], current=c (follows current, index -1)', () => {
    let q = setQueue([pod('a'), pod('b'), pod('c')], 2)
    q = remove(q, 'a')
    expect(ids(q)).toEqual(['b', 'c'])
    expect(current(q)?.id).toBe('c')
  })

  test('Q-21: [a,*b*,c] remove(b) → items=[a,c], current=c (same-position promotion)', () => {
    let q = setQueue([pod('a'), pod('b'), pod('c')], 1)
    q = remove(q, 'b')
    expect(ids(q)).toEqual(['a', 'c'])
    expect(current(q)?.id).toBe('c')
  })

  test('Q-22: [a,b,*c*] remove(c) → items=[a,b], current=b (clamp at end)', () => {
    let q = setQueue([pod('a'), pod('b'), pod('c')], 2)
    q = remove(q, 'c')
    expect(ids(q)).toEqual(['a', 'b'])
    expect(current(q)?.id).toBe('b')
  })

  test('Q-23: [*a*,b,c] remove(c) → items=[a,b], current=a (after current, unaffected)', () => {
    let q = setQueue([pod('a'), pod('b'), pod('c')], 0)
    q = remove(q, 'c')
    expect(ids(q)).toEqual(['a', 'b'])
    expect(current(q)?.id).toBe('a')
  })

  test('Q-24: [a,*b*,c] remove(zzz) → no-op, current=b', () => {
    let q = setQueue([pod('a'), pod('b'), pod('c')], 1)
    const before = ids(q)
    q = remove(q, 'zzz')
    expect(ids(q)).toEqual(before)
    expect(current(q)?.id).toBe('b')
  })

  test('Q-25: [*a*] remove(a) → items=[], currentIndex=null', () => {
    let q = setQueue([pod('a')], 0)
    q = remove(q, 'a')
    expect(ids(q)).toEqual([])
    expect(q.currentIndex).toBeNull()
  })

  test('Q-26: [*a*,b,c,d] (upNext=[b,c,d]) moveUpNext(0, 2) → upNext=[c,b,d], items=[a,c,b,d], current=a', () => {
    const q = setQueue([pod('a'), pod('b'), pod('c'), pod('d')], 0)
    const r = moveUpNext(q, 0, 2)
    expect(upNextIds(r)).toEqual(['c', 'b', 'd'])
    expect(ids(r)).toEqual(['a', 'c', 'b', 'd'])
    expect(current(r)?.id).toBe('a')
  })

  test('Q-27: [*a*,b,c,d] (upNext=[b,c,d]) moveUpNext(2, 0) → upNext=[d,b,c], items=[a,d,b,c] (backward move, both semantics agree)', () => {
    const q = setQueue([pod('a'), pod('b'), pod('c'), pod('d')], 0)
    const r = moveUpNext(q, 2, 0)
    expect(upNextIds(r)).toEqual(['d', 'b', 'c'])
    expect(ids(r)).toEqual(['a', 'd', 'b', 'c'])
  })

  test('Q-28: [*a*,b,c,d] (upNext=[b,c,d], count=3) moveUpNext(0, 3) → upNext=[c,d,b], items=[a,c,d,b] (toOffset==count means move to end)', () => {
    const q = setQueue([pod('a'), pod('b'), pod('c'), pod('d')], 0)
    const r = moveUpNext(q, 0, 3)
    expect(upNextIds(r)).toEqual(['c', 'd', 'b'])
    expect(ids(r)).toEqual(['a', 'c', 'd', 'b'])
  })

  test('Q-29: [*a*,b,c,d] (upNext count=3) moveUpNext(0, 4) → no-op (toOffset out of range)', () => {
    const q = setQueue([pod('a'), pod('b'), pod('c'), pod('d')], 0)
    const before = upNextIds(q)
    const r = moveUpNext(q, 0, 4)
    expect(upNextIds(r)).toEqual(before)
  })

  test('Q-30: [*a*,b,c,d] (upNext count=3) moveUpNext(5, 0) → no-op (from out of range)', () => {
    const q = setQueue([pod('a'), pod('b'), pod('c'), pod('d')], 0)
    const before = upNextIds(q)
    const r = moveUpNext(q, 5, 0)
    expect(upNextIds(r)).toEqual(before)
  })

  test('Q-31: [*a*,b,c,d] (upNext=[b,c,d]) moveUpNext(1, 1) → no-op, upNext=[b,c,d] (same position)', () => {
    const q = setQueue([pod('a'), pod('b'), pod('c'), pod('d')], 0)
    const r = moveUpNext(q, 1, 1)
    expect(upNextIds(r)).toEqual(['b', 'c', 'd'])
  })

  test('Q-32: [a,b,c] ci=null (upNext=whole) moveUpNext(0, 2) → upNext=[b,a,c], items=[b,a,c], currentIndex=null', () => {
    const q: { items: Podcast[]; currentIndex: number | null } = {
      items: [pod('a'), pod('b'), pod('c')],
      currentIndex: null,
    }
    const r = moveUpNext(q, 0, 2)
    expect(upNextIds(r)).toEqual(['b', 'a', 'c'])
    expect(ids(r)).toEqual(['b', 'a', 'c'])
    expect(r.currentIndex).toBeNull()
  })
})
