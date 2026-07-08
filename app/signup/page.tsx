'use client'

import React, { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { ApiError } from '@/lib/api'

// WHY: backend の shared/username_policy 相当（招待コード新規登録）。normalize（trim+lowercase）
// してから検証する — サーバー側の正規化と一致させ、表示前チェックと 409/422 の整合を取る。
const USERNAME_REGEX = /^[a-z0-9][a-z0-9_-]{2,31}$/

// WHY: backend の shared/password_policy.py と同一規則（components/ui/AccountSection.tsx の
// バリデーションと同じ意図）。招待制登録フォーム側でも送信前に同じ基準で弾く。
const PASSWORD_MIN_LENGTH = 12

function countPasswordCharacterClasses(password: string): number {
  return [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9\s]/.test(password),
  ].filter(Boolean).length
}

function validateUsername(raw: string): string | null {
  const normalized = raw.trim().toLowerCase()
  if (!USERNAME_REGEX.test(normalized)) {
    return 'ユーザーIDは半角英数字・ハイフン・アンダースコアのみ使用可能で、3〜32文字（先頭は英数字）で入力してください'
  }
  return null
}

function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return 'パスワードは12文字以上にしてください'
  }
  if (countPasswordCharacterClasses(password) < 3) {
    return '小文字・大文字・数字・記号のうち3種類以上を含めてください'
  }
  return null
}

function mapRegisterError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 400:
        return '招待コードが無効または期限切れです'
      case 409:
        return 'このユーザーIDは使用できません'
      case 403:
        return '現在、新規登録は受け付けていません'
      case 429:
        return '試行回数が上限に達しました。しばらくしてからお試しください'
      case 422:
        return err.detail || '入力内容をご確認ください'
      default:
        return '登録に失敗しました'
    }
  }
  return '登録に失敗しました'
}

function SignupForm() {
  const { register, status } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [inviteCode, setInviteCode] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [fieldError, setFieldError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // WHY: register() 成功時にも status が 'authenticated' へ変わり、下の「既にログイン済み」
  // 効果と競合するレースがあった（実ブラウザで発現・単体テストでは再現しなかった）。
  // register 経由の遷移は handleSubmit 内で明示的に '/'（root gate 経由）へ replace するため、
  // このフラグでその瞬間だけ下の効果の自動 /feed 遷移を抑止する。
  const justRegisteredRef = useRef(false)

  // ?invite= クエリパラメータで招待コードを事前入力する（招待リンク経由の遷移）。
  useEffect(() => {
    const invite = searchParams.get('invite')
    if (invite) setInviteCode(invite)
  }, [searchParams])

  // 既にログイン済み（＝このフォーム経由ではなく元から有効なセッション）ならフィード側へ。
  useEffect(() => {
    if (status === 'authenticated' && !justRegisteredRef.current) {
      router.replace('/feed')
    }
  }, [status, router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFieldError('')
    setSubmitError('')

    const normalizedUsername = username.trim().toLowerCase()
    const usernameError = validateUsername(normalizedUsername)
    if (usernameError) {
      setFieldError(usernameError)
      return
    }
    const passwordError = validatePassword(password)
    if (passwordError) {
      setFieldError(passwordError)
      return
    }
    if (password !== confirmPassword) {
      setFieldError('パスワード（確認）が一致しません')
      return
    }

    setSubmitting(true)
    try {
      justRegisteredRef.current = true
      await register({
        invite_code: inviteCode.trim() || undefined,
        username: normalizedUsername,
        password,
        display_name: displayName.trim() || undefined,
      })
      router.replace('/')
    } catch (err) {
      justRegisteredRef.current = false
      setSubmitError(mapRegisterError(err))
      setSubmitting(false)
    }
  }

  if (status === 'authenticated') {
    // /feed への replace 待ち。フォームの二重表示・二重送信を避けるため何も描画しない。
    return null
  }

  return (
    <div className="signup-shell">
      <div className="signup-card modal-box">
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

        <h1 className="modal-title">新規登録</h1>
        <p className="modal-desc">招待コードをお持ちの方のみご登録いただけます。</p>

        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-label" htmlFor="signup-invite-code">
              招待コード
            </label>
            <input
              className="form-input"
              id="signup-invite-code"
              type="text"
              autoComplete="off"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="signup-username">
              ユーザーID
            </label>
            <input
              className="form-input"
              id="signup-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="signup-display-name">
              表示名（任意）
            </label>
            <input
              className="form-input"
              id="signup-display-name"
              type="text"
              autoComplete="nickname"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="signup-password">
              パスワード
            </label>
            <input
              className="form-input"
              id="signup-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
            <p className="form-hint">12文字以上・小文字/大文字/数字/記号のうち3種類以上</p>
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="signup-password-confirm">
              パスワード（確認）
            </label>
            <input
              className="form-input"
              id="signup-password-confirm"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={submitting}
            />
          </div>

          {fieldError && <p className="form-error">{fieldError}</p>}

          <div className="modal-actions">
            <button className="btn btn-primary" type="submit" disabled={submitting}>
              {submitting ? '登録中…' : '登録する'}
            </button>
          </div>
        </form>

        {submitError && (
          <p role="status" className="form-error">
            {submitError}
          </p>
        )}

        <div className="modal-divider" aria-hidden="true">
          または
        </div>

        <Link href="/" className="btn btn-ghost">
          アカウントをお持ちの方はログイン
        </Link>
      </div>
    </div>
  )
}

export default function SignupPage() {
  // useSearchParams はビルド時静的化のため Suspense 境界が必須（Next.js の制約）。
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  )
}
