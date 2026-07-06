import { describe, test, expect } from 'vitest'
import { DEFAULT_DIFFICULTY } from '@/types/index'

// issue #163: デフォルト難易度の正本を types/index.ts に一元化する。
// 設定画面の初期値/フォールバックと、記事単位star時のフォールバック根拠に使う定数。
describe('DEFAULT_DIFFICULTY', () => {
  test('toeic_600 である（統一デフォルト難易度・docs/design/shared-playback-spec.md 準拠）', () => {
    expect(DEFAULT_DIFFICULTY).toBe('toeic_600')
  })
})
