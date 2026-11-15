// @vitest-environment node
// Learning の command / query の分離（web-check-07）。本 slice の分: web-cmd-learning-03・04、web-query-learning-04。
// (a) LearningCommands の入口 = registerTerm・submitQuiz、LearningQueries の入口 = getRegisteredTerms。実行時の key の集合が過不足なく一致する。
// (b) 呼出を記録する手書きの LearningGateway の fake を渡し、query を全部呼んでも記録は listRegisteredTerms だけ（書き込み系は 0 回）。
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
import type { LearningGateway } from '@/lib/learning/application/ports'
import type * as LearningReadModels from '@/lib/learning/application/readModels'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

type QueryNames = 'getRegisteredTerms'
type CommandNames = 'registerTerm' | 'submitQuiz'

/** 呼ばない。型検査だけが読む。 */
function typeProbes(): void {
  // (c) 正の行: submitQuiz の戻り値は Promise<Result<QuizReceipt, ApiFailure>>
  const submit: Equals<ReturnType<LearningCommands['submitQuiz']>, Promise<Result<QuizReceipt, ApiFailure>>> = true
  // 入口の名前の集合と deps は gateway だけ
  const commandKeys: Equals<keyof LearningCommands, CommandNames> = true
  const queryKeys: Equals<keyof LearningQueries, QueryNames> = true
  const commandDepKeys: Equals<keyof Parameters<typeof createLearningCommands>[0], 'gateway'> = true
  const queryDepKeys: Equals<keyof Parameters<typeof createLearningQueries>[0], 'gateway'> = true
  // (c) 否定の行: QuizReceipt は readModels の export でない（re-export を足すと TS2578 で typecheck が落ちる）
  // @ts-expect-error web-check-07 (c): QuizReceipt は readModels の export でない
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- 型エラーの行を lint が any と解釈する（readModels に QuizReceipt が無い）
  const fromReadModels: LearningReadModels.QuizReceipt | null = null
  void [submit, commandKeys, queryKeys, commandDepKeys, queryDepKeys, fromReadModels]
}

const WRITE_CALLS = ['registerTerm', 'submitQuiz']

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
  }
  return { calls, commands: createLearningCommands({ gateway }), queries: createLearningQueries({ gateway }) }
}

describe('web-check-07 (a) command と query の入口は過不足なく公開される', () => {
  test('verifies: CI-LN06 (web-cmd-learning-03・web-cmd-learning-04) — command の key は registerTerm・submitQuiz の 2 つだけで、どちらも関数', () => {
    const { commands } = harness()
    const names: readonly CommandNames[] = ['registerTerm', 'submitQuiz']

    expect(Object.keys(commands).sort()).toEqual([...names].sort())
    for (const name of names) expect(typeof commands[name], name).toBe('function')
  })

  test('verifies: CI-LN06 — command の生成だけでは gateway を呼ばない', () => {
    const { calls } = harness()

    expect(calls).toEqual([])
  })

  test('verifies: CI-LN10 (web-query-learning-04) — query の key は getRegisteredTerms の 1 つだけで、関数', () => {
    const { queries } = harness()

    expect(Object.keys(queries)).toEqual(['getRegisteredTerms'])
    expect(typeof queries.getRegisteredTerms).toBe('function')
  })
})

describe('web-check-07 (b) query を全部呼んでも、gateway への呼出は読み取りだけ', () => {
  test('verifies: CI-LN10 — query を全部呼ぶと記録は listRegisteredTerms だけで、書き込み系は 0 回', async () => {
    const { queries, calls } = harness()

    await queries.getRegisteredTerms()

    expect(calls).toEqual(['listRegisteredTerms'])
    for (const write of WRITE_CALLS) expect(calls).not.toContain(write)
  })

  test('verifies: CI-LN10 — 正方向対照: command を呼べば書き込み系 2 つが記録される（記録が配線されている）', async () => {
    const { commands, calls } = harness()

    await commands.registerTerm('p1', 'apple')
    await commands.submitQuiz('p1', [0])

    expect([...calls].sort()).toEqual([...WRITE_CALLS].sort())
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
