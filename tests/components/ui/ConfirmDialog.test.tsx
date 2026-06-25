import { describe, test, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

// ==========================================================
// ConfirmDialog — 開閉 / コールバック / Escape で閉じる
// ==========================================================
describe('ConfirmDialog', () => {
  const defaultProps = {
    isOpen: true,
    title: '削除の確認',
    message: 'このソースを削除しますか？',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }

  test('Given isOpen=true, renders the dialog with title and message', () => {
    render(<ConfirmDialog {...defaultProps} />)
    expect(screen.getByText('削除の確認')).toBeInTheDocument()
    expect(screen.getByText('このソースを削除しますか？')).toBeInTheDocument()
  })

  test('Given isOpen=false, does not render the dialog', () => {
    render(<ConfirmDialog {...defaultProps} isOpen={false} />)
    expect(screen.queryByText('削除の確認')).not.toBeInTheDocument()
  })

  test('Given user clicks confirm button, calls onConfirm', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />)

    await userEvent.click(screen.getByRole('button', { name: /確認|削除|OK/i }))

    expect(onConfirm).toHaveBeenCalledOnce()
  })

  test('Given user clicks cancel button, calls onCancel', async () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />)

    await userEvent.click(screen.getByRole('button', { name: /キャンセル|戻る/i }))

    expect(onCancel).toHaveBeenCalledOnce()
  })

  test('Given user presses Escape, calls onCancel', async () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />)

    await userEvent.keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalledOnce()
  })

  test('Dialog uses design modal classes (modal-backdrop / modal-box / btn)', () => {
    render(<ConfirmDialog {...defaultProps} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.classList.contains('modal-box')).toBe(true)
    expect(dialog.parentElement?.classList.contains('modal-backdrop')).toBe(true)

    const confirmBtn = screen.getByRole('button', { name: '確認' })
    expect(confirmBtn.classList.contains('btn')).toBe(true)
    expect(confirmBtn.classList.contains('btn-primary')).toBe(true)

    const cancelBtn = screen.getByRole('button', { name: 'キャンセル' })
    expect(cancelBtn.classList.contains('btn')).toBe(true)
    expect(cancelBtn.classList.contains('btn-ghost')).toBe(true)
  })

  test('Given onConfirm is not called when isOpen=false', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog {...defaultProps} isOpen={false} onConfirm={onConfirm} />)

    // ダイアログが非表示なのでボタンが存在しない
    expect(screen.queryByRole('button', { name: /確認|削除|OK/i })).not.toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  test('focuses cancel button on open (focus trap)', () => {
    render(<ConfirmDialog {...defaultProps} isOpen={true} />)
    const cancelButton = screen.getByRole('button', { name: /キャンセル/ })
    expect(cancelButton).toHaveFocus()
  })

  test('restores focus to trigger button when isOpen changes from true to false', async () => {
    const onCancel = vi.fn()
    function TestApp() {
      const [isOpen, setIsOpen] = React.useState(false)
      const triggerRef = React.useRef<HTMLButtonElement>(null)
      return (
        <div>
          <button ref={triggerRef} onClick={() => setIsOpen(true)}>
            削除
          </button>
          <ConfirmDialog
            isOpen={isOpen}
            title="削除の確認"
            message="このソースを削除しますか？"
            onConfirm={() => setIsOpen(false)}
            onCancel={() => {
              setIsOpen(false)
              onCancel()
            }}
          />
        </div>
      )
    }

    render(<TestApp />)
    const trigger = screen.getByRole('button', { name: '削除' })

    // Trigger にフォーカスを当てる
    await userEvent.click(trigger)

    // ダイアログが開いたことを確認
    await screen.findByText('削除の確認')

    // イニシャルフォーカスはキャンセルボタン（ダイアログが開いているため）
    expect(screen.getByRole('button', { name: /キャンセル/ })).toHaveFocus()

    // キャンセルボタンをクリック
    await userEvent.click(screen.getByRole('button', { name: /キャンセル/ }))

    // フォーカスが trigger ボタンへ復帰したことを確認
    await waitFor(() => {
      expect(trigger).toHaveFocus()
    })
  })
})
