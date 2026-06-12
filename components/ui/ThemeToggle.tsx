'use client'

import React, { useEffect, useState } from 'react'
import { KEY_THEME } from '@/lib/config'

/**
 * テーマ切替トグル（docs/design/app-ui.html L1425-1435, L2007-2012 準拠）。
 *
 * テーマの実体は `html[data-theme]` を単一の真実とする。
 * WHY: テーマは CSS 変数（html[data-theme] セレクタ）だけで全体に反映できるため、
 * Context などのグローバル state で持つと全コンポーネント再レンダリングの
 * コストだけが増える。ここで持つローカル state は aria-checked を支援技術へ
 * 公開するための鏡であり、再レンダリング範囲はこのトグル自身に閉じる。
 */
export function ThemeToggle() {
  // WHY: 初期テーマは layout.tsx のインラインスクリプトが設定済みの data-theme
  // から読む。SSR 時はテーマが未知のため dark（既定）で描画し、マウント後に
  // 実際の値へ同期する（html は suppressHydrationWarning 済み）。
  const [isLight, setIsLight] = useState(false)

  useEffect(() => {
    setIsLight(document.documentElement.dataset.theme === 'light')
  }, [])

  const handleClick = () => {
    const current = document.documentElement.dataset.theme
    const next = current === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    // WHY: useLocalStorage フックは JSON.stringify で保存するため `"light"` のような
    // 引用符付き文字列になり、layout.tsx のテーマ初期化スクリプトが読む生値
    // （'light' | 'dark'）と互換にならない。ここでは localStorage を直接使う。
    localStorage.setItem(KEY_THEME, next)
    setIsLight(next === 'light')
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      // WHY switch: 2 状態トグルであることを支援技術へ伝える。checked=true は
      // トラックの ON 表示（ライトテーマ）と一致させ、視覚と非視覚の状態を揃える
      role="switch"
      aria-checked={isLight}
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
