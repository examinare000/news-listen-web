import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { PodcastStatus } from '@/types/index'

// ==========================================================
// StatusBadge — ラベル表示
// ==========================================================
describe('StatusBadge — labels', () => {
  test('Given status=processing, displays "生成中"', () => {
    render(<StatusBadge status="processing" />)
    expect(screen.getByText('生成中')).toBeInTheDocument()
  })

  test('Given status=completed, displays "完成"', () => {
    render(<StatusBadge status="completed" />)
    expect(screen.getByText('完成')).toBeInTheDocument()
  })

  test('Given status=failed, displays "失敗"', () => {
    render(<StatusBadge status="failed" />)
    expect(screen.getByText('失敗')).toBeInTheDocument()
  })

  test('Given status=partial_failed, displays "一部失敗"', () => {
    render(<StatusBadge status="partial_failed" />)
    expect(screen.getByText('一部失敗')).toBeInTheDocument()
  })
})

// ==========================================================
// StatusBadge — トーン（CSS クラス）
// ==========================================================
describe('StatusBadge — tone classes', () => {
  test('Given status=processing, has badge and badge-medium classes', () => {
    const { container } = render(<StatusBadge status="processing" />)
    const badge = container.firstElementChild
    expect(badge?.classList.contains('badge')).toBe(true)
    expect(badge?.classList.contains('badge-medium')).toBe(true)
  })

  test('Given status=completed, has badge and badge-easy classes', () => {
    const { container } = render(<StatusBadge status="completed" />)
    const badge = container.firstElementChild
    expect(badge?.classList.contains('badge')).toBe(true)
    expect(badge?.classList.contains('badge-easy')).toBe(true)
  })

  test('Given status=failed, has badge and badge-hard classes', () => {
    const { container } = render(<StatusBadge status="failed" />)
    const badge = container.firstElementChild
    expect(badge?.classList.contains('badge')).toBe(true)
    expect(badge?.classList.contains('badge-hard')).toBe(true)
  })

  test('Given status=partial_failed, has badge and badge-hard classes', () => {
    const { container } = render(<StatusBadge status="partial_failed" />)
    const badge = container.firstElementChild
    expect(badge?.classList.contains('badge')).toBe(true)
    expect(badge?.classList.contains('badge-hard')).toBe(true)
  })
})

// ==========================================================
// StatusBadge — 未知値
// ==========================================================
describe('StatusBadge — unknown status', () => {
  test('Given unknown status, displays raw value with badge class only', () => {
    const unknownStatus = 'unknown_status' as PodcastStatus
    const { container } = render(<StatusBadge status={unknownStatus} />)
    const badge = container.firstElementChild
    expect(badge?.textContent).toBe('unknown_status')
    expect(badge?.classList.contains('badge')).toBe(true)
    // トーンクラスなし
    expect(badge?.classList.contains('badge-easy')).toBe(false)
    expect(badge?.classList.contains('badge-medium')).toBe(false)
    expect(badge?.classList.contains('badge-hard')).toBe(false)
  })
})
