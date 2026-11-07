/**
 * Passkey (WebAuthn) 登録・認証の純粋なフロー。
 *
 * React もブラウザグローバルも参照しない。
 * API クライアントと WebAuthnBrowserPort を DI で受け取り、
 * ceremony とエラー伝播のみを担う。
 *
 * 設計上の境界:
 *   - ブラウザ WebAuthn 操作 → WebAuthnBrowserPort
 *   - ネットワーク通信 → PasskeyClient (Result を返す client。呼出側が gateway に束縛して渡す)
 *   - React 状態管理 → 呼び出し側 (AuthProvider 等)
 */
import type { WebAuthnBrowserPort } from '@/lib/webauthnBrowserPort'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'
import type { LoginResponse, PasskeyOptionsResponse } from '@/types/index'

/** passkey.ts が依存する API クライアントの最小インターフェース */
export interface PasskeyClient {
  getPasskeyRegisterOptions(): Promise<Result<PasskeyOptionsResponse, ApiFailure>>
  verifyPasskeyRegistration(
    challenge_id: string,
    credential: unknown,
  ): Promise<Result<{ readonly status: string }, ApiFailure>>
  getPasskeyLoginOptions(): Promise<Result<PasskeyOptionsResponse, ApiFailure>>
  verifyPasskeyLogin(challenge_id: string, credential: unknown): Promise<Result<LoginResponse, ApiFailure>>
}

/**
 * Passkey 登録セレモニーを実行する。
 *
 * 1. GET /auth/passkey/register/options → options(JSON文字列) + challenge_id
 * 2. JSON.parse(options) → startRegistration (browser ceremony)
 * 3. POST /auth/passkey/register/verify { challenge_id, credential }
 *
 * API の失敗は最初のものを Result で返し、以降の手順を実行しない。port と JSON.parse の例外は
 * 呼び出し側に伝播する（UI 文言の決定は UI 層の責務）。
 */
export async function registerPasskey(
  client: PasskeyClient,
  port: WebAuthnBrowserPort,
): Promise<Result<void, ApiFailure>> {
  const optionsResult = await client.getPasskeyRegisterOptions()
  if (!optionsResult.ok) return optionsResult
  const { challenge_id, options } = optionsResult.value
  // WHY: backend は options を JSON 文字列で返す（options_to_json() の出力）。
  //      startRegistration は parsed オブジェクトを要求するため、ここで parse する。
  const parsedOptions = JSON.parse(options)
  const credential = await port.startRegistration(parsedOptions)
  const verified = await client.verifyPasskeyRegistration(challenge_id, credential)
  return verified.ok ? { ok: true, value: undefined } : verified
}

/**
 * Passkey ログインセレモニーを実行し LoginResponse を返す。
 *
 * 1. POST /auth/passkey/login/options → options(JSON文字列) + challenge_id
 *    (discoverable flow: username 不要)
 * 2. JSON.parse(options) → startAuthentication (browser ceremony)
 * 3. POST /auth/passkey/login/verify { challenge_id, credential } → LoginResponse
 *
 * 成功時のセッション Cookie は backend が httpOnly で発行するため、
 * token フィールドは web では未使用（AuthProvider が user を取り出して signedIn 事象を送る）。
 */
export async function loginWithPasskey(
  client: PasskeyClient,
  port: WebAuthnBrowserPort,
): Promise<Result<LoginResponse, ApiFailure>> {
  const optionsResult = await client.getPasskeyLoginOptions()
  if (!optionsResult.ok) return optionsResult
  const { challenge_id, options } = optionsResult.value
  const parsedOptions = JSON.parse(options)
  const credential = await port.startAuthentication(parsedOptions)
  return client.verifyPasskeyLogin(challenge_id, credential)
}
