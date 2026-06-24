'use client'

import { useEffect } from 'react'

/**
 * Service Worker を登録するクライアントコンポーネント。
 *
 * app/layout.tsx（Server Component）にネストすることで、
 * SW 登録処理をクライアントサイドに閉じ込める。
 *
 * 機能検出ガード（'serviceWorker' in navigator）で保護しているため、
 * jsdom（テスト環境）では自動的に no-op となり、既存テストに影響しない。
 *
 * レンダリング結果は null（DOM ツリーへの影響ゼロ）。
 */
export function PushRegistrar() {
  useEffect(() => {
    // 機能検出: jsdom ではここで早期リターンするため既存テスト非破壊
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker.register('/sw.js').catch((err) => {
      // SW 登録失敗は致命的でないためコンソールにとどめる
      console.error('[PushRegistrar] Service Worker の登録に失敗しました:', err)
    })
  }, [])

  return null
}
