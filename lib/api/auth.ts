import type {
  AuthUser,
  LoginResponse,
  RegisterInput,
  PasskeyOptionsResponse,
  PasskeyCredentialsListResponse,
  SessionsListResponse,
  RevokeSessionsResponse,
} from '@/types/index'
import { request } from '@/lib/api/legacyRequest'

// ── 認証（セッション） ──────────────────────────────────────

export function login(username: string, password: string) {
  return request<LoginResponse>('/api/backend/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export function logout() {
  return request<{ status: string }>('/api/backend/auth/logout', { method: 'POST' })
}

/**
 * 招待コードによる新規登録。成功時（201）は login と同じ LoginResponse を返し、
 * httpOnly セッション Cookie を発行する。invite_code/display_name は未指定なら
 * ボディへ含めない（バックエンドの Optional フィールドとの整合）。
 */
export function register(input: RegisterInput) {
  const body: Record<string, string> = { username: input.username, password: input.password }
  if (input.invite_code) body.invite_code = input.invite_code
  if (input.display_name) body.display_name = input.display_name
  return request<LoginResponse>('/api/backend/auth/register', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function getMe() {
  return request<AuthUser>('/api/backend/auth/me', { method: 'GET' })
}

export function updateProfile(displayName: string) {
  return request<AuthUser>('/api/backend/auth/me', {
    method: 'PATCH',
    body: JSON.stringify({ display_name: displayName }),
  })
}

export function changePassword(currentPassword: string, newPassword: string) {
  return request<{ status: string }>('/api/backend/auth/password', {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  })
}

/**
 * アカウント削除（退会）。要ログイン・CSRF 必須（request() が自動付与）。
 * 成功時（204）はサーバー側でセッション Cookie が失効するため戻り値は無い。
 * 403 = パスワード不一致 / 401 = 未認証 / 409 = 最後の管理者のため削除不可（呼び出し側で判定）。
 */
export function deleteAccount(currentPassword: string) {
  return request<void>('/api/backend/auth/me', {
    method: 'DELETE',
    body: JSON.stringify({ current_password: currentPassword }),
  })
}

// ── Passkey / WebAuthn ────────────────────────────────────────────
// register/options・login/options は認証不要だが credentials:'include' で Cookie を送る。
// register/options・register/verify・delete は CSRF 必須（X-CSRF-Token は request() が自動付与）。
// login/options・login/verify は CSRF 免除（backend の csrf.py 設定参照）。

/** 登録オプション取得。要ログイン・CSRF 必須。options は JSON 文字列で返る → 呼び出し側で JSON.parse。 */
export function getPasskeyRegisterOptions() {
  return request<PasskeyOptionsResponse>(
    '/api/backend/auth/passkey/register/options',
    { method: 'POST' },
  )
}

/** 登録検証。要ログイン・CSRF 必須。credential は startRegistration の戻り値をそのまま渡す。 */
export function verifyPasskeyRegistration(challenge_id: string, credential: unknown) {
  return request<{ status: string }>(
    '/api/backend/auth/passkey/register/verify',
    { method: 'POST', body: JSON.stringify({ challenge_id, credential }) },
  )
}

/** ログインオプション取得。認証不要・CSRF 免除。discoverable フロー（username 不送信）。*/
export function getPasskeyLoginOptions() {
  return request<PasskeyOptionsResponse>(
    '/api/backend/auth/passkey/login/options',
    { method: 'POST' },
  )
}

/** ログイン検証。認証不要・CSRF 免除。成功時は httpOnly Cookie セッションを発行し LoginResponse を返す。 */
export function verifyPasskeyLogin(challenge_id: string, credential: unknown) {
  return request<LoginResponse>(
    '/api/backend/auth/passkey/login/verify',
    { method: 'POST', body: JSON.stringify({ challenge_id, credential }) },
  )
}

/** 登録済みクレデンシャル一覧。要ログイン。public_key は含まれない。 */
export function getPasskeyCredentials() {
  return request<PasskeyCredentialsListResponse>(
    '/api/backend/auth/passkey/credentials',
    { method: 'GET' },
  )
}

/** クレデンシャル削除。要ログイン・CSRF 必須。credential_id は encodeURIComponent で安全にエスケープ。 */
export function deletePasskeyCredential(credential_id: string) {
  return request<{ status: string }>(
    `/api/backend/auth/passkey/credentials/${encodeURIComponent(credential_id)}`,
    { method: 'DELETE' },
  )
}

/** 自分の有効セッション（ログイン中デバイス）一覧。要ログイン。issue #84。 */
export function getSessions() {
  return request<SessionsListResponse>('/api/backend/auth/sessions', { method: 'GET' })
}

/** セッションを個別失効。要ログイン・CSRF 必須。他人/不在は 404。 */
export function revokeSession(session_id: string) {
  return request<{ status: string }>(
    `/api/backend/auth/sessions/${encodeURIComponent(session_id)}`,
    { method: 'DELETE' },
  )
}

/** 現在以外のセッションを一括失効（他のデバイスからログアウト）。要ログイン・CSRF 必須。 */
export function revokeOtherSessions() {
  return request<RevokeSessionsResponse>('/api/backend/auth/sessions/revoke-others', {
    method: 'POST',
  })
}
