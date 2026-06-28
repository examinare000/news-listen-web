import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { AppProvider } from '@/contexts/AppContext'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'

const getMe = vi.fn()
const login = vi.fn()
const logout = vi.fn()

vi.mock('@/lib/api', () => ({
  createApiClient: () => ({ getMe, login, logout }),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public detail: string) {
      super(detail)
      this.name = 'ApiError'
    }
  },
}))

function Consumer() {
  const { status, user, login: doLogin, logout: doLogout } = useAuth()
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user?.username ?? '-'}</span>
      <button onClick={() => doLogin('alice', 'pw')}>login</button>
      <button onClick={() => doLogout()}>logout</button>
    </div>
  )
}

function renderAuth() {
  return render(
    <AppProvider>
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    </AppProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe('AuthProvider auto-resolution', () => {
  test('resolves authenticated when /auth/me succeeds', async () => {
    getMe.mockResolvedValue({ username: 'alice', role: 'user', display_name: 'Alice' })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    expect(screen.getByTestId('user')).toHaveTextContent('alice')
  })

  test('resolves unauthenticated when /auth/me fails (401)', async () => {
    getMe.mockRejectedValue(new Error('401'))
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(screen.getByTestId('user')).toHaveTextContent('-')
  })
})

describe('login / logout', () => {
  test('login success sets user and authenticated status', async () => {
    getMe.mockRejectedValue(new Error('401'))
    login.mockResolvedValue({ token: 't', user: { username: 'bob', role: 'admin', display_name: 'Bob' } })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))

    await userEvent.click(screen.getByText('login'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    expect(screen.getByTestId('user')).toHaveTextContent('bob')
  })

  test('logout clears user', async () => {
    getMe.mockResolvedValue({ username: 'alice', role: 'user', display_name: 'Alice' })
    logout.mockResolvedValue({ status: 'ok' })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))

    await userEvent.click(screen.getByText('logout'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(screen.getByTestId('user')).toHaveTextContent('-')
  })
})
