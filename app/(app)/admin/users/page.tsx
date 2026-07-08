'use client'

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { createApiClient } from '@/lib/api'
import type { AuthUser, UserRole } from '@/types/index'

// 管理者用ユーザー管理画面。一覧・作成・ロール変更・削除を行う。
// admin ロール以外には操作 UI を出さない（バックエンドでも require_admin で 403）。
export default function AdminUsersPage() {
  const { user, status } = useAuth()
  const client = createApiClient()

  const [users, setUsers] = useState<AuthUser[]>([])
  const [loadError, setLoadError] = useState('')

  // 作成フォーム
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newDisplayName, setNewDisplayName] = useState('')
  const [newRole, setNewRole] = useState<UserRole>('user')
  const [formError, setFormError] = useState('')

  const isAdmin = user?.role === 'admin'

  const reload = useCallback(async () => {
    setLoadError('')
    try {
      const res = await client.listUsers()
      setUsers(res.users)
    } catch {
      setLoadError('ユーザー一覧の取得に失敗しました')
    }
  }, [])

  useEffect(() => {
    if (status === 'authenticated' && isAdmin) {
      reload()
    }
  }, [status, isAdmin, reload])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    if (!newUsername || newPassword.length < 8) {
      setFormError('ユーザーIDと8文字以上のパスワードを入力してください')
      return
    }
    try {
      await client.createUser({
        username: newUsername,
        password: newPassword,
        display_name: newDisplayName || undefined,
        role: newRole,
      })
      setNewUsername('')
      setNewPassword('')
      setNewDisplayName('')
      setNewRole('user')
      await reload()
    } catch {
      setFormError('ユーザー作成に失敗しました（既に存在する可能性があります）')
    }
  }

  async function handleDelete(username: string) {
    try {
      await client.deleteUser(username)
      await reload()
    } catch {
      setLoadError(`${username} の削除に失敗しました`)
    }
  }

  async function handleToggleRole(target: AuthUser) {
    const nextRole: UserRole = target.role === 'admin' ? 'user' : 'admin'
    try {
      await client.updateUser(target.username, { role: nextRole })
      await reload()
    } catch {
      setLoadError(`${target.username} のロール変更に失敗しました`)
    }
  }

  if (status === 'authenticated' && !isAdmin) {
    return (
      <div className="content-area content-narrow">
        <div className="page-header">
          <h1 className="page-title">ユーザー管理</h1>
        </div>
        <p className="form-error">この画面は管理者のみ利用できます。</p>
        <Link className="btn btn-ghost" href="/settings">
          設定へ戻る
        </Link>
      </div>
    )
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">ユーザー管理</h1>
          <div className="page-subtitle">ユーザーの一覧・作成・削除（管理者のみ）</div>
        </div>
      </div>

      <div className="content-area content-narrow">
        {/* 作成フォーム */}
        <section className="settings-section">
          <div className="settings-section-header">
            <h2 className="settings-section-title">ユーザーを追加</h2>
          </div>
          <form onSubmit={handleCreate} style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              className="form-input"
              type="text"
              placeholder="ユーザーID"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              aria-label="新規ユーザーID"
            />
            <input
              className="form-input"
              type="password"
              placeholder="パスワード（8文字以上）"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              aria-label="新規パスワード"
            />
            <input
              className="form-input"
              type="text"
              placeholder="表示名（任意）"
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
              aria-label="新規表示名"
            />
            <select
              className="select-input"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as UserRole)}
              aria-label="新規ロール"
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
            {formError && <p className="form-error">{formError}</p>}
            <button className="btn btn-primary" type="submit" style={{ alignSelf: 'flex-end' }}>
              追加
            </button>
          </form>
        </section>

        {/* 一覧 */}
        <section className="settings-section">
          <div className="settings-section-header">
            <h2 className="settings-section-title">ユーザー一覧</h2>
          </div>
          {loadError && <p className="form-error" style={{ padding: '0 20px' }}>{loadError}</p>}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {users.map((u) => (
              <li key={u.username} className="settings-row">
                <div>
                  <div className="settings-row-label">
                    {u.display_name}（{u.username}）
                  </div>
                  <div className="settings-row-desc">ロール: {u.role}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {/* 自分自身のロール変更・削除はさせない（自己ロックアウト防止。サーバー側でも
                      最後の admin は 409 で保護される） */}
                  {u.username !== user?.username && (
                    <>
                      <button className="btn btn-ghost" onClick={() => handleToggleRole(u)} aria-label={`${u.username} のロールを変更`}>
                        {u.role === 'admin' ? 'user へ' : 'admin へ'}
                      </button>
                      <button className="btn btn-ghost" onClick={() => handleDelete(u.username)} aria-label={`${u.username} を削除`}>
                        削除
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <Link className="btn btn-ghost" href="/settings">
          設定へ戻る
        </Link>
      </div>
    </>
  )
}
