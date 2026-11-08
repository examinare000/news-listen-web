// @vitest-environment node
// Preferences の command / query の分離（web-check-07）。
// (a) PreferencesCommands の入口 = {setDefaultDifficulty, setDefaultPlaybackSpeed, setWeeklyGoal}、PreferencesQueries の入口 = {getServerPreferences}。型の等価と実行時の両方で過不足なく一致する。
//     deps は command が gateway・localSettings、query は gateway だけ（registry の get・set・ready・clearSubjectScoped は数えない）。
// (b) 呼出を記録する手書きの PreferencesGateway の fake を渡し、query を呼んでも記録は get だけ（patch は 0 回）。command は patch だけを記録し get は呼ばない。
// (c) command の戻り値はリードモデルでない（setDefaultDifficulty・setDefaultPlaybackSpeed は { stale }、setWeeklyGoal は void）。
// 型の等価は `npm run typecheck` が検査する（等価でなければ代入が TS2322 で落ちる）。実行時の検査は vitest が行う。
// createPreferencesGateway・createGatewayDouble は import しない（unit が infrastructure を値で import すると forbiddenDependency になる）。
//
// RED 理由（実装前）: `@/lib/preferences/application/{commands,queries}` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createPreferencesCommands } from '@/lib/preferences/application/commands'
import type { PreferencesCommands } from '@/lib/preferences/application/commands'
import { createPreferencesQueries } from '@/lib/preferences/application/queries'
import type { PreferencesQueries } from '@/lib/preferences/application/queries'
import type { LocalSettingsPort, PreferencesGateway } from '@/lib/preferences/application/ports'
import type { ServerPreferencesView } from '@/lib/preferences/application/readModels'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

// ---------------------------------------------------------------------------
// 型の等価（実行しない。typecheck だけが読む）
// ---------------------------------------------------------------------------
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

type QueryNames = 'getServerPreferences'
type CommandNames = 'setDefaultDifficulty' | 'setDefaultPlaybackSpeed' | 'setWeeklyGoal'

function typeProbes(): void {
  const queryKeys: Equals<keyof PreferencesQueries, QueryNames> = true
  const commandKeys: Equals<keyof PreferencesCommands, CommandNames> = true
  // deps は query が gateway だけ、command が gateway と localSettings
  const queryDepKeys: Equals<keyof Parameters<typeof createPreferencesQueries>[0], 'gateway'> = true
  const commandDepKeys: Equals<keyof Parameters<typeof createPreferencesCommands>[0], 'gateway' | 'localSettings'> = true
  // (c) query の戻り値はリードモデル、command の戻り値はリードモデルでない
  const get: Equals<ReturnType<PreferencesQueries['getServerPreferences']>, Promise<Result<ServerPreferencesView, ApiFailure>>> = true
  const difficulty: Equals<
    ReturnType<PreferencesCommands['setDefaultDifficulty']>,
    Promise<Result<{ readonly stale: boolean }, ApiFailure>>
  > = true
  const speed: Equals<
    ReturnType<PreferencesCommands['setDefaultPlaybackSpeed']>,
    Promise<Result<{ readonly stale: boolean }, ApiFailure>>
  > = true
  const goal: Equals<ReturnType<PreferencesCommands['setWeeklyGoal']>, Promise<Result<void, ApiFailure>>> = true
  void [queryKeys, commandKeys, queryDepKeys, commandDepKeys, get, difficulty, speed, goal]
}
void typeProbes

// ---------------------------------------------------------------------------
// 呼出を記録する fake（patch も記録してから返す。記録しなければ (b) に識別力が無い）
// ---------------------------------------------------------------------------
function harness() {
  const calls: string[] = []
  const gateway: PreferencesGateway = {
    get: () => {
      calls.push('get')
      return Promise.resolve({
        ok: true,
        value: { defaultDifficulty: 'toeic_600', weeklyGoal: 3, defaultPlaybackSpeed: 1, digest: { enabled: true, articleCount: 10 } },
      })
    },
    patch: () => {
      calls.push('patch')
      return Promise.resolve({ ok: true, value: undefined })
    },
  }
  // 端末への書込は no-op（このファイルは入口と呼び先の過不足だけを見る）。
  const localSettings: LocalSettingsPort = { get: () => { throw new Error('get は command から呼ばれない') }, set: () => {} }
  return { gateway, localSettings, calls }
}

describe('web-check-07 (a) 入口の集合は過不足なく公開される', () => {
  test('web-check-07, web-query-prefs-02 — query の key は getServerPreferences だけで、関数', () => {
    const { gateway } = harness()
    const queries = createPreferencesQueries({ gateway })
    const names: readonly QueryNames[] = ['getServerPreferences']

    expect(Object.keys(queries).sort()).toEqual([...names].sort())
    for (const name of names) expect(typeof queries[name], name).toBe('function')
  })

  test('web-check-07, web-cmd-prefs-02, web-cmd-prefs-03 — command の key は setDefaultDifficulty・setDefaultPlaybackSpeed・setWeeklyGoal の 3 つだけで、すべて関数', () => {
    const { gateway, localSettings } = harness()
    const commands = createPreferencesCommands({ gateway, localSettings })
    const names: readonly CommandNames[] = ['setDefaultDifficulty', 'setDefaultPlaybackSpeed', 'setWeeklyGoal']

    expect(Object.keys(commands).sort()).toEqual([...names].sort())
    for (const name of names) expect(typeof commands[name], name).toBe('function')
  })
})

describe('web-check-07 (b) query は読むだけ、command は書くだけ', () => {
  test('web-query-prefs-02 — 正方向対照: getServerPreferences() を呼べば fake に get が 1 回だけ記録される（patch は 0 回）', async () => {
    const { gateway, calls } = harness()

    await createPreferencesQueries({ gateway }).getServerPreferences()

    expect(calls).toEqual(['get'])
  })

  test('web-cmd-prefs-02 — 正方向対照: setDefaultDifficulty() を呼べば fake に patch が 1 回だけ記録される（get は 0 回）', async () => {
    const { gateway, localSettings, calls } = harness()

    await createPreferencesCommands({ gateway, localSettings }).setDefaultDifficulty('eiken_2')

    expect(calls).toEqual(['patch'])
  })

  test('web-cmd-prefs-03 — 正方向対照: setWeeklyGoal() を呼べば fake に patch が 1 回だけ記録される（get は 0 回）', async () => {
    const { gateway, localSettings, calls } = harness()

    await createPreferencesCommands({ gateway, localSettings }).setWeeklyGoal(7)

    expect(calls).toEqual(['patch'])
  })
})

describe('web-check-07 (b) 速度の command も書くだけ', () => {
  test('web-cmd-prefs-04 — 正方向対照: setDefaultPlaybackSpeed() を呼べば fake に patch が 1 回だけ記録される（get は 0 回）', async () => {
    const { gateway, localSettings, calls } = harness()

    await createPreferencesCommands({ gateway, localSettings }).setDefaultPlaybackSpeed(1.5)

    expect(calls).toEqual(['patch'])
  })
})

describe('web-check-07 (c) command の戻り値はリードモデルでない', () => {
  test('web-cmd-prefs-04 — setDefaultPlaybackSpeed の成功の値は stale だけで、設定のリードモデルを持たない', async () => {
    const { gateway, localSettings } = harness()

    const result = await createPreferencesCommands({ gateway, localSettings }).setDefaultPlaybackSpeed(1.5)

    expect(result.ok && Object.keys(result.value)).toEqual(['stale'])
  })

  test('web-cmd-prefs-02 — setDefaultDifficulty の成功の値は stale だけで、設定のリードモデルを持たない', async () => {
    const { gateway, localSettings } = harness()

    const result = await createPreferencesCommands({ gateway, localSettings }).setDefaultDifficulty('eiken_2')

    expect(result.ok && Object.keys(result.value)).toEqual(['stale'])
  })

  test('web-cmd-prefs-03 — setWeeklyGoal の成功の値は undefined（void）', async () => {
    const { gateway, localSettings } = harness()

    const result = await createPreferencesCommands({ gateway, localSettings }).setWeeklyGoal(7)

    expect(result).toEqual({ ok: true, value: undefined })
  })
})
