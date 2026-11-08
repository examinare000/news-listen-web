/**
 * テスト用の偽 WebAuthnPort ファクトリ。
 *
 * デフォルトは成功する応答を返す。オーバーライドで任意の動作・エラーをシミュレートできる。
 * fake は production に置かない（unit のテストが値で import できるよう、依存は `import type` だけにする）。
 *
 * @example
 * // ユーザーキャンセルのシミュレーション
 * const port = createFakeWebAuthnBrowserPort({
 *   startAuthentication: async () => { throw new DOMException('', 'NotAllowedError') }
 * })
 *
 * @example
 * // WebAuthn 非対応環境のシミュレーション
 * const port = createFakeWebAuthnBrowserPort({
 *   supportsWebAuthn: () => false
 * })
 */
import type { WebAuthnPort } from '@/lib/account/application/ports'
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/browser'

type FakeWebAuthnBrowserPortOverrides = Partial<WebAuthnPort>

/** fake の startRegistration がデフォルトで返すレスポンス */
const FAKE_REGISTRATION_RESPONSE: RegistrationResponseJSON = {
  id: 'fake-credential-id',
  rawId: 'fake-credential-id',
  type: 'public-key',
  response: {
    clientDataJSON: 'fake-client-data',
    attestationObject: 'fake-attestation',
    transports: [],
  },
  clientExtensionResults: {},
  authenticatorAttachment: 'platform',
}

/** fake の startAuthentication がデフォルトで返すレスポンス */
const FAKE_AUTHENTICATION_RESPONSE: AuthenticationResponseJSON = {
  id: 'fake-credential-id',
  rawId: 'fake-credential-id',
  type: 'public-key',
  response: {
    clientDataJSON: 'fake-client-data',
    authenticatorData: 'fake-auth-data',
    signature: 'fake-signature',
  },
  clientExtensionResults: {},
  authenticatorAttachment: 'platform',
}

export function createFakeWebAuthnBrowserPort(
  overrides: FakeWebAuthnBrowserPortOverrides = {},
): WebAuthnPort {
  const defaults: WebAuthnPort = {
    startRegistration: async () => FAKE_REGISTRATION_RESPONSE,
    startAuthentication: async () => FAKE_AUTHENTICATION_RESPONSE,
    supportsWebAuthn: () => true,
  }
  return { ...defaults, ...overrides }
}
