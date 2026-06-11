import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NavigationBar } from '@/components/NavigationBar'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/feed'),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
  })),
}))

// ==========================================================
// NavigationBar — 4 リンク / aria-current="page"
// ==========================================================
describe('NavigationBar', () => {
  test('renders 4 navigation links: Feed, Podcast, Subscriptions, Settings', async () => {
    render(<NavigationBar />)

    expect(screen.getByRole('link', { name: /Feed/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Podcast/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Subscriptions|購読/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Settings|設定/i })).toBeInTheDocument()
  })

  test('Feed link points to /feed', async () => {
    render(<NavigationBar />)
    expect(screen.getByRole('link', { name: /Feed/i })).toHaveAttribute('href', '/feed')
  })

  test('Podcast link points to /podcast', async () => {
    render(<NavigationBar />)
    expect(screen.getByRole('link', { name: /Podcast/i })).toHaveAttribute('href', '/podcast')
  })

  test('Settings link points to /settings', async () => {
    render(<NavigationBar />)
    expect(screen.getByRole('link', { name: /Settings|設定/i })).toHaveAttribute('href', '/settings')
  })

  test('Given current path is /feed, Feed link has aria-current="page"', async () => {
    const { usePathname } = await import('next/navigation')
    vi.mocked(usePathname).mockReturnValue('/feed')

    render(<NavigationBar />)

    expect(screen.getByRole('link', { name: /Feed/i })).toHaveAttribute('aria-current', 'page')
  })

  test('Given current path is /feed, other links do NOT have aria-current="page"', async () => {
    const { usePathname } = await import('next/navigation')
    vi.mocked(usePathname).mockReturnValue('/feed')

    render(<NavigationBar />)

    const podcastLink = screen.getByRole('link', { name: /Podcast/i })
    expect(podcastLink).not.toHaveAttribute('aria-current', 'page')
  })

  test('Given current path is /settings, Settings link has aria-current="page"', async () => {
    const { usePathname } = await import('next/navigation')
    vi.mocked(usePathname).mockReturnValue('/settings')

    render(<NavigationBar />)

    expect(screen.getByRole('link', { name: /Settings|設定/i })).toHaveAttribute('aria-current', 'page')
  })

  test('Given current path is /podcast, Podcast link has aria-current="page"', async () => {
    const { usePathname } = await import('next/navigation')
    vi.mocked(usePathname).mockReturnValue('/podcast')

    render(<NavigationBar />)

    expect(screen.getByRole('link', { name: /Podcast/i })).toHaveAttribute('aria-current', 'page')
  })
})
