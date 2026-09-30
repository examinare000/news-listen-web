import type { KeyValueStore } from '@/lib/playback/ports'

// private mode 等で Web Storage が例外を投げても呼出側へ漏らさない。
export function createBrowserKeyValueStore(): KeyValueStore {
  return {
    get(key) {
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value)
        return true
      } catch {
        return false
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key)
      } catch {
        // 削除失敗は利用者に見える差が無いので無視する。
      }
    },
  }
}
