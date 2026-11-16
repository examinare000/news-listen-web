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
