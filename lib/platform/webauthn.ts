/**
 * ブラウザ WebAuthn API を呼ぶ**唯一の場所**（port WebAuthnPort の実装）。
 * テストの fake は production に置かない（tests/helpers/fakeWebAuthnBrowserPort.ts）。
 */
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser'
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import type { WebAuthnPort } from '@/lib/account/application/ports'

export function createRealWebAuthnBrowserPort(): WebAuthnPort {
  return {
    startRegistration: (options) =>
      startRegistration({ optionsJSON: options as PublicKeyCredentialCreationOptionsJSON }),
    startAuthentication: (options) =>
      startAuthentication({ optionsJSON: options as PublicKeyCredentialRequestOptionsJSON }),
    supportsWebAuthn: () => browserSupportsWebAuthn(),
  }
}
