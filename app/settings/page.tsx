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
    <div>
      <h1>設定</h1>

      <section>
        <h2>API 設定</h2>

        {/* API キーの修正導線がここにあることを明示する（初回設定後の変更経路） */}
        <p>API の接続先 URL と API キーはここでいつでも変更できます。API キー欄を空欄のまま保存すると、既存のキーを保持します。</p>

        <p>
          <strong>現在の API URL:</strong> {state.baseUrl}
        </p>

        <p>API キー: <span>設定済み</span></p>

        <div>
          <label htmlFor="settings-base-url">Base URL</label>
          <input
            id="settings-base-url"
            type="text"
            value={newBaseUrl}
            onChange={(e) => setNewBaseUrl(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="settings-api-key">API Key</label>
          <input
            id="settings-api-key"
            type="password"
            value={newApiKey}
            onChange={(e) => setNewApiKey(e.target.value)}
            placeholder="新しいキーを入力"
          />
        </div>

        <button onClick={handleSave} aria-label="保存">
          保存
        </button>

        <button onClick={handleTest} aria-label="接続テスト">
          接続テスト
        </button>

        {testStatus === 'success' && <p>接続成功しました</p>}
        {testStatus === 'error' && <p>接続に失敗しました</p>}
      </section>

      <section>
        <h2>再生速度のデフォルト</h2>
        <label htmlFor="default-speed">速度</label>
        <select
          id="default-speed"
          value={defaultSpeed}
          onChange={(e) => {
            const speed = Number(e.target.value)
            setDefaultSpeed(speed)
            // Reflect the new default speed in AppContext so AudioPlayerBar
            // selector and subsequent playback pick it up immediately (spec §10.5).
            dispatch({ type: 'SET_SPEED', speed })
          }}
          aria-label="速度"
        >
          {PLAYBACK_SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
      </section>

      <section>
        <h2>難易度</h2>
        <p>難易度はサーバー側設定で管理されています。</p>
      </section>
    </div>
  )
}
