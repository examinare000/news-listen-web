// Learning infrastructure の seenAchievementsStore: 既読の実績の id を KeyValueStore で読み書きする（web-dec-170・web-dep-11）。
// key（seen_achievement_ids）と codec（JSON の文字列配列）は本 store が持つ。保存に失敗した既読は、共有の記憶（UnsavedSeenAchievements）に
// session の間だけ置き、同じ session では再通知しない現行の挙動を保つ。
// 保存庫は手書きの記憶の KeyValueStore（set の成否を切り替えられる）。不変性のケース（web-check-06）は adapter のここに置く
// （unit の immutability.learning.test.ts が infrastructure を値で import すると web-check-08 が落ちる）。
//
// RED 理由（実装前）: `@/lib/learning/infrastructure/seenAchievementsStore` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createSeenAchievementsStore, createUnsavedSeenAchievements } from '@/lib/learning/infrastructure/seenAchievementsStore'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'

const KEY = 'seen_achievement_ids'

function memoryKv(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const sets: Array<{ key: string; value: string }> = []
  const removes: string[] = []
  const state = { setSucceeds: true }
  const kv: KeyValueStore = {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => {
      sets.push({ key, value })
      if (!state.setSucceeds) return false
      data.set(key, value)
      return true
    },
    remove: (key) => {
      removes.push(key)
      data.delete(key)
    },
  }
  return { kv, data, sets, removes, state }
}

describe('read の codec (web-dec-170・product-learn-04)', () => {
  test.each([
    { name: '文字列配列は順のまま', raw: '["a","b"]', expected: ['a', 'b'] },
    { name: '順序を保持する', raw: '["b","a"]', expected: ['b', 'a'] },
    { name: '壊れた JSON は空', raw: 'not-json', expected: [] },
    { name: '配列でない JSON は空', raw: '{"a":1}', expected: [] },
    { name: '文字列以外の要素を 1 つでも含めば空', raw: '["a",1]', expected: [] },
  ])('verifies: CI-LD06 — $name', ({ raw, expected }) => {
    const { kv } = memoryKv({ [KEY]: raw })

    const seen = createSeenAchievementsStore(kv, createUnsavedSeenAchievements()).read()

    expect([...seen]).toEqual(expected)
  })

  test('verifies: CI-LD06 — key が欠落していれば空の集合', () => {
    const { kv } = memoryKv()

    expect([...createSeenAchievementsStore(kv, createUnsavedSeenAchievements()).read()]).toEqual([])
  })
})

describe('write・clear (web-dec-170・web-dep-11)', () => {
  test('verifies: CI-LD06 — write は key seen_achievement_ids へ JSON 配列を 1 回保存し、clear は key を消す（2 回呼んでも結果は同じ）', () => {
    const { kv, data, sets, removes } = memoryKv({ [KEY]: '["x"]' })
    const store = createSeenAchievementsStore(kv, createUnsavedSeenAchievements())

    store.write(['x', 'y'])

    expect(sets).toEqual([{ key: KEY, value: '["x","y"]' }])
    expect(data.get(KEY)).toBe('["x","y"]')

    store.clear()
    store.clear()

    expect(removes).toEqual([KEY, KEY])
    expect(data.has(KEY)).toBe(false)
    expect([...store.read()]).toEqual([])
  })
})

describe('不変性 (web-check-06・DD の移し先)', () => {
  test('verifies: CI-LD06 — write に渡した配列を後から変えても、保存値と次の read は変わらない', () => {
    const { kv, data } = memoryKv()
    const store = createSeenAchievementsStore(kv, createUnsavedSeenAchievements())
    const input = ['a']

    store.write(input)
    input.push('b')

    expect(data.get(KEY)).toBe('["a"]')
    expect([...store.read()]).toEqual(['a'])
  })

  test('verifies: CI-LD06 — read の戻りは凍結済みで、書き換えを試みても次の read と保存値は変わらない', () => {
    const { kv, data } = memoryKv({ [KEY]: '["a"]' })
    const store = createSeenAchievementsStore(kv, createUnsavedSeenAchievements())

    const first = store.read()
    expect(Object.isFrozen(first)).toBe(true)
    try {
      ;(first as Set<string>).add('b')
    } catch {
      // add が throw する実装でも、次の read に影響しないことだけを観測する
    }

    expect([...store.read()]).toEqual(['a'])
    expect(data.get(KEY)).toBe('["a"]')
  })
})

describe('保存に失敗した既読の記憶 (product-learn-04)', () => {
  test('verifies: CI-LD06 — 保存失敗の間は記憶を共有する 2 つの store が同じ値を読み、成功に戻ると保存値を読む。clear で記憶も空になる', () => {
    const { kv, data, state } = memoryKv({ [KEY]: '["a"]' })
    const unsaved = createUnsavedSeenAchievements()
    const koh = createSeenAchievementsStore(kv, unsaved)
    const otsu = createSeenAchievementsStore(kv, unsaved)

    state.setSucceeds = false
    expect(() => koh.write(['a', 'b'])).not.toThrow()

    // 保存値は古いまま。記憶を持つので甲・乙とも 'a','b' を読む（再通知しない）。
    expect(data.get(KEY)).toBe('["a"]')
    expect([...koh.read()]).toEqual(['a', 'b'])
    expect([...otsu.read()]).toEqual(['a', 'b'])

    state.setSucceeds = true
    koh.write(['a', 'b', 'c'])

    // 保存できたら記憶は空になり、乙は保存値を読む。
    expect(data.get(KEY)).toBe('["a","b","c"]')
    expect([...otsu.read()]).toEqual(['a', 'b', 'c'])

    state.setSucceeds = false
    koh.write(['z'])
    expect([...otsu.read()]).toEqual(['z'])

    koh.clear()
    expect([...otsu.read()]).toEqual([])
    expect(data.has(KEY)).toBe(false)
  })

  test('verifies: CI-LD06 — 記憶を共有しない store は、保存失敗の既読を読まない（共有の対照）', () => {
    const { kv, state } = memoryKv()
    const writer = createSeenAchievementsStore(kv, createUnsavedSeenAchievements())
    const other = createSeenAchievementsStore(kv, createUnsavedSeenAchievements())

    state.setSucceeds = false
    writer.write(['a'])

    expect([...writer.read()]).toEqual(['a'])
    expect([...other.read()]).toEqual([])
  })

  test('verifies: CI-LD06 — 記憶から読んだ値も凍結済みで、書き換えを試みても次の read は変わらない', () => {
    const { kv, state } = memoryKv()
    const store = createSeenAchievementsStore(kv, createUnsavedSeenAchievements())
    state.setSucceeds = false
    const input = ['a']
    store.write(input)
    input.push('b')

    const first = store.read()
    expect(Object.isFrozen(first)).toBe(true)
    try {
      ;(first as Set<string>).add('x')
    } catch {
      // throw する実装でもよい
    }

    expect([...store.read()]).toEqual(['a'])
  })
})
