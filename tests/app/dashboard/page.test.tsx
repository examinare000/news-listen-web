import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DashboardPage from '@/app/(app)/dashboard/page'

const { playSfx, showToast } = vi.hoisted(() => ({
  playSfx: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('@/lib/sfx', () => ({ playSfx }))
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ showToast }),
}))

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
  weekly_goal: {
    goal_episodes: 5,
    week: '2026-W31',
    completed_this_week: 3,
    history: [{ week: '2026-W30', goal: 5, completed: 4 }],
  },
  achievements: [
    { id: 'first_episode_completed', unlocked_at: '2026-07-01' },
  ],
}

const EMPTY_DASHBOARD = {
  streak: { current_streak_days: 0, today_listened: false, last_listened_day: null },
  total_episodes: 0,
  vocabulary_acquired: 0,
  quiz: { quizzed_episodes: 0, average_correct_rate: null, trend: [] },
  monthly_activity: [],
  current_difficulty: 'toeic_600',
  weekly_goal: {
    goal_episodes: 3,
    week: '2026-W31',
    completed_this_week: 0,
    history: [],
  },
  achievements: [],
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

  test('renders weekly progress, factual history, and CSS activity bars without warning language', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getLearningDashboard: vi.fn().mockResolvedValue(POPULATED_DASHBOARD),
    } as unknown as ReturnType<typeof createApiClient>)

    render(<DashboardPage />)

    expect(await screen.findByText('今週 3/5 本')).toBeInTheDocument()
    expect(screen.getByText('目標: 5 → 実績: 4')).toBeInTheDocument()
    expect(screen.getAllByRole('meter').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText(/未達|失敗|あと.*本/)).not.toBeInTheDocument()
  })

  test('renders all seven catalog achievements with unlocked date and subdued locked entries', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getLearningDashboard: vi.fn().mockResolvedValue(POPULATED_DASHBOARD),
    } as unknown as ReturnType<typeof createApiClient>)

    render(<DashboardPage />)

    expect(await screen.findByText('実績')).toBeInTheDocument()
    expect(screen.getByText('初回エピソード完聴')).toBeInTheDocument()
    expect(screen.getByText('解錠: 2026-07-01')).toBeInTheDocument()
    expect(screen.getByText('100 日連続聴取')).toBeInTheDocument()
    expect(document.querySelectorAll('.achievement-item')).toHaveLength(7)
    expect(document.querySelectorAll('.achievement-item.locked')).toHaveLength(6)
  })

  test('detects only achievements added after the initial response and emits editorial toast + sound', async () => {
    const { createApiClient } = await import('@/lib/api')
    const getLearningDashboard = vi
      .fn()
      .mockResolvedValueOnce(POPULATED_DASHBOARD)
      .mockResolvedValueOnce({
        ...POPULATED_DASHBOARD,
        achievements: [
          ...POPULATED_DASHBOARD.achievements,
          { id: 'first_quiz_correct', unlocked_at: '2026-07-29' },
        ],
      })
    vi.mocked(createApiClient).mockReturnValue({
      getLearningDashboard,
    } as unknown as ReturnType<typeof createApiClient>)

    render(<DashboardPage />)
    await screen.findByText('解錠: 2026-07-01')
    expect(showToast).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'ダッシュボードを再読み込み' }))

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('実績を解錠しました：初回クイズ正解', 'success')
    })
    expect(playSfx).toHaveBeenCalledWith('achievement')
  })

  test('shows registered vocabulary count/latest five and hides the test link when no words are due', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getLearningDashboard: vi.fn().mockResolvedValue(POPULATED_DASHBOARD),
      getVocabulary: vi.fn().mockResolvedValue({
        count: 6,
        vocabulary: Array.from({ length: 6 }, (_, index) => ({
          vocabulary_id: `v${index}`,
          podcast_id: 'p1',
          term: `term-${index}`,
          meaning: `meaning-${index}`,
          example: `example-${index}`,
          registered_at: `2026-07-${29 - index}`,
        })),
      }),
      getVocabularyTestSession: vi.fn().mockResolvedValue({ items: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    render(<DashboardPage />)

    expect(await screen.findByText('登録語彙')).toBeInTheDocument()
    expect(screen.getByText('6 語')).toBeInTheDocument()
    expect(screen.getByText('term-0')).toBeInTheDocument()
    expect(screen.getByText('term-4')).toBeInTheDocument()
    expect(screen.queryByText('term-5')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '単語テスト' })).not.toBeInTheDocument()
  })

  test('shows the vocabulary test link when at least one due word exists', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getLearningDashboard: vi.fn().mockResolvedValue(EMPTY_DASHBOARD),
      getVocabulary: vi.fn().mockResolvedValue({ count: 0, vocabulary: [] }),
      getVocabularyTestSession: vi.fn().mockResolvedValue({
        items: [{
          vocabulary_id: 'v1',
          term: 'accelerate',
          meaning: '加速する',
          example: 'Sales accelerate.',
          distractors: [],
        }],
      }),
    } as unknown as ReturnType<typeof createApiClient>)

    render(<DashboardPage />)

    expect(await screen.findByRole('link', { name: '単語テスト' })).toHaveAttribute(
      'href',
      '/vocabulary-test',
    )
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
