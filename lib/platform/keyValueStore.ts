export interface KeyValueStore {
  get(key: string): string | null
  set(key: string, value: string): boolean
  remove(key: string): void
}

/** key の列挙が要る利用者（主体離脱時の位置の一括削除）だけが要求する狭い型。KeyValueStore 自体は変えない。 */
export interface KeyEnumerableStore extends KeyValueStore {
  keys(): ReadonlyArray<string>
}

// private mode 等で Web Storage が例外を投げても呼出側へ漏らさない。
export function createBrowserKeyValueStore(): KeyEnumerableStore {
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
    keys() {
      try {
        const found: string[] = []
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i)
          if (key !== null) found.push(key)
        }
        return found
      } catch {
        return []
      }
    },
  }
}
