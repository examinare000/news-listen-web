import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DashboardPage from '@/app/(app)/dashboard/page'

vi.mock('@/lib/api', () => ({
  createApiClient: vi.fn(() => ({
    getLearningDashboard: vi.fn(),
  })),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public detail: string) {
      super(detail)
    }
  },
}))

const POPULATED_DASHBOARD = {
  streak: { current_streak_days: 5, today_listened: true, last_listened_day: '2026-07-12' },
  total_episodes: 12,
  vocabulary_acquired: 34,
  quiz: {
    quizzed_episodes: 3,
    average_correct_rate: 0.75,
    trend: [
      { graded_at: '2026-07-01T00:00:00Z', correct_rate: 0.6 },
      { graded_at: '2026-07-05T00:00:00Z', correct_rate: 0.9 },
    ],
  },
  monthly_activity: [{ month: '2026-07', active_days: 5 }],
  current_difficulty: 'toeic_600',
}

const EMPTY_DASHBOARD = {
  streak: { current_streak_days: 0, today_listened: false, last_listened_day: null },
  total_episodes: 0,
  vocabulary_acquired: 0,
  quiz: { quizzed_episodes: 0, average_correct_rate: null, trend: [] },
  monthly_activity: [],
  current_difficulty: 'toeic_600',
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ==========================================================
// DashboardPage — データ取得・表示（F4 / ADR-072）
// ==========================================================
describe('DashboardPage — display', () => {
  test('renders the page header', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getLearningDashboard: vi.fn().mockResolvedValue(EMPTY_DASHBOARD),
    } as unknown as ReturnType<typeof createApiClient>)

    render(<DashboardPage />)

    expect(await screen.findByText('ダッシュボード')).toBeInTheDocument()
  })

  test('Given a populated response, renders streak days', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getLearningDashboard: vi.fn().mockResolvedValue(POPULATED_DASHBOARD),
    } as unknown as ReturnType<typeof createApiClient>)

    render(<DashboardPage />)

    expect(await screen.findByText(/5日連続/)).toBeInTheDocument()
  })

  test('Given a populated response, renders total_episodes labeled 生成済みエピソード数', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getLearningDashboard: vi.fn().mockResolvedValue(POPULATED_DASHBOARD),
    } as unknown as ReturnType<typeof createApiClient>)

    render(<DashboardPage />)

    expect(await screen.findByText('生成済みエピソード数')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  test('Given a populated response, renders vocabulary_acquired labeled 習得語彙数', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getLearningDashboard: vi.fn().mockResolvedValue(POPULATED_DASHBOARD),
    } as unknown as ReturnType<typeof createApiClient>)

    render(<DashboardPage />)

    expect(await screen.findByText('習得語彙数')).toBeInTheDocument()
    expect(screen.getByText('34')).toBeInTheDocument()
  })

  test('Given a populated response, renders quiz stats (quizzed_episodes + average_correct_rate) and trend labeled クイズ成績の推移', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getLearningDashboard: vi.fn().mockResolvedValue(POPULATED_DASHBOARD),
    } as unknown as ReturnType<typeof createApiClient>)

    render(<DashboardPage />)

    expect(await screen.findByText('クイズ成績の推移')).toBeInTheDocument()
    // quizzed_episodes=3・average_correct_rate=0.75(75%) の要約表示
    expect(screen.getByText('3件')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
    // trend の各点（正答率%表記）
    expect(screen.getByText('60%')).toBeInTheDocument()
    expect(screen.getByText('90%')).toBeInTheDocument()
  })

  test('Given a populated response, renders monthly_activity labeled 月別活動', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getLearningDashboard: vi.fn().mockResolvedValue(POPULATED_DASHBOARD),
    } as unknown as ReturnType<typeof createApiClient>)

    render(<DashboardPage />)

    expect(await screen.findByText('月別活動')).toBeInTheDocument()
    expect(screen.getByText('2026-07')).toBeInTheDocument()
    // WHY 完全一致文字列: 正規表現 /5日/ だと streak の「5日連続」ノードにも部分一致し
    // 複数要素ヒットで曖昧になるため、月別活動セルの厳密な表示文字列で検証する
    expect(screen.getByText('5日')).toBeInTheDocument()
  })

  test('Given a populated response, renders current_difficulty as a human-readable label', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getLearningDashboard: vi.fn().mockResolvedValue(POPULATED_DASHBOARD),
    } as unknown as ReturnType<typeof createApiClient>)

    render(<DashboardPage />)

    expect(await screen.findByText('TOEIC 600')).toBeInTheDocument()
  })
})

describe('DashboardPage — graceful degradation', () => {
  test('Given a new-user (all-zero) response, renders without crashing', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getLearningDashboard: vi.fn().mockResolvedValue(EMPTY_DASHBOARD),
    } as unknown as ReturnType<typeof createApiClient>)

    render(<DashboardPage />)

    expect(await screen.findByText('ダッシュボード')).toBeInTheDocument()
    // ゼロ表示（クラッシュしない）
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)
  })

  test('Given fetch failure, renders without crashing and shows a neutral empty state', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getLearningDashboard: vi.fn().mockRejectedValue(new Error('network error')),
    } as unknown as ReturnType<typeof createApiClient>)

    render(<DashboardPage />)

    expect(await screen.findByText('ダッシュボード')).toBeInTheDocument()
    expect(await screen.findByText(/取得できませんでした/)).toBeInTheDocument()
  })

  // ADR-072 決定5・決定8: fetch 失敗時は前回値を保持し、再試行導線を出す（settings の
  // quota/streak ローダーと同じ慣習）。null 上書きによる前回値の破棄は不具合として扱う。
  test('Given fetch failure, the retry button re-invokes getLearningDashboard and renders data on success', async () => {
    const { createApiClient } = await import('@/lib/api')
    const getLearningDashboard = vi
      .fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(POPULATED_DASHBOARD)
    vi.mocked(createApiClient).mockReturnValue({
      getLearningDashboard,
    } as unknown as ReturnType<typeof createApiClient>)

    render(<DashboardPage />)

    expect(await screen.findByText(/取得できませんでした/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /ダッシュボードを再読み込み/ }))

    expect(await screen.findByText(/5日連続/)).toBeInTheDocument()
    expect(getLearningDashboard).toHaveBeenCalledTimes(2)
  })

  test('Given a successful load, a subsequent failed re-fetch does not blank the previously-shown dashboard', async () => {
    const { createApiClient } = await import('@/lib/api')
    const getLearningDashboard = vi
      .fn()
      .mockResolvedValueOnce(POPULATED_DASHBOARD)
      .mockRejectedValueOnce(new Error('network error'))
    vi.mocked(createApiClient).mockReturnValue({
      getLearningDashboard,
    } as unknown as ReturnType<typeof createApiClient>)

    render(<DashboardPage />)

    expect(await screen.findByText(/5日連続/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /ダッシュボードを再読み込み/ }))

    // 再取得が失敗しても、直前に表示していたダッシュボードは消えない（前回値保持）
    await screen.findByText(/最新のデータ取得に失敗しました/)
    expect(screen.getByText(/5日連続/)).toBeInTheDocument()
    expect(getLearningDashboard).toHaveBeenCalledTimes(2)
  })
})
