// @vitest-environment node
// Preferences application の command: setDefaultDifficulty（web-cmd-prefs-02・web-rule-prefs-03）・setWeeklyGoal（web-cmd-prefs-03）。
// 手書きの PreferencesGateway fake を渡す。`createGatewayDouble`・infrastructure は import しない（期待値は literal）。
//
// RED 理由（実装前）: `@/lib/preferences/application/commands` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createPreferencesCommands } from '@/lib/preferences/application/commands'
import type { PreferencesGateway, PreferencesPatch } from '@/lib/preferences/application/ports'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

type PatchResult = Result<void, ApiFailure>

interface Deferred {
  resolve(value: PatchResult): void
  reject(reason: unknown): void
}

/** patch の呼出ごとに保留した Promise を作り、テストの側で決着させる fake。get は呼ばれたら記録して reject する。 */
function harness() {
  const patches: PreferencesPatch[] = []
  const pending: Deferred[] = []
  const getCalls: string[] = []
  const gateway: PreferencesGateway = {
    get: () => {
      getCalls.push('get')
      return Promise.reject(new Error('get は command から呼ばれない'))
    },
    patch: (patch) => {
      patches.push(patch)
      return new Promise<PatchResult>((resolve, reject) => {
        pending.push({ resolve, reject })
      })
    },
  }
  return { gateway, patches, pending, getCalls }
}

const OK: PatchResult = { ok: true, value: undefined }
const SERVER_FAILURE: ApiFailure = { kind: 'server', status: 500 }
const STALE = { ok: true, value: { stale: true } } as const

describe('setDefaultDifficulty: 最新の要求だけを反映する (web-rule-prefs-03・web-cmd-prefs-02)', () => {
  test('web-cmd-prefs-02: 単独の要求の成功は { stale: false }。patch は { kind: defaultDifficulty, value } で 1 回、get は呼ばない', async () => {
    const { gateway, patches, pending, getCalls } = harness()
    const commands = createPreferencesCommands({ gateway })

    const result = commands.setDefaultDifficulty('eiken_p1')
    pending[0].resolve(OK)

    expect(await result).toEqual({ ok: true, value: { stale: false } })
    expect(patches).toEqual([{ kind: 'defaultDifficulty', value: 'eiken_p1' }])
    expect(getCalls).toEqual([])
  })

  test('web-cmd-prefs-02: 単独の要求の失敗は同じ failure の ok: false', async () => {
    const { gateway, pending } = harness()
    const commands = createPreferencesCommands({ gateway })

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
    const { gateway, pending } = harness()
    const commands = createPreferencesCommands({ gateway })

    const first = commands.setDefaultDifficulty('eiken_p1')
    const second = commands.setDefaultDifficulty('ielts_7')
    pending[1].resolve(OK)
    expect(await second).toEqual({ ok: true, value: { stale: false } })
    pending[0].resolve(firstOutcome)

    expect(await first).toEqual(STALE)
  })

  test('web-rule-prefs-03: 先の要求が先に決着しても、後続の要求が始まった時点で最新でなくなる（決着の順に依らない）', async () => {
    const { gateway, pending } = harness()
    const commands = createPreferencesCommands({ gateway })

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
    const { gateway, pending } = harness()
    const commands = createPreferencesCommands({ gateway })

    const result = commands.setDefaultDifficulty('eiken_p1')
    pending[0].reject(new Error('network down'))

    await expect(result).rejects.toThrow('network down')
  })

  test('web-rule-prefs-03: 先の要求の reject は { ok: true, value: { stale: true } } にする（戻しを起こさない）', async () => {
    const { gateway, pending } = harness()
    const commands = createPreferencesCommands({ gateway })

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
    const commandsA = createPreferencesCommands({ gateway: a.gateway })
    const commandsB = createPreferencesCommands({ gateway: b.gateway })

    const fromA = commandsA.setDefaultDifficulty('eiken_p1')
    const fromB = commandsB.setDefaultDifficulty('ielts_7')
    b.pending[0].resolve(OK)
    await fromB
    a.pending[0].resolve(OK)

    expect(await fromA).toEqual({ ok: true, value: { stale: false } })
  })

  test('web-cmd-prefs-02: 同じ command object を通れば連番を共有する（後から呼んだ要求が最新になる）', async () => {
    const { gateway, patches, pending } = harness()
    const commands = createPreferencesCommands({ gateway })

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
    const { gateway, patches, pending, getCalls } = harness()
    const commands = createPreferencesCommands({ gateway })

    const result = commands.setWeeklyGoal(7)
    pending[0].resolve(OK)

    expect(await result).toEqual({ ok: true, value: undefined })
    expect(patches).toEqual([{ kind: 'weeklyGoal', value: 7 }])
    expect(getCalls).toEqual([])
  })

  test('web-cmd-prefs-03: 連続して呼んでも連番を持たず、両方 ok で patch も 2 回送る', async () => {
    const { gateway, patches, pending } = harness()
    const commands = createPreferencesCommands({ gateway })

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
    const { gateway, pending } = harness()
    const commands = createPreferencesCommands({ gateway })

    const result = commands.setWeeklyGoal(3)
    pending[0].resolve({ ok: false, failure: SERVER_FAILURE })

    const settled = await result
    expect(settled.ok).toBe(false)
    if (settled.ok) return
    expect(settled.failure).toBe(SERVER_FAILURE)
  })

  test('web-cmd-prefs-03: reject は握りつぶさず、そのまま reject する', async () => {
    const { gateway, pending } = harness()
    const commands = createPreferencesCommands({ gateway })

    const result = commands.setWeeklyGoal(3)
    pending[0].reject(new Error('network down'))

    await expect(result).rejects.toThrow('network down')
  })

  test('web-cmd-prefs-03: 週の目標の要求は難易度の連番に影響しない（難易度の要求が stale にならない）', async () => {
    const { gateway, pending } = harness()
    const commands = createPreferencesCommands({ gateway })

    const difficulty = commands.setDefaultDifficulty('eiken_p1')
    const goal = commands.setWeeklyGoal(5)
    pending[1].resolve(OK)
    await goal
    pending[0].resolve(OK)

    expect(await difficulty).toEqual({ ok: true, value: { stale: false } })
  })
})
