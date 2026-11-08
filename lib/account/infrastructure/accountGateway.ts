// port AccountGateway の実装。lib/api/auth.ts の 16 関数を呼び、DTO を AuthSessionUser・SessionRow・PasskeyRow・{ revoked } に写す。
// passkey の options（文字列）の parse もここだけで行う。path・method・body は lib/api/auth.ts のまま。
import type { AccountGateway, PasskeyChallenge, PasskeyLogin } from '@/lib/account/application/ports'
import type { PasskeyRow, SessionRow } from '@/lib/account/application/readModels'
import type { AuthSessionUser } from '@/lib/account/domain/authSession'
import { subjectOf } from '@/lib/account/domain/subject'
import type { ApiGateway } from '@/lib/api/gateway'
import {
  changePassword,
  deleteAccount,
  deletePasskeyCredential,
  getMe,
  getPasskeyCredentials,
  getPasskeyLoginOptions,
  getPasskeyRegisterOptions,
  getSessions,
  login,
  logout,
  register,
  revokeOtherSessions,
  revokeSession,
  updateProfile,
  verifyPasskeyLogin,
  verifyPasskeyRegistration,
} from '@/lib/api/auth'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'
import type { AuthUser, PasskeyCredential, PasskeyOptionsResponse, Session } from '@/types/index'

function toUser(dto: AuthUser): AuthSessionUser {
  return {
    username: dto.username,
    role: dto.role,
    display_name: dto.display_name,
    userId: subjectOf(dto.user_id).userId,
  }
}

function toChallenge(dto: PasskeyOptionsResponse): PasskeyChallenge {
  return { challenge_id: dto.challenge_id, options: JSON.parse(dto.options) as unknown }
}

function toPasskeyRow(dto: PasskeyCredential): PasskeyRow {
  return {
    credentialId: dto.credential_id,
    name: dto.name ?? null,
    createdAt: dto.created_at,
    lastUsedAt: dto.last_used_at ?? null,
  }
}

function toSessionRow(dto: Session): SessionRow {
  return {
    id: dto.id,
    deviceLabel: dto.device_label ?? null,
    createdAt: dto.created_at,
    lastUsedAt: dto.last_used_at ?? null,
    isCurrent: dto.current,
  }
}

function mapOk<T, U>(result: Result<T, ApiFailure>, map: (value: T) => U): Result<U, ApiFailure> {
  return result.ok ? { ok: true, value: map(result.value) } : result
}

function toVoid(result: Result<unknown, ApiFailure>): Result<void, ApiFailure> {
  return mapOk(result, () => undefined)
}

export function createAccountGateway(gateway: ApiGateway): AccountGateway {
  return {
    async getMe() {
      return mapOk(await getMe(gateway), toUser)
    },
    async login(username, password) {
      return mapOk(await login(gateway, username, password), (dto) => toUser(dto.user))
    },
    async register(form) {
      return mapOk(await register(gateway, form), (dto) => toUser(dto.user))
    },
    async logout() {
      return toVoid(await logout(gateway))
    },
    async getPasskeyRegisterOptions() {
      return mapOk(await getPasskeyRegisterOptions(gateway), toChallenge)
    },
    async getPasskeyLoginOptions() {
      return mapOk(await getPasskeyLoginOptions(gateway), toChallenge)
    },
    verifyPasskeyRegistration(challengeId, credential) {
      return verifyPasskeyRegistration(gateway, challengeId, credential)
    },
    async verifyPasskeyLogin(challengeId, credential) {
      return mapOk(
        await verifyPasskeyLogin(gateway, challengeId, credential),
        (dto): PasskeyLogin => ({ token: dto.token, user: toUser(dto.user) }),
      )
    },
    async updateProfile(displayName) {
      return toVoid(await updateProfile(gateway, displayName))
    },
    async changePassword(current, next) {
      return toVoid(await changePassword(gateway, current, next))
    },
    async deleteAccount(password) {
      return toVoid(await deleteAccount(gateway, password))
    },
    async deletePasskey(credentialId) {
      return toVoid(await deletePasskeyCredential(gateway, credentialId))
    },
    async revokeSession(sessionId) {
      return toVoid(await revokeSession(gateway, sessionId))
    },
    async listPasskeys() {
      return mapOk(await getPasskeyCredentials(gateway), (dto) => dto.credentials.map(toPasskeyRow))
    },
    async listSessions() {
      return mapOk(await getSessions(gateway), (dto) => dto.sessions.map(toSessionRow))
    },
    async revokeOtherSessions() {
      return mapOk(await revokeOtherSessions(gateway), (dto) => ({ revoked: dto.revoked_count }))
    },
  }
}
