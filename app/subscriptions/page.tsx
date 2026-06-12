'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '@/contexts/AppContext'
import { useToast } from '@/components/ui/Toast'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { createApiClient, ApiError } from '@/lib/api'
import type { Source } from '@/types/index'

// おすすめのソース（D23）: クリックでフォームに自動入力する。即 API 送信はしない
// WHY: ユーザーが URL を確認してから登録する余地を残す（デザインの fillForm と同挙動）
const RECOMMENDED_SOURCES = [
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', desc: 'テクノロジー全般' },
  { name: 'dev.to', url: 'https://dev.to/feed', desc: '開発者コミュニティ' },
] as const

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

  // Add form state
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<Source | null>(null)

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

  useEffect(() => {
    fetchSources()
  }, [fetchSources])

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

  function fillForm(name: string, url: string) {
    setNewName(name)
    setNewUrl(url)
    nameInputRef.current?.focus()
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
                    おすすめのソース
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {RECOMMENDED_SOURCES.map((rec) => (
                      <div
                        key={rec.url}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          background: 'var(--bg-base)',
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>{rec.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{rec.desc}</div>
                        </div>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '4px 10px', fontSize: 11 }}
                          onClick={() => fillForm(rec.name, rec.url)}
                          aria-label={`${rec.name} を追加`}
                        >
                          追加
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
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
