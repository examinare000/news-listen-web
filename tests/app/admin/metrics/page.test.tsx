import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import AdminMetricsPage from '@/app/(app)/admin/metrics/page'
import type { MetricsSnapshot } from '@/types/index'

// ADR-075 決定E1: 管理者向け read-only リテンション計測ダッシュボード。
// AdminUsersPage と同じ認証ゲート様式（useAuth・isAdmin・useEffect ロード）に倣う。
// レスポンス契約は backend api/schemas.py 確定版（ラッパー無し・d7/d30 トップレベル・
// rate_started/rate_delivered・total_stars/active_users/avg_per_active_user）。

const getMetrics = vi.fn()

vi.mock('@/lib/api', () => ({
  createApiClient: () => ({ getMetrics }),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public detail: string) {
      super(detail)
    }
  },
}))

const authOverride = vi.hoisted(() => ({
  current: { username: 'admin', role: 'admin', display_name: 'Admin' },
}))
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', user: authOverride.current, login: vi.fn(), logout: vi.fn(), refreshMe: vi.fn() }),
}))

const FULL_SNAPSHOT: MetricsSnapshot = {
  date: '2026-07-14',
  d7: { eligible: 20, retained: 8, rate: 0.4 },
  d30: { eligible: 10, retained: 3, rate: 0.3 },
  completion: {
    started: 50,
    completed: 28,
    delivered: 60,
    rate_started: 0.56,
    rate_delivered: 0.4667,
  },
  // 小数第2位以下を持つ値で固定する（表示は小数第1位へ丸めるため 5.264 → "5.3"）。
  weekly_star: { total_stars: 42, active_users: 8, avg_per_active_user: 5.264 },
  generated_at: '2026-07-15T00:10:00Z',
}

function renderPage() {
  return render(<AdminMetricsPage />)
}

beforeEach(() => {
  vi.clearAllMocks()
  authOverride.current = { username: 'admin', role: 'admin', display_name: 'Admin' }
  getMetrics.mockResolvedValue(FULL_SNAPSHOT)
})

describe('AdminMetricsPage', () => {
  test('non-admin sees a forbidden message and getMetrics is not called', () => {
    authOverride.current = { username: 'bob', role: 'user', display_name: 'Bob' }
    renderPage()

    expect(screen.getByText(/管理者のみ利用できます/)).toBeInTheDocument()
    expect(getMetrics).not.toHaveBeenCalled()
  })

  test('calls getMetrics on mount for admin users', async () => {
    renderPage()
    await waitFor(() => expect(getMetrics).toHaveBeenCalled())
  })

  test('renders D7/D30 retention rates as percentages', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('40%')).toBeInTheDocument())
    expect(screen.getByText('30%')).toBeInTheDocument()
  })

  test('renders completion rate with both denominators (started/delivered)', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('56%')).toBeInTheDocument())
    expect(screen.getByText('47%')).toBeInTheDocument()
  })

  test('renders the aggregation date', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('2026-07-14')).toBeInTheDocument())
  })

  test('renders weekly star average rounded to 1 decimal place', async () => {
    renderPage()
    // avg_per_active_user=5.264 は小数第1位へ丸めて "5.3"（生の値をそのまま描画しない）。
    await waitFor(() => expect(screen.getByText('5.3')).toBeInTheDocument())
    expect(screen.queryByText('5.264')).not.toBeInTheDocument()
  })

  test('shows an empty state on 404 (aggregation job has not run yet for the date)', async () => {
    const { ApiError } = await import('@/lib/api')
    getMetrics.mockRejectedValue(new ApiError(404, 'Metrics snapshot not found'))
    renderPage()
    await waitFor(() => expect(getMetrics).toHaveBeenCalled())

    expect(screen.getByText(/集計データがまだありません/)).toBeInTheDocument()
  })

  test('renders "—" for null rate fields without crashing (defensive rendering)', async () => {
    getMetrics.mockResolvedValue({
      date: '2026-07-14',
      d7: { eligible: 0, retained: 0, rate: null },
      d30: { eligible: 0, retained: 0, rate: null },
      completion: {
        started: 0,
        completed: 0,
        delivered: 0,
        rate_started: null,
        rate_delivered: null,
      },
      weekly_star: { total_stars: 0, active_users: 0, avg_per_active_user: null },
      generated_at: '2026-07-15T00:10:00Z',
    } satisfies MetricsSnapshot)
    renderPage()

    await waitFor(() => expect(getMetrics).toHaveBeenCalled())
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  test('renders "—" without crashing when unknown/missing fields are returned by backend (schema drift)', async () => {
    // backend との契約は確定済みだが、念のため想定外に欠落したフィールドがあっても
    // 壊れないことを固定する（防御的アクセスの回帰防止）。
    getMetrics.mockResolvedValue({
      date: '2026-07-14',
      d7: {},
      d30: {},
      completion: {},
      weekly_star: {},
      generated_at: '2026-07-15T00:10:00Z',
    })

    expect(() => renderPage()).not.toThrow()
    await waitFor(() => expect(getMetrics).toHaveBeenCalled())
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  test('shows a graceful error message on load failure (non-404)', async () => {
    getMetrics.mockRejectedValue(new Error('network error'))
    renderPage()

    await waitFor(() => expect(screen.getByText(/取得に失敗しました/)).toBeInTheDocument())
  })
})
