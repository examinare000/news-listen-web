// composition root `useLearningCommands`: useApiClient() の gateway から LearningCommands を組み立てる（Provider は作らない）。
// 統合テスト: 実物の ApiClientProvider ＋ createGatewayDouble。gateway を変えて再描画する観測だけは、useApiClient だけを差し替える
// partial mock で行う（ApiClientProvider は gateway を useState で固定し、context は非公開のため）。差し替えが無いときは実物へ委譲する。
//
// RED 理由（実装前）: `@/contexts/useLearningCommands` が無い（module not found）。
import React from 'react'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { useLearningCommands } from '@/contexts/useLearningCommands'
import type { ApiGateway } from '@/lib/api/gateway'
import { createGatewayDouble } from '../helpers/gatewayDouble'

const override = vi.hoisted(() => ({ gateway: undefined as ApiGateway | undefined }))

vi.mock('@/contexts/ApiClientProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/ApiClientProvider')>()
  return {
    ...actual,
    // 実物は常に呼ぶ（hook の呼出順を保つ）。差し替えがあるときだけその gateway を返す。
    useApiClient: () => {
      const real = actual.useApiClient()
      return override.gateway ?? real
    },
  }
})

beforeEach(() => {
  override.gateway = undefined
  localStorage.clear()
})

describe('useLearningCommands (composition root)', () => {
  test('verifies: CI-LN16 — 再描画しても同じ object を返す（useMemo。gateway が同じ間は作り直さない）', () => {
    const gateway = createGatewayDouble()
    const { result, rerender } = renderHook(() => useLearningCommands(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={gateway}>{children}</ApiClientProvider>,
    })
    const first = result.current

    rerender()
    rerender()

    expect(result.current).toBe(first)
  })

  test('verifies: CI-LN16 — gateway が変わると別の object を返す（依存 = gateway）。同じ gateway のままなら同じ object（対照）', () => {
    const first = createGatewayDouble()
    const second = createGatewayDouble()
    override.gateway = first
    const { result, rerender } = renderHook(() => useLearningCommands(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={first}>{children}</ApiClientProvider>,
    })
    const before = result.current

    rerender()
    expect(result.current).toBe(before)

    override.gateway = second
    rerender()
    expect(result.current).not.toBe(before)
  })

  test('verifies: CI-LN16 — 実物の ApiClientProvider の gateway 経由で、submitQuiz が POST /api/backend/podcasts/<id>/quiz-answers を、registerTerm が POST /api/backend/vocabulary を出す (product-learn-05・product-learn-18・product-learn-19)', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('POST', '/api/backend/podcasts/p1/quiz-answers', {
      ok: true,
      value: { correct_count: 1, total: 1, correct_rate: 1, results: [{ question_index: 0, selected_index: 1, correct_index: 1, is_correct: true }] },
    })
    gateway.respond('POST', '/api/backend/vocabulary', {
      ok: true,
      value: { vocabulary_id: 'v1', podcast_id: 'p1', term: 'apple', meaning: 'm', example: 'e', registered_at: '2026-11-16T00:00:00Z' },
    })
    const { result } = renderHook(() => useLearningCommands(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={gateway}>{children}</ApiClientProvider>,
    })

    const quiz = await result.current.submitQuiz('p1', [1])
    const registered = await result.current.registerTerm('p1', 'apple')

    expect(gateway.calls).toEqual([
      { method: 'POST', path: '/api/backend/podcasts/p1/quiz-answers', body: { answers: [1] } },
      { method: 'POST', path: '/api/backend/vocabulary', body: { podcast_id: 'p1', term: 'apple' } },
    ])
    expect(quiz.ok && quiz.value.correct).toBe(1)
    expect(registered).toEqual({ ok: true, value: undefined })
  })

  test('verifies: CI-LD13 — markAchievementsSeen は localStorage の seen_achievement_ids へ、保存済みの既読に続けて書く（再描画しても同じ command object）(web-dec-170・web-cmd-learning-05)', async () => {
    localStorage.setItem('seen_achievement_ids', '["a"]')
    const gateway = createGatewayDouble()
    const { result, rerender } = renderHook(() => useLearningCommands(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={gateway}>{children}</ApiClientProvider>,
    })
    const first = result.current

    await result.current.markAchievementsSeen(['b'])
    rerender()

    expect(result.current).toBe(first)
    expect(localStorage.getItem('seen_achievement_ids')).toBe('["a","b"]')
    expect(gateway.calls).toEqual([])
  })
})
