// Learning infrastructure の learningGateway: port LearningGateway を ApiGateway の上に実装する（DTO ⇄ application の型）。
// adapter のテスト: `createGatewayDouble` の `calls` で path・method・body を見る。DTO の key（snake_case）はここ（infrastructure）だけに現れる。
//
// RED 理由（実装前）: `@/lib/learning/infrastructure/learningGateway` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createLearningGateway } from '@/lib/learning/infrastructure/learningGateway'
import { createGatewayDouble } from '../../../helpers/gatewayDouble'

const VOCAB_PATH = '/api/backend/vocabulary'
const QUIZ_PATH = '/api/backend/podcasts/p1/quiz-answers'

const VOCAB_ITEM = (term: string) => ({
  vocabulary_id: `v-${term}`,
  podcast_id: 'p1',
  term,
  meaning: 'm',
  example: 'e',
  registered_at: '2026-11-16T00:00:00Z',
})

const QUIZ_DTO = {
  correct_count: 1,
  total: 2,
  correct_rate: 0.5,
  results: [
    { question_index: 0, selected_index: 0, correct_index: 0, is_correct: true },
    { question_index: 1, selected_index: 2, correct_index: 1, is_correct: false },
  ],
}

describe('createLearningGateway.registerTerm (product-learn-05・product-learn-18)', () => {
  test('verifies: CI-LN13 — POST /api/backend/vocabulary に { podcast_id, term } を送り、成功は { ok: true, value: undefined }（応答の項目は捨てる）', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('POST', VOCAB_PATH, { ok: true, value: VOCAB_ITEM('apple') })

    const result = await createLearningGateway(gateway).registerTerm('p1', 'apple')

    expect(gateway.calls).toEqual([{ method: 'POST', path: VOCAB_PATH, body: { podcast_id: 'p1', term: 'apple' } }])
    expect(result).toEqual({ ok: true, value: undefined })
  })
})

describe('createLearningGateway.submitQuiz (product-learn-19)', () => {
  test('verifies: CI-LN14 — POST の body は { answers } で、入力と別の配列（呼出後に入力を書き換えても送った値は変わらない）', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('POST', QUIZ_PATH, { ok: true, value: QUIZ_DTO })
    const input = [0, 2]

    await createLearningGateway(gateway).submitQuiz('p1', input)
    input[0] = 9

    expect(gateway.calls).toHaveLength(1)
    expect(gateway.calls[0]).toMatchObject({ method: 'POST', path: QUIZ_PATH })
    const body = gateway.calls[0].body as { answers: number[] }
    expect(body).toEqual({ answers: [0, 2] })
    expect(body.answers).not.toBe(input)
  })

  test('verifies: CI-LN14 — DTO を camelCase の receipt に写し、correct_rate は写さない', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('POST', QUIZ_PATH, { ok: true, value: QUIZ_DTO })

    const result = await createLearningGateway(gateway).submitQuiz('p1', [0, 2])

    if (!result.ok) throw new Error('成功を期待した')
    expect(result.value).toEqual({
      correct: 1,
      total: 2,
      results: [
        { questionIndex: 0, selectedIndex: 0, correctIndex: 0, isCorrect: true },
        { questionIndex: 1, selectedIndex: 2, correctIndex: 1, isCorrect: false },
      ],
    })
    expect(Object.keys(result.value).sort()).toEqual(['correct', 'results', 'total'])
    expect(result.value).not.toHaveProperty('correct_rate')
    expect(result.value).not.toHaveProperty('correctRate')
    expect(result.value).not.toHaveProperty('correct_count')
  })

  test('verifies: CI-LN14 — receipt の本体・results の配列・各要素は凍結済み（web-check-06）', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('POST', QUIZ_PATH, { ok: true, value: QUIZ_DTO })

    const result = await createLearningGateway(gateway).submitQuiz('p1', [0, 2])

    if (!result.ok) throw new Error('成功を期待した')
    expect(Object.isFrozen(result.value)).toBe(true)
    expect(Object.isFrozen(result.value.results)).toBe(true)
    for (const item of result.value.results) expect(Object.isFrozen(item)).toBe(true)
  })
})

describe('createLearningGateway.listRegisteredTerms (product-learn-05・product-learn-18)', () => {
  test('verifies: CI-LN15 — GET /api/backend/vocabulary を呼び、成功の値は term の配列（順のまま）', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('GET', VOCAB_PATH, { ok: true, value: { vocabulary: [VOCAB_ITEM('a'), VOCAB_ITEM('b')], count: 2 } })

    const result = await createLearningGateway(gateway).listRegisteredTerms()

    expect(gateway.calls).toEqual([{ method: 'GET', path: VOCAB_PATH, body: undefined }])
    expect(result).toEqual({ ok: true, value: ['a', 'b'] })
  })
})

describe('createLearningGateway の失敗 (product-learn-05・product-learn-18・product-learn-19)', () => {
  test('verifies: CI-LN13・CI-LN14・CI-LN15 — 3 つの関数とも、失敗の ApiFailure をそのまま返す', async () => {
    const gateway = createGatewayDouble()
    const learning = createLearningGateway(gateway)

    expect(await learning.registerTerm('p1', 'apple')).toEqual({ ok: false, failure: { kind: 'network' } })
    expect(await learning.submitQuiz('p1', [0])).toEqual({ ok: false, failure: { kind: 'network' } })
    expect(await learning.listRegisteredTerms()).toEqual({ ok: false, failure: { kind: 'network' } })
  })
})
