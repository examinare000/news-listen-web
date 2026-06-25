// フォーカス可能要素を列挙する純粋関数。DOM ノードを入力に取り、
// タブ順に並んだ HTMLElement 配列を返す。React 非依存・副作用なし。
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
  // 非表示要素を除外（display:none 等は offsetParent===null。
  // ただし position:fixed は offsetParent が常に null になるため hidden 属性も併用判定）。
  // また、tabindex が負の数（-2, -3 等も）の場合は除外する。
  return nodes.filter((el) => {
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') {
      return false
    }
    // tabindex が負の場合は除外（CSS セレクタは :not([tabindex="-1"]) のみなため、手動判定）
    const tabindex = el.getAttribute('tabindex')
    if (tabindex !== null) {
      const tabindexValue = parseInt(tabindex, 10)
      if (tabindexValue < 0) {
        return false
      }
    }
    return true
  })
}
