'use client'

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useApp } from '@/contexts/AppContext'
import { useAuth } from '@/contexts/AuthContext'
import { createApiClient } from '@/lib/api'
import { ApiError } from '@/lib/api'
import { registerPasskey } from '@/lib/passkey'
import { createRealWebAuthnBrowserPort } from '@/lib/webauthnBrowserPort'
import type { PasskeyCredential } from '@/types/index'

// 設定画面の「アカウント」セクション。プロフィール（表示名）編集・パスワード変更・
// ログアウト、および管理者にはユーザー管理画面への導線を提供する。
// Passkey（WebAuthn）の登録・一覧・削除も担う。
export function AccountSection() {
  const { state } = useApp()
  const { user, logout, refreshMe } = useAuth()
  const client = createApiClient({ baseUrl: state.baseUrl, apiKey: state.apiKey })

  const [displayName, setDisplayName] = useState(user?.display_name ?? '')
  const [profileMsg, setProfileMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [pwMsg, setPwMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  // Passkey state
  const [passkeyCredentials, setPasskeyCredentials] = useState<PasskeyCredential[]>([])
  const [passkeyMsg, setPasskeyMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [registeringPasskey, setRegisteringPasskey] = useState(false)
  const [deletingCredentialId, setDeletingCredentialId] = useState<string | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [supportsPasskey, setSupportsPasskey] = useState(true)

  const loadCredentials = useCallback(async () => {
    try {
      const res = await client.getPasskeyCredentials()
      setPasskeyCredentials(res.credentials)
    } catch {
      // ロード失敗はサイレント（初回表示なので致命的ではない）
    }
  }, [state.baseUrl, state.apiKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadCredentials()
  }, [loadCredentials])

  // WHY: WebAuthn 非対応環境では Passkey 登録ボタンを disabled にする。port 経由で判定を集約。
  useEffect(() => {
    const port = createRealWebAuthnBrowserPort()
    setSupportsPasskey(port.supportsWebAuthn())
  }, [])

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

  async function handlePasskeyRegister() {
    setRegisteringPasskey(true)
    setPasskeyMsg(null)
    try {
      await registerPasskey(client, createRealWebAuthnBrowserPort())
      setPasskeyMsg({ kind: 'ok', text: 'Passkey を登録しました' })
      await loadCredentials()
    } catch (err) {
      // WHY: NotAllowedError はユーザー自発キャンセル。それ以外も含め原因を露出しない。
      //      DOMException は環境によって instanceof Error が false になるため name で判定。
      const errName = err !== null && typeof err === 'object' && 'name' in err
        ? (err as { name: string }).name
        : ''
      const text =
        errName === 'NotAllowedError'
          ? '認証がキャンセルされました'
          : 'Passkey の登録に失敗しました'
      setPasskeyMsg({ kind: 'error', text })
    } finally {
      setRegisteringPasskey(false)
    }
  }

  function handlePasskeyDeleteClick(credentialId: string) {
    // WHY: 削除は取り消しできないため、確認 UI に遷移。window.confirm は SSR/テスト不安定なため state ベース。
    setConfirmingDeleteId(credentialId)
  }

  function handlePasskeyDeleteCancel() {
    setConfirmingDeleteId(null)
  }

  async function handlePasskeyDeleteConfirm(credentialId: string) {
    setConfirmingDeleteId(null)
    setDeletingCredentialId(credentialId)
    setPasskeyMsg(null)
    try {
      await client.deletePasskeyCredential(credentialId)
      await loadCredentials()
      setPasskeyMsg({ kind: 'ok', text: 'Passkey を削除しました' })
    } catch {
      setPasskeyMsg({ kind: 'error', text: 'Passkey の削除に失敗しました' })
    } finally {
      setDeletingCredentialId(null)
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

      {/* Passkey 管理 */}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Passkey 認証</div>
          <div className="settings-row-desc">
            生体認証やデバイス PIN を使ってパスワードなしでログインできます
          </div>
        </div>
        <button
          className="btn btn-ghost"
          onClick={handlePasskeyRegister}
          disabled={registeringPasskey || !supportsPasskey}
          aria-label={!supportsPasskey ? 'お使いのブラウザは Passkey に対応していません' : undefined}
        >
          {registeringPasskey ? '登録中…' : 'Passkey を登録'}
        </button>
      </div>

      {/* 登録済み Passkey 一覧 */}
      {passkeyCredentials.length === 0 ? (
        <div className="settings-row-desc" style={{ padding: '0 20px 12px', color: 'var(--text-muted, #888)' }}>
          登録済みの Passkey はありません
        </div>
      ) : (
        passkeyCredentials.map((cred) => (
          <div key={cred.credential_id}>
            {confirmingDeleteId === cred.credential_id ? (
              // 削除確認状態
              <div className="settings-row">
                <div>
                  <div className="settings-row-label" style={{ color: 'var(--red)' }}>
                    削除しますか？
                  </div>
                  <div className="settings-row-desc">
                    {cred.name ?? cred.credential_id.slice(0, 16)} を削除すると、この Passkey でログインできなくなります。
                  </div>
                </div>
              </div>
            ) : (
              // 通常表示
              <div className="settings-row">
                <div>
                  <div className="settings-row-label">
                    {cred.name ?? cred.credential_id.slice(0, 16)}
                  </div>
                  <div className="settings-row-desc">
                    登録日: {new Date(cred.created_at).toLocaleDateString('ja-JP')}
                    {cred.last_used_at && (
                      <>　最終使用: {new Date(cred.last_used_at).toLocaleDateString('ja-JP')}</>
                    )}
                  </div>
                </div>
                <button
                  className="btn btn-ghost"
                  onClick={() => handlePasskeyDeleteClick(cred.credential_id)}
                  disabled={deletingCredentialId !== null}
                  aria-label={`Passkey を削除: ${cred.name ?? cred.credential_id.slice(0, 16)}`}
                >
                  削除
                </button>
              </div>
            )}

            {/* 削除確認時のアクションボタン */}
            {confirmingDeleteId === cred.credential_id && (
              <div style={{ padding: '0 20px 12px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  className="btn btn-ghost"
                  onClick={handlePasskeyDeleteCancel}
                  disabled={deletingCredentialId === cred.credential_id}
                  aria-label="キャンセル"
                >
                  キャンセル
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => handlePasskeyDeleteConfirm(cred.credential_id)}
                  disabled={deletingCredentialId === cred.credential_id}
                  aria-label={`${cred.name ?? cred.credential_id.slice(0, 16)} を削除`}
                >
                  {deletingCredentialId === cred.credential_id ? '削除中…' : '削除する'}
                </button>
              </div>
            )}
          </div>
        ))
      )}

      {passkeyMsg && (
        <div
          className={passkeyMsg.kind === 'ok' ? 'form-success' : 'form-error'}
          style={{ padding: '0 20px 12px' }}
        >
          {passkeyMsg.text}
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
