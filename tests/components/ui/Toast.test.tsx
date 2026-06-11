import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'
import { ToastProvider, useToast } from '@/components/ui/Toast'

function TestComponent({ message, type = 'success' }: { message: string; type?: 'success' | 'error' }) {
  const { showToast } = useToast()
  return (
    <button onClick={() => showToast(message, type)}>
      Show Toast
    </button>
  )
}

function renderWithProvider(message: string, type: 'success' | 'error' = 'success') {
  return render(
    <ToastProvider>
      <TestComponent message={message} type={type} />
    </ToastProvider>
  )
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

// ==========================================================
// Toast — メッセージ表示 / 自動消滅 / role 属性
// ==========================================================
describe('Toast', () => {
  test('Given showToast("message") is called, displays the message', () => {
    renderWithProvider('テスト通知')
    act(() => {
      screen.getByText('Show Toast').click()
    })
    expect(screen.getByText('テスト通知')).toBeInTheDocument()
  })

  test('Given success toast, renders with role="status"', () => {
    renderWithProvider('成功しました', 'success')
    act(() => {
      screen.getByText('Show Toast').click()
    })
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  test('Given error toast, renders with role="alert"', () => {
    renderWithProvider('エラーが発生しました', 'error')
    act(() => {
      screen.getByText('Show Toast').click()
    })
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  test('Given 3 seconds pass, toast is removed from DOM', () => {
    renderWithProvider('消えるメッセージ')
    act(() => {
      screen.getByText('Show Toast').click()
    })
    expect(screen.getByText('消えるメッセージ')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(screen.queryByText('消えるメッセージ')).not.toBeInTheDocument()
  })

  test('Toast is still visible before 3 seconds have passed', () => {
    renderWithProvider('まだ見える')
    act(() => {
      screen.getByText('Show Toast').click()
    })

    act(() => {
      vi.advanceTimersByTime(2999)
    })

    expect(screen.getByText('まだ見える')).toBeInTheDocument()
  })
})

// ==========================================================
// useToast — Provider 外で呼ぶと throw
// ==========================================================
describe('useToast outside ToastProvider', () => {
  test('throws when called outside ToastProvider', () => {
    function BadComponent() {
      useToast()
      return null
    }
    expect(() => render(<BadComponent />)).toThrow()
  })
})
