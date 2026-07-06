'use client'

import React, { useEffect, useRef, useState } from 'react'

export interface MenuItem {
  key: string
  label: string
  onSelect: () => void
}

interface MenuProps {
  /** トリガーボタンの aria-label（画面上の可視ラベルを持たない小ボタン用） */
  triggerLabel: string
  /** トリガーボタンの表示内容（アイコン等） */
  triggerContent: React.ReactNode
  /** トリガーボタンに付与する追加クラス（呼び出し側の action-btn 等と合成） */
  triggerClassName?: string
  items: MenuItem[]
  disabled?: boolean
}

/**
 * 依存ライブラリなしの軽量ドロップダウンメニュー。
 * WHY: 記事単位の難易度選択（issue #163）のような単発選択メニューに
 * モーダル用の useFocusTrap は過剰（背景操作を禁止する必要がない）ため、
 * 開閉のみを自前管理する専用の最小実装として切り出す。
 */
export function Menu({
  triggerLabel,
  triggerContent,
  triggerClassName,
  items,
  disabled = false,
}: MenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemsRef = useRef<Array<HTMLButtonElement | null>>([])

  // メニュー外クリックで閉じる
  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  // Escape で閉じてトリガーへフォーカスを戻す
  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open])

  // オープン時に最初の項目へフォーカス移動（キーボード操作の起点）
  useEffect(() => {
    if (open) {
      itemsRef.current[0]?.focus()
    }
  }, [open])

  function handleSelect(item: MenuItem) {
    setOpen(false)
    item.onSelect()
  }

  function handleItemKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = itemsRef.current[(index + 1) % items.length]
      next?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = itemsRef.current[(index - 1 + items.length) % items.length]
      prev?.focus()
    }
  }

  return (
    <div className="menu" ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        className={triggerClassName ? `menu-trigger ${triggerClassName}` : 'menu-trigger'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
      >
        {triggerContent}
      </button>
      {open && (
        <div className="menu-list" role="menu">
          {items.map((item, index) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              ref={(el) => {
                itemsRef.current[index] = el
              }}
              className="menu-item"
              onClick={() => handleSelect(item)}
              onKeyDown={(e) => handleItemKeyDown(e, index)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
