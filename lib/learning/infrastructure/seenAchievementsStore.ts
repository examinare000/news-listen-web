// 既読の実績の id の保存庫（port SeenAchievementsStore の実装）。
// key と codec（JSON の文字列配列）は本ファイルが持つ。Preferences の宣言（lib/preferences/**）は import しない（web-dep-11）。
import type { SeenAchievementsStore } from '@/lib/learning/application/ports'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'

const KEY = 'seen_achievement_ids'

/**
 * 保存に失敗した既読を session の間だけ持つ記憶。保存できない環境でも同じ session では同じ実績を再通知しない
 * （現行の PreferencesProvider がメモリに値を持つ挙動の保存）。query・command・主体離脱の消去が同じ記憶を共有する。
 */
export interface UnsavedSeenAchievements {
  value: ReadonlyArray<string> | null
}

export function createUnsavedSeenAchievements(): UnsavedSeenAchievements {
  return { value: null }
}

// 壊れた値・配列以外・文字列以外の要素を含む値は空として読む。
function decode(stored: string | null): ReadonlyArray<string> {
  if (stored === null) return []
  try {
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    const items: unknown[] = parsed
    return items.every((item): item is string => typeof item === 'string') ? items : []
  } catch {
    return []
  }
}

export function createSeenAchievementsStore(kv: KeyValueStore, unsaved: UnsavedSeenAchievements): SeenAchievementsStore {
  return {
    read() {
      return Object.freeze(new Set(unsaved.value ?? decode(kv.get(KEY))))
    },
    write(ids) {
      const copy = Object.freeze([...ids])
      // 保存できたら保存値が正になるので記憶は空にする。失敗したときだけ記憶に置く。
      unsaved.value = kv.set(KEY, JSON.stringify(copy)) ? null : copy
    },
    clear() {
      unsaved.value = null
      kv.remove(KEY)
    },
  }
}
