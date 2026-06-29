import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { SidebarAccount } from '@/components/ui/SidebarAccount'
import type { AuthUser } from '@/types/index'

// ログアウトの押下挙動（呼び出し回数・disabled・二重押下防止）は
// LogoutButton.test.tsx で検証する。本ファイルは表示ゲートと表示内容に集中する。
const mockLogout = vi.fn()

const MOCK_USER_AUTHENTICATED: AuthUser = {
  username: 'alice',
  role: 'user',
  display_name: 'Alice',
}

const MOCK_USER_ADMIN: AuthUser = {
  username: 'admin-bob',
  role: 'admin',
  display_name: 'Bob Admin',
}

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}))

// next/navigation は tests/setup.ts のグローバルモックで賄う（LogoutButton の useRouter 用）。

async function mockUseAuth(overrides: Record<string, unknown>) {
  const { useAuth } = await import('@/contexts/AuthContext')
  vi.mocked(useAuth).mockReturnValue({
    logout: mockLogout,
    login: vi.fn(),
    refreshMe: vi.fn(),
    loginWithPasskey: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useAuth>)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SidebarAccount', () => {
  // ──────────────────────────────────────────────────
  // 認証済み状態（status === 'authenticated' && user が存在）
  // ──────────────────────────────────────────────────
  test('authenticated + user → displays user label and logout button', async () => {
    await mockUseAuth({ status: 'authenticated', user: MOCK_USER_AUTHENTICATED })

    render(<SidebarAccount />)

    // 表示名・username・role が表示される（formatAuthUserLabel 由来）
    expect(screen.getByText(/Alice（alice \/ user）/)).toBeInTheDocument()
    // ログアウトボタン（LogoutButton）が表示される
    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeInTheDocument()
  })

  test('authenticated + admin user → displays admin user label', async () => {
    await mockUseAuth({ status: 'authenticated', user: MOCK_USER_ADMIN })

    render(<SidebarAccount />)

    expect(screen.getByText(/Bob Admin（admin-bob \/ admin）/)).toBeInTheDocument()
  })

  // ──────────────────────────────────────────────────
  // 未認証状態（status === 'unauthenticated'）→ 何も描画しない
  // ──────────────────────────────────────────────────
  test('unauthenticated → renders nothing (null)', async () => {
    await mockUseAuth({ status: 'unauthenticated', user: null })

    const { container } = render(<SidebarAccount />)

    expect(container.firstChild).toBeNull()
  })

  // ──────────────────────────────────────────────────
  // ローディング中状態（status === 'unknown'）→ 何も描画しない
  // ──────────────────────────────────────────────────
  test('unknown (loading) → renders nothing (null)', async () => {
    await mockUseAuth({ status: 'unknown', user: null })

    const { container } = render(<SidebarAccount />)

    expect(container.firstChild).toBeNull()
  })
})
