import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { Episode } from '@/lib/catalog/domain/episode'

// 入力は Episode['kind']（playable / generating / failed）。partial_failed は decodeEpisode が failed に畳むので、
// バッジには「一部失敗」の表示も未知値の fallback も存在しない（web-deriv-31・shared-dec-18）。
const CASES: Array<[Episode['kind'], string, string]> = [
  ['playable', '完成', 'badge-easy'],
  ['generating', '生成中', 'badge-medium'],
  ['failed', '失敗', 'badge-hard'],
]

const TONES = ['badge-easy', 'badge-medium', 'badge-hard']

// ==========================================================
// StatusBadge — ラベル表示
// ==========================================================
describe('StatusBadge — labels', () => {
  test.each(CASES)('Given kind=%s, displays "%s"', (kind, label) => {
    render(<StatusBadge status={kind} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })
})

// ==========================================================
// StatusBadge — トーン（CSS クラス）
// ==========================================================
describe('StatusBadge — tone classes', () => {
  test.each(CASES.map(([kind, , tone]) => [kind, tone] as const))('Given kind=%s, has badge and %s class only', (kind, tone) => {
    const { container } = render(<StatusBadge status={kind} />)
    const badge = container.firstElementChild
    expect(badge?.classList.contains('badge')).toBe(true)
    expect(badge?.classList.contains(tone)).toBe(true)
    // 他のトーンは付かない（kind ごとの写像が取り違えられていないこと）
    for (const other of TONES.filter((t) => t !== tone)) {
      expect(badge?.classList.contains(other)).toBe(false)
    }
  })
})
