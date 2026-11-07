import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, render as rtlRender, renderHook, screen, waitFor, within } from '@testing-library/react'
import type { RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import userEvent from '@testing-library/user-event'
import React from 'react'
import PodcastPage from '@/app/(app)/podcast/page'
import PodcastDetailPage from '@/app/(app)/podcast/[id]/page'
import { usePodcastListPolling } from '@/hooks/usePodcastListPolling'
import { formatDate } from '@/lib/format'
import { PreferencesProvider } from '@/contexts/PreferencesProvider'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'
import { ToastProvider } from '@/components/ui/Toast'
import type { ApiFailure, Result } from '@/lib/api/gateway'
import { createGatewayDouble } from '../../helpers/gatewayDouble'
import type { GatewayDouble } from '../../helpers/gatewayDouble'

const render = (ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) =>
  rtlRender(ui, { wrapper: ApiClientProvider, ...options })

// 設定の保存先は、テストごとに新しい in-memory の KeyValueStore
const memoryStore = (initial: Record<string, string> = {}): KeyValueStore => {
  const data = new Map(Object.entries(initial))
  return {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => {
      data.set(key, value)
      return true
    },
    remove: (key) => {
      data.delete(key)
    },
  }
}

const holder = vi.hoisted(() => ({ gw: undefined as GatewayDouble | undefined }))

vi.mock('@/lib/api/gateway', () => ({ createGateway: () => holder.gw }))

const PODCASTS_PATH = '/api/backend/podcasts'

let gw: GatewayDouble

function podcastListCalls() {
  return gw.calls.filter((c) => c.method === 'GET' && c.path === PODCASTS_PATH)
}

// ページは usePlayback() / usePlaybackActions() の公開面だけを使う。再生の振る舞いは PlaybackProvider.*.test.tsx が持つので、
// ここでは「どの操作がどの引数で委譲されるか」と「保存・位置・再生中の表示」を double で固定する。
const double = vi.hoisted(() => ({
  pb: {},
  actions: {},
}))

vi.mock('@/contexts/PlaybackProvider', () => ({ usePlayback: () => double.pb }))
vi.mock('@/components/PlaybackToasts', () => ({ usePlaybackActions: () => double.actions }))

const has = vi.fn<(id: string) => Promise<boolean>>()
const save = vi.fn<(id: string) => Promise<unknown>>()
const nowPlaying = vi.fn<() => { episodeId: string } | null>()
const savedPosition = vi.fn<(id: string) => number | null>()
const startEpisode = vi.fn()
const playNext = vi.fn()
const addToQueue = vi.fn()

const SAMPLE_PODCASTS = [
  {
    id: 'p1',
    type: 'single',
    article_ids: ['a1'],
    difficulty: 'toeic_900',
    audio_url: 'https://storage.example.com/audio.mp3',
    japanese_intro_text: 'これはテスト用のポッドキャストイントロです。',
    duration_seconds: 300,
    created_at: '2026-06-10T09:00:00+09:00',
    status: 'completed' as const,
    error_message: null,
    playback_position_seconds: 0,
  },
]

// 再生中強調（D24）の検証用: 複数カードのうち 1 枚だけが強調されることを確認する
const TWO_PODCASTS = [
  SAMPLE_PODCASTS[0],
  {
    id: 'p2',
    type: 'digest',
    article_ids: ['a2', 'a3'],
    difficulty: 'eiken_2',
    audio_url: 'https://storage.example.com/audio2.mp3',
    japanese_intro_text: '二つ目のポッドキャストのイントロです。',
    duration_seconds: 600,
    created_at: '2026-06-09T09:00:00+09:00',
    status: 'completed' as const,
    error_message: null,
    playback_position_seconds: 0,
  },
]

beforeEach(() => {
  gw = createGatewayDouble()
  holder.gw = gw
  vi.clearAllMocks()
  localStorage.clear()
  // 既定は「未保存・再生中なし・位置なし」。
  has.mockResolvedValue(false)
  save.mockResolvedValue({ ok: true, value: undefined })
  nowPlaying.mockReturnValue(null)
  savedPosition.mockReturnValue(null)
  startEpisode.mockResolvedValue({ ok: true })
  playNext.mockResolvedValue({ ok: true })
  addToQueue.mockResolvedValue({ ok: true })
  double.pb = { nowPlaying, savedPosition, offline: { has, save } }
  double.actions = { startEpisode, playNext, addToQueue }
})

function renderPodcastPage() {
  return render(
    <PreferencesProvider store={memoryStore()}>
      <ToastProvider>
        <PodcastPage />
      </ToastProvider>
    </PreferencesProvider>
  )
}

function givenPodcasts(podcasts: unknown[]) {
  gw.respond('GET', PODCASTS_PATH, { ok: true, value: { podcasts } })
}

// ==========================================================
// Podcast 一覧 — 表示
// ==========================================================
describe('PodcastPage — listing', () => {
  test('Given podcasts returned, renders podcast cards', async () => {
    gw.respond('GET', PODCASTS_PATH, { ok: true, value: { podcasts: SAMPLE_PODCASTS } })

    renderPodcastPage()

    await waitFor(() => {
      expect(screen.getByText(/これはテスト用のポッドキャストイントロ/)).toBeInTheDocument()
    })
  })

  test('Given empty podcasts array, displays empty state message', async () => {
    gw.respond('GET', PODCASTS_PATH, { ok: true, value: { podcasts: [] } })

    renderPodcastPage()

    await waitFor(() => {
      expect(screen.getByText(/Podcast がまだありません/)).toBeInTheDocument()
      expect(screen.getByText(/Star/)).toBeInTheDocument()
    })
  })

  test('Given loading state, shows skeleton', () => {
    gw.respondWith('GET', PODCASTS_PATH, () => new Promise<Result<unknown, ApiFailure>>(() => {}))

    renderPodcastPage()

    expect(screen.getByTestId('skeleton-card')).toBeInTheDocument()
  })
})

// ==========================================================
// Podcast 一覧 — 再生・キュー操作（QueueEntryInput への写しはページの責務）
// ==========================================================
describe('PodcastPage — playback actions', () => {
  test('再生ボタンは usePlaybackActions().startEpisode(id) を呼ぶ (verifies: CI-P4-30)', async () => {
    givenPodcasts(SAMPLE_PODCASTS)
    renderPodcastPage()
    await waitFor(() => screen.getByText(/これはテスト用のポッドキャストイントロ/))

    await userEvent.click(screen.getByRole('button', { name: '再生' }))

    expect(startEpisode).toHaveBeenCalledTimes(1)
    expect(startEpisode).toHaveBeenCalledWith('p1')
  })

  test.each([
    ['次に再生', () => playNext],
    ['キューに追加', () => addToQueue],
  ])('「%s」は { id, title, intro } を渡す。title が無ければ null (verifies: CI-P4-30; web-temp-07)', async (label, target) => {
    givenPodcasts([{ ...SAMPLE_PODCASTS[0], title: 'テスト題' }, TWO_PODCASTS[1]])
    renderPodcastPage()
    await waitFor(() => screen.getByText(/二つ目のポッドキャストのイントロ/))

    const buttons = screen.getAllByRole('button', { name: label })
    await userEvent.click(buttons[0])
    await userEvent.click(buttons[1])

    expect(target().mock.calls).toEqual([
      [{ id: 'p1', title: 'テスト題', intro: 'これはテスト用のポッドキャストイントロです。' }],
      [{ id: 'p2', title: null, intro: '二つ目のポッドキャストのイントロです。' }],
    ])
  })

  test('端末に位置が保存されていれば「続きから」を出し、null なら出さない (verifies: CI-P4-30)', async () => {
    savedPosition.mockImplementation((id) => (id === 'p1' ? 120 : null))
    givenPodcasts(TWO_PODCASTS)
    renderPodcastPage()
    await waitFor(() => screen.getByText(/二つ目のポッドキャストのイントロ/))

    expect(screen.getAllByText(/続きから/)).toHaveLength(1)
    expect(screen.getByText('続きから 2:00')).toBeInTheDocument()
  })
})

// ==========================================================
// Podcast 一覧 — 再生中強調（D24）
// ==========================================================
describe('PodcastPage — playing highlight (D24)', () => {
  test('nowPlaying() が podcast A なら、A のカードだけに「再生中」が出る (verifies: CI-P4-30)', async () => {
    nowPlaying.mockReturnValue({ episodeId: 'p1' })
    givenPodcasts(TWO_PODCASTS)

    renderPodcastPage()

    await waitFor(() => {
      expect(screen.getByText(/二つ目のポッドキャストのイントロ/)).toBeInTheDocument()
    })

    // 「再生中」表示は nowPlaying() の episodeId に一致するカード 1 枚のみ
    const playingLabels = screen.getAllByText('再生中')
    expect(playingLabels).toHaveLength(1)
    expect(playingLabels[0].closest('.podcast-card')).toHaveTextContent(
      /これはテスト用のポッドキャストイントロ/
    )
  })

  test('nowPlaying() が null なら、どのカードにも「再生中」は出ない (verifies: CI-P4-30)', async () => {
    givenPodcasts(TWO_PODCASTS)

    renderPodcastPage()

    await waitFor(() => {
      expect(screen.getByText(/二つ目のポッドキャストのイントロ/)).toBeInTheDocument()
    })

    expect(screen.queryByText('再生中')).not.toBeInTheDocument()
  })
})

// ==========================================================
// Podcast 一覧 — リフレッシュボタン
// ==========================================================
describe('PodcastPage — refresh', () => {
  test('Given refresh button clicked, calls getPodcasts again', async () => {
    gw.respond('GET', PODCASTS_PATH, { ok: true, value: { podcasts: SAMPLE_PODCASTS } })

    renderPodcastPage()
    await waitFor(() => screen.getByText(/これはテスト用のポッドキャストイントロ/))

    const initialCallCount = podcastListCalls().length
    await userEvent.click(screen.getByRole('button', { name: /リフレッシュ|更新|refresh/i }))

    // Refresh button should trigger at least one more call (polling may also call in background)
    expect(podcastListCalls().length).toBeGreaterThan(initialCallCount)
  })
})

// ==========================================================
// Podcast 一覧 — ポーリング（#11 生成完了待ち）
// ==========================================================
describe('PodcastPage — polling for new podcasts (#11)', () => {
  test('Polling hook is used and enabled on mount', async () => {
    gw.respond('GET', PODCASTS_PATH, { ok: true, value: { podcasts: SAMPLE_PODCASTS } })

    renderPodcastPage()

    // Polling should be enabled on mount: fetchPodcasts called for initial load
    // plus polling calls will increment over time. Just verify it starts.
    await waitFor(() => {
      expect(podcastListCalls().length).toBeGreaterThan(0)
    })
  })

  test('Page renders list after initial fetch completes', async () => {
    gw.respond('GET', PODCASTS_PATH, { ok: true, value: { podcasts: SAMPLE_PODCASTS } })

    renderPodcastPage()

    await waitFor(() => {
      expect(screen.getByText(/これはテスト用のポッドキャストイントロ/)).toBeInTheDocument()
    })
  })
})

// ==========================================================
// Podcast 一覧 — オフライン保存（issue #167）
// ==========================================================
describe('PodcastPage — offline download (issue #167)', () => {
  test('shows an オフライン保存 button on each card when not saved', async () => {
    givenPodcasts(SAMPLE_PODCASTS)

    renderPodcastPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'オフライン保存' })).toBeInTheDocument()
    })
  })

  test('保存に成功すると offline.save(id) を呼び、そのカードを「保存済み」にする (verifies: CI-P4-30)', async () => {
    givenPodcasts(SAMPLE_PODCASTS)
    renderPodcastPage()
    await waitFor(() => screen.getByRole('button', { name: 'オフライン保存' }))

    await userEvent.click(screen.getByRole('button', { name: 'オフライン保存' }))

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('p1')
    await waitFor(() => {
      expect(screen.getByText('保存済み')).toBeInTheDocument()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test.each([
    ['{ ok: false } を返す', () => save.mockResolvedValue({ ok: false, failure: { kind: 'storage_full' } })],
    ['reject する', () => save.mockRejectedValue(new Error('save failed'))],
  ])('保存が %s と、toast「オフライン保存に失敗しました」を出し、保存済みにしない (verifies: CI-P4-30)', async (_name, arrange) => {
    arrange()
    givenPodcasts(SAMPLE_PODCASTS)
    renderPodcastPage()
    await waitFor(() => screen.getByRole('button', { name: 'オフライン保存' }))

    await userEvent.click(screen.getByRole('button', { name: 'オフライン保存' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('オフライン保存に失敗しました'))
    expect(screen.queryByText('保存済み')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'オフライン保存' })).toBeInTheDocument()
  })

  test('offline.has が true の回は、最初から「保存済み」で再保存しない (verifies: CI-P4-30)', async () => {
    has.mockResolvedValue(true)
    givenPodcasts(SAMPLE_PODCASTS)

    renderPodcastPage()

    await waitFor(() => {
      expect(screen.getByText('保存済み')).toBeInTheDocument()
    })
    expect(save).not.toHaveBeenCalled()
  })

  test('offline.has が reject しても、一覧は描かれて保存ボタンが出続ける (verifies: CI-P4-30)', async () => {
    has.mockRejectedValue(new Error('cache open failed'))
    givenPodcasts(SAMPLE_PODCASTS)

    renderPodcastPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'オフライン保存' })).toBeInTheDocument()
    })
  })

  // 回帰テスト: E2E (e2e/main-flow.e2e.ts) が実ブラウザで無限レンダーループに陥り
  // タイムアウトしていた不具合の再現。原因は、このキャッシュ有無チェック用 useEffect が
  // `podcasts`（配列の参照）を依存配列に持つこと。getPodcasts() は HTTP 経由の JSON レスポンス
  // なので毎回新しい配列参照を返す（内容が同じでも `Object.is` では別物）。usePodcastListPolling
  // 側には既存の別バグ（onUpdate がインラインなので poll の再生成→即時再実行を誘発する）があり、
  // このコンポーネントが「内容が同じでも参照が変わるたびに再実行される」経路を持つと、その既存バグと
  // 相互作用して再レンダーの連鎖が実質無限ループ化する。テストでは fetch の都度、内容は同じだが
  // 参照が異なる配列を返すモックで再現する。
  test('does not run away re-checking cache status when podcasts array reference changes without content changes (regression)', async () => {
    gw.respondWith('GET', PODCASTS_PATH, async () => ({ ok: true, value: { podcasts: [...SAMPLE_PODCASTS] } }))

    renderPodcastPage()

    await waitFor(() => {
      expect(screen.getByText(/これはテスト用のポッドキャストイントロ/)).toBeInTheDocument()
    })

    // POLL_INTERVAL_MS (5000ms) より十分短い実時間だけ待つ。正常なケースでは
    // この間に追加のポーリングは発生しないはず。暴走時はマイクロタスク駆動で
    // 数百〜数千回呼ばれる。
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(podcastListCalls().length).toBeLessThanOrEqual(2)
  })
})

  describe('生成完了の視覚演出（修正 4）', () => {
    test('初回ロードでは just-completed クラスが付かない', async () => {
      // 初期状態で completed の podcast
      const INITIAL = [{ ...SAMPLE_PODCASTS[0], id: 'p1', status: 'completed' as const }]
      gw.respond('GET', PODCASTS_PATH, { ok: true, value: { podcasts: INITIAL } })

      renderPodcastPage()
      await waitFor(() => {
        expect(screen.getByTestId('podcast-card-p1')).toBeInTheDocument()
      })

      // 初回ロードでは completed でも just-completed クラスは付かない
      const card = screen.getByTestId('podcast-card-p1')
      expect(card).not.toHaveClass('just-completed')
    })
  })

// ==========================================================
// Podcast 一覧 — Episode 種別の描き分け（verifies: web-contract-14; web-test-15）
// page が各 DTO から decodeEpisode で Episode を作り、種別ごとに▶・操作・失敗の文言を描き分ける。
// 生成中（processing）の DTO を含むので、既存のポーリングのテストと同じく fake timer は使わない
// （getPodcasts の mock は常に同じ fixture を返すので、待ちの間にポーリングが割り込んでも描画は変わらない）。
// ==========================================================
describe('PodcastPage — Episode kinds (web-contract-14)', () => {
  const base = SAMPLE_PODCASTS[0]
  const KIND_PODCASTS = [
    { ...base, id: 'ok-1', japanese_intro_text: '完成した回のイントロです。' },
    { ...base, id: 'gen-1', japanese_intro_text: '生成中の回のイントロです。', status: 'processing' as const, audio_url: '' },
    {
      ...base,
      id: 'quota-1',
      japanese_intro_text: '上限で失敗した回のイントロです。',
      status: 'failed' as const,
      error_message: 'quota_exhausted',
    },
    {
      ...base,
      id: 'part-1',
      japanese_intro_text: '一部失敗した回のイントロです。',
      status: 'partial_failed' as const,
      error_message: 'free text from backend',
    },
    { ...base, id: 'empty-1', japanese_intro_text: '音声が空の回のイントロです。', audio_url: '' },
  ]

  async function renderKinds() {
    givenPodcasts(KIND_PODCASTS)
    renderPodcastPage()
    await waitFor(() => screen.getByText(/完成した回のイントロ/))
    return (id: string) => within(screen.getByTestId(`podcast-card-${id}`))
  }

  test('shared-session-08: 生成中・失敗・矛盾 DTO のカードに▶・次に再生・キューに追加・オフライン保存が無い', async () => {
    const card = await renderKinds()

    for (const id of ['gen-1', 'quota-1', 'part-1', 'empty-1']) {
      expect(card(id).queryByRole('button', { name: '再生' }), `${id}: 再生`).not.toBeInTheDocument()
      expect(card(id).queryByRole('button', { name: '次に再生' }), `${id}: 次に再生`).not.toBeInTheDocument()
      expect(card(id).queryByRole('button', { name: 'キューに追加' }), `${id}: キューに追加`).not.toBeInTheDocument()
      expect(card(id).queryByRole('button', { name: 'オフライン保存' }), `${id}: オフライン保存`).not.toBeInTheDocument()
    }
  })

  test('正方向対照: 完成したカードには▶・次に再生・キューに追加・オフライン保存が出る。画面全体でも▶は 1 つだけ', async () => {
    const card = await renderKinds()

    expect(card('ok-1').getByRole('button', { name: '再生' })).toBeInTheDocument()
    expect(card('ok-1').getByRole('button', { name: '次に再生' })).toBeInTheDocument()
    expect(card('ok-1').getByRole('button', { name: 'キューに追加' })).toBeInTheDocument()
    expect(card('ok-1').getByRole('button', { name: 'オフライン保存' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '再生' })).toHaveLength(1)
  })

  test('完成したカードの▶は、他のカードが並んでいても自分の id で startEpisode を呼ぶ', async () => {
    const card = await renderKinds()

    await userEvent.click(card('ok-1').getByRole('button', { name: '再生' }))

    expect(startEpisode).toHaveBeenCalledTimes(1)
    expect(startEpisode).toHaveBeenCalledWith('ok-1')
  })

  test('shared-session-08・shared-session-09: 失敗系のカードに、その DTO の id の失敗の文言が出る（quota_exhausted・partial_failed・矛盾 DTO）', async () => {
    const card = await renderKinds()

    expect(card('quota-1').getByTestId('podcast-failure-message-quota-1')).toHaveTextContent(
      '生成の上限に達したため、生成できませんでした',
    )
    expect(card('part-1').getByTestId('podcast-failure-message-part-1')).toHaveTextContent('生成に失敗しました')
    expect(card('empty-1').getByTestId('podcast-failure-message-empty-1')).toHaveTextContent('生成に失敗しました')
  })

  test('完成・生成中のカードには失敗の文言が無い。失敗の文言は全体で 3 つだけ', async () => {
    const card = await renderKinds()

    expect(card('ok-1').queryByTestId('podcast-failure-message-ok-1')).not.toBeInTheDocument()
    expect(card('gen-1').queryByTestId('podcast-failure-message-gen-1')).not.toBeInTheDocument()
    expect(screen.getAllByTestId(/^podcast-failure-message-/)).toHaveLength(3)
  })

  test('shared-session-09: partial_failed のバッジは「失敗」で、「一部失敗」は画面のどこにも出ない', async () => {
    const card = await renderKinds()

    expect(card('part-1').getByText('失敗')).toBeInTheDocument()
    expect(screen.queryByText('一部失敗')).not.toBeInTheDocument()
    expect(card('gen-1').getByText('生成中')).toBeInTheDocument()
    expect(card('ok-1').getByText('完成')).toBeInTheDocument()
  })
})

// ==========================================================
// 以下は web-slice-catalog-02 で追加した特性テスト（挙動の pin）。
// 一覧・詳細 page の取得失敗の toast、完了の検知（web-usecase-19）、ポーリングの停止の配線を、
// 一覧・詳細を DTO で持つ現行の実装でも、リードモデルを読む実装でも同じ結果で固定する。
// 応答は毎回「内容が同じでも参照が新しい配列」で登録する（gw.respond は同じ配列参照を返し続けるため、
// 同じ参照だと setPodcasts が bail out して再取得の影響が見えない）。
// ==========================================================
const DETAIL_PATH = '/api/backend/podcasts/p1'

afterEach(() => {
  vi.useRealTimers()
})

type SamplePodcast = Record<string, unknown>

function respondFresh(podcasts: ReadonlyArray<SamplePodcast>) {
  gw.respond('GET', PODCASTS_PATH, { ok: true, value: { podcasts: podcasts.map((p) => ({ ...p })) } })
}

const refreshButton = () => screen.getByRole('button', { name: 'リフレッシュ' })

/** 実時間: 保留中の promise を流す。 */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

/** fake timer: ms だけ進め、その間に解決する promise と描画を流す。 */
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

const processing = (overrides: SamplePodcast = {}) => ({
  ...SAMPLE_PODCASTS[0],
  status: 'processing' as const,
  audio_url: '',
  ...overrides,
})
const completed = (overrides: SamplePodcast = {}) => ({ ...SAMPLE_PODCASTS[0], status: 'completed' as const, ...overrides })
const card = (id = 'p1') => screen.getByTestId(`podcast-card-${id}`)

// ==========================================================
// 一覧 — 取得の失敗
// ==========================================================
describe('PodcastPage — fetch failures (verifies: CI-P1)', () => {
  test('一覧が server 503 のとき toast「エラーが発生しました (503)」を出し、skeleton は消えて空の表示になる', async () => {
    gw.respond('GET', PODCASTS_PATH, { ok: false, failure: { kind: 'server', status: 503 } })

    renderPodcastPage()

    expect((await screen.findAllByText('エラーが発生しました (503)')).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.getByText(/Podcast がまだありません/)).toBeInTheDocument())
    expect(screen.queryByTestId('skeleton-card')).not.toBeInTheDocument()
  })

  test('一覧が network のとき toast「エラーが発生しました」を出す（status を付けない）', async () => {
    gw.respond('GET', PODCASTS_PATH, { ok: false, failure: { kind: 'network' } })

    renderPodcastPage()

    expect((await screen.findAllByText('エラーが発生しました')).length).toBeGreaterThan(0)
    expect(screen.queryByText(/エラーが発生しました \(/)).not.toBeInTheDocument()
  })

  test('一覧が unknown 418 のとき toast「エラーが発生しました (418)」を出す', async () => {
    gw.respond('GET', PODCASTS_PATH, { ok: false, failure: { kind: 'unknown', status: 418 } })

    renderPodcastPage()

    expect((await screen.findAllByText('エラーが発生しました (418)')).length).toBeGreaterThan(0)
  })

  test('一覧の取得が reject したとき toast は出さず、空の表示になる', async () => {
    gw.respondWith('GET', PODCASTS_PATH, () => Promise.reject(new Error('boom')))

    renderPodcastPage()

    await waitFor(() => expect(screen.getByText(/Podcast がまだありません/)).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('描画後の再取得が server 500 で失敗しても、toast を出して表示中のカードを残す', async () => {
    respondFresh([SAMPLE_PODCASTS[0]])
    renderPodcastPage()
    await waitFor(() => screen.getByText(/これはテスト用のポッドキャストイントロ/))
    await waitFor(() => expect(podcastListCalls().length).toBeGreaterThanOrEqual(2))
    await settle()

    gw.respond('GET', PODCASTS_PATH, { ok: false, failure: { kind: 'server', status: 500 } })
    fireEvent.click(refreshButton())

    expect((await screen.findAllByText('エラーが発生しました (500)')).length).toBeGreaterThan(0)
    expect(card('p1')).toBeInTheDocument()
    expect(screen.queryByText(/Podcast がまだありません/)).not.toBeInTheDocument()
  })

  test('描画後の再取得が reject しても、表示中のカードを残し、toast は出さない', async () => {
    respondFresh([SAMPLE_PODCASTS[0]])
    renderPodcastPage()
    await waitFor(() => screen.getByText(/これはテスト用のポッドキャストイントロ/))
    await waitFor(() => expect(podcastListCalls().length).toBeGreaterThanOrEqual(2))
    await settle()
    const before = podcastListCalls().length

    gw.respondWith('GET', PODCASTS_PATH, () => Promise.reject(new Error('boom')))
    fireEvent.click(refreshButton())
    await waitFor(() => expect(podcastListCalls().length).toBeGreaterThan(before))
    await settle()

    expect(card('p1')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

// ==========================================================
// 一覧 — キャッシュ確認は id の集合が変わるときだけ（render storm の回帰防止）
// ==========================================================
describe('PodcastPage — cache check follows the set of ids (verifies: CI-P1)', () => {
  test('内容が同じで参照が新しい応答では offline.has を呼び直さず、id が増えると呼び直す', async () => {
    respondFresh([SAMPLE_PODCASTS[0]])
    renderPodcastPage()
    await waitFor(() => screen.getByText(/これはテスト用のポッドキャストイントロ/))
    await waitFor(() => expect(podcastListCalls().length).toBeGreaterThanOrEqual(2))
    await settle()
    const baseline = has.mock.calls.length
    expect(baseline).toBeGreaterThan(0)

    for (let i = 0; i < 2; i++) {
      respondFresh([SAMPLE_PODCASTS[0]])
      const before = podcastListCalls().length
      fireEvent.click(refreshButton())
      await waitFor(() => expect(podcastListCalls().length).toBeGreaterThan(before))
      await settle()
    }
    expect(has).toHaveBeenCalledTimes(baseline)

    // 正方向対照: id が増えると確認し直す
    respondFresh(TWO_PODCASTS)
    fireEvent.click(refreshButton())
    await waitFor(() => expect(has.mock.calls.length).toBeGreaterThan(baseline))
  })
})

describe('PodcastPage — card title (verifies: CI-P1, CI-P5)', () => {
  test('title を持つ DTO でも、その題はカードに描かない（導入文は描く）', async () => {
    respondFresh([{ ...SAMPLE_PODCASTS[0], title: '特別な題' }])

    renderPodcastPage()

    await waitFor(() => screen.getByText(/これはテスト用のポッドキャストイントロ/))
    await settle()
    expect(screen.queryByText(/特別な題/)).not.toBeInTheDocument()
  })
})

// ==========================================================
// 一覧 — 生成の完了の検知（web-usecase-19）
// 1 回目の応答で描画 → 応答を差し替えて「リフレッシュ」→ just-completed の有無を見る。
// ==========================================================
describe('PodcastPage — generation completion detection (web-usecase-19)', () => {
  async function renderWith(initial: ReadonlyArray<SamplePodcast>) {
    respondFresh(initial)
    renderPodcastPage()
    await waitFor(() => screen.getByTestId(`podcast-card-${String(initial[0].id)}`))
    await waitFor(() => expect(podcastListCalls().length).toBeGreaterThanOrEqual(2))
    await settle()
  }

  test('web-usecase-19: processing → completed になったカードに just-completed が付く', async () => {
    await renderWith([processing()])
    expect(card('p1')).not.toHaveClass('just-completed')

    respondFresh([completed()])
    fireEvent.click(refreshButton())

    await waitFor(() => expect(card('p1')).toHaveClass('just-completed'))
  })

  test('web-usecase-19: failed → completed になったカードに just-completed が付く', async () => {
    await renderWith([{ ...SAMPLE_PODCASTS[0], status: 'failed', error_message: 'generation_failed' }])
    expect(card('p1')).not.toHaveClass('just-completed')

    respondFresh([completed()])
    fireEvent.click(refreshButton())

    await waitFor(() => expect(card('p1')).toHaveClass('just-completed'))
  })

  test('web-usecase-19: 新しく現れた completed の id のカードにだけ just-completed が付き、既存のカードには付かない', async () => {
    await renderWith([TWO_PODCASTS[0]])

    respondFresh(TWO_PODCASTS)
    fireEvent.click(refreshButton())

    await waitFor(() => expect(card('p2')).toHaveClass('just-completed'))
    expect(card('p1')).not.toHaveClass('just-completed')
  })

  test('web-usecase-19: 対照 — completed → completed は本文が更新されても just-completed を付けない', async () => {
    await renderWith([completed()])

    respondFresh([completed({ japanese_intro_text: '更新された本文です。' })])
    fireEvent.click(refreshButton())

    await waitFor(() => expect(screen.getByText(/更新された本文です/)).toBeInTheDocument())
    await settle()
    expect(card('p1')).not.toHaveClass('just-completed')
  })

  test('web-usecase-19: processing → completed で audio_url が空なら、just-completed が付き、失敗の文言が出る', async () => {
    await renderWith([processing()])
    expect(screen.queryByTestId('podcast-failure-message-p1')).not.toBeInTheDocument()

    respondFresh([completed({ audio_url: '' })])
    fireEvent.click(refreshButton())

    await waitFor(() => expect(card('p1')).toHaveClass('just-completed'))
    expect(screen.getByTestId('podcast-failure-message-p1')).toHaveTextContent('生成に失敗しました')
  })
})

describe('PodcastPage — completion detection timing (web-usecase-19)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  async function renderWith(initial: ReadonlyArray<SamplePodcast>) {
    respondFresh(initial)
    renderPodcastPage()
    await advance(0)
  }

  async function refreshWith(podcasts: ReadonlyArray<SamplePodcast>) {
    respondFresh(podcasts)
    fireEvent.click(refreshButton())
    await advance(0)
  }

  test('web-usecase-19: 検知時に前回の状態を更新しない — 1500ms で消えた後、新しい応答で「リフレッシュ」すると同じ id を再び検知する（現行の挙動）', async () => {
    await renderWith([processing()])
    await refreshWith([completed()])
    expect(card('p1')).toHaveClass('just-completed')

    await advance(1500)
    expect(card('p1')).not.toHaveClass('just-completed')

    await refreshWith([completed()])
    expect(card('p1')).toHaveClass('just-completed')
  })

  test('web-usecase-19: 演出の timer は再検知のたびに作り直される — 古い timer が新しい演出を途中で消さない', async () => {
    await renderWith([processing()])
    await refreshWith([completed()]) // t=0 で検知
    await advance(1000)
    await refreshWith([completed()]) // t=1000 で再検知。古い timer（1500）は止まり、新しい timer は 2500
    await advance(1000) // t=2000: 古い timer が残っていれば 1500 で消えている
    expect(card('p1')).toHaveClass('just-completed')

    await advance(600) // t=2600: 新しい timer（2500）で消える
    expect(card('p1')).not.toHaveClass('just-completed')
  })

  test('web-usecase-19: 演出は検知の直後から 1499ms まで付き、1ms 後（1500ms）に消える', async () => {
    await renderWith([processing()])
    await refreshWith([completed()])
    expect(card('p1')).toHaveClass('just-completed')

    await advance(1499)
    expect(card('p1')).toHaveClass('just-completed')

    await advance(1)
    expect(card('p1')).not.toHaveClass('just-completed')
  })

  test('web-usecase-19: 空の一覧を挟んでも前回の状態を保つ — processing → [] → completed で検知する', async () => {
    await renderWith([processing()])

    await refreshWith([])
    expect(screen.getByText(/Podcast がまだありません/)).toBeInTheDocument()

    await refreshWith([completed()])
    expect(card('p1')).toHaveClass('just-completed')
  })

  test('web-usecase-19: 検知しない取得でも前回の状態を更新する — completed → processing → completed は 2 回目で付かず、3 回目で付く', async () => {
    await renderWith([completed()])

    await refreshWith([processing()])
    expect(card('p1')).not.toHaveClass('just-completed')

    await refreshWith([completed()])
    expect(card('p1')).toHaveClass('just-completed')
  })
})

// ==========================================================
// 詳細 page — 取得の失敗・種別・日付
// ==========================================================
describe('PodcastDetailPage — fetch failures and fields (verifies: CI-P4)', () => {
  function renderDetailPage() {
    return render(
      <PreferencesProvider store={memoryStore()}>
        <ToastProvider>
          <PodcastDetailPage params={Promise.resolve({ id: 'p1' })} />
        </ToastProvider>
      </PreferencesProvider>
    )
  }

  test('詳細が server 503 のとき toast「読み込みに失敗しました」を出す', async () => {
    gw.respond('GET', DETAIL_PATH, { ok: false, failure: { kind: 'server', status: 503 } })

    renderDetailPage()

    expect((await screen.findAllByText('読み込みに失敗しました')).length).toBeGreaterThan(0)
  })

  test('詳細の取得が reject したとき、同じ toast「読み込みに失敗しました」を出す', async () => {
    gw.respondWith('GET', DETAIL_PATH, () => Promise.reject(new Error('boom')))

    renderDetailPage()

    expect((await screen.findAllByText('読み込みに失敗しました')).length).toBeGreaterThan(0)
  })

  test('type が digest の詳細では DIGEST のタグと作成日を描く（正方向対照: digest でなければ DIGEST を描かない）', async () => {
    const created = '2026-06-10T12:00:00Z'
    gw.respond('GET', DETAIL_PATH, { ok: true, value: { ...SAMPLE_PODCASTS[0], type: 'digest', created_at: created } })

    const { unmount } = renderDetailPage()

    await waitFor(() => expect(screen.getByText('DIGEST')).toBeInTheDocument())
    expect(screen.getByText(formatDate(created))).toBeInTheDocument()
    unmount()

    gw.respond('GET', DETAIL_PATH, { ok: true, value: { ...SAMPLE_PODCASTS[0], type: 'single', created_at: created } })
    renderDetailPage()
    await waitFor(() => expect(screen.getByText(formatDate(created))).toBeInTheDocument())
    expect(screen.queryByText('DIGEST')).not.toBeInTheDocument()
  })

  test('詳細が not_found のとき「エピソードが見つかりません」を出し、toast は出さない', async () => {
    gw.respond('GET', DETAIL_PATH, { ok: false, failure: { kind: 'not_found', subject: 'podcast' } })

    renderDetailPage()

    await waitFor(() => expect(screen.getByText('エピソードが見つかりません')).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

// ==========================================================
// ポーリングの停止の配線。fake timer で 5 秒間隔・件数の増加・120 秒の停止を pin する。
// ==========================================================
describe('PodcastPage — polling stop wiring (verifies: CI-P1, CI-P6)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  test('件数が増えると次の 5 秒の取得で 2 枚目が描かれ、その後は取得が増えない', async () => {
    respondFresh([TWO_PODCASTS[0]])
    renderPodcastPage()
    await advance(0)
    expect(screen.queryByTestId('podcast-card-p2')).not.toBeInTheDocument()

    respondFresh(TWO_PODCASTS)
    await advance(5000)
    expect(screen.getByTestId('podcast-card-p2')).toBeInTheDocument()

    const calls = podcastListCalls().length
    await advance(20000)
    expect(podcastListCalls().length).toBe(calls)
  })

  test('件数が一定なら 120 秒の取得で停止し、その後は取得が増えない（115 秒までは継続、次の 5 秒で 1 回増える）', async () => {
    respondFresh([SAMPLE_PODCASTS[0]])
    renderPodcastPage()
    await advance(0)

    await advance(115000)
    const beforeTimeout = podcastListCalls().length

    await advance(5000)
    expect(podcastListCalls().length).toBe(beforeTimeout + 1)

    await advance(20000)
    expect(podcastListCalls().length).toBe(beforeTimeout + 1)
  })

  test('起動時の取得が失敗（server 500）でも、基準は 0 件になり、次に 1 件取れたら停止する', async () => {
    gw.respond('GET', PODCASTS_PATH, { ok: false, failure: { kind: 'server', status: 500 } })
    renderPodcastPage()
    await advance(0)

    respondFresh([SAMPLE_PODCASTS[0]])
    await advance(5000)
    expect(screen.getByTestId('podcast-card-p1')).toBeInTheDocument()

    const calls = podcastListCalls().length
    await advance(20000)
    expect(podcastListCalls().length).toBe(calls)
  })

  test('起動時の取得が reject でも、基準は 0 件になり、次に 1 件取れたら停止する', async () => {
    let rejecting = true
    gw.respondWith('GET', PODCASTS_PATH, () =>
      rejecting
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ ok: true as const, value: { podcasts: [{ ...SAMPLE_PODCASTS[0] }] } }),
    )
    renderPodcastPage()
    await advance(0)

    rejecting = false
    await advance(5000)
    expect(screen.getByTestId('podcast-card-p1')).toBeInTheDocument()

    const calls = podcastListCalls().length
    await advance(20000)
    expect(podcastListCalls().length).toBe(calls)
  })
})

describe('usePodcastListPolling — stops itself and notifies (verifies: CI-P6)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  test('enabled を変えない呼出元でも、停止の判定が真になれば onUpdate を 1 回呼び、自分で interval を止める', async () => {
    let count = 1
    const fetchPodcasts = vi.fn(() => Promise.resolve({ podcasts: Array.from({ length: count }, (_, i) => ({ id: `p${i}` })) }))
    const onUpdate = vi.fn()
    renderHook(() => usePodcastListPolling({ fetchPodcasts, onUpdate, enabled: true }))
    await advance(0)

    await advance(5000)
    expect(onUpdate).not.toHaveBeenCalled()

    count = 2
    await advance(5000)
    expect(onUpdate).toHaveBeenCalledTimes(1)

    const calls = fetchPodcasts.mock.calls.length
    await advance(20000)
    expect(fetchPodcasts).toHaveBeenCalledTimes(calls)
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })
})
