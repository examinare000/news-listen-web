'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useToast } from '@/components/ui/Toast'
import { ArticleCard } from '@/components/ArticleCard'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { createApiClient, ApiError } from '@/lib/api'
import { formatRetryAfter } from '@/lib/format'
import { playSfx, prepareSfx } from '@/lib/sfx'
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
  // Star タブの真実の源（issue #84 → backend feed 除外移行）。backend が GET /feed から
  // star 済み記事を恒久除外するため、フィード応答からは star 済み記事の実体を得られない。
  const [serverStarred, setServerStarred] = useState<Article[]>([])
  // WHY: getStarredArticles の失敗は従来 console.error のみで不可視化していたが、
  // getFeed も同時に失敗する（オフライン・backend障害という最も一般的な形）場合、
  // Star タブが「スター済みの記事はありません」という事実と異なる空状態を表示してしまう
  // （iOS の ListDisplayState と同じく、ロード失敗と「本当に空」を同一の空状態に畳まない）。
  const [starredErrorMessage, setStarredErrorMessage] = useState<string | null>(null)
  // WHY: セッション内で楽観 star した記事の実体スナップショット。`articles` から都度
  // 導出すると、リフレッシュで backend が該当記事を feed から除外した瞬間に articles から
  // 消え、まだ serverStarred（サーバ側インデックス）に反映される前の楽観 star が Star タブから
  // 消えてしまう（正確性レビュー指摘）。star した時点の記事オブジェクトをここに保持し、
  // articles の現在の中身に依存せず Star タブへ表示し続ける。
  const [optimisticStarred, setOptimisticStarred] = useState<Article[]>([])
  const [activeTab, setActiveTab] = useState<FeedTab>('all')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Star タブのun-star確認ダイアログ。開いている間の対象記事idをここに保持する
  // （nullなら非表示）。busy中の記事は handleUnstar 側で二重起動を防ぐ。
  const [confirmUnstarId, setConfirmUnstarId] = useState<string | null>(null)
  // WHY: ConfirmDialogの「確認」ボタンの連続クリックがReactの再レンダー確定前に
  // 2回処理されると、同一レンダーのclosureが読む busyIds state はまだ更新前の値の
  // ままのため、handleUnstarConfirm内で `busyIds.has(id)` を見るだけでは2回目の
  // 呼び出しを止められない（stateはバッチ更新されるため、同一tick内の2回目の
  // 呼び出し時点ではまだ反映されていない）。ref は再レンダーを介さず同期的に
  // 可視化されるため、真の排他制御にはこちらを用いる。busyIds state 自体は
  // ボタンのdisabled表示用に引き続き使う。
  const unstarInFlightRef = useRef<Set<string>>(new Set())

  // WHY: 手動更新の連打・マウント直後の再取得等でリクエストが入れ替わって完了すると、
  // 後発（新しい）リクエストの反映後に先発（古い）リクエストの応答が遅れて届き、
  // 最新表示を上書きしてしまう（settings/page.tsx の issue #164 パターンと同じ問題）。
  // リクエスト連番で最新リクエストの応答のみを反映し、stale な応答は無視する。
  const fetchRequestIdRef = useRef(0)

  const fetchFeed = useCallback(async () => {
    const requestId = ++fetchRequestIdRef.current
    setLoading(true)
    setErrorMessage(null)
    setStarredErrorMessage(null)
    const api = createApiClient()
    // Star タブの一覧はサーバ側一覧（issue #84 → backend feed 除外移行）。フィード取得と
    // 並行で取りに行く。失敗してもフィード表示自体は壊さず、楽観 star のみで機能させる
    // （backend 側の一時的な不調でフィード全体が見られなくなるのを避けるため）。
    // WHY: catch はここで即座に（同期的に）アタッチし、成功/失敗を判別可能な結果オブジェクトへ
    // 正規化する。await を後段まで遅延させつつ catch だけ先に付けないと、getFeed 側の await 中に
    // このPromiseが reject した場合に unhandled rejection になり得るため。
    const starredPromise = api
      .getStarredArticles()
      .then((result) => ({
        ok: true as const,
        // WHY: 移行期・プロキシ経由で 200 かつ想定外の body（例: 未スタブ経路の catch-all が
        // 返す {}）が来ても articles が配列であることを確定させ、画面全体を壊さない
        // （is_starred が undefined の場合を「未対応 backend」として許容する既存の防御姿勢と同型）。
        articles: Array.isArray(result.articles) ? result.articles : [],
      }))
      .catch((e) => {
        // WHY: getFeed 単独失敗時はフィード全体を壊さず楽観 starのみで継続するが、原因調査の
        // ため運用ログには残す（getFeed 側の失敗はユーザー向け errorMessage で可視化される
        // のに対し、こちらはサイレントすぎるという指摘への対応）。加えて、getFeed も同時に
        // 失敗する（オフライン・backend障害）場合は、Star タブが「スター済みの記事は
        // ありません」という事実と異なる空状態を表示しないよう、失敗を starredErrorMessage
        // として可視化する（iOS の ListDisplayState 相当・正確性レビュー指摘）。
        console.error('[feed] starred一覧の取得に失敗', e)
        return { ok: false as const }
      })
    try {
      const data = await api.getFeed()
      if (requestId !== fetchRequestIdRef.current) return // stale: 後発リクエストが既に走っている
      setArticles(data.articles)
      // サーバ値は追加方向にのみ反映する（issue #84）。undefined = 未対応 backend の可能性があり、
      // 明示 false と区別できないため解除はしない。セッション内の楽観 Star を手動更新で失わないため。
      setStarredIds((prev) => {
        const next = new Set(prev)
        for (const a of data.articles) {
          if (a.is_starred) next.add(a.id)
        }
        return next
      })
      setFeedDate(data.date ?? null)
    } catch (err) {
      if (requestId !== fetchRequestIdRef.current) return // stale
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
      if (requestId === fetchRequestIdRef.current) {
        setLoading(false)
      }
    }

    const starredOutcome = await starredPromise
    if (requestId === fetchRequestIdRef.current) {
      if (starredOutcome.ok) {
        setServerStarred(starredOutcome.articles)
        setStarredErrorMessage(null)
      } else {
        setStarredErrorMessage('スター済み記事の取得に失敗しました')
      }
    }
  }, [])

  useEffect(() => {
    fetchFeed()
  }, [fetchFeed])

  // WHY: star 済み記事のオブジェクトを楽観セットへ追加する。articles 中に見つからない場合
  // （既に一覧から消えている等）は何もしない。
  function addOptimisticStarred(id: string) {
    setOptimisticStarred((prev) => {
      if (prev.some((a) => a.id === id)) return prev
      const original = articles.find((a) => a.id === id)
      return original ? [...prev, original] : prev
    })
  }

  // WHY: 記事が一覧から完全に失われた（Dismiss成功・Star404・Unstar成功/404）場合、
  // serverStarred / optimisticStarred からもクライアント側で除去する。ただし
  // Dismiss経路については、これは同一セッション内の表示上の防御に過ぎない。backend の
  // Dismiss は starred_article_ids を除去せず、/articles/starred も dismissed 済みを
  // フィルタしないため、次回リフレッシュで serverStarred がサーバ応答（この記事を含む）で
  // 丸ごと置き換わると再び表示され得る。一方 Unstar（DELETE /articles/{id}/star）は
  // backend側で永続的に解除するため、この経路では再表示されない。
  function removeFromStarredCollections(id: string) {
    setServerStarred((prev) => prev.filter((a) => a.id !== id))
    setOptimisticStarred((prev) => prev.filter((a) => a.id !== id))
  }

  async function handleStar(id: string, difficulty?: DifficultyLevel) {
    prepareSfx()
    playSfx('swipe' as const)
    setBusyIds((prev) => new Set(prev).add(id))
    try {
      // difficulty 未指定時は明示的な undefined を渡さず、従来どおり id のみで呼ぶ
      // （後方互換・starArticle 側の「省略時はボディなし」契約と合わせる）
      const api = createApiClient()
      const res = difficulty ? await api.starArticle(id, difficulty) : await api.starArticle(id)
      setStarredIds((prev) => new Set(prev).add(id))
      addOptimisticStarred(id)
      showToast(starSuccessMessage(res.remaining), 'success')
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404) {
          showToast('記事が見つかりません', 'error')
          setArticles((prev) => prev.filter((a) => a.id !== id))
          removeFromStarredCollections(id)
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
      removeFromStarredCollections(id)
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

  // WHY: busy中（既にDELETE送信中）の記事は確認ダイアログすら開かせず、二重DELETEの
  // 起点を断つ（handleUnstarConfirm 側の unstarInFlightRef ガードと合わせた二重防御）。
  function handleUnstar(id: string) {
    if (busyIds.has(id)) return
    setConfirmUnstarId(id)
  }

  async function handleUnstarConfirm() {
    const id = confirmUnstarId
    if (!id) return
    // WHY: ConfirmDialogの「確認」ボタンはbusyIdsに連動して無効化されない
    // （ArticleCard側のスター解除ボタンとは別コンポーネント）。連続クリックが
    // Reactの再レンダー確定前に2回処理されると、この関数が同じidで2回走り、
    // 二重DELETEが送信され得る。busyIds（state）はバッチ更新されるため同一tick内の
    // 2回目の呼び出しには反映が間に合わず、state だけのガードでは防げない
    // （実測: state のみのガードでは2回とも通過し、実際に2回送信されることを
    // テストで確認した）。unstarInFlightRef（同期的に可視のref）で真の排他制御をする。
    if (unstarInFlightRef.current.has(id)) return
    unstarInFlightRef.current.add(id)
    setConfirmUnstarId(null)
    setBusyIds((prev) => new Set(prev).add(id))
    try {
      await createApiClient().unstarArticle(id)
      // WHY: setStarredIds からの削除は、fetchFeed 内の「サーバ値は追加方向にのみ反映する」
      // （issue #84）というルールの例外である。あのルールは undefined = 未対応backendの曖昧さに対する防御だが、
      // ここはユーザーの明示的なun-star操作の成功応答であり曖昧さが無いため、削除して良い
      // （all タブへ戻した際に star ボタンが「未star」に正しく戻るために必要）。
      setStarredIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      removeFromStarredCollections(id)
      showToast('スターを解除しました', 'success')
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404) {
          // WHY: 記事doc自体が既に無い（handleStarの404分岐 と同型）。ローカルの
          // 全コレクションから除去し、以後の操作対象から外す。
          showToast('記事が見つかりません', 'error')
          setArticles((prev) => prev.filter((a) => a.id !== id))
          setStarredIds((prev) => {
            const next = new Set(prev)
            next.delete(id)
            return next
          })
          removeFromStarredCollections(id)
        } else if (err.status === 401) {
          showToast('API キーが正しくありません', 'error')
        } else {
          showToast(`エラーが発生しました (${err.status})`, 'error')
        }
      } else {
        showToast('予期しないエラーが発生しました', 'error')
      }
    } finally {
      unstarInFlightRef.current.delete(id)
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
        successful.forEach((id) => addOptimisticStarred(id))
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

  // WHY: Star タブは Star/Dismiss/一括操作については閲覧専用（un-starのみ独立して操作可）。
  // all タブで選択モードを開始したままタブを切替えると、選択状態がそのまま持ち越されて
  // Star タブでもチェックボックス・一括スターフッターが表示されてしまい、閲覧専用の
  // ゲートを回避できてしまう（正確性レビュー指摘）。タブ切替時は選択状態を必ずリセットする。
  function handleTabChange(tab: FeedTab) {
    setActiveTab(tab)
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

  // WHY: Star タブはサーバ一覧（serverStarred）を真実の源とし、まだサーバに反映されていない
  // セッション内の楽観 star（optimisticStarred。star した時点のスナップショットのため、
  // 後続の GET /feed 応答から当該記事が消えても保持され続ける）を追加表示する
  // （サーバ一覧 ∪ 楽観追加。サーバ項目を先頭にしてidでdedup）。
  // 件数・表示対象はこれらから都度導出する。Dismiss（成功時）・Star の 404・Unstar
  // （成功時/404）の各除去パスでは removeFromStarredCollections() が
  // serverStarred/optimisticStarred 双方から除去する。Dismiss経路はクライアント側のみの
  // 防御である。backend の Dismiss は starred_article_ids を除去せず、/articles/starred も
  // dismissed 済みをフィルタしないため、dismiss 済みでも star 済みの記事は次回リフレッシュ時に
  // サーバ応答へ再び含まれ得る。一方 Unstar は backend側で永続的に解除するため、
  // Star タブ内からの明示的な除去操作として成立する。
  const serverStarredIds = new Set(serverStarred.map((a) => a.id))
  const optimisticOnlyStarred = optimisticStarred.filter((a) => !serverStarredIds.has(a.id))
  const starredArticles = [...serverStarred, ...optimisticOnlyStarred]
  const visibleArticles = activeTab === 'starred' ? starredArticles : articles
  // WHY: サーバ由来の starred 項目は starredIds（楽観セット）に無くても真に star 済みのため、
  // ArticleCard の star ボタン状態はこの合成集合で判定する（starredIds 自体は変更しない）。
  const isStarred = (id: string) => starredIds.has(id) || serverStarredIds.has(id)

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
    // starredArticles / starredErrorMessage の状態（下の分岐）で独立に描画する。
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

    if (visibleArticles.length === 0) {
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
          {visibleArticles.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              onStar={handleStar}
              onDismiss={handleDismiss}
              busy={busyIds.has(article.id)}
              starred={isStarred(article.id)}
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
          ★ スター済み <span style={tabCountStyle}>{starredArticles.length}</span>
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
