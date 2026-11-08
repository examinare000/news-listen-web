// Preferences infrastructure の preferencesGateway: port PreferencesGateway を ApiGateway の上に実装する（DTO ⇄ application の型）。
// adapter のテスト: `createGatewayDouble` の `calls` で path・method・body を見る。DTO の field 名はここ（infrastructure）だけに現れる。
//
// RED 理由（実装前）: `@/lib/preferences/infrastructure/preferencesGateway` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createPreferencesGateway } from '@/lib/preferences/infrastructure/preferencesGateway'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import { createGatewayDouble } from '../../../helpers/gatewayDouble'

const PREFS_PATH = '/api/backend/settings/preferences'

const DTO = {
  default_difficulty: 'ielts_7',
  default_playback_speed: 1.5,
  digest_enabled: true,
  digest_article_count: 8,
  weekly_goal_episodes: 5,
}

describe('createPreferencesGateway.get (web-slice-prefs-01)', () => {
  test('web-slice-prefs-01: GET を 1 回呼び、DTO を defaultDifficulty・weeklyGoal・digest に写す', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('GET', PREFS_PATH, { ok: true, value: DTO })

    const result = await createPreferencesGateway(gateway).get()

    expect(gateway.calls).toEqual([{ method: 'GET', path: PREFS_PATH, body: undefined }])
    expect(result).toEqual({
      ok: true,
      value: { defaultDifficulty: 'ielts_7', weeklyGoal: 5, digest: { enabled: true, articleCount: 8 } },
    })
  })

  test('web-slice-prefs-01: weekly_goal_episodes の欠落は null にする（既定値は足さない）。未知の難易度はそのまま素通しする', async () => {
    const gateway = createGatewayDouble()
    const withoutGoal = { ...DTO, default_difficulty: 'toeic_250' } as Partial<typeof DTO>
    delete withoutGoal.weekly_goal_episodes
    gateway.respond('GET', PREFS_PATH, { ok: true, value: withoutGoal })

    const result = await createPreferencesGateway(gateway).get()

    expect(result).toEqual({
      ok: true,
      value: { defaultDifficulty: 'toeic_250', weeklyGoal: null, digest: { enabled: true, articleCount: 8 } },
    })
  })

  test('web-slice-prefs-01: 値域外の weekly_goal_episodes も検査せず素通しする（正規化は application の責務）', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('GET', PREFS_PATH, { ok: true, value: { ...DTO, weekly_goal_episodes: 4 } })

    const result = await createPreferencesGateway(gateway).get()

    expect(result.ok && result.value.weeklyGoal).toBe(4)
  })

  test('web-slice-prefs-01: API 失敗は変えずに同じ参照で ok: false にする', async () => {
    const failure: ApiFailure = { kind: 'server', status: 500 }
    const gateway = createGatewayDouble()
    gateway.respond('GET', PREFS_PATH, { ok: false, failure })

    const result = await createPreferencesGateway(gateway).get()

    expect(result.ok).toBe(false)
    expect(!result.ok && result.failure).toBe(failure)
  })

  test('web-slice-prefs-01: ApiGateway の reject はそのまま伝える', async () => {
    const gateway = createGatewayDouble()
    gateway.respondWith('GET', PREFS_PATH, () => Promise.reject(new Error('boom')))

    await expect(createPreferencesGateway(gateway).get()).rejects.toThrow('boom')
  })
})

describe('createPreferencesGateway.patch (web-slice-prefs-01)', () => {
  test('web-slice-prefs-01: defaultDifficulty は PUT で { default_difficulty } の 1 field だけを送り、成功は void', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('PUT', PREFS_PATH, { ok: true, value: DTO })

    const result = await createPreferencesGateway(gateway).patch({ kind: 'defaultDifficulty', value: 'eiken_p1' })

    expect(gateway.calls).toEqual([{ method: 'PUT', path: PREFS_PATH, body: { default_difficulty: 'eiken_p1' } }])
    expect(result).toEqual({ ok: true, value: undefined })
  })

  test('web-slice-prefs-01: weeklyGoal は PUT で { weekly_goal_episodes } の 1 field だけを送り、応答の本文は捨てる', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('PUT', PREFS_PATH, { ok: true, value: DTO })

    const result = await createPreferencesGateway(gateway).patch({ kind: 'weeklyGoal', value: 10 })

    expect(gateway.calls).toEqual([{ method: 'PUT', path: PREFS_PATH, body: { weekly_goal_episodes: 10 } }])
    expect(result.ok && result.value).toBeUndefined()
  })

  test('web-slice-prefs-01: API 失敗は変えずに同じ参照で ok: false にする', async () => {
    const failure: ApiFailure = { kind: 'validation', detail: 'bad' }
    const gateway = createGatewayDouble()
    gateway.respond('PUT', PREFS_PATH, { ok: false, failure })

    const result = await createPreferencesGateway(gateway).patch({ kind: 'weeklyGoal', value: 3 })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.failure).toBe(failure)
  })

  test('web-slice-prefs-01: ApiGateway の reject はそのまま伝える', async () => {
    const gateway = createGatewayDouble()
    gateway.respondWith('PUT', PREFS_PATH, () => Promise.reject(new Error('boom')))

    await expect(createPreferencesGateway(gateway).patch({ kind: 'weeklyGoal', value: 3 })).rejects.toThrow('boom')
  })
})
