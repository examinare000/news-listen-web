import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { LogoutButton } from '@/components/ui/LogoutButton'

const mockLogout = vi.fn()
const mockReplace = vi.fn()
const mockPush = vi.fn()

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    replace: mockReplace,
    push: mockPush,
  })),
  usePathname: vi.fn(() => '/'),
}))

async function setupUseAuth() {
  const { useAuth } = await import('@/contexts/AuthContext')
  vi.mocked(useAuth).mockReturnValue({
    status: 'authenticated',
    user: { username: 'alice', role: 'user', display_name: 'Alice' },
    logout: mockLogout,
    login: vi.fn(),
    refreshMe: vi.fn(),
    loginWithPasskey: vi.fn(),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks は実装をリセットしないため、遅延 impl のテスト間漏れを防ぐ
  mockLogout.mockReset()
  mockReplace.mockReset()
  mockPush.mockReset()
})

describe('LogoutButton', () => {
  test('renders a button labeled ログアウト', async () => {
    await setupUseAuth()
    render(<LogoutButton />)
    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeInTheDocument()
  })

  test('applies a custom className when provided', async () => {
    await setupUseAuth()
    render(<LogoutButton className="btn btn-primary" />)
    expect(screen.getByRole('button', { name: 'ログアウト' })).toHaveClass('btn', 'btn-primary')
  })

  test('clicking calls logout once', async () => {
    await setupUseAuth()
    render(<LogoutButton />)
    await userEvent.click(screen.getByRole('button', { name: 'ログアウト' }))
    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1))
  })

  test('is disabled while logout is in progress', async () => {
    await setupUseAuth()
    let resolveLogout: () => void = () => {}
    mockLogout.mockImplementation(() => new Promise<void>((r) => { resolveLogout = r }))

    render(<LogoutButton />)
    const btn = screen.getByRole('button', { name: 'ログアウト' })
    expect(btn).not.toHaveAttribute('disabled')

    await userEvent.click(btn)
    expect(btn).toHaveAttribute('disabled')

    // 進行中の logout を解決し、状態更新を act 内でフラッシュして警告を防ぐ
    resolveLogout()
    await waitFor(() => expect(btn).not.toHaveAttribute('disabled'))
  })

  test('double-click does not call logout twice', async () => {
    await setupUseAuth()
    let resolveLogout: () => void = () => {}
    mockLogout.mockImplementation(() => new Promise<void>((r) => { resolveLogout = r }))

    render(<LogoutButton />)
    const btn = screen.getByRole('button', { name: 'ログアウト' })
    await userEvent.click(btn)
    await userEvent.click(btn)

    expect(mockLogout).toHaveBeenCalledTimes(1)

    resolveLogout()
    await waitFor(() => expect(btn).not.toHaveAttribute('disabled'))
  })

  test('calls router.replace("/") after logout resolves', async () => {
    await setupUseAuth()
    let resolveLogout: () => void = () => {}
    mockLogout.mockImplementation(() => new Promise<void>((r) => { resolveLogout = r }))

    render(<LogoutButton />)
    const btn = screen.getByRole('button', { name: 'ログアウト' })

    await userEvent.click(btn)
    // logout は呼ばれたが、まだ Promise 未解決なので replace は呼ばれていない
    expect(mockLogout).toHaveBeenCalledTimes(1)
    expect(mockReplace).not.toHaveBeenCalled()

    // logout Promise を解決
    resolveLogout()
    // replace が呼ばれるのを待つ
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1))
    expect(mockReplace).toHaveBeenCalledWith('/')
  })

  test('uses replace not push for redirect after logout', async () => {
    await setupUseAuth()
    let resolveLogout: () => void = () => {}
    mockLogout.mockImplementation(() => new Promise<void>((r) => { resolveLogout = r }))

    render(<LogoutButton />)
    await userEvent.click(screen.getByRole('button', { name: 'ログアウト' }))

    resolveLogout()
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1))

    expect(mockPush).not.toHaveBeenCalled()
  })

  test('double-click calls router.replace only once', async () => {
    await setupUseAuth()
    let resolveLogout: () => void = () => {}
    mockLogout.mockImplementation(() => new Promise<void>((r) => { resolveLogout = r }))

    render(<LogoutButton />)
    const btn = screen.getByRole('button', { name: 'ログアウト' })

    await userEvent.click(btn)
    await userEvent.click(btn)

    expect(mockLogout).toHaveBeenCalledTimes(1)
    expect(mockReplace).not.toHaveBeenCalled()

    resolveLogout()
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1))
  })
})
