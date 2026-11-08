/**
 * Passkey (WebAuthn) 登録・認証の手順。
 *
 * React もブラウザグローバルも参照しない。gateway（PasskeyClient）と WebAuthnPort を DI で受け取り、
 * ceremony とエラー伝播のみを担う。
 * options は gateway が parse 済みで渡す。API の失敗は最初のものを Result で返し、以降の手順を実行しない。
 * port の例外は呼び出し側に伝播する（UI 文言の決定は UI 層の責務）。
 */
import type { PasskeyChallenge, PasskeyLogin, WebAuthnPort } from './ports'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

export interface PasskeyClient {
  getPasskeyRegisterOptions(): Promise<Result<PasskeyChallenge, ApiFailure>>
  verifyPasskeyRegistration(
    challenge_id: string,
    credential: unknown,
  ): Promise<Result<{ readonly status: string }, ApiFailure>>
  getPasskeyLoginOptions(): Promise<Result<PasskeyChallenge, ApiFailure>>
  verifyPasskeyLogin(challenge_id: string, credential: unknown): Promise<Result<PasskeyLogin, ApiFailure>>
}

export async function registerPasskey(
  client: PasskeyClient,
  port: WebAuthnPort,
): Promise<Result<void, ApiFailure>> {
  const challenge = await client.getPasskeyRegisterOptions()
  if (!challenge.ok) return challenge
  const credential = await port.startRegistration(challenge.value.options)
  const verified = await client.verifyPasskeyRegistration(challenge.value.challenge_id, credential)
  return verified.ok ? { ok: true, value: undefined } : verified
}

/** 成功時のセッション Cookie は backend が httpOnly で発行する。token は web では未使用。 */
export async function loginWithPasskey(
  client: PasskeyClient,
  port: WebAuthnPort,
): Promise<Result<PasskeyLogin, ApiFailure>> {
  const challenge = await client.getPasskeyLoginOptions()
  if (!challenge.ok) return challenge
  const credential = await port.startAuthentication(challenge.value.options)
  return client.verifyPasskeyLogin(challenge.value.challenge_id, credential)
}
