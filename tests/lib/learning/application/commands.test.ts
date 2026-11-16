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
    getListeningStreak: () => Promise.resolve({ ok: true, value: { days: 0, todayListened: false, lastListenedDay: null } }),
    getLearningDashboard: () => Promise.reject(new Error('unused')),
    getVocabularySummary: () => Promise.resolve({ ok: true, value: { count: 0, items: [] } }),
    countDueTestItems: () => Promise.resolve({ ok: true, value: 0 }),
    getDifficultySuggestion: () => Promise.resolve({ ok: true, value: { hasSuggestion: false, suggested: null, reason: null } }),
  }
  const seenAchievements = {
    read: (): ReadonlySet<string> => new Set<string>(),
    write: (): void => undefined,
    clear: (): void => undefined,
  }
  return { commands: createLearningCommands({ gateway, seenAchievements }), calls }
}

// 既読の store は手書きの fake（infrastructure・@/lib/platform を値で import しない）。read と write の呼出を記録する。
function seenHarness(stored: ReadonlyArray<string>) {
  const log: string[] = []
  const written: Array<ReadonlyArray<string>> = []
  const gateway: LearningGateway = {
    registerTerm: () => Promise.resolve({ ok: true, value: undefined }),
    submitQuiz: () => Promise.resolve({ ok: true, value: { correct: 0, total: 0, results: [] } }),
    listRegisteredTerms: () => Promise.resolve({ ok: true, value: [] }),
    getListeningStreak: () => Promise.resolve({ ok: true, value: { days: 0, todayListened: false, lastListenedDay: null } }),
    getLearningDashboard: () => Promise.reject(new Error('unused')),
    getVocabularySummary: () => Promise.resolve({ ok: true, value: { count: 0, items: [] } }),
    countDueTestItems: () => Promise.resolve({ ok: true, value: 0 }),
    getDifficultySuggestion: () => Promise.resolve({ ok: true, value: { hasSuggestion: false, suggested: null, reason: null } }),
  }
  const seenAchievements = {
    read: (): ReadonlySet<string> => {
      log.push('read')
      return new Set(stored)
    },
    write: (ids: ReadonlyArray<string>): void => {
      log.push('write')
      written.push([...ids])
    },
    clear: (): void => {
      log.push('clear')
    },
  }
  return { commands: createLearningCommands({ gateway, seenAchievements }), log, written }
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

describe('markAchievementsSeen (web-cmd-learning-05・web-rule-learning-05・ADR-086)', () => {
  test('verifies: CI-LD11 — 保存済みの既読（保存順）に、新しい id を ids の順で続けて 1 回書く（ids の中の重複と既読済みは足さない）', async () => {
    const { commands, written, log } = seenHarness(['x', 'y'])

    await commands.markAchievementsSeen(['z', 'x', 'w', 'z'])

    expect(written).toEqual([['x', 'y', 'z', 'w']])
    // read 1 回 → write 1 回の順
    expect(log).toEqual(['read', 'write'])
  })

  test('verifies: CI-LD11 — 同じ引数でもう 1 回呼んでも、書く値は 1 回目と同じ（冪等）。新しい id だけで上書きしない', async () => {
    // store は呼ぶたびに同じ既読 ['x','y'] を返す fake なので、2 回目も同じ値になる。
    const { commands, written } = seenHarness(['x', 'y'])

    await commands.markAchievementsSeen(['z', 'x', 'w', 'z'])
    await commands.markAchievementsSeen(['z', 'x', 'w', 'z'])

    expect(written).toEqual([
      ['x', 'y', 'z', 'w'],
      ['x', 'y', 'z', 'w'],
    ])
    expect(written[0]).not.toEqual(['z', 'w'])
  })

  test('verifies: CI-LD11 — 既読が空なら ids をそのまま（初出順で）書く。空の ids でも reject しない', async () => {
    const { commands, written } = seenHarness([])

    await commands.markAchievementsSeen(['a', 'b'])
    await expect(commands.markAchievementsSeen([])).resolves.toBeUndefined()

    expect(written).toEqual([['a', 'b'], []])
  })
})
