// 自分自身の行へのロール変更・削除を許さない guard（web-rule-admin-01）。正本は backend（product-feat-35）で、web は UI の guard。
// 判定は username の完全一致だけで、role は見ない。
//
// RED 理由（実装前）: `@/lib/admin/domain/userGuard` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { canChangeRole, canDelete } from '@/lib/admin/domain/userGuard'

const guards = [
  ['canChangeRole', canChangeRole],
  ['canDelete', canDelete],
] as const

describe('web-rule-admin-01 userGuard', () => {
  test.each(guards)('web-rule-admin-01 — %s: 自分自身の行（username が同じ）は false', (_name, guard) => {
    expect(guard({ username: 'alice' }, { username: 'alice' })).toBe(false)
  })

  test.each(guards)('web-rule-admin-01 — %s: 別の username の行は true', (_name, guard) => {
    expect(guard({ username: 'alice' }, { username: 'bob' })).toBe(true)
  })

  test.each(guards)('web-rule-admin-01 — %s: actor が null（未ログイン）なら true', (_name, guard) => {
    expect(guard(null, { username: 'alice' })).toBe(true)
  })

  test.each(guards)('web-rule-admin-01 — %s: 大文字小文字は区別する（完全一致。Alice と alice は別人）', (_name, guard) => {
    expect(guard({ username: 'Alice' }, { username: 'alice' })).toBe(true)
    expect(guard({ username: 'alice' }, { username: 'Alice' })).toBe(true)
  })
})
