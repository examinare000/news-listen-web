/**
 * Passkey (WebAuthn) 登録・認証の純粋なフロー。
 *
 * React もブラウザグローバルも参照しない。
 * API クライアントと WebAuthnBrowserPort を DI で受け取り、
 * ceremony とエラー伝播のみを担う。
 *
 * 設計上の境界:
 *   - ブラウザ WebAuthn 操作 → WebAuthnBrowserPort
 *   - ネットワーク通信 → PasskeyClient (api.ts の createApiClient が実装)
 *   - React 状態管理 → 呼び出し側 (AuthContext 等)
 */
import type { WebAuthnBrowserPort } from '@/lib/webauthnBrowserPort'
import type { LoginResponse, PasskeyOptionsResponse } from '@/types/index'

/** passkey.ts が依存する API クライアントの最小インターフェース */
export interface PasskeyClient {
  getPasskeyRegisterOptions(): Promise<PasskeyOptionsResponse>
  verifyPasskeyRegistration(challenge_id: string, credential: unknown): Promise<{ status: string }>
  getPasskeyLoginOptions(): Promise<PasskeyOptionsResponse>
  verifyPasskeyLogin(challenge_id: string, credential: unknown): Promise<LoginResponse>
}

/**
 * Passkey 登録セレモニーを実行する。
 *
 * 1. GET /auth/passkey/register/options → options(JSON文字列) + challenge_id
 * 2. JSON.parse(options) → startRegistration (browser ceremony)
 * 3. POST /auth/passkey/register/verify { challenge_id, credential }
 *
 * エラーはすべて呼び出し側に伝播する（UI 文言の決定は UI 層の責務）。
 */
export async function registerPasskey(
  client: PasskeyClient,
  port: WebAuthnBrowserPort,
): Promise<void> {
  const { challenge_id, options } = await client.getPasskeyRegisterOptions()
  // WHY: backend は options を JSON 文字列で返す（options_to_json() の出力）。
  //      startRegistration は parsed オブジェクトを要求するため、ここで parse する。
  const parsedOptions = JSON.parse(options)
  const credential = await port.startRegistration(parsedOptions)
  await client.verifyPasskeyRegistration(challenge_id, credential)
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
 * token フィールドは web では未使用（AuthContext が user を取り出して setUser する）。
 */
export async function loginWithPasskey(
  client: PasskeyClient,
  port: WebAuthnBrowserPort,
): Promise<LoginResponse> {
  const { challenge_id, options } = await client.getPasskeyLoginOptions()
  const parsedOptions = JSON.parse(options)
  const credential = await port.startAuthentication(parsedOptions)
  return client.verifyPasskeyLogin(challenge_id, credential)
}
