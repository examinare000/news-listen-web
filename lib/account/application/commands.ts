// Account の command: web-cmd-account-07〜13。検査はしない（入力の検査は画面の責務。web-dec-121）。
// 失敗（ApiFailure）は変えずに返し、reject は握りつぶさず呼び手へ伝える（web-dec-110）。
import type { AccountGateway, WebAuthnPort } from '@/lib/account/application/ports'
import { registerPasskey } from '@/lib/account/application/passkey'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

export interface AccountCommands {
  updateProfile(displayName: string): Promise<Result<void, ApiFailure>>
  changePassword(current: string, next: string): Promise<Result<void, ApiFailure>>
  deleteAccount(password: string): Promise<Result<void, ApiFailure>>
  registerPasskey(): Promise<Result<void, ApiFailure>>
  deletePasskey(credentialId: string): Promise<Result<void, ApiFailure>>
  revokeSession(sessionId: string): Promise<Result<void, ApiFailure>>
  revokeOtherSessions(): Promise<Result<{ readonly revoked: number }, ApiFailure>>
}

export function createAccountCommands({
  gateway,
  webAuthn,
}: {
  readonly gateway: AccountGateway
  readonly webAuthn: WebAuthnPort
}): AccountCommands {
  return {
    updateProfile: (displayName) => gateway.updateProfile(displayName),
    changePassword: (current, next) => gateway.changePassword(current, next),
    deleteAccount: (password) => gateway.deleteAccount(password),
    registerPasskey: () => registerPasskey(gateway, webAuthn),
    deletePasskey: (credentialId) => gateway.deletePasskey(credentialId),
    revokeSession: (sessionId) => gateway.revokeSession(sessionId),
    async revokeOtherSessions() {
      const result = await gateway.revokeOtherSessions()
      return result.ok ? { ok: true, value: Object.freeze({ revoked: result.value.revoked }) } : result
    },
  }
}
