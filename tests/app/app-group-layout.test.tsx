import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import AppGroupLayout from '@/app/(app)/layout'
import { PreferencesProvider } from '@/contexts/PreferencesProvider'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'
import { ToastProvider } from '@/components/ui/Toast'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { PlaybackProvider } from '@/contexts/PlaybackProvider'

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

// NavigationBar は useAuth を参照する。AuthProvider 経由だと実 /auth/me fetch が走るため、
// NavigationBar.test.tsx と同様にモックして分離する。
vi.mock('@/contexts/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    user: { username: 'test', role: 'user', display_name: 'Test User' },
    logout: vi.fn(),
    login: vi.fn(),
    refreshMe: vi.fn(),
  }),
}))

function renderGroupLayout(children: React.ReactNode = <p>page-content</p>) {
  return render(
    <PreferencesProvider store={memoryStore()}>
      <ToastProvider>
        <ApiClientProvider>
          <PlaybackProvider>
            <AppGroupLayout>{children}</AppGroupLayout>
          </PlaybackProvider>
        </ApiClientProvider>
      </ToastProvider>
    </PreferencesProvider>
  )
}

describe('(app) route group layout', () => {
  test('children を main.main-content 内に描画する（旧 RootLayout の可視シェルの移譲先）', () => {
    renderGroupLayout(<p>page-content</p>)
    const main = screen.getByText('page-content').closest('main')
    expect(main).not.toBeNull()
    expect(main).toHaveClass('main-content')
  })

  test('NavigationBar（メインナビゲーション）を描画する', () => {
    renderGroupLayout()
    expect(screen.getByRole('navigation', { name: 'メインナビゲーション' })).toBeInTheDocument()
  })

  test('app-shell グリッドコンテナで NavigationBar・main・AudioPlayerBar を包む', () => {
    const { container } = renderGroupLayout()
    const shell = container.querySelector('.app-shell')
    expect(shell).not.toBeNull()
    expect(shell?.querySelector('nav[aria-label="メインナビゲーション"]')).not.toBeNull()
    expect(shell?.querySelector('main.main-content')).not.toBeNull()
  })
})
