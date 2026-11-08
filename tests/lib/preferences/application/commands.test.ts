// @vitest-environment node
// Preferences application の command: setDefaultDifficulty（web-cmd-prefs-02・web-rule-prefs-03）・setWeeklyGoal（web-cmd-prefs-03）。
// 手書きの PreferencesGateway fake を渡す。`createGatewayDouble`・infrastructure は import しない（期待値は literal）。
//
// RED 理由（実装前）: `setDefaultPlaybackSpeed` と deps の `localSettings` が無い（setDefaultPlaybackSpeed is not a function）。
import { describe, expect, test } from 'vitest'
import { createPreferencesCommands } from '@/lib/preferences/application/commands'
import type { LocalSettingsPort, PreferencesGateway, PreferencesPatch } from '@/lib/preferences/application/ports'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

type PatchResult = Result<void, ApiFailure>

interface Deferred {
  resolve(value: PatchResult): void
  reject(reason: unknown): void
}

/** localSettings.set に渡った記述子の id（domain を値で import せず、id で比べる）。 */
interface LocalSet {
  readonly id: string
  readonly value: unknown
}

/**
 * patch の呼出ごとに保留した Promise を作り、テストの側で決着させる fake。get は呼ばれたら記録して reject する。
 * localSettings.set と patch の呼出は共有の順序ログ（order）へ積む。
 */
function harness() {
  const patches: PreferencesPatch[] = []
  const pending: Deferred[] = []
  const getCalls: string[] = []
  const order: string[] = []
  const localSets: LocalSet[] = []
  const localSettings: LocalSettingsPort = {
    get: () => {
      throw new Error('get は command から呼ばれない')
    },
    set: (setting, value) => {
      order.push('set')
      localSets.push({ id: setting.id, value })
    },
  }
  const gateway: PreferencesGateway = {
    get: () => {
      getCalls.push('get')
      return Promise.reject(new Error('get は command から呼ばれない'))
    },
    patch: (patch) => {
      order.push('patch')
      patches.push(patch)
      return new Promise<PatchResult>((resolve, reject) => {
        pending.push({ resolve, reject })
      })
    },
  }
  return { gateway, localSettings, patches, pending, getCalls, order, localSets }
}

const OK: PatchResult = { ok: true, value: undefined }
const SERVER_FAILURE: ApiFailure = { kind: 'server', status: 500 }
const STALE = { ok: true, value: { stale: true } } as const

describe('setDefaultDifficulty: 最新の要求だけを反映する (web-rule-prefs-03・web-cmd-prefs-02)', () => {
  test('web-cmd-prefs-02: 単独の要求の成功は { stale: false }。patch は { kind: defaultDifficulty, value } で 1 回、get は呼ばない', async () => {
    const { gateway, localSettings, patches, pending, getCalls } = harness()
    const commands = createPreferencesCommands({ gateway, localSettings })

    const result = commands.setDefaultDifficulty('eiken_p1')
    pending[0].resolve(OK)

    expect(await result).toEqual({ ok: true, value: { stale: false } })
    expect(patches).toEqual([{ kind: 'defaultDifficulty', value: 'eiken_p1' }])
    expect(getCalls).toEqual([])
  })

  test('web-cmd-prefs-02: 単独の要求の失敗は同じ failure の ok: false', async () => {
    const { gateway, localSettings, pending } = harness()
    const commands = createPreferencesCommands({ gateway, localSettings })

    const result = commands.setDefaultDifficulty('eiken_p1')
    pending[0].resolve({ ok: false, failure: SERVER_FAILURE })

    const settled = await result
    expect(settled.ok).toBe(false)
    if (settled.ok) return
    expect(settled.failure).toBe(SERVER_FAILURE)
  })

  test.each<[string, PatchResult]>([
    ['成功', OK],
    ['API 失敗', { ok: false, failure: SERVER_FAILURE }],
  ])('web-rule-prefs-03: 先の要求の %s が後から届いても { ok: true, value: { stale: true } }。最新の要求は { stale: false }', async (_label, firstOutcome) => {
    const { gateway, localSettings, pending } = harness()
    const commands = createPreferencesCommands({ gateway, localSettings })

    const first = commands.setDefaultDifficulty('eiken_p1')
    const second = commands.setDefaultDifficulty('ielts_7')
    pending[1].resolve(OK)
    expect(await second).toEqual({ ok: true, value: { stale: false } })
    pending[0].resolve(firstOutcome)

    expect(await first).toEqual(STALE)
  })

  test('web-rule-prefs-03: 先の要求が先に決着しても、後続の要求が始まった時点で最新でなくなる（決着の順に依らない）', async () => {
    const { gateway, localSettings, pending } = harness()
    const commands = createPreferencesCommands({ gateway, localSettings })

    const first = commands.setDefaultDifficulty('eiken_p1')
    const second = commands.setDefaultDifficulty('ielts_7')
    pending[0].resolve(OK)
    pending[1].resolve({ ok: false, failure: SERVER_FAILURE })

    expect(await first).toEqual(STALE)
    const settled = await second
    expect(settled.ok).toBe(false)
    if (settled.ok) return
    expect(settled.failure).toBe(SERVER_FAILURE)
  })

  test('web-rule-prefs-03: 最新の要求の reject は握りつぶさず、そのまま reject する', async () => {
    const { gateway, localSettings, pending } = harness()
    const commands = createPreferencesCommands({ gateway, localSettings })

    const result = commands.setDefaultDifficulty('eiken_p1')
    pending[0].reject(new Error('network down'))

    await expect(result).rejects.toThrow('network down')
  })

  test('web-rule-prefs-03: 先の要求の reject は { ok: true, value: { stale: true } } にする（戻しを起こさない）', async () => {
    const { gateway, localSettings, pending } = harness()
    const commands = createPreferencesCommands({ gateway, localSettings })

    const first = commands.setDefaultDifficulty('eiken_p1')
    const second = commands.setDefaultDifficulty('ielts_7')
    pending[1].resolve(OK)
    await second
    pending[0].reject(new Error('late failure'))

    expect(await first).toEqual(STALE)
  })

  test('web-rule-prefs-03: 連番は createPreferencesCommands の呼出ごとに独立している（別 instance の要求で stale にならない）', async () => {
    const a = harness()
    const b = harness()
    const commandsA = createPreferencesCommands({ gateway: a.gateway, localSettings: a.localSettings })
    const commandsB = createPreferencesCommands({ gateway: b.gateway, localSettings: b.localSettings })

    const fromA = commandsA.setDefaultDifficulty('eiken_p1')
    const fromB = commandsB.setDefaultDifficulty('ielts_7')
    b.pending[0].resolve(OK)
    await fromB
    a.pending[0].resolve(OK)

    expect(await fromA).toEqual({ ok: true, value: { stale: false } })
  })

  test('web-cmd-prefs-02: 同じ command object を通れば連番を共有する（後から呼んだ要求が最新になる）', async () => {
    const { gateway, localSettings, patches, pending } = harness()
    const commands = createPreferencesCommands({ gateway, localSettings })

    const first = commands.setDefaultDifficulty('eiken_p1')
    const second = commands.setDefaultDifficulty('eiken_p1')
    pending[0].resolve(OK)
    pending[1].resolve(OK)

    expect(patches).toHaveLength(2)
    expect(await first).toEqual(STALE)
    expect(await second).toEqual({ ok: true, value: { stale: false } })
  })
})

describe('setWeeklyGoal (web-cmd-prefs-03)', () => {
  test('web-cmd-prefs-03: patch を { kind: weeklyGoal, value } で 1 回呼び、成功は { ok: true, value: undefined }。get は呼ばない', async () => {
    const { gateway, localSettings, patches, pending, getCalls } = harness()
    const commands = createPreferencesCommands({ gateway, localSettings })

    const result = commands.setWeeklyGoal(7)
    pending[0].resolve(OK)

    expect(await result).toEqual({ ok: true, value: undefined })
    expect(patches).toEqual([{ kind: 'weeklyGoal', value: 7 }])
    expect(getCalls).toEqual([])
  })

  test('web-cmd-prefs-03: 連続して呼んでも連番を持たず、両方 ok で patch も 2 回送る', async () => {
    const { gateway, localSettings, patches, pending } = harness()
    const commands = createPreferencesCommands({ gateway, localSettings })

    const first = commands.setWeeklyGoal(5)
    const second = commands.setWeeklyGoal(10)
    pending[1].resolve(OK)
    pending[0].resolve(OK)

    expect(await first).toEqual({ ok: true, value: undefined })
    expect(await second).toEqual({ ok: true, value: undefined })
    expect(patches).toEqual([
      { kind: 'weeklyGoal', value: 5 },
      { kind: 'weeklyGoal', value: 10 },
    ])
  })

  test('web-cmd-prefs-03: API 失敗は同じ failure の ok: false で返す', async () => {
    const { gateway, localSettings, pending } = harness()
    const commands = createPreferencesCommands({ gateway, localSettings })

    const result = commands.setWeeklyGoal(3)
    pending[0].resolve({ ok: false, failure: SERVER_FAILURE })

    const settled = await result
    expect(settled.ok).toBe(false)
    if (settled.ok) return
    expect(settled.failure).toBe(SERVER_FAILURE)
  })

  test('web-cmd-prefs-03: reject は握りつぶさず、そのまま reject する', async () => {
    const { gateway, localSettings, pending } = harness()
    const commands = createPreferencesCommands({ gateway, localSettings })

    const result = commands.setWeeklyGoal(3)
    pending[0].reject(new Error('network down'))

    await expect(result).rejects.toThrow('network down')
  })

  test('web-cmd-prefs-03: 週の目標の要求は難易度の連番に影響しない（難易度の要求が stale にならない）', async () => {
    const { gateway, localSettings, pending } = harness()
    const commands = createPreferencesCommands({ gateway, localSettings })

    const difficulty = commands.setDefaultDifficulty('eiken_p1')
    const goal = commands.setWeeklyGoal(5)
    pending[1].resolve(OK)
    await goal
    pending[0].resolve(OK)

    expect(await difficulty).toEqual({ ok: true, value: { stale: false } })
  })
})

const SPEED_ID = 'defaultPlaybackSpeed'

describe('setDefaultPlaybackSpeed: 端末へ即時、続けて保存 (web-cmd-prefs-04・web-dec-12)', () => {
  test('web-cmd-prefs-04: web-dec-12: 端末へ先に set（記述子と 1.5）し、続けて patch を { kind: defaultPlaybackSpeed, value: 1.5 } で 1 回。get は呼ばない', async () => {
    const { gateway, localSettings, patches, pending, getCalls, order, localSets } = harness()
    const commands = createPreferencesCommands({ gateway, localSettings })

    const result = commands.setDefaultPlaybackSpeed(1.5)
    // patch の決着を待たず、同期区間で端末と gateway の両方へ届いている。
    expect(order).toEqual(['set', 'patch'])
    pending[0].resolve(OK)

    expect(await result).toEqual({ ok: true, value: { stale: false } })
    expect(localSets).toEqual([{ id: SPEED_ID, value: 1.5 }])
    expect(patches).toEqual([{ kind: 'defaultPlaybackSpeed', value: 1.5 }])
    expect(getCalls).toEqual([])
  })
})

describe('setDefaultPlaybackSpeed: 結果は 3 通り (web-cmd-prefs-04・web-dec-14)', () => {
  test('web-cmd-prefs-04: 単独の要求の成功は { stale: false }', async () => {
    const { gateway, localSettings, pending } = harness()
    const commands = createPreferencesCommands({ gateway, localSettings })

    const result = commands.setDefaultPlaybackSpeed(1.25)
    pending[0].resolve(OK)

    expect(await result).toEqual({ ok: true, value: { stale: false } })
  })

  test('web-cmd-prefs-04: 単独の要求の失敗は同じ failure の ok: false', async () => {
    const { gateway, localSettings, pending } = harness()
    const commands = createPreferencesCommands({ gateway, localSettings })

    const result = commands.setDefaultPlaybackSpeed(1.25)
    pending[0].resolve({ ok: false, failure: SERVER_FAILURE })

    const settled = await result
    expect(settled.ok).toBe(false)
    if (settled.ok) return
    expect(settled.failure).toBe(SERVER_FAILURE)
  })

  test.each<[string, PatchResult]>([
    ['成功', OK],
    ['API 失敗', { ok: false, failure: SERVER_FAILURE }],
  ])('web-dec-14: 先の速度の要求の %s が後から届いても { ok: true, value: { stale: true } }。最新の要求は { stale: false }', async (_label, firstOutcome) => {
    const { gateway, localSettings, pending } = harness()
    const commands = createPreferencesCommands({ gateway, localSettings })

    const first = commands.setDefaultPlaybackSpeed(1.25)
    const second = commands.setDefaultPlaybackSpeed(1.75)
    pending[1].resolve(OK)
    expect(await second).toEqual({ ok: true, value: { stale: false } })
    pending[0].resolve(firstOutcome)

    expect(await first).toEqual(STALE)
  })

  test('web-dec-14: 先の要求が先に決着しても、後続の要求が始まった時点で最新でなくなる（決着の順に依らない）', async () => {
    const { gateway, localSettings, pending } = harness()
    const commands = createPreferencesCommands({ gateway, localSettings })

    const first = commands.setDefaultPlaybackSpeed(1.25)
    const second = commands.setDefaultPlaybackSpeed(1.75)
    pending[0].resolve(OK)
    pending[1].resolve({ ok: false, failure: SERVER_FAILURE })

    expect(await first).toEqual(STALE)
    const settled = await second
    expect(settled.ok).toBe(false)
    if (settled.ok) return
    expect(settled.failure).toBe(SERVER_FAILURE)
  })

  test('web-dec-14: 最新の要求の reject は握りつぶさず、ok: false にも変えず、そのまま reject する', async () => {
    const { gateway, localSettings, pending } = harness()
    const commands = createPreferencesCommands({ gateway, localSettings })

    const result = commands.setDefaultPlaybackSpeed(1.25)
    pending[0].reject(new Error('network down'))

    await expect(result).rejects.toThrow('network down')
  })

  test('web-dec-14: 先の要求の reject は { ok: true, value: { stale: true } } にする（戻しを起こさない）', async () => {
    const { gateway, localSettings, pending } = harness()
    const commands = createPreferencesCommands({ gateway, localSettings })

    const first = commands.setDefaultPlaybackSpeed(1.25)
    const second = commands.setDefaultPlaybackSpeed(1.75)
    pending[1].resolve(OK)
    await second
    pending[0].reject(new Error('late failure'))

    expect(await first).toEqual(STALE)
  })
})

describe('setDefaultPlaybackSpeed: command は registry を戻さない (web-dec-132)', () => {
  test('web-dec-132: 失敗・reject・stale のどの結果でも、端末への set は要求ごとに 1 回だけ（戻しの書込が無い）', async () => {
    const { gateway, localSettings, pending, localSets } = harness()
    const commands = createPreferencesCommands({ gateway, localSettings })

    const failed = commands.setDefaultPlaybackSpeed(1.25)
    pending[0].resolve({ ok: false, failure: SERVER_FAILURE })
    await failed
    expect(localSets).toEqual([{ id: SPEED_ID, value: 1.25 }])

    const rejected = commands.setDefaultPlaybackSpeed(1.5)
    pending[1].reject(new Error('network down'))
    await expect(rejected).rejects.toThrow('network down')
    expect(localSets).toEqual([
      { id: SPEED_ID, value: 1.25 },
      { id: SPEED_ID, value: 1.5 },
    ])

    const stale = commands.setDefaultPlaybackSpeed(1.75)
    const latest = commands.setDefaultPlaybackSpeed(2)
    pending[2].resolve({ ok: false, failure: SERVER_FAILURE })
    pending[3].resolve(OK)
    expect(await stale).toEqual(STALE)
    expect(await latest).toEqual({ ok: true, value: { stale: false } })
    expect(localSets.map((s) => s.value)).toEqual([1.25, 1.5, 1.75, 2])
  })
})

describe('setDefaultPlaybackSpeed: 連番は難易度と別 (web-dec-14)', () => {
  test('web-dec-14: 難易度と速度を交互に出して逆順に決着しても、速度の最新は stale: false、先の速度は stale: true（難易度も同様）', async () => {
    const { gateway, localSettings, pending } = harness()
    const commands = createPreferencesCommands({ gateway, localSettings })

    const d1 = commands.setDefaultDifficulty('eiken_p1')
    const s1 = commands.setDefaultPlaybackSpeed(1.25)
    const d2 = commands.setDefaultDifficulty('ielts_7')
    const s2 = commands.setDefaultPlaybackSpeed(1.75)
    pending[3].resolve(OK)
    pending[2].resolve(OK)
    pending[1].resolve(OK)
    pending[0].resolve(OK)

    expect(await s2).toEqual({ ok: true, value: { stale: false } })
    expect(await d2).toEqual({ ok: true, value: { stale: false } })
    expect(await s1).toEqual(STALE)
    expect(await d1).toEqual(STALE)
  })

  test('web-dec-14: 難易度だけの要求は速度の要求に、速度だけの要求は難易度の要求に影響されず最新のまま', async () => {
    const { gateway, localSettings, pending } = harness()
    const commands = createPreferencesCommands({ gateway, localSettings })

    const difficulty = commands.setDefaultDifficulty('eiken_p1')
    const speed = commands.setDefaultPlaybackSpeed(1.5)
    pending[1].resolve(OK)
    await speed
    pending[0].resolve(OK)
    expect(await difficulty).toEqual({ ok: true, value: { stale: false } })

    const speedFirst = commands.setDefaultPlaybackSpeed(1.25)
    const difficultyLater = commands.setDefaultDifficulty('ielts_7')
    pending[3].resolve(OK)
    await difficultyLater
    pending[2].resolve(OK)
    expect(await speedFirst).toEqual({ ok: true, value: { stale: false } })
  })

  test('web-cmd-prefs-04: 速度の連番は createPreferencesCommands の呼出ごとに独立している', async () => {
    const a = harness()
    const b = harness()
    const commandsA = createPreferencesCommands({ gateway: a.gateway, localSettings: a.localSettings })
    const commandsB = createPreferencesCommands({ gateway: b.gateway, localSettings: b.localSettings })

    const fromA = commandsA.setDefaultPlaybackSpeed(1.25)
    const fromB = commandsB.setDefaultPlaybackSpeed(1.75)
    b.pending[0].resolve(OK)
    await fromB
    a.pending[0].resolve(OK)

    expect(await fromA).toEqual({ ok: true, value: { stale: false } })
  })
})
