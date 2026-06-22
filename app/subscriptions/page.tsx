'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '@/contexts/AppContext'
import { useToast } from '@/components/ui/Toast'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { createApiClient, ApiError } from '@/lib/api'
import type { Source, FeaturedSource } from '@/types/index'

function TrashIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}

export default function SubscriptionsPage() {
  const { state } = useApp()
  const { showToast } = useToast()

  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // システム提供のおすすめサイト（DB 駆動）
  const [featured, setFeatured] = useState<FeaturedSource[]>([])
  // 即購読中のおすすめサイト id（ボタンの二重押下防止）
  const [subscribingId, setSubscribingId] = useState<string | null>(null)

  // Add form state
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<Source | null>(null)

  // 既に購読済みのサイトはおすすめから除外する（URL で突合）。
  // サーバ側は featured / sources とも Pydantic HttpUrl で同一正規化され、重複判定も完全一致のため、
  // フロントでも URL の完全一致で判定する（末尾スラッシュ違いは別フィードとして残す）。
  const subscribedUrls = new Set(sources.map((s) => s.url))
  const recommended = featured.filter((site) => !subscribedUrls.has(site.url))

  const makeClient = useCallback(
    () => createApiClient({ baseUrl: state.baseUrl, apiKey: state.apiKey }),
    [state.baseUrl, state.apiKey],
  )

  const fetchSources = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const data = await makeClient().getSources()
      setSources(data.sources)
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setFetchError('API キーが正しくありません')
        } else {
          setFetchError(`読み込みに失敗しました (${err.status})`)
        }
      } else {
        setFetchError('予期しないエラーが発生しました')
      }
    } finally {
      setLoading(false)
    }
  }, [makeClient])

  const fetchFeatured = useCallback(async () => {
    try {
      const data = await makeClient().getFeaturedSources()
      setFeatured(data.sites)
    } catch {
      // おすすめ欄の取得失敗は致命的でない（購読一覧・追加フォームは独立して機能する）
      setFeatured([])
    }
  }, [makeClient])

  useEffect(() => {
    fetchSources()
    fetchFeatured()
  }, [fetchSources, fetchFeatured])

  // おすすめサイトをワンクリックで即購読する。
  async function handleSubscribeFeatured(site: FeaturedSource) {
    setSubscribingId(site.id)
    try {
      const data = await makeClient().addSource(site.name, site.url)
      setSources(data.sources)
      showToast(`「${site.name}」を購読しました`, 'success')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        showToast(`「${site.name}」は登録済みです`, 'error')
      } else if (err instanceof ApiError) {
        showToast(`購読に失敗しました (${err.status})`, 'error')
      } else {
        showToast('購読に失敗しました', 'error')
      }
    } finally {
      setSubscribingId(null)
    }
  }

  async function handleAdd() {
    // Client-side validation: URL must start with http:// or https://
    if (!newUrl.startsWith('http://') && !newUrl.startsWith('https://')) {
      setAddError('URL は http:// または https:// から始めてください')
      return
    }
    setAddError(null)
    setSubmitting(true)
    try {
      const data = await makeClient().addSource(newName, newUrl)
      setSources(data.sources)
      setNewName('')
      setNewUrl('')
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setAddError('この URL は登録済みです')
        } else if (err.status === 422) {
          setAddError('URL の形式が正しくありません')
        } else {
          setAddError(`エラーが発生しました (${err.status})`)
        }
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    try {
      const data = await makeClient().deleteSource(target.url)
      // Replace state with the response (no re-GET needed)
      setSources(data.sources)
    } catch (err) {
      if (err instanceof ApiError) {
        showToast(`削除に失敗しました (${err.status})`, 'error')
      } else {
        showToast('削除に失敗しました', 'error')
      }
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">購読管理</h1>
          <div className="page-subtitle">RSS ソースの追加・管理</div>
        </div>
      </div>

      <div className="content-area">
        {loading ? (
          <div>読み込み中...</div>
        ) : fetchError ? (
          <div className="empty-state">
            <p role="alert" className="empty-state-title">{fetchError}</p>
            <button className="btn btn-ghost" onClick={fetchSources} aria-label="リフレッシュ">
              リフレッシュ
            </button>
          </div>
        ) : (
          <div className="subs-layout">
            <div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  marginBottom: 12,
                  fontFamily: 'var(--font-mono), monospace',
                }}
              >
                {sources.length} ソース購読中
              </div>

              {sources.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon" aria-hidden="true">📡</div>
                  <div className="empty-state-title">購読ソースがありません</div>
                  <div className="empty-state-desc">右のフォームから RSS ソースを追加してください</div>
                </div>
              ) : (
                /* WHY role="list" 明示: list-style:none の ul は Safari/VoiceOver が
                   リストセマンティクスを除去するため、属性で復元する */
                <ul className="subs-list" role="list" style={{ listStyle: 'none' }}>
                  {sources.map((source) => (
                    <li key={source.url} className="sub-row">
                      {/* WHY 固定絵文字: デザインの 🔺🟢 はモック用の手動割当で、URL からの推定はスコープ外（指示書 §2） */}
                      <div className="sub-icon" aria-hidden="true">📡</div>
                      <div className="sub-info">
                        <div className="sub-name">{source.name}</div>
                        <div className="sub-url">{source.url}</div>
                      </div>
                      <button
                        className="sub-delete"
                        onClick={() => setDeleteTarget(source)}
                        aria-label="削除"
                        title="削除"
                      >
                        <TrashIcon />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div className="add-card">
                <div className="add-card-title">ソースを追加</div>
                <div className="add-card-desc">RSS フィードの URL を入力してください。</div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    handleAdd()
                  }}
                >
                  <div className="form-field">
                    <label className="form-label" htmlFor="source-name">
                      ソース名
                    </label>
                    <input
                      id="source-name"
                      ref={nameInputRef}
                      type="text"
                      className="form-input"
                      placeholder="例: TechCrunch"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      disabled={submitting}
                    />
                  </div>

                  <div className="form-field">
                    <label className="form-label" htmlFor="source-url">
                      RSS URL
                    </label>
                    <input
                      id="source-url"
                      type="text"
                      className="form-input"
                      placeholder="https://..."
                      value={newUrl}
                      onChange={(e) => setNewUrl(e.target.value)}
                      disabled={submitting}
                    />
                  </div>

                  {addError && (
                    <p role="alert" className="form-error">
                      {addError}
                    </p>
                  )}

                  <button
                    type="submit"
                    className="btn btn-primary"
                    style={{ width: '100%', justifyContent: 'center' }}
                    disabled={submitting}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    追加する
                  </button>
                </form>

                {recommended.length > 0 && (
                  <div
                    style={{
                      marginTop: 16,
                      paddingTop: 16,
                      borderTop: '1px solid var(--border)',
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        marginBottom: 8,
                        fontWeight: 600,
                      }}
                    >
                      おすすめのサイト
                    </div>
                    {/* ワンクリックで即購読する（D23 から挙動変更）。URL 直接入力は左フォームで従来どおり可能 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {recommended.map((site) => (
                        <div
                          key={site.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            padding: '8px 12px',
                            background: 'var(--bg-base)',
                            borderRadius: 6,
                            border: '1px solid var(--border)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            {site.thumbnail_url ? (
                              // eslint-disable-next-line @next/next/no-img-element -- 任意ホストのサムネイルのため next/image の最適化対象外
                              <img
                                src={site.thumbnail_url}
                                alt=""
                                width={20}
                                height={20}
                                style={{ borderRadius: 4, flexShrink: 0, objectFit: 'cover' }}
                              />
                            ) : (
                              <span aria-hidden="true" style={{ flexShrink: 0 }}>📡</span>
                            )}
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 600 }}>{site.name}</div>
                              {site.description && (
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: 'var(--text-muted)',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {site.description}
                                </div>
                              )}
                            </div>
                          </div>
                          <button
                            className="btn btn-ghost"
                            style={{ padding: '4px 10px', fontSize: 11, flexShrink: 0 }}
                            onClick={() => handleSubscribeFeatured(site)}
                            disabled={subscribingId === site.id}
                            aria-label={`${site.name} を購読`}
                          >
                            {subscribingId === site.id ? '購読中…' : '購読'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="削除の確認"
        message={`「${deleteTarget?.name}」を削除しますか？`}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}
