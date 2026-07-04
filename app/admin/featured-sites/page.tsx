'use client'

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { createApiClient } from '@/lib/api'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import type { FeaturedSource } from '@/types/index'

// 管理者用おすすめサイト管理画面。一覧・作成・編集・削除を行う。
// admin ロール以外には操作 UI を出さない（バックエンドでも require_admin で 403）。
export default function AdminFeaturedSitesPage() {
  const { user, status } = useAuth()
  const client = createApiClient()

  const [sites, setSites] = useState<FeaturedSource[]>([])
  const [loadError, setLoadError] = useState('')

  // 作成フォーム
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newThumbnail, setNewThumbnail] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [formError, setFormError] = useState('')

  // 編集モード
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const [editThumbnail, setEditThumbnail] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editError, setEditError] = useState('')

  // 削除確認
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const isAdmin = user?.role === 'admin'

  const reload = useCallback(async () => {
    setLoadError('')
    try {
      const res = await client.listFeaturedSites()
      setSites(res.sites)
    } catch {
      setLoadError('一覧の取得に失敗しました')
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
    if (!newName || !newUrl) {
      setFormError('サイト名と URL を入力してください')
      return
    }
    try {
      const nextOrder = sites.length === 0 ? 0 : Math.max(...sites.map((s) => s.order)) + 1
      await client.createFeaturedSite({
        name: newName,
        url: newUrl,
        thumbnail_url: newThumbnail || undefined,
        description: newDescription || undefined,
        order: nextOrder,
      })
      setNewName('')
      setNewUrl('')
      setNewThumbnail('')
      setNewDescription('')
      await reload()
    } catch {
      setFormError('サイト作成に失敗しました')
    }
  }

  function handleEditClick(site: FeaturedSource) {
    setEditError('')
    setEditingId(site.id)
    setEditName(site.name)
    setEditUrl(site.url)
    setEditThumbnail(site.thumbnail_url ?? '')
    setEditDescription(site.description ?? '')
  }

  function handleEditCancel() {
    setEditingId(null)
    setEditName('')
    setEditUrl('')
    setEditThumbnail('')
    setEditDescription('')
    setEditError('')
  }

  async function handleEditSave(id: string) {
    setEditError('')
    if (!editName || !editUrl) {
      setEditError('サイト名と URL を入力してください')
      return
    }
    try {
      // PUT は全置換のため、表示順（order）を送らないと既定値 0 で上書きされてしまう。
      // 編集フォームは order を扱わないので、既存の値をそのまま引き継いで送る。
      const currentOrder = sites.find((s) => s.id === id)?.order ?? 0
      await client.updateFeaturedSite(id, {
        name: editName,
        url: editUrl,
        thumbnail_url: editThumbnail || undefined,
        description: editDescription || undefined,
        order: currentOrder,
      })
      handleEditCancel()
      await reload()
    } catch {
      setEditError('サイト更新に失敗しました')
    }
  }

  function handleDeleteClick(id: string) {
    setConfirmDeleteId(id)
  }

  function handleDeleteCancel() {
    setConfirmDeleteId(null)
  }

  async function handleDeleteConfirm(id: string) {
    try {
      await client.deleteFeaturedSite(id)
      handleDeleteCancel()
      await reload()
    } catch {
      setLoadError('サイトの削除に失敗しました')
    }
  }

  if (status === 'authenticated' && !isAdmin) {
    return (
      <div className="content-area content-narrow">
        <div className="page-header">
          <h1 className="page-title">おすすめサイト管理</h1>
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
          <h1 className="page-title">おすすめサイト管理</h1>
          <div className="page-subtitle">おすすめサイトの追加・編集・削除（管理者のみ）</div>
        </div>
      </div>

      <div className="content-area content-narrow">
        {/* 作成フォーム */}
        <section className="settings-section">
          <div className="settings-section-header">
            <h2 className="settings-section-title">サイトを追加</h2>
          </div>
          <form onSubmit={handleCreate} style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              className="form-input"
              type="text"
              placeholder="サイト名"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              aria-label="サイト名"
            />
            <input
              className="form-input"
              type="url"
              placeholder="URL"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              aria-label="URL"
            />
            <input
              className="form-input"
              type="url"
              placeholder="サムネイル URL（任意）"
              value={newThumbnail}
              onChange={(e) => setNewThumbnail(e.target.value)}
              aria-label="サムネイル URL"
            />
            <textarea
              className="form-input"
              placeholder="説明（任意）"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              aria-label="説明"
              style={{ minHeight: '80px' }}
            />
            {formError && <p className="form-error">{formError}</p>}
            <button className="btn btn-primary" type="submit" style={{ alignSelf: 'flex-end' }}>
              追加
            </button>
          </form>
        </section>

        {/* 一覧 */}
        <section className="settings-section">
          <div className="settings-section-header">
            <h2 className="settings-section-title">サイト一覧</h2>
          </div>
          {loadError && <p className="form-error" style={{ padding: '0 20px' }}>{loadError}</p>}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {sites.map((site) => (
              <li key={site.id}>
                {editingId === site.id ? (
                  // 編集モード
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <input
                        className="form-input"
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        aria-label={`${site.name} の名前`}
                      />
                      <input
                        className="form-input"
                        type="url"
                        value={editUrl}
                        onChange={(e) => setEditUrl(e.target.value)}
                        aria-label={`${site.name} の URL`}
                      />
                      <input
                        className="form-input"
                        type="url"
                        value={editThumbnail}
                        onChange={(e) => setEditThumbnail(e.target.value)}
                        aria-label={`${site.name} のサムネイル URL`}
                      />
                      <textarea
                        className="form-input"
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        aria-label={`${site.name} の説明`}
                        style={{ minHeight: '80px' }}
                      />
                      {editError && <p className="form-error">{editError}</p>}
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost" onClick={handleEditCancel} aria-label="キャンセル">
                          キャンセル
                        </button>
                        <button className="btn btn-primary" onClick={() => handleEditSave(site.id)} aria-label="保存">
                          保存
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  // 通常表示
                  <div className="settings-row">
                    <div>
                      <div className="settings-row-label">{site.name}</div>
                      <div className="settings-row-desc">
                        {site.url}
                        {site.description && (
                          <>
                            <br />
                            {site.description}
                          </>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-ghost" onClick={() => handleEditClick(site)} aria-label={`${site.name} を編集`}>
                        編集
                      </button>
                      <button className="btn btn-ghost" onClick={() => handleDeleteClick(site.id)} aria-label={`${site.name} を削除`}>
                        削除
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        <Link className="btn btn-ghost" href="/settings">
          設定へ戻る
        </Link>
      </div>

      {/* 削除確認ダイアログ */}
      <ConfirmDialog
        isOpen={confirmDeleteId !== null}
        title="サイトを削除"
        message={`選択したサイトを削除します。この操作は取り消せません。`}
        onConfirm={() => {
          if (confirmDeleteId) handleDeleteConfirm(confirmDeleteId)
        }}
        onCancel={handleDeleteCancel}
      />
    </>
  )
}
