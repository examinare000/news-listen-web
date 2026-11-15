// Learning application の readModels: Catalog の語彙と登録済みの集合を GlossaryView に合成する（product-learn-05・product-learn-18）。
// isRegistered は値で import せず、期待値は literal で書く（自分の subject 以外を値で import しない）。
//
// RED 理由（実装前）: `@/lib/learning/application/readModels` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { toGlossaryViews } from '@/lib/learning/application/readModels'
import type { GlossaryEntry } from '@/lib/catalog/domain/episode'

const GLOSSARY: ReadonlyArray<GlossaryEntry> = [
  { term: 'apple', meaningJa: 'りんご', example: 'I eat an apple.' },
  { term: 'banana', meaningJa: 'バナナ', example: 'A banana is yellow.' },
]

describe('toGlossaryViews (product-learn-05・product-learn-18)', () => {
  test('verifies: CI-LN12 — 入力の順・件数のまま、meaning ← meaningJa、registered ← 登録済みかどうか', () => {
    const views = toGlossaryViews(GLOSSARY, new Set(['banana']))

    expect(views).toEqual([
      { term: 'apple', meaning: 'りんご', example: 'I eat an apple.', registered: false },
      { term: 'banana', meaning: 'バナナ', example: 'A banana is yellow.', registered: true },
    ])
  })

  test('verifies: CI-LN12 — 戻り値の配列と各要素は凍結済み（web-check-06）', () => {
    const views = toGlossaryViews(GLOSSARY, new Set(['banana']))

    expect(Object.isFrozen(views)).toBe(true)
    for (const view of views) expect(Object.isFrozen(view)).toBe(true)
  })

  test('verifies: CI-LN12 — 入力を変更せず、入力と別の object を返す', () => {
    const input = GLOSSARY.map((entry) => ({ ...entry }))
    const snapshot = JSON.stringify(input)

    const views = toGlossaryViews(input, new Set(['apple']))

    expect(JSON.stringify(input)).toBe(snapshot)
    expect(views).not.toBe(input)
    expect(views[0]).not.toBe(input[0])
  })

  test('verifies: CI-LN12 — 登録済みの語が glossary に無ければ、すべて未登録', () => {
    const views = toGlossaryViews(GLOSSARY, new Set(['cherry']))

    expect(views.map((v) => v.registered)).toEqual([false, false])
  })

  test('verifies: CI-LN12 — glossary が空なら空配列', () => {
    expect(toGlossaryViews([], new Set(['x']))).toEqual([])
  })
})
