import type { AuthSessionUser } from '@/lib/account/domain/authSession'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'
import type { PasskeyRow, SessionRow } from './readModels'

export interface PasskeyChallenge {
  readonly challenge_id: string
  readonly options: unknown
}

export interface PasskeyLogin {
  readonly token: string
  readonly user: AuthSessionUser
}

export interface RegisterForm {
  readonly invite_code?: string
  readonly username: string
  readonly password: string
  readonly display_name?: string
}

export interface AccountGateway {
  getMe(): Promise<Result<AuthSessionUser, ApiFailure>>
  login(username: string, password: string): Promise<Result<AuthSessionUser, ApiFailure>>
  register(form: RegisterForm): Promise<Result<AuthSessionUser, ApiFailure>>
  logout(): Promise<Result<void, ApiFailure>>
  getPasskeyRegisterOptions(): Promise<Result<PasskeyChallenge, ApiFailure>>
  getPasskeyLoginOptions(): Promise<Result<PasskeyChallenge, ApiFailure>>
  verifyPasskeyRegistration(
    challenge_id: string,
    credential: unknown,
  ): Promise<Result<{ readonly status: string }, ApiFailure>>
  verifyPasskeyLogin(challenge_id: string, credential: unknown): Promise<Result<PasskeyLogin, ApiFailure>>
  updateProfile(displayName: string): Promise<Result<void, ApiFailure>>
  changePassword(current: string, next: string): Promise<Result<void, ApiFailure>>
  deleteAccount(password: string): Promise<Result<void, ApiFailure>>
  deletePasskey(credentialId: string): Promise<Result<void, ApiFailure>>
  revokeSession(sessionId: string): Promise<Result<void, ApiFailure>>
  listPasskeys(): Promise<Result<ReadonlyArray<PasskeyRow>, ApiFailure>>
  listSessions(): Promise<Result<ReadonlyArray<SessionRow>, ApiFailure>>
  revokeOtherSessions(): Promise<Result<{ readonly revoked: number }, ApiFailure>>
}

export interface WebAuthnPort {
  startRegistration(options: unknown): Promise<unknown>
  startAuthentication(options: unknown): Promise<unknown>
  supportsWebAuthn(): boolean
}
