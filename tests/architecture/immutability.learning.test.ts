// @vitest-environment node
// Learning の query の戻り値の不変性（web-check-06 の観点 2・3）。getRegisteredTerms の成功の値は凍結済みの Set で、呼ぶたびに別の object。
// `Set` は凍結しても `add` が throw しないので、観点 2 は `Object.isFrozen` で判定する。
// gateway は手書きの fake（infrastructure・helper を値で import しない）。
//
// RED 理由（実装前）: `@/lib/learning/application/queries` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createLearningQueries } from '@/lib/learning/application/queries'
import type { LearningGateway } from '@/lib/learning/application/ports'

function queriesFor(terms: ReadonlyArray<string>) {
  const gateway: LearningGateway = {
    registerTerm: () => Promise.resolve({ ok: true, value: undefined }),
    submitQuiz: () => Promise.resolve({ ok: true, value: { correct: 0, total: 0, results: [] } }),
    listRegisteredTerms: () => Promise.resolve({ ok: true, value: terms }),
  }
  return createLearningQueries({ gateway })
}

describe('web-check-06 getRegisteredTerms の不変性 (product-learn-05・product-learn-18)', () => {
  test('verifies: CI-LN11 — 2 回呼ぶと、どちらの成功の値も凍結済みで、別の object で中身は等しい', async () => {
    const queries = queriesFor(['a'])

    const first = await queries.getRegisteredTerms()
    const second = await queries.getRegisteredTerms()

    if (!first.ok || !second.ok) throw new Error('成功を期待した')
    expect(Object.isFrozen(first.value)).toBe(true)
    expect(Object.isFrozen(second.value)).toBe(true)
    expect(first.value).not.toBe(second.value)
    expect([...first.value]).toEqual([...second.value])
  })

  test('verifies: CI-LN11 — 1 回目の値をキャストして add しても、2 回目の値は影響を受けない', async () => {
    const queries = queriesFor(['a'])

    const first = await queries.getRegisteredTerms()
    if (!first.ok) throw new Error('成功を期待した')
    try {
      ;(first.value as Set<string>).add('x')
    } catch {
      // 実装が add を throw させる場合も、2 回目に影響しないことだけを観測する
    }
    const second = await queries.getRegisteredTerms()

    if (!second.ok) throw new Error('成功を期待した')
    expect(second.value.has('x')).toBe(false)
    expect([...second.value]).toEqual(['a'])
  })

  test('verifies: CI-LN11 — gateway が返した配列とは別の Set（元の配列を書き換えても値は変わらない）', async () => {
    const source = ['a']
    const queries = queriesFor(source)

    const result = await queries.getRegisteredTerms()
    source.push('z')

    if (!result.ok) throw new Error('成功を期待した')
    expect(result.value.has('z')).toBe(false)
  })
})
