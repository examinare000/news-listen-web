'use client'

import React, { useState } from 'react'
import { createApiClient } from '@/lib/api'
import { useFocusTrap } from '@/hooks/useFocusTrap'

interface SetupModalProps {
  onConfigure: (baseUrl: string, apiKey: string) => void
}

export function SetupModal({ onConfigure }: SetupModalProps) {
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [urlError, setUrlError] = useState('')
  const [keyError, setKeyError] = useState('')
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const dialogRef = useFocusTrap<HTMLDivElement>()

  function validate(): boolean {
    let valid = true

    if (!baseUrl) {
      setUrlError('必須項目です')
      valid = false
    } else if (!baseUrl.startsWith('https://') && !baseUrl.startsWith('http://')) {
      setUrlError('https:// または http:// から始まる URL を入力してください')
      valid = false
    } else {
      setUrlError('')
    }

    if (!apiKey) {
      setKeyError('必須項目です')
      valid = false
    } else {
      setKeyError('')
    }

    return valid
  }

  async function handleSave() {
    if (!validate()) return
    onConfigure(baseUrl, apiKey)
  }

  async function handleTest() {
    if (!baseUrl) {
      setUrlError('接続テストには URL が必要です')
      return
    }
    const client = createApiClient({ baseUrl, apiKey })
    try {
      await client.checkHealth()
      setTestStatus('success')
    } catch {
      setTestStatus('error')
    }
  }

  return (
    <div className="modal-backdrop">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="setup-modal-title" className="modal-box">
        {/* NavigationBar と同一のロゴ（app-ui.html L1375-1378 をインライン移植） */}
        <div className="modal-logo">
          <div className="logo-icon">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
          <span className="logo-text">
            Audio<span>News</span>
          </span>
        </div>

        <h2 id="setup-modal-title" className="modal-title">
          API 設定
        </h2>
        {/* 誤った値を保存しても後から修正できることを明示し、修正導線の不在による行き詰まりを防ぐ */}
        <p className="modal-desc">保存後も、下部の Settings タブからいつでも変更できます。</p>

        <div className="form-field">
          <label className="form-label" htmlFor="setup-base-url">
            Base URL
          </label>
          <input
            className="form-input"
            id="setup-base-url"
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          {urlError && <p className="form-error">{urlError}</p>}
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="setup-api-key">
            API Key
          </label>
          <input
            className="form-input"
            id="setup-api-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          {keyError && <p className="form-error">{keyError}</p>}
        </div>

        {testStatus === 'success' && <p className="form-success">接続成功</p>}
        {testStatus === 'error' && <p className="form-error">接続エラー</p>}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={handleTest}>
            接続テスト
          </button>
          <button className="btn btn-primary" onClick={handleSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
