import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import PodcastPage from '@/app/(app)/podcast/page'
import { PreferencesProvider } from '@/contexts/PreferencesProvider'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'
import { ToastProvider } from '@/components/ui/Toast'

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

vi.mock('@/lib/api', () => ({
  createApiClient: vi.fn(() => ({
    getPodcasts: vi.fn(),
    getPodcast: vi.fn(),
  })),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public detail: string) {
      super(detail)
    }
  },
}))

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

async function givenPodcasts(podcasts: unknown[]) {
  const { createApiClient } = await import('@/lib/api')
  vi.mocked(createApiClient).mockReturnValue({
    getPodcasts: vi.fn().mockResolvedValue({ podcasts }),
    getPodcast: vi.fn(),
  } as unknown as ReturnType<typeof createApiClient>)
}

// ==========================================================
// Podcast 一覧 — 表示
// ==========================================================
describe('PodcastPage — listing', () => {
  test('Given podcasts returned, renders podcast cards', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcasts: vi.fn().mockResolvedValue({ podcasts: SAMPLE_PODCASTS }),
      getPodcast: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderPodcastPage()

    await waitFor(() => {
      expect(screen.getByText(/これはテスト用のポッドキャストイントロ/)).toBeInTheDocument()
    })
  })

  test('Given empty podcasts array, displays empty state message', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcasts: vi.fn().mockResolvedValue({ podcasts: [] }),
      getPodcast: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderPodcastPage()

    await waitFor(() => {
      expect(screen.getByText(/Podcast がまだありません/)).toBeInTheDocument()
      expect(screen.getByText(/Star/)).toBeInTheDocument()
    })
  })

  test('Given loading state, shows skeleton', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcasts: vi.fn(() => new Promise(() => {})),
      getPodcast: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderPodcastPage()

    expect(screen.getByTestId('skeleton-card')).toBeInTheDocument()
  })
})

// ==========================================================
// Podcast 一覧 — 再生・キュー操作（QueueEntryInput への写しはページの責務）
// ==========================================================
describe('PodcastPage — playback actions', () => {
  test('再生ボタンは usePlaybackActions().startEpisode(id) を呼ぶ (verifies: CI-P4-30)', async () => {
    await givenPodcasts(SAMPLE_PODCASTS)
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
    await givenPodcasts([{ ...SAMPLE_PODCASTS[0], title: 'テスト題' }, TWO_PODCASTS[1]])
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
    await givenPodcasts(TWO_PODCASTS)
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
    await givenPodcasts(TWO_PODCASTS)

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
    await givenPodcasts(TWO_PODCASTS)

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
    const getPodcasts = vi.fn().mockResolvedValue({ podcasts: SAMPLE_PODCASTS })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcasts,
      getPodcast: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderPodcastPage()
    await waitFor(() => screen.getByText(/これはテスト用のポッドキャストイントロ/))

    const initialCallCount = getPodcasts.mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: /リフレッシュ|更新|refresh/i }))

    // Refresh button should trigger at least one more call (polling may also call in background)
    expect(getPodcasts.mock.calls.length).toBeGreaterThan(initialCallCount)
  })
})

// ==========================================================
// Podcast 一覧 — ポーリング（#11 生成完了待ち）
// ==========================================================
describe('PodcastPage — polling for new podcasts (#11)', () => {
  test('Polling hook is used and enabled on mount', async () => {
    const getPodcasts = vi.fn().mockResolvedValue({ podcasts: SAMPLE_PODCASTS })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcasts,
      getPodcast: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderPodcastPage()

    // Polling should be enabled on mount: fetchPodcasts called for initial load
    // plus polling calls will increment over time. Just verify it starts.
    await waitFor(() => {
      expect(getPodcasts).toHaveBeenCalled()
    })
  })

  test('Page renders list after initial fetch completes', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcasts: vi.fn().mockResolvedValue({ podcasts: SAMPLE_PODCASTS }),
      getPodcast: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

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
    await givenPodcasts(SAMPLE_PODCASTS)

    renderPodcastPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'オフライン保存' })).toBeInTheDocument()
    })
  })

  test('保存に成功すると offline.save(id) を呼び、そのカードを「保存済み」にする (verifies: CI-P4-30)', async () => {
    await givenPodcasts(SAMPLE_PODCASTS)
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
    await givenPodcasts(SAMPLE_PODCASTS)
    renderPodcastPage()
    await waitFor(() => screen.getByRole('button', { name: 'オフライン保存' }))

    await userEvent.click(screen.getByRole('button', { name: 'オフライン保存' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('オフライン保存に失敗しました'))
    expect(screen.queryByText('保存済み')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'オフライン保存' })).toBeInTheDocument()
  })

  test('offline.has が true の回は、最初から「保存済み」で再保存しない (verifies: CI-P4-30)', async () => {
    has.mockResolvedValue(true)
    await givenPodcasts(SAMPLE_PODCASTS)

    renderPodcastPage()

    await waitFor(() => {
      expect(screen.getByText('保存済み')).toBeInTheDocument()
    })
    expect(save).not.toHaveBeenCalled()
  })

  test('offline.has が reject しても、一覧は描かれて保存ボタンが出続ける (verifies: CI-P4-30)', async () => {
    has.mockRejectedValue(new Error('cache open failed'))
    await givenPodcasts(SAMPLE_PODCASTS)

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
    const getPodcasts = vi.fn().mockImplementation(async () => ({ podcasts: [...SAMPLE_PODCASTS] }))
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcasts,
      getPodcast: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderPodcastPage()

    await waitFor(() => {
      expect(screen.getByText(/これはテスト用のポッドキャストイントロ/)).toBeInTheDocument()
    })

    // POLL_INTERVAL_MS (5000ms) より十分短い実時間だけ待つ。正常なケースでは
    // この間に追加のポーリングは発生しないはず。暴走時はマイクロタスク駆動で
    // 数百〜数千回呼ばれる。
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(getPodcasts.mock.calls.length).toBeLessThanOrEqual(2)
  })
})

  describe('生成完了の視覚演出（修正 4）', () => {
    test('初回ロードでは just-completed クラスが付かない', async () => {
      // 初期状態で completed の podcast
      const INITIAL = [{ ...SAMPLE_PODCASTS[0], id: 'p1', status: 'completed' as const }]
      const getPodcasts = vi.fn().mockResolvedValue({ podcasts: INITIAL })
      const { createApiClient } = await import('@/lib/api')
      vi.mocked(createApiClient).mockReturnValue({
        getPodcasts,
        getPodcast: vi.fn(),
      } as unknown as ReturnType<typeof createApiClient>)

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
    await givenPodcasts(KIND_PODCASTS)
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
