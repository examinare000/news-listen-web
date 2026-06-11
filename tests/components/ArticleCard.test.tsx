import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ArticleCard } from '@/components/ArticleCard'
import type { Article } from '@/types/index'

const SAMPLE_ARTICLE: Article = {
  id: 'a1',
  title: 'TypeScript 5.5 Released',
  url: 'https://devblogs.microsoft.com/typescript/typescript-5-5',
  source: 'Microsoft Blog',
  score: 0.85,
  published_at: '2026-06-10T09:00:00+09:00',
}

function renderCard(overrides: Partial<{
  article: Article
  onStar: (id: string) => void
  onDismiss: (id: string) => void
  busy: boolean
  starred: boolean
}> = {}) {
  const props = {
    article: SAMPLE_ARTICLE,
    onStar: vi.fn(),
    onDismiss: vi.fn(),
    busy: false,
    starred: false,
    ...overrides,
  }
  return { ...render(<ArticleCard {...props} />), props }
}

// ==========================================================
// ArticleCard — 表示コンテンツ
// ==========================================================
describe('ArticleCard display', () => {
  test('renders article title', () => {
    renderCard()
    expect(screen.getByText(SAMPLE_ARTICLE.title)).toBeInTheDocument()
  })

  test('renders article source', () => {
    renderCard()
    expect(screen.getByText(SAMPLE_ARTICLE.source)).toBeInTheDocument()
  })

  test('title is an external link with target=_blank and rel=noopener noreferrer', () => {
    renderCard()
    const titleLink = screen.getByRole('link', { name: SAMPLE_ARTICLE.title })
    expect(titleLink).toHaveAttribute('href', SAMPLE_ARTICLE.url)
    expect(titleLink).toHaveAttribute('target', '_blank')
    expect(titleLink).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(titleLink).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
  })

  test('renders score bar with aria-valuenow set to score', () => {
    renderCard()
    const scoreBar = screen.getByRole('progressbar')
    expect(scoreBar).toHaveAttribute('aria-valuenow', String(SAMPLE_ARTICLE.score))
  })

  test('Given score=0 (boundary), renders score bar without throwing', () => {
    expect(() =>
      renderCard({ article: { ...SAMPLE_ARTICLE, score: 0 } })
    ).not.toThrow()
  })

  test('Given score=1.0 (boundary), renders score bar without throwing', () => {
    expect(() =>
      renderCard({ article: { ...SAMPLE_ARTICLE, score: 1.0 } })
    ).not.toThrow()
  })
})

// ==========================================================
// ArticleCard — Star / Dismiss 操作
// ==========================================================
describe('ArticleCard interactions', () => {
  test('Given star button clicked, calls onStar with article id', async () => {
    const onStar = vi.fn()
    renderCard({ onStar })

    await userEvent.click(screen.getByRole('button', { name: /star|★|スター/i }))

    expect(onStar).toHaveBeenCalledWith(SAMPLE_ARTICLE.id)
  })

  test('Given dismiss button clicked, calls onDismiss with article id', async () => {
    const onDismiss = vi.fn()
    renderCard({ onDismiss })

    await userEvent.click(screen.getByRole('button', { name: /dismiss|×|閉じる|非表示/i }))

    expect(onDismiss).toHaveBeenCalledWith(SAMPLE_ARTICLE.id)
  })

  test('Given busy=true, star button is disabled (prevents double submission)', () => {
    renderCard({ busy: true })
    expect(screen.getByRole('button', { name: /star|★|スター/i })).toBeDisabled()
  })

  test('Given busy=true, dismiss button is disabled', () => {
    renderCard({ busy: true })
    expect(screen.getByRole('button', { name: /dismiss|×|閉じる|非表示/i })).toBeDisabled()
  })

  test('Given busy=false, buttons are enabled', () => {
    renderCard({ busy: false })
    expect(screen.getByRole('button', { name: /star|★|スター/i })).not.toBeDisabled()
  })

  test('Given starred=true, star button shows active/filled state', () => {
    renderCard({ starred: true })
    // starred 状態で特定のクラスや aria-pressed が付く
    const starBtn = screen.getByRole('button', { name: /star|★|スター/i })
    // いずれかの方法で starred を表現していることを確認
    const isStarred =
      starBtn.getAttribute('aria-pressed') === 'true' ||
      starBtn.classList.contains('starred') ||
      starBtn.textContent?.includes('★')
    expect(isStarred).toBe(true)
  })
})
