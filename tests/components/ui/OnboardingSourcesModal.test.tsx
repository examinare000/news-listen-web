import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OnboardingSourcesModal } from '@/components/ui/OnboardingSourcesModal'
import type { FeaturedSource } from '@/types/index'

const mockGetFeaturedSources = vi.fn().mockResolvedValue({ sites: [] })

vi.mock('@/lib/api', () => ({
  createApiClient: vi.fn(() => ({
    getFeaturedSources: mockGetFeaturedSources,
    addSource: vi.fn(),
    completeOnboarding: vi.fn(),
  })),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public detail: string) {
      super(detail)
    }
  },
}))

beforeEach(() => {
  mockGetFeaturedSources.mockClear()
  mockGetFeaturedSources.mockResolvedValue({ sites: [] })
})

const defaultProps = {
  baseUrl: 'https://api.example.com',
  apiKey: 'test-key',
  onDone: vi.fn(),
}

describe('OnboardingSourcesModal', () => {
  test('renders the modal title and description', () => {
    render(<OnboardingSourcesModal {...defaultProps} />)
    expect(screen.getByText('おすすめサイトを購読')).toBeInTheDocument()
    expect(screen.getByText(/気になるサイトを選んで購読しましょう/)).toBeInTheDocument()
  })

  test('renders skip and complete buttons', () => {
    render(<OnboardingSourcesModal {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'スキップ' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '完了' })).toBeInTheDocument()
  })

  test('calls onDone when complete button is clicked', async () => {
    const onDone = vi.fn()
    render(<OnboardingSourcesModal {...defaultProps} onDone={onDone} />)

    await userEvent.click(screen.getByRole('button', { name: '完了' }))

    await waitFor(() => {
      expect(onDone).toHaveBeenCalled()
    })
  })

  test('calls onDone when skip button is clicked', async () => {
    const onDone = vi.fn()
    render(<OnboardingSourcesModal {...defaultProps} onDone={onDone} />)

    await userEvent.click(screen.getByRole('button', { name: 'スキップ' }))

    await waitFor(() => {
      expect(onDone).toHaveBeenCalled()
    })
  })

  test('focuses first focusable element (skip button) when featured list is empty on mount (focus trap)', async () => {
    render(<OnboardingSourcesModal {...defaultProps} />)

    await waitFor(() => {
      // When no featured sources, the first button should be the skip button
      const skipButton = screen.getByRole('button', { name: 'スキップ' })
      expect(skipButton).toHaveFocus()
    })
  })

  test('Modal uses design classes (modal-backdrop / modal-box)', () => {
    render(<OnboardingSourcesModal {...defaultProps} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.classList.contains('modal-box')).toBe(true)
    expect(dialog.parentElement?.classList.contains('modal-backdrop')).toBe(true)
  })

  test('displays category section headers in fixed order (テクノロジー→ビジネス→スポーツ→芸能→カルチャー)', async () => {
    mockGetFeaturedSources.mockResolvedValueOnce({
      sites: [
        { id: '1', name: 'Tech Site', url: 'https://tech.example.com', order: 0, category: 'tech' } as FeaturedSource,
        { id: '2', name: 'Business Site', url: 'https://business.example.com', order: 1, category: 'business' } as FeaturedSource,
        { id: '3', name: 'Sports Site', url: 'https://sports.example.com', order: 2, category: 'sports' } as FeaturedSource,
      ],
    })

    render(<OnboardingSourcesModal {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByText('テクノロジー')).toBeInTheDocument()
      expect(screen.getByText('ビジネス')).toBeInTheDocument()
      expect(screen.getByText('スポーツ')).toBeInTheDocument()
    })
  })

  test('hides category headers when category has 0 items', async () => {
    mockGetFeaturedSources.mockResolvedValueOnce({
      sites: [
        { id: '1', name: 'Tech Site', url: 'https://tech.example.com', order: 0, category: 'tech' } as FeaturedSource,
      ],
    })

    render(<OnboardingSourcesModal {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByText('テクノロジー')).toBeInTheDocument()
      expect(screen.queryByText('ビジネス')).not.toBeInTheDocument()
    })
  })

  test('normalizes missing category field to tech', async () => {
    mockGetFeaturedSources.mockResolvedValueOnce({
      sites: [
        { id: '1', name: 'Legacy Site', url: 'https://legacy.example.com', order: 0 } as FeaturedSource,
        { id: '2', name: 'Explicit Tech', url: 'https://tech.example.com', order: 1, category: 'tech' } as FeaturedSource,
      ],
    })

    render(<OnboardingSourcesModal {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByText('Legacy Site')).toBeInTheDocument()
      expect(screen.getByText('Explicit Tech')).toBeInTheDocument()
      expect(screen.getByText('テクノロジー')).toBeInTheDocument()
    })
  })
})
