'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useApp } from '@/contexts/AppContext'
import { useToast } from '@/components/ui/Toast'
import { ArticleCard } from '@/components/ArticleCard'
import { createApiClient, ApiError } from '@/lib/api'
import type { Article } from '@/types/index'

type FeedTab = 'all' | 'starred'

function SkeletonCard() {
  // WHY: カード本体（タイトル2行 + メタ + スコア行）と同等の高さ・角丸を
  // インラインで与える。globals.css は T01 完成後の編集禁止のため
  return (
    <div
      data-testid="skeleton-card"
      className="skeleton"
      style={{ height: 104, borderRadius: 10 }}
    />
  )
}

function RefreshIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 .49-4.75" />
    </svg>
  )
}

// WHY: デザインのタブ件数はインラインスタイル（DM Mono 10px）で表現されており、
// globals.css に専用クラスがないためデザイン正本同様にインラインで再現する
const tabCountStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono), monospace',
  fontSize: 10,
  color: 'var(--text-muted)',
  marginLeft: 4,
}

export default function FeedPage() {
  const { state } = useApp()
  const { showToast } = useToast()

  const [articles, setArticles] = useState<Article[]>([])
  const [feedDate, setFeedDate] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<FeedTab>('all')

  const fetchFeed = useCallback(async () => {
    setLoading(true)
    setErrorMessage(null)
    try {
      const data = await createApiClient({ baseUrl: state.baseUrl, apiKey: state.apiKey }).getFeed()
      setArticles(data.articles)
      setFeedDate(data.date ?? null)
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

  // WHY: 件数・表示対象は articles と starredIds から都度導出する。
  // Dismiss で記事が消えた際にも別カウンタの同期処理なしで件数が追従するため
  const starredArticles = articles.filter((a) => starredIds.has(a.id))
  const visibleArticles = activeTab === 'starred' ? starredArticles : articles

  function renderContent() {
    if (loading) {
      return <SkeletonCard />
    }

    if (errorMessage) {
      return (
        <div className="empty-state">
          <div className="empty-state-icon" aria-hidden="true">⚠</div>
          <div className="empty-state-title">{errorMessage}</div>
          <div className="empty-state-desc">右上の更新ボタンで再試行できます</div>
        </div>
      )
    }

    if (visibleArticles.length === 0) {
      if (activeTab === 'starred') {
        return (
          <div className="empty-state">
            <div className="empty-state-icon" aria-hidden="true">★</div>
            <div className="empty-state-title">スター済みの記事はありません</div>
            <div className="empty-state-desc">記事の ★ を押すとここに表示されます</div>
          </div>
        )
      }
      return (
        <div className="empty-state">
          <div className="empty-state-icon" aria-hidden="true">📭</div>
          <div className="empty-state-title">まだ記事がありません</div>
          <div className="empty-state-desc">毎日 06:00 に自動更新されます</div>
        </div>
      )
    }

    return (
      <div className="article-list">
        {visibleArticles.map((article) => (
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

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">フィード</div>
          <div className="page-subtitle">
            今日のレコメンド記事{feedDate ? ` — ${feedDate}` : ''}
          </div>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-icon"
            onClick={fetchFeed}
            aria-label="更新"
            title="更新"
          >
            <RefreshIcon />
          </button>
        </div>
      </div>

      {/* WHY toggle button（tab ロール不使用）: WAI-ARIA tabs パターンは tabpanel の
          関連付けと矢印キーの roving tabindex まで実装して初めて成立する。
          2 択のクライアントフィルタには aria-pressed トグルボタンの方が、標準の
          Tab キー操作のまま正しい状態を支援技術へ伝えられる */}
      <div className="feed-tabs" role="group" aria-label="フィードの絞り込み">
        <button
          type="button"
          aria-pressed={activeTab === 'all'}
          className={activeTab === 'all' ? 'feed-tab active' : 'feed-tab'}
          onClick={() => setActiveTab('all')}
        >
          すべて <span style={tabCountStyle}>{articles.length}</span>
        </button>
        <button
          type="button"
          aria-pressed={activeTab === 'starred'}
          className={activeTab === 'starred' ? 'feed-tab active' : 'feed-tab'}
          onClick={() => setActiveTab('starred')}
        >
          ★ スター済み <span style={tabCountStyle}>{starredArticles.length}</span>
        </button>
      </div>

      <div className="content-area">{renderContent()}</div>
    </>
  )
}
