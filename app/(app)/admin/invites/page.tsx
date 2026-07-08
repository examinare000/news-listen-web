'use client'

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { createApiClient } from '@/lib/api'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import type { Invite, InviteCreateResponse, InviteStatus } from '@/types/index'

const STATUS_LABELS: Record<InviteStatus, string> = {
  active: '有効',
  expired: '期限切れ',
  exhausted: '使用済み',
  revoked: '失効',
}

const STATUS_TONES: Record<InviteStatus, string> = {
  active: 'badge-easy',
  expired: 'badge-medium',
  exhausted: 'badge-medium',
  revoked: 'badge-hard',
}

function InviteStatusBadge({ status }: { status: InviteStatus }) {
  return <span className={`badge ${STATUS_TONES[status]}`}>{STATUS_LABELS[status]}</span>
}

// 正の整数のみ許容する任意入力欄のパース。空欄は「未指定」（undefined）として扱う。
function parseOptionalPositiveInt(raw: string): number | undefined | 'invalid' {
  if (!raw.trim()) return undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) return 'invalid'
  return n
}

// 管理者用招待コード管理画面。作成・一覧・失効を行う。
// admin ロール以外には操作 UI を出さない（バックエンドでも require_admin で 403）。
export default function AdminInvitesPage() {
  const { user, status } = useAuth()
  const client = createApiClient()
  const { showToast } = useToast()

  const [invites, setInvites] = useState<Invite[]>([])
  const [loadError, setLoadError] = useState('')

  // 作成フォーム
  const [note, setNote] = useState('')
  const [maxUses, setMaxUses] = useState('1')
  const [expiresInDays, setExpiresInDays] = useState('')
  const [formError, setFormError] = useState('')
  const [creating, setCreating] = useState(false)

  // 作成直後のみ表示する invite_url（以降は一覧再取得しても復元できない）。
  const [createdInvite, setCreatedInvite] = useState<InviteCreateResponse | null>(null)

  // 失効確認
  const [revokeTargetId, setRevokeTargetId] = useState<string | null>(null)

  const isAdmin = user?.role === 'admin'

  const reload = useCallback(async () => {
    setLoadError('')
    try {
      const res = await client.listInvites()
      setInvites(res.invites)
    } catch {
      setLoadError('招待コード一覧の取得に失敗しました')
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

    const maxUsesParsed = parseOptionalPositiveInt(maxUses)
    if (maxUsesParsed === 'invalid') {
      setFormError('最大使用回数は1以上の整数で入力してください')
      return
    }
    const expiresParsed = parseOptionalPositiveInt(expiresInDays)
    if (expiresParsed === 'invalid') {
      setFormError('有効期限（日数）は1以上の整数で入力してください')
      return
    }

    setCreating(true)
    try {
      const res = await client.createInvite({
        note: note.trim() || undefined,
        max_uses: maxUsesParsed,
        expires_in_days: expiresParsed,
      })
      setCreatedInvite(res)
      setNote('')
      setMaxUses('1')
      setExpiresInDays('')
      await reload()
    } catch {
      setFormError('招待コードの作成に失敗しました')
    } finally {
      setCreating(false)
    }
  }

  async function handleCopy() {
    if (!createdInvite) return
    try {
      await navigator.clipboard.writeText(createdInvite.invite_url)
      showToast('招待URLをコピーしました', 'success')
    } catch {
      showToast('コピーに失敗しました', 'error')
    }
  }

  function handleRevokeClick(id: string) {
    setRevokeTargetId(id)
  }

  function handleRevokeCancel() {
    setRevokeTargetId(null)
  }

  async function handleRevokeConfirm() {
    if (!revokeTargetId) return
    const id = revokeTargetId
    setRevokeTargetId(null)
    try {
      await client.revokeInvite(id)
      await reload()
    } catch {
      setLoadError('招待コードの失効に失敗しました')
    }
  }

  if (status === 'authenticated' && !isAdmin) {
    return (
      <div className="content-area content-narrow">
        <div className="page-header">
          <h1 className="page-title">招待コード管理</h1>
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
          <h1 className="page-title">招待コード管理</h1>
          <div className="page-subtitle">新規登録用の招待コードの発行・失効（管理者のみ）</div>
        </div>
      </div>

      <div className="content-area content-narrow">
        {/* 作成フォーム */}
        <section className="settings-section">
          <div className="settings-section-header">
            <h2 className="settings-section-title">招待コードを発行</h2>
          </div>
          <form onSubmit={handleCreate} style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              className="form-input"
              type="text"
              placeholder="メモ（任意）"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label="メモ"
              disabled={creating}
            />
            <input
              className="form-input"
              type="number"
              min={1}
              placeholder="最大使用回数"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              aria-label="最大使用回数"
              disabled={creating}
            />
            <input
              className="form-input"
              type="number"
              min={1}
              placeholder="有効期限（日数・任意）"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              aria-label="有効期限（日数）"
              disabled={creating}
            />
            {formError && <p className="form-error">{formError}</p>}
            <button className="btn btn-primary" type="submit" disabled={creating} style={{ alignSelf: 'flex-end' }}>
              {creating ? '作成中…' : '招待コードを作成'}
            </button>
          </form>
        </section>

        {/* 作成直後のみ表示（以降は復元不可） */}
        {createdInvite && (
          <section className="settings-section">
            <div className="settings-section-header">
              <h2 className="settings-section-title">招待URL（この画面でのみ表示されます）</h2>
            </div>
            <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p className="form-input" style={{ wordBreak: 'break-all', userSelect: 'all' }}>
                {createdInvite.invite_url}
              </p>
              <button className="btn btn-ghost" onClick={handleCopy} style={{ alignSelf: 'flex-start' }}>
                コピー
              </button>
            </div>
          </section>
        )}

        {/* 一覧 */}
        <section className="settings-section">
          <div className="settings-section-header">
            <h2 className="settings-section-title">招待コード一覧</h2>
          </div>
          {loadError && <p className="form-error" style={{ padding: '0 20px' }}>{loadError}</p>}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {invites.map((invite) => (
              <li key={invite.id} className="settings-row">
                <div>
                  <div className="settings-row-label">
                    {invite.note ?? '（メモなし）'} <InviteStatusBadge status={invite.status} />
                  </div>
                  <div className="settings-row-desc">
                    使用状況: {invite.use_count}/{invite.max_uses} ・
                    有効期限: {invite.expires_at ? new Date(invite.expires_at).toLocaleDateString('ja-JP') : '無期限'} ・
                    作成者: {invite.created_by}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {invite.status === 'active' && (
                    <button
                      className="btn btn-ghost"
                      onClick={() => handleRevokeClick(invite.id)}
                      aria-label={`${invite.note ?? invite.id} を失効`}
                    >
                      失効
                    </button>
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

      {/* 失効確認ダイアログ */}
      <ConfirmDialog
        isOpen={revokeTargetId !== null}
        title="招待コードを失効"
        message="この招待コードを失効します。この操作は取り消せません。"
        onConfirm={handleRevokeConfirm}
        onCancel={handleRevokeCancel}
      />
    </>
  )
}
