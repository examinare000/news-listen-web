// おすすめサイトの order の規則（web-rule-admin-02・web-dec-134）。
// 作成は最大 order + 1（空なら 0）、編集は既存の order を引き継ぎ、並べ替えは入れ替え後に order と index がずれた行すべてを index 順で返す。
//
// RED 理由（実装前）: `@/lib/admin/domain/featuredOrder` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { nextOrder, orderForUpdate, reorderDiff } from '@/lib/admin/domain/featuredOrder'

type Site = { readonly id: string; readonly order: number; readonly name: string }
const site = (id: string, order: number): Site => ({ id, order, name: `name-${id}` })
const brief = (rows: ReadonlyArray<Site> | null) => rows?.map((r) => `${r.id}:${r.order}`) ?? null

describe('web-rule-admin-02 nextOrder', () => {
  test('空なら 0', () => {
    expect(nextOrder([])).toBe(0)
  })

  test('連番 [0,1,2] なら 3', () => {
    expect(nextOrder([site('a', 0), site('b', 1), site('c', 2)])).toBe(3)
  })

  test('欠番 [0,5] は最大 + 1 で 6', () => {
    expect(nextOrder([site('a', 0), site('b', 5)])).toBe(6)
  })

  test('重複 [2,2] は 3', () => {
    expect(nextOrder([site('a', 2), site('b', 2)])).toBe(3)
  })
})

describe('web-rule-admin-02 orderForUpdate', () => {
  test('id が在れば、その行の order を引き継ぐ', () => {
    expect(orderForUpdate([site('a', 4), site('b', 7)], 'b')).toBe(7)
  })

  test('id が無ければ 0', () => {
    expect(orderForUpdate([site('a', 4)], 'zzz')).toBe(0)
  })
})

describe('web-dec-134 reorderDiff', () => {
  const abc = [site('a', 0), site('b', 1), site('c', 2)]

  test('b を up: 入れ替えた 2 行を index 順で返す（b が 0、a が 1）', () => {
    expect(brief(reorderDiff(abc, 'b', 'up'))).toEqual(['b:0', 'a:1'])
  })

  test('b を down: 入れ替えた 2 行を index 順で返す（c が 1、b が 2）', () => {
    expect(brief(reorderDiff(abc, 'b', 'down'))).toEqual(['c:1', 'b:2'])
  })

  test('先頭で up は null', () => {
    expect(reorderDiff(abc, 'a', 'up')).toBeNull()
  })

  test('末尾で down は null', () => {
    expect(reorderDiff(abc, 'c', 'down')).toBeNull()
  })

  test('無い id は null', () => {
    expect(reorderDiff(abc, 'zzz', 'up')).toBeNull()
  })

  test('入れ替えても全行が order = index になるなら、null でなく空配列', () => {
    const result = reorderDiff([site('a', 1), site('b', 0)], 'a', 'down')
    expect(result).not.toBeNull()
    expect(result).toEqual([])
  })

  test('重複 [a:0,b:1,c:1,d:3] の a を down: order と index がずれた b(0)・a(1)・c(2) の 3 行すべてを返す（入れ替えた 2 行だけではない）', () => {
    const sites = [site('a', 0), site('b', 1), site('c', 1), site('d', 3)]
    expect(brief(reorderDiff(sites, 'a', 'down'))).toEqual(['b:0', 'a:1', 'c:2'])
  })

  test('欠番 [a:0,b:2,c:3] の a を down: b(0)・a(1)・c(2) の 3 行（欠番を詰める）', () => {
    const sites = [site('a', 0), site('b', 2), site('c', 3)]
    expect(brief(reorderDiff(sites, 'a', 'down'))).toEqual(['b:0', 'a:1', 'c:2'])
  })

  test('入力を書き換えず、返る行は入力の要素と別の object で、order 以外の field は保つ', () => {
    const sites = Object.freeze(abc.map((s) => Object.freeze({ ...s })))
    const result = reorderDiff(sites, 'b', 'up')

    expect(result).not.toBeNull()
    expect(brief(sites)).toEqual(['a:0', 'b:1', 'c:2'])
    for (const row of result ?? []) {
      const original = sites.find((s) => s.id === row.id)
      expect(row).not.toBe(original)
      expect(row.name).toBe(`name-${row.id}`)
    }
  })
})
