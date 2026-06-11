import React from 'react'
import type { Metadata } from 'next'
import { AppProvider } from '@/contexts/AppContext'
import { AudioPlayerProvider } from '@/contexts/AudioPlayerContext'
import { ToastProvider } from '@/components/ui/Toast'
import { NavigationBar } from '@/components/NavigationBar'
import { AudioPlayerBar } from '@/components/AudioPlayerBar'

export const metadata: Metadata = {
  title: 'Podcast App',
  description: 'English learning podcast app',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <AppProvider>
          <ToastProvider>
            <AudioPlayerProvider>
              <NavigationBar />
              <main>{children}</main>
              <AudioPlayerBar />
            </AudioPlayerProvider>
          </ToastProvider>
        </AppProvider>
      </body>
    </html>
  )
}
