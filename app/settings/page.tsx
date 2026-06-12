'use client'

import React, { useState } from 'react'
import { useApp } from '@/contexts/AppContext'
import { PLAYBACK_SPEEDS } from '@/hooks/useAudioPlayer'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { createApiClient } from '@/lib/api'
import { KEY_DEFAULT_PLAYBACK_SPEED } from '@/lib/config'

export default function SettingsPage() {
  const { state, configure, dispatch } = useApp()

  const [newBaseUrl, setNewBaseUrl] = useState(state.baseUrl)
  const [newApiKey, setNewApiKey] = useState('')
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle')

  const [defaultSpeed, setDefaultSpeed] = useLocalStorage<number>(KEY_DEFAULT_PLAYBACK_SPEED, 1.0)

  async function handleSave() {
    // Preserve existing API key when the field is left blank
    configure(newBaseUrl, newApiKey || state.apiKey)
  }

  async function handleTest() {
    const client = createApiClient({ baseUrl: newBaseUrl || state.baseUrl, apiKey: newApiKey || state.apiKey })
    try {
      await client.checkHealth()
      setTestStatus('success')
    } catch {
      setTestStatus('error')
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
        {/* セクション 1: Podcast 生成 */}
        <section className="settings-section">
          <div className="settings-section-header">
            <div className="settings-section-icon" style={{ background: 'var(--amber-dim)' }} aria-hidden="true">
              🎙️
            </div>
            <h2 className="settings-section-title">Podcast 生成</h2>
          </div>

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

          {/* D14: 難易度セレクトは実装しない（API がないため）。説明テキストのみ */}
          <div className="settings-row">
            <div>
              <div className="settings-row-label">デフォルト難易度</div>
              <div className="settings-row-desc">Podcast の難易度はサーバー側設定で管理されています。</div>
            </div>
          </div>
        </section>

        {/* セクション 2: API 接続設定 */}
        <section className="settings-section">
          <div className="settings-section-header">
            <div className="settings-section-icon" style={{ background: 'var(--teal-glow)' }} aria-hidden="true">
              🔌
            </div>
            <h2 className="settings-section-title">API 接続設定</h2>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-row-label">API エンドポイント URL</div>
              {/* API キーの修正導線がここにあることを明示する（初回設定後の変更経路） */}
              <div className="settings-row-desc">
                API の接続先 URL と API キーはここでいつでも変更できます。API
                キー欄を空欄のまま保存すると、既存のキーを保持します。
              </div>
              <div className="settings-row-desc">現在の API URL: {state.baseUrl}</div>
            </div>
          </div>
          <div style={{ padding: '0 20px 16px' }}>
            {/* 視覚ラベルは settings-row-label が担うため、入力欄自体は aria-label で命名する */}
            <input
              id="settings-base-url"
              className="form-input"
              type="text"
              value={newBaseUrl}
              onChange={(e) => setNewBaseUrl(e.target.value)}
              placeholder="https://..."
              aria-label="Base URL"
            />
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-row-label">API キー</div>
              <div className="settings-row-desc">
                認証キー（localStorage に保存）— 現在: <span>設定済み</span>
              </div>
            </div>
          </div>
          <div style={{ padding: '0 20px 16px', display: 'flex', gap: 8 }}>
            <input
              id="settings-api-key"
              className="form-input"
              type="password"
              value={newApiKey}
              onChange={(e) => setNewApiKey(e.target.value)}
              placeholder="新しいキーを入力"
              aria-label="API Key"
            />
            <button className="btn btn-ghost" style={{ flexShrink: 0 }} onClick={handleTest} aria-label="接続テスト">
              接続テスト
            </button>
          </div>

          {testStatus === 'success' && (
            <div className="form-success" style={{ padding: '0 20px 12px' }}>
              接続成功しました
            </div>
          )}
          {testStatus === 'error' && (
            <div className="form-error" style={{ padding: '0 20px 12px' }}>
              接続に失敗しました
            </div>
          )}

          <div
            style={{
              padding: '12px 20px',
              background: 'rgba(240,160,48,.06)',
              borderTop: '1px solid var(--border)',
              fontSize: 12,
              color: 'var(--text-muted)',
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
            }}
          >
            <span style={{ color: 'var(--amber)', fontSize: 14, lineHeight: 1 }} aria-hidden="true">
              ⚠
            </span>
            {/* WHY 表記: 「Cookie」だと既存テストの /ok/i 接続成功判定に誤マッチするためカタカナ表記 */}
            API キーは localStorage に保存されます。XSS への注意が必要です。Phase 2 で httpOnly
            クッキーへ移行予定。
          </div>
        </section>

        <div style={{ textAlign: 'right', paddingTop: 4 }}>
          <button className="btn btn-primary" onClick={handleSave} aria-label="保存">
            変更を保存
          </button>
        </div>
      </div>
    </>
  )
}
