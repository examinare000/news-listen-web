// Learning application の query: getRegisteredTerms は登録済みの語の集合を返し、失敗を素通しする（product-learn-05・product-learn-18）。
// gateway・既読の store は手書きの fake（infrastructure・helper を値で import しない）。
//
// RED 理由（実装前）: `@/lib/learning/application/queries` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createLearningQueries } from '@/lib/learning/application/queries'
import type { LearningGateway } from '@/lib/learning/application/ports'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

const STREAK = { days: 5, todayListened: true, lastListenedDay: '2026-07-04' }
const SNAPSHOT = {
  streak: STREAK,
  totalEpisodes: 12,
  vocabularyAcquired: 7,
  currentDifficulty: 'toeic_600',
  weeklyGoal: { goalEpisodes: 5, completedThisWeek: 3, history: [{ week: '2026-W26', goal: 5, completed: 4 }] },
  monthly: [{ month: '2026-07', activeDays: 4 }],
  quiz: { quizzedEpisodes: 2, averageCorrectRate: 0.75, trend: [{ gradedAt: '2026-07-05T00:00:00Z', gradedDay: '2026-07-05', correctRate: 0.5 }] },
  achievements: [
    { id: 'first', unlockedAt: '2026-07-01' },
    { id: 'second', unlockedAt: '2026-07-02' },
  ],
}
const SUMMARY = { count: 1, items: [{ id: 'v1', term: 't', meaning: 'm', registeredAt: '2026-07-05T00:00:00Z', registeredDay: '2026-07-05' }] }
const FAILURE: ApiFailure = { kind: 'network' }

// 戻りの Result を返す・reject する・同期 throw する、の 3 種の失敗と成功を 1 つの型で表す。
type Outcome<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'fail' }
  | { readonly kind: 'reject' }
  | { readonly kind: 'throw' }

function play<T>(outcome: Outcome<T>): Promise<Result<T, ApiFailure>> {
  if (outcome.kind === 'throw') throw new Error('sync throw')
  if (outcome.kind === 'reject') return Promise.reject(new Error('rejected'))
  return Promise.resolve(outcome.kind === 'ok' ? { ok: true, value: outcome.value } : { ok: false, failure: FAILURE })
}

function harness(
  listed: Result<ReadonlyArray<string>, ApiFailure> = { ok: true, value: [] },
  overrides: {
    streak?: Outcome<typeof STREAK>
    dashboard?: Outcome<typeof SNAPSHOT>
    summary?: Outcome<typeof SUMMARY>
    due?: Outcome<number>
    suggestion?: Outcome<{ hasSuggestion: boolean; suggested: 'toeic_600' | null; reason: string | null }>
    seen?: ReadonlyArray<string>
  } = {},
) {
  let listCalls = 0
  const calls: string[] = []
  const store: string[] = []
  const gateway: LearningGateway = {
    registerTerm: () => Promise.resolve({ ok: true, value: undefined }),
    submitQuiz: () => Promise.resolve({ ok: true, value: { correct: 0, total: 0, results: [] } }),
    listRegisteredTerms: () => {
      listCalls += 1
      return Promise.resolve(listed)
    },
    getListeningStreak: () => {
      calls.push('getListeningStreak')
      return play(overrides.streak ?? { kind: 'ok', value: STREAK })
    },
    getLearningDashboard: () => {
      calls.push('getLearningDashboard')
      return play(overrides.dashboard ?? { kind: 'ok', value: SNAPSHOT })
    },
    getVocabularySummary: () => {
      calls.push('getVocabularySummary')
      return play(overrides.summary ?? { kind: 'ok', value: SUMMARY })
    },
    countDueTestItems: () => {
      calls.push('countDueTestItems')
      return play(overrides.due ?? { kind: 'ok', value: 2 })
    },
    getDifficultySuggestion: () => {
      calls.push('getDifficultySuggestion')
      return play(overrides.suggestion ?? { kind: 'ok', value: { hasSuggestion: true, suggested: 'toeic_600', reason: 'r' } })
    },
  }
  const seenAchievements = {
    read: () => new Set(overrides.seen ?? []),
    write: (ids: ReadonlyArray<string>) => {
      store.push(`write:${ids.join(',')}`)
    },
    clear: () => {
      store.push('clear')
    },
  }
  return { queries: createLearningQueries({ gateway, seenAchievements }), listCount: () => listCalls, calls, store }
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

describe('getStreak (web-query-learning-03・web-dec-175・product-learn-02)', () => {
  test.each([
    { name: '前の値が null（初回）', previous: null, expected: false },
    { name: '前の値が 4 日で今回 5 日（増えた）', previous: { days: 4, todayListened: true, lastListenedDay: '2026-07-03' }, expected: true },
    { name: '前の値が 5 日で今回 5 日（同値）', previous: { days: 5, todayListened: true, lastListenedDay: '2026-07-04' }, expected: false },
  ])('verifies: CI-LD08 — $name は justIncreased=$expected。値は凍結済みの camelCase 4 項目', async ({ previous, expected }) => {
    const { queries, calls } = harness()

    const view = await queries.getStreak(previous)

    expect(view).toEqual({ days: 5, todayListened: true, lastListenedDay: '2026-07-04', justIncreased: expected })
    expect(Object.isFrozen(view)).toBe(true)
    expect(calls).toEqual(['getListeningStreak'])
  })

  test.each(['fail', 'reject', 'throw'] as const)('verifies: CI-LD08 — 取得の失敗（%s）は null で、reject しない', async (kind) => {
    const { queries } = harness(undefined, { streak: { kind } })

    await expect(queries.getStreak({ days: 4, todayListened: true, lastListenedDay: null })).resolves.toBeNull()
  })
})

describe('getDashboard (web-query-learning-06・web-dec-174・product-learn-04・product-learn-09・product-learn-10)', () => {
  type Kind = 'ok' | 'fail' | 'reject' | 'throw'
  const COMBOS = [
    { dashboard: 'ok', summary: 'ok', due: 'ok' },
    { dashboard: 'fail', summary: 'ok', due: 'ok' },
    { dashboard: 'ok', summary: 'fail', due: 'ok' },
    { dashboard: 'ok', summary: 'ok', due: 'fail' },
    { dashboard: 'fail', summary: 'fail', due: 'ok' },
    { dashboard: 'ok', summary: 'reject', due: 'throw' },
    { dashboard: 'reject', summary: 'ok', due: 'ok' },
    { dashboard: 'throw', summary: 'fail', due: 'reject' },
  ] as const satisfies ReadonlyArray<Record<'dashboard' | 'summary' | 'due', Kind>>

  test.each(COMBOS)('verifies: CI-LD09 — 3 つの取得の成否 $dashboard / $summary / $due は、失敗した slot だけが null（独立）で、reject しない', async (combo) => {
    const { queries } = harness(undefined, {
      dashboard: combo.dashboard === 'ok' ? { kind: 'ok', value: SNAPSHOT } : { kind: combo.dashboard },
      summary: combo.summary === 'ok' ? { kind: 'ok', value: SUMMARY } : { kind: combo.summary },
      due: combo.due === 'ok' ? { kind: 'ok', value: 0 } : { kind: combo.due },
    })

    const result = await queries.getDashboard()

    expect(result.dashboard === null).toBe(combo.dashboard !== 'ok')
    expect(result.vocabulary === null).toBe(combo.summary !== 'ok')
    // 0 件は本当に 0 件で、null（取れなかった）と区別する。
    expect(result.dueTestCount).toBe(combo.due === 'ok' ? 0 : null)
  })

  test('verifies: CI-LD09 — 既読 {first} に対し achievements [first, second] の newlyUnlocked は [second]。ほかの項目は snapshot のまま', async () => {
    const { queries } = harness(undefined, { seen: ['first'] })

    const result = await queries.getDashboard()

    expect(result.dashboard).toEqual({ ...SNAPSHOT, newlyUnlocked: ['second'] })
    expect(result.vocabulary).toEqual(SUMMARY)
  })

  test('verifies: CI-LD09 — 本体が取れなかった回は newlyUnlocked を作らない（dashboard は null）', async () => {
    const { queries } = harness(undefined, { dashboard: { kind: 'fail' }, seen: [] })

    expect((await queries.getDashboard()).dashboard).toBeNull()
  })

  test('verifies: CI-LD09 — 3 つの取得は、どれかの完了を待つ前に全部呼び始める（並行）', async () => {
    const started: string[] = []
    const releases: Array<() => void> = []
    const hold = <T,>(name: string, value: T) =>
      new Promise<Result<T, ApiFailure>>((resolve) => {
        started.push(name)
        releases.push(() => resolve({ ok: true, value }))
      })
    const gateway: LearningGateway = {
      registerTerm: () => Promise.resolve({ ok: true, value: undefined }),
      submitQuiz: () => Promise.resolve({ ok: true, value: { correct: 0, total: 0, results: [] } }),
      listRegisteredTerms: () => Promise.resolve({ ok: true, value: [] }),
      getListeningStreak: () => Promise.resolve({ ok: true, value: STREAK }),
      getLearningDashboard: () => hold('dashboard', SNAPSHOT),
      getVocabularySummary: () => hold('summary', SUMMARY),
      countDueTestItems: () => hold('due', 1),
      getDifficultySuggestion: () => Promise.resolve({ ok: true, value: { hasSuggestion: false, suggested: null, reason: null } }),
    }
    const queries = createLearningQueries({
      gateway,
      seenAchievements: { read: () => new Set<string>() },
    })

    const pending = queries.getDashboard()
    // 最初の await が 1 つも解決されていない時点で、3 つとも始まっている。
    await Promise.resolve()
    expect(started.sort()).toEqual(['dashboard', 'due', 'summary'])
    for (const release of releases) release()
    await expect(pending).resolves.toMatchObject({ dueTestCount: 1 })
  })

  test('verifies: CI-LD09・CI-LD12 — 読むだけで、既読の write・clear を呼ばない', async () => {
    const { queries, store } = harness(undefined, { seen: [] })

    await queries.getDashboard()

    expect(store).toEqual([])
  })
})

describe('getDifficultySuggestion (web-query-learning-05・web-rule-learning-06・product-learn-20)', () => {
  test('verifies: CI-LD10 — 提案あり（suggested null でも）は { suggested, reason } の凍結済みの値', async () => {
    const { queries } = harness(undefined, { suggestion: { kind: 'ok', value: { hasSuggestion: true, suggested: null, reason: '理由' } } })

    const view = await queries.getDifficultySuggestion()

    expect(view).toEqual({ suggested: null, reason: '理由' })
    expect(Object.isFrozen(view)).toBe(true)
  })

  test('verifies: CI-LD10 — 提案なし（hasSuggestion=false）は null', async () => {
    const { queries } = harness(undefined, { suggestion: { kind: 'ok', value: { hasSuggestion: false, suggested: null, reason: null } } })

    await expect(queries.getDifficultySuggestion()).resolves.toBeNull()
  })

  test.each(['fail', 'reject', 'throw'] as const)('verifies: CI-LD10 — 取得の失敗（%s）も null で、reject しない', async (kind) => {
    const { queries } = harness(undefined, { suggestion: { kind } })

    await expect(queries.getDifficultySuggestion()).resolves.toBeNull()
  })
})
