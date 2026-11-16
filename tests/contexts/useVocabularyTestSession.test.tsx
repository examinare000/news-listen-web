// composition root `useVocabularyTestSession`: マウントごとに 1 つの単語テスト session を持ち、view を購読して { view, commands } を返す（Provider は作らない）。
// 統合テスト: 実物の ApiClientProvider ＋ createGatewayDouble。
// product-learn-06・web-dec-154・web-dec-176・web-dec-178。
//
// RED 理由（実装前）: `@/contexts/useVocabularyTestSession` が無い（module not found）。
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { useVocabularyTestSession } from '@/contexts/useVocabularyTestSession'
import { createGatewayDouble } from '../helpers/gatewayDouble'
import type { GatewayDouble } from '../helpers/gatewayDouble'

const SESSION_PATH = '/api/backend/vocabulary/test-session'
const RESULT_PATH = '/api/backend/vocabulary/test-result'

const dto = (n: number) => ({
  vocabulary_id: `v${n}`,
  term: `term${n}`,
  meaning: `meaning${n}`,
  example: `example${n}`,
  distractors: [`wrong${n}-1`, `wrong${n}-2`, `wrong${n}-3`],
})

function mount(gateway: GatewayDouble) {
  return renderHook(() => useVocabularyTestSession(), {
    wrapper: ({ children }) => <ApiClientProvider gateway={gateway}>{children}</ApiClientProvider>,
  })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useVocabularyTestSession (composition root)', () => {
  test('verifies: CI-VT22 — 再描画しても同じ commands を返し、view は state が変わるまで同じ参照', () => {
    const { result, rerender } = mount(createGatewayDouble())
    const { commands, view } = result.current

    rerender()
    rerender()

    expect(result.current.commands).toBe(commands)
    expect(result.current.view).toBe(view)
    expect(view.phase).toBe('loading')
  })

  test('verifies: CI-VT22 — commands の key は 4 つだけで、戻りに dispose・subscribe・reduce が無い（実行時の key）', () => {
    const { result } = mount(createGatewayDouble())

    expect(Object.keys(result.current.commands).sort()).toEqual(
      ['answerRetest', 'assessVocabulary', 'startVocabularyTest', 'submitVocabularyTest'].sort(),
    )
    expect(Object.keys(result.current).sort()).toEqual(['commands', 'view'])
    for (const hidden of ['dispose', 'subscribe', 'reduce']) {
      expect(result.current).not.toHaveProperty(hidden)
      expect(result.current.commands).not.toHaveProperty(hidden)
    }
  })

  test('verifies: CI-VT22 — 実物の gateway 経由で GET /vocabulary/test-session を出し、view が self-assessment に変わる。変わった後の再描画では同じ参照', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('GET', SESSION_PATH, { ok: true, value: { items: [dto(1), dto(2)] } })
    const { result, rerender } = mount(gateway)

    await act(async () => {
      await result.current.commands.startVocabularyTest()
    })

    expect(gateway.calls).toEqual([{ method: 'GET', path: SESSION_PATH, body: undefined }])
    expect(result.current.view).toMatchObject({ phase: 'self-assessment', currentTerm: 'term1', progress: { position: 1, total: 2 } })
    const view = result.current.view
    rerender()
    expect(result.current.view).toBe(view)
  })

  test('verifies: CI-VT22 — 全語既知で POST /vocabulary/test-result に裸の配列（self_known・retest_correct: null）を出す', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('GET', SESSION_PATH, { ok: true, value: { items: [dto(1)] } })
    gateway.respond('POST', RESULT_PATH, { ok: true, value: { updated: 1 } })
    const { result } = mount(gateway)

    await act(async () => {
      await result.current.commands.startVocabularyTest()
    })
    await act(async () => {
      await result.current.commands.assessVocabulary(true)
    })

    expect(gateway.calls.at(-1)).toEqual({
      method: 'POST',
      path: RESULT_PATH,
      body: [{ vocabulary_id: 'v1', self_known: true, retest_correct: null }],
    })
    expect(result.current.view.phase).toBe('result')
  })

  test('verifies: CI-VT22 — 別のマウントは別の session（先のマウントを result まで進めても、次のマウントの初期 view は loading）', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('GET', SESSION_PATH, { ok: true, value: { items: [dto(1)] } })
    gateway.respond('POST', RESULT_PATH, { ok: true, value: { updated: 1 } })
    const first = mount(gateway)
    await act(async () => {
      await first.result.current.commands.startVocabularyTest()
    })
    await act(async () => {
      await first.result.current.commands.assessVocabulary(true)
    })
    expect(first.result.current.view.phase).toBe('result')

    const second = mount(gateway)

    expect(second.result.current.view.phase).toBe('loading')
    expect(second.result.current.commands).not.toBe(first.result.current.commands)
  })

  test('verifies: CI-VT22 — 800ms の待ちの途中で unmount すると dispose され、送信が出ない（fake timers）', async () => {
    vi.useFakeTimers()
    const gateway = createGatewayDouble()
    gateway.respond('GET', SESSION_PATH, { ok: true, value: { items: [dto(1)] } })
    gateway.respond('POST', RESULT_PATH, { ok: true, value: { updated: 1 } })
    const { result, unmount } = mount(gateway)
    await act(async () => {
      await result.current.commands.startVocabularyTest()
    })
    await act(async () => {
      await result.current.commands.assessVocabulary(false)
    })
    let pending: Promise<unknown> = Promise.resolve()
    act(() => {
      pending = result.current.commands.answerRetest('meaning1')
    })
    expect(result.current.view).toMatchObject({ phase: 'retest', isAnswerLocked: true })

    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
      await pending
    })

    expect(gateway.calls.filter((c) => c.method === 'POST')).toEqual([])
  })

  test('verifies: CI-VT22 — web-dec-176: 取得中に unmount → 再 mount し、1 つ目の応答を後から完了させても、2 つ目の mount の view は 2 つ目の応答だけを反映する', async () => {
    const gateway = createGatewayDouble()
    const releases: Array<() => void> = []
    let gets = 0
    gateway.respondWith('GET', SESSION_PATH, () => {
      gets += 1
      const own = gets
      return new Promise((resolve) => {
        releases.push(() => resolve({ ok: true, value: { items: [dto(own === 1 ? 1 : 2)] } }))
      })
    })
    const first = mount(gateway)
    let firstStart: Promise<unknown> = Promise.resolve()
    act(() => {
      firstStart = first.result.current.commands.startVocabularyTest()
    })
    first.unmount()

    const second = mount(gateway)
    let secondStart: Promise<unknown> = Promise.resolve()
    act(() => {
      secondStart = second.result.current.commands.startVocabularyTest()
    })
    await act(async () => {
      releases[0]()
      await firstStart
    })
    expect(second.result.current.view.phase).toBe('loading')

    await act(async () => {
      releases[1]()
      await secondStart
    })

    expect(second.result.current.view).toMatchObject({ phase: 'self-assessment', currentTerm: 'term2' })
  })
})
