// 認証 session の持ち主（web-contract-18・web-dec-66〜71・web-dec-80・web-dec-83・shared-dec-28・shared-leave-05・08・09）。
// 現在の session・確定した主体・起動時の回収を 1 回だけ行う規則・失効と確立と離脱の後始末の順序・logout の手順を持つ。
// React・infrastructure・document を import しない。infrastructure の組立ては deps の関数として composition が渡す。
import {
  RESOLVING_SESSION,
  reduce,
  type AuthEvent,
  type AuthSession,
  type AuthSessionUser,
} from '@/lib/account/domain/authSession'
import { subjectOf, type Subject } from '@/lib/account/domain/subject'
import { createSubjectCleanup, type SubjectCleanupSteps } from '@/lib/account/application/subjectCleanup'
import { authView, type AuthView } from '@/lib/account/application/readModels'
import { loginWithPasskey as passkeyLogin } from '@/lib/account/application/passkey'
import type { AccountGateway, RegisterForm, WebAuthnPort } from '@/lib/account/application/ports'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

// web-contract-18 の失効 cleanup の発火条件（2026-09-17 user 裁定で候補 (b)）: resolveSession が失効（401）を検知したときの
// SW 管理キャッシュ（shell-*/api-*）消去結果。'skipped' は 401 以外（成功・network error 等）で cleanup 自体を行っていないことを表す。
export type RefreshMeResult = { readonly cleanup: 'done' | 'incomplete' | 'skipped' }

export interface SubjectSpeedPort {
  readonly copy: (currentSubject: () => Subject | null) => Promise<void>
  readonly forget: () => void
  readonly clearAfterLeave: (cleanedUserId: string | null, currentUserId: string | null) => void
}

export interface AccountSessionDeps {
  readonly gateway: AccountGateway
  readonly webAuthn: WebAuthnPort
  readonly cleanupSteps: (
    subject: Subject,
    currentUserId: () => string | null,
  ) => Omit<SubjectCleanupSteps, 'stopPlayback'>
  readonly reclaim: {
    readonly positions: (userId: string | null) => void
    readonly audio: (currentUserId: () => string | null) => Promise<void>
  }
  readonly detachNotifications: () => Promise<void>
  readonly speed: SubjectSpeedPort
  /** Test-only: 初期状態の上書き。 */
  readonly initialSession?: AuthSession
}

export interface AccountSessionCommands {
  readonly login: (username: string, password: string) => Promise<Result<void, ApiFailure>>
  readonly register: (form: RegisterForm) => Promise<Result<void, ApiFailure>>
  readonly loginWithPasskey: () => Promise<Result<void, ApiFailure>>
  readonly logout: () => Promise<void>
  readonly resolveSession: () => Promise<RefreshMeResult>
  readonly retry: () => Promise<void>
  readonly expire: () => void
  /** 主体離脱の後始末が呼ぶ再生停止の登録口。最後に登録された 1 つを保持し、戻り値で解除する（web-dec-73）。 */
  readonly registerSubjectLeaveStep: (stop: () => void | Promise<void>) => () => void
}

export interface AccountSessionQueries {
  readonly session: () => AuthSession
  /** session が同じ間は同じ object（購読の snapshot）。 */
  readonly view: () => AuthView
  /** 確定した主体の user_id。通信断（unavailable）では直前の主体を保つ（web-dec-80）。 */
  readonly currentUserId: () => string | null
  readonly subscribe: (listener: () => void) => () => void
}

// getMe の失敗を事象に分類する（web-dec-67）。401 だけが未認証で、それ以外は一時障害。
function classifyGetMeFailure(failure: ApiFailure): AuthEvent {
  switch (failure.kind) {
    case 'unauthorized':
      return { type: 'unauthorized' }
    case 'network':
    case 'timeout':
      return { type: 'failed', failure: { reason: 'network' } }
    case 'server':
      return { type: 'failed', failure: { reason: 'server' } }
    default:
      return { type: 'failed', failure: { reason: 'unknown' } }
  }
}

// getMe の結果か reject を、成功の user か失敗の事象にまとめる。
async function resolveMe(gateway: AccountGateway): Promise<Result<AuthSessionUser, AuthEvent>> {
  try {
    const result = await gateway.getMe()
    return result.ok ? result : { ok: false, failure: classifyGetMeFailure(result.failure) }
  } catch {
    return { ok: false, failure: { type: 'failed', failure: { reason: 'unknown' } } }
  }
}

export function createAccountSession(deps: AccountSessionDeps): AccountSessionCommands & AccountSessionQueries {
  const { gateway, speed } = deps
  // 状態の更新は同期に行う: 同時の 2 件目が再描画を待たずに最新の値を見る。
  let session: AuthSession = deps.initialSession ?? RESOLVING_SESSION
  // 主体は session の外で持つ: unavailable をまたいで A を保つ必要があり、session からは導けない（web-dec-80）。
  let lastSubject: Subject | null =
    deps.initialSession?.kind === 'authenticated' ? subjectOf(deps.initialSession.user.userId) : null
  // 起動時の回収は最初の確定事象で 1 回だけ（shared-leave-08・09）。
  let reclaimed = false
  let leaveStep: (() => void | Promise<void>) | null = null
  const listeners = new Set<() => void>()
  let viewSnapshot: { readonly session: AuthSession; readonly view: AuthView } | null = null

  const currentUserId = (): string | null => lastSubject?.userId ?? null

  const dispatch = (event: AuthEvent): void => {
    session = reduce(session, event)
    for (const listener of [...listeners]) listener()
  }

  const view = (): AuthView => {
    if (viewSnapshot === null || viewSnapshot.session !== session) {
      viewSnapshot = { session, view: authView(session) }
    }
    return viewSnapshot.view
  }

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const registerSubjectLeaveStep = (stop: () => void | Promise<void>): (() => void) => {
    leaveStep = stop
    return () => {
      if (leaveStep === stop) leaveStep = null
    }
  }

  // 手順の組立ては呼出時に行う（render の間に store を作らない）。
  const cleanup = (subject: Subject, options: { readonly audio: boolean }) =>
    createSubjectCleanup({
      ...deps.cleanupSteps(subject, currentUserId),
      stopPlayback: () => leaveStep?.(),
    })(subject, options)

  // 最初の確定事象でだけ回収を始める。フラグは同期に立てる（resolveSession が並行しても 2 回走らない）。
  // 失敗は無視する: 回収は次回起動でも収束し、状態遷移と RefreshMeResult に影響しない。
  const reclaimOnce = (): Promise<void> => {
    if (reclaimed) return Promise.resolve()
    reclaimed = true
    // 位置の回収は同期で行い、音声キャッシュの回収（非同期）の失敗や待ちに左右させない。
    try {
      deps.reclaim.positions(currentUserId())
    } catch {
      // 次回起動の回収で収束する。
    }
    return (async () => {
      try {
        await deps.reclaim.audio(currentUserId)
      } catch {
        // 次回起動の回収で収束する。
      }
    })()
  }

  // 失効（unauthorized）の後始末。resolveSession の 401 と expire が共有する。
  const cleanupAfterExpiry = async (): Promise<RefreshMeResult> => {
    const previous = lastSubject
    lastSubject = null
    speed.forget()
    const reclaiming = reclaimOnce()
    let result: RefreshMeResult
    if (previous !== null) {
      // 実行中の 401 では音声を消さない（次回起動の回収が消す。web-dec-83）。
      result = { cleanup: (await cleanup(previous, { audio: false })).ok ? 'done' : 'incomplete' }
    } else {
      try {
        await deps.cleanupSteps({ userId: null }, currentUserId).clearServiceWorkerCaches()
        result = { cleanup: 'done' }
      } catch {
        // キャッシュ消去の失敗は状態遷移を妨げない（observable な incomplete を返すのみ）。
        result = { cleanup: 'incomplete' }
      }
    }
    await reclaiming
    return result
  }

  const resolveSession = async (): Promise<RefreshMeResult> => {
    const resolved = await resolveMe(gateway)
    if (!resolved.ok) {
      const event = resolved.failure
      dispatch(event)
      // 失効 cleanup は「実際に失効した」と判定できる 401 のときのみ発火する。
      // 通信断や 401 以外では shell-*/api-* を残す（直前の状態は問わない）。
      if (event.type !== 'unauthorized') return { cleanup: 'skipped' }
      return cleanupAfterExpiry()
    }
    const me = resolved.value
    if (lastSubject?.userId !== me.userId) speed.forget()
    lastSubject = subjectOf(me.userId)
    dispatch({ type: 'resolved', user: me })
    void speed.copy(() => lastSubject)
    await reclaimOnce()
    return { cleanup: 'skipped' }
  }

  // Provider 経由の任意 API の unauthorized。authenticated のときだけ未認証へ移り、後始末を 1 回走らせる。
  // それ以外の状態では何も動かさない（ログイン失敗の 401 など。shared-leave-05）。結果は捨てる。
  const expire = (): void => {
    if (session.kind !== 'authenticated') return
    dispatch({ type: 'expired' })
    void cleanupAfterExpiry()
  }

  const retry = async (): Promise<void> => {
    dispatch({ type: 'retry' })
    await resolveSession()
  }

  // login・register・passkey の成功。B の確立が先で、A の後始末は待たない（shared-dec-28）。
  const establish = (user: AuthSessionUser): void => {
    const previous = lastSubject
    const next = subjectOf(user.userId)
    if (previous?.userId !== next.userId) speed.forget()
    lastSubject = next
    dispatch({ type: 'signedIn', user })
    void speed.copy(() => lastSubject)
    const sameSubject = previous !== null && previous.userId !== null && previous.userId === next.userId
    if (previous !== null && !sameSubject) void cleanup(previous, { audio: true })
    void reclaimOnce()
  }

  const login = async (username: string, password: string): Promise<Result<void, ApiFailure>> => {
    // API の失敗は状態を変えず Result で返す。reject は伝播する。成功時のみ状態を更新する。
    const res = await gateway.login(username, password)
    if (!res.ok) return res
    establish(res.value)
    return { ok: true, value: undefined }
  }

  const register = async (form: RegisterForm): Promise<Result<void, ApiFailure>> => {
    const res = await gateway.register(form)
    if (!res.ok) return res
    establish(res.value)
    return { ok: true, value: undefined }
  }

  const loginWithPasskey = async (): Promise<Result<void, ApiFailure>> => {
    // 手順（options 取得 → ceremony → verify）は passkey の use case。port の例外は伝播する。
    const res = await passkeyLogin(gateway, deps.webAuthn)
    if (!res.ok) return res
    establish(res.value.user)
    return { ok: true, value: undefined }
  }

  const logout = async (): Promise<void> => {
    try {
      await deps.detachNotifications()
    } catch {
      // 購読行の削除はベストエフォート（決定 23）。失敗した行は次のログイン時の再送で上書きされる。
    }
    try {
      await gateway.logout()
    } catch {
      // ログアウトはベストエフォート（サーバー失効に失敗してもローカル状態は落とす）。
    }
    const previous = lastSubject ?? { userId: null }
    lastSubject = null
    speed.forget()
    dispatch({ type: 'loggedOut' })
    // 後始末の完了は待たず、結果（CleanupIncomplete）も捨てる。端末全体の音声消去は残さない（§6.3 性質 1）。
    void cleanup(previous, { audio: true })
  }

  return {
    login,
    register,
    loginWithPasskey,
    logout,
    resolveSession,
    retry,
    expire,
    registerSubjectLeaveStep,
    session: () => session,
    view,
    currentUserId,
    subscribe,
  }
}
