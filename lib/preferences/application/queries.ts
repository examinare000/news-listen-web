// Preferences の query（読み取りだけ）: web-query-prefs-02。失敗は Result で返し、toast は page が出す。
import type { PreferencesGateway } from '@/lib/preferences/application/ports'
import { toServerPreferencesView, type ServerPreferencesView } from '@/lib/preferences/application/readModels'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

export interface PreferencesQueries {
  getServerPreferences(): Promise<Result<ServerPreferencesView, ApiFailure>>
}

export function createPreferencesQueries({ gateway }: { readonly gateway: PreferencesGateway }): PreferencesQueries {
  return {
    async getServerPreferences() {
      const result = await gateway.get()
      return result.ok ? { ok: true, value: toServerPreferencesView(result.value) } : result
    },
  }
}
