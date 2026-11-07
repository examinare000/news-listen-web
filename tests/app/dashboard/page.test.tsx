import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render as rtlRender, screen, waitFor } from '@testing-library/react'
import type { RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import userEvent from '@testing-library/user-event'
import DashboardPage from '@/app/(app)/dashboard/page'
import { PreferencesProvider } from '@/contexts/PreferencesProvider'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'
import type { ApiFailure, Result } from '@/lib/api/gateway'
import { createGatewayDouble } from '../../helpers/gatewayDouble'
import type { GatewayDouble } from '../../helpers/gatewayDouble'

const render = (ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) =>
  rtlRender(ui, { wrapper: ApiClientProvider, ...options })

const { playSfx, showToast } = vi.hoisted(() => ({
  playSfx: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('@/lib/sfx', () => ({ playSfx, configureSfx: vi.fn() }))
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ showToast }),
}))

const holder = vi.hoisted(() => ({ gw: undefined as GatewayDouble | undefined }))

vi.mock('@/lib/api/gateway', () => ({ createGateway: () => holder.gw }))

const DASHBOARD_PATH = '/api/backend/users/me/learning-dashboard'
const VOCABULARY_PATH = '/api/backend/vocabulary'
const TEST_SESSION_PATH = '/api/backend/vocabulary/test-session'

let gw: GatewayDouble

function callsTo(method: string, path: string) {
  return gw.calls.filter((c) => c.method === method && c.path === path)
}

function respondDashboard(value: unknown) {
  gw.respond('GET', DASHBOARD_PATH, { ok: true, value })
}

// 呼出順に応答を返す。Error は Result でない reject（想定外の例外）としてそのまま届ける
function respondDashboardInOrder(...outcomes: Array<Result<unknown, ApiFailure> | Error>) {
  gw.respondWith('GET', DASHBOARD_PATH, () => {
    const outcome = outcomes[callsTo('GET', DASHBOARD_PATH).length - 1]
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome)
  })
}

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

// 設定の保存先は、テストごとに新しい in-memory の KeyValueStore。前のテストが書いた値に頼らない。
function renderDashboard(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial))
  const store: KeyValueStore = {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => {
      data.set(key, value)
      return true
    },
    remove: (key) => {
      data.delete(key)
    },
  }
  render(
    <PreferencesProvider store={store}>
      <DashboardPage />
    </PreferencesProvider>,
  )
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  gw = createGatewayDouble()
  holder.gw = gw
})

// ==========================================================
// DashboardPage — データ取得・表示（F4 / ADR-072）
// ==========================================================
describe('DashboardPage — display', () => {
  test('renders the page header', async () => {
    respondDashboard(EMPTY_DASHBOARD)

    renderDashboard()

    expect(await screen.findByText('ダッシュボード')).toBeInTheDocument()
  })

  test('Given a populated response, renders streak days', async () => {
    respondDashboard(POPULATED_DASHBOARD)

    renderDashboard()

    expect(await screen.findByText(/5日連続/)).toBeInTheDocument()
  })

  test('Given a populated response, renders total_episodes labeled 生成済みエピソード数', async () => {
    respondDashboard(POPULATED_DASHBOARD)

    renderDashboard()

    expect(await screen.findByText('生成済みエピソード数')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  test('Given a populated response, renders vocabulary_acquired labeled 習得語彙数', async () => {
    respondDashboard(POPULATED_DASHBOARD)

    renderDashboard()

    expect(await screen.findByText('習得語彙数')).toBeInTheDocument()
    expect(screen.getByText('34')).toBeInTheDocument()
  })

  test('Given a populated response, renders quiz stats (quizzed_episodes + average_correct_rate) and trend labeled クイズ成績の推移', async () => {
    respondDashboard(POPULATED_DASHBOARD)

    renderDashboard()

    expect(await screen.findByText('クイズ成績の推移')).toBeInTheDocument()
    // quizzed_episodes=3・average_correct_rate=0.75(75%) の要約表示
    expect(screen.getByText('3件')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
    // trend の各点（正答率%表記）
    expect(screen.getByText('60%')).toBeInTheDocument()
    expect(screen.getByText('90%')).toBeInTheDocument()
  })

  test('Given a populated response, renders monthly_activity labeled 月別活動', async () => {
    respondDashboard(POPULATED_DASHBOARD)

    renderDashboard()

    expect(await screen.findByText('月別活動')).toBeInTheDocument()
    expect(screen.getByText('2026-07')).toBeInTheDocument()
    // WHY 完全一致文字列: 正規表現 /5日/ だと streak の「5日連続」ノードにも部分一致し
    // 複数要素ヒットで曖昧になるため、月別活動セルの厳密な表示文字列で検証する
    expect(screen.getByText('5日')).toBeInTheDocument()
  })

  test('Given a populated response, renders current_difficulty as a human-readable label', async () => {
    respondDashboard(POPULATED_DASHBOARD)

    renderDashboard()

    expect(await screen.findByText('TOEIC 600')).toBeInTheDocument()
  })

  test('renders weekly progress, factual history, and CSS activity bars without warning language', async () => {
    respondDashboard(POPULATED_DASHBOARD)

    renderDashboard()

    expect(await screen.findByText('今週 3/5 本')).toBeInTheDocument()
    expect(screen.getByText('目標: 5 → 実績: 4')).toBeInTheDocument()
    expect(screen.getAllByRole('meter').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText(/未達|失敗|あと.*本/)).not.toBeInTheDocument()
  })

  test('renders all seven catalog achievements with unlocked date and subdued locked entries', async () => {
    respondDashboard(POPULATED_DASHBOARD)

    renderDashboard()

    expect(await screen.findByText('実績')).toBeInTheDocument()
    expect(screen.getByText('初回エピソード完聴')).toBeInTheDocument()
    expect(screen.getByText('解錠: 2026-07-01')).toBeInTheDocument()
    expect(screen.getByText('100 日連続聴取')).toBeInTheDocument()
    expect(document.querySelectorAll('.achievement-item')).toHaveLength(7)
    expect(document.querySelectorAll('.achievement-item.locked')).toHaveLength(6)
  })

  test('detects only achievements added after the initial response and emits editorial toast + sound', async () => {
    respondDashboardInOrder(
      { ok: true, value: POPULATED_DASHBOARD },
      {
        ok: true,
        value: {
          ...POPULATED_DASHBOARD,
          achievements: [
            ...POPULATED_DASHBOARD.achievements,
            { id: 'first_quiz_correct', unlocked_at: '2026-07-29' },
          ],
        },
      },
    )

    // 初回の応答に含まれる解錠済み実績は「見た」扱いである、という前提を保存値で明示する
    renderDashboard({ seen_achievement_ids: JSON.stringify(['first_episode_completed']) })
    await screen.findByText('解錠: 2026-07-01')
    expect(showToast).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'ダッシュボードを再読み込み' }))

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('実績を解錠しました：初回クイズ正解', 'success')
    })
    expect(playSfx).toHaveBeenCalledWith('achievement')
  })

  test('seen_achievement_ids の保存値が壊れていれば空とみなし、解除済みの実績を音つきでトースト表示して既読として保存する', async () => {
    respondDashboard(POPULATED_DASHBOARD)

    const saved = renderDashboard({ seen_achievement_ids: 'not-json' })

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('実績を解錠しました：初回エピソード完聴', 'success')
    })
    expect(playSfx).toHaveBeenCalledWith('achievement')
    expect(JSON.parse(saved.get('seen_achievement_ids') ?? 'null')).toContain('first_episode_completed')
  })

  test('shows registered vocabulary count/latest five and hides the test link when no words are due', async () => {
    respondDashboard(POPULATED_DASHBOARD)
    gw.respond('GET', VOCABULARY_PATH, {
      ok: true,
      value: {
        count: 6,
        vocabulary: Array.from({ length: 6 }, (_, index) => ({
          vocabulary_id: `v${index}`,
          podcast_id: 'p1',
          term: `term-${index}`,
          meaning: `meaning-${index}`,
          example: `example-${index}`,
          registered_at: `2026-07-${29 - index}`,
        })),
      },
    })
    gw.respond('GET', TEST_SESSION_PATH, { ok: true, value: { items: [] } })

    renderDashboard()

    expect(await screen.findByText('登録語彙')).toBeInTheDocument()
    expect(screen.getByText('6 語')).toBeInTheDocument()
    expect(screen.getByText('term-0')).toBeInTheDocument()
    expect(screen.getByText('term-4')).toBeInTheDocument()
    expect(screen.queryByText('term-5')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '単語テスト' })).not.toBeInTheDocument()
  })

  test('shows the vocabulary test link when at least one due word exists', async () => {
    respondDashboard(EMPTY_DASHBOARD)
    gw.respond('GET', VOCABULARY_PATH, { ok: true, value: { count: 0, vocabulary: [] } })
    gw.respond('GET', TEST_SESSION_PATH, {
      ok: true,
      value: {
        items: [{
          vocabulary_id: 'v1',
          term: 'accelerate',
          meaning: '加速する',
          example: 'Sales accelerate.',
          distractors: [],
        }],
      },
    })

    renderDashboard()

    expect(await screen.findByRole('link', { name: '単語テスト' })).toHaveAttribute(
      'href',
      '/vocabulary-test',
    )
  })
})

describe('DashboardPage — graceful degradation', () => {
  test('Given a new-user (all-zero) response, renders without crashing', async () => {
    respondDashboard(EMPTY_DASHBOARD)

    renderDashboard()

    expect(await screen.findByText('ダッシュボード')).toBeInTheDocument()
    // ゼロ表示（クラッシュしない）
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)
  })

  test('Given fetch failure, renders without crashing and shows a neutral empty state', async () => {
    gw.respond('GET', DASHBOARD_PATH, { ok: false, failure: { kind: 'network' } })

    renderDashboard()

    expect(await screen.findByText('ダッシュボード')).toBeInTheDocument()
    expect(await screen.findByText(/取得できませんでした/)).toBeInTheDocument()
  })

  // ADR-072 決定5・決定8: fetch 失敗時は前回値を保持し、再試行導線を出す（settings の
  // quota/streak ローダーと同じ慣習）。null 上書きによる前回値の破棄は不具合として扱う。
  test('Given fetch failure, the retry button re-invokes getLearningDashboard and renders data on success', async () => {
    respondDashboardInOrder({ ok: false, failure: { kind: 'network' } }, { ok: true, value: POPULATED_DASHBOARD })

    renderDashboard()

    expect(await screen.findByText(/取得できませんでした/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /ダッシュボードを再読み込み/ }))

    expect(await screen.findByText(/5日連続/)).toBeInTheDocument()
    expect(callsTo('GET', DASHBOARD_PATH)).toHaveLength(2)
  })

  test('Given a successful load, a subsequent failed re-fetch does not blank the previously-shown dashboard', async () => {
    respondDashboardInOrder({ ok: true, value: POPULATED_DASHBOARD }, { ok: false, failure: { kind: 'network' } })

    renderDashboard()

    expect(await screen.findByText(/5日連続/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /ダッシュボードを再読み込み/ }))

    // 再取得が失敗しても、直前に表示していたダッシュボードは消えない（前回値保持）
    await screen.findByText(/最新のデータ取得に失敗しました/)
    expect(screen.getByText(/5日連続/)).toBeInTheDocument()
    expect(callsTo('GET', DASHBOARD_PATH)).toHaveLength(2)
  })
})
