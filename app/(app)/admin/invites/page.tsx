'use client'

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAdminCommands } from '@/contexts/useAdminCommands'
import { useAdminQueries } from '@/contexts/useAdminQueries'
import type { InviteReceipt, InviteRow, InviteStatus } from '@/lib/admin/application/readModels'
import { parseOptionalPositiveInt } from '@/lib/admin/domain/inviteInput'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { AdminGate } from '@/components/AdminGate'
import { useToast } from '@/components/ui/Toast'

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

// 管理者用招待コード管理画面。作成・一覧・失効を行う。
// admin ロール以外には操作 UI を出さない（バックエンドでも require_admin で 403）。
// gating（未認証・非 admin・読み込み中）は AdminGate に集約する（web-contract-19）。
export default function AdminInvitesPage() {
  return (
    <AdminGate title="招待コード管理">
      <AdminInvitesPanel />
    </AdminGate>
  )
}

function AdminInvitesPanel() {
  const commands = useAdminCommands()
  const queries = useAdminQueries()
  const { showToast } = useToast()

  const [invites, setInvites] = useState<ReadonlyArray<InviteRow>>([])
  const [loadError, setLoadError] = useState('')

  // 作成フォーム
  const [note, setNote] = useState('')
  const [maxUses, setMaxUses] = useState('1')
  const [expiresInDays, setExpiresInDays] = useState('')
  const [formError, setFormError] = useState('')
  const [creating, setCreating] = useState(false)

  // 作成直後のみ表示する招待 URL（以降は一覧再取得しても復元できない）。
  const [createdInvite, setCreatedInvite] = useState<InviteReceipt | null>(null)

  // 失効確認
  const [revokeTargetId, setRevokeTargetId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoadError('')
    try {
      const result = await queries.listInvites()
      if (!result.ok) {
        setLoadError('招待コード一覧の取得に失敗しました')
        return
      }
      setInvites(result.value)
    } catch {
      setLoadError('招待コード一覧の取得に失敗しました')
    }
  }, [queries])

  // AdminGate が granted のときだけ mount するため、ロード effect は無条件でよい。
  useEffect(() => {
    void reload()
  }, [reload])

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
      const result = await commands.createInvite({
        note: note.trim() || undefined,
        maxUses: maxUsesParsed,
        expiresInDays: expiresParsed,
      })
      if (!result.ok) {
        setFormError('招待コードの作成に失敗しました')
        return
      }
      setCreatedInvite(result.value)
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
      await navigator.clipboard.writeText(createdInvite.inviteUrl)
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
      const result = await commands.revokeInvite(id)
      if (!result.ok) {
        setLoadError('招待コードの失効に失敗しました')
        return
      }
      await reload()
    } catch {
      setLoadError('招待コードの失効に失敗しました')
    }
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
                {createdInvite.inviteUrl}
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
                    使用状況: {invite.useCount}/{invite.maxUses} ・
                    有効期限: {invite.expiresAt ? new Date(invite.expiresAt).toLocaleDateString('ja-JP') : '無期限'} ・
                    作成者: {invite.createdBy}
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
