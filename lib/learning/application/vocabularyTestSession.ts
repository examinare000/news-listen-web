// 単語テストの session（web-cmd-learning-01・02・06・07・web-query-learning-02・web-dec-154・web-dec-178）。
// 状態は closure が持ち、reduce の結果だけで更新する（遷移の規則は domain）。待ち（wait）と乱数（shuffle）は composition root が渡す。
import { initialState, reduce, type VocabularyTestState } from '@/lib/learning/domain/vocabularyTest'
import type { LearningGateway, VocabularyTestAnswerRecord } from '@/lib/learning/application/ports'
import type { LearningQueries } from '@/lib/learning/application/queries'
import type { VocabularyTestView } from '@/lib/learning/application/readModels'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

/** 再テストの回答の後、次の語へ進むまでの合図の時間。 */
const FEEDBACK_DURATION_MS = 800

export interface VocabularyTestSession {
  readonly startVocabularyTest: () => Promise<Result<void, ApiFailure>>
  readonly assessVocabulary: (known: boolean) => Promise<Result<void, ApiFailure>>
  readonly answerRetest: (choice: string) => Promise<Result<void, ApiFailure>>
  readonly submitVocabularyTest: () => Promise<Result<void, ApiFailure>>
  readonly vocabularyTestView: () => VocabularyTestView
  /** state が変わったときだけ呼ぶ。解除関数を返す。 */
  readonly subscribe: (listener: () => void) => () => void
  /** 保留中の待ちと応答を無効にする。dispose の後の呼出は通常どおり動く。 */
  readonly dispose: () => void
}

export interface VocabularyTestSessionDeps {
  readonly queries: Pick<LearningQueries, 'getVocabularyTestSession'>
  readonly gateway: Pick<LearningGateway, 'submitVocabularyTestResults'>
  readonly wait: (ms: number) => Promise<void>
  readonly shuffle: (choices: ReadonlyArray<string>) => ReadonlyArray<string>
}

const OK: Result<void, ApiFailure> = Object.freeze({ ok: true, value: undefined })

function toView(state: VocabularyTestState): VocabularyTestView {
  const base: VocabularyTestView = {
    phase: state.phase,
    errorReason: state.phase === 'error' ? state.reason : null,
    currentTerm: null,
    currentExample: null,
    progress: null,
    choices: [],
    isAnswerLocked: false,
    retestFeedback: null,
    summary: state.phase === 'result' ? { ...state.summary } : null,
  }
  if (state.phase === 'self-assessment') {
    const word = state.words[state.index]
    return {
      ...base,
      currentTerm: word.term,
      currentExample: word.example,
      progress: { position: state.index + 1, total: state.words.length },
    }
  }
  if (state.phase === 'retest') {
    return {
      ...base,
      currentTerm: state.retestWords[state.index].term,
      progress: { position: state.index + 1, total: state.retestWords.length },
      choices: [...state.choices[state.index]],
      isAnswerLocked: state.locked,
      retestFeedback: state.feedback === null ? null : { ...state.feedback },
    }
  }
  return base
}

// 入れ子の object・配列まで凍結する（view は呼び手へ渡す前に凍結する。web-check-06）。
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

export function createVocabularyTestSession({ queries, gateway, wait, shuffle }: VocabularyTestSessionDeps): VocabularyTestSession {
  let state = initialState()
  let view = deepFreeze(toView(state))
  // 応答・待ちは出した時点の世代を持ち、戻った時に世代が違えば state を変えない。
  let epoch = 0
  const listeners = new Set<() => void>()

  function apply(next: VocabularyTestState): void {
    if (next === state) return
    state = next
    view = deepFreeze(toView(state))
    for (const listener of [...listeners]) listener()
  }

  async function send(answers: ReadonlyArray<VocabularyTestAnswerRecord>): Promise<Result<void, ApiFailure>> {
    const mine = epoch
    const result = await gateway.submitVocabularyTestResults(answers)
    if (mine === epoch) apply(reduce(state, { type: result.ok ? 'submitSucceeded' : 'submitFailed' }))
    return result.ok ? OK : { ok: false, failure: result.failure }
  }

  return {
    async startVocabularyTest() {
      const next = reduce(state, { type: 'loadRequested' })
      if (next === state) return OK
      epoch += 1
      const mine = epoch
      apply(next)
      const result = await queries.getVocabularyTestSession()
      if (mine === epoch) {
        apply(reduce(state, result.ok ? { type: 'loaded', words: result.value } : { type: 'loadFailed' }))
      }
      return result.ok ? OK : { ok: false, failure: result.failure }
    },
    async assessVocabulary(known) {
      const next = reduce(state, { type: 'assessed', known, shuffle })
      if (next === state) return OK
      apply(next)
      return next.phase === 'submitting' ? send(next.answers) : OK
    },
    async answerRetest(choice) {
      const next = reduce(state, { type: 'retestAnswered', choice })
      if (next === state) return OK
      const mine = epoch
      apply(next)
      await wait(FEEDBACK_DURATION_MS)
      if (mine !== epoch) return OK
      const advanced = reduce(state, { type: 'retestAdvanced' })
      apply(advanced)
      return advanced.phase === 'submitting' ? send(advanced.answers) : OK
    },
    async submitVocabularyTest() {
      const next = reduce(state, { type: 'submitRequested' })
      if (next.phase !== 'submitting' || next === state) return OK
      apply(next)
      return send(next.answers)
    },
    vocabularyTestView: () => view,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      epoch += 1
    },
  }
}
