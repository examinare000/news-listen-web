// 新モジュール lib/playback/queue の契約テスト。
// - 「playbackQueue」describe: 旧 tests/lib/playbackQueue.test.ts の全ケース（reorderUpNext → moveUpNext の読み替えのみ）。
// - それ以降: 出力 gate の網羅列挙・入力 gate（不変条件を破る q の入力）・正規化・no-op の同一参照・export 面。
// verifies: CI-T9
//
// RED 理由: `@/lib/playback/queue` がまだ存在しない。
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
  moveUpNext,
} from '@/lib/playback/queue'
import type { QueueState } from '@/lib/playback/queue'
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

  test('moveUpNext reorders waiting list and keeps current fixed', () => {
    let q = setQueue([pod('a'), pod('b'), pod('c'), pod('d')], 0) // current a, upNext [b,c,d]
    q = moveUpNext(q, 2, 0) // move d to front of upNext
    expect(upNext(q).map((p) => p.id)).toEqual(['d', 'b', 'c'])
    expect(current(q)?.id).toBe('a')
  })
})


// ---------------------------------------------------------------------------
// 出力 gate の網羅: 公開操作の全戻り値が不変条件 1〜3 を満たす（決定的な列挙。乱数を使わない）
// ---------------------------------------------------------------------------
type Q = QueueState

function assertInvariants(q: QueueState, trail: string) {
  const idList = q.items.map((p) => p.id)
  expect(new Set(idList).size, `ids unique after ${trail}`).toBe(idList.length)
  if (q.items.length === 0) {
    expect(q.currentIndex, `empty => null after ${trail}`).toBeNull()
    return
  }
  if (q.currentIndex !== null) {
    expect(Number.isInteger(q.currentIndex), `integer index after ${trail}`).toBe(true)
    expect(q.currentIndex, `index in range after ${trail}`).toBeGreaterThanOrEqual(0)
    expect(q.currentIndex, `index in range after ${trail}`).toBeLessThanOrEqual(q.items.length - 1)
  }
}

describe('CI-T9 出力 gate（公開操作の全戻り値が不変条件 1〜3 を満たす）', () => {
  type Op = { name: string; run: (q: Q) => Q }
  const a = pod('a')
  const b = pod('b')
  const c = pod('c')
  const byId: Record<string, Podcast> = { a, b, c }
  const ops: Op[] = [
    { name: 'start(a)', run: (q) => start(q, a) },
    ...[-1, 1, 5, Number.NaN, 1.5].map((s) => ({
      name: `setQueue([a,b,c],${s})`,
      run: () => setQueue([a, b, c], s),
    })),
    ...(['a', 'b', 'c'] as const).flatMap((id) => [
      { name: `add(${id})`, run: (q: Q) => add(q, byId[id]) },
      { name: `playNext(${id})`, run: (q: Q) => playNext(q, byId[id]) },
      { name: `remove(${id})`, run: (q: Q) => remove(q, id) },
    ]),
    ...['a', 'c', 'z'].map((id) => ({ name: `jump(${id})`, run: (q: Q) => jump(q, id).queue })),
    { name: 'advance', run: (q) => advance(q).queue },
    ...(
      [
        [-1, 0],
        [0, 0],
        [0, 2],
        [1, 0],
        [0, 3],
        [Number.NaN, 0],
        [2, 5],
      ] as Array<[number, number]>
    ).map(([i, j]) => ({ name: `moveUpNext(${i},${j})`, run: (q: Q) => moveUpNext(q, i, j) })),
  ]

  test('操作 26 個の長さ ≤ 3 の全列で throw せず、各ステップで不変条件が成立する', () => {
    expect(ops).toHaveLength(26)
    let steps = 0
    const walk = (q: Q, depth: number, trail: string) => {
      if (depth === 3) return
      for (const op of ops) {
        const next = op.run(q)
        steps += 1
        assertInvariantsFast(next)
        walk(next, depth + 1, `${trail} > ${op.name}`)
      }
    }
    // expect を 18,278 ステップ × 数回呼ぶと遅いため、列挙中は述語だけで判定し、違反時に詳細を出す。
    const assertInvariantsFast = (q: QueueState) => {
      const idList = q.items.map((p) => p.id)
      const ok =
        new Set(idList).size === idList.length &&
        (q.items.length === 0
          ? q.currentIndex === null
          : q.currentIndex === null ||
            (Number.isInteger(q.currentIndex) && q.currentIndex >= 0 && q.currentIndex <= q.items.length - 1))
      if (!ok) assertInvariants(q, JSON.stringify(q))
    }
    walk(emptyQueue, 0, 'emptyQueue')
    expect(steps).toBe(26 + 26 * 26 + 26 * 26 * 26)
  })
})

// ---------------------------------------------------------------------------
// 入力 gate: 不変条件を破る q を受け取る 6 操作は、処理の前に Error を throw する（24 セル）
// ---------------------------------------------------------------------------
describe('CI-T9 入力 gate（不変条件を破る q を渡す 6 操作 × 4 種 = 24 セル）', () => {
  const invalidQueues: Array<[string, { items: Podcast[]; currentIndex: number | null }]> = [
    ['Q_dup（id 重複）', { items: [pod('a'), pod('a')], currentIndex: 0 }],
    ['Q_oob（currentIndex 範囲外）', { items: [pod('a'), pod('b')], currentIndex: 5 }],
    ['Q_frac（currentIndex 非整数）', { items: [pod('a'), pod('b')], currentIndex: 0.5 }],
    ['Q_emp（空で currentIndex 非 null）', { items: [], currentIndex: 0 }],
  ]
  const calls: Array<[string, (q: { items: Podcast[]; currentIndex: number | null }) => unknown]> = [
    ['add(q, x)', (q) => add(q, pod('x'))],
    ['playNext(q, x)', (q) => playNext(q, pod('x'))],
    ["jump(q, 'a')", (q) => jump(q, 'a')],
    ['advance(q)', (q) => advance(q)],
    ["remove(q, 'a')", (q) => remove(q, 'a')],
    ['moveUpNext(q, 0, 0)', (q) => moveUpNext(q, 0, 0)],
  ]

  for (const [qName, q] of invalidQueues) {
    for (const [callName, call] of calls) {
      test(`${qName} × ${callName} は Error を throw する`, () => {
        expect(() => call(q)).toThrow(Error)
      })
    }
  }
})

describe('CI-T9 入力 gate の対象外（current / upNext / start は不変条件違反の q でも throw しない）', () => {
  const qDup = { items: [pod('a'), pod('a')], currentIndex: 0 }
  const qOob = { items: [pod('a'), pod('b')], currentIndex: 5 }
  const qFrac = { items: [pod('a'), pod('b')], currentIndex: 0.5 }
  const qEmp = { items: [], currentIndex: 0 }

  test('current は範囲外・非整数・空で null、重複では該当要素を返す', () => {
    expect(current(qOob)).toBeNull()
    expect(current(qEmp)).toBeNull()
    expect(current(qFrac)).toBeNull()
    expect(current(qDup)?.id).toBe('a')
  })

  test('upNext は範囲外・空で []', () => {
    expect(upNext(qOob)).toEqual([])
    expect(upNext(qEmp)).toEqual([])
    expect(() => upNext(qDup)).not.toThrow()
    expect(() => upNext(qFrac)).not.toThrow()
  })

  test('start は q を読まず、どの不正な q でも単一要素キューを返す', () => {
    for (const q of [qDup, qOob, qFrac, qEmp]) {
      expect(start(q, pod('x'))).toEqual({ items: [pod('x')], currentIndex: 0 })
    }
  })
})

// ---------------------------------------------------------------------------
// 正規化・no-op
// ---------------------------------------------------------------------------
describe('CI-T9 setQueue の正規化', () => {
  test('startAt が NaN なら 0（current は先頭）', () => {
    expect(current(setQueue([pod('a'), pod('b'), pod('c')], Number.NaN))?.id).toBe('a')
  })

  test('startAt が非整数なら trunc してから clamp（1.5 → 1）', () => {
    expect(current(setQueue([pod('a'), pod('b'), pod('c')], 1.5))?.id).toBe('b')
  })

  test('重複 id は先勝ちで除き、current は clamp 後の startAt が指していた要素の id の位置', () => {
    const q = setQueue([pod('a'), pod('b'), pod('a')], 2)
    expect(ids(q)).toEqual(['a', 'b'])
    expect(current(q)?.id).toBe('a')
    expect(q.currentIndex).toBe(0)
  })

  test('空の items は emptyQueue', () => {
    expect(setQueue([], 3)).toEqual({ items: [], currentIndex: null })
  })
})

describe('CI-T9 moveUpNext の範囲外・非整数・NaN は同一参照の q を返す', () => {
  const q = setQueue([pod('a'), pod('b'), pod('c')], 0) // upNext [b, c]

  test('NaN の from', () => {
    expect(moveUpNext(q, Number.NaN, 0)).toBe(q)
  })

  test('非整数の from', () => {
    expect(moveUpNext(q, 0.5, 1)).toBe(q)
  })

  test('NaN / 非整数の toOffset', () => {
    expect(moveUpNext(q, 0, Number.NaN)).toBe(q)
    expect(moveUpNext(q, 0, 1.5)).toBe(q)
  })

  test('範囲外の from・toOffset', () => {
    expect(moveUpNext(q, -1, 0)).toBe(q)
    expect(moveUpNext(q, 2, 0)).toBe(q)
    expect(moveUpNext(q, 0, 3)).toBe(q)
  })
})

describe('CI-T9 no-op 経路は入力 q を同一参照で返す', () => {
  const q = setQueue([pod('a'), pod('b'), pod('c')], 0)

  test('add: 重複は同一参照', () => {
    expect(add(q, pod('b'))).toBe(q)
  })

  test('jump: 不在 id は同一参照で found=false', () => {
    const r = jump(q, 'zzz')
    expect(r.found).toBe(false)
    expect(r.queue).toBe(q)
  })

  test('remove: 不在 id は同一参照', () => {
    expect(remove(q, 'zzz')).toBe(q)
  })

  test('playNext: 現在再生中の id は同一参照', () => {
    expect(playNext(q, pod('a'))).toBe(q)
  })

  test('emptyQueue と items は凍結されている', () => {
    expect(Object.isFrozen(emptyQueue)).toBe(true)
    expect(Object.isFrozen(emptyQueue.items)).toBe(true)
  })
})

describe('CI-T9 export 面（公開 11 操作だけ）', () => {
  test('create と reorderUpNext を export せず、11 操作と一致する', async () => {
    const Q = await import('@/lib/playback/queue')
    expect(Object.keys(Q).sort()).toEqual(
      [
        'add',
        'advance',
        'current',
        'emptyQueue',
        'jump',
        'moveUpNext',
        'playNext',
        'remove',
        'setQueue',
        'start',
        'upNext',
      ].sort(),
    )
    expect('create' in Q).toBe(false)
    expect('reorderUpNext' in Q).toBe(false)
  })
})
