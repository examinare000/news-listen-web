import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import SignupPage from '@/app/signup/page'
import { ApiError } from '@/lib/api'

const mockReplace = vi.fn()
const register = vi.fn()
const authStatusOverride = vi.hoisted(() => ({ current: 'unauthenticated' }))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    status: authStatusOverride.current,
    user: null,
    login: vi.fn(),
    logout: vi.fn(),
    register,
    refreshMe: vi.fn(),
  }),
}))

const VALID_PASSWORD = 'Sup3r-Secret!!'

beforeEach(async () => {
  vi.clearAllMocks()
  authStatusOverride.current = 'unauthenticated'
  const { useRouter, useSearchParams } = await import('next/navigation')
  vi.mocked(useRouter).mockReturnValue({ replace: mockReplace } as unknown as ReturnType<typeof useRouter>)
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>)
})

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('ユーザーID'), 'newbie')
  await user.type(screen.getByLabelText('パスワード'), VALID_PASSWORD)
  await user.type(screen.getByLabelText('パスワード（確認）'), VALID_PASSWORD)
}

describe('SignupPage — invite prefill', () => {
  test('prefills the invite code field from ?invite= query param', async () => {
    const { useSearchParams } = await import('next/navigation')
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams('invite=E2ECODE') as unknown as ReturnType<typeof useSearchParams>)

    render(<SignupPage />)

    expect(await screen.findByLabelText('招待コード')).toHaveValue('E2ECODE')
  })
})

describe('SignupPage — client-side validation', () => {
  test('shows an error when the username fails the allowed pattern', async () => {
    const user = userEvent.setup()
    render(<SignupPage />)

    await user.type(screen.getByLabelText('ユーザーID'), 'A!')
    await user.type(screen.getByLabelText('パスワード'), VALID_PASSWORD)
    await user.type(screen.getByLabelText('パスワード（確認）'), VALID_PASSWORD)
    await user.click(screen.getByRole('button', { name: '登録する' }))

    expect(await screen.findByText(/ユーザーIDは/)).toBeInTheDocument()
    expect(register).not.toHaveBeenCalled()
  })

  test('shows an error when the password is too weak', async () => {
    const user = userEvent.setup()
    render(<SignupPage />)

    await user.type(screen.getByLabelText('ユーザーID'), 'newbie')
    await user.type(screen.getByLabelText('パスワード'), 'short1A')
    await user.type(screen.getByLabelText('パスワード（確認）'), 'short1A')
    await user.click(screen.getByRole('button', { name: '登録する' }))

    expect(await screen.findByText('パスワードは12文字以上にしてください')).toBeInTheDocument()
    expect(register).not.toHaveBeenCalled()
  })

  test('shows an error when password confirmation does not match', async () => {
    const user = userEvent.setup()
    render(<SignupPage />)

    await user.type(screen.getByLabelText('ユーザーID'), 'newbie')
    await user.type(screen.getByLabelText('パスワード'), VALID_PASSWORD)
    await user.type(screen.getByLabelText('パスワード（確認）'), 'DifferentPassw0rd!!')
    await user.click(screen.getByRole('button', { name: '登録する' }))

    expect(await screen.findByText(/一致しません/)).toBeInTheDocument()
    expect(register).not.toHaveBeenCalled()
  })
})

describe('SignupPage — submit success', () => {
  test('calls register with the form values and replaces to "/"', async () => {
    register.mockResolvedValue(undefined)
    const user = userEvent.setup()
    const { useSearchParams } = await import('next/navigation')
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams('invite=E2ECODE') as unknown as ReturnType<typeof useSearchParams>)

    render(<SignupPage />)
    await user.type(screen.getByLabelText('ユーザーID'), 'newbie')
    await user.type(screen.getByLabelText('表示名（任意）'), 'Newbie')
    await user.type(screen.getByLabelText('パスワード'), VALID_PASSWORD)
    await user.type(screen.getByLabelText('パスワード（確認）'), VALID_PASSWORD)
    await user.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() =>
      expect(register).toHaveBeenCalledWith({
        invite_code: 'E2ECODE',
        username: 'newbie',
        password: VALID_PASSWORD,
        display_name: 'Newbie',
      }),
    )
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'))
  })

  // 回帰防止: register() 成功で status が 'authenticated' に変わると、下部の「既にログイン
  // 済みなら /feed へ」効果とレースし、root gate（オンボーディング判定）を素通りして直接
  // /feed へ飛んでしまうバグが実ブラウザ（Playwright）で発現した。
  test('does NOT also replace to "/feed" (would bypass the root onboarding gate)', async () => {
    register.mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<SignupPage />)
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'))
    expect(mockReplace).not.toHaveBeenCalledWith('/feed')
  })
})

describe('SignupPage — server error mapping', () => {
  test.each([
    [400, '招待コードが無効または期限切れです'],
    [409, 'このユーザーIDは使用できません'],
    [403, '現在、新規登録は受け付けていません'],
    [429, '試行回数が上限に達しました。しばらくしてからお試しください'],
  ])('maps %i to the expected message', async (status, expected) => {
    register.mockRejectedValue(new ApiError(status, 'server detail'))
    const user = userEvent.setup()
    render(<SignupPage />)
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: '登録する' }))

    expect(await screen.findByText(expected)).toBeInTheDocument()
  })

  test('422 shows the server-provided validation detail', async () => {
    register.mockRejectedValue(new ApiError(422, 'password must not contain the username'))
    const user = userEvent.setup()
    render(<SignupPage />)
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: '登録する' }))

    expect(await screen.findByText('password must not contain the username')).toBeInTheDocument()
  })
})

describe('SignupPage — already authenticated', () => {
  test('replaces to "/feed" when already authenticated', async () => {
    authStatusOverride.current = 'authenticated'
    render(<SignupPage />)

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/feed'))
  })
})
