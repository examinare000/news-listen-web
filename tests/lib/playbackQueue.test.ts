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
  reorderUpNext,
} from '@/lib/playbackQueue'
import type { Podcast } from '@/types'

// issue #81: 再生キューの純粋ロジック（自動次再生・空キュー停止・並べ替え等）。

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

describe('playbackQueue', () => {
  test('advance moves to next then stops at end', () => {
    const q = setQueue([pod('a'), pod('b'), pod('c')], 0)
    expect(current(q)?.id).toBe('a')

    let r = advance(q)
    expect(r.next?.id).toBe('b')
    r = advance(r.queue)
    expect(r.next?.id).toBe('c')
    r = advance(r.queue)
    expect(r.next).toBeNull() // 末尾 → 停止
    expect(current(r.queue)?.id).toBe('c')
  })

  test('advance on empty queue returns null', () => {
    const r = advance(emptyQueue)
    expect(r.next).toBeNull()
  })

  test('start replaces the queue with a single episode', () => {
    const q = start(setQueue([pod('x'), pod('y')], 0), pod('z'))
    expect(ids(q)).toEqual(['z'])
    expect(current(q)?.id).toBe('z')
  })

  test('add appends and deduplicates', () => {
    let q = start(emptyQueue, pod('a'))
    q = add(q, pod('b'))
    q = add(q, pod('b'))
    expect(ids(q)).toEqual(['a', 'b'])
  })

  test('playNext inserts right after current', () => {
    let q = setQueue([pod('a'), pod('b'), pod('c')], 1) // current b
    q = playNext(q, pod('d'))
    expect(current(q)?.id).toBe('b')
    expect(upNext(q).map((p) => p.id)).toEqual(['d', 'c'])
  })

  test('playNext moves an existing item to right after current', () => {
    let q = setQueue([pod('a'), pod('b'), pod('c')], 0) // current a
    q = playNext(q, pod('c'))
    expect(ids(q)).toEqual(['a', 'c', 'b'])
    expect(current(q)?.id).toBe('a')
  })

  test('upNext excludes current and played', () => {
    const q = setQueue([pod('a'), pod('b'), pod('c')], 1)
    expect(upNext(q).map((p) => p.id)).toEqual(['c'])
  })

  test('remove upNext item', () => {
    let q = setQueue([pod('a'), pod('b'), pod('c')], 0)
    q = remove(q, 'c')
    expect(ids(q)).toEqual(['a', 'b'])
    expect(current(q)?.id).toBe('a')
  })

  test('remove item before current keeps current', () => {
    let q = setQueue([pod('a'), pod('b'), pod('c')], 2) // current c
    q = remove(q, 'a')
    expect(ids(q)).toEqual(['b', 'c'])
    expect(current(q)?.id).toBe('c')
  })

  test('remove current promotes the next item', () => {
    let q = setQueue([pod('a'), pod('b'), pod('c')], 1) // current b
    q = remove(q, 'b')
    expect(ids(q)).toEqual(['a', 'c'])
    expect(current(q)?.id).toBe('c')
  })

  test('jump sets current to an existing item', () => {
    const r = jump(setQueue([pod('a'), pod('b'), pod('c')], 0), 'c')
    expect(r.found).toBe(true)
    expect(current(r.queue)?.id).toBe('c')
    expect(jump(r.queue, 'zzz').found).toBe(false)
  })

  test('reorderUpNext reorders waiting list and keeps current fixed', () => {
    let q = setQueue([pod('a'), pod('b'), pod('c'), pod('d')], 0) // current a, upNext [b,c,d]
    q = reorderUpNext(q, 2, 0) // move d to front of upNext
    expect(upNext(q).map((p) => p.id)).toEqual(['d', 'b', 'c'])
    expect(current(q)?.id).toBe('a')
  })
})
