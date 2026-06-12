import React from 'react'
import type { Metadata } from 'next'
import { Playfair_Display, DM_Sans, DM_Mono } from 'next/font/google'
import { AppProvider } from '@/contexts/AppContext'
import { AudioPlayerProvider } from '@/contexts/AudioPlayerContext'
import { ToastProvider } from '@/components/ui/Toast'
import { NavigationBar } from '@/components/NavigationBar'
import { AudioPlayerBar } from '@/components/AudioPlayerBar'
import './globals.css'

// next/font によるビルド時セルフホスティング。<link> 直書きにしないのは、
// Docker コンテナ実行時の Google Fonts への外部リクエストを消すため（00-overview.md §3.2）
const playfairDisplay = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '600', '700', '900'],
  variable: '--font-display',
})

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-body',
})

const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
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
          <ToastProvider>
            <AudioPlayerProvider>
              <div className="app-shell">
                <NavigationBar />
                <main className="main-content">{children}</main>
                <AudioPlayerBar />
              </div>
            </AudioPlayerProvider>
          </ToastProvider>
        </AppProvider>
      </body>
    </html>
  )
}
