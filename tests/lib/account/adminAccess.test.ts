import { describe, test, expect } from 'vitest'
import { adminAccess, type AdminAccessSession } from '@/lib/account/domain/adminAccess'

// web-contract-19: admin 4 ページの重複 gating を集約する単一 policy。純関数（副作用なし・全入力に
// 対して total）。入力は AuthSession（判別共用体）。session はリテラルで組み、@/contexts/AuthProvider を
// import しない（Spec §2 依存方向）。写し方は web-dec-66。

const resolving: AdminAccessSession = { kind: 'resolving' }
const anonymous: AdminAccessSession = { kind: 'anonymous' }
const unavailable: AdminAccessSession = { kind: 'unavailable', failure: { reason: 'network' } }

function authenticated(role: 'admin' | 'user'): AdminAccessSession {
  return { kind: 'authenticated', user: { username: 'u', role, display_name: 'U', userId: 'u-1' } }
}

describe('adminAccess (verifies: web-contract-19)', () => {
  test('resolving → loading (verifies: web-contract-19-1)', () => {
    expect(adminAccess(resolving)).toBe('loading')
  })

  test('unavailable → loading（接続失敗でも admin 画面を拒否扱いにしない。web-dec-66）(verifies: web-contract-19-1)', () => {
    expect(adminAccess(unavailable)).toBe('loading')
    expect(adminAccess({ kind: 'unavailable', failure: { reason: 'server' } })).toBe('loading')
  })

  test('anonymous → login_required (verifies: web-contract-19-1)', () => {
    expect(adminAccess(anonymous)).toBe('login_required')
  })

  test('authenticated かつ role が user → denied (verifies: web-contract-19-1)', () => {
    expect(adminAccess(authenticated('user'))).toBe('denied')
  })

  test('authenticated かつ role が admin → granted (verifies: web-contract-19-1)', () => {
    expect(adminAccess(authenticated('admin'))).toBe('granted')
  })

  test('is a pure function: identical input yields identical output across repeated calls (verifies: web-contract-19-2)', () => {
    const input = authenticated('admin')
    expect(adminAccess(input)).toBe(adminAccess(input))
  })
})
