import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  test('Given onConfirm is not called when isOpen=false', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog {...defaultProps} isOpen={false} onConfirm={onConfirm} />)

    // ダイアログが非表示なのでボタンが存在しない
    expect(screen.queryByRole('button', { name: /確認|削除|OK/i })).not.toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
