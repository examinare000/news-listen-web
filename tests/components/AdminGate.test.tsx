import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { AdminGate } from '@/components/AdminGate'
import type { AuthSession } from '@/lib/account/domain/authSession'

// web-contract-19: AdminGate は adminAccess(useAuth().session) の 4 値で分岐する唯一の gating 集約点。
// 設定の Provider（PreferencesProvider）に依存しない（C5: metrics page test は Provider 無しで描画するため）。
// vi.mock で useAuth を丸ごと差し替える（既存 admin 4 page test と同じ方式。C6）。
// session は AuthSession のリテラルで組み、domain は型だけを import する（値 import しない）。

interface AuthOverride {
  session: AuthSession
  login: () => Promise<void>
  logout: () => Promise<void>
  register: () => Promise<void>
  refreshMe: () => Promise<{ cleanup: string }>
  loginWithPasskey: () => Promise<void>
}

function defaultAuthOverride(): AuthOverride {
  return {
    session: { kind: 'resolving' },
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    refreshMe: vi.fn(),
    loginWithPasskey: vi.fn(),
  }
}

const authOverride: { current: AuthOverride } = { current: defaultAuthOverride() }

vi.mock('@/contexts/AuthProvider', () => ({
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

describe('AdminGate (verifies: web-contract-19)', () => {
  test('T-T16b-1: session=resolving shows a loading indicator and mounts neither children nor the login modal (verifies: web-contract-19-3, web-contract-19-4)', () => {
    authOverride.current.session = { kind: 'resolving' }
    renderGate()

    expect(screen.queryByRole('button', { name: 'secret' })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('読み込み中')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('session=unavailable shows a loading indicator and mounts neither children nor the login modal (verifies: web-contract-19-3, web-dec-66)', () => {
    authOverride.current.session = { kind: 'unavailable', failure: { reason: 'network' } }
    renderGate()

    expect(screen.queryByRole('button', { name: 'secret' })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('読み込み中')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('T-T16b-2: session=anonymous shows the login modal and does not mount children (verifies: web-contract-19-3, web-contract-19-4)', () => {
    authOverride.current.session = { kind: 'anonymous' }
    renderGate()

    expect(screen.queryByRole('button', { name: 'secret' })).toBeNull()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('T-T16b-3: session=authenticated with a non-admin user shows the denied message with the given title (verifies: web-contract-19-3, web-contract-19-4)', () => {
    authOverride.current.session = {
      kind: 'authenticated',
      user: { username: 'bob', role: 'user', display_name: 'Bob' },
    }
    renderGate('ユーザー管理')

    expect(screen.queryByRole('button', { name: 'secret' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'ユーザー管理' })).toBeInTheDocument()
    expect(screen.getByText('この画面は管理者のみ利用できます。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '設定へ戻る' })).toHaveAttribute('href', '/settings')
  })

  test('T-T16b-5: session=authenticated with an admin user mounts children and shows neither loading nor login modal (verifies: web-contract-19-3)', () => {
    authOverride.current.session = {
      kind: 'authenticated',
      user: { username: 'alice', role: 'admin', display_name: 'Alice' },
    }
    renderGate()

    expect(screen.getByRole('button', { name: 'secret' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
