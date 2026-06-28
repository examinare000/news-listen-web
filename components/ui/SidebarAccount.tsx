'use client'

import React from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { formatAuthUserLabel } from '@/lib/format'
import { LogoutButton } from '@/components/ui/LogoutButton'

/**
 * サイドバー下部に常設するアカウントステータス・ログアウトパーツ。
 * 認証済み状態のときのみ表示。未認証・ローディング中は何も描画しない。
 */
export function SidebarAccount() {
  const { status, user } = useAuth()

  // 認証済み以外は何も描画しない
  if (status !== 'authenticated' || !user) {
    return null
  }

  return (
    <div className="sidebar-account">
      <div className="sidebar-account-label">
        {formatAuthUserLabel(user)}
      </div>
      <LogoutButton />
    </div>
  )
}
