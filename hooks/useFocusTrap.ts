'use client'
import { useEffect, useRef } from 'react'
import { getFocusableElements } from './focusableElements'

/**
 * モーダル等のフォーカストラップ。返す ref をダイアログコンテナ（role="dialog" の要素）へ付与する。
 *
 * @param isOpen トラップの有効/無効。省略時（undefined）は常に有効＝
 *   「マウント＝オープン」なモーダル（LoginModal/SetupModal/OnboardingSourcesModal）向け。
 *   ConfirmDialog のように常時マウントで開閉する場合は isOpen を明示的に渡す。
 */
export function useFocusTrap<T extends HTMLElement = HTMLElement>(
  isOpen: boolean = true,
): React.RefObject<T | null> {
  const containerRef = useRef<T>(null)

  useEffect(() => {
    if (!isOpen) return
    const container = containerRef.current
    if (!container) return

    // 起動元（復帰先）を保存。SSR/非ブラウザでは document 不在を防御。
    const previouslyFocused =
      typeof document !== 'undefined'
        ? (document.activeElement as HTMLElement | null)
        : null

    // 初期フォーカス: 最初の focusable へ。無ければコンテナ自身（tabindex=-1 を一時付与）。
    const focusables = getFocusableElements(container)
    if (focusables.length > 0) {
      focusables[0].focus()
    } else {
      container.setAttribute('tabindex', '-1')
      container.focus()
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const items = getFocusableElements(container!)
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus() // first → last へラップ
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus() // last → first へラップ
      }
      // ※ Escape はここで扱わない（各モーダルの責務）。
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => {
      container.removeEventListener('keydown', handleKeyDown)
      // クローズ/アンマウント時に起動元へ復帰。
      // WHY isConnected: ConfirmDialog の削除確定では起動元（行の削除ボタン）が確定後に
      // DOM から外れることがある。detach 済み要素への focus() は無音で失敗し focus が body へ
      // 飛ぶため、まだ DOM 接続済みの要素にだけ復帰する。
      if (
        previouslyFocused &&
        previouslyFocused.isConnected &&
        typeof previouslyFocused.focus === 'function'
      ) {
        previouslyFocused.focus()
      }
    }
  }, [isOpen])

  return containerRef
}
