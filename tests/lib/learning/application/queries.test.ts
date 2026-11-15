// Learning application の query: getRegisteredTerms は登録済みの語の集合を返し、失敗を素通しする（product-learn-05・product-learn-18）。
// gateway は手書きの fake（infrastructure・helper を値で import しない）。
//
// RED 理由（実装前）: `@/lib/learning/application/queries` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createLearningQueries } from '@/lib/learning/application/queries'
import type { LearningGateway } from '@/lib/learning/application/ports'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

function harness(listed: Result<ReadonlyArray<string>, ApiFailure>) {
  let listCalls = 0
  const gateway: LearningGateway = {
    registerTerm: () => Promise.resolve({ ok: true, value: undefined }),
    submitQuiz: () => Promise.resolve({ ok: true, value: { correct: 0, total: 0, results: [] } }),
    listRegisteredTerms: () => {
      listCalls += 1
      return Promise.resolve(listed)
    },
  }
  return { queries: createLearningQueries({ gateway }), listCount: () => listCalls }
}

describe('getRegisteredTerms (product-learn-05・product-learn-18)', () => {
  test('verifies: CI-LN10 — 成功の値は登録済みの語の集合（size 2、a・b を含む）。gateway は 1 回だけ読む', async () => {
    const { queries, listCount } = harness({ ok: true, value: ['a', 'b'] })

    const result = await queries.getRegisteredTerms()

    if (!result.ok) throw new Error('成功を期待した')
    expect(result.value.size).toBe(2)
    expect(result.value.has('a')).toBe(true)
    expect(result.value.has('b')).toBe(true)
    expect(listCount()).toBe(1)
  })

  test('verifies: CI-LN10 — 呼ぶたびに gateway を読む（キャッシュしない）', async () => {
    const { queries, listCount } = harness({ ok: true, value: ['a'] })

    await queries.getRegisteredTerms()
    await queries.getRegisteredTerms()

    expect(listCount()).toBe(2)
  })

  test('verifies: CI-LN10 — gateway の失敗をそのまま返す（throw しない）', async () => {
    const failure: ApiFailure = { kind: 'unauthorized' }
    const { queries } = harness({ ok: false, failure })

    const result = await queries.getRegisteredTerms()

    expect(result).toEqual({ ok: false, failure })
  })
})
