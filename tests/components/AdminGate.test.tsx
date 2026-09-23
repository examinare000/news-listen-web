import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { AdminGate } from '@/components/AdminGate'

// CI-T16: AdminGate は adminAccess(useAuth()) の 4 値で分岐する唯一の gating 集約点。
// useApp() に依存しない（C5: metrics page test は AppProvider 無しで描画するため）。
// vi.mock で useAuth を丸ごと差し替える（既存 admin 4 page test と同じ方式。C6）。

interface AuthOverride {
  status: 'unknown' | 'authenticated' | 'unauthenticated'
  user: { username: string; role: 'admin' | 'user'; display_name: string } | null
  login: () => Promise<void>
  logout: () => Promise<void>
  register: () => Promise<void>
  refreshMe: () => Promise<{ cleanup: string }>
  loginWithPasskey: () => Promise<void>
}

function defaultAuthOverride(): AuthOverride {
  return {
    status: 'unknown',
    user: null,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    refreshMe: vi.fn(),
    loginWithPasskey: vi.fn(),
  }
}

const authOverride: { current: AuthOverride } = { current: defaultAuthOverride() }

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authOverride.current,
}))

beforeEach(() => {
  authOverride.current = defaultAuthOverride()
})

function renderGate(title = 'ユーザー管理') {
  return render(
    <AdminGate title={title}>
      <button>secret</button>
    </AdminGate>
  )
}

describe('AdminGate (verifies: CI-T16)', () => {
  test('T-T16b-1: status=unknown shows a loading indicator and mounts neither children nor the login modal (verifies: CI-T16-3, CI-T16-4)', () => {
    authOverride.current.status = 'unknown'
    renderGate()

    expect(screen.queryByRole('button', { name: 'secret' })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('読み込み中')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('T-T16b-2: status=unauthenticated shows the login modal and does not mount children (verifies: CI-T16-3, CI-T16-4)', () => {
    authOverride.current.status = 'unauthenticated'
    renderGate()

    expect(screen.queryByRole('button', { name: 'secret' })).toBeNull()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('T-T16b-3: status=authenticated with a non-admin user shows the denied message with the given title (verifies: CI-T16-3, CI-T16-4)', () => {
    authOverride.current.status = 'authenticated'
    authOverride.current.user = { username: 'bob', role: 'user', display_name: 'Bob' }
    renderGate('ユーザー管理')

    expect(screen.queryByRole('button', { name: 'secret' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'ユーザー管理' })).toBeInTheDocument()
    expect(screen.getByText('この画面は管理者のみ利用できます。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '設定へ戻る' })).toHaveAttribute('href', '/settings')
  })

  test('T-T16b-4: status=authenticated with user=null shows the denied message (verifies: CI-T16-3)', () => {
    authOverride.current.status = 'authenticated'
    authOverride.current.user = null
    renderGate()

    expect(screen.queryByRole('button', { name: 'secret' })).toBeNull()
    expect(screen.getByText('この画面は管理者のみ利用できます。')).toBeInTheDocument()
  })

  test('T-T16b-5: status=authenticated with an admin user mounts children and shows neither loading nor login modal (verifies: CI-T16-3)', () => {
    authOverride.current.status = 'authenticated'
    authOverride.current.user = { username: 'alice', role: 'admin', display_name: 'Alice' }
    renderGate()

    expect(screen.getByRole('button', { name: 'secret' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
