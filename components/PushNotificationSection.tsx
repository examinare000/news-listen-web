'use client'

import React from 'react'
import { useWebPushSubscription } from '@/hooks/useWebPushSubscription'
import type { PushBrowserPort } from '@/lib/pushBrowserPort'

interface PushNotificationSectionProps {
  /** テスト時に差し替えるポート（省略時は実ブラウザポートを使用）*/
  port?: PushBrowserPort
}

/**
 * Web Push 通知の購読 ON/OFF トグルセクション。
 *
 * 設定ページのセクションとして組み込む。
 * 状態に応じてボタンラベルとメッセージを切り替える最小 UI。
 */
export function PushNotificationSection({ port }: PushNotificationSectionProps) {
  const { state, subscribe, unsubscribe } = useWebPushSubscription({ port })

  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <div
          className="settings-section-icon"
          style={{ background: 'var(--teal-glow)' }}
          aria-hidden="true"
        >
          🔔
        </div>
        <h2 className="settings-section-title">プッシュ通知</h2>
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row-label">ブラウザ通知</div>
          <div className="settings-row-desc">{stateDescription(state)}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', paddingRight: 20 }}>
          {state === 'unsubscribed' && (
            <button
              className="btn btn-primary"
              onClick={subscribe}
              disabled={false}
            >
              通知を有効にする
            </button>
          )}
          {state === 'subscribed' && (
            <button
              className="btn btn-ghost"
              onClick={unsubscribe}
            >
              通知を無効にする
            </button>
          )}
          {state === 'subscribing' && (
            <button className="btn btn-primary" disabled>
              設定中...
            </button>
          )}
        </div>
      </div>

      {state === 'denied' && (
        <div
          style={{
            padding: '12px 20px',
            background: 'var(--amber-dim)',
            borderTop: '1px solid var(--border)',
            fontSize: 12,
            color: 'var(--text-secondary)',
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
          }}
        >
          <span style={{ color: 'var(--amber)', fontSize: 14, lineHeight: 1 }} aria-hidden="true">
            ⚠
          </span>
          ブラウザの設定から通知の許可を変更してください。
        </div>
      )}

      {state === 'error' && (
        <div
          style={{
            padding: '12px 20px',
            background: 'rgba(224,92,92,.08)',
            borderTop: '1px solid var(--border)',
            fontSize: 12,
            color: 'var(--red)',
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }} aria-hidden="true">✕</span>
          通知の設定中にエラーが発生しました。再度お試しください。
        </div>
      )}
    </section>
  )
}

function stateDescription(state: string): string {
  switch (state) {
    case 'unsupported':
      return 'このブラウザは対応していません'
    case 'denied':
      return '通知が拒否されています。ブラウザの設定から変更してください。'
    case 'unsubscribed':
      return 'プッシュ通知は無効です'
    case 'subscribing':
      return '通知を有効にしています...'
    case 'subscribed':
      return 'プッシュ通知は有効です'
    case 'error':
      return '通知の設定中にエラーが発生しました'
    default:
      return ''
  }
}
