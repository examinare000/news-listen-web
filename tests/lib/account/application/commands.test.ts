// Account application の command（web-cmd-account-07〜13）: updateProfile・changePassword・deleteAccount・registerPasskey・deletePasskey・revokeSession・revokeOtherSessions。
// 手書きの AccountGateway fake を渡す。`createAccountGateway`・`createGatewayDouble` は import しない（unit が infrastructure を値で import すると forbiddenDependency）。
// command は検査をせず（changePassword も）、例外を握りつぶさず、失敗（ApiFailure）は変えずに返す。
//
// RED 理由（実装前）: `@/lib/account/application/commands` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createAccountCommands } from '@/lib/account/application/commands'
import type { AccountGateway } from '@/lib/account/application/ports'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'
import { createFakeWebAuthnBrowserPort } from '../../../helpers/fakeWebAuthnBrowserPort'

type VoidResult = Result<void, ApiFailure>
const OK: VoidResult = { ok: true, value: undefined }
const FAILURE: ApiFailure = { kind: 'server', status: 503 }

type Handlers = {
  [K in keyof AccountGateway]?: (...args: Parameters<AccountGateway[K]>) => ReturnType<AccountGateway[K]>
}

interface Harness {
  readonly gateway: AccountGateway
  /** 呼ばれた method 名と引数を呼出順に記録する */
  readonly calls: Array<{ readonly name: string; readonly args: readonly unknown[] }>
}

function harness(handlers: Handlers = {}): Harness {
  const calls: Array<{ name: string; args: readonly unknown[] }> = []
  const base = {
    getMe: () => Promise.resolve({ ok: true as const, value: { username: 'u', role: 'user' as const, display_name: 'U', userId: null } }),
    login: () => Promise.reject(new Error('login を想定していない')),
    register: () => Promise.reject(new Error('register を想定していない')),
    logout: () => Promise.resolve(OK),
    getPasskeyRegisterOptions: () =>
      Promise.resolve({ ok: true as const, value: { challenge_id: 'cid', options: { challenge: 'c' } } }),
    getPasskeyLoginOptions: () => Promise.reject(new Error('getPasskeyLoginOptions を想定していない')),
    verifyPasskeyRegistration: () => Promise.resolve({ ok: true as const, value: { status: 'ok' } }),
    verifyPasskeyLogin: () => Promise.reject(new Error('verifyPasskeyLogin を想定していない')),
    updateProfile: () => Promise.resolve(OK),
    changePassword: () => Promise.resolve(OK),
    deleteAccount: () => Promise.resolve(OK),
    deletePasskey: () => Promise.resolve(OK),
    revokeSession: () => Promise.resolve(OK),
    listPasskeys: () => Promise.resolve({ ok: true as const, value: [] }),
    listSessions: () => Promise.resolve({ ok: true as const, value: [] }),
    revokeOtherSessions: () => Promise.resolve({ ok: true as const, value: { revoked: 0 } }),
  } satisfies AccountGateway
  const gateway = {} as Record<string, (...args: unknown[]) => unknown>
  for (const name of Object.keys(base) as Array<keyof AccountGateway>) {
    gateway[name] = (...args: unknown[]) => {
      calls.push({ name, args })
      const handler = handlers[name] as ((...a: unknown[]) => unknown) | undefined
      return handler ? handler(...args) : (base[name] as (...a: unknown[]) => unknown)(...args)
    }
  }
  return { gateway: gateway as unknown as AccountGateway, calls }
}

function commandsOf(h: Harness, webAuthn = createFakeWebAuthnBrowserPort()) {
  return createAccountCommands({ gateway: h.gateway, webAuthn })
}

describe('web-cmd-account-07 updateProfile', () => {
  test('web-cmd-account-07 — gateway の updateProfile を引数どおり 1 回だけ呼び、他を呼ばない', async () => {
    const h = harness()
    const result = await commandsOf(h).updateProfile('新しい名前')
    expect(h.calls).toEqual([{ name: 'updateProfile', args: ['新しい名前'] }])
    expect(result).toEqual(OK)
  })

  test('web-cmd-account-07 — 失敗（ApiFailure）は変えずに返し、getMe など再取得を呼ばない', async () => {
    const failed: VoidResult = { ok: false, failure: FAILURE }
    const h = harness({ updateProfile: () => Promise.resolve(failed) })
    const result = await commandsOf(h).updateProfile('x')
    expect(result).toBe(failed)
    expect(h.calls.map((c) => c.name)).toEqual(['updateProfile'])
  })

  test('web-cmd-account-07 — reject は握りつぶさず呼び手へ伝える', async () => {
    const h = harness({ updateProfile: () => Promise.reject(new Error('boom')) })
    await expect(commandsOf(h).updateProfile('x')).rejects.toThrow('boom')
  })
})

describe('web-cmd-account-08 changePassword', () => {
  test('web-cmd-account-08 — gateway の changePassword を (current, next) の順で 1 回呼ぶ', async () => {
    const h = harness()
    const result = await commandsOf(h).changePassword('old-Pass-1', 'new-Pass-2')
    expect(h.calls).toEqual([{ name: 'changePassword', args: ['old-Pass-1', 'new-Pass-2'] }])
    expect(result).toEqual(OK)
  })

  test('web-cmd-account-08 — 検査しない: 空文字でも gateway を呼ぶ', async () => {
    const h = harness()
    await commandsOf(h).changePassword('', '')
    expect(h.calls).toEqual([{ name: 'changePassword', args: ['', ''] }])
  })

  test('web-cmd-account-08 — 方針違反のパスワードでも gateway を呼ぶ（検査は画面の責務）', async () => {
    const h = harness()
    await commandsOf(h).changePassword('x', 'short')
    expect(h.calls).toHaveLength(1)
  })

  test('web-cmd-account-08 — 失敗は変えずに返し、reject は伝える', async () => {
    const failed: VoidResult = { ok: false, failure: { kind: 'validation', detail: 'weak' } }
    expect(await commandsOf(harness({ changePassword: () => Promise.resolve(failed) })).changePassword('a', 'b')).toBe(failed)
    await expect(
      commandsOf(harness({ changePassword: () => Promise.reject(new Error('net')) })).changePassword('a', 'b'),
    ).rejects.toThrow('net')
  })
})

describe('web-cmd-account-09 deleteAccount', () => {
  test('web-cmd-account-09 — gateway の deleteAccount を password 引数どおり 1 回だけ呼ぶ', async () => {
    const h = harness()
    const result = await commandsOf(h).deleteAccount('pw')
    expect(h.calls).toEqual([{ name: 'deleteAccount', args: ['pw'] }])
    expect(result).toEqual(OK)
  })

  test('web-cmd-account-09 — 失敗は変えずに返し、logout を呼ばない。reject は伝える', async () => {
    const failed: VoidResult = { ok: false, failure: { kind: 'forbidden' } }
    const h = harness({ deleteAccount: () => Promise.resolve(failed) })
    expect(await commandsOf(h).deleteAccount('pw')).toBe(failed)
    expect(h.calls.map((c) => c.name)).toEqual(['deleteAccount'])
    await expect(
      commandsOf(harness({ deleteAccount: () => Promise.reject(new Error('x')) })).deleteAccount('pw'),
    ).rejects.toThrow('x')
  })
})

describe('web-cmd-account-10 registerPasskey', () => {
  test('web-cmd-account-10 — options 取得 → port.startRegistration(parse 済み options) → verify の順に各 1 回呼ぶ', async () => {
    const order: string[] = []
    const credential = { id: 'cred' }
    const h = harness({
      getPasskeyRegisterOptions: () => {
        order.push('options')
        return Promise.resolve({ ok: true, value: { challenge_id: 'cid-1', options: { challenge: 'abc' } } })
      },
      verifyPasskeyRegistration: () => {
        order.push('verify')
        return Promise.resolve({ ok: true, value: { status: 'ok' } })
      },
    })
    const received: unknown[] = []
    const webAuthn = createFakeWebAuthnBrowserPort({
      startRegistration: (options: unknown) => {
        order.push('ceremony')
        received.push(options)
        return Promise.resolve(credential)
      },
    })

    const result = await commandsOf(h, webAuthn).registerPasskey()

    expect(order).toEqual(['options', 'ceremony', 'verify'])
    expect(received).toEqual([{ challenge: 'abc' }])
    expect(h.calls.find((c) => c.name === 'verifyPasskeyRegistration')?.args).toEqual(['cid-1', credential])
    expect(result).toEqual(OK)
  })

  test('web-cmd-account-10 — options 取得が API 失敗なら、その失敗を返し port と verify を呼ばない', async () => {
    const failed = { ok: false as const, failure: FAILURE }
    const h = harness({ getPasskeyRegisterOptions: () => Promise.resolve(failed) })
    let ceremony = 0
    const webAuthn = createFakeWebAuthnBrowserPort({
      startRegistration: () => {
        ceremony += 1
        return Promise.resolve({})
      },
    })

    const result = await commandsOf(h, webAuthn).registerPasskey()

    expect(result).toBe(failed)
    expect(ceremony).toBe(0)
    expect(h.calls.map((c) => c.name)).toEqual(['getPasskeyRegisterOptions'])
  })

  test('web-cmd-account-10 — port の reject（NotAllowedError）は伝わり、verify を呼ばない', async () => {
    const h = harness()
    const webAuthn = createFakeWebAuthnBrowserPort({
      startRegistration: () => Promise.reject(new DOMException('cancelled', 'NotAllowedError')),
    })

    const caught = await commandsOf(h, webAuthn).registerPasskey().catch((e: unknown) => e)

    expect(caught).toBeInstanceOf(DOMException)
    expect((caught as DOMException).name).toBe('NotAllowedError')
    expect(h.calls.map((c) => c.name)).not.toContain('verifyPasskeyRegistration')
  })

  test('web-cmd-account-10 — gateway が options 取得で reject（parse 失敗）したら伝わり、port を呼ばない', async () => {
    const h = harness({ getPasskeyRegisterOptions: () => Promise.reject(new SyntaxError('bad json')) })
    let ceremony = 0
    const webAuthn = createFakeWebAuthnBrowserPort({
      startRegistration: () => {
        ceremony += 1
        return Promise.resolve({})
      },
    })

    await expect(commandsOf(h, webAuthn).registerPasskey()).rejects.toThrow('bad json')
    expect(ceremony).toBe(0)
  })

  test('web-cmd-account-10 — verify が API 失敗ならその失敗を返す', async () => {
    const failed = { ok: false as const, failure: { kind: 'validation' as const, detail: 'bad' } }
    const h = harness({ verifyPasskeyRegistration: () => Promise.resolve(failed) })
    expect(await commandsOf(h).registerPasskey()).toBe(failed)
  })
})

describe('web-cmd-account-11 deletePasskey', () => {
  test('web-cmd-account-11 — gateway の deletePasskey を credentialId 引数どおり 1 回だけ呼ぶ', async () => {
    const h = harness()
    const result = await commandsOf(h).deletePasskey('cred/1')
    expect(h.calls).toEqual([{ name: 'deletePasskey', args: ['cred/1'] }])
    expect(result).toEqual(OK)
  })

  test('web-cmd-account-11 — 失敗は変えずに返し、一覧の再取得を呼ばない。reject は伝える', async () => {
    const failed: VoidResult = { ok: false, failure: FAILURE }
    const h = harness({ deletePasskey: () => Promise.resolve(failed) })
    expect(await commandsOf(h).deletePasskey('c')).toBe(failed)
    expect(h.calls.map((c) => c.name)).toEqual(['deletePasskey'])
    await expect(
      commandsOf(harness({ deletePasskey: () => Promise.reject(new Error('r')) })).deletePasskey('c'),
    ).rejects.toThrow('r')
  })
})

describe('web-cmd-account-12 revokeSession', () => {
  test('web-cmd-account-12 — gateway の revokeSession を sessionId 引数どおり 1 回だけ呼ぶ', async () => {
    const h = harness()
    const result = await commandsOf(h).revokeSession('s-1')
    expect(h.calls).toEqual([{ name: 'revokeSession', args: ['s-1'] }])
    expect(result).toEqual(OK)
  })

  test('web-cmd-account-12 — 失敗は変えずに返し、一覧の再取得を呼ばない。reject は伝える', async () => {
    const failed: VoidResult = { ok: false, failure: { kind: 'not_found' } }
    const h = harness({ revokeSession: () => Promise.resolve(failed) })
    expect(await commandsOf(h).revokeSession('s')).toBe(failed)
    expect(h.calls.map((c) => c.name)).toEqual(['revokeSession'])
    await expect(
      commandsOf(harness({ revokeSession: () => Promise.reject(new Error('r')) })).revokeSession('s'),
    ).rejects.toThrow('r')
  })
})

describe('web-cmd-account-13 revokeOtherSessions', () => {
  test('web-cmd-account-13 — gateway の revokeOtherSessions を 1 回呼び、{ revoked } を返す', async () => {
    const h = harness({ revokeOtherSessions: () => Promise.resolve({ ok: true, value: { revoked: 3 } }) })
    const result = await commandsOf(h).revokeOtherSessions()
    expect(h.calls).toEqual([{ name: 'revokeOtherSessions', args: [] }])
    expect(result).toEqual({ ok: true, value: { revoked: 3 } })
  })

  test('web-cmd-account-13 — 成功の値は凍結された複製で、gateway の値と参照を共有しない', async () => {
    const fromGateway = { revoked: 2 }
    const h = harness({ revokeOtherSessions: () => Promise.resolve({ ok: true, value: fromGateway }) })
    const result = await commandsOf(h).revokeOtherSessions()
    if (!result.ok) throw new Error('成功を期待')
    expect(result.value).not.toBe(fromGateway)
    expect(Object.isFrozen(result.value)).toBe(true)
  })

  test('web-cmd-account-13 — 失敗は変えずに返し、reject は伝える', async () => {
    const failed = { ok: false as const, failure: FAILURE }
    expect(
      await commandsOf(harness({ revokeOtherSessions: () => Promise.resolve(failed) })).revokeOtherSessions(),
    ).toBe(failed)
    await expect(
      commandsOf(harness({ revokeOtherSessions: () => Promise.reject(new Error('r')) })).revokeOtherSessions(),
    ).rejects.toThrow('r')
  })
})
