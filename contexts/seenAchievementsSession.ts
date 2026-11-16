// composition root: 既読の store を組み立てる。保存に失敗した既読の記憶と、通知済みの id の記憶は page の session（再読込まで）で
// それぞれ 1 つだけ持ち、query・command・主体離脱の消去が同じ記憶を共有する（保存できない環境や並行する取得で同じ実績を再通知しない）。
import { createSeenAchievementsStore, createUnsavedSeenAchievements } from '@/lib/learning/infrastructure/seenAchievementsStore'
import { createBrowserKeyValueStore } from '@/lib/platform/keyValueStore'
import type { SeenAchievementsStore } from '@/lib/learning/application/ports'

const unsaved = createUnsavedSeenAchievements()
const notified = new Set<string>()

export function createBrowserSeenAchievementsStore(): SeenAchievementsStore {
  const store = createSeenAchievementsStore(createBrowserKeyValueStore(), unsaved)
  return {
    ...store,
    // 既読を消す主体離脱では通知済みの記憶も空にする（別の主体の同じ実績を通知できるようにする）。
    clear() {
      store.clear()
      notified.clear()
    },
  }
}

/**
 * 未通知の id だけを返し、記憶へ足す。並行する取得（再試行・unmount → 再 mount）が同じ実績を 2 度通知しないための窓口。
 * 判定と追加の間に await を挟まない（同期区間で決める）。
 */
export function claimUnnotifiedAchievements(ids: ReadonlyArray<string>): ReadonlyArray<string> {
  const fresh = ids.filter((id) => !notified.has(id))
  for (const id of fresh) notified.add(id)
  return fresh
}
