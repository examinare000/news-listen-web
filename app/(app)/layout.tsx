'use client'

import React from 'react'
import { NavigationBar } from '@/components/NavigationBar'
import { AudioPlayerBar } from '@/components/AudioPlayerBar'

// ルート直下（/）に shell-less なランディングページを置けるようにするため、
// 可視シェル（サイドバー＋プレイヤーバー）は RootLayout から (app) ルートグループへ移譲した。
// 認証後の画面（/feed, /podcast, /subscriptions, /settings, /admin）だけがこのシェルを継承する。
export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <NavigationBar />
      <main className="main-content">{children}</main>
      <AudioPlayerBar />
    </div>
  )
}
