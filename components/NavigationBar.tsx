'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { SidebarAccount } from '@/components/ui/SidebarAccount'
import { useAuth } from '@/contexts/AuthContext'

// アイコン SVG は docs/design/app-ui.html L1388-1414 をインライン移植
// WHY: アイコンライブラリを導入しない方針（依存追加ゼロ）。NAV_ITEMS はデザイン正本と
// 完全一致。admin 限定の「おすすめサイト管理」の星アイコンは正本未定義のため独自追加
const NAV_ITEMS = [
  {
    label: 'フィード',
    href: '/feed',
    icon: (
      <svg
        className="nav-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 11a9 9 0 0 1 9 9" />
        <path d="M4 4a16 16 0 0 1 16 16" />
        <circle cx="5" cy="19" r="1" />
      </svg>
    ),
  },
  {
    label: 'ポッドキャスト',
    href: '/podcast',
    icon: (
      <svg
        className="nav-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <polygon points="10 8 16 12 10 16 10 8" />
      </svg>
    ),
  },
  {
    label: '購読管理',
    href: '/subscriptions',
    icon: (
      <svg
        className="nav-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    label: '設定',
    href: '/settings',
    icon: (
      <svg
        className="nav-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
]

export function NavigationBar() {
  const pathname = usePathname()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const isAdminLinkActive = pathname === '/admin/featured-sites'
  const isInvitesLinkActive = pathname === '/admin/invites'

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-mark">
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
      </div>

      <div className="nav-section-label">メニュー</div>

      <nav aria-label="メインナビゲーション">
        {NAV_ITEMS.map(({ label, href, icon }) => {
          const isActive = pathname === href
          return (
            <React.Fragment key={href}>
              {/* デザイン準拠: 設定の直前に区切り線（app-ui.html L1409） */}
              {href === '/settings' && <div className="sidebar-divider"></div>}
              <Link
                href={href}
                className={isActive ? 'nav-item active' : 'nav-item'}
                aria-current={isActive ? 'page' : undefined}
              >
                {icon}
                <span>{label}</span>
              </Link>
            </React.Fragment>
          )
        })}

        {/* admin ロールのみ管理導線を表示（権限のない項目を露出させない） */}
        {isAdmin && (
          <>
            <div className="sidebar-divider"></div>
            <div className="nav-section-label">管理</div>
            <Link
              href="/admin/featured-sites"
              className={isAdminLinkActive ? 'nav-item active' : 'nav-item'}
              aria-current={isAdminLinkActive ? 'page' : undefined}
            >
              <svg
                className="nav-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              <span>おすすめサイト管理</span>
            </Link>
            <Link
              href="/admin/invites"
              className={isInvitesLinkActive ? 'nav-item active' : 'nav-item'}
              aria-current={isInvitesLinkActive ? 'page' : undefined}
            >
              <svg
                className="nav-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M22 12h-6l-2 3h-4l-2-3H2" />
                <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
              </svg>
              <span>招待管理</span>
            </Link>
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        <SidebarAccount />
        <ThemeToggle />
      </div>
    </aside>
  )
}
