// 既定の再生速度の写し（web-dec-130）。サーバーの値を端末へ写し、主体離脱の後始末が写しの後に走っても
// 現在の主体の値を消さない（web-dec-205）。写しの印（誰の値を写したか）は値を持たず userId だけを持つ。
import type { LocalSettingsPort } from '@/lib/preferences/application/ports'
import type { PreferencesQueries } from '@/lib/preferences/application/queries'
import { defaultPlaybackSpeed } from '@/lib/preferences/domain/settings'

export interface SubjectSpeedCopy {
  readonly copy: (currentSubject: () => { readonly userId: string | null } | null) => Promise<void>
  readonly forget: () => void
  readonly clearAfterLeave: (cleanedUserId: string | null, currentUserId: string | null) => void
}

export function createSubjectSpeedCopy(deps: {
  readonly queries: Pick<PreferencesQueries, 'getServerPreferences'>
  readonly local: LocalSettingsPort & { readonly clearSubjectScoped: () => void }
}): SubjectSpeedCopy {
  const { queries, local } = deps
  let copiedFor: string | null = null

  // 結果は捨て、呼び手は待たない。失敗は握る（端末の値のまま。次の契機で再び写す）。
  // 書く直前に主体を照合し、別の主体の遅れた結果は書かない。
  const copy: SubjectSpeedCopy['copy'] = async (currentSubject) => {
    const startedFor = currentSubject()?.userId ?? null
    try {
      const result = await queries.getServerPreferences()
      if (!result.ok) return
      const current = currentSubject()
      if (current === null || current.userId !== startedFor) return
      local.set(defaultPlaybackSpeed, result.value.defaultPlaybackSpeed)
      copiedFor = startedFor
    } catch {
      // 端末の値のまま。次の契機で再び写す。
    }
  }

  const forget: SubjectSpeedCopy['forget'] = () => {
    copiedFor = null
  }

  // B の写しが A の後始末より先に書いていたら、clear が B の値まで消す。clear の前に現在値を読み、直後に戻す。
  // 写しが保持した値でなく現在値を使うのは、その後に B が変えた値を古い値で上書きしないため。
  const clearAfterLeave: SubjectSpeedCopy['clearAfterLeave'] = (cleanedUserId, currentUserId) => {
    const current = local.get(defaultPlaybackSpeed)
    local.clearSubjectScoped()
    if (currentUserId !== cleanedUserId && copiedFor !== null && copiedFor === currentUserId) {
      local.set(defaultPlaybackSpeed, current)
    }
  }

  return { copy, forget, clearAfterLeave }
}
