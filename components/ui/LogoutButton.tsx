'use client'

import React, { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'

interface LogoutButtonProps {
  className?: string
}

/**
 * ログアウトボタン（サイドバー・設定画面で共用）。
 * WHY 共通化: ボタン文言・二重押下防止ロジックを 1 箇所に集約し、
 * AccountSection と SidebarAccount で挙動が乖離しないようにする。
 */
export function LogoutButton({ className = 'btn btn-ghost' }: LogoutButtonProps) {
  const { logout } = useAuth()
  const [pending, setPending] = useState(false)

  async function handleLogout() {
    // 二重押下防止: disabled に加え、ハンドラ自身でも進行中を弾く
    if (pending) return

    setPending(true)
    try {
      await logout()
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      className={className}
      onClick={handleLogout}
      disabled={pending}
      aria-label="ログアウト"
    >
      ログアウト
    </button>
  )
}
