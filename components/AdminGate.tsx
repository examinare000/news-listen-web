'use client'

import React from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { adminAccess } from '@/lib/account/adminAccess'
import { LoginModal } from '@/components/ui/LoginModal'

interface AdminGateProps {
  /** `denied` 表示の見出し文言（4 ページで異なる唯一の要素） */
  title: string
  children: React.ReactNode
}

// admin 4 ページの重複 gating を集約する単一 policy（CI-T16）。`granted` 以外は
// children を mount しない（ページ内 useEffect ロードを走らせない）。useApp には
// 依存しない（metrics ページのテストは AppProvider 無しで描画するため）。
export function AdminGate({ title, children }: AdminGateProps) {
  const { status, user } = useAuth()
  const access = adminAccess({ status, user })

  if (access === 'loading') {
    return (
      <div className="content-area content-narrow">
        <p className="settings-row-desc" role="status" aria-live="polite">読み込み中…</p>
      </div>
    )
  }

  if (access === 'login_required') {
    return <LoginModal />
  }

  if (access === 'denied') {
    return (
      <div className="content-area content-narrow">
        <div className="page-header">
          <h1 className="page-title">{title}</h1>
        </div>
        <p className="form-error">この画面は管理者のみ利用できます。</p>
        <Link className="btn btn-ghost" href="/settings">
          設定へ戻る
        </Link>
      </div>
    )
  }

  return <>{children}</>
}
