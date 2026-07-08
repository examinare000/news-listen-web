import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { LoginModal } from '@/components/ui/LoginModal'

const login = vi.fn()

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ login, status: 'unauthenticated', user: null, logout: vi.fn(), refreshMe: vi.fn() }),
}))

// LoginModal は ApiError の status を見て文言を切り替えるため実クラスを使う。
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return actual
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('LoginModal', () => {
  test('submits username and password to login()', async () => {
    login.mockResolvedValue(undefined)
    render(<LoginModal />)

    await userEvent.type(screen.getByLabelText('ユーザーID'), 'alice')
    await userEvent.type(screen.getByLabelText('パスワード'), 'secret-pw')
    await userEvent.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => expect(login).toHaveBeenCalledWith('alice', 'secret-pw'))
  })

  test('shows validation error when fields are empty', async () => {
    render(<LoginModal />)
    await userEvent.click(screen.getByRole('button', { name: 'ログイン' }))
    expect(screen.getByText(/入力してください/)).toBeInTheDocument()
    expect(login).not.toHaveBeenCalled()
  })

  test('shows generic error message on 401', async () => {
    const { ApiError } = await import('@/lib/api')
    login.mockRejectedValue(new ApiError(401, 'Invalid username or password'))
    render(<LoginModal />)

    await userEvent.type(screen.getByLabelText('ユーザーID'), 'alice')
    await userEvent.type(screen.getByLabelText('パスワード'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() =>
      expect(screen.getByText('ユーザーIDまたはパスワードが正しくありません')).toBeInTheDocument(),
    )
  })

  test('focuses username input on mount (focus trap)', () => {
    render(<LoginModal />)
    const usernameInput = screen.getByLabelText('ユーザーID')
    expect(usernameInput).toHaveFocus()
  })

  test('displays modal-divider with "または" text', () => {
    render(<LoginModal />)
    // .modal-divider クラスを持つ要素が存在し、「または」テキストを含む
    const divider = screen.getByText('または')
    expect(divider).toHaveClass('modal-divider')
  })

  describe('onClose', () => {
    test('does not render a close affordance when onClose is not given', () => {
      render(<LoginModal />)
      expect(screen.queryByRole('button', { name: '閉じる' })).not.toBeInTheDocument()
    })

    test('renders a close button when onClose is given, and fires it on click', async () => {
      const onClose = vi.fn()
      render(<LoginModal onClose={onClose} />)

      await userEvent.click(screen.getByRole('button', { name: '閉じる' }))

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
