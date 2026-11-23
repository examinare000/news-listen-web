// @vitest-environment node
// 認証 session の持ち主（web-contract-18・web-dec-66〜71・web-dec-80・web-dec-83・shared-dec-28・shared-leave-05・08・09）。
// 現在の session・確定した主体・回収の 1 回・失効/確立/離脱の順序・logout の手順を createAccountSession が持つ。
// React・infrastructure・document を import しない。gateway・webAuthn・cleanupSteps・reclaim・detachNotifications・speed は呼出を記録する手書きの fake。
// 順序は制御できる promise（deferred）で確かめる。
//
// 分類の理由: AccountGateway・WebAuthnPort は型だけの port で、本物の infrastructure を値で import しない（台帳の unit 分類）。
//
// RED 理由（実装前）: `@/lib/account/application/accountSession` が無い（module not found）。
import { describe, expect, test, vi } from 'vitest'
import { createAccountSession } from '@/lib/account/application/accountSession'
import type { AccountSessionDeps } from '@/lib/account/application/accountSession'
import type { AccountGateway, RegisterForm, WebAuthnPort } from '@/lib/account/application/ports'
import type { AuthSession, AuthSessionUser } from '@/lib/account/domain/authSession'
import type { Subject } from '@/lib/account/domain/subject'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

// ---------------------------------------------------------------------------
// fake と helper
// ---------------------------------------------------------------------------
type Me = Result<AuthSessionUser, ApiFailure>

const user = (userId: string | null): AuthSessionUser => ({
  username: 'alice',
  role: 'user',
  displayName: 'Alice',
  userId,
})
const okMe = (userId: string | null): Me => ({ ok: true, value: user(userId) })
const authenticated = (userId: string | null): AuthSession => ({ kind: 'authenticated', user: user(userId) })
const OK_VOID: Result<void, ApiFailure> = { ok: true, value: undefined }
const FORM: RegisterForm = { username: 'alice', password: 'Passw0rd!x' }
const unused = (): never => {
  throw new Error('この test では使わない')
}

// マイクロタスクを全部流す。deferred を解決していない promise は進まない。
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function makeHarness(initialSession?: AuthSession) {
  const log: string[] = []
  const responders = {
    getMe: (): Promise<Me> => Promise.resolve(okMe('u-1')),
    login: (): Promise<Me> => Promise.resolve(okMe('u-1')),
    register: (): Promise<Me> => Promise.resolve(okMe('u-1')),
    logout: (): Promise<Result<void, ApiFailure>> => Promise.resolve(OK_VOID),
    verifyPasskeyLogin: (): Promise<Result<{ readonly token: string; readonly user: AuthSessionUser }, ApiFailure>> =>
      Promise.resolve({ ok: true, value: { token: 't', user: user('u-1') } }),
    detach: (): Promise<void> => Promise.resolve(),
  }
  const gateway: AccountGateway = {
    getMe: () => {
      log.push('getMe')
      return responders.getMe()
    },
    login: () => {
      log.push('login')
      return responders.login()
    },
    register: () => {
      log.push('register')
      return responders.register()
    },
    logout: () => {
      log.push('logout')
      return responders.logout()
    },
    getPasskeyLoginOptions: () => {
      log.push('getPasskeyLoginOptions')
      return Promise.resolve({ ok: true, value: { challenge_id: 'cid', options: {} } })
    },
    verifyPasskeyLogin: () => {
      log.push('verifyPasskeyLogin')
      return responders.verifyPasskeyLogin()
    },
    getPasskeyRegisterOptions: unused,
    verifyPasskeyRegistration: unused,
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
    startAuthentication: () => Promise.resolve({}),
    supportsWebAuthn: () => true,
  }
  const steps = {
    deleteAudio: vi.fn<(userId: string) => Promise<void>>(() => Promise.resolve()),
    clearServiceWorkerCaches: vi.fn((): Promise<void> => Promise.resolve()),
    clearSubjectSettings: vi.fn((): void | Promise<void> => undefined),
  }
  const cleanupSteps = vi.fn<AccountSessionDeps['cleanupSteps']>(() => ({
    deleteAudio: steps.deleteAudio,
    clearServiceWorkerCaches: steps.clearServiceWorkerCaches,
    clearSubjectSettings: steps.clearSubjectSettings,
  }))
  const reclaim = {
    positions: vi.fn<(userId: string | null) => void>(() => undefined),
    audio: vi.fn<(currentUserId: () => string | null) => Promise<void>>(() => Promise.resolve()),
  }
  const detachNotifications = vi.fn((): Promise<void> => {
    log.push('detach')
    return responders.detach()
  })
  const speed = {
    copy: vi.fn<(currentSubject: () => Subject | null) => Promise<void>>(() => Promise.resolve()),
    forget: vi.fn((): void => undefined),
    clearAfterLeave: vi.fn<(cleaned: string | null, current: string | null) => void>(() => undefined),
  }
  const stop = vi.fn((): void | Promise<void> => undefined)

  const deps: AccountSessionDeps = {
    gateway,
    webAuthn,
    cleanupSteps,
    reclaim,
    detachNotifications,
    speed,
    ...(initialSession === undefined ? {} : { initialSession }),
  }
  const account = createAccountSession(deps)
  return { account, log, responders, steps, cleanupSteps, reclaim, detachNotifications, speed, stop }
}

// ---------------------------------------------------------------------------
// 起動時の解決
// ---------------------------------------------------------------------------
describe('web-contract-18 resolveSession: 成功 — 確定・写し・回収（shared-leave-08・09）', () => {
  test('getMe が user を返すと authenticated・主体の確定・写しと回収を 1 回ずつ行い、後始末は走らせず skipped を返す', async () => {
    const h = makeHarness()

    const result = await h.account.resolveSession()

    expect(result).toEqual({ cleanup: 'skipped' })
    expect(h.account.session()).toEqual({ kind: 'authenticated', user: user('u-1') })
    expect(h.account.currentUserId()).toBe('u-1')
    expect(h.speed.copy).toHaveBeenCalledTimes(1)
    expect(h.reclaim.positions).toHaveBeenCalledTimes(1)
    expect(h.reclaim.audio).toHaveBeenCalledTimes(1)
    expect(h.cleanupSteps).not.toHaveBeenCalled()
  })

  test('shared-leave-08: 並行する 2 件の解決と続く login の成功でも、回収は位置・音声とも計 1 回（印は同期に立つ）', async () => {
    const h = makeHarness()
    const audioGate = deferred()
    h.reclaim.audio.mockImplementation(() => audioGate.promise)

    const first = h.account.resolveSession()
    const second = h.account.resolveSession()
    await flush()
    const login = h.account.login('alice', 'pw')
    await flush()
    audioGate.resolve()
    await Promise.all([first, second, login])

    expect(h.reclaim.positions).toHaveBeenCalledTimes(1)
    expect(h.reclaim.audio).toHaveBeenCalledTimes(1)
  })

  test('shared-leave-09: 回収の失敗（位置の throw・音声の reject）は握り、状態と結果に影響しない', async () => {
    const h = makeHarness()
    h.reclaim.positions.mockImplementation(() => {
      throw new Error('positions')
    })
    h.reclaim.audio.mockImplementation(() => Promise.reject(new Error('audio')))

    const result = await h.account.resolveSession()

    expect(result).toEqual({ cleanup: 'skipped' })
    expect(h.account.session().kind).toBe('authenticated')
  })

  test('shared-leave-08: 解決済みの後の login の成功でも、回収は計 1 回のまま', async () => {
    const h = makeHarness()
    await h.account.resolveSession()

    const login = await h.account.login('alice', 'pw')
    await flush()

    expect(login).toEqual({ ok: true, value: undefined })
    expect(h.reclaim.positions).toHaveBeenCalledTimes(1)
    expect(h.reclaim.audio).toHaveBeenCalledTimes(1)
  })
})

describe('web-dec-67 resolveSession: 401 以外の失敗は一時障害で、主体を保ち、後始末も回収も走らせない', () => {
  test('network・timeout → network、server → server、他 → unknown。currentUserId は直前の主体のまま（web-dec-80）', async () => {
    const h = makeHarness(authenticated('u-1'))
    const cases: ReadonlyArray<readonly [ApiFailure, 'network' | 'server' | 'unknown']> = [
      [{ kind: 'network' }, 'network'],
      [{ kind: 'timeout' }, 'network'],
      [{ kind: 'server', status: 500 }, 'server'],
      [{ kind: 'unknown', status: 0 }, 'unknown'],
    ]

    for (const [failure, reason] of cases) {
      h.responders.getMe = () => Promise.resolve({ ok: false, failure })

      await h.account.retry()
      expect(h.account.session(), reason).toEqual({ kind: 'unavailable', failure: { reason } })
      expect(h.account.currentUserId(), reason).toBe('u-1')

      await expect(h.account.resolveSession()).resolves.toEqual({ cleanup: 'skipped' })
      expect(h.account.session(), reason).toEqual({ kind: 'unavailable', failure: { reason } })
    }

    expect(h.cleanupSteps).not.toHaveBeenCalled()
    expect(h.reclaim.positions).not.toHaveBeenCalled()
    expect(h.reclaim.audio).not.toHaveBeenCalled()
  })

  test('getMe の reject は reject せず unavailable(unknown) にして skipped を返す', async () => {
    const h = makeHarness()
    h.responders.getMe = () => Promise.reject(new Error('boom'))

    await expect(h.account.resolveSession()).resolves.toEqual({ cleanup: 'skipped' })

    expect(h.account.session()).toEqual({ kind: 'unavailable', failure: { reason: 'unknown' } })
  })
})

describe('web-dec-83 resolveSession: 401 の失効の後始末', () => {
  test('主体がいる 401 は anonymous・写しの印を外し、音声を消さない後始末（停止・SW キャッシュ・設定）を走らせて done を返す', async () => {
    const h = makeHarness(authenticated('u-1'))
    h.account.registerSubjectLeaveStep(h.stop)
    h.responders.getMe = () => Promise.resolve({ ok: false, failure: { kind: 'unauthorized' } })

    const result = await h.account.resolveSession()

    expect(result).toEqual({ cleanup: 'done' })
    expect(h.account.session().kind).toBe('anonymous')
    expect(h.account.currentUserId()).toBeNull()
    expect(h.speed.forget).toHaveBeenCalledTimes(1)
    expect(h.cleanupSteps).toHaveBeenCalledTimes(1)
    expect(h.cleanupSteps.mock.calls[0]?.[0]).toEqual({ userId: 'u-1' })
    expect(h.steps.deleteAudio).not.toHaveBeenCalled()
    expect(h.steps.clearServiceWorkerCaches).toHaveBeenCalledTimes(1)
    expect(h.steps.clearSubjectSettings).toHaveBeenCalledTimes(1)
    expect(h.stop).toHaveBeenCalledTimes(1)
  })

  test('手順の 1 つが reject なら incomplete を返し、状態は anonymous のまま', async () => {
    const h = makeHarness(authenticated('u-1'))
    h.steps.clearSubjectSettings.mockImplementation(() => Promise.reject(new Error('settings')))
    h.responders.getMe = () => Promise.resolve({ ok: false, failure: { kind: 'unauthorized' } })

    const result = await h.account.resolveSession()

    expect(result).toEqual({ cleanup: 'incomplete' })
    expect(h.account.session().kind).toBe('anonymous')
  })

  test('起動時の 401（主体なし）は SW 管理キャッシュだけを消し、音声・設定・停止は走らせず done。reject なら incomplete', async () => {
    const h = makeHarness()
    h.account.registerSubjectLeaveStep(h.stop)
    h.responders.getMe = () => Promise.resolve({ ok: false, failure: { kind: 'unauthorized' } })

    await expect(h.account.resolveSession()).resolves.toEqual({ cleanup: 'done' })

    expect(h.account.session().kind).toBe('anonymous')
    expect(h.steps.clearServiceWorkerCaches).toHaveBeenCalledTimes(1)
    expect(h.steps.deleteAudio).not.toHaveBeenCalled()
    expect(h.steps.clearSubjectSettings).not.toHaveBeenCalled()
    expect(h.stop).not.toHaveBeenCalled()

    const rejecting = makeHarness()
    rejecting.steps.clearServiceWorkerCaches.mockImplementation(() => Promise.reject(new Error('sw')))
    rejecting.responders.getMe = () => Promise.resolve({ ok: false, failure: { kind: 'unauthorized' } })
    await expect(rejecting.account.resolveSession()).resolves.toEqual({ cleanup: 'incomplete' })
  })
})

// ---------------------------------------------------------------------------
// 確立（login・register・passkey）
// ---------------------------------------------------------------------------
describe('shared-dec-28 確立: A から B へ直接ログインし直すと、B が先に確立し A の後始末を待たない', () => {
  test('A の停止が未解決でも login は settled で、B が authenticated。A の後始末は開始済みだが完了していない', async () => {
    const h = makeHarness(authenticated('u-a'))
    const stopGate = deferred()
    h.stop.mockImplementation(() => stopGate.promise)
    h.account.registerSubjectLeaveStep(h.stop)
    h.responders.login = () => Promise.resolve(okMe('u-b'))
    let settled = false

    void h.account.login('bob', 'pw').then(() => {
      settled = true
    })
    await flush()

    expect(settled).toBe(true)
    expect(h.account.session()).toEqual({ kind: 'authenticated', user: user('u-b') })
    expect(h.account.currentUserId()).toBe('u-b')
    expect(h.stop).toHaveBeenCalledTimes(1)
    expect(h.steps.clearSubjectSettings).not.toHaveBeenCalled()
    expect(h.speed.forget).toHaveBeenCalledTimes(1)
    expect(h.speed.copy).toHaveBeenCalledTimes(1)
  })

  test('同じ主体の再 login は後始末も写しの印の解除も行わない', async () => {
    const h = makeHarness(authenticated('u-a'))
    h.account.registerSubjectLeaveStep(h.stop)
    h.responders.login = () => Promise.resolve(okMe('u-a'))

    await h.account.login('alice', 'pw')
    await flush()

    expect(h.cleanupSteps).not.toHaveBeenCalled()
    expect(h.stop).not.toHaveBeenCalled()
    expect(h.speed.forget).not.toHaveBeenCalled()
  })

  test('userId が null どうしは同じ主体とみなさず、後始末を走らせる', async () => {
    const h = makeHarness(authenticated(null))
    h.account.registerSubjectLeaveStep(h.stop)
    h.responders.login = () => Promise.resolve(okMe(null))

    await h.account.login('alice', 'pw')
    await flush()

    expect(h.stop).toHaveBeenCalledTimes(1)
  })

  test('login・register・passkey の API 失敗は Result をそのまま返し、状態・通知・主体・写し・後始末・回収を変えない', async () => {
    const h = makeHarness(authenticated('u-a'))
    const failure: Result<never, ApiFailure> = { ok: false, failure: { kind: 'validation', detail: 'bad' } }
    h.responders.login = () => Promise.resolve(failure)
    h.responders.register = () => Promise.resolve(failure)
    h.responders.verifyPasskeyLogin = () => Promise.resolve(failure)
    const listener = vi.fn()
    h.account.subscribe(listener)
    const before = h.account.session()

    await expect(h.account.login('alice', 'pw')).resolves.toBe(failure)
    await expect(h.account.register(FORM)).resolves.toBe(failure)
    await expect(h.account.loginWithPasskey()).resolves.toBe(failure)
    await flush()

    expect(h.account.session()).toBe(before)
    expect(h.account.currentUserId()).toBe('u-a')
    expect(listener).not.toHaveBeenCalled()
    expect(h.speed.copy).not.toHaveBeenCalled()
    expect(h.speed.forget).not.toHaveBeenCalled()
    expect(h.cleanupSteps).not.toHaveBeenCalled()
    expect(h.reclaim.positions).not.toHaveBeenCalled()
    expect(h.reclaim.audio).not.toHaveBeenCalled()
  })

  test('register・passkey の成功も確立として authenticated にし、{ ok: true, value: undefined } を返す', async () => {
    const h = makeHarness()
    h.responders.register = () => Promise.resolve(okMe('u-r'))
    h.responders.verifyPasskeyLogin = () =>
      Promise.resolve({ ok: true, value: { token: 't', user: user('u-p') } })

    await expect(h.account.register(FORM)).resolves.toEqual({ ok: true, value: undefined })
    expect(h.account.currentUserId()).toBe('u-r')
    await expect(h.account.loginWithPasskey()).resolves.toEqual({ ok: true, value: undefined })
    expect(h.account.currentUserId()).toBe('u-p')
    expect(h.log).toContain('getPasskeyLoginOptions')
  })
})

// ---------------------------------------------------------------------------
// 失効（expire）と retry
// ---------------------------------------------------------------------------
describe('shared-leave-05 expire: authenticated のときだけ同期に anonymous へ移り、後始末を 1 回走らせる', () => {
  test('同じ同期区間で anonymous・通知 1・戻り値 undefined。流した後に音声を消さない後始末が 1 回', async () => {
    const h = makeHarness(authenticated('u-1'))
    h.account.registerSubjectLeaveStep(h.stop)
    const listener = vi.fn()
    h.account.subscribe(listener)

    const returned = h.account.expire()

    expect(returned).toBeUndefined()
    expect(h.account.session().kind).toBe('anonymous')
    expect(listener).toHaveBeenCalledTimes(1)
    await flush()
    expect(h.stop).toHaveBeenCalledTimes(1)
    expect(h.steps.deleteAudio).not.toHaveBeenCalled()
    expect(h.cleanupSteps).toHaveBeenCalledTimes(1)
  })

  test('resolving 中の expire は何も動かさない（状態・通知・後始末・写し・回収のどれも 0）', async () => {
    const h = makeHarness()
    h.account.registerSubjectLeaveStep(h.stop)
    const listener = vi.fn()
    h.account.subscribe(listener)

    h.account.expire()
    await flush()

    expect(h.account.session().kind).toBe('resolving')
    expect(listener).not.toHaveBeenCalled()
    expect(h.cleanupSteps).not.toHaveBeenCalled()
    expect(h.stop).not.toHaveBeenCalled()
    expect(h.speed.forget).not.toHaveBeenCalled()
    expect(h.reclaim.positions).not.toHaveBeenCalled()
    expect(h.reclaim.audio).not.toHaveBeenCalled()
  })

  test('同期に 2 回続けて expire しても、後始末・SW キャッシュの消去・通知は各 1 回（2 回目は最新の状態を見る）', async () => {
    const h = makeHarness(authenticated('u-1'))
    h.account.registerSubjectLeaveStep(h.stop)
    const listener = vi.fn()
    h.account.subscribe(listener)

    h.account.expire()
    h.account.expire()
    await flush()

    expect(h.cleanupSteps).toHaveBeenCalledTimes(1)
    expect(h.cleanupSteps.mock.calls[0]?.[0]).toEqual({ userId: 'u-1' })
    expect(h.steps.clearServiceWorkerCaches).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(h.stop).toHaveBeenCalledTimes(1)
    expect(h.steps.clearSubjectSettings).toHaveBeenCalledTimes(1)
  })
})

describe('web-dec-67 retry: resolving に戻して解決し直す', () => {
  test('unavailable からの retry は呼んだ直後に resolving になり、getMe を 1 回呼び、解決後に authenticated', async () => {
    const h = makeHarness({ kind: 'unavailable', failure: { reason: 'network' } })
    const meGate = deferred<Me>()
    h.responders.getMe = () => meGate.promise

    const pending = h.account.retry()

    expect(h.account.session().kind).toBe('resolving')
    expect(h.log.filter((entry) => entry === 'getMe')).toHaveLength(1)
    meGate.resolve(okMe('u-1'))
    await pending
    expect(h.account.session().kind).toBe('authenticated')
  })
})

// ---------------------------------------------------------------------------
// view・購読・離脱の登録
// ---------------------------------------------------------------------------
describe('view: session が同じ間は同じ object（useSyncExternalStore の snapshot）', () => {
  test('遷移前の 2 回は同じ object、遷移後は別 object で kind が一致する', () => {
    const h = makeHarness(authenticated('u-1'))

    const first = h.account.view()
    const second = h.account.view()
    h.account.expire()
    const after = h.account.view()

    expect(second).toBe(first)
    expect(first.kind).toBe('authenticated')
    expect(after).not.toBe(first)
    expect(after.kind).toBe('anonymous')
    expect(h.account.view()).toBe(after)
  })
})

describe('web-dec-73 registerSubjectLeaveStep: 最後の登録が勝ち、解除は自分が最後のときだけ効く', () => {
  test('stop1・stop2 を登録して後始末を起こすと stop2 だけ呼ばれ、stop1 の解除後も stop2 が呼ばれ、stop2 の解除後は 0。解除の 2 回呼びは何もしない', async () => {
    const h = makeHarness(authenticated('u-1'))
    const stop1 = vi.fn((): void | Promise<void> => undefined)
    const stop2 = vi.fn((): void | Promise<void> => undefined)
    const stop3 = vi.fn((): void | Promise<void> => undefined)
    const release1 = h.account.registerSubjectLeaveStep(stop1)
    const release2 = h.account.registerSubjectLeaveStep(stop2)

    await h.account.logout()
    await flush()
    expect(stop1).not.toHaveBeenCalled()
    expect(stop2).toHaveBeenCalledTimes(1)

    release1()
    await h.account.logout()
    await flush()
    expect(stop2).toHaveBeenCalledTimes(2)

    release2()
    await h.account.logout()
    await flush()
    expect(stop1).not.toHaveBeenCalled()
    expect(stop2).toHaveBeenCalledTimes(2)

    h.account.registerSubjectLeaveStep(stop3)
    release2()
    await h.account.logout()
    await flush()
    expect(stop3).toHaveBeenCalledTimes(1)
  })
})

describe('購読と生成: 呼出ごとに独立した状態で、重複登録は 1 つとして扱う', () => {
  test('initialSession をそのまま返し、a の遷移ごとに listener は 1 回（2 回登録しても）、解除後は 0。b は a の影響を受けない', async () => {
    const initial = authenticated('u-1')
    const a = makeHarness(initial)
    const b = makeHarness(initial)
    const listener = vi.fn()
    const otherListener = vi.fn()
    b.account.subscribe(otherListener)

    expect(a.account.session()).toBe(initial)
    expect(a.account.currentUserId()).toBe('u-1')
    expect(a.log).toEqual([])

    const unsubscribe = a.account.subscribe(listener)
    a.account.subscribe(listener)
    expect(listener).not.toHaveBeenCalled()

    a.account.expire()
    expect(listener).toHaveBeenCalledTimes(1)
    await a.account.login('alice', 'pw')
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    await a.account.logout()
    await flush()
    expect(listener).toHaveBeenCalledTimes(2)

    expect(b.account.session()).toBe(initial)
    expect(b.account.currentUserId()).toBe('u-1')
    expect(otherListener).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------
describe('決定 23 logout: 通知の解除 → サーバー logout → ローカルを落とす。失敗は握り、後始末は待たない', () => {
  test('detach と logout が reject しても reject せず、順は detach → logout。anonymous・主体 null・写しの印の解除 1 回・回収は呼ばない', async () => {
    const h = makeHarness(authenticated('u-1'))
    h.responders.detach = () => Promise.reject(new Error('detach'))
    h.responders.logout = () => Promise.reject(new Error('logout'))

    await expect(h.account.logout()).resolves.toBeUndefined()

    expect(h.log).toEqual(['detach', 'logout'])
    expect(h.account.session().kind).toBe('anonymous')
    expect(h.account.currentUserId()).toBeNull()
    expect(h.speed.forget).toHaveBeenCalledTimes(1)
    expect(h.reclaim.positions).not.toHaveBeenCalled()
    expect(h.reclaim.audio).not.toHaveBeenCalled()
  })

  test('停止が未解決でも logout は settled で音声は消さず、停止が終わると音声（u-1）を 1 回消す', async () => {
    const h = makeHarness(authenticated('u-1'))
    const stopGate = deferred()
    h.stop.mockImplementation(() => stopGate.promise)
    h.account.registerSubjectLeaveStep(h.stop)
    let settled = false

    void h.account.logout().then(() => {
      settled = true
    })
    await flush()

    expect(settled).toBe(true)
    expect(h.steps.deleteAudio).not.toHaveBeenCalled()

    stopGate.resolve()
    await flush()

    expect(h.steps.deleteAudio).toHaveBeenCalledTimes(1)
    expect(h.steps.deleteAudio).toHaveBeenCalledWith('u-1')
  })
})
