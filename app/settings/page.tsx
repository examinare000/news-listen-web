'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '@/contexts/AppContext'
import { PLAYBACK_SPEEDS } from '@/hooks/useAudioPlayer'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { useToast } from '@/components/ui/Toast'
import { createApiClient, ApiError } from '@/lib/api'
import { KEY_DEFAULT_PLAYBACK_SPEED } from '@/lib/config'
import { DIFFICULTY_LABELS } from '@/components/ui/DifficultyBadge'
import { AccountSection } from '@/components/ui/AccountSection'
import { PushNotificationSection } from '@/components/PushNotificationSection'
import { DEFAULT_DIFFICULTY } from '@/types/index'
import type { DifficultyLevel, GenerationQuota } from '@/types/index'

type TimeFormat = 'absolute' | 'relative'

const DIFFICULTY_OPTIONS: Array<DifficultyLevel> = [
  'toeic_600',
  'toeic_900',
  'ielts_55',
  'ielts_7',
  'eiken_2',
  'eiken_p1',
]

export default function SettingsPage() {
  const { state, dispatch, setTimeFormat } = useApp()
  const { showToast } = useToast()

  const [defaultSpeed, setDefaultSpeed] = useLocalStorage<number>(KEY_DEFAULT_PLAYBACK_SPEED, 1.0)
  const [defaultDifficulty, setDefaultDifficulty] = useState<DifficultyLevel>(DEFAULT_DIFFICULTY)
  // issue #164: 設定読み込み失敗をサイレントにせず、トースト + 再試行導線を出すための状態。
  const [preferencesLoadError, setPreferencesLoadError] = useState(false)

  // Load preferences on mount (C群#13)
  const loadPreferences = useCallback(async () => {
    try {
      const prefs = await createApiClient().getPreferences()
      setDefaultDifficulty(prefs.default_difficulty)
      setPreferencesLoadError(false)
    } catch {
      // Fallback to DEFAULT_DIFFICULTY if fetch fails
      setDefaultDifficulty(DEFAULT_DIFFICULTY)
      setPreferencesLoadError(true)
      showToast('設定の読み込みに失敗しました', 'error')
    }
  }, [showToast])

  useEffect(() => {
    void loadPreferences()
  }, [loadPreferences])

  // issue #164 / ADR-061: 生成残回数の可視化。
  const [quota, setQuota] = useState<GenerationQuota | null>(null)
  const [quotaLoadError, setQuotaLoadError] = useState(false)

  const loadQuota = useCallback(async () => {
    try {
      const q = await createApiClient().getGenerationQuota()
      setQuota(q)
      setQuotaLoadError(false)
    } catch (err) {
      // WHY: 404（エンドポイント未実装）時は graceful degradation — quota セクション全体を非表示。
      // 404 以外（500・ネットワーク等）はエラーバナーを表示して再試行導線を出す。
      if (err instanceof ApiError && err.status === 404) {
        setQuota(null)
        setQuotaLoadError(false)
      } else {
        setQuotaLoadError(true)
      }
    }
  }, [])

  useEffect(() => {
    void loadQuota()
  }, [loadQuota])

  // WHY: 2連続変更でレスポンス順が入れ替わると、後勝ちした保存成功後に先行の失敗が
  // サーバー保存済み値を上書きする可能性がある。リクエスト連番で最新リクエストの結果のみを
  // UI に反映し、stale な応答は無視する。
  const difficultyRequestIdRef = useRef(0)

  // Handle difficulty change (C群#13)
  async function handleDifficultyChange(newDifficulty: DifficultyLevel) {
    // issue #164: 保存失敗時にサーバー側の値へ戻せるよう、変更前の値を保持しておく。
    const previousDifficulty = defaultDifficulty
    setDefaultDifficulty(newDifficulty)

    // リクエスト連番を増加
    const requestId = ++difficultyRequestIdRef.current

    try {
      await createApiClient().updatePreferences({ default_difficulty: newDifficulty })
      // 最新リクエストの場合のみ UI に反映（stale な成功は無視）
      if (requestId === difficultyRequestIdRef.current) {
        // 成功時は UI をそのまま保持（既に newDifficulty に更新済み）
      }
    } catch {
      // 最新リクエストの場合のみロールバック（stale な失敗は無視）
      if (requestId === difficultyRequestIdRef.current) {
        // サイレント失敗を廃止: 保存失敗をユーザーに伝え、UI をサーバー確認済みの値へ戻す。
        setDefaultDifficulty(previousDifficulty)
        showToast('難易度設定の保存に失敗しました', 'error')
      }
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">設定</h1>
          <div className="page-subtitle">アプリの動作をカスタマイズ</div>
        </div>
      </div>

      {/* WHY content-narrow（680px 統一）: デザイン正本はインライン 600px だが、
          詳細ページと共通のユーティリティに寄せてインラインスタイルを排除する。
          80px の差は読み幅制限という視覚言語を変えない */}
      <div className="content-area content-narrow">
        {/* セクション 0: アカウント（ログイン・プロフィール・パスワード） */}
        <AccountSection />

        {/* セクション 1: 表示設定 */}
        <section className="settings-section">
          <div className="settings-section-header">
            <div className="settings-section-icon" style={{ background: 'var(--blue-dim)' }} aria-hidden="true">
              📄
            </div>
            <h2 className="settings-section-title">表示設定</h2>
          </div>

          <div className="settings-row">
            <div>
              <label className="settings-row-label" htmlFor="time-format">
                記事の日付表記
              </label>
              <div className="settings-row-desc">記事一覧の日付を絶対表記または相対表記で表示</div>
            </div>
            <select
              id="time-format"
              className="select-input"
              value={state.timeFormat}
              onChange={(e) => setTimeFormat(e.target.value as TimeFormat)}
            >
              <option value="absolute">絶対表記（M/D HH:MM）</option>
              <option value="relative">相対表記（3時間前）</option>
            </select>
          </div>
        </section>

        {/* セクション 2: Podcast 生成 */}
        <section className="settings-section">
          <div className="settings-section-header">
            <div className="settings-section-icon" style={{ background: 'var(--amber-dim)' }} aria-hidden="true">
              🎙️
            </div>
            <h2 className="settings-section-title">Podcast 生成</h2>
          </div>

          {/* 生成残回数の可視化（issue #164 / ADR-061）。limit=0 は無制限のため行ごと非表示にする。 */}
          {quotaLoadError ? (
            <div className="settings-row-desc form-error" role="alert" style={{ padding: '0 20px 12px' }}>
              残り生成回数の取得に失敗しました。
              <button
                className="btn btn-ghost"
                onClick={() => loadQuota()}
                aria-label="残り生成回数を再読み込み"
                style={{ marginLeft: 8 }}
              >
                再試行
              </button>
            </div>
          ) : (
            quota &&
            quota.limit > 0 && (
              <div className="settings-row">
                <div>
                  <div className="settings-row-label">本日の残り生成回数</div>
                  <div className="settings-row-desc">
                    {quota.remaining ?? 0} / {quota.limit} 回
                  </div>
                </div>
              </div>
            )
          )}

          <div className="settings-row">
            <div>
              <label className="settings-row-label" htmlFor="default-speed">
                デフォルト再生速度
              </label>
              <div className="settings-row-desc">初期再生速度（0.5x 〜 2.5x）</div>
            </div>
            {/* D21: デザインの連続値スライダーは採用せず、既存の 8 段階セレクトを維持 */}
            <select
              id="default-speed"
              className="select-input"
              value={defaultSpeed}
              onChange={(e) => {
                const speed = Number(e.target.value)
                setDefaultSpeed(speed)
                // Reflect the new default speed in AppContext so AudioPlayerBar
                // selector and subsequent playback pick it up immediately (spec §10.5).
                dispatch({ type: 'SET_SPEED', speed })
              }}
            >
              {PLAYBACK_SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}x
                </option>
              ))}
            </select>
          </div>

          {/* C群#13: デフォルト難易度設定（サーバー同期） */}
          <div className="settings-row">
            <div>
              <label className="settings-row-label" htmlFor="default-difficulty">
                デフォルト難易度
              </label>
              <div className="settings-row-desc">新規生成 Podcast の推奨難易度を選択</div>
            </div>
            <select
              id="default-difficulty"
              className="select-input"
              value={defaultDifficulty}
              onChange={(e) => handleDifficultyChange(e.target.value as DifficultyLevel)}
            >
              {DIFFICULTY_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {DIFFICULTY_LABELS[d]}
                </option>
              ))}
            </select>
          </div>

          {preferencesLoadError && (
            <div className="settings-row-desc form-error" style={{ padding: '0 20px 12px' }}>
              設定の読み込みに失敗しました。
              <button
                className="btn btn-ghost"
                onClick={() => loadPreferences()}
                aria-label="設定を再読み込み"
                style={{ marginLeft: 8 }}
              >
                再試行
              </button>
            </div>
          )}
        </section>


        {/* セクション 3: プッシュ通知 */}
        <PushNotificationSection />
      </div>
    </>
  )
}
