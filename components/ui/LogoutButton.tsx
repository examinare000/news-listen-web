'use client'

import React, { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'

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
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function handleLogout() {
    // 二重押下防止: disabled に加え、ハンドラ自身でも進行中を弾く
    if (pending) return

    setPending(true)
    try {
      await logout()
      // ログアウト完了後、ログインページへ遷移する。
      // WHY replace: ログアウト後の戻るボタンで保護ページへ戻られないようにする（堅牢性）。
      router.replace('/')
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
