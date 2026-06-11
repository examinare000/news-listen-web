'use client'

import React, { useState } from 'react'
import { createApiClient, ApiError } from '@/lib/api'

interface SetupModalProps {
  onConfigure: (baseUrl: string, apiKey: string) => void
}

export function SetupModal({ onConfigure }: SetupModalProps) {
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [urlError, setUrlError] = useState('')
  const [keyError, setKeyError] = useState('')
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle')

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
    <div role="dialog" aria-modal="true">
      <h2>API 設定</h2>

      <div>
        <label htmlFor="setup-base-url">Base URL</label>
        <input
          id="setup-base-url"
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
        {urlError && <p>{urlError}</p>}
      </div>

      <div>
        <label htmlFor="setup-api-key">API Key</label>
        <input
          id="setup-api-key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        {keyError && <p>{keyError}</p>}
      </div>

      <button onClick={handleSave}>保存</button>
      <button onClick={handleTest}>接続テスト</button>

      {testStatus === 'success' && <p>接続成功</p>}
      {testStatus === 'error' && <p>接続エラー</p>}
    </div>
  )
}
