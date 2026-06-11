'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { label: 'Feed', href: '/feed' },
  { label: 'Podcast', href: '/podcast' },
  { label: 'Subscriptions', href: '/subscriptions' },
  { label: 'Settings', href: '/settings' },
]

export function NavigationBar() {
  const pathname = usePathname()

  return (
    <nav aria-label="メインナビゲーション">
      {NAV_ITEMS.map(({ label, href }) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href ? 'page' : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  )
}
