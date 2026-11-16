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

const STREAK_PATH = '/api/backend/users/me/listening-streak'
const DASHBOARD_PATH = '/api/backend/users/me/learning-dashboard'
const SUGGESTION_PATH = '/api/backend/users/me/difficulty-suggestion'
const TEST_SESSION_PATH = '/api/backend/vocabulary/test-session'

const STREAK_DTO = { current_streak_days: 5, today_listened: true, last_listened_day: '2026-07-04' }

const DASHBOARD_DTO = {
  streak: STREAK_DTO,
  total_episodes: 12,
  vocabulary_acquired: 7,
  quiz: {
    quizzed_episodes: 2,
    average_correct_rate: 0.75,
    trend: [
      { graded_at: '2026-07-05T00:00:00Z', correct_rate: 0.5 },
      { graded_at: '2026-07-06T09:30:00Z', correct_rate: 1 },
    ],
  },
  monthly_activity: [
    { month: '2026-06', active_days: 3 },
    { month: '2026-07', active_days: 4 },
  ],
  current_difficulty: 'toeic_600',
  weekly_goal: {
    goal_episodes: 5,
    week: '2026-W27',
    completed_this_week: 3,
    history: [{ week: '2026-W26', goal: 5, completed: 4 }],
  },
  achievements: [
    { id: 'first_listen', unlocked_at: '2026-07-01' },
    { id: 'streak_7', unlocked_at: '2026-07-03' },
  ],
}

function collectFrozen(value: unknown, path: string, notFrozen: string[]): void {
  if (typeof value !== 'object' || value === null) return
  if (!Object.isFrozen(value)) notFrozen.push(path)
  for (const [key, child] of Object.entries(value)) collectFrozen(child, `${path}.${key}`, notFrozen)
}

describe('createLearningGateway.getListeningStreak (product-learn-01・web-dec-169)', () => {
  test('verifies: CI-LD07 — GET /users/me/listening-streak を 1 回呼び、camelCase の凍結済みの値に写す', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('GET', STREAK_PATH, { ok: true, value: STREAK_DTO })

    const result = await createLearningGateway(gateway).getListeningStreak()

    expect(gateway.calls).toEqual([{ method: 'GET', path: STREAK_PATH, body: undefined }])
    expect(result).toEqual({ ok: true, value: { days: 5, todayListened: true, lastListenedDay: '2026-07-04' } })
    if (!result.ok) throw new Error('成功を期待した')
    expect(Object.isFrozen(result.value)).toBe(true)
  })

  test('verifies: CI-LD07 — last_listened_day が null でも null のまま写す', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('GET', STREAK_PATH, { ok: true, value: { ...STREAK_DTO, last_listened_day: null } })

    const result = await createLearningGateway(gateway).getListeningStreak()

    if (!result.ok) throw new Error('成功を期待した')
    expect(result.value.lastListenedDay).toBeNull()
  })
})

describe('createLearningGateway.getLearningDashboard (product-learn-09・product-learn-10・web-dec-169・web-dec-173)', () => {
  test('verifies: CI-LD07 — GET /users/me/learning-dashboard を 1 回呼び、全項目を camelCase に写し、gradedDay は全体の時刻の先頭 10 文字', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('GET', DASHBOARD_PATH, { ok: true, value: DASHBOARD_DTO })

    const result = await createLearningGateway(gateway).getLearningDashboard()

    expect(gateway.calls).toEqual([{ method: 'GET', path: DASHBOARD_PATH, body: undefined }])
    expect(result).toEqual({
      ok: true,
      value: {
        streak: { days: 5, todayListened: true, lastListenedDay: '2026-07-04' },
        totalEpisodes: 12,
        vocabularyAcquired: 7,
        currentDifficulty: 'toeic_600',
        weeklyGoal: {
          goalEpisodes: 5,
          completedThisWeek: 3,
          history: [{ week: '2026-W26', goal: 5, completed: 4 }],
        },
        monthly: [
          { month: '2026-06', activeDays: 3 },
          { month: '2026-07', activeDays: 4 },
        ],
        quiz: {
          quizzedEpisodes: 2,
          averageCorrectRate: 0.75,
          trend: [
            { gradedAt: '2026-07-05T00:00:00Z', gradedDay: '2026-07-05', correctRate: 0.5 },
            { gradedAt: '2026-07-06T09:30:00Z', gradedDay: '2026-07-06', correctRate: 1 },
          ],
        },
        achievements: [
          { id: 'first_listen', unlockedAt: '2026-07-01' },
          { id: 'streak_7', unlockedAt: '2026-07-03' },
        ],
      },
    })
  })

  test('verifies: CI-LD07 — 値は全階層が凍結済み（web-check-06）', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('GET', DASHBOARD_PATH, { ok: true, value: DASHBOARD_DTO })

    const result = await createLearningGateway(gateway).getLearningDashboard()

    if (!result.ok) throw new Error('成功を期待した')
    const notFrozen: string[] = []
    collectFrozen(result.value, 'dashboard', notFrozen)
    expect(notFrozen).toEqual([])
  })

  test('verifies: CI-LD07 — weekly_goal が無い応答は weeklyGoal: null で、ほかの項目は写る（節だけ非表示の現行の挙動を保つ）', async () => {
    const gateway = createGatewayDouble()
    const { weekly_goal: _omitted, ...withoutGoal } = DASHBOARD_DTO
    void _omitted
    gateway.respond('GET', DASHBOARD_PATH, { ok: true, value: withoutGoal })

    const result = await createLearningGateway(gateway).getLearningDashboard()

    if (!result.ok) throw new Error('成功を期待した')
    expect(result.value.weeklyGoal).toBeNull()
    expect(result.value.totalEpisodes).toBe(12)
    expect(result.value.achievements).toHaveLength(2)
  })

  test('verifies: CI-LD07 — weekly_goal が null の応答も weeklyGoal: null', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('GET', DASHBOARD_PATH, { ok: true, value: { ...DASHBOARD_DTO, weekly_goal: null } })

    const result = await createLearningGateway(gateway).getLearningDashboard()

    if (!result.ok) throw new Error('成功を期待した')
    expect(result.value.weeklyGoal).toBeNull()
  })
})

describe('createLearningGateway.getVocabularySummary (product-learn-10・web-dec-173)', () => {
  test('verifies: CI-LD07 — GET /vocabulary を 1 回呼び、count と全件を写す（registeredDay は先頭 10 文字、registeredAt は全体）。0 件も写る', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('GET', VOCAB_PATH, {
      ok: true,
      value: {
        vocabulary: [
          { ...VOCAB_ITEM('a'), registered_at: '2026-07-05T00:00:00Z' },
          { ...VOCAB_ITEM('b'), registered_at: '2026-07-06T12:00:00Z' },
        ],
        count: 2,
      },
    })

    const result = await createLearningGateway(gateway).getVocabularySummary()

    expect(gateway.calls).toEqual([{ method: 'GET', path: VOCAB_PATH, body: undefined }])
    expect(result).toEqual({
      ok: true,
      value: {
        count: 2,
        items: [
          { id: 'v-a', term: 'a', meaning: 'm', registeredAt: '2026-07-05T00:00:00Z', registeredDay: '2026-07-05' },
          { id: 'v-b', term: 'b', meaning: 'm', registeredAt: '2026-07-06T12:00:00Z', registeredDay: '2026-07-06' },
        ],
      },
    })
    if (!result.ok) throw new Error('成功を期待した')
    const notFrozen: string[] = []
    collectFrozen(result.value, 'summary', notFrozen)
    expect(notFrozen).toEqual([])

    gateway.respond('GET', VOCAB_PATH, { ok: true, value: { vocabulary: [], count: 0 } })
    expect(await createLearningGateway(gateway).getVocabularySummary()).toEqual({ ok: true, value: { count: 0, items: [] } })
  })
})

describe('createLearningGateway.countDueTestItems (product-learn-10・web-dec-174)', () => {
  test('verifies: CI-LD07 — GET /vocabulary/test-session を 1 回呼び、items の件数（0 件と 2 件）だけを返す', async () => {
    const gateway = createGatewayDouble()
    const item = { vocabulary_id: 'v', term: 't', meaning: 'm', example: 'e', distractors: ['x'] }
    gateway.respond('GET', TEST_SESSION_PATH, { ok: true, value: { items: [item, item] } })

    const two = await createLearningGateway(gateway).countDueTestItems()
    gateway.respond('GET', TEST_SESSION_PATH, { ok: true, value: { items: [] } })
    const zero = await createLearningGateway(gateway).countDueTestItems()

    expect(gateway.calls.map((c) => [c.method, c.path])).toEqual([
      ['GET', TEST_SESSION_PATH],
      ['GET', TEST_SESSION_PATH],
    ])
    expect(two).toEqual({ ok: true, value: 2 })
    expect(zero).toEqual({ ok: true, value: 0 })
  })
})

describe('createLearningGateway.getDifficultySuggestion (product-learn-20・web-rule-learning-06)', () => {
  test('verifies: CI-LD07 — GET /users/me/difficulty-suggestion を 1 回呼び、hasSuggestion・suggested・reason だけに写す（current・direction は捨てる）。suggested null も保つ', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('GET', SUGGESTION_PATH, {
      ok: true,
      value: { has_suggestion: true, current: 'toeic_600', suggested: null, direction: null, reason: '最近の正答率が高いです' },
    })

    const result = await createLearningGateway(gateway).getDifficultySuggestion()

    expect(gateway.calls).toEqual([{ method: 'GET', path: SUGGESTION_PATH, body: undefined }])
    expect(result).toEqual({ ok: true, value: { hasSuggestion: true, suggested: null, reason: '最近の正答率が高いです' } })
    if (!result.ok) throw new Error('成功を期待した')
    expect(Object.keys(result.value).sort()).toEqual(['hasSuggestion', 'reason', 'suggested'])
  })
})

describe('createLearningGateway の新しい 5 メソッドの失敗 (web-dec-169)', () => {
  test('verifies: CI-LD07 — 失敗（!ok）の Result はそのまま返す（写像しない）', async () => {
    const gateway = createGatewayDouble()
    const learning = createLearningGateway(gateway)
    const failed = { ok: false, failure: { kind: 'network' } }

    expect(await learning.getListeningStreak()).toEqual(failed)
    expect(await learning.getLearningDashboard()).toEqual(failed)
    expect(await learning.getVocabularySummary()).toEqual(failed)
    expect(await learning.countDueTestItems()).toEqual(failed)
    expect(await learning.getDifficultySuggestion()).toEqual(failed)
  })
})
