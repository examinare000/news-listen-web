'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useApp } from '@/contexts/AppContext'
import { useAuth } from '@/contexts/AuthContext'
import { createApiClient } from '@/lib/api'
import { ApiError } from '@/lib/api'

// 設定画面の「アカウント」セクション。プロフィール（表示名）編集・パスワード変更・
// ログアウト、および管理者にはユーザー管理画面への導線を提供する。
export function AccountSection() {
  const { state } = useApp()
  const { user, logout, refreshMe } = useAuth()
  const client = createApiClient({ baseUrl: state.baseUrl, apiKey: state.apiKey })

  const [displayName, setDisplayName] = useState(user?.display_name ?? '')
  const [profileMsg, setProfileMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [pwMsg, setPwMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  async function handleProfileSave() {
    setProfileMsg(null)
    try {
      await client.updateProfile(displayName)
      await refreshMe()
      setProfileMsg({ kind: 'ok', text: '表示名を更新しました' })
    } catch {
      setProfileMsg({ kind: 'error', text: '表示名の更新に失敗しました' })
    }
  }

  async function handlePasswordChange() {
    setPwMsg(null)
    if (newPassword.length < 8) {
      setPwMsg({ kind: 'error', text: '新しいパスワードは8文字以上にしてください' })
      return
    }
    try {
      await client.changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setPwMsg({ kind: 'ok', text: 'パスワードを変更しました' })
    } catch (err) {
      const text =
        err instanceof ApiError && err.status === 400
          ? '現在のパスワードが正しくありません'
          : 'パスワード変更に失敗しました'
      setPwMsg({ kind: 'error', text })
    }
  }

  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <div className="settings-section-icon" style={{ background: 'var(--teal-glow)' }} aria-hidden="true">
          👤
        </div>
        <h2 className="settings-section-title">アカウント</h2>
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row-label">ログイン中</div>
          <div className="settings-row-desc">
            {user ? `${user.display_name}（${user.username} / ${user.role}）` : '—'}
          </div>
        </div>
        <button className="btn btn-ghost" onClick={logout} aria-label="ログアウト">
          ログアウト
        </button>
      </div>

      {/* 表示名 */}
      <div className="settings-row">
        <div>
          <label className="settings-row-label" htmlFor="account-display-name">
            表示名
          </label>
          <div className="settings-row-desc">アプリ内で表示される名前</div>
        </div>
      </div>
      <div style={{ padding: '0 20px 16px', display: 'flex', gap: 8 }}>
        <input
          id="account-display-name"
          className="form-input"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          aria-label="表示名"
        />
        <button className="btn btn-ghost" style={{ flexShrink: 0 }} onClick={handleProfileSave} aria-label="表示名を更新">
          更新
        </button>
      </div>
      {profileMsg && (
        <div className={profileMsg.kind === 'ok' ? 'form-success' : 'form-error'} style={{ padding: '0 20px 12px' }}>
          {profileMsg.text}
        </div>
      )}

      {/* パスワード変更 */}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">パスワード変更</div>
          <div className="settings-row-desc">現在のパスワードと新しいパスワード（8文字以上）を入力</div>
        </div>
      </div>
      <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          id="account-current-password"
          className="form-input"
          type="password"
          autoComplete="current-password"
          placeholder="現在のパスワード"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          aria-label="現在のパスワード"
        />
        <input
          id="account-new-password"
          className="form-input"
          type="password"
          autoComplete="new-password"
          placeholder="新しいパスワード"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          aria-label="新しいパスワード"
        />
        <button className="btn btn-primary" style={{ alignSelf: 'flex-end' }} onClick={handlePasswordChange} aria-label="パスワードを変更">
          パスワードを変更
        </button>
      </div>
      {pwMsg && (
        <div className={pwMsg.kind === 'ok' ? 'form-success' : 'form-error'} style={{ padding: '0 20px 12px' }}>
          {pwMsg.text}
        </div>
      )}

      {/* 管理者導線 */}
      {user?.role === 'admin' && (
        <div className="settings-row">
          <div>
            <div className="settings-row-label">ユーザー管理</div>
            <div className="settings-row-desc">ユーザーの一覧・作成・削除（管理者のみ）</div>
          </div>
          <Link className="btn btn-ghost" href="/admin/users" aria-label="ユーザー管理を開く">
            開く
          </Link>
        </div>
      )}
    </section>
  )
}
