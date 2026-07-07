import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PodcastCard } from '@/components/PodcastCard'
import type { Podcast } from '@/types/index'

const SAMPLE_PODCAST: Podcast = {
  id: 'p1',
  type: 'single',
  article_ids: ['a1'],
  difficulty: 'toeic_900',
  audio_url: 'https://storage.example.com/audio.mp3',
  japanese_intro_text:
    'これはテスト用の日本語イントロテキストです。80文字を超える長い文章を書いておきます。これ以降の文章は切り捨てられるはずです。テスト完了。',
  duration_seconds: 300,
  created_at: '2026-06-10T09:00:00+09:00',
  status: 'completed',
  error_message: null,
  playback_position_seconds: 0,
}

// ==========================================================
// PodcastCard — 表示コンテンツ
// ==========================================================
describe('PodcastCard display', () => {
  test('Displays japanese_intro_text', () => {
    render(<PodcastCard podcast={SAMPLE_PODCAST} onPlay={vi.fn()} />)
    expect(screen.getByText(/これはテスト用の日本語イントロテキスト/)).toBeInTheDocument()
  })

  test('Intro has podcast-intro class (CSS 2-line clamp replaces 80-char slice)', () => {
    render(<PodcastCard podcast={SAMPLE_PODCAST} onPlay={vi.fn()} />)
    const intro = screen.getByText(/これはテスト用の日本語イントロテキスト/)
    expect(intro.classList.contains('podcast-intro')).toBe(true)
  })

  test('Renders DifficultyBadge', () => {
    render(<PodcastCard podcast={SAMPLE_PODCAST} onPlay={vi.fn()} />)
    expect(screen.getByText(/TOEIC 900/)).toBeInTheDocument()
  })

  test('Renders StatusBadge with podcast status', () => {
    render(<PodcastCard podcast={SAMPLE_PODCAST} onPlay={vi.fn()} />)
    expect(screen.getByText('完成')).toBeInTheDocument()
  })

  test('Displays formatted duration', () => {
    render(<PodcastCard podcast={SAMPLE_PODCAST} onPlay={vi.fn()} />)
    // 300秒 → "5:00"
    expect(screen.getByText(/5:00/)).toBeInTheDocument()
  })

  test('Displays creation date', () => {
    render(<PodcastCard podcast={SAMPLE_PODCAST} onPlay={vi.fn()} />)
    // 日付が何らかの形式で表示される
    expect(screen.getByText(/6\/10|2026/)).toBeInTheDocument()
  })

  test('Card body is a link to /podcast/:id', () => {
    render(<PodcastCard podcast={SAMPLE_PODCAST} onPlay={vi.fn()} />)
    const link = screen.getByRole('link', { name: /これはテスト用/ })
    expect(link).toHaveAttribute('href', `/podcast/${SAMPLE_PODCAST.id}`)
  })

  test('Root element has podcast-card class', () => {
    const { container } = render(<PodcastCard podcast={SAMPLE_PODCAST} onPlay={vi.fn()} />)
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
      <PodcastCard podcast={{ ...SAMPLE_PODCAST, type: 'digest' }} onPlay={vi.fn()} />
    )
    expect(screen.getByText('DIGEST')).toBeInTheDocument()
  })

  test('Given type="single", does not display DIGEST tag', () => {
    render(<PodcastCard podcast={SAMPLE_PODCAST} onPlay={vi.fn()} />)
    expect(screen.queryByText('DIGEST')).not.toBeInTheDocument()
  })
})

// ==========================================================
// PodcastCard — 再生操作
// ==========================================================
describe('PodcastCard play', () => {
  test('Given play button clicked, calls onPlay with the podcast', async () => {
    const onPlay = vi.fn()
    render(<PodcastCard podcast={SAMPLE_PODCAST} onPlay={onPlay} />)

    await userEvent.click(screen.getByRole('button', { name: /再生|play/i }))

    expect(onPlay).toHaveBeenCalledWith(SAMPLE_PODCAST)
  })

  test('Play button is independent from the detail page link', () => {
    render(<PodcastCard podcast={SAMPLE_PODCAST} onPlay={vi.fn()} />)
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
      <PodcastCard podcast={SAMPLE_PODCAST} onPlay={vi.fn()} playing />
    )
    const root = container.firstElementChild
    expect(root?.classList.contains('playing')).toBe(true)
    expect(screen.getByText('再生中')).toBeInTheDocument()
  })

  test('Given playing omitted, no playing class and no "再生中" label', () => {
    const { container } = render(
      <PodcastCard podcast={SAMPLE_PODCAST} onPlay={vi.fn()} />
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
        podcast={SAMPLE_PODCAST}
        onPlay={vi.fn()}
        savedPosition={90}
      />
    )
    // "続きから 1:30" 形式
    expect(screen.getByText(/続きから.*1:30/)).toBeInTheDocument()
  })

  test('Given no savedPosition, does not display "続きから" text', () => {
    render(<PodcastCard podcast={SAMPLE_PODCAST} onPlay={vi.fn()} />)
    expect(screen.queryByText(/続きから/)).not.toBeInTheDocument()
  })

  test('Given savedPosition=0, does not display "続きから" (no meaningful position)', () => {
    render(<PodcastCard podcast={SAMPLE_PODCAST} onPlay={vi.fn()} savedPosition={0} />)
    expect(screen.queryByText(/続きから/)).not.toBeInTheDocument()
  })
})

// ==========================================================
// PodcastCard — オフライン保存（issue #167）
// WHY prop injection (not a Context/lib/audioCache import here): PodcastCard is kept
// context-free by design (mirrors onPlayNext/onAddToQueue) so it stays a cheap,
// isolated unit to test — the page decides download state/handler and injects them.
// ==========================================================
describe('PodcastCard offline download (issue #167)', () => {
  test('Given onDownload is not provided, does not render a download button', () => {
    render(<PodcastCard podcast={SAMPLE_PODCAST} onPlay={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /オフライン保存/ })).not.toBeInTheDocument()
  })

  test('Given onDownload is provided and not cached, clicking calls onDownload with the podcast', async () => {
    const onDownload = vi.fn()
    render(<PodcastCard podcast={SAMPLE_PODCAST} onPlay={vi.fn()} onDownload={onDownload} />)

    await userEvent.click(screen.getByRole('button', { name: 'オフライン保存' }))

    expect(onDownload).toHaveBeenCalledWith(SAMPLE_PODCAST)
  })

  test('Given cached=true, shows a "保存済み" state instead of a clickable download button', () => {
    const onDownload = vi.fn()
    render(<PodcastCard podcast={SAMPLE_PODCAST} onPlay={vi.fn()} onDownload={onDownload} cached />)

    expect(screen.getByText('保存済み')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'オフライン保存' })).not.toBeInTheDocument()
  })
})
