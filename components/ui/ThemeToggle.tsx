'use client'

import React from 'react'
import { KEY_THEME } from '@/lib/config'

/**
 * テーマ切替トグル（docs/design/app-ui.html L1425-1435, L2007-2012 準拠）。
 *
 * React state を持たず、`html[data-theme]` を単一の真実とする。
 * WHY: テーマは CSS 変数（html[data-theme] セレクタ）だけで全体に反映できるため、
 * state や Context で持つと全コンポーネント再レンダリングのコストだけが増える。
 */
export function ThemeToggle() {
  const handleClick = () => {
    const current = document.documentElement.dataset.theme
    const next = current === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    // WHY: useLocalStorage フックは JSON.stringify で保存するため `"light"` のような
    // 引用符付き文字列になり、layout.tsx のテーマ初期化スクリプトが読む生値
    // （'light' | 'dark'）と互換にならない。ここでは localStorage を直接使う。
    localStorage.setItem(KEY_THEME, next)
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label="テーマ切替"
      title="ライト/ダークモード切り替え"
      onClick={handleClick}
    >
      <span className="theme-toggle-track">
        <span className="theme-toggle-thumb"></span>
      </span>
      <span className="theme-toggle-label">
        <span className="icon-moon">🌙</span>
        <span className="icon-sun">☀️</span>
        <span className="theme-name-dark">ダーク</span>
        <span className="theme-name-light">ライト</span>
      </span>
    </button>
  )
}
