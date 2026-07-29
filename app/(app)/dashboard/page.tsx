'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { createApiClient } from '@/lib/api'
import { DIFFICULTY_LABELS } from '@/components/ui/DifficultyBadge'
import { useToast } from '@/components/ui/Toast'
import { playSfx } from '@/lib/sfx'
import type {
  LearningDashboard,
  VocabularyListResponse,
  VocabularyTestSessionResponse,
} from '@/types/index'

const ACHIEVEMENT_CATALOG = [
  { id: 'first_episode_completed', name: '初回エピソード完聴', description: 'はじめてエピソードを最後まで聴く' },
  { id: 'first_quiz_correct', name: '初回クイズ正解', description: 'はじめて理解度クイズに正解する' },
  { id: 'streak_7', name: '7 日連続聴取', description: '7 日間連続で聴く' },
  { id: 'streak_30', name: '30 日連続聴取', description: '30 日間連続で聴く' },
  { id: 'streak_100', name: '100 日連続聴取', description: '100 日間連続で聴く' },
  { id: 'completed_10', name: '累計 10 本完聴', description: 'エピソードを累計 10 本聴き終える' },
  { id: 'completed_50', name: '累計 50 本完聴', description: 'エピソードを累計 50 本聴き終える' },
] as const

// 正答率（0-1）を四捨五入した % 表記へ整形する（ADR-072: quiz.average_correct_rate / trend 用）。
// 小さな用途のため lib/format.ts に切り出さず、このページに閉じる。
function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

export default function DashboardPage() {
  const { showToast } = useToast()
  const [dashboard, setDashboard] = useState<LearningDashboard | null>(null)
  const [vocabulary, setVocabulary] = useState<VocabularyListResponse | null>(null)
  const [testSession, setTestSession] = useState<VocabularyTestSessionResponse | null>(null)
  const [loadError, setLoadError] = useState(false)

  const loadDashboard = useCallback(async () => {
    const client = createApiClient()
    const [dashboardResult, vocabularyResult, sessionResult] = await Promise.allSettled([
      client.getLearningDashboard(),
      client.getVocabulary?.(),
      client.getVocabularyTestSession?.(),
    ])

    if (dashboardResult.status === 'fulfilled') {
      const data = dashboardResult.value
      const seenIdsJson = typeof window !== 'undefined' ? localStorage.getItem('seen_achievement_ids') : null
      const seenIds = seenIdsJson ? JSON.parse(seenIdsJson) as string[] : []
      const seenIdsSet = new Set(seenIds)

      const newlyUnlockedAndUnseen = data.achievements.filter(
        (achievement) => !seenIdsSet.has(achievement.id),
      )
      if (newlyUnlockedAndUnseen.length > 0) {
        playSfx('achievement')
        for (const achievement of newlyUnlockedAndUnseen) {
          const catalogEntry = ACHIEVEMENT_CATALOG.find((item) => item.id === achievement.id)
          if (catalogEntry) {
            showToast(`実績を解錠しました：${catalogEntry.name}`, 'success')
          }
          seenIdsSet.add(achievement.id)
        }
        if (typeof window !== 'undefined') {
          localStorage.setItem('seen_achievement_ids', JSON.stringify(Array.from(seenIdsSet)))
        }
      }
      setDashboard(data)
      setLoadError(false)
    } else {
      // WHY: 404（未実装）・500・ネットワーク断のいずれも同じ扱い ── ADR-072 決定5/決定8 の
      // graceful 慣習（トースト不要・前回値保持 + 再試行導線）に合わせ、settings の quota/streak
      // ローダーと同じくエラーフラグのみ立てる。dashboard を null に落とさないことで、既に
      // 表示済みの前回値を失敗した再取得で消してしまわないようにする。
      setLoadError(true)
    }

    if (vocabularyResult.status === 'fulfilled' && vocabularyResult.value) {
      setVocabulary(vocabularyResult.value)
    }
    if (sessionResult.status === 'fulfilled' && sessionResult.value) {
      setTestSession(sessionResult.value)
    }
  }, [showToast])

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
          {/* WHY teal-glow トークン: Editorial 整合のため青グレー背景を統一 */}
          <div className="settings-section-icon" style={{ background: 'var(--teal-glow)' }} aria-hidden="true">
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
            <div className="engagement-bar-row" key={entry.month}>
              <div className="engagement-bar-copy">
                <span>{entry.month}</span>
                <span>{entry.active_days}日</span>
              </div>
              <div
                className="engagement-meter"
                role="meter"
                aria-label={`${entry.month}の活動日数`}
                aria-valuemin={0}
                aria-valuemax={31}
                aria-valuenow={entry.active_days}
              >
                <span style={{ transform: `scaleX(${Math.min(entry.active_days / 31, 1)})` }} />
              </div>
            </div>
          ))
        )}
      </section>
    )
  }

  function renderWeeklyGoalSection() {
    const weeklyGoal = dashboard?.weekly_goal
    if (!weeklyGoal) return null
    return (
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="settings-section-title">今週の進捗</h2>
        </div>
        <div className="weekly-progress">
          <p className="weekly-progress-copy">
            今週 {weeklyGoal.completed_this_week}/{weeklyGoal.goal_episodes} 本
          </p>
          <div
            className="engagement-meter weekly"
            role="meter"
            aria-label="今週の学習目標進捗"
            aria-valuemin={0}
            aria-valuemax={weeklyGoal.goal_episodes}
            aria-valuenow={weeklyGoal.completed_this_week}
          >
            <span
              style={{
                transform: `scaleX(${Math.min(
                  weeklyGoal.completed_this_week / weeklyGoal.goal_episodes,
                  1,
                )})`,
              }}
            />
          </div>
        </div>
        {weeklyGoal.history.length > 0 ? (
          <div className="weekly-history" aria-label="週次履歴">
            {weeklyGoal.history.map((record) => (
              <div className="engagement-bar-row" key={record.week}>
                <div className="engagement-bar-copy">
                  <span>{record.week}</span>
                  <span>目標: {record.goal} → 実績: {record.completed}</span>
                </div>
                <div
                  className="engagement-meter"
                  role="meter"
                  aria-label={`${record.week}の実績`}
                  aria-valuemin={0}
                  aria-valuemax={Math.max(record.goal, record.completed, 1)}
                  aria-valuenow={record.completed}
                >
                  <span
                    style={{
                      transform: `scaleX(${Math.min(record.completed / Math.max(record.goal, 1), 1)})`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    )
  }

  function renderAchievementsSection() {
    const achievements = dashboard?.achievements
    if (!achievements) return null
    const unlockedById = new Map(
      achievements.map((achievement) => [achievement.id, achievement]),
    )
    return (
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="settings-section-title">実績</h2>
        </div>
        <div className="achievement-list">
          {ACHIEVEMENT_CATALOG.map((catalogItem) => {
            const unlocked = unlockedById.get(catalogItem.id)
            return (
              <article
                key={catalogItem.id}
                className={unlocked ? 'achievement-item unlocked' : 'achievement-item locked'}
              >
                <div>
                  <h3>{catalogItem.name}</h3>
                  <p>{catalogItem.description}</p>
                </div>
                {unlocked && <span>解錠: {unlocked.unlocked_at}</span>}
              </article>
            )
          })}
        </div>
      </section>
    )
  }

  function renderVocabularySection() {
    if (!vocabulary) return null
    return (
      <section className="settings-section">
        <div className="settings-section-header dashboard-section-heading">
          <div>
            <h2 className="settings-section-title">登録語彙</h2>
            <p className="settings-row-desc">{vocabulary.count} 語</p>
          </div>
          {testSession && testSession.items.length > 0 ? (
            <Link href="/vocabulary-test" className="btn btn-primary">
              単語テスト
            </Link>
          ) : null}
        </div>
        {vocabulary.vocabulary.slice(0, 5).map((item) => (
          <div className="settings-row vocabulary-row" key={item.vocabulary_id}>
            <div>
              <div className="settings-row-label">{item.term}</div>
              <div className="settings-row-desc">{item.meaning}</div>
            </div>
            <time dateTime={item.registered_at}>{item.registered_at.slice(0, 10)}</time>
          </div>
        ))}
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

        {renderWeeklyGoalSection()}
        {renderVocabularySection()}
        {renderAchievementsSection()}
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
