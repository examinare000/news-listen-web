'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useToast } from '@/components/ui/Toast'
import { ArticleCard } from '@/components/ArticleCard'
import { createApiClient, ApiError } from '@/lib/api'
import { formatRetryAfter } from '@/lib/format'
import type { Article, DifficultyLevel } from '@/types/index'

// 生成上限超過（429）時のユーザー向けメッセージ（issue #82 / ADR-073）。次回可能時刻があれば併記する。
// ADR-073: backend 文言変更・版ずれ時の耐障害性のため、detail の "Monthly" 文言判定と
// Retry-After 24時間超の両方で月次判定を行う（フォールバック戦略）。
function generationLimitMessage(err: ApiError): string {
  const when = formatRetryAfter(err.retryAfterSeconds)
  const isMonthly = /monthly/i.test(err.detail) || (err.retryAfterSeconds ?? 0) > 86400
  const label = isMonthly ? '今月の生成上限' : '本日の生成上限'
  return when ? `${label}に達しました（${when}に可能）` : `${label}に達しました`
}

// Star 成功時のメッセージ（issue #164 / ADR-061）。remaining が数値の場合のみ残回数を併記する。
// remaining が undefined（旧 backend で未送信）の場合は従来の文言を維持する（graceful degradation）。
function starSuccessMessage(remaining: number | null | undefined): string {
  return typeof remaining === 'number'
    ? `Star しました（残り生成 ${remaining} 回）`
    : 'Star しました'
}

type FeedTab = 'all' | 'starred'

// issue #83: ローディング中に描画するスケルトン枚数。実際の1日あたりフィード件数の
// 目安に合わせ、実データ表示時の高さの変化（レイアウト飛び）を軽減する。
const SKELETON_COUNT = 6

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
  const { showToast } = useToast()

  const [articles, setArticles] = useState<Article[]>([])
  const [feedDate, setFeedDate] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<FeedTab>('all')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const fetchFeed = useCallback(async () => {
    setLoading(true)
    setErrorMessage(null)
    try {
      const data = await createApiClient().getFeed()
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
  }, [])

  useEffect(() => {
    fetchFeed()
  }, [fetchFeed])

  async function handleStar(id: string, difficulty?: DifficultyLevel) {
    setBusyIds((prev) => new Set(prev).add(id))
    try {
      // difficulty 未指定時は明示的な undefined を渡さず、従来どおり id のみで呼ぶ
      // （後方互換・starArticle 側の「省略時はボディなし」契約と合わせる）
      const api = createApiClient()
      const res = difficulty ? await api.starArticle(id, difficulty) : await api.starArticle(id)
      setStarredIds((prev) => new Set(prev).add(id))
      showToast(starSuccessMessage(res.remaining), 'success')
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404) {
          showToast('記事が見つかりません', 'error')
          setArticles((prev) => prev.filter((a) => a.id !== id))
        } else if (err.status === 401) {
          showToast('API キーが正しくありません', 'error')
        } else if (err.status === 429) {
          showToast(generationLimitMessage(err), 'error')
        } else {
          showToast(`エラーが発生しました (${err.status})`, 'error')
        }
      } else {
        // WHY: 予期しない例外（TypeErrorなど）をキャッチして、ユーザーに通知する。
        // APIエラー以外の場合も適切にトースト表示して、操作失敗を明示する。
        showToast('予期しないエラーが発生しました', 'error')
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
      await createApiClient().dismissArticle(id)
      setArticles((prev) => prev.filter((a) => a.id !== id))
    } catch (err) {
      if (err instanceof ApiError) {
        showToast(`エラーが発生しました (${err.status})`, 'error')
      } else {
        // WHY: 予期しない例外（TypeErrorなど）をキャッチして、ユーザーに通知する。
        // APIエラー以外の場合も適切にトースト表示して、操作失敗を明示する。
        showToast('予期しないエラーが発生しました', 'error')
      }
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  function handleToggleSelection(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  async function handleBulkStar() {
    if (selectedIds.size === 0) return

    const idArray = Array.from(selectedIds)
    const api = createApiClient()

    // WHY: 一括スター中は対象記事を busy にして個別 Star/Dismiss との二重操作を防ぐ
    setBusyIds((prev) => new Set([...prev, ...idArray]))
    try {
      // WHY: Promise.allSettled で一部失敗しても他の成功を処理
      const results = await Promise.allSettled(idArray.map((id) => api.starArticle(id)))

      const successful = idArray.filter((id, idx) => results[idx].status === 'fulfilled')
      const failed = idArray.filter((id, idx) => results[idx].status === 'rejected')

      // 成功した分を starredIds に追加
      if (successful.length > 0) {
        setStarredIds((prev) => new Set([...prev, ...successful]))
        showToast(`${successful.length}件をスターしました`, 'success')
      }

      // 失敗分を通知。生成上限（429）が含まれていれば上限メッセージを優先する（issue #82）。
      if (failed.length > 0) {
        const limit = results.find(
          (r): r is PromiseRejectedResult =>
            r.status === 'rejected' && r.reason instanceof ApiError && r.reason.status === 429,
        )
        if (limit) {
          showToast(generationLimitMessage(limit.reason as ApiError), 'error')
        } else {
          showToast(`${failed.length}件のスターに失敗しました`, 'error')
        }
      }
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev)
        idArray.forEach((id) => next.delete(id))
        return next
      })
      // 選択をクリア、選択モード終了
      setSelectedIds(new Set())
      setSelectionMode(false)
    }
  }

  function handleCancelSelection() {
    setSelectedIds(new Set())
    setSelectionMode(false)
  }

  // WHY: 件数・表示対象は articles と starredIds から都度導出する。
  // Dismiss で記事が消えた際にも別カウンタの同期処理なしで件数が追従するため
  const starredArticles = articles.filter((a) => starredIds.has(a.id))
  const visibleArticles = activeTab === 'starred' ? starredArticles : articles

  function renderContent() {
    if (loading) {
      // issue #83: スケルトン1枚のみだと実データ表示時にレイアウトが大きく飛ぶため、
      // 実際のフィード件数に近い枚数（SKELETON_COUNT）を描画してブレを抑える。
      // role="status" + aria-live="polite" でローディング中であることを支援技術へ通知する。
      return (
        <div className="article-list" role="status" aria-live="polite" aria-label="読み込み中">
          {Array.from({ length: SKELETON_COUNT }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )
    }

    if (errorMessage) {
      return (
        <div className="empty-state">
          <div className="empty-state-icon" aria-hidden="true">⚠</div>
          {/* issue #83: subscriptions/settings 画面と揃え、エラー本文に role="alert" を付与する */}
          <div className="empty-state-title" role="alert">{errorMessage}</div>
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
      <>
        <div className="article-list">
          {visibleArticles.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              onStar={handleStar}
              onDismiss={handleDismiss}
              busy={busyIds.has(article.id)}
              starred={starredIds.has(article.id)}
              selectionMode={selectionMode}
              isSelected={selectedIds.has(article.id)}
              onToggleSelect={handleToggleSelection}
            />
          ))}
        </div>
        {selectionMode && (
          <div className="bulk-star-footer">
            {selectedIds.size > 0 && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleBulkStar}
                aria-label={`${selectedIds.size}件を一括スター`}
              >
                {selectedIds.size}件を一括スター
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleCancelSelection}
              aria-label="キャンセル"
            >
              キャンセル
            </button>
          </div>
        )}
      </>
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
          {!selectionMode && (
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => setSelectionMode(true)}
              aria-label="複数選択"
              title="複数選択"
            >
              ☑
            </button>
          )}
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
