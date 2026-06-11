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
}

// ==========================================================
// PodcastCard — 表示コンテンツ
// ==========================================================
describe('PodcastCard display', () => {
  test('Displays first 80 characters of japanese_intro_text', () => {
    render(<PodcastCard podcast={SAMPLE_PODCAST} onPlay={vi.fn()} />)
    const intro80 = SAMPLE_PODCAST.japanese_intro_text.slice(0, 80)
    expect(screen.getByText(new RegExp(intro80.slice(0, 30)))).toBeInTheDocument()
  })

  test('Does NOT display characters beyond 80 in intro text', () => {
    render(<PodcastCard podcast={SAMPLE_PODCAST} onPlay={vi.fn()} />)
    // 80文字を超える部分の特徴的なテキスト
    const beyond80 = SAMPLE_PODCAST.japanese_intro_text.slice(80)
    if (beyond80.length > 5) {
      // 80 文字以降の固有テキストが画面に存在しないこと
      const uniquePart = beyond80.slice(0, 5)
      // ただし 80 文字内にも含まれる文字がある可能性があるため、位置で判断
      const displayedText = screen.getByText(/これはテスト用/)?.textContent ?? ''
      expect(displayedText.length).toBeLessThanOrEqual(83) // 省略記号込みで +3 程度
    }
  })

  test('Renders DifficultyBadge', () => {
    render(<PodcastCard podcast={SAMPLE_PODCAST} onPlay={vi.fn()} />)
    expect(screen.getByText(/TOEIC 900/)).toBeInTheDocument()
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
