import type { AuthSession } from './authSession'

// admin 4 ページで重複していた gating 判定を集約する単一 policy（web-contract-19）。
// lib → contexts への逆依存を避けるため、Provider の型を import せず domain の AuthSession を入力にする
// （Spec §2 依存方向）。
// 写し方（web-dec-66）: resolving・unavailable → loading、anonymous → login_required、
// authenticated → role が admin なら granted、それ以外は denied。

export type AdminAccess = 'loading' | 'login_required' | 'denied' | 'granted'

export type AdminAccessSession = AuthSession

export function adminAccess(session: AdminAccessSession): AdminAccess {
  switch (session.kind) {
    case 'resolving':
    case 'unavailable':
      return 'loading'
    case 'anonymous':
      return 'login_required'
    case 'authenticated':
      return session.user.role === 'admin' ? 'granted' : 'denied'
  }
}
