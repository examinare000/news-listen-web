/**
 * ブラウザ WebAuthn API を抽象化するポートインターフェース。
 *
 * @simplewebauthn/browser の startRegistration / startAuthentication を呼ぶ**唯一の場所**。
 * 既存の pushBrowserPort.ts と同じ設計思想:
 *   - 本番コード: createRealWebAuthnBrowserPort()
 *   - テスト:     createFakeWebAuthnBrowserPort()
 * テストで vi.mock('@simplewebauthn/browser') を使うのはこのファイルのテストのみ。
 */
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser'
import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/browser'

export interface WebAuthnBrowserPort {
  startRegistration(options: PublicKeyCredentialCreationOptionsJSON): Promise<RegistrationResponseJSON>
  startAuthentication(options: PublicKeyCredentialRequestOptionsJSON): Promise<AuthenticationResponseJSON>
  /** ブラウザが WebAuthn をサポートしているか判定。非対応環境では Passkey ボタンを無効化するために使用。 */
  supportsWebAuthn(): boolean
}

/**
 * 実ブラウザ用の WebAuthnBrowserPort 実装。
 * 本番コードでのみ使用。テストでは createFakeWebAuthnBrowserPort() を使う。
 */
export function createRealWebAuthnBrowserPort(): WebAuthnBrowserPort {
  return {
    startRegistration: (options) => startRegistration({ optionsJSON: options }),
    startAuthentication: (options) => startAuthentication({ optionsJSON: options }),
    supportsWebAuthn: () => browserSupportsWebAuthn(),
  }
}

type FakeWebAuthnBrowserPortOverrides = Partial<WebAuthnBrowserPort>

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

/**
 * テスト用の偽 WebAuthnBrowserPort ファクトリ。
 *
 * デフォルトは成功する応答を返す。オーバーライドで任意の動作・エラーをシミュレートできる。
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
export function createFakeWebAuthnBrowserPort(
  overrides: FakeWebAuthnBrowserPortOverrides = {},
): WebAuthnBrowserPort {
  const defaults: WebAuthnBrowserPort = {
    startRegistration: async () => FAKE_REGISTRATION_RESPONSE,
    startAuthentication: async () => FAKE_AUTHENTICATION_RESPONSE,
    supportsWebAuthn: () => true,
  }
  return { ...defaults, ...overrides }
}
