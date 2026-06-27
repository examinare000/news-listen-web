'use client'

import React, { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { ApiError } from '@/lib/api'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { createRealWebAuthnBrowserPort } from '@/lib/webauthnBrowserPort'

// 接続設定（SetupModal）の後、未ログイン時に表示するログイン画面。
// 認証はサーバーサイドセッション（httpOnly Cookie）。成功すると AuthContext が
// 'authenticated' になり、上位のゲート（app/page.tsx）がフィードへ進める。
export function LoginModal() {
  const { login, loginWithPasskey } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submittingPasskey, setSubmittingPasskey] = useState(false)
  const [supportsPasskey, setSupportsPasskey] = useState(true)
  const dialogRef = useFocusTrap<HTMLDivElement>()

  // WHY: WebAuthn 非対応環境（古いブラウザ等）では Passkey ボタンを disabled にし、
  //      ユーザーが試行できない状態にする。port 経由で判定を集約。
  useEffect(() => {
    const port = createRealWebAuthnBrowserPort()
    setSupportsPasskey(port.supportsWebAuthn())
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!username || !password) {
      setError('ユーザーIDとパスワードを入力してください')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await login(username, password)
    } catch (err) {
      // ユーザー存在の有無を露出しない汎用文言。
      const detail =
        err instanceof ApiError && err.status === 401
          ? 'ユーザーIDまたはパスワードが正しくありません'
          : 'ログインに失敗しました。接続設定を確認してください'
      setError(detail)
      setSubmitting(false)
    }
  }

  async function handlePasskeyLogin() {
    setSubmittingPasskey(true)
    setError('')
    try {
      await loginWithPasskey(createRealWebAuthnBrowserPort())
    } catch (err) {
      // WHY: NotAllowedError はユーザーが自発的にキャンセルした場合。
      //      DOMException は環境によって instanceof Error が false になることがあるため
      //      name プロパティのみで判定する。
      //      それ以外の失敗も含め、ユーザー存在やクレデンシャル情報を漏洩しない汎用表現を使う。
      const errName = err !== null && typeof err === 'object' && 'name' in err
        ? (err as { name: string }).name
        : ''
      const detail =
        errName === 'NotAllowedError'
          ? '認証がキャンセルされました'
          : 'Passkey ログインに失敗しました'
      setError(detail)
      setSubmittingPasskey(false)
    }
  }

  const isDisabled = submitting || submittingPasskey

  return (
    <div className="modal-backdrop">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="login-modal-title" className="modal-box">
        <div className="modal-logo">
          <div className="logo-icon">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
          <span className="logo-text">
            Audio<span>News</span>
          </span>
        </div>

        <h2 id="login-modal-title" className="modal-title">
          ログイン
        </h2>
        <p className="modal-desc">登録済みのユーザーIDとパスワードでログインしてください。</p>

        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-label" htmlFor="login-username">
              ユーザーID
            </label>
            <input
              className="form-input"
              id="login-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="login-password">
              パスワード
            </label>
            <input
              className="form-input"
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div className="modal-actions">
            <button className="btn btn-primary" type="submit" disabled={isDisabled}>
              {submitting ? 'ログイン中…' : 'ログイン'}
            </button>
          </div>
        </form>

        <div className="modal-divider" aria-hidden="true">または</div>

        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handlePasskeyLogin}
            disabled={isDisabled || !supportsPasskey}
            aria-label={!supportsPasskey ? 'お使いのブラウザは Passkey に対応していません' : undefined}
          >
            {submittingPasskey ? '認証中…' : 'Passkey でログイン'}
          </button>
        </div>

        {error && <p role="status" className="form-error">{error}</p>}
      </div>
    </div>
  )
}
