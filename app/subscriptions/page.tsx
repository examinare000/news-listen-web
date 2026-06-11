'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useApp } from '@/contexts/AppContext'
import { useToast } from '@/components/ui/Toast'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { createApiClient, ApiError } from '@/lib/api'
import type { Source } from '@/types/index'

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

  if (loading) {
    return <div>読み込み中...</div>
  }

  if (fetchError) {
    return (
      <div>
        <p role="alert">{fetchError}</p>
        <button onClick={fetchSources} aria-label="リフレッシュ">リフレッシュ</button>
      </div>
    )
  }

  return (
    <div>
      <h1>購読ソース</h1>

      {/* Add form */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          handleAdd()
        }}
      >
        <div>
          <label htmlFor="source-name">Name</label>
          <input
            id="source-name"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={submitting}
          />
        </div>

        <div>
          <label htmlFor="source-url">URL</label>
          <input
            id="source-url"
            type="text"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            disabled={submitting}
          />
        </div>

        {addError && <p role="alert">{addError}</p>}

        <button type="submit" disabled={submitting}>
          追加
        </button>
      </form>

      {/* Source list */}
      {sources.length === 0 ? (
        <p>購読ソースがありません</p>
      ) : (
        <ul>
          {sources.map((source) => (
            <li key={source.url}>
              <span>{source.name}</span>
              <span>{source.url}</span>
              <button onClick={() => setDeleteTarget(source)} aria-label="削除">
                削除
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="削除の確認"
        message={`「${deleteTarget?.name}」を削除しますか？`}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
