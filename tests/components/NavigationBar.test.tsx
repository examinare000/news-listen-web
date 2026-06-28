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

// SidebarAccount は useAuth を呼ぶため、デフォルトで authenticated mock を返す
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    status: 'authenticated',
    user: { username: 'test', role: 'user' as const, display_name: 'Test User' },
    logout: vi.fn(),
    login: vi.fn(),
    refreshMe: vi.fn(),
    loginWithPasskey: vi.fn(),
  })),
}))

// ==========================================================
// NavigationBar — サイドバー化（aside.sidebar）+ 4 リンク / aria-current="page"
// 表示文言はデザイン正本（docs/design/app-ui.html）準拠の日本語
// ==========================================================
describe('NavigationBar', () => {
  test('renders as a sidebar (complementary landmark)', () => {
    render(<NavigationBar />)

    const sidebar = screen.getByRole('complementary')
    expect(sidebar).toBeInTheDocument()
    expect(sidebar.classList.contains('sidebar')).toBe(true)
  })

  test('contains the main navigation landmark with aria-label', () => {
    render(<NavigationBar />)

    expect(
      screen.getByRole('navigation', { name: 'メインナビゲーション' })
    ).toBeInTheDocument()
  })

  test('renders 4 navigation links: フィード, ポッドキャスト, 購読管理, 設定', () => {
    render(<NavigationBar />)

    expect(screen.getByRole('link', { name: 'フィード' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ポッドキャスト' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '購読管理' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '設定' })).toBeInTheDocument()
  })

  test('フィード link points to /feed', () => {
    render(<NavigationBar />)
    expect(screen.getByRole('link', { name: 'フィード' })).toHaveAttribute('href', '/feed')
  })

  test('ポッドキャスト link points to /podcast', () => {
    render(<NavigationBar />)
    expect(screen.getByRole('link', { name: 'ポッドキャスト' })).toHaveAttribute(
      'href',
      '/podcast'
    )
  })

  test('購読管理 link points to /subscriptions', () => {
    render(<NavigationBar />)
    expect(screen.getByRole('link', { name: '購読管理' })).toHaveAttribute(
      'href',
      '/subscriptions'
    )
  })

  test('設定 link points to /settings', () => {
    render(<NavigationBar />)
    expect(screen.getByRole('link', { name: '設定' })).toHaveAttribute('href', '/settings')
  })

  test('Given current path is /feed, フィード link has aria-current="page"', async () => {
    const { usePathname } = await import('next/navigation')
    vi.mocked(usePathname).mockReturnValue('/feed')

    render(<NavigationBar />)

    const feedLink = screen.getByRole('link', { name: 'フィード' })
    expect(feedLink).toHaveAttribute('aria-current', 'page')
    expect(feedLink.classList.contains('active')).toBe(true)
  })

  test('Given current path is /feed, other links do NOT have aria-current="page"', async () => {
    const { usePathname } = await import('next/navigation')
    vi.mocked(usePathname).mockReturnValue('/feed')

    render(<NavigationBar />)

    const podcastLink = screen.getByRole('link', { name: 'ポッドキャスト' })
    expect(podcastLink).not.toHaveAttribute('aria-current', 'page')
    expect(podcastLink.classList.contains('active')).toBe(false)
  })

  test('Given current path is /settings, 設定 link has aria-current="page"', async () => {
    const { usePathname } = await import('next/navigation')
    vi.mocked(usePathname).mockReturnValue('/settings')

    render(<NavigationBar />)

    expect(screen.getByRole('link', { name: '設定' })).toHaveAttribute('aria-current', 'page')
  })

  test('Given current path is /podcast, ポッドキャスト link has aria-current="page"', async () => {
    const { usePathname } = await import('next/navigation')
    vi.mocked(usePathname).mockReturnValue('/podcast')

    render(<NavigationBar />)

    expect(screen.getByRole('link', { name: 'ポッドキャスト' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  test('renders the AudioNews logo text', () => {
    render(<NavigationBar />)
    // ロゴは「Audio」+ amber の「News」に分割されるため部分一致で検証
    expect(screen.getByText('Audio')).toBeInTheDocument()
    expect(screen.getByText('News')).toBeInTheDocument()
  })

  test('renders the theme toggle in the sidebar footer', () => {
    render(<NavigationBar />)
    // ThemeToggle は role="switch"（現在テーマを aria-checked で公開する）
    expect(screen.getByRole('switch', { name: 'テーマ切替' })).toBeInTheDocument()
  })

  test('renders the logout button in the sidebar footer when authenticated', async () => {
    render(<NavigationBar />)
    // SidebarAccount が認証済みで渡されたため、ログアウトボタンが表示される
    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeInTheDocument()
  })

  test('sidebar footer contains both account section and theme toggle', () => {
    render(<NavigationBar />)
    const footer = screen.getByRole('complementary').querySelector('.sidebar-footer')
    expect(footer).toBeInTheDocument()
    // ログアウトボタンとテーマ切替スイッチが footer に含まれる
    expect(footer).toContainElement(screen.getByRole('button', { name: 'ログアウト' }))
    expect(footer).toContainElement(screen.getByRole('switch', { name: 'テーマ切替' }))
  })
})
