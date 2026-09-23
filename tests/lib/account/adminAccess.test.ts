import { describe, test, expect } from 'vitest'
import { adminAccess, type AdminAccessSession } from '@/lib/account/adminAccess'

// CI-T16: admin 4 ページの重複 gating を集約する単一 policy。純関数（副作用なし・全入力に
// 対して total）。入力型は構造的に定義し、@/contexts/AuthContext を import しない
// （Spec §2 依存方向。useAuth() の値はこの型に構造的に代入可能）。

function session(
  status: AdminAccessSession['status'],
  user: AdminAccessSession['user']
): AdminAccessSession {
  return { status, user }
}

describe('adminAccess (verifies: CI-T16)', () => {
  describe('status: unknown → loading (verifies: CI-T16-1)', () => {
    test('user is null', () => {
      expect(adminAccess(session('unknown', null))).toBe('loading')
    })
    test('user is a non-admin user', () => {
      expect(adminAccess(session('unknown', { role: 'user' }))).toBe('loading')
    })
    test('user is an admin', () => {
      expect(adminAccess(session('unknown', { role: 'admin' }))).toBe('loading')
    })
  })

  describe('status: unauthenticated → login_required (verifies: CI-T16-1)', () => {
    test('user is null', () => {
      expect(adminAccess(session('unauthenticated', null))).toBe('login_required')
    })
    test('user is an admin (stale value; status governs)', () => {
      expect(adminAccess(session('unauthenticated', { role: 'admin' }))).toBe('login_required')
    })
  })

  describe('status: authenticated, non-admin → denied (verifies: CI-T16-1)', () => {
    test('user is null', () => {
      expect(adminAccess(session('authenticated', null))).toBe('denied')
    })
    test('user role is user', () => {
      expect(adminAccess(session('authenticated', { role: 'user' }))).toBe('denied')
    })
  })

  describe('status: authenticated, admin → granted (verifies: CI-T16-1)', () => {
    test('user role is admin', () => {
      expect(adminAccess(session('authenticated', { role: 'admin' }))).toBe('granted')
    })
  })

  test('is a pure function: identical input yields identical output across repeated calls (verifies: CI-T16-2)', () => {
    const input = session('authenticated', { role: 'admin' })
    expect(adminAccess(input)).toBe(adminAccess(input))
  })
})
