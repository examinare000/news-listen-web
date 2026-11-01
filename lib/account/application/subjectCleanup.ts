// 主体離脱の後始末（共有仕様 §6.8 SubjectCleanup / web-dec-84）。
// 他の context を import せず、4 手順を関数の注入で受ける（web-dep-12）。
import type { Subject } from '../domain/subject'

type Step = 'audio' | 'playback' | 'serviceWorkerCaches' | 'subjectSettings'

export type CleanupResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly incomplete: ReadonlyArray<Step> }

export interface SubjectCleanupSteps {
  deleteAudio(userId: string): Promise<void>
  stopPlayback(): void | Promise<void>
  clearServiceWorkerCaches(): Promise<void>
  clearSubjectSettings(): void | Promise<void>
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function'

// 同期の戻りは同じ同期区間のまま進め、throw は reject に寄せる。
function start(run: () => void | Promise<void>): Promise<void> | null {
  try {
    const result = run()
    return isThenable(result) ? Promise.resolve(result) : null
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error(String(e)))
  }
}

export function createSubjectCleanup(
  steps: SubjectCleanupSteps,
): (subject: Subject, options: { readonly audio: boolean }) => Promise<CleanupResult> {
  return (subject, options) => {
    const failed = new Set<Step>()
    let playback: Promise<void> | null = null
    try {
      const stopped = steps.stopPlayback()
      playback = isThenable(stopped) ? Promise.resolve(stopped) : null
    } catch {
      failed.add('playback')
    }

    const rest = (): Promise<CleanupResult> => {
      const running: Array<[Step, Promise<void> | null]> = []
      if (options.audio && subject.userId !== null) {
        const userId = subject.userId
        running.push(['audio', start(() => steps.deleteAudio(userId))])
      }
      running.push(['serviceWorkerCaches', start(() => steps.clearServiceWorkerCaches())])
      running.push(['subjectSettings', start(() => steps.clearSubjectSettings())])
      return Promise.allSettled(running.map(([, p]) => p ?? Promise.resolve())).then((results) => {
        results.forEach((r, i) => {
          if (r.status === 'rejected') failed.add(running[i][0])
        })
        const order: Step[] = ['audio', 'playback', 'serviceWorkerCaches', 'subjectSettings']
        const incomplete = order.filter((s) => failed.has(s))
        return incomplete.length === 0
          ? Object.freeze({ ok: true as const })
          : Object.freeze({ ok: false as const, incomplete: Object.freeze(incomplete) })
      })
    }

    if (playback === null) return rest()
    return playback.then(
      () => rest(),
      () => {
        failed.add('playback')
        return rest()
      },
    )
  }
}
