// @vitest-environment node
// Account の query と command の分離（web-check-07）。本 slice の分: web-query-account-03・04、web-cmd-account-07〜13。
// (a) AccountQueries の入口の名前の集合 = 2（listSessions・listPasskeys）と、AccountCommands の入口 = 7（updateProfile・changePassword・deleteAccount・registerPasskey・deletePasskey・revokeSession・revokeOtherSessions）。型の等価と実行時の両方で過不足なく一致する。
// (b) 呼出を記録する手書きの AccountGateway の fake を渡し、query を全部呼んでも fake への記録は listSessions・listPasskeys だけ（書き込み 6 つと passkey の 4 method は 1 回も呼ばれない）。
// (c) command の戻り値はリードモデルでない（revokeOtherSessions は { readonly revoked: number }、他は void）。
// 型の等価は `npm run typecheck` が検査する。実行時の検査は vitest が行う。
// createAccountGateway・createGatewayDouble は import しない（unit が infrastructure を値で import すると forbiddenDependency になる）。
//
// RED 理由（実装前）: `@/lib/account/application/commands`・`queries` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createAccountCommands } from '@/lib/account/application/commands'
import type { AccountCommands } from '@/lib/account/application/commands'
import { createAccountQueries } from '@/lib/account/application/queries'
import type { AccountQueries } from '@/lib/account/application/queries'
import type { AccountGateway } from '@/lib/account/application/ports'
import type { PasskeyRow, SessionRow } from '@/lib/account/application/readModels'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'
import { createFakeWebAuthnBrowserPort } from '../helpers/fakeWebAuthnBrowserPort'

// ---------------------------------------------------------------------------
// 型の等価（実行しない。typecheck だけが読む）
// ---------------------------------------------------------------------------
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

type QueryNames = 'listSessions' | 'listPasskeys'
type CommandNames =
  | 'updateProfile'
  | 'changePassword'
  | 'deleteAccount'
  | 'registerPasskey'
  | 'deletePasskey'
  | 'revokeSession'
  | 'revokeOtherSessions'

function typeProbes(queries: AccountQueries, commands: AccountCommands): void {
  const queryKeys: Equals<keyof AccountQueries, QueryNames> = true
  const queryDepKeys: Equals<keyof Parameters<typeof createAccountQueries>[0], 'gateway'> = true
  const sessions: Equals<ReturnType<AccountQueries['listSessions']>, Promise<Result<ReadonlyArray<SessionRow>, ApiFailure>>> = true
  const passkeys: Equals<ReturnType<AccountQueries['listPasskeys']>, Promise<Result<ReadonlyArray<PasskeyRow>, ApiFailure>>> = true
  const commandKeys: Equals<keyof AccountCommands, CommandNames> = true
  const commandDepKeys: Equals<keyof Parameters<typeof createAccountCommands>[0], 'gateway' | 'webAuthn'> = true
  // (c) command の戻り値はリードモデルでなく、void と { readonly revoked: number }
  const update: Equals<ReturnType<AccountCommands['updateProfile']>, Promise<Result<void, ApiFailure>>> = true
  const change: Equals<ReturnType<AccountCommands['changePassword']>, Promise<Result<void, ApiFailure>>> = true
  const del: Equals<ReturnType<AccountCommands['deleteAccount']>, Promise<Result<void, ApiFailure>>> = true
  const register: Equals<ReturnType<AccountCommands['registerPasskey']>, Promise<Result<void, ApiFailure>>> = true
  const delPasskey: Equals<ReturnType<AccountCommands['deletePasskey']>, Promise<Result<void, ApiFailure>>> = true
  const revoke: Equals<ReturnType<AccountCommands['revokeSession']>, Promise<Result<void, ApiFailure>>> = true
  const revokeOthers: Equals<
    ReturnType<AccountCommands['revokeOtherSessions']>,
    Promise<Result<{ readonly revoked: number }, ApiFailure>>
  > = true
  void [queries, commands, queryKeys, queryDepKeys, sessions, passkeys, commandKeys, commandDepKeys]
  void [update, change, del, register, delPasskey, revoke, revokeOthers]
}
void typeProbes

// ---------------------------------------------------------------------------
// 呼出を記録する fake（書き込み系・passkey 系も記録してから返す。記録しなければ (b) に識別力が無い）
// ---------------------------------------------------------------------------
const READ_CALLS: ReadonlySet<string> = new Set(['listSessions', 'listPasskeys'])
const ALL_METHODS = [
  'changePassword',
  'deleteAccount',
  'deletePasskey',
  'getMe',
  'getPasskeyLoginOptions',
  'getPasskeyRegisterOptions',
  'listPasskeys',
  'listSessions',
  'login',
  'logout',
  'register',
  'revokeOtherSessions',
  'revokeSession',
  'updateProfile',
  'verifyPasskeyLogin',
  'verifyPasskeyRegistration',
]

const SESSION: SessionRow = { id: 's1', deviceLabel: 'Chrome', createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null, isCurrent: true }
const PASSKEY: PasskeyRow = { credentialId: 'c1', name: 'MacBook', createdAt: '2026-02-01T00:00:00Z', lastUsedAt: null }
const USER = { username: 'u', role: 'user', display_name: 'U', userId: 'u-1' } as const
const OK_VOID = { ok: true, value: undefined } as const

function harness() {
  const calls: string[] = []
  const record = <T>(name: string, value: T) => () => {
    calls.push(name)
    return Promise.resolve(value)
  }
  const gateway: AccountGateway = {
    getMe: record('getMe', { ok: true, value: USER }),
    login: record('login', { ok: true, value: USER }),
    register: record('register', { ok: true, value: USER }),
    logout: record('logout', OK_VOID),
    getPasskeyRegisterOptions: record('getPasskeyRegisterOptions', { ok: true, value: { challenge_id: 'cid', options: {} } }),
    getPasskeyLoginOptions: record('getPasskeyLoginOptions', { ok: true, value: { challenge_id: 'cid', options: {} } }),
    verifyPasskeyRegistration: record('verifyPasskeyRegistration', { ok: true, value: { status: 'ok' } }),
    verifyPasskeyLogin: record('verifyPasskeyLogin', { ok: true, value: { token: 't', user: USER } }),
    updateProfile: record('updateProfile', OK_VOID),
    changePassword: record('changePassword', OK_VOID),
    deleteAccount: record('deleteAccount', OK_VOID),
    deletePasskey: record('deletePasskey', OK_VOID),
    revokeSession: record('revokeSession', OK_VOID),
    listPasskeys: record('listPasskeys', { ok: true, value: [PASSKEY] }),
    listSessions: record('listSessions', { ok: true, value: [SESSION] }),
    revokeOtherSessions: record('revokeOtherSessions', { ok: true, value: { revoked: 2 } }),
  }
  return {
    queries: createAccountQueries({ gateway }),
    commands: createAccountCommands({ gateway, webAuthn: createFakeWebAuthnBrowserPort() }),
    calls,
    gateway,
  }
}

// ---------------------------------------------------------------------------
// (a) 名前の集合
// ---------------------------------------------------------------------------
describe('web-check-07 (a) query 2 つは過不足なく公開される', () => {
  test('web-check-07, web-query-account-03 — 戻り値の key は listSessions・listPasskeys の 2 つだけで、すべて関数', () => {
    const { queries } = harness()
    const names: readonly QueryNames[] = ['listSessions', 'listPasskeys']

    expect(names).toHaveLength(2)
    expect(Object.keys(queries).sort()).toEqual([...names].sort())
    for (const name of names) expect(typeof queries[name], name).toBe('function')
  })
})

describe('web-check-07 (a) command 7 つは過不足なく公開される', () => {
  test('web-check-07, web-cmd-account-07 — 戻り値の key は updateProfile・changePassword・deleteAccount・registerPasskey・deletePasskey・revokeSession・revokeOtherSessions の 7 つだけで、すべて関数', () => {
    const { commands } = harness()
    const names: readonly CommandNames[] = [
      'updateProfile',
      'changePassword',
      'deleteAccount',
      'registerPasskey',
      'deletePasskey',
      'revokeSession',
      'revokeOtherSessions',
    ]

    expect(names).toHaveLength(7)
    expect(Object.keys(commands).sort()).toEqual([...names].sort())
    for (const name of names) expect(typeof commands[name], name).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// (b) query は読むだけ
// ---------------------------------------------------------------------------
describe('web-check-07 (b) query を全部呼んでも、gateway への呼出は読み取りだけ', () => {
  test('web-query-account-03 — 正方向対照: listSessions() を呼べば fake に listSessions が 1 回だけ記録される（記録が配線されている）', async () => {
    const { queries, calls } = harness()

    await queries.listSessions()

    expect(calls).toEqual(['listSessions'])
  })

  test('web-query-account-04 — 正方向対照: listPasskeys() を呼べば fake に listPasskeys が 1 回だけ記録される（記録が配線されている）', async () => {
    const { queries, calls } = harness()

    await queries.listPasskeys()

    expect(calls).toEqual(['listPasskeys'])
  })

  test('web-check-07 — 2 つの query を全部呼んでも、記録は listSessions・listPasskeys の 2 種類だけ（書き込み 6 つと passkey の 4 method は 1 回も呼ばれない）', async () => {
    const { queries, calls, gateway } = harness()

    await queries.listSessions()
    await queries.listPasskeys()

    expect([...calls].sort()).toEqual(['listPasskeys', 'listSessions'])
    expect(calls.every((name) => READ_CALLS.has(name))).toBe(true)
    for (const other of ALL_METHODS.filter((name) => !READ_CALLS.has(name))) expect(calls).not.toContain(other)
    // fake は 16 method を持ち（書き込み系も記録する形で用意している）、query が呼べば記録に残る
    expect(Object.keys(gateway).sort()).toEqual(ALL_METHODS)
  })
})

// ---------------------------------------------------------------------------
// (c) 戻り値はリードモデルでない
// ---------------------------------------------------------------------------
describe('web-check-07 (c) command の戻り値はリードモデルでない', () => {
  test('web-cmd-account-13 — revokeOtherSessions は { revoked } だけ、他の command は void（undefined）', async () => {
    const { commands } = harness()

    const revoked = await commands.revokeOtherSessions()
    expect(revoked).toEqual({ ok: true, value: { revoked: 2 } })
    if (revoked.ok) expect(Object.keys(revoked.value)).toEqual(['revoked'])

    for (const result of [
      await commands.updateProfile('n'),
      await commands.changePassword('a', 'b'),
      await commands.deleteAccount('p'),
      await commands.registerPasskey(),
      await commands.deletePasskey('c'),
      await commands.revokeSession('s'),
    ]) {
      expect(result).toEqual({ ok: true, value: undefined })
    }
  })
})
