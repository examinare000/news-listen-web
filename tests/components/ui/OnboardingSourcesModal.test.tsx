import { describe, test, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OnboardingSourcesModal } from '@/components/ui/OnboardingSourcesModal'

vi.mock('@/lib/api', () => ({
  createApiClient: vi.fn(() => ({
    getFeaturedSources: vi.fn().mockResolvedValue({ sites: [] }),
    addSource: vi.fn(),
    completeOnboarding: vi.fn(),
  })),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public detail: string) {
      super(detail)
    }
  },
}))

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
})
