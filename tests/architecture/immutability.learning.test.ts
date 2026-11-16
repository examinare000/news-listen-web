// @vitest-environment node
// Learning の query の戻り値の不変性（web-check-06 の観点 2・3）。getRegisteredTerms の成功の値は凍結済みの Set で、呼ぶたびに別の object。
// getStreak・getDashboard・getDifficultySuggestion の成功の値は、入れ子の object・配列・要素まで凍結済みで、呼ぶたびに別の object。
// 既読の store の不変性は adapter の seenAchievementsStore.test.ts に置く（unit が infrastructure を値で import すると web-check-08 が落ちる）。
// `Set` は凍結しても `add` が throw しないので、観点 2 は `Object.isFrozen` で判定する。
// gateway は手書きの fake（infrastructure・helper を値で import しない）。
//
// RED 理由（実装前）: `@/lib/learning/application/queries` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createLearningQueries } from '@/lib/learning/application/queries'
import { createVocabularyTestSession } from '@/lib/learning/application/vocabularyTestSession'
import type { LearningGateway, SeenAchievementsStore } from '@/lib/learning/application/ports'

function queriesFor(terms: ReadonlyArray<string>) {
  const gateway: LearningGateway = {
    registerTerm: () => Promise.resolve({ ok: true, value: undefined }),
    submitQuiz: () => Promise.resolve({ ok: true, value: { correct: 0, total: 0, results: [] } }),
    listRegisteredTerms: () => Promise.resolve({ ok: true, value: terms }),
    getListeningStreak: () => Promise.resolve({ ok: true, value: { days: 0, todayListened: false, lastListenedDay: null } }),
    getLearningDashboard: () => Promise.reject(new Error('unused')),
    getVocabularySummary: () => Promise.resolve({ ok: true, value: { count: 0, items: [] } }),
    countDueTestItems: () => Promise.resolve({ ok: true, value: 0 }),
    getDifficultySuggestion: () => Promise.resolve({ ok: true, value: { hasSuggestion: false, suggested: null, reason: null } }),
    getVocabularyTestSession: () => Promise.resolve({ ok: true, value: [] }),
    submitVocabularyTestResults: () => Promise.resolve({ ok: true, value: undefined }),
  }
  return createLearningQueries({ gateway, seenAchievements: unusedSeen })
}

// 既読の store は手書きの fake（infrastructure を値で import しない）。
const unusedSeen: Pick<SeenAchievementsStore, 'read'> = { read: () => new Set<string>() }

function collectNotFrozen(value: unknown, path: string, found: string[]): void {
  if (typeof value !== 'object' || value === null) return
  if (!Object.isFrozen(value)) found.push(path)
  for (const [key, child] of Object.entries(value)) collectNotFrozen(child, `${path}.${key}`, found)
}

function richQueries() {
  const gateway: LearningGateway = {
    registerTerm: () => Promise.resolve({ ok: true, value: undefined }),
    submitQuiz: () => Promise.resolve({ ok: true, value: { correct: 0, total: 0, results: [] } }),
    listRegisteredTerms: () => Promise.resolve({ ok: true, value: [] }),
    getListeningStreak: () => Promise.resolve({ ok: true, value: { days: 5, todayListened: true, lastListenedDay: '2026-07-04' } }),
    getLearningDashboard: () =>
      Promise.resolve({
        ok: true,
        value: {
          streak: { days: 5, todayListened: true, lastListenedDay: '2026-07-04' },
          totalEpisodes: 1,
          vocabularyAcquired: 1,
          currentDifficulty: 'toeic_600',
          weeklyGoal: { goalEpisodes: 5, completedThisWeek: 3, history: [{ week: '2026-W26', goal: 5, completed: 4 }] },
          monthly: [{ month: '2026-07', activeDays: 4 }],
          quiz: { quizzedEpisodes: 1, averageCorrectRate: 0.5, trend: [{ gradedAt: '2026-07-05T00:00:00Z', gradedDay: '2026-07-05', correctRate: 0.5 }] },
          achievements: [{ id: 'first', unlockedAt: '2026-07-01' }],
        },
      }),
    getVocabularySummary: () =>
      Promise.resolve({
        ok: true,
        value: { count: 1, items: [{ id: 'v1', term: 't', meaning: 'm', registeredAt: '2026-07-05T00:00:00Z', registeredDay: '2026-07-05' }] },
      }),
    countDueTestItems: () => Promise.resolve({ ok: true, value: 3 }),
    getDifficultySuggestion: () => Promise.resolve({ ok: true, value: { hasSuggestion: true, suggested: null, reason: 'r' } }),
    getVocabularyTestSession: () =>
      Promise.resolve({
        ok: true,
        value: [
          { vocabularyId: 'v1', term: 't1', meaning: 'm1', example: 'e1', distractors: ['a', 'b', 'c'] },
          { vocabularyId: 'v2', term: 't2', meaning: 'm2', example: 'e2', distractors: ['d'] },
        ],
      }),
    submitVocabularyTestResults: () => Promise.resolve({ ok: true, value: undefined }),
  }
  return createLearningQueries({ gateway, seenAchievements: { read: () => new Set<string>() } })
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

describe('web-check-06 getStreak・getDashboard・getDifficultySuggestion の不変性 (web-query-learning-03・05・06)', () => {
  test('verifies: CI-LD12 — getStreak の成功の値は凍結済みで、呼ぶたびに別の object（中身は等しい）', async () => {
    const queries = richQueries()

    const first = await queries.getStreak(null)
    const second = await queries.getStreak(null)

    expect(first).not.toBeNull()
    const notFrozen: string[] = []
    collectNotFrozen(first, 'streak', notFrozen)
    expect(notFrozen).toEqual([])
    expect(first).not.toBe(second)
    expect(first).toEqual(second)
  })

  test('verifies: CI-LD12 — getDashboard の戻りと各値は、入れ子の object・配列・要素まで凍結済みで、呼ぶたびに別の object（中身は等しい）', async () => {
    const queries = richQueries()

    const first = await queries.getDashboard()
    const second = await queries.getDashboard()

    const notFrozen: string[] = []
    collectNotFrozen(first, 'result', notFrozen)
    expect(first.dashboard).not.toBeNull()
    expect(first.vocabulary).not.toBeNull()
    expect(notFrozen).toEqual([])
    expect(first).not.toBe(second)
    expect(first.dashboard).not.toBe(second.dashboard)
    expect(first.vocabulary).not.toBe(second.vocabulary)
    expect(first).toEqual(second)
  })

  test('verifies: CI-LD12 — getDifficultySuggestion の成功の値は凍結済みで、呼ぶたびに別の object', async () => {
    const queries = richQueries()

    const first = await queries.getDifficultySuggestion()
    const second = await queries.getDifficultySuggestion()

    expect(first).not.toBeNull()
    expect(Object.isFrozen(first)).toBe(true)
    expect(first).not.toBe(second)
    expect(first).toEqual(second)
  })

  test('verifies: CI-LD12 — 1 回目の dashboard を書き換えようとしても、2 回目の値は影響を受けない', async () => {
    const queries = richQueries()

    const first = await queries.getDashboard()
    try {
      ;(first.dashboard!.achievements as unknown as Array<unknown>).push({ id: 'x', unlockedAt: 'x' })
      ;(first.dashboard as unknown as { totalEpisodes: number }).totalEpisodes = 999
    } catch {
      // 凍結で throw する実装（strict mode）でも、2 回目に影響しないことだけを観測する
    }
    const second = await queries.getDashboard()

    expect(second.dashboard!.achievements).toEqual([{ id: 'first', unlockedAt: '2026-07-01' }])
    expect(second.dashboard!.totalEpisodes).toBe(1)
  })
})

describe('web-check-06 getVocabularyTestSession の不変性 (product-learn-06・web-query-learning-01)', () => {
  test('verifies: CI-VT11 — 成功の値と要素・distractors は凍結済みで、呼ぶたびに別の配列（中身は等しい）', async () => {
    const queries = richQueries()

    const first = await queries.getVocabularyTestSession()
    const second = await queries.getVocabularyTestSession()

    if (!first.ok || !second.ok) throw new Error('成功を期待した')
    const notFrozen: string[] = []
    collectNotFrozen(first.value, 'words', notFrozen)
    expect(notFrozen).toEqual([])
    expect(first.value).not.toBe(second.value)
    expect(first.value).toEqual(second.value)
  })
})

describe('web-check-06 vocabularyTestView の不変性 (product-learn-06・web-query-learning-02)', () => {
  const words = [
    { vocabularyId: 'v1', term: 't1', meaning: 'm1', example: 'e1', distractors: ['a', 'b', 'c'] },
    { vocabularyId: 'v2', term: 't2', meaning: 'm2', example: 'e2', distractors: ['d'] },
  ]
  function sessionOverWords() {
    return createVocabularyTestSession({
      queries: { getVocabularyTestSession: () => Promise.resolve({ ok: true, value: words }) },
      gateway: { submitVocabularyTestResults: () => Promise.resolve({ ok: true, value: undefined }) },
      wait: () => new Promise<void>(() => undefined),
      shuffle: (choices) => choices,
    })
  }

  test('verifies: CI-VT18 — self-assessment・retest（ロック中）・result の view は入れ子（choices・progress・retestFeedback・summary）まで凍結済み', async () => {
    const session = sessionOverWords()
    await session.startVocabularyTest()
    const selfAssessment = session.vocabularyTestView()
    await session.assessVocabulary(false)
    await session.assessVocabulary(false)
    void session.answerRetest('m1')
    const lockedRetest = session.vocabularyTestView()

    for (const view of [selfAssessment, lockedRetest]) {
      const notFrozen: string[] = []
      collectNotFrozen(view, view.phase, notFrozen)
      expect(notFrozen, view.phase).toEqual([])
    }
    expect(lockedRetest.phase).toBe('retest')
    expect(lockedRetest.retestFeedback).toEqual({ kind: 'correct' })
  })

  test('verifies: CI-VT18 — view をキャストして書き換えようとしても、次の読みは変わらない', async () => {
    const session = sessionOverWords()
    await session.startVocabularyTest()
    const before = session.vocabularyTestView()
    const snapshot = structuredClone(before)

    try {
      ;(before as { currentTerm: string | null }).currentTerm = 'tampered'
    } catch {
      // 凍結された object への代入が strict mode で throw してもよい（どちらでも次の読みは変わらない）。
    }
    try {
      ;(before.progress as { position: number } | null)!.position = 99
    } catch {
      // 同上。
    }

    expect(session.vocabularyTestView()).toEqual(snapshot)
    expect(session.vocabularyTestView().currentTerm).toBe('t1')
  })
})
