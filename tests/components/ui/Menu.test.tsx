import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { Menu } from '@/components/ui/Menu'

function renderMenu(overrides: Partial<React.ComponentProps<typeof Menu>> = {}) {
  const onSelectA = vi.fn()
  const onSelectB = vi.fn()
  const props: React.ComponentProps<typeof Menu> = {
    triggerLabel: 'メニューを開く',
    triggerContent: <span>▾</span>,
    items: [
      { key: 'a', label: '項目A', onSelect: onSelectA },
      { key: 'b', label: '項目B', onSelect: onSelectB },
    ],
    ...overrides,
  }
  return { ...render(<Menu {...props} />), onSelectA, onSelectB }
}

describe('Menu — trigger', () => {
  test('renders a trigger button with the given aria-label, collapsed by default', () => {
    renderMenu()
    const trigger = screen.getByRole('button', { name: 'メニューを開く' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  test('Given disabled=true, trigger is disabled and cannot be opened', async () => {
    renderMenu({ disabled: true })
    const trigger = screen.getByRole('button', { name: 'メニューを開く' })
    expect(trigger).toBeDisabled()

    await userEvent.click(trigger)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('Menu — open/close', () => {
  test('Given trigger clicked, opens a role="menu" with menuitem entries', async () => {
    renderMenu()
    await userEvent.click(screen.getByRole('button', { name: 'メニューを開く' }))

    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '項目A' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '項目B' })).toBeInTheDocument()
  })

  test('Given trigger clicked twice, closes the menu (toggle)', async () => {
    renderMenu()
    const trigger = screen.getByRole('button', { name: 'メニューを開く' })
    await userEvent.click(trigger)
    await userEvent.click(trigger)

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  test('Given Escape pressed while open, closes and returns focus to trigger', async () => {
    renderMenu()
    const trigger = screen.getByRole('button', { name: 'メニューを開く' })
    await userEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  test('Given a click outside the menu, closes it', async () => {
    render(
      <div>
        <Menu
          triggerLabel="メニューを開く"
          triggerContent={<span>▾</span>}
          items={[{ key: 'a', label: '項目A', onSelect: vi.fn() }]}
        />
        <button type="button">外側</button>
      </div>
    )
    await userEvent.click(screen.getByRole('button', { name: 'メニューを開く' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '外側' }))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('Menu — item selection', () => {
  test('Given a menu item clicked, calls its onSelect and closes the menu', async () => {
    const { onSelectA, onSelectB } = renderMenu()
    await userEvent.click(screen.getByRole('button', { name: 'メニューを開く' }))
    await userEvent.click(screen.getByRole('menuitem', { name: '項目A' }))

    expect(onSelectA).toHaveBeenCalledTimes(1)
    expect(onSelectB).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('Menu — keyboard navigation', () => {
  test('Given menu opened, focus moves to the first item', async () => {
    renderMenu()
    await userEvent.click(screen.getByRole('button', { name: 'メニューを開く' }))

    expect(screen.getByRole('menuitem', { name: '項目A' })).toHaveFocus()
  })

  test('Given ArrowDown on an item, focus moves to the next item', async () => {
    renderMenu()
    await userEvent.click(screen.getByRole('button', { name: 'メニューを開く' }))

    await userEvent.keyboard('{ArrowDown}')

    expect(screen.getByRole('menuitem', { name: '項目B' })).toHaveFocus()
  })

  test('Given ArrowUp on the first item, wraps focus to the last item', async () => {
    renderMenu()
    await userEvent.click(screen.getByRole('button', { name: 'メニューを開く' }))

    await userEvent.keyboard('{ArrowUp}')

    expect(screen.getByRole('menuitem', { name: '項目B' })).toHaveFocus()
  })
})
