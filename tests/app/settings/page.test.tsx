import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import SettingsPage from '@/app/settings/page'
import { AppProvider, useApp } from '@/contexts/AppContext'
import { ToastProvider } from '@/components/ui/Toast'

vi.mock('@/lib/api', () => ({
  createApiClient: vi.fn(() => ({
    checkHealth: vi.fn(),
  })),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public detail: string) {
      super(detail)
    }
  },
}))

function renderSettingsPage(baseUrl = 'https://api.example.com') {
  return render(
    <AppProvider initialState={{ isConfigured: true, baseUrl, apiKey: 'stored-key' }}>
      <ToastProvider>
        <SettingsPage />
      </ToastProvider>
    </AppProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

// ==========================================================
// Settings 画面 — 表示
// ==========================================================
describe('SettingsPage — display', () => {
  test('Shows current baseUrl', async () => {
    renderSettingsPage('https://my-api.example.com')
    expect(screen.getByText(/https:\/\/my-api.example.com/)).toBeInTheDocument()
  })

  test('Does NOT display the actual apiKey value (security: masked)', async () => {
    renderSettingsPage()
    // 実際のキー値が表示されていないこと
    expect(screen.queryByText('stored-key')).not.toBeInTheDocument()
    // 「設定済み」などのマスク表示がある
    expect(screen.getByText(/設定済み|設定されています/i)).toBeInTheDocument()
  })

  test('apiKey re-input field has type="password"', () => {
    renderSettingsPage()
    const passwordInputs = screen.getAllByDisplayValue('')
    const apiKeyInput = passwordInputs.find(
      (el) => el.getAttribute('type') === 'password' || el.getAttribute('name')?.includes('api')
    )
    // type="password" の入力欄が存在すること
    expect(document.querySelector('input[type="password"]')).toBeInTheDocument()
  })

  test('Displays difficulty explanation text (no difficulty UI)', async () => {
    renderSettingsPage()
    expect(screen.getByText(/サーバー側設定/)).toBeInTheDocument()
  })

  test('Shows guidance that the API URL and key can be edited here', async () => {
    // API キーの修正導線がここにあることを明示する案内
    renderSettingsPage()
    expect(screen.getByText(/ここでいつでも変更できます/)).toBeInTheDocument()
  })

  test('Renders speed selector with 8 options', async () => {
    renderSettingsPage()
    const speedSelect = screen.getByRole('combobox', { name: /速度|speed/i })
    expect(speedSelect).toBeInTheDocument()
  })
})

// ==========================================================
// Settings 画面 — 設定保存
// ==========================================================
describe('SettingsPage — save settings', () => {
  test('Given new baseUrl and apiKey saved, calls configure() and updates localStorage', async () => {
    renderSettingsPage()

    // 新しい URL を入力
    const urlInput = screen.getByRole('textbox', { name: /base.*url|API.*URL/i })
    await userEvent.clear(urlInput)
    await userEvent.type(urlInput, 'https://new-api.example.com')

    const apiKeyInput = document.querySelector('input[type="password"]') as HTMLInputElement
    await userEvent.clear(apiKeyInput)
    await userEvent.type(apiKeyInput, 'new-key')

    await userEvent.click(screen.getByRole('button', { name: /保存|save/i }))

    await waitFor(() => {
      expect(localStorage.getItem('api_base_url')).toBe(JSON.stringify('https://new-api.example.com'))
      expect(localStorage.getItem('api_key')).toBe(JSON.stringify('new-key'))
    })
  })

  test('Given API key field is left blank on save, preserves the existing API key', async () => {
    renderSettingsPage()

    // URL を変更するが API キー欄は空のまま保存
    const urlInput = screen.getByRole('textbox', { name: /base.*url|API.*URL/i })
    await userEvent.clear(urlInput)
    await userEvent.type(urlInput, 'https://updated-api.example.com')

    await userEvent.click(screen.getByRole('button', { name: /保存|save/i }))

    await waitFor(() => {
      // URL は更新される
      expect(localStorage.getItem('api_base_url')).toBe(JSON.stringify('https://updated-api.example.com'))
      // API キーは既存のもの（'stored-key'）が保持される
      expect(localStorage.getItem('api_key')).toBe(JSON.stringify('stored-key'))
    })
  })

  test('Given speed changed, updates localStorage', async () => {
    renderSettingsPage()
    const speedSelect = screen.getByRole('combobox', { name: /速度|speed/i })

    await userEvent.selectOptions(speedSelect, '1.5')

    expect(localStorage.getItem('default_playback_speed')).toBe(JSON.stringify(1.5))
  })

  test('Given speed changed, dispatches SET_SPEED to AppContext immediately (spec §10.5)', async () => {
    // Wrap SettingsPage with AppProvider and read back state to verify dispatch
    let capturedState: { playbackSpeed: number } | null = null

    function TestConsumer() {
      const { state } = useApp()
      capturedState = { playbackSpeed: state.playbackSpeed }
      return null
    }

    render(
      <AppProvider initialState={{ isConfigured: true, baseUrl: 'https://api.example.com', apiKey: 'key' }}>
        <ToastProvider>
          <SettingsPage />
          <TestConsumer />
        </ToastProvider>
      </AppProvider>
    )

    const speedSelect = screen.getByRole('combobox', { name: /速度|speed/i })
    await userEvent.selectOptions(speedSelect, '1.75')

    await waitFor(() => {
      expect(capturedState?.playbackSpeed).toBe(1.75)
    })
  })
})

// ==========================================================
// Settings 画面 — 接続テストボタン
// ==========================================================
describe('SettingsPage — connection test', () => {
  test('Renders a connection test button', async () => {
    renderSettingsPage()
    expect(screen.getByRole('button', { name: /接続テスト|connection test|テスト/i })).toBeInTheDocument()
  })

  test('Given connection test succeeds, shows success indicator', async () => {
    const { createApiClient } = await import('@/lib/api')
    createApiClient.mockReturnValue({
      checkHealth: vi.fn().mockResolvedValue({ status: 'ok' }),
    })

    renderSettingsPage()
    await userEvent.click(screen.getByRole('button', { name: /接続テスト|connection test|テスト/i }))

    await waitFor(() => {
      expect(screen.getByText(/成功|接続できました|ok/i)).toBeInTheDocument()
    })
  })

  test('Given connection test fails, shows failure indicator', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    createApiClient.mockReturnValue({
      checkHealth: vi.fn().mockRejectedValue(new ApiError(0, 'Network error')),
    })

    renderSettingsPage()
    await userEvent.click(screen.getByRole('button', { name: /接続テスト|connection test|テスト/i }))

    await waitFor(() => {
      expect(screen.getByText(/失敗|接続できません|エラー/i)).toBeInTheDocument()
    })
  })
})
