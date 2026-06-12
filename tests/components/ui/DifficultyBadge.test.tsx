import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DifficultyBadge } from '@/components/ui/DifficultyBadge'

// ==========================================================
// DifficultyBadge
// - 6 難易度すべてに表示ラベルと色
// - 未知の文字列でも例外を出さず生値を表示（境界値）
// ==========================================================
describe('DifficultyBadge', () => {
  const knownDifficulties = [
    { value: 'toeic_600', expectedLabel: 'TOEIC 600' },
    { value: 'toeic_900', expectedLabel: 'TOEIC 900' },
    { value: 'ielts_55', expectedLabel: 'IELTS 5.5' },
    { value: 'ielts_7', expectedLabel: 'IELTS 7.0' },
    { value: 'eiken_2', expectedLabel: '英検2級' },
    { value: 'eiken_p1', expectedLabel: '英検準1級' },
  ]

  knownDifficulties.forEach(({ value, expectedLabel }) => {
    test(`Given difficulty="${value}", displays label "${expectedLabel}"`, () => {
      render(<DifficultyBadge difficulty={value as never} />)
      expect(screen.getByText(expectedLabel)).toBeInTheDocument()
    })
  })

  test('Does not throw for unknown difficulty string', () => {
    expect(() => render(<DifficultyBadge difficulty={'unknown_level' as never} />)).not.toThrow()
  })

  test('Displays raw value for unknown difficulty (does not crash or show empty)', () => {
    render(<DifficultyBadge difficulty={'future_level' as never} />)
    expect(screen.getByText('future_level')).toBeInTheDocument()
  })

  test('Each difficulty renders a visible element', () => {
    knownDifficulties.forEach(({ value }) => {
      const { unmount } = render(<DifficultyBadge difficulty={value as never} />)
      // テキストが何か表示されている
      expect(screen.queryByText(/./)).toBeTruthy()
      unmount()
    })
  })
})

// ==========================================================
// DifficultyBadge — デザイントーンクラス（badge-easy / medium / hard）
// 6 難易度をデザインの 3 色に割当（03-ui-parts.md §4）
// ==========================================================
describe('DifficultyBadge tone classes', () => {
  const toneCases = [
    { value: 'toeic_600', tone: 'badge-easy' },
    { value: 'eiken_2', tone: 'badge-easy' },
    { value: 'toeic_900', tone: 'badge-medium' },
    { value: 'ielts_55', tone: 'badge-medium' },
    { value: 'ielts_7', tone: 'badge-hard' },
    { value: 'eiken_p1', tone: 'badge-hard' },
  ]

  toneCases.forEach(({ value, tone }) => {
    test(`Given difficulty="${value}", badge has tone class "${tone}"`, () => {
      const { container } = render(<DifficultyBadge difficulty={value as never} />)
      const badge = container.querySelector('.badge')
      expect(badge).not.toBeNull()
      expect(badge!.classList.contains(tone)).toBe(true)
    })
  })

  test('Given unknown difficulty, badge has no tone class and shows raw value', () => {
    const { container } = render(<DifficultyBadge difficulty={'future_level' as never} />)
    const badge = container.querySelector('.badge')
    expect(badge).not.toBeNull()
    expect(badge!.classList.contains('badge-easy')).toBe(false)
    expect(badge!.classList.contains('badge-medium')).toBe(false)
    expect(badge!.classList.contains('badge-hard')).toBe(false)
    expect(badge!.textContent).toBe('future_level')
  })
})
