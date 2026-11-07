// context ごとの API export 集合（lib/<context>/infrastructure/api.ts）と lib/api/* の関数の対応を固定する。
// 各 import() は文字列リテラルにする（テスト隔離の検査が specifier を静的に解決するため）。
import { afterEach, describe, expect, test, vi } from 'vitest'

const keys = (mod: object) => Object.keys(mod).sort()

const CATALOG = [
  'getFeed',
  'getStarredArticles',
  'starArticle',
  'dismissArticle',
  'unstarArticle',
  'getPodcasts',
  'getPodcast',
  'getSources',
  'addSource',
  'deleteSource',
  'getFeaturedSources',
  'getOnboardingStatus',
  'completeOnboarding',
  'getGenerationQuota',
]
const ACCOUNT = [
  'login',
  'logout',
  'register',
  'getMe',
  'updateProfile',
  'changePassword',
  'deleteAccount',
  'getPasskeyRegisterOptions',
  'verifyPasskeyRegistration',
  'getPasskeyLoginOptions',
  'verifyPasskeyLogin',
  'getPasskeyCredentials',
  'deletePasskeyCredential',
  'getSessions',
  'revokeSession',
  'revokeOtherSessions',
]
const PREFERENCES = ['getPreferences', 'updatePreferences']
const ADMIN = [
  'getMetrics',
  'listUsers',
  'createUser',
  'updateUser',
  'deleteUser',
  'createInvite',
  'listInvites',
  'revokeInvite',
  'listFeaturedSites',
  'createFeaturedSite',
  'updateFeaturedSite',
  'deleteFeaturedSite',
]
const LEARNING = [
  'getListeningStreak',
  'getDifficultySuggestion',
  'getLearningDashboard',
  'saveVocabulary',
  'getVocabulary',
  'getVocabularyTestSession',
  'submitVocabularyTestResult',
  'submitQuizAnswers',
]
const NOTIFICATIONS = ['getVapidPublicKey', 'subscribePush', 'unsubscribePush']
const PLATFORM = ['checkHealth']
// Playback の 2 関数は export 集合に入れず、lib/api/podcasts.ts から直接呼ぶ。
const PLAYBACK = ['updatePosition', 'markCompleted']

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('context ごとの API export 集合', () => {
  test('catalog', async () => {
    expect(keys(await import('@/lib/catalog/infrastructure/api'))).toEqual([...CATALOG].sort())
  })
  test('account', async () => {
    expect(keys(await import('@/lib/account/infrastructure/api'))).toEqual([...ACCOUNT].sort())
  })
  test('preferences', async () => {
    expect(keys(await import('@/lib/preferences/infrastructure/api'))).toEqual([...PREFERENCES].sort())
  })
  test('admin', async () => {
    expect(keys(await import('@/lib/admin/infrastructure/api'))).toEqual([...ADMIN].sort())
  })
  test('learning', async () => {
    expect(keys(await import('@/lib/learning/infrastructure/api'))).toEqual([...LEARNING].sort())
  })
  test('notifications', async () => {
    expect(keys(await import('@/lib/notifications/infrastructure/api'))).toEqual([...NOTIFICATIONS].sort())
  })
  test('platform/health', async () => {
    expect(keys(await import('@/lib/platform/health'))).toEqual(PLATFORM)
  })
})

describe('lib/api/* の関数は 7 つの集合と Playback の 2 関数で過不足なく分かれる', () => {
  test('和集合が 58 関数で、重複がない', async () => {
    const modules = [
      await import('@/lib/api/admin'),
      await import('@/lib/api/articles'),
      await import('@/lib/api/auth'),
      await import('@/lib/api/feed'),
      await import('@/lib/api/health'),
      await import('@/lib/api/notifications'),
      await import('@/lib/api/podcasts'),
      await import('@/lib/api/settings'),
      await import('@/lib/api/users'),
      await import('@/lib/api/vocabulary'),
    ]
    const all = modules.flatMap(keys)
    expect(new Set(all).size).toBe(all.length)
    expect(all).toHaveLength(58)

    const sets = [CATALOG, ACCOUNT, PREFERENCES, ADMIN, LEARNING, NOTIFICATIONS, PLATFORM, PLAYBACK].flat()
    expect(all.sort()).toEqual(sets.sort())
  })
})

describe('deleteAccount の 204', () => {
  test('noContent を付けて送るので、204 は成功になる', async () => {
    const fetchStub = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: () => Promise.reject(new SyntaxError('no body')),
      text: () => Promise.resolve(''),
      headers: { get: () => null },
    })
    vi.stubGlobal('fetch', fetchStub)
    const { createGateway } = await import('@/lib/api/gateway')
    const { deleteAccount } = await import('@/lib/api/auth')

    const result = await deleteAccount(createGateway(), 'pw')

    expect(result).toEqual({ ok: true, value: undefined })
    expect(fetchStub).toHaveBeenCalledTimes(1)
    const [path, init] = fetchStub.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/backend/auth/me')
    expect(init.method).toBe('DELETE')
    expect(JSON.parse(init.body as string)).toEqual({ current_password: 'pw' })
  })

  test('401 は失敗の Result で返り、throw しない', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ detail: 'x' }),
        text: () => Promise.resolve('{"detail":"x"}'),
        headers: { get: () => null },
      }),
    )
    const { createGateway } = await import('@/lib/api/gateway')
    const { deleteAccount } = await import('@/lib/api/auth')

    const result = await deleteAccount(createGateway(), 'pw')

    expect(result).toEqual({ ok: false, failure: { kind: 'unauthorized' } })
  })
})
