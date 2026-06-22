import React from 'react'
import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { AppProvider } from '@/contexts/AppContext'
import { AuthProvider } from '@/contexts/AuthContext'
import { AudioPlayerProvider } from '@/contexts/AudioPlayerContext'
import { ToastProvider } from '@/components/ui/Toast'
import { NavigationBar } from '@/components/NavigationBar'
import { AudioPlayerBar } from '@/components/AudioPlayerBar'
import './globals.css'

// フォントは next/font/local で app/fonts/ の woff2（latin サブセット）からセルフホストする。
// next/font/google はビルド時に Google Fonts へ fetch するため、オフラインの Docker ビルドで
// 失敗する。ローカルファイル化することでビルドを外部依存ゼロ・決定的にする。
// （実行時に Google Fonts へ出ない意図は docs/adr/003-web-pure-css-design-tokens.md と同じ）
// DM Sans / Playfair Display は可変フォント（1ファイルで weight 範囲を内包）、DM Mono は
// weight ごとに別ファイル。
const playfairDisplay = localFont({
  src: './fonts/PlayfairDisplay-latin.woff2',
  weight: '400 900',
  display: 'swap',
  variable: '--font-display',
})

const dmSans = localFont({
  src: './fonts/DMSans-latin.woff2',
  weight: '300 600',
  display: 'swap',
  variable: '--font-body',
})

const dmMono = localFont({
  src: [
    { path: './fonts/DMMono-400-latin.woff2', weight: '400', style: 'normal' },
    { path: './fonts/DMMono-500-latin.woff2', weight: '500', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-mono',
})

// FOUC（テーマのちらつき）防止のため、初回描画前に同期実行されるインラインスクリプトで
// html[data-theme] を確定する。外部スクリプトや useEffect では初回描画後の適用になり一瞬ちらつく。
// 内容は docs/design/app-ui.html L10〜16 と同等。キー 'theme' は lib/config.ts の KEY_THEME と一致させること
const themeInitScript = `
(function(){
  var saved = localStorage.getItem('theme');
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = saved || (prefersDark ? 'dark' : 'light');
})();
`

export const metadata: Metadata = {
  title: 'Podcast App',
  description: 'English learning podcast app',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: data-theme はサーバー出力に存在せずクライアントで
    // 上記スクリプトが付与するため、属性差分のハイドレーション警告を抑止する
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${playfairDisplay.variable} ${dmSans.variable} ${dmMono.variable}`}>
        <AppProvider>
          <AuthProvider>
            <ToastProvider>
              <AudioPlayerProvider>
                <div className="app-shell">
                  <NavigationBar />
                  <main className="main-content">{children}</main>
                  <AudioPlayerBar />
                </div>
              </AudioPlayerProvider>
            </ToastProvider>
          </AuthProvider>
        </AppProvider>
      </body>
    </html>
  )
}
