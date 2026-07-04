'use client'

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { createApiClient } from '@/lib/api'
import { ApiError } from '@/lib/api'
import { registerPasskey } from '@/lib/passkey'
import { createRealWebAuthnBrowserPort } from '@/lib/webauthnBrowserPort'
import { formatAuthUserLabel } from '@/lib/format'
import { LogoutButton } from '@/components/ui/LogoutButton'
import type { PasskeyCredential, Session } from '@/types/index'

// 設定画面の「アカウント」セクション。プロフィール（表示名）編集・パスワード変更・
// ログアウト、および管理者にはユーザー管理画面への導線を提供する。
// Passkey（WebAuthn）の登録・一覧・削除も担う。
export function AccountSection() {
  const { user, refreshMe, logout } = useAuth()
  const client = createApiClient()
  const router = useRouter()

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

  // ログイン中のデバイス（セッション）state — issue #84。
  const [sessions, setSessions] = useState<Session[]>([])
  const [sessionsMsg, setSessionsMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null)
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<string | null>(null)
  const [revokingOthers, setRevokingOthers] = useState(false)
  const [confirmingRevokeOthers, setConfirmingRevokeOthers] = useState(false)

  // アカウント削除（退会・issue #133）。
  const [confirmingDeleteAccount, setConfirmingDeleteAccount] = useState(false)
  const [deleteAccountPassword, setDeleteAccountPassword] = useState('')
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null)

  const loadCredentials = useCallback(async () => {
    try {
      const res = await client.getPasskeyCredentials()
      setPasskeyCredentials(res.credentials)
    } catch {
      // ロード失敗はサイレント（初回表示なので致命的ではない）
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadSessions = useCallback(async () => {
    try {
      const res = await client.getSessions()
      setSessions(res.sessions)
    } catch {
      // ロード失敗はサイレント（初回表示なので致命的ではない）
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadCredentials()
  }, [loadCredentials])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

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

  // ── デバイス/セッション失効（issue #84） ──────────────────────────────
  function handleRevokeClick(sessionId: string) {
    setConfirmingRevokeId(sessionId)
  }

  function handleRevokeCancel() {
    setConfirmingRevokeId(null)
  }

  async function handleRevokeConfirm(sessionId: string) {
    setConfirmingRevokeId(null)
    setRevokingSessionId(sessionId)
    setSessionsMsg(null)
    try {
      await client.revokeSession(sessionId)
      await loadSessions()
      setSessionsMsg({ kind: 'ok', text: 'デバイスからログアウトしました' })
    } catch {
      setSessionsMsg({ kind: 'error', text: 'ログアウトに失敗しました' })
    } finally {
      setRevokingSessionId(null)
    }
  }

  async function handleRevokeOthersConfirm() {
    setConfirmingRevokeOthers(false)
    setRevokingOthers(true)
    setSessionsMsg(null)
    try {
      const res = await client.revokeOtherSessions()
      await loadSessions()
      setSessionsMsg({ kind: 'ok', text: `他の ${res.revoked_count} 台のデバイスからログアウトしました` })
    } catch {
      setSessionsMsg({ kind: 'error', text: '一括ログアウトに失敗しました' })
    } finally {
      setRevokingOthers(false)
    }
  }

  // ── アカウント削除（退会・issue #133） ──────────────────────────────
  function handleDeleteAccountClick() {
    setConfirmingDeleteAccount(true)
    setDeleteAccountError(null)
  }

  function handleDeleteAccountCancel() {
    setConfirmingDeleteAccount(false)
    setDeleteAccountPassword('')
    setDeleteAccountError(null)
  }

  async function handleDeleteAccountConfirm() {
    setDeletingAccount(true)
    setDeleteAccountError(null)
    try {
      await client.deleteAccount(deleteAccountPassword)
      // WHY: サーバー側でセッションは既に失効済みだが、ローカルの認証状態も
      //      LogoutButton と同じ後処理（logout → ログイン画面へ replace）で揃える。
      await logout()
      router.replace('/')
    } catch (err) {
      const text =
        err instanceof ApiError && err.status === 403
          ? 'パスワードが正しくありません'
          : err instanceof ApiError && err.status === 409
            ? '最後の管理者は削除できません'
            : 'アカウントの削除に失敗しました'
      setDeleteAccountError(text)
      setDeletingAccount(false)
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
            {formatAuthUserLabel(user)}
          </div>
        </div>
        <LogoutButton />
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

      {/* ログイン中のデバイス（issue #84） */}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">ログイン中のデバイス</div>
          <div className="settings-row-desc">
            このアカウントでログイン中の端末。不審なものは個別に、または一括でログアウトできます
          </div>
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => setConfirmingRevokeOthers(true)}
          disabled={revokingOthers || sessions.filter((s) => !s.current).length === 0}
          aria-label="他のデバイスからログアウト"
        >
          {revokingOthers ? '処理中…' : '他のデバイスからログアウト'}
        </button>
      </div>

      {/* 一括ログアウトの確認（破壊的操作のため確認ステップを挟む） */}
      {confirmingRevokeOthers && (
        <div style={{ padding: '0 20px 12px' }}>
          <div className="settings-row-label" style={{ color: 'var(--red)' }}>
            現在のデバイス以外をすべてログアウトしますか？
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button
              className="btn btn-ghost"
              onClick={() => setConfirmingRevokeOthers(false)}
              disabled={revokingOthers}
              aria-label="キャンセル"
            >
              キャンセル
            </button>
            <button
              className="btn btn-primary"
              onClick={handleRevokeOthersConfirm}
              disabled={revokingOthers}
              aria-label="他のデバイスからログアウトを実行"
            >
              {revokingOthers ? '処理中…' : 'ログアウトする'}
            </button>
          </div>
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="settings-row-desc" style={{ padding: '0 20px 12px', color: 'var(--text-muted, #888)' }}>
          ログイン中のデバイスはありません
        </div>
      ) : (
        sessions.map((s) => (
          <div key={s.id}>
            {confirmingRevokeId === s.id ? (
              <div className="settings-row">
                <div>
                  <div className="settings-row-label" style={{ color: 'var(--red)' }}>
                    ログアウトしますか？
                  </div>
                  <div className="settings-row-desc">
                    {s.device_label ?? '不明なデバイス'} をログアウトすると、その端末では再ログインが必要になります。
                  </div>
                </div>
              </div>
            ) : (
              <div className="settings-row">
                <div>
                  <div className="settings-row-label">
                    {s.device_label ?? '不明なデバイス'}
                    {s.current && (
                      <span className="badge" style={{ marginLeft: 8 }}>
                        現在のデバイス
                      </span>
                    )}
                  </div>
                  <div className="settings-row-desc">
                    ログイン: {new Date(s.created_at).toLocaleDateString('ja-JP')}
                    {s.last_used_at && (
                      <>　最終利用: {new Date(s.last_used_at).toLocaleDateString('ja-JP')}</>
                    )}
                  </div>
                </div>
                {/* 現在のデバイスはこのUIから失効しない（＝ログアウト操作）。他デバイスのみ個別失効可能。 */}
                {!s.current && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => handleRevokeClick(s.id)}
                    disabled={revokingSessionId !== null}
                    aria-label={`デバイスをログアウト: ${s.device_label ?? '不明なデバイス'}`}
                  >
                    ログアウト
                  </button>
                )}
              </div>
            )}

            {confirmingRevokeId === s.id && (
              <div style={{ padding: '0 20px 12px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  className="btn btn-ghost"
                  onClick={handleRevokeCancel}
                  disabled={revokingSessionId === s.id}
                  aria-label="キャンセル"
                >
                  キャンセル
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => handleRevokeConfirm(s.id)}
                  disabled={revokingSessionId === s.id}
                  aria-label={`${s.device_label ?? '不明なデバイス'} をログアウト`}
                >
                  {revokingSessionId === s.id ? '処理中…' : 'ログアウトする'}
                </button>
              </div>
            )}
          </div>
        ))
      )}

      {sessionsMsg && (
        <div
          className={sessionsMsg.kind === 'ok' ? 'form-success' : 'form-error'}
          style={{ padding: '0 20px 12px' }}
        >
          {sessionsMsg.text}
        </div>
      )}

      {/* 管理者導線 */}
      {user?.role === 'admin' && (
        <>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">ユーザー管理</div>
              <div className="settings-row-desc">ユーザーの一覧・作成・削除（管理者のみ）</div>
            </div>
            <Link className="btn btn-ghost" href="/admin/users" aria-label="ユーザー管理を開く">
              開く
            </Link>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-row-label">おすすめサイト管理</div>
              <div className="settings-row-desc">おすすめサイトの追加・編集・削除（管理者のみ）</div>
            </div>
            <Link className="btn btn-ghost" href="/admin/featured-sites" aria-label="おすすめサイト管理を開く">
              開く
            </Link>
          </div>
        </>
      )}

      {/* アカウント削除（退会・issue #133） — 破壊的操作のため一番下に隔離し、確認ステップを挟む */}
      <div className="settings-row">
        <div>
          <div className="settings-row-label" style={{ color: 'var(--red)' }}>
            アカウント削除（退会）
          </div>
          <div className="settings-row-desc">
            アカウントを削除すると元に戻せません
          </div>
        </div>
        <button
          className="btn btn-ghost"
          onClick={handleDeleteAccountClick}
          disabled={deletingAccount}
          aria-label="退会する"
        >
          退会する
        </button>
      </div>

      {confirmingDeleteAccount && (
        <div style={{ padding: '0 20px 16px' }}>
          <div className="form-error" style={{ marginBottom: 8 }}>
            アカウントとあなたの個人データ（設定・Star/既読履歴・端末登録・セッションなど）は削除され、復元できません。続行するには現在のパスワードを入力してください。
          </div>
          <input
            id="account-delete-password"
            className="form-input"
            type="password"
            autoComplete="current-password"
            placeholder="現在のパスワード"
            value={deleteAccountPassword}
            onChange={(e) => setDeleteAccountPassword(e.target.value)}
            aria-label="退会確認用の現在のパスワード"
            style={{ marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              className="btn btn-ghost"
              onClick={handleDeleteAccountCancel}
              disabled={deletingAccount}
              aria-label="キャンセル"
            >
              キャンセル
            </button>
            <button
              className="btn btn-primary"
              onClick={handleDeleteAccountConfirm}
              disabled={deletingAccount || deleteAccountPassword.length === 0}
              aria-label="退会を実行する"
            >
              {deletingAccount ? '削除中…' : '退会を実行する'}
            </button>
          </div>
        </div>
      )}

      {deleteAccountError && (
        <div className="form-error" style={{ padding: '0 20px 12px' }}>
          {deleteAccountError}
        </div>
      )}
    </section>
  )
}
