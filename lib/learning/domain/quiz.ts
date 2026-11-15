// Learning domain の quiz: 送信可否・合否・全問正解（web-rule-learning-02・product-learn-19）。
// application を import しない（web-dep-01）。呼び手の receipt は QuizScore を構造的に満たす。

export interface QuizScore {
  readonly correct: number
  readonly total: number
}

export interface QuizAttempt {
  readonly questionCount: number
  /** 設問順の回答（選んだ option の添字）。未回答は undefined。 */
  readonly answers: ReadonlyArray<number | undefined>
}

/** 全問に回答したときだけ送れる。 */
export function canSubmit(attempt: QuizAttempt): boolean {
  return Array.from({ length: attempt.questionCount }).every((_, i) => attempt.answers[i] !== undefined)
}

/** 正答率 0.5 以上で合格。total が 0 なら不合格。 */
export function passed(score: QuizScore): boolean {
  return score.total > 0 && score.correct / score.total >= 0.5
}

/** 全問正解（total が 0 なら true）。 */
export function isPerfect(score: QuizScore): boolean {
  return score.correct === score.total
}
