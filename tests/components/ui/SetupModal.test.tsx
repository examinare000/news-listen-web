import { describe, test, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { SetupModal } from '@/components/ui/SetupModal'

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

function renderModal(onConfigure = vi.fn()) {
  return render(<SetupModal onConfigure={onConfigure} />)
}

// ==========================================================
// SetupModal — バリデーション / セキュリティ
// ==========================================================
describe('SetupModal', () => {
  test('Renders the modal form', async () => {
    renderModal()
    expect(screen.getByRole('textbox', { name: /base.*url|API.*URL/i })).toBeInTheDocument()
    expect(document.querySelector('input[type="password"]')).toBeInTheDocument()
  })

  test('apiKey input has type="password" (security requirement)', () => {
    renderModal()
    expect(document.querySelector('input[type="password"]')).toBeInTheDocument()
  })

  test('Given empty URL, save button is disabled or shows inline error', async () => {
    renderModal()
    const saveBtn = screen.getByRole('button', { name: /保存|save|設定|configure/i })

    // 入力なしで保存試行
    await userEvent.click(saveBtn)

    // エラーメッセージが表示されるか、ボタンが機能しないこと
    // 空フィールドが複数あると検証エラーも複数表示されうるため queryAllByText で受ける
    const hasError = screen.queryAllByText(/必須|入力してください|required/i).length > 0 ||
      saveBtn.hasAttribute('disabled')
    expect(hasError).toBe(true)
  })

  test('Given URL without https:// prefix, shows inline error', async () => {
    renderModal()
    const urlInput = screen.getByRole('textbox', { name: /base.*url|API.*URL/i })
    const apiKeyInput = document.querySelector('input[type="password"]') as HTMLInputElement

    await userEvent.type(urlInput, 'http-invalid.example.com')
    await userEvent.type(apiKeyInput, 'my-key')
    await userEvent.click(screen.getByRole('button', { name: /保存|save|設定|configure/i }))

    expect(screen.getByText(/https/i)).toBeInTheDocument()
  })

  test('Given empty apiKey, save button is disabled or shows inline error', async () => {
    renderModal()
    const urlInput = screen.getByRole('textbox', { name: /base.*url|API.*URL/i })
    await userEvent.type(urlInput, 'https://api.example.com')
    // apiKey は入力しない
    await userEvent.click(screen.getByRole('button', { name: /保存|save|設定|configure/i }))

    const hasError = screen.queryAllByText(/必須|入力してください|required/i).length > 0 ||
      screen.getByRole('button', { name: /保存|save|設定|configure/i }).hasAttribute('disabled')
    expect(hasError).toBe(true)
  })

  test('Given valid baseUrl and apiKey, calls onConfigure', async () => {
    const onConfigure = vi.fn()
    renderModal(onConfigure)

    const urlInput = screen.getByRole('textbox', { name: /base.*url|API.*URL/i })
    const apiKeyInput = document.querySelector('input[type="password"]') as HTMLInputElement

    await userEvent.type(urlInput, 'https://api.example.com')
    await userEvent.type(apiKeyInput, 'valid-key')
    await userEvent.click(screen.getByRole('button', { name: /保存|save|設定|configure/i }))

    await waitFor(() => {
      expect(onConfigure).toHaveBeenCalledWith('https://api.example.com', 'valid-key')
    })
  })

  test('Has a connection test button', async () => {
    renderModal()
    expect(screen.getByRole('button', { name: /接続テスト|test|確認/i })).toBeInTheDocument()
  })

  test('Shows guidance that the API config can be changed later from Settings', () => {
    // 初回入力で誤ったキーを保存しても、後から修正できる導線があることをユーザーに示す
    renderModal()
    expect(screen.getByText(/Settings.*いつでも変更できます|いつでも変更できます/)).toBeInTheDocument()
  })

  test('Modal uses design classes (modal-backdrop / modal-box / modal-logo / form-input / btn)', () => {
    renderModal()
    const dialog = screen.getByRole('dialog')
    expect(dialog.classList.contains('modal-box')).toBe(true)
    expect(dialog.parentElement?.classList.contains('modal-backdrop')).toBe(true)
    expect(dialog.querySelector('.modal-logo')).not.toBeNull()
    expect(dialog.querySelector('.modal-title')).not.toBeNull()
    expect(dialog.querySelector('.modal-desc')).not.toBeNull()

    const urlInput = screen.getByRole('textbox', { name: /base.*url|API.*URL/i })
    expect(urlInput.classList.contains('form-input')).toBe(true)
    const keyInput = document.querySelector('input[type="password"]') as HTMLInputElement
    expect(keyInput.classList.contains('form-input')).toBe(true)

    const saveBtn = screen.getByRole('button', { name: /保存/ })
    expect(saveBtn.classList.contains('btn')).toBe(true)
    expect(saveBtn.classList.contains('btn-primary')).toBe(true)
    const testBtn = screen.getByRole('button', { name: /接続テスト/ })
    expect(testBtn.classList.contains('btn')).toBe(true)
    expect(testBtn.classList.contains('btn-ghost')).toBe(true)
  })

  test('Given connection test button clicked, calls checkHealth via /api/backend/health', async () => {
    const { createApiClient } = await import('@/lib/api')
    const checkHealth = vi.fn().mockResolvedValue({ status: 'ok' })
    // vi.mocked + 戻り値キャストで型エラーなくモックを差し替える（挙動は従来と同一）
    vi.mocked(createApiClient).mockReturnValue({ checkHealth } as unknown as ReturnType<
      typeof createApiClient
    >)

    renderModal()

    const urlInput = screen.getByRole('textbox', { name: /base.*url|API.*URL/i })
    await userEvent.type(urlInput, 'https://api.example.com')

    await userEvent.click(screen.getByRole('button', { name: /接続テスト|test|確認/i }))

    await waitFor(() => {
      expect(checkHealth).toHaveBeenCalled()
    })
  })

  test('focuses base URL input on mount (focus trap)', () => {
    renderModal()
    const baseUrlInput = screen.getByRole('textbox', { name: /base.*url|API.*URL/i })
    expect(baseUrlInput).toHaveFocus()
  })
})
