// @vitest-environment node
// 既定の再生速度の写し（web-dec-130）。サーバーの値を端末へ写し、主体離脱の後始末が写しの後に走っても現在の主体の値を消さない（web-dec-205）。
// 写しの印（誰の値を写したか）は createSubjectSpeedCopy の closure が持つ。
// infrastructure は値で import しない（unit 分類）。local と queries は呼出を記録する手書きの fake。
//
// RED 理由（実装前）: `@/lib/preferences/application/subjectSpeedCopy` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createSubjectSpeedCopy } from '@/lib/preferences/application/subjectSpeedCopy'
import type { PreferencesQueries } from '@/lib/preferences/application/queries'
import { defaultPlaybackSpeed } from '@/lib/preferences/domain/settings'
import type { PlaybackSpeed } from '@/lib/playback/domain/session'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

type ServerPreferences = Awaited<ReturnType<PreferencesQueries['getServerPreferences']>>

const serverSpeed = (speed: PlaybackSpeed): ServerPreferences => ({
  ok: true,
  value: {
    defaultDifficulty: 'toeic_600',
    weeklyGoal: 5,
    defaultPlaybackSpeed: speed,
    digest: { enabled: false, articleCount: 5 },
  },
})

const failed: Result<never, ApiFailure> = { ok: false, failure: { kind: 'network' } }

/** 状態を持つ local の fake。clearSubjectScoped で値が既定値へ戻り、set と clear の呼出を記録する。 */
function makeLocal(initial: PlaybackSpeed = defaultPlaybackSpeed.default) {
  let value: unknown = initial
  const sets: Array<{ id: string; value: unknown }> = []
  let clears = 0
  return {
    sets,
    clears: () => clears,
    value: () => value,
    port: {
      get: <T>(setting: { normalize: (raw: unknown) => T }): T => setting.normalize(value),
      set: <T>(setting: { id: string; normalize: (raw: unknown) => T }, next: T): void => {
        sets.push({ id: setting.id, value: next })
        value = setting.normalize(next)
      },
      clearSubjectScoped: (): void => {
        clears += 1
        value = defaultPlaybackSpeed.default
      },
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('web-dec-130 copy: 取得した既定の再生速度を、書く直前に主体を照合して端末へ写す', () => {
  test('主体が変わらなければ値を 1 回書き、書いた主体の印が付く（後始末の後に現在の主体の値を戻せる）', async () => {
    const local = makeLocal()
    const speed = createSubjectSpeedCopy({
      queries: { getServerPreferences: () => Promise.resolve(serverSpeed(1.25)) },
      local: local.port,
    })

    await speed.copy(() => ({ userId: 'u-1' }))

    expect(local.sets).toEqual([{ id: defaultPlaybackSpeed.id, value: 1.25 }])

    // 印が付いているので、別の主体 u-0 の後始末が写しの後に走っても、現在の主体 u-1 の値を戻す
    speed.clearAfterLeave('u-0', 'u-1')

    expect(local.clears()).toBe(1)
    expect(local.sets).toEqual([
      { id: defaultPlaybackSpeed.id, value: 1.25 },
      { id: defaultPlaybackSpeed.id, value: 1.25 },
    ])
    expect(local.value()).toBe(1.25)
  })

  test('取得の間に主体が別の userId へ替わった、または null になった結果は書かない', async () => {
    const local = makeLocal()
    let fetchGate = deferred<ServerPreferences>()
    const speed = createSubjectSpeedCopy({
      queries: { getServerPreferences: () => fetchGate.promise },
      local: local.port,
    })
    let subject: { userId: string | null } | null = { userId: 'u-1' }

    const switched = speed.copy(() => subject)
    subject = { userId: 'u-2' }
    fetchGate.resolve(serverSpeed(1.75))
    await switched
    expect(local.sets).toEqual([])

    fetchGate = deferred<ServerPreferences>()
    subject = { userId: 'u-1' }
    const cleared = speed.copy(() => subject)
    subject = null
    fetchGate.resolve(serverSpeed(1.75))
    await cleared
    expect(local.sets).toEqual([])
  })

  test('取得が ok: false・reject のときは書かず、reject せず、印も付けない', async () => {
    const local = makeLocal()
    let outcome: 'fail' | 'reject' = 'fail'
    const speed = createSubjectSpeedCopy({
      queries: {
        getServerPreferences: () => (outcome === 'fail' ? Promise.resolve(failed) : Promise.reject(new Error('boom'))),
      },
      local: local.port,
    })

    await expect(speed.copy(() => ({ userId: 'u-1' }))).resolves.toBeUndefined()
    outcome = 'reject'
    await expect(speed.copy(() => ({ userId: 'u-1' }))).resolves.toBeUndefined()
    expect(local.sets).toEqual([])

    // 印が無いので、後始末の後に値を戻さない
    speed.clearAfterLeave('u-0', 'u-1')
    expect(local.sets).toEqual([])
  })
})

describe('web-dec-205 clearAfterLeave: 離脱した主体の設定を消し、現在の主体の写した値だけを戻す', () => {
  test('現在値は clear の前に読み、写しの後に利用者が変えた値（既定値と違う）を戻す', async () => {
    const local = makeLocal()
    const speed = createSubjectSpeedCopy({
      queries: { getServerPreferences: () => Promise.resolve(serverSpeed(1.25)) },
      local: local.port,
    })
    await speed.copy(() => ({ userId: 'u-1' }))
    local.port.set(defaultPlaybackSpeed, 1.5)
    local.sets.length = 0

    speed.clearAfterLeave('u-0', 'u-1')

    expect(local.sets.at(-1)).toEqual({ id: defaultPlaybackSpeed.id, value: 1.5 })
    expect(local.value()).toBe(1.5)
  })

  test('写しが無い・forget の後・離脱した主体と現在の主体が同じ のどれでも clear だけして値は戻さない', async () => {
    const queries = { getServerPreferences: () => Promise.resolve(serverSpeed(1.25)) }

    // (a) 写しが無い
    const a = makeLocal()
    createSubjectSpeedCopy({ queries, local: a.port }).clearAfterLeave('u-0', 'u-1')
    expect(a.clears()).toBe(1)
    expect(a.sets).toEqual([])

    // (b) 写した後に forget
    const b = makeLocal()
    const speedB = createSubjectSpeedCopy({ queries, local: b.port })
    await speedB.copy(() => ({ userId: 'u-1' }))
    speedB.forget()
    b.sets.length = 0
    speedB.clearAfterLeave('u-0', 'u-1')
    expect(b.clears()).toBe(1)
    expect(b.sets).toEqual([])

    // (c) 写した主体を離脱する（離脱した主体 = 現在の主体）
    const c = makeLocal()
    const speedC = createSubjectSpeedCopy({ queries, local: c.port })
    await speedC.copy(() => ({ userId: 'u-1' }))
    c.sets.length = 0
    speedC.clearAfterLeave('u-1', 'u-1')
    expect(c.clears()).toBe(1)
    expect(c.sets).toEqual([])
  })
})
