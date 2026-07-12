'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createApiClient } from '@/lib/api'
import { DIFFICULTY_LABELS } from '@/components/ui/DifficultyBadge'
import type { LearningDashboard } from '@/types/index'

// 正答率（0-1）を四捨五入した % 表記へ整形する（ADR-072: quiz.average_correct_rate / trend 用）。
// 小さな用途のため lib/format.ts に切り出さず、このページに閉じる。
function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

export default function DashboardPage() {
  const [dashboard, setDashboard] = useState<LearningDashboard | null>(null)
  const [loadError, setLoadError] = useState(false)

  const loadDashboard = useCallback(async () => {
    try {
      const data = await createApiClient().getLearningDashboard()
      setDashboard(data)
      setLoadError(false)
    } catch {
      // WHY: 404（未実装）・500・ネットワーク断のいずれも同じ扱い ── ADR-072 決定5/決定8 の
      // graceful 慣習（トースト不要・前回値保持 + 再試行導線）に合わせ、settings の quota/streak
      // ローダーと同じくエラーフラグのみ立てる。dashboard を null に落とさないことで、既に
      // 表示済みの前回値を失敗した再取得で消してしまわないようにする。
      setLoadError(true)
    }
  }, [])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  function renderStreakDesc() {
    const streak = dashboard!.streak
    if (streak.last_listened_day === null) {
      return 'まだ聴取記録がありません'
    }
    if (streak.current_streak_days === 0) {
      return `連続0日・最終聴取日 ${streak.last_listened_day}`
    }
    return `${streak.current_streak_days}日連続${streak.today_listened ? '・本日分は聴取済み' : ''}`
  }

  function renderQuizSection() {
    const quiz = dashboard!.quiz
    return (
      <section className="settings-section">
        <div className="settings-section-header">
          {/* WHY rgba直書き: globals.css に --purple はあるが --purple-dim の定義はないため、
              既存の badge-hard（.1 alpha の同系色）に倣い、存在しない変数を参照せず直値で揃える */}
          <div className="settings-section-icon" style={{ background: 'rgba(155,124,248,.12)' }} aria-hidden="true">
            📝
          </div>
          <h2 className="settings-section-title">クイズ成績の推移</h2>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">クイズ済みエピソード数</div>
          <div>{quiz.quizzed_episodes}件</div>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">平均正答率</div>
          <div>{quiz.average_correct_rate === null ? '-' : formatPercent(quiz.average_correct_rate)}</div>
        </div>
        {quiz.trend.length === 0 ? (
          <div className="settings-row">
            <div className="settings-row-desc">まだクイズを受けていません</div>
          </div>
        ) : (
          quiz.trend.map((point) => (
            <div className="settings-row" key={point.graded_at}>
              <div className="settings-row-desc">{point.graded_at.slice(0, 10)}</div>
              <div>{formatPercent(point.correct_rate)}</div>
            </div>
          ))
        )}
      </section>
    )
  }

  function renderMonthlyActivitySection() {
    const activity = dashboard!.monthly_activity
    return (
      <section className="settings-section">
        <div className="settings-section-header">
          <div className="settings-section-icon" style={{ background: 'var(--teal-glow)' }} aria-hidden="true">
            📅
          </div>
          <h2 className="settings-section-title">月別活動</h2>
        </div>
        {activity.length === 0 ? (
          <div className="settings-row">
            <div className="settings-row-desc">まだ活動記録がありません</div>
          </div>
        ) : (
          activity.map((entry) => (
            <div className="settings-row" key={entry.month}>
              <div className="settings-row-label">{entry.month}</div>
              <div>{entry.active_days}日</div>
            </div>
          ))
        )}
      </section>
    )
  }

  function renderContent() {
    if (!dashboard) {
      return (
        <div className="empty-state">
          <div className="empty-state-icon" aria-hidden="true">📊</div>
          <div className="empty-state-title">
            {loadError ? '学習データを取得できませんでした' : '学習データを読み込んでいます'}
          </div>
          {loadError && <div className="empty-state-desc">しばらくしてから再度お試しください</div>}
        </div>
      )
    }

    const difficultyLabel = DIFFICULTY_LABELS[dashboard.current_difficulty] ?? dashboard.current_difficulty

    return (
      <>
        {/* ADR-072 決定8: 表示済みデータがある状態での再取得失敗は、ページを空にせず
            小さなインライン通知に留める（settings の quota/streak バナーと同じ意図）。
            再試行導線は page-header の共通ボタンを再利用するため、ここではボタンを重複させない。 */}
        {loadError && (
          <div className="settings-row-desc form-error" role="alert" style={{ padding: '0 0 12px' }}>
            最新のデータ取得に失敗しました。前回のデータを表示しています。
          </div>
        )}

        <section className="settings-section">
          <div className="settings-section-header">
            <div className="settings-section-icon" style={{ background: 'var(--amber-dim)' }} aria-hidden="true">
              🔥
            </div>
            <h2 className="settings-section-title">連続聴取日数</h2>
          </div>
          <div className="settings-row">
            <div className="settings-row-desc">{renderStreakDesc()}</div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-header">
            <div className="settings-section-icon" style={{ background: 'var(--teal-glow)' }} aria-hidden="true">
              🎧
            </div>
            <h2 className="settings-section-title">学習の蓄積</h2>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">生成済みエピソード数</div>
            <div>{dashboard.total_episodes}</div>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">習得語彙数</div>
            <div>{dashboard.vocabulary_acquired}</div>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">現在の難易度</div>
            <div>{difficultyLabel}</div>
          </div>
        </section>

        {renderQuizSection()}
        {renderMonthlyActivitySection()}
      </>
    )
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">ダッシュボード</div>
          <div className="page-subtitle">学習の進捗をまとめて確認できます</div>
        </div>
        {/* ADR-072 決定8: 初回失敗（空状態）・成功後の再取得失敗のどちらでも同じボタンで
            再試行できるようにする（settings の再試行ボタンと同じ btn-ghost 慣習）。
            初回ロード中（dashboard も loadError も無い状態）は再試行対象が無いため非表示。 */}
        {(dashboard !== null || loadError) && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void loadDashboard()}
            aria-label="ダッシュボードを再読み込み"
          >
            再試行
          </button>
        )}
      </div>

      <div className="content-area">{renderContent()}</div>
    </>
  )
}
