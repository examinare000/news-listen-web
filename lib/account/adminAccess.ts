import type { UserRole } from '@/types/index'

// admin 4 ページで重複していた gating 判定を集約する単一 policy（CI-T16）。
// lib → contexts への逆依存を避けるため、AuthContext の型を import せず構造的に定義する
// （Spec §2 依存方向。useAuth() の戻り値はこの型に構造的に代入可能）。

export type AdminAccess = 'loading' | 'login_required' | 'denied' | 'granted'

export interface AdminAccessSession {
  status: 'unknown' | 'authenticated' | 'unauthenticated'
  user: { role: UserRole } | null
}

export function adminAccess(session: AdminAccessSession): AdminAccess {
  if (session.status === 'unknown') return 'loading'
  if (session.status === 'unauthenticated') return 'login_required'
  return session.user?.role === 'admin' ? 'granted' : 'denied'
}
