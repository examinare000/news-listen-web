// Learning domain の単語テスト: 状態機械と規則（web-rule-learning-03・web-rule-learning-07・product-learn-06・web-dec-155）。
// 純関数だけ。乱数（shuffle）は引数で受け、timer・application は持たない。

/** 1 回の出題の語数の上限（打ち切り）。 */
export const MAX_ITEMS = 10

/** 選択肢に使う誤答の数の上限。 */
const MAX_DISTRACTORS = 3

export interface VocabularyTestWord {
  readonly vocabularyId: string
  readonly term: string
  readonly meaning: string
  readonly example: string
  readonly distractors: ReadonlyArray<string>
}

export interface VocabularyTestAnswer {
  readonly vocabularyId: string
  readonly selfKnown: boolean
  readonly retestCorrect: boolean | null
}

export interface VocabularyTestSummary {
  readonly knownCount: number
  readonly retestCount: number
  readonly retestCorrectCount: number
}

export type RetestFeedback = { readonly kind: 'correct' } | { readonly kind: 'incorrect'; readonly correctMeaning: string }

type Flags = Readonly<Record<string, boolean>>
type Shuffle = (choices: ReadonlyArray<string>) => ReadonlyArray<string>

export type VocabularyTestState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'empty' }
  | {
      readonly phase: 'self-assessment'
      readonly words: ReadonlyArray<VocabularyTestWord>
      readonly index: number
      readonly assessments: Flags
    }
  | {
      readonly phase: 'retest'
      readonly words: ReadonlyArray<VocabularyTestWord>
      readonly assessments: Flags
      readonly retestWords: ReadonlyArray<VocabularyTestWord>
      /** 再テストの語ごとの選択肢。入る時に確定し、以降の事象で作り直さない。 */
      readonly choices: ReadonlyArray<ReadonlyArray<string>>
      readonly index: number
      readonly retestResults: Flags
      readonly locked: boolean
      readonly feedback: RetestFeedback | null
    }
  | { readonly phase: 'submitting'; readonly answers: ReadonlyArray<VocabularyTestAnswer> }
  | { readonly phase: 'result'; readonly summary: VocabularyTestSummary }
  | { readonly phase: 'error'; readonly reason: 'load' }
  | { readonly phase: 'error'; readonly reason: 'submit'; readonly answers: ReadonlyArray<VocabularyTestAnswer> }

export type VocabularyTestEvent =
  | { readonly type: 'loadRequested' }
  | { readonly type: 'loaded'; readonly words: ReadonlyArray<VocabularyTestWord> }
  | { readonly type: 'loadFailed' }
  | { readonly type: 'assessed'; readonly known: boolean; readonly shuffle: Shuffle }
  | { readonly type: 'retestAnswered'; readonly choice: string }
  | { readonly type: 'retestAdvanced' }
  | { readonly type: 'submitRequested' }
  | { readonly type: 'submitSucceeded' }
  | { readonly type: 'submitFailed' }

export function initialState(): VocabularyTestState {
  return Object.freeze({ phase: 'loading' })
}

/** 候補は [meaning, 誤答の先頭 3 つ]。2 未満なら shuffle せずそのまま返す。重複は除かない。 */
export function choicesFor(word: VocabularyTestWord, shuffle: Shuffle): ReadonlyArray<string> {
  const candidates = [word.meaning, ...word.distractors.slice(0, MAX_DISTRACTORS)]
  return candidates.length < 2 ? candidates : shuffle(candidates)
}

/** 出題の順に 1 語 1 件。既知は retestCorrect: null、未知は再テストの正誤（未回答は false）。 */
export function buildResult(
  words: ReadonlyArray<VocabularyTestWord>,
  assessments: Flags,
  retestResults: Flags,
): ReadonlyArray<VocabularyTestAnswer> {
  return words.map((word) => {
    const selfKnown = assessments[word.vocabularyId] === true
    return { vocabularyId: word.vocabularyId, selfKnown, retestCorrect: selfKnown ? null : (retestResults[word.vocabularyId] ?? false) }
  })
}

export function summarize(answers: ReadonlyArray<VocabularyTestAnswer>): VocabularyTestSummary {
  return {
    knownCount: answers.filter((a) => a.selfKnown).length,
    retestCount: answers.filter((a) => a.retestCorrect !== null).length,
    retestCorrectCount: answers.filter((a) => a.retestCorrect === true).length,
  }
}

// 入れ子の object・配列まで凍結する。引数から受け取った値は呼び手が複製してから渡す。
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function copyWord(word: VocabularyTestWord): VocabularyTestWord {
  return { ...word, distractors: [...word.distractors] }
}

function toSubmitting(
  words: ReadonlyArray<VocabularyTestWord>,
  assessments: Flags,
  retestResults: Flags,
): VocabularyTestState {
  return deepFreeze({ phase: 'submitting', answers: buildResult(words, assessments, retestResults) })
}

function assess(
  state: Extract<VocabularyTestState, { phase: 'self-assessment' }>,
  known: boolean,
  shuffle: Shuffle,
): VocabularyTestState {
  const current = state.words[state.index]
  const assessments = { ...state.assessments, [current.vocabularyId]: known }
  if (state.index + 1 < state.words.length) {
    return deepFreeze({ ...state, index: state.index + 1, assessments })
  }
  const retestWords = state.words.filter((word) => assessments[word.vocabularyId] !== true)
  if (retestWords.length === 0) return toSubmitting(state.words, assessments, {})
  return deepFreeze({
    phase: 'retest',
    words: state.words,
    assessments,
    retestWords,
    // shuffle の戻りは呼び手の配列かもしれないので複製してから凍結する。
    choices: retestWords.map((word) => [...choicesFor(word, shuffle)]),
    index: 0,
    retestResults: {},
    locked: false,
    feedback: null,
  })
}

function answerRetest(state: Extract<VocabularyTestState, { phase: 'retest' }>, choice: string): VocabularyTestState {
  const word = state.retestWords[state.index]
  const correct = choice === word.meaning
  return deepFreeze({
    ...state,
    retestResults: { ...state.retestResults, [word.vocabularyId]: correct },
    locked: true,
    feedback: correct ? { kind: 'correct' } : { kind: 'incorrect', correctMeaning: word.meaning },
  })
}

function advanceRetest(state: Extract<VocabularyTestState, { phase: 'retest' }>): VocabularyTestState {
  if (state.index + 1 < state.retestWords.length) {
    return deepFreeze({ ...state, index: state.index + 1, locked: false, feedback: null })
  }
  return toSubmitting(state.words, state.assessments, state.retestResults)
}

/** 受け付ける組は常に新しい object を返し、受け付けない組は同じ state（同一参照）を返す。 */
export function reduce(state: VocabularyTestState, event: VocabularyTestEvent): VocabularyTestState {
  switch (event.type) {
    case 'loadRequested':
      if (state.phase === 'loading' || state.phase === 'result' || (state.phase === 'error' && state.reason === 'load')) {
        return initialState()
      }
      return state
    case 'loaded': {
      if (state.phase !== 'loading') return state
      const words = event.words.slice(0, MAX_ITEMS).map(copyWord)
      if (words.length === 0) return deepFreeze({ phase: 'empty' })
      return deepFreeze({ phase: 'self-assessment', words, index: 0, assessments: {} })
    }
    case 'loadFailed':
      return state.phase === 'loading' ? deepFreeze({ phase: 'error', reason: 'load' }) : state
    case 'assessed':
      return state.phase === 'self-assessment' ? assess(state, event.known, event.shuffle) : state
    case 'retestAnswered':
      return state.phase === 'retest' && !state.locked ? answerRetest(state, event.choice) : state
    case 'retestAdvanced':
      return state.phase === 'retest' && state.locked ? advanceRetest(state) : state
    case 'submitRequested':
      return state.phase === 'error' && state.reason === 'submit'
        ? deepFreeze({ phase: 'submitting', answers: state.answers })
        : state
    case 'submitSucceeded':
      return state.phase === 'submitting' ? deepFreeze({ phase: 'result', summary: summarize(state.answers) }) : state
    case 'submitFailed':
      return state.phase === 'submitting' ? deepFreeze({ phase: 'error', reason: 'submit', answers: state.answers }) : state
  }
}
