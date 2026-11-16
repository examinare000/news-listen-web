import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { ResumeChoiceDialog } from '@/components/ui/ResumeChoiceDialog'

function setup(overrides: Partial<React.ComponentProps<typeof ResumeChoiceDialog>> = {}) {
  const callbacks = { onChooseRemote: vi.fn(), onChooseLocal: vi.fn(), onClose: vi.fn() }
  render(<ResumeChoiceDialog isOpen remoteSeconds={65} localSeconds={760} {...callbacks} {...overrides} />)
  return callbacks
}

function expectOnly(callbacks: ReturnType<typeof setup>, called: keyof ReturnType<typeof setup>) {
  for (const name of ['onChooseRemote', 'onChooseLocal', 'onClose'] as const) {
    if (name === called) expect(callbacks[name]).toHaveBeenCalledTimes(1)
    else expect(callbacks[name]).not.toHaveBeenCalled()
  }
}

describe('ResumeChoiceDialog', () => {
  test('shared-sync-12 / ADR-109 決定 11: 2 つの選択肢が ADR の文言と順で出て、閉じるは onClose だけを呼ぶ', async () => {
    const callbacks = setup()

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('heading', { name: 'どちらの位置から続けますか' })).toBeInTheDocument()
    expect(dialog).toHaveAccessibleName('どちらの位置から続けますか')
    expect(screen.getByText('別の端末: 1:05 ／ この端末: 12:40')).toBeInTheDocument()

    const buttons = screen.getAllByRole('button')
    expect(buttons[0]).toHaveTextContent('別の端末の位置から')
    expect(buttons[1]).toHaveTextContent('この端末の位置から')
    expect(buttons).toHaveLength(3)

    await userEvent.click(buttons[0])
    expectOnly(callbacks, 'onChooseRemote')
  })

  test('shared-sync-12 / ADR-109 決定 11: 「この端末の位置から」は onChooseLocal だけを呼ぶ', async () => {
    const callbacks = setup()

    await userEvent.click(screen.getByRole('button', { name: 'この端末の位置から' }))

    expectOnly(callbacks, 'onChooseLocal')
  })

  test('shared-sync-12 / ADR-109 決定 11: 閉じるボタンは onClose だけを呼ぶ', async () => {
    const callbacks = setup()
    const buttons = screen.getAllByRole('button')

    await userEvent.click(buttons[buttons.length - 1])

    expectOnly(callbacks, 'onClose')
  })

  test('shared-sync-12 / ADR-109 決定 11: Esc は onClose だけを呼ぶ', async () => {
    const callbacks = setup()

    await userEvent.keyboard('{Escape}')

    expectOnly(callbacks, 'onClose')
  })

  test('isOpen が偽なら何も描画しない', () => {
    setup({ isOpen: false })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
