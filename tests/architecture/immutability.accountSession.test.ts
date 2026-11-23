// @vitest-environment node
// 認証 session の現在値の不変性（web-check-06）。session() が返す値は凍結済みで、書き換えようとすると
// strict mode の module では TypeError になり、次の読みは同じ値を返す。
// 本物の infrastructure は import しない（台帳の unit 分類）。
//
// RED 理由（実装前）: `@/lib/account/application/accountSession` が無い（module not found）。
import { describe, expect, test, vi } from 'vitest'
import { createAccountSession } from '@/lib/account/application/accountSession'
import type { AccountSessionDeps } from '@/lib/account/application/accountSession'
import type { AccountGateway } from '@/lib/account/application/ports'
import type { AuthSessionUser } from '@/lib/account/domain/authSession'

const USER: AuthSessionUser = { username: 'alice', role: 'user', display_name: 'Alice', userId: 'u-1' }
const unused = (): never => {
  throw new Error('この test では使わない')
}

function makeAccount() {
  const gateway: AccountGateway = {
    getMe: () => Promise.resolve({ ok: true, value: USER }),
    login: unused,
    register: unused,
    logout: unused,
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
  const deps: AccountSessionDeps = {
    gateway,
    webAuthn: { startRegistration: unused, startAuthentication: unused, supportsWebAuthn: () => true },
    cleanupSteps: () => ({
      deleteAudio: () => Promise.resolve(),
      clearServiceWorkerCaches: () => Promise.resolve(),
      clearSubjectSettings: () => undefined,
    }),
    reclaim: { positions: () => undefined, audio: () => Promise.resolve() },
    detachNotifications: () => Promise.resolve(),
    speed: { copy: vi.fn(() => Promise.resolve()), forget: () => undefined, clearAfterLeave: () => undefined },
  }
  return createAccountSession(deps)
}

describe('web-check-06 session(): 戻り値は凍結済みで、書き換えは TypeError', () => {
  test('生成直後（resolving）の session の property へ代入すると TypeError で、次の session() は同じ値', () => {
    const account = makeAccount()
    const before = account.session()

    expect(() => {
      ;(before as { kind: string }).kind = 'authenticated'
    }).toThrow(TypeError)

    expect(account.session()).toBe(before)
    expect(account.session()).toEqual({ kind: 'resolving' })
  })

  test('resolveSession 後（authenticated）の user.userId と kind へ代入すると TypeError で、次の読みは変わらない', async () => {
    const account = makeAccount()
    await account.resolveSession()
    const session = account.session()
    if (session.kind !== 'authenticated') throw new Error('authenticated になっていない')

    expect(() => {
      ;(session.user as { userId: string | null }).userId = 'u-mallory'
    }).toThrow(TypeError)
    expect(() => {
      ;(session as { kind: string }).kind = 'anonymous'
    }).toThrow(TypeError)

    expect(account.session()).toEqual({ kind: 'authenticated', user: USER })
    expect(account.currentUserId()).toBe('u-1')
  })
})
