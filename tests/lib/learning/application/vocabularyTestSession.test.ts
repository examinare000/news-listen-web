// Learning application の単語テスト session: 状態の所有・800ms の待ち・送信・世代による古い応答の破棄（product-learn-06・web-cmd-learning-01・02・06・07・web-query-learning-02・web-dec-154・web-dec-178）。
// queries・gateway・wait・shuffle は手書きの fake（domain・infrastructure・helper を値で import しない）。
//
// RED 理由（実装前）: `@/lib/learning/application/vocabularyTestSession` が無い（module not found）。
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createVocabularyTestSession } from '@/lib/learning/application/vocabularyTestSession'
import type { VocabularyTestAnswerRecord, VocabularyTestWordRecord } from '@/lib/learning/application/ports'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

const NETWORK: ApiFailure = { kind: 'network' }
const OK: Result<void, ApiFailure> = { ok: true, value: undefined }

function words(count: number, distractors = 3): VocabularyTestWordRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    vocabularyId: `v${i + 1}`,
    term: `term${i + 1}`,
    meaning: `meaning${i + 1}`,
    example: `example${i + 1}`,
    distractors: Array.from({ length: distractors }, (_, j) => `wrong${i + 1}-${j + 1}`),
  }))
}

interface Deferred<T> {
  readonly resolve: (value: T) => void
}

function harness() {
  const fetches: Array<Deferred<Result<ReadonlyArray<VocabularyTestWordRecord>, ApiFailure>>> = []
  const submits: Array<{ readonly body: ReadonlyArray<VocabularyTestAnswerRecord> } & Deferred<Result<void, ApiFailure>>> = []
  const waits: Array<{ readonly ms: number } & Deferred<void>> = []
  const shuffled: ReadonlyArray<string>[] = []

  const session = createVocabularyTestSession({
    queries: {
      getVocabularyTestSession: () =>
        new Promise((resolve) => {
          fetches.push({ resolve })
        }),
    },
    gateway: {
      submitVocabularyTestResults: (body) =>
        new Promise((resolve) => {
          submits.push({ body, resolve })
        }),
    },
    wait: (ms) =>
      new Promise<void>((resolve) => {
        waits.push({ ms, resolve })
      }),
    shuffle: (choices) => {
      shuffled.push(choices)
      return choices
    },
  })

  const ok = (value: ReadonlyArray<VocabularyTestWordRecord>): Result<ReadonlyArray<VocabularyTestWordRecord>, ApiFailure> => ({ ok: true, value })

  /** 取得を始めて、その応答を直ちに成功で返す。 */
  async function start(list: ReadonlyArray<VocabularyTestWordRecord>) {
    const pending = session.startVocabularyTest()
    fetches[fetches.length - 1].resolve(ok(list))
    return pending
  }

  /** 全語を自己評価して再テストに入る（全語「知らない」）。 */
  async function toRetest(list: ReadonlyArray<VocabularyTestWordRecord>) {
    await start(list)
    for (let i = 0; i < list.length; i += 1) await session.assessVocabulary(false)
  }

  /** 1 語を「知っている」と答えて送信を保留した状態（submitting）。 */
  async function toSubmitting() {
    await start(words(1))
    // Promise を直接返すと async 関数が待ってしまうので、object に包む。
    return { pending: session.assessVocabulary(true) }
  }

  async function toSubmitError() {
    const { pending } = await toSubmitting()
    submits[submits.length - 1].resolve({ ok: false, failure: NETWORK })
    await pending
  }

  return { session, fetches, submits, waits, shuffled, ok, start, toRetest, toSubmitting, toSubmitError }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('createVocabularyTestSession の公開面（CI-VT12）', () => {
  test('verifies: CI-VT12 — product-learn-06 key は 7 つだけで、生成だけでは deps を呼ばない', () => {
    const { session, fetches, submits, waits, shuffled } = harness()

    expect(Object.keys(session).sort()).toEqual(
      ['answerRetest', 'assessVocabulary', 'dispose', 'startVocabularyTest', 'submitVocabularyTest', 'subscribe', 'vocabularyTestView'].sort(),
    )
    expect([fetches.length, submits.length, waits.length, shuffled.length]).toEqual([0, 0, 0, 0])
  })
})

describe('startVocabularyTest（CI-VT13・web-cmd-learning-01）', () => {
  test('verifies: CI-VT13・CI-VT18 — 初期の view は loading。3 語の取得成功で self-assessment（currentTerm・currentExample・progress 1/3）', async () => {
    const { session, start } = harness()
    expect(session.vocabularyTestView().phase).toBe('loading')

    const result = await start(words(3))

    expect(result).toEqual({ ok: true, value: undefined })
    expect(session.vocabularyTestView()).toMatchObject({
      phase: 'self-assessment',
      errorReason: null,
      currentTerm: 'term1',
      currentExample: 'example1',
      progress: { position: 1, total: 3 },
      choices: [],
      isAnswerLocked: false,
      retestFeedback: null,
      summary: null,
    })
  })

  test('verifies: CI-VT13 — 0 語は empty', async () => {
    const { session, start } = harness()

    await start([])

    expect(session.vocabularyTestView().phase).toBe('empty')
  })

  test('verifies: CI-VT13 — 取得の失敗は同じ失敗の Result を返し、view は error（errorReason load）', async () => {
    const { session, fetches } = harness()

    const pending = session.startVocabularyTest()
    fetches[0].resolve({ ok: false, failure: NETWORK })

    expect(await pending).toEqual({ ok: false, failure: NETWORK })
    expect(session.vocabularyTestView()).toMatchObject({ phase: 'error', errorReason: 'load', currentTerm: null })
  })

  test('verifies: CI-VT13 — 受け付けない state（self-assessment・retest・submitting・empty・error(submit)）では request を出さず { ok: true }、view は同じ参照', async () => {
    const states: ReadonlyArray<readonly [string, () => Promise<ReturnType<typeof harness>>]> = [
      ['self-assessment', async () => { const h = harness(); await h.start(words(2)); return h }],
      ['retest', async () => { const h = harness(); await h.toRetest(words(2)); return h }],
      ['submitting', async () => { const h = harness(); await h.toSubmitting(); return h }],
      ['empty', async () => { const h = harness(); await h.start([]); return h }],
      ['error(submit)', async () => { const h = harness(); await h.toSubmitError(); return h }],
    ]

    for (const [name, build] of states) {
      const h = await build()
      const fetchCount = h.fetches.length
      const view = h.session.vocabularyTestView()

      const result = await h.session.startVocabularyTest()

      expect(h.fetches.length, name).toBe(fetchCount)
      expect(result, name).toEqual({ ok: true, value: undefined })
      expect(h.session.vocabularyTestView(), name).toBe(view)
    }
  })
})

describe('assessVocabulary と送信（CI-VT14・CI-VT16）', () => {
  test('verifies: CI-VT14・CI-VT16 — 全語既知は送信 1 回（body は既知 → retestCorrect null の 2 件）。成功で result と summary', async () => {
    const { session, start, submits } = harness()
    await start(words(2))

    await session.assessVocabulary(true)
    expect(submits).toHaveLength(0)
    const pending = session.assessVocabulary(true)

    expect(submits).toHaveLength(1)
    expect(submits[0].body).toEqual([
      { vocabularyId: 'v1', selfKnown: true, retestCorrect: null },
      { vocabularyId: 'v2', selfKnown: true, retestCorrect: null },
    ])
    expect(session.vocabularyTestView().phase).toBe('submitting')
    submits[0].resolve(OK)

    expect(await pending).toEqual({ ok: true, value: undefined })
    expect(session.vocabularyTestView()).toMatchObject({ phase: 'result', summary: { knownCount: 2, retestCount: 0, retestCorrectCount: 0 } })
  })

  test('verifies: CI-VT14 — 受け付けない phase の assessVocabulary は { ok: true } で何も出さない', async () => {
    const { session, submits, waits, fetches } = harness()
    const view = session.vocabularyTestView()

    const result = await session.assessVocabulary(true)

    expect(result).toEqual({ ok: true, value: undefined })
    expect(session.vocabularyTestView()).toBe(view)
    expect([submits.length, waits.length, fetches.length]).toEqual([0, 0, 0])
  })

  test('verifies: CI-VT14 — 「知らない」語が残ると retest に入り、choices は確定済み（正解を含む）。進捗は再テストの語数', async () => {
    const { session, toRetest } = harness()

    await toRetest(words(3))

    const view = session.vocabularyTestView()
    expect(view).toMatchObject({ phase: 'retest', currentTerm: 'term1', currentExample: null, progress: { position: 1, total: 3 }, isAnswerLocked: false, retestFeedback: null })
    expect([...view.choices].sort()).toEqual(['meaning1', 'wrong1-1', 'wrong1-2', 'wrong1-3'])
  })

  test('verifies: CI-VT16 — 送信が失敗すると assessVocabulary の戻りは失敗の Result、view は error（errorReason submit）', async () => {
    const { session, toSubmitting, submits } = harness()

    const { pending } = await toSubmitting()
    submits[0].resolve({ ok: false, failure: NETWORK })

    expect(await pending).toEqual({ ok: false, failure: NETWORK })
    expect(session.vocabularyTestView()).toMatchObject({ phase: 'error', errorReason: 'submit' })
  })
})

describe('answerRetest と 800ms の待ち（CI-VT15・web-cmd-learning-07）', () => {
  test('verifies: CI-VT15 — 回答の直後にロックと retestFeedback（correct）。wait(800) は 1 回で、解決前は同じ語のまま', async () => {
    const { session, toRetest, waits } = harness()
    await toRetest(words(2))

    const pending = session.answerRetest('meaning1')

    expect(session.vocabularyTestView()).toMatchObject({ phase: 'retest', currentTerm: 'term1', isAnswerLocked: true, retestFeedback: { kind: 'correct' } })
    expect(waits.map((w) => w.ms)).toEqual([800])
    await Promise.resolve()
    expect(session.vocabularyTestView().currentTerm).toBe('term1')

    waits[0].resolve()
    await pending
  })

  test('verifies: CI-VT15 — 誤答は retestFeedback が incorrect（正解の意味つき）', async () => {
    const { session, toRetest, waits } = harness()
    await toRetest(words(2))

    const pending = session.answerRetest('wrong1-1')

    expect(session.vocabularyTestView().retestFeedback).toEqual({ kind: 'incorrect', correctMeaning: 'meaning1' })
    waits[0].resolve()
    await pending
  })

  test('verifies: CI-VT15 — 待ちの解決後は次の語へ進み、ロックと feedback を解く。最後の語なら送信 1 回（body は出題の順の正誤）', async () => {
    const { session, toRetest, waits, submits } = harness()
    await toRetest(words(2))

    const first = session.answerRetest('meaning1')
    waits[0].resolve()
    expect(await first).toEqual({ ok: true, value: undefined })
    expect(session.vocabularyTestView()).toMatchObject({ currentTerm: 'term2', isAnswerLocked: false, retestFeedback: null, progress: { position: 2, total: 2 } })
    expect(submits).toHaveLength(0)

    const last = session.answerRetest('wrong2-1')
    waits[1].resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(submits).toHaveLength(1)
    expect(submits[0].body).toEqual([
      { vocabularyId: 'v1', selfKnown: false, retestCorrect: true },
      { vocabularyId: 'v2', selfKnown: false, retestCorrect: false },
    ])
    submits[0].resolve(OK)
    await last
    expect(session.vocabularyTestView()).toMatchObject({ phase: 'result', summary: { knownCount: 0, retestCount: 2, retestCorrectCount: 1 } })
  })

  test('verifies: CI-VT15 — ロック中の二重回答は無視され、wait は 1 回のまま、{ ok: true }', async () => {
    const { session, toRetest, waits } = harness()
    await toRetest(words(2))
    const first = session.answerRetest('meaning1')

    const second = await session.answerRetest('wrong1-1')

    expect(second).toEqual({ ok: true, value: undefined })
    expect(waits).toHaveLength(1)
    expect(session.vocabularyTestView().retestFeedback).toEqual({ kind: 'correct' })
    waits[0].resolve()
    await first
  })

  test('verifies: CI-VT15 — retest でない phase の answerRetest は何もせず wait も呼ばない', async () => {
    const { session, start, waits } = harness()
    await start(words(2))

    expect(await session.answerRetest('meaning1')).toEqual({ ok: true, value: undefined })
    expect(waits).toHaveLength(0)
  })
})

describe('submitVocabularyTest（CI-VT16・web-cmd-learning-02）', () => {
  test('verifies: CI-VT16 — 失敗した後の再試行は保持している同じ回答を送り、成功で result', async () => {
    const { session, toSubmitError, submits } = harness()
    await toSubmitError()
    const firstBody = submits[0].body

    const pending = session.submitVocabularyTest()

    expect(submits).toHaveLength(2)
    expect(submits[1].body).toEqual(firstBody)
    submits[1].resolve(OK)
    expect(await pending).toEqual({ ok: true, value: undefined })
    expect(session.vocabularyTestView().phase).toBe('result')
  })

  test('verifies: CI-VT16 — 再試行がまた失敗すると失敗の Result を返し error(submit) に戻る', async () => {
    const { session, toSubmitError, submits } = harness()
    await toSubmitError()

    const pending = session.submitVocabularyTest()
    submits[1].resolve({ ok: false, failure: NETWORK })

    expect(await pending).toEqual({ ok: false, failure: NETWORK })
    expect(session.vocabularyTestView()).toMatchObject({ phase: 'error', errorReason: 'submit' })
  })

  test('verifies: CI-VT16 — 送信中（未解決）の重ねた呼出は request を出さず { ok: true }', async () => {
    const { session, toSubmitting, submits } = harness()
    const { pending } = await toSubmitting()

    const second = await session.submitVocabularyTest()

    expect(second).toEqual({ ok: true, value: undefined })
    expect(submits).toHaveLength(1)
    submits[0].resolve(OK)
    await pending
  })

  test('verifies: CI-VT16 — error(submit) 以外では request を出さない（self-assessment）', async () => {
    const { session, start, submits } = harness()
    await start(words(2))

    expect(await session.submitVocabularyTest()).toEqual({ ok: true, value: undefined })
    expect(submits).toHaveLength(0)
  })
})

describe('dispose と世代（CI-VT17・web-dec-176）', () => {
  test('verifies: CI-VT17 — 待ち中に dispose すると、待ちが解決しても語は進まず送信もしない', async () => {
    const { session, toRetest, waits, submits } = harness()
    await toRetest(words(1))
    const pending = session.answerRetest('meaning1')

    session.dispose()
    waits[0].resolve()
    const result = await pending

    expect(result).toEqual({ ok: true, value: undefined })
    expect(submits).toHaveLength(0)
    expect(session.vocabularyTestView()).toMatchObject({ phase: 'retest', isAnswerLocked: true, retestFeedback: { kind: 'correct' } })
  })

  test('verifies: CI-VT17 — dispose の後の startVocabularyTest は通常どおり request を出して進む（result の session から）', async () => {
    const { session, toSubmitting, submits, fetches } = harness()
    const { pending } = await toSubmitting()
    submits[0].resolve(OK)
    await pending
    expect(session.vocabularyTestView().phase).toBe('result')

    session.dispose()
    const restart = session.startVocabularyTest()

    expect(fetches).toHaveLength(2)
    expect(session.vocabularyTestView().phase).toBe('loading')
    fetches[1].resolve({ ok: true, value: words(1) })
    await restart
    expect(session.vocabularyTestView()).toMatchObject({ phase: 'self-assessment', currentTerm: 'term1' })
  })

  test('verifies: CI-VT17 — 取得 A を保留 → start(A)・dispose・start(B) → B の保留中に A が成功しても view は loading のまま・通知 0 回。B の完了で語 B', async () => {
    const { session, fetches } = harness()
    const a = session.startVocabularyTest()
    session.dispose()
    const b = session.startVocabularyTest()
    expect(fetches).toHaveLength(2)
    const loadingView = session.vocabularyTestView()
    const listener = vi.fn()
    session.subscribe(listener)

    fetches[0].resolve({ ok: true, value: [{ ...words(1)[0], term: 'word A' }] })
    await a

    expect(session.vocabularyTestView()).toBe(loadingView)
    expect(listener).not.toHaveBeenCalled()

    fetches[1].resolve({ ok: true, value: [{ ...words(1)[0], term: 'word B' }] })
    await b
    expect(session.vocabularyTestView().currentTerm).toBe('word B')
  })

  test('verifies: CI-VT13・CI-VT17 — dispose を挟まない連続開始: 古い取得 A が成功しても loading のまま・通知 0 回。B の完了で語 B。request は 2 回', async () => {
    const { session, fetches } = harness()
    const a = session.startVocabularyTest()
    const b = session.startVocabularyTest()
    expect(fetches).toHaveLength(2)
    const loadingView = session.vocabularyTestView()
    const listener = vi.fn()
    session.subscribe(listener)

    fetches[0].resolve({ ok: true, value: [{ ...words(1)[0], term: 'word A' }] })
    await a

    expect(session.vocabularyTestView()).toBe(loadingView)
    expect(listener).not.toHaveBeenCalled()

    fetches[1].resolve({ ok: true, value: [{ ...words(1)[0], term: 'word B' }] })
    await b
    expect(session.vocabularyTestView().currentTerm).toBe('word B')
  })

  test('verifies: CI-VT13・CI-VT17 — 連続開始で古い取得 A が失敗しても、A の戻りは失敗の Result だが view は error にならず loading のまま・通知 0 回。B の成功で self-assessment', async () => {
    const { session, fetches } = harness()
    const a = session.startVocabularyTest()
    const b = session.startVocabularyTest()
    const loadingView = session.vocabularyTestView()
    const listener = vi.fn()
    session.subscribe(listener)

    fetches[0].resolve({ ok: false, failure: NETWORK })

    expect(await a).toEqual({ ok: false, failure: NETWORK })
    expect(session.vocabularyTestView()).toBe(loadingView)
    expect(session.vocabularyTestView().phase).toBe('loading')
    expect(listener).not.toHaveBeenCalled()

    fetches[1].resolve({ ok: true, value: words(1) })
    await b
    expect(session.vocabularyTestView().phase).toBe('self-assessment')
  })

  test('verifies: CI-VT17 — 送信中に dispose し、応答が失敗で戻っても view は submitting のまま。戻りは失敗の Result', async () => {
    const { session, toSubmitting, submits } = harness()
    const { pending } = await toSubmitting()

    session.dispose()
    submits[0].resolve({ ok: false, failure: NETWORK })

    expect(await pending).toEqual({ ok: false, failure: NETWORK })
    expect(session.vocabularyTestView().phase).toBe('submitting')
  })
})

describe('vocabularyTestView・subscribe（CI-VT18・web-query-learning-02）', () => {
  test('verifies: CI-VT18 — 同じ state の間は同じ凍結済みの view（入れ子の choices・progress・retestFeedback・summary まで）', async () => {
    const { session, toRetest, waits } = harness()
    await toRetest(words(2))
    const pending = session.answerRetest('wrong1-1')
    const view = session.vocabularyTestView()

    expect(session.vocabularyTestView()).toBe(view)
    expect(Object.isFrozen(view)).toBe(true)
    expect(Object.isFrozen(view.choices)).toBe(true)
    expect(Object.isFrozen(view.progress)).toBe(true)
    expect(Object.isFrozen(view.retestFeedback)).toBe(true)
    waits[0].resolve()
    await pending
  })

  test('verifies: CI-VT18 — 受け付けない呼出では通知せず、受け付ける呼出で通知する。解除後は通知しない', async () => {
    const { session, start, fetches } = harness()
    await start(words(3))
    const listener = vi.fn()
    const unsubscribe = session.subscribe(listener)

    await session.startVocabularyTest() // self-assessment では受け付けない
    expect(listener).not.toHaveBeenCalled()

    await session.assessVocabulary(true) // 受け付ける
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    await session.assessVocabulary(true) // 受け付けるが解除済み
    expect(listener).toHaveBeenCalledTimes(1)
    expect(fetches).toHaveLength(1)
  })
})

describe('application の規律（CI-VT19・CI-VT02・web-dec-154）', () => {
  test('verifies: CI-VT19・CI-VT02 — 12 語を渡しても progress.total は 10（打ち切りは domain）。再テストの回答を受け付けても timer は 0 件', async () => {
    vi.useFakeTimers()
    const { session, toRetest, waits } = harness()

    await toRetest(words(12))
    expect(session.vocabularyTestView().progress).toEqual({ position: 1, total: 10 })
    const pending = session.answerRetest('meaning1')

    expect(vi.getTimerCount()).toBe(0)
    waits[0].resolve()
    await pending
  })

  test('verifies: CI-VT19 — assessVocabulary の全体で Math.random は 0 回、shuffle の fake が語の数だけ呼ばれる', async () => {
    const random = vi.spyOn(Math, 'random')
    const { toRetest, shuffled } = harness()

    await toRetest(words(3))

    expect(random).not.toHaveBeenCalled()
    expect(shuffled).toHaveLength(3)
  })
})
