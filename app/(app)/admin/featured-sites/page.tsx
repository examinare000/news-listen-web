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

  // 並べ替え中は上下ボタンを無効化し、多重実行を防ぐ
  const [reordering, setReordering] = useState(false)

  // 一覧取得中（初回マウント時・各操作後の reload 中）は sites が未確定/古い状態のため、
  // 作成や並べ替えが古い order を計算・送信しないよう操作を無効化する
  const [listLoading, setListLoading] = useState(true)

  // 一覧ロード中・並べ替え処理中は、stale な sites を元にした操作（作成・編集保存・削除・並べ替え）を防ぐ
  const controlsDisabled = listLoading || reordering

  const isAdmin = user?.role === 'admin'

  const reload = useCallback(async () => {
    setListLoading(true)
    try {
      const res = await client.listFeaturedSites()
      setSites(res.sites)
      setLoadError('')
    } catch {
      setLoadError('一覧の取得に失敗しました')
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    if (status === 'authenticated' && isAdmin) {
      reload()
    }
  }, [status, isAdmin, reload])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (controlsDisabled) return
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
    if (controlsDisabled) return
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

  // 隣接する行と入れ替え、配列インデックスと order が一致しない行だけを PUT で更新する
  // （＝表示順が変わった行。既存データに重複・欠番があっても、このタイミングで自己修復される）。
  // 途中で失敗しても一覧を再取得して整合させ、エラーを表示する。
  async function handleMove(id: string, direction: 'up' | 'down') {
    if (controlsDisabled) return
    const index = sites.findIndex((s) => s.id === id)
    if (index === -1) return
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= sites.length) return

    const reordered = [...sites]
    ;[reordered[index], reordered[swapIndex]] = [reordered[swapIndex], reordered[index]]

    setReordering(true)
    let failed = false
    try {
      for (let i = 0; i < reordered.length; i++) {
        const site = reordered[i]
        if (site.order !== i) {
          await client.updateFeaturedSite(site.id, {
            name: site.name,
            url: site.url,
            thumbnail_url: site.thumbnail_url || undefined,
            description: site.description || undefined,
            order: i,
          })
        }
      }
    } catch {
      failed = true
    } finally {
      setReordering(false)
    }
    // reload() は成功時に loadError を空にクリアしてしまうため、並べ替え自体の失敗は
    // reload 完了後に改めてセットし直す（reload に無条件で消させない）。
    await reload()
    if (failed) {
      setLoadError('並び替えに失敗しました')
    }
  }

  function handleDeleteClick(id: string) {
    setConfirmDeleteId(id)
  }

  function handleDeleteCancel() {
    setConfirmDeleteId(null)
  }

  async function handleDeleteConfirm(id: string) {
    if (controlsDisabled) return
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
            <button className="btn btn-primary" type="submit" disabled={controlsDisabled} style={{ alignSelf: 'flex-end' }}>
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
            {sites.map((site, index) => (
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
                        <button
                          className="btn btn-primary"
                          onClick={() => handleEditSave(site.id)}
                          disabled={controlsDisabled}
                          aria-label="保存"
                        >
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
                      <button
                        className="btn btn-ghost"
                        onClick={() => handleMove(site.id, 'up')}
                        disabled={index === 0 || controlsDisabled}
                        aria-label={`${site.name} を上へ移動`}
                      >
                        上へ
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => handleMove(site.id, 'down')}
                        disabled={index === sites.length - 1 || controlsDisabled}
                        aria-label={`${site.name} を下へ移動`}
                      >
                        下へ
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => handleEditClick(site)}
                        disabled={controlsDisabled}
                        aria-label={`${site.name} を編集`}
                      >
                        編集
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => handleDeleteClick(site.id)}
                        disabled={controlsDisabled}
                        aria-label={`${site.name} を削除`}
                      >
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
