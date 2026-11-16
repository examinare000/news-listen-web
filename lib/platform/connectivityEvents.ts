// 接続復帰の購読。未送信の位置を再送する契機を composition へ渡す。
export interface ConnectivityEvents {
  /** window の online で listener を呼ぶ。戻り値で解除する（2 回呼んでも害はない）。 */
  onOnline(listener: () => void): () => void
}

export function createBrowserConnectivityEvents(): ConnectivityEvents {
  return {
    onOnline(listener) {
      window.addEventListener('online', listener)
      return () => window.removeEventListener('online', listener)
    },
  }
}
