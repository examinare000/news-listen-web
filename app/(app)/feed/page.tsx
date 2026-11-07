'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useToast } from '@/components/ui/Toast'
import { ArticleCard } from '@/components/ArticleCard'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useCatalogCommands } from '@/contexts/useCatalogCommands'
import { useCatalogQueries } from '@/contexts/useCatalogQueries'
import { UNSTAR_IGNORED } from '@/lib/catalog/application/commands'
import type { ArticleCardView } from '@/lib/catalog/application/readModels'
import {
  emptyStarState,
  isStarred,
  markStarred,
  mergeServerStars,
  removeLost,
  starredArticles,
  unmarkStarred,
  visibleArticles,
  type FeedTab,
  type StarState,
} from '@/lib/catalog/domain/article'
import type { GenerationLimit } from '@/lib/catalog/domain/generationLimit'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { DifficultyLevel } from '@/lib/shared/difficulty'
import { formatRetryAfter } from '@/lib/format'
import { playSfx, prepareSfx } from '@/lib/sfx'

// 生成上限超過（429）時のユーザー向けメッセージ（issue #82 / ADR-073）。次回可能時刻があれば併記する。
// 月次・日次の判定は classifyGenerationLimit（ADR-073 のフォールバック戦略）が command / query の側で済ませている。
function generationLimitMessage(limit: GenerationLimit): string {
  const when = formatRetryAfter(limit.retryAfterSeconds ?? undefined)
  const label = limit.period === 'monthly' ? '今月の生成上限' : '本日の生成上限'
  return when ? `${label}に達しました（${when}に可能）` : `${label}に達しました`
}

// Star 成功時のメッセージ（issue #164 / ADR-061）。remaining が数値の場合のみ残回数を併記する。
// remaining が null（旧 backend で未送信）の場合は従来の文言を維持する（graceful degradation）。
function starSuccessMessage(remaining: number | null): string {
  return typeof remaining === 'number'
    ? `Star しました（残り生成 ${remaining} 回）`
    : 'Star しました'
}

// Star・Dismiss・Unstar の失敗の汎用文言。server / unknown は status を併記する。
function failureToastMessage(failure: ApiFailure): string {
  return failure.kind === 'server' || failure.kind === 'unknown' ? `エラーが発生しました (${failure.status})` : 'エラーが発生しました'
}

function feedFailureMessage(failure: ApiFailure): string {
  if (failure.kind === 'network' || failure.kind === 'timeout') return 'サーバーに接続できません'
  if (failure.kind === 'unauthorized') return 'API キーが正しくありません'
  return failureToastMessage(failure)
}

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
  const queries = useCatalogQueries()
  const commands = useCatalogCommands()

  const [articles, setArticles] = useState<ReadonlyArray<ArticleCardView>>([])
  const [feedDate, setFeedDate] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  // Star の状態の合成（starredIds・サーバー一覧・楽観 star）は domain の純関数に任せる。
  // 更新は必ず前の値から作る（同時に進む操作の更新を失わないため）。
  const [starState, setStarState] = useState<StarState>(emptyStarState)
  // WHY: getStarredArticles の失敗は従来 console.error のみで不可視化していたが、
  // getFeed も同時に失敗する（オフライン・backend障害という最も一般的な形）場合、
  // Star タブが「スター済みの記事はありません」という事実と異なる空状態を表示してしまう
  // （iOS の ListDisplayState と同じく、ロード失敗と「本当に空」を同一の空状態に畳まない）。
  const [starredErrorMessage, setStarredErrorMessage] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<FeedTab>('all')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Star タブのun-star確認ダイアログ。開いている間の対象記事idをここに保持する
  // （nullなら非表示）。busy中の記事は handleUnstar 側で二重起動を防ぐ。
  const [confirmUnstarId, setConfirmUnstarId] = useState<string | null>(null)

  const fetchFeed = useCallback(async () => {
    setLoading(true)
    setErrorMessage(null)
    setStarredErrorMessage(null)
    // 1 段目はフィードの結果（starred を待たない）。古い取得（後発が走っている）は stale で、state に触れない。
    const view = await queries.getFeed()
    if (!('stale' in view)) {
      const { feed } = view
      if ('articles' in feed) {
        setArticles(feed.articles)
        // サーバ値は追加方向にのみ反映する（issue #84）。セッション内の楽観 Star を手動更新で失わないため。
        setStarState((prev) => mergeServerStars(prev, { feedStarredIds: feed.starredIds, serverStarred: null }))
        setFeedDate(feed.date)
      } else if ('failure' in feed) {
        setErrorMessage(feedFailureMessage(feed.failure))
      } else {
        setErrorMessage('予期しないエラーが発生しました')
      }
      setLoading(false)
    }

    // Star タブの一覧はサーバ側一覧（issue #84）。失敗してもフィード表示自体は壊さず、楽観 star のみで機能させる。
    const starred = await view.starred
    if ('stale' in starred) {
      // 古い取得でも原因調査のため失敗は運用ログに残す。
      if ('cause' in starred) console.error('[feed] starred一覧の取得に失敗', starred.cause)
      return
    }
    if ('articles' in starred) {
      setStarState((prev) => mergeServerStars(prev, { feedStarredIds: [], serverStarred: starred.articles }))
      setStarredErrorMessage(null)
    } else {
      console.error('[feed] starred一覧の取得に失敗', starred.cause)
      setStarredErrorMessage('スター済み記事の取得に失敗しました')
    }
  }, [queries])

  useEffect(() => {
    fetchFeed()
  }, [fetchFeed])

  function addBusy(ids: ReadonlyArray<string>) {
    setBusyIds((prev) => new Set([...prev, ...ids]))
  }

  function removeBusy(ids: ReadonlyArray<string>) {
    setBusyIds((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.delete(id))
      return next
    })
  }

  async function handleStar(id: string, difficulty?: DifficultyLevel) {
    prepareSfx()
    playSfx('swipe' as const)
    addBusy([id])
    try {
      const result = await commands.starArticle(id, difficulty)
      if (result.ok) {
        setStarState((prev) => markStarred(prev, id, articles))
        showToast(starSuccessMessage(result.value.remaining), 'success')
      } else {
        const failure = result.failure
        if (failure.kind === 'not_found') {
          showToast('記事が見つかりません', 'error')
          setArticles((prev) => prev.filter((a) => a.id !== id))
          setStarState((prev) => removeLost(prev, id))
        } else if (failure.kind === 'unauthorized') {
          showToast('API キーが正しくありません', 'error')
        } else if (failure.kind === 'generation_limit') {
          showToast(generationLimitMessage(failure.limit), 'error')
        } else {
          showToast(failureToastMessage(failure.failure), 'error')
        }
      }
    } catch {
      // WHY: 予期しない例外（TypeErrorなど）をキャッチして、ユーザーに通知する。
      // APIエラー以外の場合も適切にトースト表示して、操作失敗を明示する。
      showToast('予期しないエラーが発生しました', 'error')
    } finally {
      removeBusy([id])
    }
  }

  async function handleDismiss(id: string) {
    addBusy([id])
    try {
      const result = await commands.dismissArticle(id)
      if (result.ok) {
        setArticles((prev) => prev.filter((a) => a.id !== id))
        // WHY: Dismiss は同一セッション内の表示上の防御に過ぎない。backend の Dismiss は
        // starred_article_ids を除去しないため、starredIds は残す（Unstar とは違う）。
        setStarState((prev) => removeLost(prev, id))
      } else {
        showToast(failureToastMessage(result.failure), 'error')
      }
    } catch {
      showToast('予期しないエラーが発生しました', 'error')
    } finally {
      removeBusy([id])
    }
  }

  // WHY: busy中（既にDELETE送信中）の記事は確認ダイアログすら開かせず、二重DELETEの
  // 起点を断つ（handleUnstarConfirm 側の ignored 判定と合わせた二重防御）。
  function handleUnstar(id: string) {
    if (busyIds.has(id)) return
    setConfirmUnstarId(id)
  }

  async function handleUnstarConfirm() {
    const id = confirmUnstarId
    if (!id) return
    const pending = commands.unstarArticle(id)
    // WHY: 進行中の同じ記事への 2 回目は、busy・確認ダイアログ・toast のどれにも触れずに戻る。
    // state の更新より前に同期的に判定する（busyIds は再描画まで古く、await の後では遅い）。
    if (pending === UNSTAR_IGNORED) return
    setConfirmUnstarId(null)
    addBusy([id])
    try {
      const result = await pending
      // ignored は上で除いてある（型の絞り込み）。
      if (!('ok' in result)) return
      if (result.ok) {
        // WHY: fetchFeed の「サーバ値は追加方向にのみ反映する」（issue #84）の例外。ユーザーの
        // 明示的な un-star の成功応答には曖昧さが無いので starredIds からも除く
        // （all タブへ戻した際に star ボタンが「未star」に正しく戻るために必要）。
        setStarState((prev) => unmarkStarred(prev, id))
        showToast('スターを解除しました', 'success')
      } else {
        const failure = result.failure
        if (failure.kind === 'not_found') {
          // WHY: 記事doc自体が既に無い（handleStarの404分岐 と同型）。ローカルの全コレクションから除去する。
          showToast('記事が見つかりません', 'error')
          setArticles((prev) => prev.filter((a) => a.id !== id))
          setStarState((prev) => unmarkStarred(prev, id))
        } else if (failure.kind === 'unauthorized') {
          showToast('API キーが正しくありません', 'error')
        } else {
          showToast(failureToastMessage(failure), 'error')
        }
      }
    } catch {
      showToast('予期しないエラーが発生しました', 'error')
    } finally {
      removeBusy([id])
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

    // WHY: 一括スター中は対象記事を busy にして個別 Star/Dismiss との二重操作を防ぐ
    addBusy(idArray)
    try {
      const receipt = await commands.bulkStar(idArray)

      if (receipt.starred.length > 0) {
        setStarState((prev) => receipt.starred.reduce((state, id) => markStarred(state, id, articles), prev))
        showToast(`${receipt.starred.length}件をスターしました`, 'success')
      }

      // 失敗分を通知。生成上限（429）が含まれていれば上限メッセージを優先する（issue #82）。
      if (receipt.failed.length > 0) {
        showToast(
          receipt.limit ? generationLimitMessage(receipt.limit) : `${receipt.failed.length}件のスターに失敗しました`,
          'error',
        )
      }
    } finally {
      removeBusy(idArray)
      // 選択をクリア、選択モード終了
      setSelectedIds(new Set())
      setSelectionMode(false)
    }
  }

  function handleCancelSelection() {
    setSelectedIds(new Set())
    setSelectionMode(false)
  }

  // WHY: Star タブは Star/Dismiss/一括操作については閲覧専用（un-starのみ独立して操作可）。
  // all タブで選択モードを開始したままタブを切替えると、選択状態がそのまま持ち越されて
  // Star タブでもチェックボックス・一括スターフッターが表示されてしまい、閲覧専用の
  // ゲートを回避できてしまう（正確性レビュー指摘）。タブ切替時は選択状態を必ずリセットする。
  function handleTabChange(tab: FeedTab) {
    setActiveTab(tab)
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

  // WHY: Star タブはサーバ一覧を真実の源とし、まだ反映されていない楽観 star を追加表示する。
  // 件数・表示対象は starState から都度導出する（合成の規則は domain の article.ts）。
  const starredCount = starredArticles(starState).length
  const shownArticles = visibleArticles(activeTab, articles, starState)

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

    // WHY: Star タブはサーバ一覧を真実の源とし GET /feed に依存しないため、getFeed の失敗を
    // Star タブの表示にまで道連れにしない。errorMessage は all タブのみに適用し、Star タブは
    // starredCount / starredErrorMessage の状態（下の分岐）で独立に描画する。
    if (errorMessage && activeTab === 'all') {
      return (
        <div className="empty-state">
          <div className="empty-state-icon" aria-hidden="true">⚠</div>
          {/* issue #83: subscriptions/settings 画面と揃え、エラー本文に role="alert" を付与する */}
          <div className="empty-state-title" role="alert">{errorMessage}</div>
          <div className="empty-state-desc">右上の更新ボタンで再試行できます</div>
        </div>
      )
    }

    if (shownArticles.length === 0) {
      if (activeTab === 'starred') {
        // WHY: getStarredArticles が失敗しており表示できる楽観 star も無い場合、
        // 「スター済みの記事はありません」という事実と異なる空状態を出してはいけない
        // （ロード失敗と「本当に空」を同一の空状態に畳まない・iOS の ListDisplayState 相当）。
        // エラー表示＋再試行導線（右上の更新ボタン＝fetchFeed 再実行）を出す。
        if (starredErrorMessage) {
          return (
            <div className="empty-state">
              <div className="empty-state-icon" aria-hidden="true">⚠</div>
              <div className="empty-state-title" role="alert">{starredErrorMessage}</div>
              <div className="empty-state-desc">右上の更新ボタンで再試行できます</div>
            </div>
          )
        }
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
          {shownArticles.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              onStar={handleStar}
              onDismiss={handleDismiss}
              busy={busyIds.has(article.id)}
              starred={isStarred(starState, article.id)}
              selectionMode={selectionMode}
              isSelected={selectedIds.has(article.id)}
              onToggleSelect={handleToggleSelection}
              readOnly={activeTab === 'starred'}
              onUnstar={activeTab === 'starred' ? handleUnstar : undefined}
            />
          ))}
        </div>
        {/* WHY: Star タブは閲覧専用のため、選択モードが（切替直後の一瞬等で）true のままでも
            一括スターフッターは出さない（handleTabChange によるリセットと二重の防御）。 */}
        {selectionMode && activeTab === 'all' && (
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
          {/* WHY: Star タブでは選択して一括starする操作は成立しない（既に星済みのため）。
              all タブでのみ選択モードを開始できるようにする。 */}
          {!selectionMode && activeTab === 'all' && (
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
          onClick={() => handleTabChange('all')}
        >
          すべて <span style={tabCountStyle}>{articles.length}</span>
        </button>
        <button
          type="button"
          aria-pressed={activeTab === 'starred'}
          className={activeTab === 'starred' ? 'feed-tab active' : 'feed-tab'}
          onClick={() => handleTabChange('starred')}
        >
          ★ スター済み <span style={tabCountStyle}>{starredCount}</span>
        </button>
      </div>

      <div className="content-area">{renderContent()}</div>

      <ConfirmDialog
        isOpen={confirmUnstarId !== null}
        title="スターを解除しますか？"
        message="この記事から生成されたポッドキャストも削除されます。もう一度スターすると本日の生成回数を消費します。"
        onConfirm={handleUnstarConfirm}
        onCancel={() => setConfirmUnstarId(null)}
      />
    </>
  )
}
