import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NavigationBar } from '@/components/NavigationBar'
import { useAuth } from '@/contexts/AuthContext'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/feed'),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
  })),
}))

// WHY: vi.mock は hoist されるため、afterEach でも同じ既定値を再利用できるよう
// vi.hoisted でファクトリ関数として定義する（テスト間の mockReturnValue 上書き漏れ対策）。
// 戻り値の型は useAuth の実際の型（AuthContextValue）に合わせる — `as const` で
// リテラル型に固定すると admin ロール等への上書きが型エラーになるため避ける。
const defaultAuthContext = vi.hoisted(
  () => (): ReturnType<typeof import('@/contexts/AuthContext').useAuth> => ({
    status: 'authenticated',
    user: { username: 'test', role: 'user', display_name: 'Test User' },
    logout: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    refreshMe: vi.fn(),
    loginWithPasskey: vi.fn(),
  })
)

// SidebarAccount は useAuth を呼ぶため、デフォルトで authenticated mock を返す
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(defaultAuthContext),
}))

// admin ロール系テストで使う上書きヘルパー。既定値とのマージにより各テストの記述量を減らす。
function mockAuthAs(overrides: Partial<ReturnType<typeof useAuth>>) {
  vi.mocked(useAuth).mockReturnValue({ ...defaultAuthContext(), ...overrides })
}

// admin ロール系テストが useAuth の戻り値を上書きするため、後続テストへ漏れないよう毎回既定値へ戻す
afterEach(() => {
  vi.mocked(useAuth).mockImplementation(defaultAuthContext)
})

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

  test('renders 5 navigation links: フィード, ポッドキャスト, 購読管理, ダッシュボード, 設定', () => {
    render(<NavigationBar />)

    expect(screen.getByRole('link', { name: 'フィード' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ポッドキャスト' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '購読管理' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ダッシュボード' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '設定' })).toBeInTheDocument()
  })

  // F4 学習ダッシュボード（ADR-072）: NAV_ITEMS への新規追加
  test('ダッシュボード link points to /dashboard', () => {
    render(<NavigationBar />)
    expect(screen.getByRole('link', { name: 'ダッシュボード' })).toHaveAttribute(
      'href',
      '/dashboard'
    )
  })

  test('Given current path is /dashboard, ダッシュボード link has aria-current="page"', async () => {
    const { usePathname } = await import('next/navigation')
    vi.mocked(usePathname).mockReturnValue('/dashboard')

    render(<NavigationBar />)

    const dashboardLink = screen.getByRole('link', { name: 'ダッシュボード' })
    expect(dashboardLink).toHaveAttribute('aria-current', 'page')
    expect(dashboardLink.classList.contains('active')).toBe(true)
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

  test('renders the logout button in the sidebar footer when authenticated', () => {
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

  // ==========================================================
  // 「おすすめサイト管理」ナビ項目 — admin ロールのみ表示
  // ==========================================================
  test('Given an admin user, renders the おすすめサイト管理 link pointing to /admin/featured-sites', () => {
    mockAuthAs({ user: { username: 'admin', role: 'admin' as const, display_name: 'Admin' } })

    render(<NavigationBar />)

    expect(
      screen.getByRole('link', { name: 'おすすめサイト管理' })
    ).toHaveAttribute('href', '/admin/featured-sites')
  })

  test('Given a non-admin user, does NOT render the おすすめサイト管理 link', () => {
    mockAuthAs({ user: { username: 'test', role: 'user' as const, display_name: 'Test User' } })

    render(<NavigationBar />)

    expect(
      screen.queryByRole('link', { name: 'おすすめサイト管理' })
    ).not.toBeInTheDocument()
  })

  test('Given an unauthenticated user, does NOT render the おすすめサイト管理 link', () => {
    mockAuthAs({ status: 'unauthenticated', user: null })

    render(<NavigationBar />)

    expect(
      screen.queryByRole('link', { name: 'おすすめサイト管理' })
    ).not.toBeInTheDocument()
  })

  test('Given current path is /admin/featured-sites and an admin user, admin link has nav-item active class and aria-current="page"', async () => {
    const { usePathname } = await import('next/navigation')
    vi.mocked(usePathname).mockReturnValue('/admin/featured-sites')
    mockAuthAs({ user: { username: 'admin', role: 'admin' as const, display_name: 'Admin' } })

    render(<NavigationBar />)

    const adminLink = screen.getByRole('link', { name: 'おすすめサイト管理' })
    expect(adminLink).toHaveAttribute('aria-current', 'page')
    expect(adminLink.classList.contains('active')).toBe(true)
  })

  test('Given an admin user, renders sidebar-divider → 管理 label → admin link immediately after the 設定 link', () => {
    mockAuthAs({ user: { username: 'admin', role: 'admin' as const, display_name: 'Admin' } })

    render(<NavigationBar />)

    // DOM 順序を直接たどり、既存の区切り線パターン（設定リンク直前と同型）を
    // 「設定」の後にも同じ並びで踏襲していることを検証する。
    const settingsLink = screen.getByRole('link', { name: '設定' })
    const divider = settingsLink.nextElementSibling
    const sectionLabel = divider?.nextElementSibling
    const adminLink = sectionLabel?.nextElementSibling

    expect(divider).toHaveClass('sidebar-divider')
    expect(sectionLabel).toHaveClass('nav-section-label')
    expect(sectionLabel).toHaveTextContent('管理')
    expect(adminLink).toBe(screen.getByRole('link', { name: 'おすすめサイト管理' }))
  })

  // ==========================================================
  // 「招待管理」ナビ項目 — admin ロールのみ表示（招待制新規登録・issue 相当）
  // ==========================================================
  test('Given an admin user, renders the 招待管理 link pointing to /admin/invites', () => {
    mockAuthAs({ user: { username: 'admin', role: 'admin' as const, display_name: 'Admin' } })

    render(<NavigationBar />)

    expect(screen.getByRole('link', { name: '招待管理' })).toHaveAttribute('href', '/admin/invites')
  })

  test('Given a non-admin user, does NOT render the 招待管理 link', () => {
    mockAuthAs({ user: { username: 'test', role: 'user' as const, display_name: 'Test User' } })

    render(<NavigationBar />)

    expect(screen.queryByRole('link', { name: '招待管理' })).not.toBeInTheDocument()
  })

  test('Given an admin user, 招待管理 link immediately follows the おすすめサイト管理 link', () => {
    mockAuthAs({ user: { username: 'admin', role: 'admin' as const, display_name: 'Admin' } })

    render(<NavigationBar />)

    const featuredSitesLink = screen.getByRole('link', { name: 'おすすめサイト管理' })
    expect(featuredSitesLink.nextElementSibling).toBe(screen.getByRole('link', { name: '招待管理' }))
  })
})
