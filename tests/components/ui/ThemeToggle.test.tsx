import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { KEY_THEME } from '@/lib/config'

// ==========================================================
// ThemeToggle — html[data-theme] のトグル + localStorage 永続化
// （DOM が単一の真実。React state は持たない: 00-overview.md §3.3）
// ==========================================================
describe('ThemeToggle', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'dark'
    localStorage.clear()
  })

  afterEach(() => {
    delete document.documentElement.dataset.theme
    localStorage.clear()
  })

  test('renders a button with accessible name テーマ切替', () => {
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: 'テーマ切替' })).toBeInTheDocument()
  })

  test('Given data-theme="dark", clicking switches to light and persists raw string', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)

    await user.click(screen.getByRole('button', { name: 'テーマ切替' }))

    expect(document.documentElement.dataset.theme).toBe('light')
    // layout.tsx の初期化スクリプトが読む生値と互換であること（JSON.stringify されない）
    expect(localStorage.getItem(KEY_THEME)).toBe('light')
  })

  test('clicking twice returns to dark', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)

    const button = screen.getByRole('button', { name: 'テーマ切替' })
    await user.click(button)
    await user.click(button)

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem(KEY_THEME)).toBe('dark')
  })

  test('Given data-theme="light", clicking switches to dark', async () => {
    document.documentElement.dataset.theme = 'light'
    const user = userEvent.setup()
    render(<ThemeToggle />)

    await user.click(screen.getByRole('button', { name: 'テーマ切替' }))

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem(KEY_THEME)).toBe('dark')
  })

  test('has type="button" to avoid implicit form submission', () => {
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: 'テーマ切替' })).toHaveAttribute(
      'type',
      'button'
    )
  })
})
