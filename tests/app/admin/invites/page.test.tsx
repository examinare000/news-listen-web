import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import AdminInvitesPage from '@/app/(app)/admin/invites/page'
import { PreferencesProvider } from '@/contexts/PreferencesProvider'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'
import { ToastProvider } from '@/components/ui/Toast'
import { createGatewayDouble } from '../../../helpers/gatewayDouble'
import type { GatewayDouble } from '../../../helpers/gatewayDouble'

// 設定の保存先は、テストごとに新しい in-memory の KeyValueStore
const memoryStore = (initial: Record<string, string> = {}): KeyValueStore => {
  const data = new Map(Object.entries(initial))
  return {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => {
      data.set(key, value)
      return true
    },
    remove: (key) => {
      data.delete(key)
    },
  }
}

const holder = vi.hoisted(() => ({ gw: undefined as GatewayDouble | undefined }))

vi.mock('@/lib/api/gateway', () => ({ createGateway: () => holder.gw }))

const INVITES_PATH = '/api/backend/admin/invites'
const invitePath = (id: string) => `${INVITES_PATH}/${encodeURIComponent(id)}`

let gw: GatewayDouble

function callsTo(method: string, path: string) {
  return gw.calls.filter((c) => c.method === method && c.path === path)
}

const authOverride = vi.hoisted(() => ({
  current: { username: 'admin', role: 'admin', display_name: 'Admin' },
}))
vi.mock('@/contexts/AuthProvider', () => ({
  useAuth: () => ({ status: 'authenticated', user: authOverride.current, session: { kind: 'authenticated', user: authOverride.current }, login: vi.fn(), logout: vi.fn(), register: vi.fn(), refreshMe: vi.fn() }),
}))

const writeText = vi.fn().mockResolvedValue(undefined)

function renderPage() {
  return render(
    <PreferencesProvider store={memoryStore()}>
      <ToastProvider>
        <AdminInvitesPage />
      </ToastProvider>
    </PreferencesProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  gw = createGatewayDouble()
  holder.gw = gw
  writeText.mockClear().mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { writeText } })
  authOverride.current = { username: 'admin', role: 'admin', display_name: 'Admin' }
  gw.respond('GET', INVITES_PATH, {
    ok: true,
    value: {
      invites: [
        {
          id: 'inv1',
          note: 'for alice',
          created_by: 'admin',
          max_uses: 1,
          use_count: 0,
          used_by: [],
          expires_at: '2026-08-01T00:00:00Z',
          revoked_at: null,
          created_at: '2026-07-01T00:00:00Z',
          status: 'active',
        },
      ],
    },
  })
})

describe('AdminInvitesPage', () => {
  test('non-admin sees a forbidden message and does not load invites', () => {
    authOverride.current = { username: 'bob', role: 'user', display_name: 'Bob' }
    renderPage()
    expect(screen.getByText(/管理者のみ利用できます/)).toBeInTheDocument()
    expect(callsTo('GET', INVITES_PATH)).toHaveLength(0)
  })

  test('lists invites on mount', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('for alice')).toBeInTheDocument())
    expect(callsTo('GET', INVITES_PATH).length).toBeGreaterThan(0)
  })

  test('creating an invite shows the invite_url once, with a copy button', async () => {
    gw.respond('POST', INVITES_PATH, {
      ok: true,
      value: {
        id: 'inv2',
        code: 'NEWCODE',
        invite_url: 'https://example.com/signup?invite=NEWCODE',
        note: 'for bob',
        max_uses: 1,
        expires_at: null,
        created_at: '2026-07-08T00:00:00Z',
      },
    })
    renderPage()
    await waitFor(() => expect(callsTo('GET', INVITES_PATH).length).toBeGreaterThan(0))

    await userEvent.type(screen.getByLabelText('メモ'), 'for bob')
    await userEvent.click(screen.getByRole('button', { name: '招待コードを作成' }))

    await waitFor(() =>
      expect(screen.getByText('https://example.com/signup?invite=NEWCODE')).toBeInTheDocument(),
    )

    await userEvent.click(screen.getByRole('button', { name: 'コピー' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://example.com/signup?invite=NEWCODE'))
    expect(await screen.findByText('招待URLをコピーしました')).toBeInTheDocument()
  })

  test('revoking an invite calls the API after confirmation', async () => {
    gw.respond('DELETE', invitePath('inv1'), { ok: true, value: undefined })
    renderPage()
    await waitFor(() => expect(screen.getByText('for alice')).toBeInTheDocument())

    await userEvent.click(screen.getByLabelText('for alice を失効'))
    await userEvent.click(screen.getByRole('button', { name: '確認' }))

    await waitFor(() =>
      expect(gw.calls).toContainEqual({ method: 'DELETE', path: invitePath('inv1'), body: undefined }),
    )
  })
})
