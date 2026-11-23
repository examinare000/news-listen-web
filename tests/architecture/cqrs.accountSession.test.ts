// @vitest-environment node
// 認証 session の query と command の分離（web-check-07）。createAccountSession の戻り値の公開面。
// (a) query の入口 = 4（session・view・currentUserId・subscribe）、command の入口 = 8（login・register・loginWithPasskey・logout・resolveSession・retry・expire・registerSubjectLeaveStep）。型の等価と実行時の両方で過不足なく一致する。
// (b) query を何度呼んでも、gateway・後始末・回収・通知の解除・写しの fake への記録は 0（購読の登録・解除も副作用を起こさない）。
// (c) command の戻り値はリードモデルでない（resolveSession は { cleanup } だけ、login は { ok: true, value: undefined }）。
// 型の等価は `npm run typecheck` が検査する。実行時の検査は vitest が行う。
// 本物の infrastructure は import しない（unit が infrastructure を値で import すると forbiddenDependency になる）。
//
// RED 理由（実装前）: `@/lib/account/application/accountSession` が無い（module not found）。
import { describe, expect, test, vi } from 'vitest'
import { createAccountSession } from '@/lib/account/application/accountSession'
import type {
  AccountSessionCommands,
  AccountSessionDeps,
  AccountSessionQueries,
  RefreshMeResult,
} from '@/lib/account/application/accountSession'
import type { AccountGateway, WebAuthnPort } from '@/lib/account/application/ports'
import type { AuthSessionUser } from '@/lib/account/domain/authSession'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

// ---------------------------------------------------------------------------
// 型の等価（実行しない。typecheck だけが読む）
// ---------------------------------------------------------------------------
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

type QueryNames = 'session' | 'view' | 'currentUserId' | 'subscribe'
type CommandNames =
  | 'login'
  | 'register'
  | 'loginWithPasskey'
  | 'logout'
  | 'resolveSession'
  | 'retry'
  | 'expire'
  | 'registerSubjectLeaveStep'
type DepNames =
  | 'gateway'
  | 'webAuthn'
  | 'cleanupSteps'
  | 'reclaim'
  | 'detachNotifications'
  | 'speed'
  | 'initialSession'

function typeProbes(queries: AccountSessionQueries, commands: AccountSessionCommands): void {
  const queryKeys: Equals<keyof AccountSessionQueries, QueryNames> = true
  const commandKeys: Equals<keyof AccountSessionCommands, CommandNames> = true
  const depKeys: Equals<keyof AccountSessionDeps, DepNames> = true
  const resolve: Equals<ReturnType<AccountSessionCommands['resolveSession']>, Promise<RefreshMeResult>> = true
  const login: Equals<ReturnType<AccountSessionCommands['login']>, Promise<Result<void, ApiFailure>>> = true
  const register: Equals<ReturnType<AccountSessionCommands['register']>, Promise<Result<void, ApiFailure>>> = true
  const passkey: Equals<ReturnType<AccountSessionCommands['loginWithPasskey']>, Promise<Result<void, ApiFailure>>> = true
  const logout: Equals<ReturnType<AccountSessionCommands['logout']>, Promise<void>> = true
  const retry: Equals<ReturnType<AccountSessionCommands['retry']>, Promise<void>> = true
  const expire: Equals<ReturnType<AccountSessionCommands['expire']>, void> = true
  const leave: Equals<ReturnType<AccountSessionCommands['registerSubjectLeaveStep']>, () => void> = true
  const refreshResult: Equals<RefreshMeResult, { readonly cleanup: 'done' | 'incomplete' | 'skipped' }> = true
  void [queries, commands, queryKeys, commandKeys, depKeys]
  void [resolve, login, register, passkey, logout, retry, expire, leave, refreshResult]
}
void typeProbes

// ---------------------------------------------------------------------------
// 呼出を記録する fake（query が副作用を起こせば記録に残る）
// ---------------------------------------------------------------------------
const USER: AuthSessionUser = { username: 'alice', role: 'user', display_name: 'Alice', userId: 'u-1' }
const unused = (): never => {
  throw new Error('この test では使わない')
}

function harness() {
  const calls: string[] = []
  const gateway: AccountGateway = {
    getMe: () => {
      calls.push('getMe')
      return Promise.resolve({ ok: true, value: USER })
    },
    login: () => {
      calls.push('login')
      return Promise.resolve({ ok: true, value: USER })
    },
    register: () => {
      calls.push('register')
      return Promise.resolve({ ok: true, value: USER })
    },
    logout: () => {
      calls.push('logout')
      return Promise.resolve({ ok: true, value: undefined })
    },
    getPasskeyRegisterOptions: unused,
    getPasskeyLoginOptions: unused,
    verifyPasskeyRegistration: unused,
    verifyPasskeyLogin: unused,
    updateProfile: unused,
    changePassword: unused,
    deleteAccount: unused,
    deletePasskey: unused,
    revokeSession: unused,
    listPasskeys: unused,
    listSessions: unused,
    revokeOtherSessions: unused,
  }
  const webAuthn: WebAuthnPort = {
    startRegistration: unused,
    startAuthentication: unused,
    supportsWebAuthn: () => true,
  }
  const cleanupSteps = vi.fn(() => ({
    deleteAudio: (): Promise<void> => Promise.resolve(),
    clearServiceWorkerCaches: (): Promise<void> => Promise.resolve(),
    clearSubjectSettings: (): void => undefined,
  }))
  const reclaim = {
    positions: vi.fn((): void => undefined),
    audio: vi.fn((): Promise<void> => Promise.resolve()),
  }
  const detachNotifications = vi.fn((): Promise<void> => Promise.resolve())
  const speed = {
    copy: vi.fn((): Promise<void> => Promise.resolve()),
    forget: vi.fn((): void => undefined),
    clearAfterLeave: vi.fn((): void => undefined),
  }
  const deps: AccountSessionDeps = { gateway, webAuthn, cleanupSteps, reclaim, detachNotifications, speed }
  return { account: createAccountSession(deps), calls, cleanupSteps, reclaim, detachNotifications, speed }
}

const QUERY_NAMES: readonly QueryNames[] = ['session', 'view', 'currentUserId', 'subscribe']
const COMMAND_NAMES: readonly CommandNames[] = [
  'login',
  'register',
  'loginWithPasskey',
  'logout',
  'resolveSession',
  'retry',
  'expire',
  'registerSubjectLeaveStep',
]

describe('web-check-07 (a) query 4 つと command 8 つは過不足なく公開される', () => {
  test('戻り値の key は query 4 + command 8 の計 12 だけで、すべて関数', () => {
    const { account } = harness()

    expect(Object.keys(account).sort()).toEqual([...QUERY_NAMES, ...COMMAND_NAMES].sort())
    expect(Object.keys(account)).toHaveLength(12)
    for (const name of [...QUERY_NAMES, ...COMMAND_NAMES]) expect(typeof account[name], name).toBe('function')
  })
})

describe('web-check-07 (b)(c) query は副作用を起こさず、command の戻り値はリードモデルでない', () => {
  test('query 4 つを各 3 回呼んでも、gateway・後始末・回収・通知の解除・写しの記録は 0', () => {
    const h = harness()
    const listener = vi.fn()

    for (let i = 0; i < 3; i += 1) {
      h.account.session()
      h.account.view()
      h.account.currentUserId()
      const unsubscribe = h.account.subscribe(listener)
      unsubscribe()
    }

    expect(h.calls).toEqual([])
    expect(h.cleanupSteps).not.toHaveBeenCalled()
    expect(h.reclaim.positions).not.toHaveBeenCalled()
    expect(h.reclaim.audio).not.toHaveBeenCalled()
    expect(h.detachNotifications).not.toHaveBeenCalled()
    expect(h.speed.copy).not.toHaveBeenCalled()
    expect(h.speed.forget).not.toHaveBeenCalled()
    expect(h.speed.clearAfterLeave).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
  })

  test('resolveSession の戻り値は { cleanup } だけ、login の戻り値は { ok: true, value: undefined }', async () => {
    const h = harness()

    const resolved = await h.account.resolveSession()
    const login = await h.account.login('alice', 'pw')

    expect(Object.keys(resolved)).toEqual(['cleanup'])
    expect(login).toEqual({ ok: true, value: undefined })
  })
})
