// Learning domain の単語テスト: 状態機械 reduce・選択肢・結果の組立て・要約（product-learn-06・web-rule-learning-03・web-rule-learning-07・web-dec-155・web-dec-156）。
//
// RED 理由（実装前）: `@/lib/learning/domain/vocabularyTest` が無い（module not found）。
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  MAX_ITEMS,
  buildResult,
  choicesFor,
  initialState,
  reduce,
  summarize,
  type VocabularyTestEvent,
  type VocabularyTestState,
  type VocabularyTestWord,
} from '@/lib/learning/domain/vocabularyTest'

const identity = (choices: ReadonlyArray<string>): ReadonlyArray<string> => choices

function word(n: number, distractorCount = 3): VocabularyTestWord {
  return {
    vocabularyId: `v${n}`,
    term: `term${n}`,
    meaning: `meaning${n}`,
    example: `example${n}`,
    distractors: Array.from({ length: distractorCount }, (_, i) => `wrong${n}-${i + 1}`),
  }
}

function words(count: number): VocabularyTestWord[] {
  return Array.from({ length: count }, (_, i) => word(i + 1))
}

function run(state: VocabularyTestState, ...events: VocabularyTestEvent[]): VocabularyTestState {
  return events.reduce(reduce, state)
}

const loadRequested: VocabularyTestEvent = { type: 'loadRequested' }
const loadFailed: VocabularyTestEvent = { type: 'loadFailed' }
const retestAdvanced: VocabularyTestEvent = { type: 'retestAdvanced' }
const submitRequested: VocabularyTestEvent = { type: 'submitRequested' }
const submitSucceeded: VocabularyTestEvent = { type: 'submitSucceeded' }
const submitFailed: VocabularyTestEvent = { type: 'submitFailed' }
const loaded = (list: ReadonlyArray<VocabularyTestWord>): VocabularyTestEvent => ({ type: 'loaded', words: list })
const assessed = (known: boolean, shuffle = identity): VocabularyTestEvent => ({ type: 'assessed', known, shuffle })
const retestAnswered = (choice: string): VocabularyTestEvent => ({ type: 'retestAnswered', choice })

// 状態の fixture（9 種）。受け付ける組の入口を実際の遷移で作る。
const loadingState = initialState()
const emptyState = run(loadingState, loaded([]))
const selfAssessmentState = run(loadingState, loaded(words(2)))
const retestUnlockedState = run(selfAssessmentState, assessed(false), assessed(false))
const retestLockedState = run(retestUnlockedState, retestAnswered('meaning1'))
const submittingState = run(run(loadingState, loaded(words(1))), assessed(true))
const resultState = run(submittingState, submitSucceeded)
const loadErrorState = run(loadingState, loadFailed)
const submitErrorState = run(submittingState, submitFailed)

const FIXTURES: ReadonlyArray<readonly [string, VocabularyTestState]> = [
  ['loading', loadingState],
  ['empty', emptyState],
  ['self-assessment', selfAssessmentState],
  ['retest (unlocked)', retestUnlockedState],
  ['retest (locked)', retestLockedState],
  ['submitting', submittingState],
  ['result', resultState],
  ['error (load)', loadErrorState],
  ['error (submit)', submitErrorState],
]

const EVENTS: ReadonlyArray<readonly [string, VocabularyTestEvent]> = [
  ['loadRequested', loadRequested],
  ['loaded', loaded(words(2))],
  ['loadFailed', loadFailed],
  ['assessed', assessed(true)],
  ['retestAnswered', retestAnswered('meaning1')],
  ['retestAdvanced', retestAdvanced],
  ['submitRequested', submitRequested],
  ['submitSucceeded', submitSucceeded],
  ['submitFailed', submitFailed],
]

// 受け付ける 11 組: [fixture 名, 事象名, 結果の phase]
const ACCEPTED: ReadonlyArray<readonly [string, string, string]> = [
  ['loading', 'loadRequested', 'loading'],
  ['result', 'loadRequested', 'loading'],
  ['error (load)', 'loadRequested', 'loading'],
  ['loading', 'loaded', 'self-assessment'],
  ['loading', 'loadFailed', 'error'],
  ['self-assessment', 'assessed', 'self-assessment'],
  ['retest (unlocked)', 'retestAnswered', 'retest'],
  ['retest (locked)', 'retestAdvanced', 'retest'],
  ['error (submit)', 'submitRequested', 'submitting'],
  ['submitting', 'submitSucceeded', 'result'],
  ['submitting', 'submitFailed', 'error'],
]

const fixtureOf = (name: string): VocabularyTestState => FIXTURES.find(([n]) => n === name)![1]
const eventOf = (name: string): VocabularyTestEvent => EVENTS.find(([n]) => n === name)![1]

function isDeepFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true
  if (!Object.isFrozen(value)) return false
  return Object.values(value).every(isDeepFrozen)
}

// retest に入った state の answers を観測するため、最後まで進めて submitting の回答を返す。
function answersAfterRetest(state: VocabularyTestState, choices: ReadonlyArray<string>): ReadonlyArray<unknown> {
  let current = state
  for (const choice of choices) current = run(current, retestAnswered(choice), retestAdvanced)
  if (current.phase !== 'submitting') throw new Error(`expected submitting, got ${current.phase}`)
  return current.answers
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('reduce の遷移の表（product-learn-06・web-dec-155）', () => {
  test('verifies: CI-VT01 — fixture の phase が想定どおり（表の前提）', () => {
    expect(FIXTURES.map(([, s]) => s.phase)).toEqual([
      'loading',
      'empty',
      'self-assessment',
      'retest',
      'retest',
      'submitting',
      'result',
      'error',
      'error',
    ])
    expect(loadErrorState.phase === 'error' && loadErrorState.reason).toBe('load')
    expect(submitErrorState.phase === 'error' && submitErrorState.reason).toBe('submit')
  })

  test.each(ACCEPTED)(
    'verifies: CI-VT01 — product-learn-06 受け付ける組（%s × %s）は引数と別の object で %s へ進む',
    (stateName, eventName, expectedPhase) => {
      const state = fixtureOf(stateName)
      const next = reduce(state, eventOf(eventName))

      expect(next).not.toBe(state)
      expect(next.phase).toBe(expectedPhase)
    },
  )

  test('verifies: CI-VT01 — product-learn-06 受け付ける組は 11、残りの 70 組はすべて同一参照を返す', () => {
    const acceptedKeys = new Set(ACCEPTED.map(([s, e]) => `${s}|${e}`))
    expect(ACCEPTED).toHaveLength(11)
    expect(FIXTURES.length * EVENTS.length).toBe(81)

    const rejected = FIXTURES.flatMap(([stateName, state]) =>
      EVENTS.filter(([eventName]) => !acceptedKeys.has(`${stateName}|${eventName}`)).map(
        ([eventName, event]) => [stateName, eventName, state, event] as const,
      ),
    )
    expect(rejected).toHaveLength(70)

    for (const [stateName, eventName, state, event] of rejected) {
      expect(reduce(state, event), `${stateName} × ${eventName}`).toBe(state)
    }
  })

  test('verifies: CI-VT01 — loading × loadRequested は同じ値でも常に新しい object（web-dec-178）。繰り返しても毎回別の object', () => {
    const first = reduce(loadingState, loadRequested)
    const second = reduce(first, loadRequested)

    expect(first).not.toBe(loadingState)
    expect(first.phase).toBe('loading')
    expect(second).not.toBe(first)
  })

  test('verifies: CI-VT01 — 戻りは入れ子まで凍結され、引数の state・words・shuffle の戻りは凍結されず変更されない', () => {
    const inputWords = words(2)
    const shuffled = ['meaning1', 'wrong1-1']
    const snapshot = structuredClone(inputWords)
    const results = [
      reduce(loadingState, loadRequested),
      reduce(loadingState, loaded(inputWords)),
      reduce(selfAssessmentState, assessed(false, () => shuffled)),
      reduce(retestUnlockedState, retestAnswered('meaning1')),
      reduce(retestLockedState, retestAdvanced),
      reduce(submitErrorState, submitRequested),
      reduce(submittingState, submitSucceeded),
      reduce(submittingState, submitFailed),
      reduce(loadingState, loadFailed),
    ]

    for (const result of results) expect(isDeepFrozen(result), result.phase).toBe(true)
    expect(inputWords).toEqual(snapshot)
    expect(Object.isFrozen(inputWords)).toBe(false)
    for (const w of inputWords) {
      expect(Object.isFrozen(w)).toBe(false)
      expect(Object.isFrozen(w.distractors)).toBe(false)
    }
    expect(Object.isFrozen(shuffled)).toBe(false)
  })
})

describe('loaded: 打ち切り（CI-VT02・web-rule-learning-03）', () => {
  test('verifies: CI-VT02 — MAX_ITEMS は 10。12 語は先頭 10 語に打ち切る（11・12 語目は出ない）', () => {
    expect(MAX_ITEMS).toBe(10)
    const state = run(loadingState, loaded(words(12)))

    expect(state.phase).toBe('self-assessment')
    // 全語「知っている」と答えると、出題の 10 語がそのまま回答になる（11・12 語目の id は無い）。
    const submitting = run(state, ...Array.from({ length: 10 }, () => assessed(true)))
    expect(submitting.phase === 'submitting' && submitting.answers.map((a) => a.vocabularyId)).toEqual(
      Array.from({ length: 10 }, (_, i) => `v${i + 1}`),
    )
  })

  test('verifies: CI-VT02 — 0 語は empty', () => {
    expect(run(loadingState, loaded([])).phase).toBe('empty')
  })
})

describe('assessed: 再テストの対象と選択肢の確定（CI-VT03）', () => {
  test('verifies: CI-VT03 — 「知らない」と答えた語だけを出題の順に再テストする。選択肢は語ごとに 1 回だけ確定する', () => {
    const shuffleInputs: ReadonlyArray<string>[] = []
    const recording = (choices: ReadonlyArray<string>) => {
      shuffleInputs.push(choices)
      return choices
    }
    const state = run(
      loadingState,
      loaded(words(3)),
      assessed(true, recording),
      assessed(false, recording),
      assessed(false, recording),
    )

    expect(state.phase).toBe('retest')
    expect(state.phase === 'retest' && state.locked).toBe(false)
    expect(state.phase === 'retest' && state.feedback).toBeNull()
    // 再テストの語は 2・3 語目の順（語ごとに 1 回。計 2 回）。
    expect(shuffleInputs).toEqual([
      ['meaning2', 'wrong2-1', 'wrong2-2', 'wrong2-3'],
      ['meaning3', 'wrong3-1', 'wrong3-2', 'wrong3-3'],
    ])
    // 以降の事象では shuffle を呼ばない（確定済み）。
    shuffleInputs.length = 0
    run(state, retestAnswered('meaning2'), retestAdvanced, retestAnswered('meaning3'), retestAdvanced)
    expect(shuffleInputs).toEqual([])
    // 再テストの 1 語目の正解は meaning2（3 語目ではない）。
    const answers = answersAfterRetest(state, ['meaning2', 'meaning3'])
    expect(answers).toEqual([
      { vocabularyId: 'v1', selfKnown: true, retestCorrect: null },
      { vocabularyId: 'v2', selfKnown: false, retestCorrect: true },
      { vocabularyId: 'v3', selfKnown: false, retestCorrect: true },
    ])
  })

  test('verifies: CI-VT03 — 全語既知なら再テストせず submitting。回答は selfKnown: true・retestCorrect: null', () => {
    const state = run(loadingState, loaded(words(2)), assessed(true), assessed(true))

    expect(state.phase).toBe('submitting')
    expect(state.phase === 'submitting' && state.answers).toEqual([
      { vocabularyId: 'v1', selfKnown: true, retestCorrect: null },
      { vocabularyId: 'v2', selfKnown: true, retestCorrect: null },
    ])
  })
})

describe('retestAnswered・retestAdvanced（CI-VT04・CI-VT07）', () => {
  test('verifies: CI-VT04 — 正解を選ぶとロックし feedback が correct', () => {
    const state = reduce(retestUnlockedState, retestAnswered('meaning1'))

    expect(state.phase === 'retest' && state.locked).toBe(true)
    expect(state.phase === 'retest' && state.feedback).toEqual({ kind: 'correct' })
  })

  test('verifies: CI-VT04 — 誤答を選ぶとロックし feedback が incorrect（正解の meaning つき）', () => {
    const state = reduce(retestUnlockedState, retestAnswered('wrong1-1'))

    expect(state.phase === 'retest' && state.locked).toBe(true)
    expect(state.phase === 'retest' && state.feedback).toEqual({ kind: 'incorrect', correctMeaning: 'meaning1' })
  })

  test('verifies: CI-VT04 — 最後でない語の retestAdvanced は次の語へ進み、ロックと feedback を解く', () => {
    const next = reduce(retestLockedState, retestAdvanced)

    expect(next.phase).toBe('retest')
    expect(next.phase === 'retest' && next.locked).toBe(false)
    expect(next.phase === 'retest' && next.feedback).toBeNull()
    // 次の語（2 語目）に対して meaning2 が正解として記録される。
    const answered = reduce(next, retestAnswered('meaning2'))
    expect(answered.phase === 'retest' && answered.feedback).toEqual({ kind: 'correct' })
  })

  test('verifies: CI-VT04・CI-VT07 — 最後の語の retestAdvanced は submitting。回答は出題の順で既知 → null・正解 → true・不正解 → false', () => {
    const state = run(
      loadingState,
      loaded(words(3)),
      assessed(true),
      assessed(false),
      assessed(false),
      retestAnswered('meaning2'),
      retestAdvanced,
      retestAnswered('wrong3-1'),
      retestAdvanced,
    )

    expect(state.phase).toBe('submitting')
    expect(state.phase === 'submitting' && state.answers).toEqual([
      { vocabularyId: 'v1', selfKnown: true, retestCorrect: null },
      { vocabularyId: 'v2', selfKnown: false, retestCorrect: true },
      { vocabularyId: 'v3', selfKnown: false, retestCorrect: false },
    ])
  })
})

describe('loadRequested は前の回答・ロックを捨てる（B1・B2。CI-VT05・web-dec-156）', () => {
  test('verifies: CI-VT05 — 再テストを 1 周して result に至った後の再読み込みで、2 周目の retest はロック前・前回の正誤を持たない（B2）', () => {
    // 1 周目: ロックを経て result へ。
    const firstRound = run(
      loadingState,
      loaded(words(2)),
      assessed(false),
      assessed(false),
      retestAnswered('meaning1'),
      retestAdvanced,
      retestAnswered('wrong2-1'),
      retestAdvanced,
      submitSucceeded,
    )
    expect(firstRound.phase).toBe('result')

    const secondRetest = run(firstRound, loadRequested, loaded(words(2)), assessed(false), assessed(false))

    expect(secondRetest.phase).toBe('retest')
    expect(secondRetest.phase === 'retest' && secondRetest.locked).toBe(false)
    expect(secondRetest.phase === 'retest' && secondRetest.feedback).toBeNull()
    // 前回の正誤を持ち越さない: 2 周目で誤答だけ答えると、全件 false（前回 v1 の true が残らない）。
    const answers = answersAfterRetest(secondRetest, ['wrong1-1', 'wrong2-1'])
    expect(answers).toEqual([
      { vocabularyId: 'v1', selfKnown: false, retestCorrect: false },
      { vocabularyId: 'v2', selfKnown: false, retestCorrect: false },
    ])
  })

  test('verifies: CI-VT05 — error(load) → loadRequested → loadFailed は再び error(load)（B1）', () => {
    const state = run(loadErrorState, loadRequested, loadFailed)

    expect(state.phase).toBe('error')
    expect(state.phase === 'error' && state.reason).toBe('load')
  })
})

describe('choicesFor（CI-VT06・web-rule-learning-03）', () => {
  test('verifies: CI-VT06 — 誤答 4 つのとき [meaning, 先頭 3 つ] を shuffle に渡し、その戻りを返す', () => {
    const w = { ...word(1), distractors: ['a', 'b', 'c', 'd'] }
    const passed: ReadonlyArray<string>[] = []
    const shuffle = (choices: ReadonlyArray<string>) => {
      passed.push(choices)
      return ['reordered']
    }

    expect(choicesFor(w, shuffle)).toEqual(['reordered'])
    expect(passed).toEqual([['meaning1', 'a', 'b', 'c']])
  })

  test('verifies: CI-VT06 — 誤答 0 のとき [meaning] を返し、shuffle を呼ばない', () => {
    const shuffle = vi.fn(identity)

    expect(choicesFor(word(1, 0), shuffle)).toEqual(['meaning1'])
    expect(shuffle).not.toHaveBeenCalled()
  })

  test.each([1, 2])('verifies: CI-VT06 — 誤答 %i つのとき shuffle を 1 回呼ぶ', (count) => {
    const shuffle = vi.fn(identity)

    const choices = choicesFor(word(1, count), shuffle)

    expect(shuffle).toHaveBeenCalledTimes(1)
    expect(choices).toHaveLength(count + 1)
  })

  test('verifies: CI-VT06 — meaning と同じ誤答・誤答どうしの重複は除かない（現物のまま）', () => {
    const w = { ...word(1), distractors: ['meaning1', 'x', 'x'] }

    expect(choicesFor(w, identity)).toEqual(['meaning1', 'meaning1', 'x', 'x'])
  })
})

describe('buildResult（CI-VT07・web-rule-learning-07）', () => {
  test('verifies: CI-VT07 — 既知は retestCorrect: null、未知は再テストの正誤。結果の無い未知の語は false。出題の順', () => {
    const list = words(4)

    expect(buildResult(list, { v1: true, v2: false, v3: false, v4: false }, { v2: true, v3: false })).toEqual([
      { vocabularyId: 'v1', selfKnown: true, retestCorrect: null },
      { vocabularyId: 'v2', selfKnown: false, retestCorrect: true },
      { vocabularyId: 'v3', selfKnown: false, retestCorrect: false },
      { vocabularyId: 'v4', selfKnown: false, retestCorrect: false },
    ])
  })

  test('verifies: CI-VT07 — 既知の語に再テストの結果があっても retestCorrect は null', () => {
    expect(buildResult([word(1)], { v1: true }, { v1: true })).toEqual([
      { vocabularyId: 'v1', selfKnown: true, retestCorrect: null },
    ])
  })
})

describe('summarize（CI-VT08）', () => {
  test.each([
    ['全語既知', [{ k: true }, { k: true }], { knownCount: 2, retestCount: 0, retestCorrectCount: 0 }],
    ['全問不正解', [{ k: false, c: false }, { k: false, c: false }], { knownCount: 0, retestCount: 2, retestCorrectCount: 0 }],
    ['混在', [{ k: true }, { k: false, c: true }, { k: false, c: false }], { knownCount: 1, retestCount: 2, retestCorrectCount: 1 }],
  ] as const)('verifies: CI-VT08 — %s', (_name, rows, expected) => {
    const answers = rows.map((r, i) => ({
      vocabularyId: `v${i}`,
      selfKnown: r.k,
      retestCorrect: r.k ? null : (r as { c: boolean }).c,
    }))

    expect(summarize(answers)).toEqual(expected)
  })

  test('verifies: CI-VT08 — submitSucceeded の result は回答の summarize を持つ', () => {
    const state = run(
      loadingState,
      loaded(words(2)),
      assessed(true),
      assessed(false),
      retestAnswered('meaning2'),
      retestAdvanced,
      submitSucceeded,
    )

    expect(state.phase === 'result' && state.summary).toEqual({ knownCount: 1, retestCount: 1, retestCorrectCount: 1 })
  })
})

describe('domain は乱数・timer を持たない（CI-VT09 (d)）', () => {
  test('verifies: CI-VT09 — reduce・choicesFor・buildResult・summarize の一巡で Math.random が 0 回・timer が 0 件', () => {
    const random = vi.spyOn(Math, 'random')
    vi.useFakeTimers()

    for (const [, state] of FIXTURES) for (const [, event] of EVENTS) reduce(state, event)
    const finalState = run(
      loadingState,
      loaded(words(3)),
      assessed(false),
      assessed(false),
      assessed(false),
      retestAnswered('meaning1'),
      retestAdvanced,
      retestAnswered('wrong2-1'),
      retestAdvanced,
      retestAnswered('meaning3'),
      retestAdvanced,
      submitSucceeded,
    )
    choicesFor(word(1), identity)
    buildResult(words(2), { v1: true, v2: false }, {})
    summarize([{ vocabularyId: 'v1', selfKnown: true, retestCorrect: null }])

    expect(finalState.phase).toBe('result')
    expect(random).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
