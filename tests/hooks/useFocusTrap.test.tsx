import { describe, test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { renderHook, act } from '@testing-library/react'
import { useFocusTrap } from '@/hooks/useFocusTrap'

// ==========================================================
// useFocusTrap — フォーカストラップフック
// - マウント時に最初のフォーカス可能要素へフォーカス移動
// - フォーカス可能要素が無い場合、コンテナにフォーカス
// - Tab/Shift+Tab がコンテナ内で循環
// - アンマウント/isOpen=false でフォーカス復帰
// - SSR防御（document 不在で例外なし）
// ==========================================================

describe('useFocusTrap', () => {
  describe('Given mount-type modal (isOpen undefined)', () => {
    test('returns a ref object', () => {
      const { result } = renderHook(() => useFocusTrap<HTMLDivElement>())
      expect(result.current).toHaveProperty('current')
    })

    test('focuses the first focusable element on mount', () => {
      function TestComponent() {
        const ref = useFocusTrap<HTMLDivElement>()
        return (
          <div ref={ref} role="dialog">
            <button id="btn1">First</button>
            <button id="btn2">Second</button>
          </div>
        )
      }

      render(<TestComponent />)
      const firstButton = screen.getByRole('button', { name: 'First' })
      expect(firstButton).toHaveFocus()
    })

    test('focuses container when no focusable elements', () => {
      function TestComponent() {
        const ref = useFocusTrap<HTMLDivElement>()
        return (
          <div ref={ref} role="dialog" data-testid="container">
            <p>No focusable elements</p>
          </div>
        )
      }

      render(<TestComponent />)
      const container = screen.getByTestId('container')
      expect(container).toHaveFocus()
      expect(container).toHaveAttribute('tabindex', '-1')
    })

    test('prevents focus from leaving on Tab from last element', () => {
      function TestComponent() {
        const ref = useFocusTrap<HTMLDivElement>()
        return (
          <div ref={ref} role="dialog">
            <button id="btn1">First</button>
            <button id="btn2">Last</button>
          </div>
        )
      }

      render(<TestComponent />)
      const lastButton = screen.getByRole('button', { name: 'Last' })

      act(() => {
        lastButton.focus()
      })

      const container = screen.getByRole('dialog')
      act(() => {
        fireEvent.keyDown(container, { key: 'Tab' })
      })

      const firstButton = screen.getByRole('button', { name: 'First' })
      expect(firstButton).toHaveFocus()
    })

    test('wraps focus on Shift+Tab from first element', () => {
      function TestComponent() {
        const ref = useFocusTrap<HTMLDivElement>()
        return (
          <div ref={ref} role="dialog">
            <button id="btn1">First</button>
            <button id="btn2">Last</button>
          </div>
        )
      }

      render(<TestComponent />)
      const firstButton = screen.getByRole('button', { name: 'First' })

      act(() => {
        firstButton.focus()
      })

      const container = screen.getByRole('dialog')
      act(() => {
        fireEvent.keyDown(container, { key: 'Tab', shiftKey: true })
      })

      const lastButton = screen.getByRole('button', { name: 'Last' })
      expect(lastButton).toHaveFocus()
    })

    test('ignores non-Tab keys', () => {
      function TestComponent() {
        const ref = useFocusTrap<HTMLDivElement>()
        return (
          <div ref={ref} role="dialog">
            <button id="btn1">First</button>
            <button id="btn2">Second</button>
          </div>
        )
      }

      render(<TestComponent />)
      const firstButton = screen.getByRole('button', { name: 'First' })

      const container = screen.getByRole('dialog')
      act(() => {
        fireEvent.keyDown(container, { key: 'Enter' })
      })

      expect(firstButton).toHaveFocus()
    })

    test('restores focus to previously focused element on unmount', () => {
      function TestApp() {
        const [isOpen, setIsOpen] = React.useState(false)
        return (
          <div>
            <button id="trigger" onClick={() => setIsOpen(true)}>
              Open
            </button>
            {isOpen && <ModalContent onClose={() => setIsOpen(false)} />}
          </div>
        )
      }

      function ModalContent({ onClose }: { onClose: () => void }) {
        const ref = useFocusTrap<HTMLDivElement>()
        return (
          <div ref={ref} role="dialog">
            <button onClick={onClose}>Close</button>
          </div>
        )
      }

      render(<TestApp />)
      const trigger = screen.getByRole('button', { name: 'Open' })

      act(() => {
        trigger.focus()
      })

      act(() => {
        screen.getByRole('button', { name: 'Open' }).click()
      })

      act(() => {
        screen.getByRole('button', { name: 'Close' }).click()
      })

      expect(trigger).toHaveFocus()
    })

    test('does not throw when the previously focused trigger is removed from the DOM on close', () => {
      // ConfirmDialog の削除確定相当: クローズ時に起動元（trigger）自体も DOM から外れる。
      // detach 済み要素への focus() を行わず、例外も投げないこと。
      function TestApp() {
        const [open, setOpen] = React.useState(false)
        const [removed, setRemoved] = React.useState(false)
        return (
          <div>
            {!removed && (
              <button id="trigger" onClick={() => setOpen(true)}>
                Open
              </button>
            )}
            {open && (
              <ModalContent
                onConfirm={() => {
                  // 起動元の削除とモーダルのクローズを同時に行う
                  setRemoved(true)
                  setOpen(false)
                }}
              />
            )}
          </div>
        )
      }

      function ModalContent({ onConfirm }: { onConfirm: () => void }) {
        const ref = useFocusTrap<HTMLDivElement>()
        return (
          <div ref={ref} role="dialog">
            <button onClick={onConfirm}>Confirm</button>
          </div>
        )
      }

      render(<TestApp />)

      act(() => {
        screen.getByRole('button', { name: 'Open' }).focus()
      })
      act(() => {
        screen.getByRole('button', { name: 'Open' }).click()
      })

      expect(() => {
        act(() => {
          screen.getByRole('button', { name: 'Confirm' }).click()
        })
      }).not.toThrow()

      // 起動元は DOM から外れているので focus は戻らない（detach 要素に focus しない）
      expect(screen.queryByRole('button', { name: 'Open' })).toBeNull()
    })
  })

  describe('Given toggle-type modal (isOpen explicitly passed)', () => {
    test('does not focus when isOpen=false', () => {
      function TestComponent() {
        const ref = useFocusTrap<HTMLDivElement>(false)
        return (
          <div ref={ref} role="dialog" data-testid="container">
            <button>Button</button>
          </div>
        )
      }

      render(<TestComponent />)
      const button = screen.getByRole('button')
      expect(button).not.toHaveFocus()
    })

    test('focuses first element when isOpen changes from false to true', () => {
      function TestComponent({ isOpen }: { isOpen: boolean }) {
        const ref = useFocusTrap<HTMLDivElement>(isOpen)
        return (
          <div ref={ref} role="dialog">
            <button>Button</button>
          </div>
        )
      }

      const { rerender } = render(<TestComponent isOpen={false} />)

      const button = screen.getByRole('button')
      expect(button).not.toHaveFocus()

      act(() => {
        rerender(<TestComponent isOpen={true} />)
      })

      expect(button).toHaveFocus()
    })

    test('restores focus when isOpen changes from true to false', () => {
      function TestApp() {
        const [isOpen, setIsOpen] = React.useState(false)
        return (
          <div>
            <button id="trigger" onClick={() => setIsOpen(true)}>
              Open
            </button>
            <DialogWithToggle
              isOpen={isOpen}
              onClose={() => setIsOpen(false)}
            />
          </div>
        )
      }

      function DialogWithToggle({
        isOpen,
        onClose,
      }: {
        isOpen: boolean
        onClose: () => void
      }) {
        const ref = useFocusTrap<HTMLDivElement>(isOpen)
        return (
          <div ref={ref} role="dialog">
            <button onClick={onClose}>Close</button>
          </div>
        )
      }

      render(<TestApp />)
      const trigger = screen.getByRole('button', { name: 'Open' })

      act(() => {
        trigger.focus()
      })

      act(() => {
        trigger.click()
      })

      act(() => {
        screen.getByRole('button', { name: 'Close' }).click()
      })

      expect(trigger).toHaveFocus()
    })

    test('handles Tab wrapping with isOpen=true', () => {
      function TestComponent({ isOpen }: { isOpen: boolean }) {
        const ref = useFocusTrap<HTMLDivElement>(isOpen)
        return (
          isOpen && (
            <div ref={ref} role="dialog">
              <button id="btn1">First</button>
              <button id="btn2">Last</button>
            </div>
          )
        )
      }

      const { rerender } = render(<TestComponent isOpen={false} />)

      act(() => {
        rerender(<TestComponent isOpen={true} />)
      })

      const lastButton = screen.getByRole('button', { name: 'Last' })
      act(() => {
        lastButton.focus()
      })

      const dialog = screen.getByRole('dialog')
      act(() => {
        fireEvent.keyDown(dialog, { key: 'Tab' })
      })

      const firstButton = screen.getByRole('button', { name: 'First' })
      expect(firstButton).toHaveFocus()
    })
  })

  describe('Given no ref attached (SSR safety)', () => {
    test('does not throw when containerRef.current is null', () => {
      expect(() => {
        renderHook(() => useFocusTrap<HTMLDivElement>())
      }).not.toThrow()
    })
  })

  describe('Given container with no focusable elements', () => {
    test('applies tabindex="-1" to container and focuses it', () => {
      function TestComponent() {
        const ref = useFocusTrap<HTMLDivElement>()
        return (
          <div ref={ref} role="dialog" data-testid="container">
            <p>No focusable elements</p>
          </div>
        )
      }

      render(<TestComponent />)
      const container = screen.getByTestId('container')
      expect(container).toHaveAttribute('tabindex', '-1')
      expect(container).toHaveFocus()
    })

    test('handles Tab without throwing when no focusables', () => {
      function TestComponent() {
        const ref = useFocusTrap<HTMLDivElement>()
        return (
          <div ref={ref} role="dialog" data-testid="container">
            <p>No focusable elements</p>
          </div>
        )
      }

      render(<TestComponent />)
      const container = screen.getByTestId('container')

      expect(() => {
        act(() => {
          fireEvent.keyDown(container, { key: 'Tab' })
        })
      }).not.toThrow()
    })
  })

  describe('Given various focusable element combinations', () => {
    test('correctly identifies first element among mixed focusables', () => {
      function TestComponent() {
        const ref = useFocusTrap<HTMLDivElement>()
        return (
          <div ref={ref} role="dialog">
            <input id="input" placeholder="text input" />
            <button id="btn">Button</button>
            <a href="/test" id="link">
              Link
            </a>
          </div>
        )
      }

      render(<TestComponent />)
      const input = screen.getByPlaceholderText('text input')
      expect(input).toHaveFocus()
    })

    test('skips disabled elements when finding first focusable', () => {
      function TestComponent() {
        const ref = useFocusTrap<HTMLDivElement>()
        return (
          <div ref={ref} role="dialog">
            <button disabled>Disabled</button>
            <button id="enabled">Enabled</button>
          </div>
        )
      }

      render(<TestComponent />)
      const enabledButton = screen.getByRole('button', { name: 'Enabled' })
      expect(enabledButton).toHaveFocus()
    })

    test('skips hidden elements when finding first focusable', () => {
      function TestComponent() {
        const ref = useFocusTrap<HTMLDivElement>()
        return (
          <div ref={ref} role="dialog">
            <button hidden>Hidden</button>
            <button id="visible">Visible</button>
          </div>
        )
      }

      render(<TestComponent />)
      const visibleButton = screen.getByRole('button', { name: 'Visible' })
      expect(visibleButton).toHaveFocus()
    })
  })

  describe('Given Escape key (not trapped by this hook)', () => {
    test('does not prevent default on Escape', () => {
      function TestComponent() {
        const ref = useFocusTrap<HTMLDivElement>()
        return (
          <div ref={ref} role="dialog">
            <button>Button</button>
          </div>
        )
      }

      render(<TestComponent />)
      const dialog = screen.getByRole('dialog')

      const event = new KeyboardEvent('keydown', { key: 'Escape' })
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

      act(() => {
        dialog.dispatchEvent(event)
      })

      expect(preventDefaultSpy).not.toHaveBeenCalled()
    })
  })
})

// Import React for test utilities
import React from 'react'
