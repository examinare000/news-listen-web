// @vitest-environment node
// Learning の command / query の分離（web-check-07）。本 slice の分: web-cmd-learning-03・04・05、web-query-learning-03・04・05・06。
// (a) LearningCommands の入口 = registerTerm・submitQuiz・markAchievementsSeen、LearningQueries の入口 = getRegisteredTerms・getStreak・getDashboard・
//     getDifficultySuggestion。実行時の key の集合が過不足なく一致する。deps は gateway・seenAchievements（query は読み取りだけの型）。
// (b) 呼出を記録する手書きの LearningGateway・SeenAchievementsStore の fake を渡し、query を全部呼んでも gateway の書き込み系と
//     既読の write・clear の記録は 0 回。
// (c) submitQuiz の戻り値は QuizReceipt（commands.ts の型）で、readModels.ts は QuizReceipt を export しない。型の等価・否定は
//     `npm run typecheck` / `npm run typecheck:ts7` が検査する（使われない `@ts-expect-error` は TS2578 で落ちる）。実行時の検査は vitest が行う。
// createLearningGateway・createGatewayDouble・readModels は値で import しない（unit が infrastructure を値で import すると禁止依存になる。
// `import type` は subject の照合に数えない）。名前空間の import は必ず `import type * as` と書く（`import * as` は値の import になる）。
//
// RED 理由（実装前）: `@/lib/learning/application/commands`（createLearningCommands）が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createLearningCommands } from '@/lib/learning/application/commands'
import type { LearningCommands, QuizReceipt } from '@/lib/learning/application/commands'
import { createLearningQueries } from '@/lib/learning/application/queries'
import type { LearningQueries } from '@/lib/learning/application/queries'
import type { LearningGateway, SeenAchievementsStore } from '@/lib/learning/application/ports'
import type * as LearningReadModels from '@/lib/learning/application/readModels'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

type QueryNames = 'getRegisteredTerms' | 'getStreak' | 'getDashboard' | 'getDifficultySuggestion'
type CommandNames = 'registerTerm' | 'submitQuiz' | 'markAchievementsSeen'

/** 呼ばない。型検査だけが読む。 */
function typeProbes(): void {
  // (c) 正の行: submitQuiz の戻り値は Promise<Result<QuizReceipt, ApiFailure>>
  const submit: Equals<ReturnType<LearningCommands['submitQuiz']>, Promise<Result<QuizReceipt, ApiFailure>>> = true
  // 入口の名前の集合と deps は gateway だけ
  const commandKeys: Equals<keyof LearningCommands, CommandNames> = true
  const queryKeys: Equals<keyof LearningQueries, QueryNames> = true
  const commandDepKeys: Equals<keyof Parameters<typeof createLearningCommands>[0], 'gateway' | 'seenAchievements'> = true
  const queryDepKeys: Equals<keyof Parameters<typeof createLearningQueries>[0], 'gateway' | 'seenAchievements'> = true
  // query の既読の deps は読み取りだけ（web-check-07）。command は書き込みを含む SeenAchievementsStore
  const querySeen: Equals<Parameters<typeof createLearningQueries>[0]['seenAchievements'], Pick<SeenAchievementsStore, 'read'>> = true
  const commandSeen: Equals<Parameters<typeof createLearningCommands>[0]['seenAchievements'], SeenAchievementsStore> = true
  // (c) 否定の行: QuizReceipt は readModels の export でない（re-export を足すと TS2578 で typecheck が落ちる）
  // @ts-expect-error web-check-07 (c): QuizReceipt は readModels の export でない
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- 型エラーの行を lint が any と解釈する（readModels に QuizReceipt が無い）
  const fromReadModels: LearningReadModels.QuizReceipt | null = null
  void [submit, commandKeys, queryKeys, commandDepKeys, queryDepKeys, querySeen, commandSeen, fromReadModels]
}

const WRITE_CALLS = ['registerTerm', 'submitQuiz', 'seen.write', 'seen.clear']

function harness() {
  const calls: string[] = []
  const gateway: LearningGateway = {
    registerTerm: () => {
      calls.push('registerTerm')
      return Promise.resolve({ ok: true, value: undefined })
    },
    submitQuiz: () => {
      calls.push('submitQuiz')
      return Promise.resolve({
        ok: true,
        value: { correct: 1, total: 2, results: [{ questionIndex: 0, selectedIndex: 0, correctIndex: 0, isCorrect: true }] },
      })
    },
    listRegisteredTerms: () => {
      calls.push('listRegisteredTerms')
      return Promise.resolve({ ok: true, value: ['a'] })
    },
    getListeningStreak: () => {
      calls.push('getListeningStreak')
      return Promise.resolve({ ok: true, value: { days: 1, todayListened: true, lastListenedDay: '2026-07-04' } })
    },
    getLearningDashboard: () => {
      calls.push('getLearningDashboard')
      return Promise.resolve({
        ok: true,
        value: {
          streak: { days: 1, todayListened: true, lastListenedDay: '2026-07-04' },
          totalEpisodes: 1,
          vocabularyAcquired: 1,
          currentDifficulty: 'toeic_600',
          weeklyGoal: null,
          monthly: [],
          quiz: { quizzedEpisodes: 0, averageCorrectRate: null, trend: [] },
          achievements: [{ id: 'first', unlockedAt: '2026-07-01' }],
        },
      })
    },
    getVocabularySummary: () => {
      calls.push('getVocabularySummary')
      return Promise.resolve({ ok: true, value: { count: 0, items: [] } })
    },
    countDueTestItems: () => {
      calls.push('countDueTestItems')
      return Promise.resolve({ ok: true, value: 0 })
    },
    getDifficultySuggestion: () => {
      calls.push('getDifficultySuggestion')
      return Promise.resolve({ ok: true, value: { hasSuggestion: true, suggested: null, reason: 'r' } })
    },
  }
  // 既読の store は手書きの fake（infrastructure を値で import しない）。write・clear の呼出を記録する。
  const seenAchievements: SeenAchievementsStore = {
    read: () => {
      calls.push('seen.read')
      return new Set<string>()
    },
    write: () => {
      calls.push('seen.write')
    },
    clear: () => {
      calls.push('seen.clear')
    },
  }
  return {
    calls,
    commands: createLearningCommands({ gateway, seenAchievements }),
    queries: createLearningQueries({ gateway, seenAchievements }),
  }
}

describe('web-check-07 (a) command と query の入口は過不足なく公開される', () => {
  test('verifies: CI-LN06・CI-LD12 (web-cmd-learning-03・04・05) — command の key は registerTerm・submitQuiz・markAchievementsSeen の 3 つだけで、どれも関数', () => {
    const { commands } = harness()
    const names: readonly CommandNames[] = ['registerTerm', 'submitQuiz', 'markAchievementsSeen']

    expect(Object.keys(commands).sort()).toEqual([...names].sort())
    for (const name of names) expect(typeof commands[name], name).toBe('function')
  })

  test('verifies: CI-LN06 — command の生成だけでは gateway を呼ばない', () => {
    const { calls } = harness()

    expect(calls).toEqual([])
  })

  test('verifies: CI-LN10・CI-LD12 (web-query-learning-03・04・05・06) — query の key は getRegisteredTerms・getStreak・getDashboard・getDifficultySuggestion の 4 つだけで、どれも関数', () => {
    const { queries } = harness()
    const names: readonly QueryNames[] = ['getRegisteredTerms', 'getStreak', 'getDashboard', 'getDifficultySuggestion']

    expect(Object.keys(queries).sort()).toEqual([...names].sort())
    for (const name of names) expect(typeof queries[name], name).toBe('function')
  })
})

describe('web-check-07 (b) query を全部呼んでも、gateway への呼出は読み取りだけ', () => {
  test('verifies: CI-LN10・CI-LD12 — query を全部呼んでも、gateway の書き込み系と既読の write・clear の記録は 0 回（読みは記録される）', async () => {
    const { queries, calls } = harness()

    await queries.getRegisteredTerms()
    await queries.getStreak(null)
    await queries.getDashboard()
    await queries.getDifficultySuggestion()

    expect(calls).toContain('listRegisteredTerms')
    expect(calls).toContain('getLearningDashboard')
    expect(calls).toContain('seen.read')
    for (const write of WRITE_CALLS) expect(calls).not.toContain(write)
  })

  test('verifies: CI-LN10・CI-LD12 — 正方向対照: command を呼べば書き込み 3 つ（registerTerm・submitQuiz・既読の write）が記録される（記録が配線されている）', async () => {
    const { commands, calls } = harness()

    await commands.registerTerm('p1', 'apple')
    await commands.submitQuiz('p1', [0])
    await commands.markAchievementsSeen(['a'])

    expect(calls).toContain('registerTerm')
    expect(calls).toContain('submitQuiz')
    expect(calls).toContain('seen.write')
    expect(calls).not.toContain('seen.clear')
  })
})

describe('web-check-07 (c) command の戻り値は receipt で、合否を持たない', () => {
  test('verifies: CI-LN08・CI-LN09・CI-LN24 — 型検査（QuizReceipt は commands.ts の型で readModels の export でない）と、実行時の receipt の key が correct・total・results だけで passed を持たない', async () => {
    expect(typeof typeProbes).toBe('function')
    const { commands } = harness()

    const result = await commands.submitQuiz('p1', [0])

    if (!result.ok) throw new Error('成功を期待した')
    expect(Object.keys(result.value).sort()).toEqual(['correct', 'results', 'total'])
    expect(result.value).not.toHaveProperty('passed')
  })
})
