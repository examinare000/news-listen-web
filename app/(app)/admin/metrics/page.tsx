'use client'

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { createApiClient, ApiError } from '@/lib/api'
import type { MetricsSnapshot } from '@/types/index'

// 欠落値の表示（backend は数値フィールドは常に返す契約だが、rate 系は分母0で null になり得る
// ため、また不測のスキーマ変化に備え、常に defensive に描画する・ADR-075）。
const DASH = '—'

function formatPercent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return DASH
  return `${Math.round(rate * 100)}%`
}

function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return DASH
  return String(n)
}

// 週次 Star の平均値は非整数（例: 5.264）になり得るため、生の桁をそのまま出さず
// 小数第1位に丸めて表示する（formatNumber は eligible/retained 等の整数カウント用に維持）。
function formatAverage(n: number | null | undefined): string {
  if (n === null || n === undefined) return DASH
  return n.toFixed(1)
}

// 管理者向け read-only リテンション計測ダッシュボード（ADR-075 決定E1）。
// C0 ゲート「D30 継続率 ≥30% かつ 完聴率 ≥50%」の判定に必要な KPI を中心に表示する。
// AdminUsersPage と同じ認証ゲート様式（useAuth・isAdmin・useEffect ロード）を踏襲する。
// GET /admin/metrics はラッパー無しでスナップショットを直接返し、指定日（省略時は当日）に
// 集計が無ければ 404 を返す契約（backend api/schemas.py 確定版）。
export default function AdminMetricsPage() {
  const { user, status } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)

  const reload = useCallback(async () => {
    setLoadError(false)
    setNotFound(false)
    try {
      const data = await createApiClient().getMetrics()
      setMetrics(data)
    } catch (err) {
      setMetrics(null)
      // 404 = 指定日のスナップショット未生成（集計ジョブ未実行・rollout 直後）。
      // エラーではなく「まだデータが無い」正常系として扱う（ADR-075 決定E1）。
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true)
      } else {
        setLoadError(true)
      }
    } finally {
      setHasLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (status === 'authenticated' && isAdmin) {
      void reload()
    }
  }, [status, isAdmin, reload])

  if (status === 'authenticated' && !isAdmin) {
    return (
      <div className="content-area content-narrow">
        <div className="page-header">
          <h1 className="page-title">計測ダッシュボード</h1>
        </div>
        <p className="form-error">この画面は管理者のみ利用できます。</p>
        <Link className="btn btn-ghost" href="/settings">
          設定へ戻る
        </Link>
      </div>
    )
  }

  function renderContent() {
    if (loadError) {
      return <p className="form-error">計測データの取得に失敗しました</p>
    }

    if (!hasLoaded) {
      return <p className="settings-row-desc">読み込み中…</p>
    }

    if (notFound || !metrics) {
      return (
        <div className="empty-state">
          <div className="empty-state-icon" aria-hidden="true">📊</div>
          <div className="empty-state-title">集計データがまだありません</div>
          <div className="empty-state-desc">集計ジョブの初回実行後に表示されます</div>
        </div>
      )
    }

    // backend との契約は確定済みだが、不測のスキーマ変化で壊れないよう optional chaining を使う。
    const { d7, completion, weekly_star: weeklyStar } = metrics
    const d30 = metrics.d30

    return (
      <>
        <section className="settings-section">
          <div className="settings-section-header">
            <h2 className="settings-section-title">コホート継続率</h2>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">D7 継続率</div>
            <div>
              <span>{formatPercent(d7?.rate)}</span>
              <span className="settings-row-desc">（{formatNumber(d7?.retained)}/{formatNumber(d7?.eligible)}）</span>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">D30 継続率</div>
            <div>
              <span>{formatPercent(d30?.rate)}</span>
              <span className="settings-row-desc">（{formatNumber(d30?.retained)}/{formatNumber(d30?.eligible)}）</span>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-header">
            <h2 className="settings-section-title">エピソード完聴率</h2>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">完聴率（聴取開始比・primary）</div>
            <div>{formatPercent(completion?.rate_started)}</div>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">完聴率（配信済み比・secondary）</div>
            <div>{formatPercent(completion?.rate_delivered)}</div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-header">
            <h2 className="settings-section-title">週次 Star 数</h2>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">アクティブユーザーあたり平均</div>
            <div>{formatAverage(weeklyStar?.avg_per_active_user)}</div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-header">
            <h2 className="settings-section-title">集計日</h2>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">集計日</div>
            <div>{metrics.date}</div>
          </div>
        </section>
      </>
    )
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">計測ダッシュボード</h1>
          <div className="page-subtitle">C0 ゲート判定用のリテンション・完聴率（管理者のみ）</div>
        </div>
      </div>

      <div className="content-area content-narrow">{renderContent()}</div>
    </>
  )
}
