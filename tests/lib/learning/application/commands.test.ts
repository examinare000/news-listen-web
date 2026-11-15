// Learning application の command: registerTerm・submitQuiz は gateway へ委譲し、失敗をそのまま返す（product-learn-05・18・19）。
// gateway は呼出を記録する手書きの fake（infrastructure・helper を値で import しない）。
//
// RED 理由（実装前）: `@/lib/learning/application/commands` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createLearningCommands } from '@/lib/learning/application/commands'
import type { QuizReceipt } from '@/lib/learning/application/commands'
import type { LearningGateway } from '@/lib/learning/application/ports'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

type Call = { readonly name: string; readonly args: readonly unknown[] }

const RECEIPT: QuizReceipt = {
  correct: 1,
  total: 2,
  results: [
    { questionIndex: 0, selectedIndex: 0, correctIndex: 0, isCorrect: true },
    { questionIndex: 1, selectedIndex: 2, correctIndex: 1, isCorrect: false },
  ],
}

function harness(overrides: {
  readonly register?: Result<void, ApiFailure>
  readonly submit?: Result<QuizReceipt, ApiFailure>
}) {
  const calls: Call[] = []
  const gateway: LearningGateway = {
    registerTerm: (episodeId, term) => {
      calls.push({ name: 'registerTerm', args: [episodeId, term] })
      return Promise.resolve(overrides.register ?? { ok: true, value: undefined })
    },
    submitQuiz: (episodeId, answers) => {
      calls.push({ name: 'submitQuiz', args: [episodeId, answers] })
      return Promise.resolve(overrides.submit ?? { ok: true, value: RECEIPT })
    },
    listRegisteredTerms: () => {
      calls.push({ name: 'listRegisteredTerms', args: [] })
      return Promise.resolve({ ok: true, value: [] })
    },
  }
  return { commands: createLearningCommands({ gateway }), calls }
}

describe('registerTerm (product-learn-05・product-learn-18)', () => {
  test('verifies: CI-LN07 — gateway.registerTerm を同じ引数で 1 回だけ呼び、成功は { ok: true, value: undefined }', async () => {
    const { commands, calls } = harness({})

    const result = await commands.registerTerm('p1', 'apple')

    expect(calls).toEqual([{ name: 'registerTerm', args: ['p1', 'apple'] }])
    expect(result).toEqual({ ok: true, value: undefined })
  })

  test('verifies: CI-LN07 — gateway の失敗をそのまま返す（throw しない・書き換えない）', async () => {
    const failure: ApiFailure = { kind: 'server', status: 500 }
    const { commands } = harness({ register: { ok: false, failure } })

    const result = await commands.registerTerm('p1', 'apple')

    expect(result).toEqual({ ok: false, failure })
    expect(!result.ok && result.failure).toBe(failure)
  })
})

describe('submitQuiz (product-learn-19)', () => {
  test('verifies: CI-LN08 — gateway.submitQuiz を同じ引数で 1 回だけ呼び、成功の値は gateway の receipt と同じ参照（作り直さない）', async () => {
    const { commands, calls } = harness({})

    const result = await commands.submitQuiz('p1', [0, 2])

    expect(calls).toEqual([{ name: 'submitQuiz', args: ['p1', [0, 2]] }])
    expect(result.ok && result.value).toBe(RECEIPT)
  })

  test('verifies: CI-LN08 — receipt の key は correct・total・results だけで、passed・correct_rate・correctRate を持たない', async () => {
    const { commands } = harness({})

    const result = await commands.submitQuiz('p1', [0, 2])

    if (!result.ok) throw new Error('成功を期待した')
    expect(Object.keys(result.value).sort()).toEqual(['correct', 'results', 'total'])
    expect(result.value).not.toHaveProperty('passed')
    expect(result.value).not.toHaveProperty('correctRate')
    expect(result.value).not.toHaveProperty('correct_rate')
  })

  test('verifies: CI-LN08 — gateway の失敗をそのまま返す（throw しない）', async () => {
    const failure: ApiFailure = { kind: 'network' }
    const { commands } = harness({ submit: { ok: false, failure } })

    const result = await commands.submitQuiz('p1', [0, 2])

    expect(result).toEqual({ ok: false, failure })
  })
})
