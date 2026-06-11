'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useApp } from '@/contexts/AppContext'
import { useToast } from '@/components/ui/Toast'
import { ArticleCard } from '@/components/ArticleCard'
import { createApiClient, ApiError } from '@/lib/api'
import type { Article } from '@/types/index'

function SkeletonCard() {
  return <div data-testid="skeleton-card" className="skeleton-card" />
}

export default function FeedPage() {
  const { state } = useApp()
  const { showToast } = useToast()

  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set())

  const fetchFeed = useCallback(async () => {
    setLoading(true)
    setErrorMessage(null)
    try {
      const data = await createApiClient({ baseUrl: state.baseUrl, apiKey: state.apiKey }).getFeed()
      setArticles(data.articles)
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 0) {
          setErrorMessage('サーバーに接続できません')
        } else if (err.status === 401) {
          setErrorMessage('API キーが正しくありません')
        } else {
          setErrorMessage(`エラーが発生しました (${err.status})`)
        }
      } else {
        setErrorMessage('予期しないエラーが発生しました')
      }
    } finally {
      setLoading(false)
    }
  }, [state.baseUrl, state.apiKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchFeed()
  }, [fetchFeed])

  async function handleStar(id: string) {
    setBusyIds((prev) => new Set(prev).add(id))
    try {
      await createApiClient({ baseUrl: state.baseUrl, apiKey: state.apiKey }).starArticle(id)
      setStarredIds((prev) => new Set(prev).add(id))
      showToast('Star しました', 'success')
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404) {
          showToast('記事が見つかりません', 'error')
          setArticles((prev) => prev.filter((a) => a.id !== id))
        } else if (err.status === 401) {
          showToast('API キーが正しくありません', 'error')
        } else {
          showToast(`エラーが発生しました (${err.status})`, 'error')
        }
      }
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  async function handleDismiss(id: string) {
    setBusyIds((prev) => new Set(prev).add(id))
    try {
      await createApiClient({ baseUrl: state.baseUrl, apiKey: state.apiKey }).dismissArticle(id)
      setArticles((prev) => prev.filter((a) => a.id !== id))
    } catch (err) {
      if (err instanceof ApiError) {
        showToast(`エラーが発生しました (${err.status})`, 'error')
      }
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  if (loading) {
    return <SkeletonCard />
  }

  if (errorMessage) {
    return (
      <div>
        <p>{errorMessage}</p>
        <button onClick={fetchFeed} aria-label="リフレッシュ">リフレッシュ</button>
      </div>
    )
  }

  if (articles.length === 0) {
    return (
      <div>
        <p>まだ記事がありません</p>
        <p>毎日 06:00 に自動更新されます</p>
        <button onClick={fetchFeed} aria-label="リフレッシュ">リフレッシュ</button>
      </div>
    )
  }

  return (
    <div>
      <button onClick={fetchFeed} aria-label="リフレッシュ">リフレッシュ</button>
      {articles.map((article) => (
        <ArticleCard
          key={article.id}
          article={article}
          onStar={handleStar}
          onDismiss={handleDismiss}
          busy={busyIds.has(article.id)}
          starred={starredIds.has(article.id)}
        />
      ))}
    </div>
  )
}
