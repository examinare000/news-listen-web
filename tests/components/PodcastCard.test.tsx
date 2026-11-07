import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PodcastCard } from '@/components/PodcastCard'
// リードモデルは型だけを import し、値は object literal で作る（readModels を値で import すると web-check-08 の閉じた集合が変わる）。
import type { EpisodeCardView } from '@/lib/catalog/application/readModels'

const INTRO =
  'これはテスト用の日本語イントロテキストです。80文字を超える長い文章を書いておきます。これ以降の文章は切り捨てられるはずです。テスト完了。'

const PLAYABLE_VIEW: EpisodeCardView = {
  id: 'p1',
  kind: 'playable',
  generation: 'completed',
  title: INTRO.slice(0, 20),
  label: { title: null, intro: INTRO },
  isDigest: false,
  intro: INTRO,
  difficulty: 'toeic_900',
  durationSeconds: 300,
  createdAt: '2026-06-10T09:00:00+09:00',
  failureReason: null,
}

const GENERATING_VIEW: EpisodeCardView = {
  ...PLAYABLE_VIEW,
  kind: 'generating',
  generation: 'processing',
  title: 'generating',
}

const FAILED_VIEW: EpisodeCardView = {
  ...PLAYABLE_VIEW,
  kind: 'failed',
  generation: 'failed',
  title: 'failed',
  failureReason: 'generation_failed',
}

const QUOTA_EXHAUSTED_VIEW: EpisodeCardView = { ...FAILED_VIEW, failureReason: 'quota_exhausted' }

// ==========================================================
// PodcastCard — 表示コンテンツ
// ==========================================================
describe('PodcastCard display', () => {
  test('Displays japanese_intro_text', () => {
    render(<PodcastCard episode={PLAYABLE_VIEW} onPlay={vi.fn()} />)
    expect(screen.getByText(/これはテスト用の日本語イントロテキスト/)).toBeInTheDocument()
  })

  test('Intro has podcast-intro class (CSS 2-line clamp replaces 80-char slice)', () => {
    render(<PodcastCard episode={PLAYABLE_VIEW} onPlay={vi.fn()} />)
    const intro = screen.getByText(/これはテスト用の日本語イントロテキスト/)
    expect(intro.classList.contains('podcast-intro')).toBe(true)
  })

  test('Renders DifficultyBadge', () => {
    render(<PodcastCard episode={PLAYABLE_VIEW} onPlay={vi.fn()} />)
    expect(screen.getByText(/TOEIC 900/)).toBeInTheDocument()
  })

  test('Renders StatusBadge with podcast status', () => {
    render(<PodcastCard episode={PLAYABLE_VIEW} onPlay={vi.fn()} />)
    expect(screen.getByText('完成')).toBeInTheDocument()
  })

  test('Displays formatted duration', () => {
    render(<PodcastCard episode={PLAYABLE_VIEW} onPlay={vi.fn()} />)
    // 300秒 → "5:00"
    expect(screen.getByText(/5:00/)).toBeInTheDocument()
  })

  test('Displays creation date', () => {
    render(<PodcastCard episode={PLAYABLE_VIEW} onPlay={vi.fn()} />)
    // 日付が何らかの形式で表示される
    expect(screen.getByText(/6\/10|2026/)).toBeInTheDocument()
  })

  test('Card body is a link to /podcast/:id', () => {
    render(<PodcastCard episode={PLAYABLE_VIEW} onPlay={vi.fn()} />)
    const link = screen.getByRole('link', { name: /これはテスト用/ })
    expect(link).toHaveAttribute('href', `/podcast/${PLAYABLE_VIEW.id}`)
  })

  test('Root element has podcast-card class', () => {
    const { container } = render(<PodcastCard episode={PLAYABLE_VIEW} onPlay={vi.fn()} />)
    const root = container.firstElementChild
    expect(root?.classList.contains('podcast-card')).toBe(true)
  })
})

// ==========================================================
// PodcastCard — DIGEST タグ
// ==========================================================
describe('PodcastCard digest tag', () => {
  test('Given type="digest", displays DIGEST tag', () => {
    render(
      <PodcastCard episode={{ ...PLAYABLE_VIEW, isDigest: true }} onPlay={vi.fn()} />
    )
    expect(screen.getByText('DIGEST')).toBeInTheDocument()
  })

  test('Given type="single", does not display DIGEST tag', () => {
    render(<PodcastCard episode={PLAYABLE_VIEW} onPlay={vi.fn()} />)
    expect(screen.queryByText('DIGEST')).not.toBeInTheDocument()
  })
})

// ==========================================================
// PodcastCard — 再生操作
// ==========================================================
describe('PodcastCard play', () => {
  test('Given play button clicked, calls onPlay with the PlayableEpisode', async () => {
    const onPlay = vi.fn()
    render(<PodcastCard episode={PLAYABLE_VIEW} onPlay={onPlay} />)

    await userEvent.click(screen.getByRole('button', { name: /再生|play/i }))

    // 引数はリードモデル（EpisodeCardView。shared-session-08）
    expect(onPlay).toHaveBeenCalledWith(PLAYABLE_VIEW)
  })

  test('Play button is independent from the detail page link', () => {
    render(<PodcastCard episode={PLAYABLE_VIEW} onPlay={vi.fn()} />)
    const button = screen.getByRole('button', { name: /再生|play/i })
    // 再生ボタンクリックがリンク遷移を起こさないよう、リンクの外に配置されていること
    expect(button.closest('a')).toBeNull()
  })
})

// ==========================================================
// PodcastCard — 再生中強調（playing prop）
// ==========================================================
describe('PodcastCard playing state', () => {
  test('Given playing=true, root has playing class and "再生中" label is shown', () => {
    const { container } = render(
      <PodcastCard episode={PLAYABLE_VIEW} onPlay={vi.fn()} playing />
    )
    const root = container.firstElementChild
    expect(root?.classList.contains('playing')).toBe(true)
    expect(screen.getByText('再生中')).toBeInTheDocument()
  })

  test('Given playing omitted, no playing class and no "再生中" label', () => {
    const { container } = render(
      <PodcastCard episode={PLAYABLE_VIEW} onPlay={vi.fn()} />
    )
    const root = container.firstElementChild
    expect(root?.classList.contains('playing')).toBe(false)
    expect(screen.queryByText('再生中')).not.toBeInTheDocument()
  })
})

// ==========================================================
// PodcastCard — 保存済み再生位置
// ==========================================================
describe('PodcastCard saved position', () => {
  test('Given savedPosition is provided, displays "続きから MM:SS"', () => {
    render(
      <PodcastCard
        episode={PLAYABLE_VIEW}
        onPlay={vi.fn()}
        savedPosition={90}
      />
    )
    // "続きから 1:30" 形式
    expect(screen.getByText(/続きから.*1:30/)).toBeInTheDocument()
  })

  test('Given no savedPosition, does not display "続きから" text', () => {
    render(<PodcastCard episode={PLAYABLE_VIEW} onPlay={vi.fn()} />)
    expect(screen.queryByText(/続きから/)).not.toBeInTheDocument()
  })

  test('Given savedPosition=0, does not display "続きから" (no meaningful position)', () => {
    render(<PodcastCard episode={PLAYABLE_VIEW} onPlay={vi.fn()} savedPosition={0} />)
    expect(screen.queryByText(/続きから/)).not.toBeInTheDocument()
  })
})

// ==========================================================
// PodcastCard — オフライン保存（issue #167）
// WHY prop injection (not a Context/offlineLibrary import here): PodcastCard is kept
// context-free by design (mirrors onPlayNext/onAddToQueue) so it stays a cheap,
// isolated unit to test — the page decides download state/handler and injects them.
// ==========================================================
describe('PodcastCard offline download (issue #167)', () => {
  test('Given onDownload is not provided, does not render a download button', () => {
    render(<PodcastCard episode={PLAYABLE_VIEW} onPlay={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /オフライン保存/ })).not.toBeInTheDocument()
  })

  test('Given onDownload is provided and not cached, clicking calls onDownload with the podcast', async () => {
    const onDownload = vi.fn()
    render(<PodcastCard episode={PLAYABLE_VIEW} onPlay={vi.fn()} onDownload={onDownload} />)

    await userEvent.click(screen.getByRole('button', { name: 'オフライン保存' }))

    expect(onDownload).toHaveBeenCalledWith(PLAYABLE_VIEW)
  })

  test('Given cached=true, shows a "保存済み" state instead of a clickable download button', () => {
    const onDownload = vi.fn()
    render(<PodcastCard episode={PLAYABLE_VIEW} onPlay={vi.fn()} onDownload={onDownload} cached />)

    expect(screen.getByText('保存済み')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'オフライン保存' })).not.toBeInTheDocument()
  })
})

// ==========================================================
// PodcastCard — Episode 種別の描き分け
// verifies: web-contract-14（UI 側）。
// ▶・次に再生・キューに追加・オフライン保存は kind が playable のときだけ描く（fail-closed。web-dec-46）。
// Generating・Failed（矛盾 DTO・partial_failed・audio_url が空を含む）は取得の側（catalogGateway）で kind が failed に倒れるので、
// このコンポーネントから見れば failed の view に帰着する。表示 field は常に EpisodeCardView から描く。
// 各ケースの 2 番目の値は、view に重ねて上書きする値（Partial<EpisodeCardView>）。
// ==========================================================
describe('PodcastCard episode kinds (web-contract-14)', () => {
  function renderWithOperations(overrides: Partial<EpisodeCardView>, episode: EpisodeCardView) {
    const handlers = {
      onPlay: vi.fn(),
      onPlayNext: vi.fn(),
      onAddToQueue: vi.fn(),
      onDownload: vi.fn(),
    }
    const view = render(<PodcastCard episode={{ ...episode, ...overrides }} {...handlers} />)
    return { ...view, handlers }
  }

  const NO_OPERATIONS_CASES: Array<[string, Partial<EpisodeCardView>, EpisodeCardView]> = [
    ['shared-session-08: generating（processing）', {}, GENERATING_VIEW],
    [
      'shared-session-08: failed（status=failed, generation_failed）',
      {},
      FAILED_VIEW,
    ],
    [
      'shared-session-08: failed（status=failed, quota_exhausted）',
      {},
      QUOTA_EXHAUSTED_VIEW,
    ],
    ['shared-session-08: 矛盾 DTO（completed なのに audio_url が空）', { generation: 'completed' }, FAILED_VIEW],
    [
      'shared-session-08: 矛盾 DTO（completed なのに error_message が識別子）',
      { generation: 'completed' },
      QUOTA_EXHAUSTED_VIEW,
    ],
    ['shared-session-09: partial_failed', {}, FAILED_VIEW],
  ]

  test.each(NO_OPERATIONS_CASES)(
    '%s は ▶・次に再生・キューに追加・オフライン保存（保存済み）と操作の容器を描かない',
    (_label, podcast, episode) => {
      const { container } = renderWithOperations(podcast, episode)

      expect(screen.queryByRole('button', { name: '再生' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '次に再生' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'キューに追加' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'オフライン保存' })).not.toBeInTheDocument()
      expect(screen.queryByText('保存済み')).not.toBeInTheDocument()
      expect(container.querySelector('.podcast-queue-actions')).toBeNull()
    },
  )

  test('正方向対照: playable は ▶・次に再生・キューに追加・オフライン保存を描き、失敗の文言は描かない', () => {
    const { container } = renderWithOperations({}, PLAYABLE_VIEW)

    expect(screen.getByRole('button', { name: '再生' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '次に再生' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'キューに追加' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'オフライン保存' })).toBeInTheDocument()
    expect(container.querySelector('.podcast-queue-actions')).not.toBeNull()
    expect(screen.queryByTestId('podcast-failure-message-p1')).not.toBeInTheDocument()
  })

  test('playable で cached=true なら「保存済み」を描く。generating では描かない（保存済みも PlayableEpisode だけ）', () => {
    const { unmount } = render(
      <PodcastCard episode={PLAYABLE_VIEW} onPlay={vi.fn()} onDownload={vi.fn()} cached />,
    )
    expect(screen.getByText('保存済み')).toBeInTheDocument()
    unmount()

    render(
      <PodcastCard
        episode={GENERATING_VIEW}
        onPlay={vi.fn()}
        onDownload={vi.fn()}
        cached
      />,
    )
    expect(screen.queryByText('保存済み')).not.toBeInTheDocument()
  })

  test('playable: 次に再生・キューに追加・オフライン保存は DTO の podcast を渡す（onPlay だけが PlayableEpisode）', async () => {
    const { handlers } = renderWithOperations({}, PLAYABLE_VIEW)

    await userEvent.click(screen.getByRole('button', { name: '次に再生' }))
    await userEvent.click(screen.getByRole('button', { name: 'キューに追加' }))
    await userEvent.click(screen.getByRole('button', { name: 'オフライン保存' }))

    expect(handlers.onPlayNext).toHaveBeenCalledWith(PLAYABLE_VIEW)
    expect(handlers.onAddToQueue).toHaveBeenCalledWith(PLAYABLE_VIEW)
    expect(handlers.onDownload).toHaveBeenCalledWith(PLAYABLE_VIEW)
    expect(handlers.onPlay).not.toHaveBeenCalled()
  })

  test('generating・failed のカードからは onPlay・onPlayNext・onAddToQueue・onDownload を呼べない（DOM に要素が無い）', async () => {
    const { handlers } = renderWithOperations({}, FAILED_VIEW)

    // 要素が無いので、カード内をクリックしても何も呼ばれない
    await userEvent.click(screen.getByTestId('podcast-card-p1'))

    expect(handlers.onPlay).not.toHaveBeenCalled()
    expect(handlers.onPlayNext).not.toHaveBeenCalled()
    expect(handlers.onAddToQueue).not.toHaveBeenCalled()
    expect(handlers.onDownload).not.toHaveBeenCalled()
  })

  const BADGE_CASES: Array<[string, string, Partial<EpisodeCardView>, EpisodeCardView]> = [
    ['playable', '完成', {}, PLAYABLE_VIEW],
    ['generating', '生成中', {}, GENERATING_VIEW],
    ['failed', '失敗', {}, FAILED_VIEW],
    ['shared-session-09: partial_failed', '失敗', {}, FAILED_VIEW],
  ]

  test.each(BADGE_CASES)('%s のバッジは episode の種別で決まり「%s」になる（「一部失敗」は出さない）', (_label, text, podcast, episode) => {
    render(<PodcastCard episode={{ ...episode, ...podcast }} onPlay={vi.fn()} />)

    expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.queryByText('一部失敗')).not.toBeInTheDocument()
  })

  test('バッジは podcast.status ではなく episode.kind から決まる（矛盾 DTO: completed でも episode が failed なら「失敗」）', () => {
    render(<PodcastCard episode={{ ...FAILED_VIEW, generation: 'completed' }} onPlay={vi.fn()} />)

    expect(screen.getByText('失敗')).toBeInTheDocument()
    expect(screen.queryByText('完成')).not.toBeInTheDocument()
  })
})

// ==========================================================
// PodcastCard — 失敗の理由の文言（web-dec-45）
// ==========================================================
describe('PodcastCard failure message (web-dec-45)', () => {
  const FAILURE_CASES: Array<[string, EpisodeCardView, string]> = [
    ['generation_failed', FAILED_VIEW, '生成に失敗しました'],
    ['quota_exhausted', QUOTA_EXHAUSTED_VIEW, '生成の上限に達したため、生成できませんでした'],
  ]

  test.each(FAILURE_CASES)('Given failed(%s), バッジと同じ行に podcast-failure-message-{id} の文言を描く', (_reason, episode, message) => {
    render(<PodcastCard episode={episode} onPlay={vi.fn()} />)

    const element = screen.getByTestId('podcast-failure-message-p1')
    expect(element).toHaveTextContent(message)
    expect(element.closest('.podcast-card-top')).toContainElement(screen.getByText('失敗'))
  })

  test('文言の testid は podcast.id から作る（episode.id ではなく、呼出元が同じ podcast から episode を作る前提）', () => {
    render(
      <PodcastCard
        episode={{ ...FAILED_VIEW, id: 'other' }}
        onPlay={vi.fn()}
      />,
    )
    expect(screen.getByTestId('podcast-failure-message-other')).toBeInTheDocument()
  })

  test('playable・generating には失敗の文言を描かない', () => {
    const { unmount } = render(<PodcastCard episode={PLAYABLE_VIEW} onPlay={vi.fn()} />)
    expect(screen.queryByTestId('podcast-failure-message-p1')).not.toBeInTheDocument()
    unmount()

    render(<PodcastCard episode={GENERATING_VIEW} onPlay={vi.fn()} />)
    expect(screen.queryByTestId('podcast-failure-message-p1')).not.toBeInTheDocument()
  })

  test('識別子の生値（generation_failed・quota_exhausted）を画面に出さない', () => {
    render(<PodcastCard episode={QUOTA_EXHAUSTED_VIEW} onPlay={vi.fn()} />)

    expect(screen.queryByText(/quota_exhausted|generation_failed/)).not.toBeInTheDocument()
  })
})

// ==========================================================
// PodcastCard — 種別に関係なく view から描く表示（不変）
// ==========================================================
describe('PodcastCard display is independent of episode kind', () => {
  test.each([
    ['generating', { isDigest: true }, GENERATING_VIEW],
    ['failed', { isDigest: true }, FAILED_VIEW],
  ])('Given %s, 導入文・長さ・日付・DIGEST・続きから・再生中を podcast から描く', (_kind, podcast, episode) => {
    render(<PodcastCard episode={{ ...episode, ...podcast }} onPlay={vi.fn()} savedPosition={90} playing />)

    expect(screen.getByText(/これはテスト用の日本語イントロテキスト/)).toBeInTheDocument()
    expect(screen.getByText(/5:00/)).toBeInTheDocument()
    expect(screen.getByText(/6\/10|2026/)).toBeInTheDocument()
    expect(screen.getByText('DIGEST')).toBeInTheDocument()
    expect(screen.getByText(/続きから.*1:30/)).toBeInTheDocument()
    expect(screen.getByText('再生中')).toBeInTheDocument()
  })
})
