// 主体 = backend の user_id（ADR-104 決定 6）。形式の検査はこのファイルにだけ置く。
// 形式不正・欠落は userId: null（主体別の資産を使えない。shared-leave-10）。

export interface Subject {
  readonly userId: string | null
}

const USER_ID_FORMAT = /^[A-Za-z0-9_-]+$/

export function subjectOf(userId: unknown): Subject {
  return Object.freeze({
    userId: typeof userId === 'string' && USER_ID_FORMAT.test(userId) ? userId : null,
  })
}
