import { describe, test, expect, beforeEach, vi } from 'vitest'
import { createGateway } from '@/lib/api/gateway'
import type { ApiFailure, Result } from '@/lib/api/gateway'
import { starArticle, dismissArticle, unstarArticle } from '@/lib/api/articles'
import { changePassword } from '@/lib/api/auth'
import {
  getMetrics,
  listFeaturedSites,
  createFeaturedSite,
  updateFeaturedSite,
  deleteFeaturedSite,
} from '@/lib/api/admin'
import { getFeed } from '@/lib/api/feed'
import { checkHealth } from '@/lib/api/health'
import { getVapidPublicKey, subscribePush, unsubscribePush } from '@/lib/api/notifications'
import {
  getPodcasts,
  getPodcast,
  updatePosition,
  markCompleted,
  submitQuizAnswers,
} from '@/lib/api/podcasts'
import {
  getSources,
  addSource,
  deleteSource,
  getPreferences,
  updatePreferences,
} from '@/lib/api/settings'
import {
  getGenerationQuota,
  getListeningStreak,
  getDifficultySuggestion,
  getLearningDashboard,
} from '@/lib/api/users'
import {
  saveVocabulary,
  getVocabulary,
  getVocabularyTestSession,
  submitVocabularyTestResult,
} from '@/lib/api/vocabulary'
import { createGatewayDouble } from '../helpers/gatewayDouble'

function mockFetchOk(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    })
  )
}

function mockFetchErrorBody(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    })
  )
}

function unwrap<T>(result: Result<T, ApiFailure>): T {
  if (!result.ok) throw new Error(`expected an ok result, got ${result.failure.kind}`)
  return result.value
}

const NETWORK_FAILURE = { ok: false, failure: { kind: 'network' } } as const

describe('rate_limited Retry-After (#82)', () => {
  test('429 の Retry-After を rate_limited の retryAfterSeconds で返す', async () => {
    const gw = createGatewayDouble()
    const failure: ApiFailure = {
      kind: 'rate_limited',
      retryAfterSeconds: 43200,
      scope: 'unknown',
      detail: 'Daily limit reached',
    }
    gw.respond('POST', '/api/backend/articles/a1/star', { ok: false, failure })

    expect(await starArticle(gw, 'a1')).toEqual({ ok: false, failure })
  })

  test('Retry-After 不在なら retryAfterSeconds は undefined', async () => {
    const gw = createGatewayDouble()
    const failure: ApiFailure = {
      kind: 'rate_limited',
      retryAfterSeconds: undefined,
      scope: 'unknown',
      detail: 'Article not found',
    }
    gw.respond('POST', '/api/backend/articles/a1/star', { ok: false, failure })

    const result = await starArticle(gw, 'a1')
    expect(result).toEqual({ ok: false, failure })
    expect(!result.ok && result.failure.kind === 'rate_limited' && result.failure.retryAfterSeconds).toBeUndefined()
  })
})

beforeEach(() => {
  vi.restoreAllMocks()
})

// ==========================================================
// createGateway — モジュールロード時に localStorage を読まない
// ==========================================================
describe('createGateway', () => {
  test('does not access localStorage during module import or client creation', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem')
    createGateway()
    expect(spy).not.toHaveBeenCalled()
  })
})

// ==========================================================
// getFeed — GET /api/backend/feed
// ==========================================================
describe('getFeed', () => {
  test('sends GET request to /api/backend/feed with correct headers', async () => {
    mockFetchOk({ articles: [], date: '2026-06-10' })
    await getFeed(createGateway())

    expect(fetch).toHaveBeenCalledWith(
      '/api/backend/feed',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    )
  })

  test('does NOT send X-API-Key or X-Backend-Base-Url headers (injected by BFF)', async () => {
    mockFetchOk({ articles: [], date: '2026-06-10' })
    await getFeed(createGateway())

    const call = vi.mocked(fetch).mock.calls[0]
    const headers = (call[1] as RequestInit).headers as Record<string, string>
    expect(headers['X-API-Key']).toBeUndefined()
    expect(headers['X-Backend-Base-Url']).toBeUndefined()
  })

  test('returns response containing articles and date fields (interface contract)', async () => {
    const feedData = {
      articles: [
        {
          id: 'a1',
          title: 'Test',
          url: 'https://example.com',
          source: 'HN',
          score: 0.95,
          published_at: '2026-06-10T00:00:00+00:00',
        },
      ],
      date: '2026-06-10',
    }
    const gw = createGatewayDouble()
    gw.respond('GET', '/api/backend/feed', { ok: true, value: feedData })
    const result = unwrap(await getFeed(gw))

    expect(gw.calls).toEqual([{ method: 'GET', path: '/api/backend/feed', body: undefined }])
    expect(result).toHaveProperty('articles')
    expect(result).toHaveProperty('date')
    expect(Array.isArray(result.articles)).toBe(true)
  })
})

// ==========================================================
// starArticle / dismissArticle — POST /api/backend/articles/{id}/star|dismiss
// ==========================================================
describe('starArticle', () => {
  test('sends POST to /api/backend/articles/{id}/star', async () => {
    const gw = createGatewayDouble()
    gw.respond('POST', '/api/backend/articles/a1/star', {
      ok: true,
      value: { status: 'starred', article_id: 'a1' },
    })
    await starArticle(gw, 'a1')

    expect(gw.calls).toEqual([
      { method: 'POST', path: '/api/backend/articles/a1/star', body: undefined },
    ])
  })

  // issue #163: 記事単位の難易度指定 star。
  // difficulty 省略時は従来どおりボディなしで呼ぶ（後方互換）。
  test('difficulty 省略時はボディなしで送る（後方互換）', async () => {
    const gw = createGatewayDouble()
    gw.respond('POST', '/api/backend/articles/a1/star', {
      ok: true,
      value: { status: 'starred', article_id: 'a1' },
    })
    await starArticle(gw, 'a1')

    expect(gw.calls[0].body).toBeUndefined()
  })

  test('difficulty 指定時は JSON ボディ {difficulty} を送る', async () => {
    const gw = createGatewayDouble()
    gw.respond('POST', '/api/backend/articles/a1/star', {
      ok: true,
      value: { status: 'starred', article_id: 'a1' },
    })
    await starArticle(gw, 'a1', 'toeic_900')

    expect(gw.calls).toEqual([
      {
        method: 'POST',
        path: '/api/backend/articles/a1/star',
        body: { difficulty: 'toeic_900' },
      },
    ])
  })

  // issue #164 (ADR-061): 202 レスポンスの remaining をそのまま呼び出し側へ渡す（生成残回数の可視化）
  test('passes through the remaining field from the response body when present', async () => {
    const gw = createGatewayDouble()
    gw.respond('POST', '/api/backend/articles/a1/star', {
      ok: true,
      value: { status: 'starred', article_id: 'a1', remaining: 3 },
    })
    const result = unwrap(await starArticle(gw, 'a1'))

    expect(result.remaining).toBe(3)
  })

  test('passes through remaining: null (unlimited) from the response body', async () => {
    const gw = createGatewayDouble()
    gw.respond('POST', '/api/backend/articles/a1/star', {
      ok: true,
      value: { status: 'starred', article_id: 'a1', remaining: null },
    })
    const result = unwrap(await starArticle(gw, 'a1'))

    expect(result.remaining).toBeNull()
  })

  test('remaining is undefined when absent from the response body (backward compat)', async () => {
    const gw = createGatewayDouble()
    gw.respond('POST', '/api/backend/articles/a1/star', {
      ok: true,
      value: { status: 'starred', article_id: 'a1' },
    })
    const result = unwrap(await starArticle(gw, 'a1'))

    expect(result.remaining).toBeUndefined()
  })
})

// ==========================================================
// getGenerationQuota — GET /api/backend/users/me/generation-quota（ADR-061）
// ==========================================================
describe('getGenerationQuota', () => {
  const PATH = '/api/backend/users/me/generation-quota'

  test('sends GET to /api/backend/users/me/generation-quota', async () => {
    const gw = createGatewayDouble()
    gw.respond('GET', PATH, {
      ok: true,
      value: { limit: 5, used: 2, remaining: 3, reset_at: '2026-07-07T00:00:00Z' },
    })
    await getGenerationQuota(gw)

    expect(gw.calls).toEqual([{ method: 'GET', path: PATH, body: undefined }])
  })

  test('returns limit/used/remaining/reset_at fields (interface contract)', async () => {
    const quota = { limit: 5, used: 2, remaining: 3, reset_at: '2026-07-07T00:00:00Z' }
    const gw = createGatewayDouble()
    gw.respond('GET', PATH, { ok: true, value: quota })

    expect(await getGenerationQuota(gw)).toEqual({ ok: true, value: quota })
  })

  test('remaining is null when limit is 0 (unlimited)', async () => {
    const gw = createGatewayDouble()
    gw.respond('GET', PATH, {
      ok: true,
      value: { limit: 0, used: 12, remaining: null, reset_at: '2026-07-07T00:00:00Z' },
    })
    const result = unwrap(await getGenerationQuota(gw))

    expect(result.limit).toBe(0)
    expect(result.remaining).toBeNull()
  })

  // issue #82 / ADR-073 決定5: GenerationQuotaResponse.monthly（per-user 月次クォータ）を
  // そのまま透過する（backend/api/schemas.py MonthlyGenerationQuotaResponse と同じフィールド名）。
  test('returns the monthly field as-is (interface contract, issue #82)', async () => {
    const quota = {
      limit: 5,
      used: 2,
      remaining: 3,
      reset_at: '2026-07-07T00:00:00Z',
      monthly: { limit: 100, used: 40, remaining: 60, reset_at: '2026-08-01T00:00:00Z' },
    }
    const gw = createGatewayDouble()
    gw.respond('GET', PATH, { ok: true, value: quota })
    const result = unwrap(await getGenerationQuota(gw))

    expect(result.monthly).toEqual(quota.monthly)
  })

  test('returns a network failure on network failure', async () => {
    const gw = createGatewayDouble()

    expect(await getGenerationQuota(gw)).toEqual(NETWORK_FAILURE)
  })
})

// ==========================================================
// getListeningStreak — GET /api/backend/users/me/listening-streak（issue #165・ADR-062）
// ==========================================================
describe('getListeningStreak', () => {
  const PATH = '/api/backend/users/me/listening-streak'

  test('sends GET to /api/backend/users/me/listening-streak', async () => {
    const gw = createGatewayDouble()
    gw.respond('GET', PATH, {
      ok: true,
      value: { current_streak_days: 5, today_listened: true, last_listened_day: '2026-07-07' },
    })
    await getListeningStreak(gw)

    expect(gw.calls).toEqual([{ method: 'GET', path: PATH, body: undefined }])
  })

  test('returns current_streak_days/today_listened/last_listened_day fields (interface contract)', async () => {
    const streak = { current_streak_days: 5, today_listened: true, last_listened_day: '2026-07-07' }
    const gw = createGatewayDouble()
    gw.respond('GET', PATH, { ok: true, value: streak })

    expect(await getListeningStreak(gw)).toEqual({ ok: true, value: streak })
  })

  test('current_streak_days can be 0 while last_listened_day is non-null (streak broken, not never-listened)', async () => {
    const gw = createGatewayDouble()
    gw.respond('GET', PATH, {
      ok: true,
      value: { current_streak_days: 0, today_listened: false, last_listened_day: '2026-07-01' },
    })
    const result = unwrap(await getListeningStreak(gw))

    expect(result.current_streak_days).toBe(0)
    expect(result.last_listened_day).toBe('2026-07-01')
  })

  test('last_listened_day is null when the user has never listened', async () => {
    const gw = createGatewayDouble()
    gw.respond('GET', PATH, {
      ok: true,
      value: { current_streak_days: 0, today_listened: false, last_listened_day: null },
    })
    const result = unwrap(await getListeningStreak(gw))

    expect(result.last_listened_day).toBeNull()
  })

  test('returns a network failure on network failure', async () => {
    const gw = createGatewayDouble()

    expect(await getListeningStreak(gw)).toEqual(NETWORK_FAILURE)
  })
})

// ==========================================================
// getDifficultySuggestion — GET /api/backend/users/me/difficulty-suggestion（ADR-071 F3）
// ==========================================================
describe('getDifficultySuggestion', () => {
  const PATH = '/api/backend/users/me/difficulty-suggestion'

  test('sends GET to /api/backend/users/me/difficulty-suggestion', async () => {
    const gw = createGatewayDouble()
    gw.respond('GET', PATH, {
      ok: true,
      value: {
        has_suggestion: false,
        current: 'toeic_600',
        suggested: null,
        direction: null,
        reason: null,
      },
    })
    await getDifficultySuggestion(gw)

    expect(gw.calls).toEqual([{ method: 'GET', path: PATH, body: undefined }])
  })

  test('returns has_suggestion/current/suggested/direction/reason fields (interface contract)', async () => {
    const suggestion = {
      has_suggestion: true,
      current: 'toeic_600',
      suggested: 'ielts_55',
      direction: 'up',
      reason: '直近の理解度が高いため一段上の難易度を提案します',
    }
    const gw = createGatewayDouble()
    gw.respond('GET', PATH, { ok: true, value: suggestion })

    expect(await getDifficultySuggestion(gw)).toEqual({ ok: true, value: suggestion })
  })

  test('has_suggestion is false with all optional fields null when there is no recommendation', async () => {
    const gw = createGatewayDouble()
    gw.respond('GET', PATH, {
      ok: true,
      value: {
        has_suggestion: false,
        current: 'toeic_600',
        suggested: null,
        direction: null,
        reason: null,
      },
    })
    const result = unwrap(await getDifficultySuggestion(gw))

    expect(result.has_suggestion).toBe(false)
    expect(result.suggested).toBeNull()
    expect(result.direction).toBeNull()
    expect(result.reason).toBeNull()
  })

  test('returns a network failure on network failure', async () => {
    const gw = createGatewayDouble()

    expect(await getDifficultySuggestion(gw)).toEqual(NETWORK_FAILURE)
  })
})

// ==========================================================
// getLearningDashboard — GET /api/backend/users/me/learning-dashboard（ADR-072・F4）
// ==========================================================
describe('getLearningDashboard', () => {
  const PATH = '/api/backend/users/me/learning-dashboard'
  const SAMPLE_DASHBOARD = {
    streak: { current_streak_days: 5, today_listened: true, last_listened_day: '2026-07-07' },
    total_episodes: 12,
    vocabulary_acquired: 34,
    quiz: {
      quizzed_episodes: 3,
      average_correct_rate: 0.75,
      trend: [
        { graded_at: '2026-07-01T00:00:00Z', correct_rate: 0.6 },
        { graded_at: '2026-07-05T00:00:00Z', correct_rate: 0.9 },
      ],
    },
    monthly_activity: [{ month: '2026-07', active_days: 5 }],
    current_difficulty: 'toeic_600',
  }

  test('sends GET to /api/backend/users/me/learning-dashboard', async () => {
    const gw = createGatewayDouble()
    gw.respond('GET', PATH, { ok: true, value: SAMPLE_DASHBOARD })
    await getLearningDashboard(gw)

    expect(gw.calls).toEqual([{ method: 'GET', path: PATH, body: undefined }])
  })

  test('returns streak/total_episodes/vocabulary_acquired/quiz/monthly_activity/current_difficulty fields (interface contract)', async () => {
    const gw = createGatewayDouble()
    gw.respond('GET', PATH, { ok: true, value: SAMPLE_DASHBOARD })

    expect(await getLearningDashboard(gw)).toEqual({ ok: true, value: SAMPLE_DASHBOARD })
  })

  test('new user response has all-zero/empty/null fields without error', async () => {
    const emptyDashboard = {
      streak: { current_streak_days: 0, today_listened: false, last_listened_day: null },
      total_episodes: 0,
      vocabulary_acquired: 0,
      quiz: { quizzed_episodes: 0, average_correct_rate: null, trend: [] },
      monthly_activity: [],
      current_difficulty: 'toeic_600',
    }
    const gw = createGatewayDouble()
    gw.respond('GET', PATH, { ok: true, value: emptyDashboard })

    expect(await getLearningDashboard(gw)).toEqual({ ok: true, value: emptyDashboard })
  })

  test('returns a network failure on network failure', async () => {
    const gw = createGatewayDouble()

    expect(await getLearningDashboard(gw)).toEqual(NETWORK_FAILURE)
  })
})

describe('dismissArticle', () => {
  test('sends POST to /api/backend/articles/{id}/dismiss', async () => {
    const gw = createGatewayDouble()
    const dismissed = { ok: true, value: { status: 'dismissed', article_id: 'a1' } } as const
    gw.respond('POST', '/api/backend/articles/a1/dismiss', dismissed)
    const res = await dismissArticle(gw, 'a1')

    expect(gw.calls).toEqual([
      { method: 'POST', path: '/api/backend/articles/a1/dismiss', body: undefined },
    ])
    expect(res).toEqual(dismissed)
  })
})

// WHY: X-CSRF-Token 付与は gateway 共通実装の振る舞い（HTTPメソッド単位）であり、
// DELETE の付与は既に `describe('CSRF token injection')` の
// 'adds X-CSRF-Token header to DELETE when csrf_token cookie is present' で
// deleteSource を通じて検証済み。unstarArticle 固有のCSRFテストはこの既存カバレッジと
// 重複するため追加しない（他の各エンドポイントdescribeもメソッド単位のCSRFテストを
// 個別には持たない、という既存の一貫した方針に合わせる）。
describe('unstarArticle', () => {
  const PATH = '/api/backend/articles/a1/star'

  test('sends DELETE to /api/backend/articles/{id}/star', async () => {
    const gw = createGatewayDouble()
    gw.respond('DELETE', PATH, { ok: true, value: { status: 'unstarred', article_id: 'a1' } })
    await unstarArticle(gw, 'a1')

    expect(gw.calls).toEqual([{ method: 'DELETE', path: PATH, body: undefined }])
  })

  test('returns a not_found failure on failure', async () => {
    const gw = createGatewayDouble()
    gw.respond('DELETE', PATH, { ok: false, failure: { kind: 'not_found' } })

    expect(await unstarArticle(gw, 'a1')).toEqual({ ok: false, failure: { kind: 'not_found' } })
  })

  // backend の DELETE /articles/{id}/star は 200 + ActionResponse
  // （{status: "unstarred", article_id}）を返す（204 は返さない。
  // backend/api/routers/articles.py の unstar_article・
  // backend/tests/test_api_articles.py の
  // test_unstar_article_returns_200_and_removes_star で確認済み）。
  test('resolves with the actual 200 response body ({status, article_id})', async () => {
    const gw = createGatewayDouble()
    gw.respond('DELETE', PATH, { ok: true, value: { status: 'unstarred', article_id: 'a1' } })

    const result = unwrap(await unstarArticle(gw, 'a1'))
    expect(result.status).toBe('unstarred')
    expect(result.article_id).toBe('a1')
  })
})

// ==========================================================
// getPodcasts / getPodcast
// ==========================================================
describe('getPodcasts', () => {
  test('sends GET to /api/backend/podcasts', async () => {
    const gw = createGatewayDouble()
    const expected = { ok: true, value: { podcasts: [{ id: 'p1' }] } } as const
    gw.respond('GET', '/api/backend/podcasts', expected)
    const res = await getPodcasts(gw)

    expect(gw.calls).toEqual([{ method: 'GET', path: '/api/backend/podcasts', body: undefined }])
    expect(res).toEqual(expected)
  })
})

describe('getPodcast', () => {
  test('sends GET to /api/backend/podcasts/{id}', async () => {
    const podcast = {
      id: 'p1',
      type: 'single',
      article_ids: ['a1'],
      difficulty: 'toeic_900',
      audio_url: 'https://storage.example.com/audio.mp3',
      japanese_intro_text: 'テスト',
      duration_seconds: 300,
      created_at: '2026-06-10T00:00:00+00:00',
    }
    const gw = createGatewayDouble()
    gw.respond('GET', '/api/backend/podcasts/p1', { ok: true, value: podcast })
    const res = await getPodcast(gw, 'p1')

    expect(gw.calls).toEqual([
      { method: 'GET', path: '/api/backend/podcasts/p1', body: undefined },
    ])
    expect(res).toEqual({ ok: true, value: podcast })
  })
})

// ==========================================================
// getSources / addSource / deleteSource
// ==========================================================
describe('getSources', () => {
  test('sends GET to /api/backend/settings/sources', async () => {
    const gw = createGatewayDouble()
    const expected = { ok: true, value: { sources: [{ name: 'HN', url: 'https://news.ycombinator.com/rss' }] } } as const
    gw.respond('GET', '/api/backend/settings/sources', expected)
    const res = await getSources(gw)

    expect(gw.calls).toEqual([
      { method: 'GET', path: '/api/backend/settings/sources', body: undefined },
    ])
    expect(res).toEqual(expected)
  })
})

describe('addSource', () => {
  test('sends POST to /api/backend/settings/sources with name and url in body', async () => {
    const gw = createGatewayDouble()
    const expected = {
      ok: true,
      value: { sources: [{ name: 'HN', url: 'https://news.ycombinator.com/rss' }] },
    } as const
    gw.respond('POST', '/api/backend/settings/sources', expected)
    const res = await addSource(gw, 'HN', 'https://news.ycombinator.com/rss')

    expect(gw.calls).toEqual([
      {
        method: 'POST',
        path: '/api/backend/settings/sources',
        body: { name: 'HN', url: 'https://news.ycombinator.com/rss' },
      },
    ])
    expect(res).toEqual(expected)
  })
})

describe('deleteSource', () => {
  test('sends DELETE to /api/backend/settings/sources?url={encoded}', async () => {
    const sourceUrl = 'https://news.ycombinator.com/rss'
    const path = `/api/backend/settings/sources?url=${encodeURIComponent(sourceUrl)}`
    const gw = createGatewayDouble()
    const expected = { ok: true, value: { sources: [] } } as const
    gw.respond('DELETE', path, expected)
    const res = await deleteSource(gw, sourceUrl)

    expect(gw.calls).toEqual([{ method: 'DELETE', path, body: undefined }])
    expect(res).toEqual(expected)
  })

  test('encodes URL containing & character', async () => {
    const gw = createGatewayDouble()
    const urlWithAmpersand = 'https://example.com/rss?a=1&b=2'
    await deleteSource(gw, urlWithAmpersand)

    const requestUrl = gw.calls[0].path
    expect(requestUrl).toContain(encodeURIComponent(urlWithAmpersand))
    // & が素通りしていないことを確認
    expect(requestUrl).not.toContain('&b=2')
  })

  test('encodes URL containing Japanese characters', async () => {
    const gw = createGatewayDouble()
    const urlWithJapanese = 'https://example.com/日本語/rss'
    await deleteSource(gw, urlWithJapanese)

    expect(gw.calls[0].path).not.toContain('日本語')
  })
})

// ==========================================================
// checkHealth — GET /api/backend/health
// ==========================================================
describe('checkHealth', () => {
  test('sends GET to /api/backend/health', async () => {
    const gw = createGatewayDouble()
    const expected = { ok: true, value: { status: 'ok' } } as const
    gw.respond('GET', '/api/backend/health', expected)
    const res = await checkHealth(gw)

    expect(gw.calls).toEqual([{ method: 'GET', path: '/api/backend/health', body: undefined }])
    expect(res).toEqual(expected)
  })
})

// ==========================================================
// failure normalization — 異常系の正規化
// ==========================================================
describe('failure normalization', () => {
  describe('Given non-2xx response without parseable detail', () => {
    test('returns a server failure when the body is not parseable', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          json: () => Promise.reject(new SyntaxError('Unexpected token')),
          text: () => Promise.resolve('Internal Server Error'),
        })
      )

      expect(await getFeed(createGateway())).toEqual({
        ok: false,
        failure: { kind: 'server', status: 500 },
      })
    })
  })

  describe('Given 422 response (validation error)', () => {
    test('returns a validation failure with array detail (first msg)', async () => {
      mockFetchErrorBody(422, {
        detail: [
          { msg: 'password must be at least 12 characters long', type: 'value_error' },
        ],
      })

      expect(await changePassword(createGateway(), 'old', 'short')).toEqual({
        ok: false,
        failure: {
          kind: 'validation',
          detail: 'password must be at least 12 characters long',
          reason: 'schema',
        },
      })
    })

    test('returns a validation failure with empty array detail → "Unknown error"', async () => {
      mockFetchErrorBody(422, { detail: [] })

      expect(await changePassword(createGateway(), 'old', 'fail')).toEqual({
        ok: false,
        failure: { kind: 'validation', detail: 'Unknown error', reason: 'schema' },
      })
    })

    test('returns a validation failure with array detail missing msg field → "Unknown error"', async () => {
      mockFetchErrorBody(422, {
        detail: [{ type: 'value_error' }],
      })

      expect(await changePassword(createGateway(), 'old', 'fail')).toEqual({
        ok: false,
        failure: { kind: 'validation', detail: 'Unknown error', reason: 'schema' },
      })
    })
  })
})

// ==========================================================
// セキュリティ要件: API キーをログ出力しない
// (API キーが console.log の引数に渡されないことを型レベルで保証する構造的テスト)
// ==========================================================
// getPreferences — GET /api/backend/settings/preferences
// ==========================================================
describe('getPreferences', () => {
  test('sends GET request to /api/backend/settings/preferences with correct headers', async () => {
    const preferences = {
      default_difficulty: 'toeic_900' as const,
      default_playback_speed: 1.0,
      digest_enabled: true,
      digest_article_count: 10,
    }
    mockFetchOk(preferences)
    await getPreferences(createGateway())

    expect(fetch).toHaveBeenCalledWith(
      '/api/backend/settings/preferences',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    )
  })

  test('returns UserPreferences with all required fields', async () => {
    const preferences = {
      default_difficulty: 'ielts_7' as const,
      default_playback_speed: 1.25,
      digest_enabled: false,
      digest_article_count: 5,
    }
    const gw = createGatewayDouble()
    gw.respond('GET', '/api/backend/settings/preferences', { ok: true, value: preferences })
    const result = unwrap(await getPreferences(gw))

    expect(result.default_difficulty).toBe('ielts_7')
    expect(result.default_playback_speed).toBe(1.25)
    expect(result.digest_enabled).toBe(false)
    expect(result.digest_article_count).toBe(5)
  })

  test('returns a network failure on network failure', async () => {
    const gw = createGatewayDouble()

    expect(await getPreferences(gw)).toEqual(NETWORK_FAILURE)
  })
})

// ==========================================================
// updatePreferences — PUT /api/backend/settings/preferences
// ==========================================================
describe('updatePreferences', () => {
  const PATH = '/api/backend/settings/preferences'

  test('sends PUT request to /api/backend/settings/preferences with partial update body', async () => {
    const updated = {
      default_difficulty: 'eiken_2' as const,
      default_playback_speed: 1.0,
      digest_enabled: true,
      digest_article_count: 10,
    }
    const gw = createGatewayDouble()
    gw.respond('PUT', PATH, { ok: true, value: updated })
    await updatePreferences(gw, { default_difficulty: 'eiken_2' })

    expect(gw.calls).toEqual([
      { method: 'PUT', path: PATH, body: { default_difficulty: 'eiken_2' } },
    ])
  })

  test('returns updated UserPreferences', async () => {
    const updated = {
      default_difficulty: 'toeic_600' as const,
      default_playback_speed: 0.75,
      digest_enabled: true,
      digest_article_count: 20,
    }
    const gw = createGatewayDouble()
    gw.respond('PUT', PATH, { ok: true, value: updated })
    const result = unwrap(await updatePreferences(gw, { default_difficulty: 'toeic_600' }))

    expect(result.default_difficulty).toBe('toeic_600')
  })

  test('returns a validation failure on 400 Bad Request', async () => {
    const failure: ApiFailure = {
      kind: 'validation',
      detail: 'Invalid difficulty level',
      reason: 'rule',
    }
    const gw = createGatewayDouble()
    gw.respond('PUT', PATH, { ok: false, failure })

    // Pass empty patch that will fail validation
    expect(await updatePreferences(gw, {})).toEqual({ ok: false, failure })
  })
})

// ==========================================================
// updatePosition — PATCH /api/backend/podcasts/:id/position
// ==========================================================
describe('updatePosition', () => {
  const PATH = '/api/backend/podcasts/p1/position'

  test('sends PATCH request to correct endpoint with position in body', async () => {
    const podcast = {
      id: 'p1',
      type: 'single',
      article_ids: ['a1'],
      difficulty: 'toeic_900',
      audio_url: 'https://storage.example.com/audio.mp3',
      japanese_intro_text: 'test',
      duration_seconds: 300,
      created_at: '2026-06-10T09:00:00+09:00',
      status: 'completed' as const,
      error_message: null,
      playback_position_seconds: 120,
    }
    const gw = createGatewayDouble()
    gw.respond('PATCH', PATH, { ok: true, value: podcast })
    await updatePosition(gw, 'p1', 150)

    expect(gw.calls).toEqual([{ method: 'PATCH', path: PATH, body: { position_seconds: 150 } }])
  })

  test('returns updated Podcast with new position', async () => {
    const updatedPodcast = {
      id: 'p1',
      type: 'single',
      article_ids: ['a1'],
      difficulty: 'toeic_900',
      audio_url: 'https://storage.example.com/audio.mp3',
      japanese_intro_text: 'test',
      duration_seconds: 300,
      created_at: '2026-06-10T09:00:00+09:00',
      status: 'completed' as const,
      error_message: null,
      playback_position_seconds: 150,
    }
    const gw = createGatewayDouble()
    gw.respond('PATCH', PATH, { ok: true, value: updatedPodcast })
    const result = unwrap(await updatePosition(gw, 'p1', 150))

    expect(result.playback_position_seconds).toBe(150)
    expect(result.status).toBe('completed')
  })

  test('returns a not_found failure on 404 Not Found', async () => {
    const gw = createGatewayDouble()
    gw.respond('PATCH', '/api/backend/podcasts/nonexistent/position', {
      ok: false,
      failure: { kind: 'not_found' },
    })

    expect(await updatePosition(gw, 'nonexistent', 100)).toEqual({
      ok: false,
      failure: { kind: 'not_found' },
    })
  })

  test('returns a validation failure on 422 Unprocessable Entity', async () => {
    const failure: ApiFailure = {
      kind: 'validation',
      detail: 'Invalid position value',
      reason: 'schema',
    }
    const gw = createGatewayDouble()
    gw.respond('PATCH', PATH, { ok: false, failure })

    expect(await updatePosition(gw, 'p1', -100)).toEqual({ ok: false, failure })
  })

  test('returns a network failure on network failure', async () => {
    const gw = createGatewayDouble()

    expect(await updatePosition(gw, 'p1', 100)).toEqual(NETWORK_FAILURE)
  })
})

// ==========================================================
// markCompleted — POST /api/backend/podcasts/:id/completed（ADR-075: 完聴イベント発火）
// ボディ不要・fire-and-forget（サーバ側で first-write-wins）。updatePosition の鏡像。
// ==========================================================
describe('markCompleted', () => {
  const PATH = '/api/backend/podcasts/p1/completed'

  test('sends POST to /api/backend/podcasts/:id/completed with no body', async () => {
    const podcast = {
      id: 'p1',
      type: 'single',
      article_ids: ['a1'],
      difficulty: 'toeic_900',
      audio_url: 'https://storage.example.com/audio.mp3',
      japanese_intro_text: 'test',
      duration_seconds: 300,
      created_at: '2026-06-10T09:00:00+09:00',
      status: 'completed' as const,
      error_message: null,
      playback_position_seconds: 0,
    }
    const gw = createGatewayDouble()
    gw.respond('POST', PATH, { ok: true, value: podcast })
    await markCompleted(gw, 'p1')

    // ボディ不要（ADR-075）: リクエストに body が含まれない
    expect(gw.calls).toEqual([{ method: 'POST', path: PATH, body: undefined }])
  })

  test('returns the updated Podcast', async () => {
    const podcast = {
      id: 'p1',
      type: 'single',
      article_ids: ['a1'],
      difficulty: 'toeic_900',
      audio_url: 'https://storage.example.com/audio.mp3',
      japanese_intro_text: 'test',
      duration_seconds: 300,
      created_at: '2026-06-10T09:00:00+09:00',
      status: 'completed' as const,
      error_message: null,
      playback_position_seconds: 300,
    }
    const gw = createGatewayDouble()
    gw.respond('POST', PATH, { ok: true, value: podcast })
    const result = unwrap(await markCompleted(gw, 'p1'))

    expect(result.id).toBe('p1')
  })

  test('returns a network failure on network failure', async () => {
    const gw = createGatewayDouble()

    expect(await markCompleted(gw, 'p1')).toEqual(NETWORK_FAILURE)
  })
})

// ==========================================================
// getMetrics — GET /api/backend/admin/metrics（ADR-075: C0 ゲート判定用リテンション計測）
// ==========================================================
describe('getMetrics', () => {
  const PATH = '/api/backend/admin/metrics'
  // backend api/schemas.py 確定契約: ラッパー無しでスナップショットを直接返す（ADR-075）。
  const SAMPLE_METRICS = {
    date: '2026-07-14',
    d7: { eligible: 20, retained: 8, rate: 0.4 },
    d30: { eligible: 10, retained: 3, rate: 0.3 },
    completion: {
      started: 50,
      completed: 28,
      delivered: 60,
      rate_started: 0.56,
      rate_delivered: 0.4667,
    },
    weekly_star: { total_stars: 42, active_users: 8, avg_per_active_user: 5.2 },
    generated_at: '2026-07-15T00:10:00Z',
  }

  test('sends GET to /api/backend/admin/metrics', async () => {
    const gw = createGatewayDouble()
    gw.respond('GET', PATH, { ok: true, value: SAMPLE_METRICS })
    await getMetrics(gw)

    expect(gw.calls).toEqual([{ method: 'GET', path: PATH, body: undefined }])
  })

  test('returns the snapshot fields directly, without a wrapper (interface contract)', async () => {
    const gw = createGatewayDouble()
    gw.respond('GET', PATH, { ok: true, value: SAMPLE_METRICS })

    expect(await getMetrics(gw)).toEqual({ ok: true, value: SAMPLE_METRICS })
  })

  test('returns a not_found failure when no snapshot exists for the date (aggregation job has not run yet)', async () => {
    const gw = createGatewayDouble()
    gw.respond('GET', PATH, { ok: false, failure: { kind: 'not_found' } })

    expect(await getMetrics(gw)).toEqual({ ok: false, failure: { kind: 'not_found' } })
  })

  test('returns a forbidden failure on 403 for non-admin users', async () => {
    const gw = createGatewayDouble()
    gw.respond('GET', PATH, { ok: false, failure: { kind: 'forbidden' } })

    expect(await getMetrics(gw)).toEqual({ ok: false, failure: { kind: 'forbidden' } })
  })

  test('returns a network failure on network failure', async () => {
    const gw = createGatewayDouble()

    expect(await getMetrics(gw)).toEqual(NETWORK_FAILURE)
  })
})

// ==========================================================
// 管理者専用: おすすめサイト管理 CRUD
describe('listFeaturedSites', () => {
  const PATH = '/api/backend/admin/featured-sites'

  test('sends GET to /api/backend/admin/featured-sites', async () => {
    const gw = createGatewayDouble()
    gw.respond('GET', PATH, { ok: true, value: { sites: [] } })
    await listFeaturedSites(gw)

    expect(gw.calls).toEqual([{ method: 'GET', path: PATH, body: undefined }])
  })

  test('returns FeaturedSourcesResponse with sites array', async () => {
    const response = {
      sites: [
        { id: 'hn', name: 'Hacker News', url: 'https://news.ycombinator.com', thumbnail_url: null, description: null },
      ],
    }
    const gw = createGatewayDouble()
    gw.respond('GET', PATH, { ok: true, value: response })
    const result = unwrap(await listFeaturedSites(gw))

    expect(result.sites).toHaveLength(1)
    expect(result.sites[0].name).toBe('Hacker News')
  })

  test('returns a forbidden failure on 403 Forbidden (non-admin)', async () => {
    const gw = createGatewayDouble()
    gw.respond('GET', PATH, { ok: false, failure: { kind: 'forbidden' } })

    expect(await listFeaturedSites(gw)).toEqual({ ok: false, failure: { kind: 'forbidden' } })
  })
})

describe('createFeaturedSite', () => {
  const PATH = '/api/backend/admin/featured-sites'

  test('sends POST to /api/backend/admin/featured-sites with input body', async () => {
    const gw = createGatewayDouble()
    gw.respond('POST', PATH, {
      ok: true,
      value: { id: 'new-site', name: 'New Site', url: 'https://example.com' },
    })
    const input = { name: 'New Site', url: 'https://example.com', description: 'A new site', order: 0 }
    await createFeaturedSite(gw, input)

    expect(gw.calls).toEqual([{ method: 'POST', path: PATH, body: input }])
  })

  test('sends order field in body', async () => {
    const gw = createGatewayDouble()
    gw.respond('POST', PATH, {
      ok: true,
      value: { id: 'new', name: 'Site', url: 'https://example.com' },
    })
    await createFeaturedSite(gw, { name: 'Site', url: 'https://example.com', order: 3 })

    const body = gw.calls[0].body as Record<string, unknown>
    expect(body.order).toBe(3)
  })

  test('returns created FeaturedSource', async () => {
    const created = {
      id: 'new',
      name: 'Test Site',
      url: 'https://test.com',
      thumbnail_url: 'https://test.com/thumb.png',
      description: 'Test',
    }
    const gw = createGatewayDouble()
    gw.respond('POST', PATH, { ok: true, value: created })
    const result = unwrap(await createFeaturedSite(gw, { name: 'Test Site', url: 'https://test.com', order: 0 }))

    expect(result.id).toBe('new')
    expect(result.name).toBe('Test Site')
  })

  test('returns a conflict failure on 409 Conflict (duplicate id)', async () => {
    const gw = createGatewayDouble()
    gw.respond('POST', PATH, { ok: false, failure: { kind: 'conflict' } })

    expect(await createFeaturedSite(gw, { name: 'Dup', url: 'https://dup.com', order: 0 })).toEqual({
      ok: false,
      failure: { kind: 'conflict' },
    })
  })
})

describe('updateFeaturedSite', () => {
  test('sends PUT to /api/backend/admin/featured-sites/{id} with update body', async () => {
    const gw = createGatewayDouble()
    gw.respond('PUT', '/api/backend/admin/featured-sites/hn', {
      ok: true,
      value: { id: 'hn', name: 'Updated HN', url: 'https://hn.com' },
    })
    const input = { name: 'Updated HN', url: 'https://hn.com', order: 0 }
    await updateFeaturedSite(gw, 'hn', input)

    expect(gw.calls).toEqual([
      { method: 'PUT', path: '/api/backend/admin/featured-sites/hn', body: input },
    ])
  })

  test('encodes id in path', async () => {
    const gw = createGatewayDouble()
    await updateFeaturedSite(gw, 'site-with/slash', { name: 'Site', url: 'https://example.com', order: 0 })

    const url = gw.calls[0].path
    expect(url).toContain(encodeURIComponent('site-with/slash'))
    expect(url).not.toContain('site-with/slash')
  })

  test('returns updated FeaturedSource', async () => {
    const updated = {
      id: 'hn',
      name: 'Hacker News',
      url: 'https://updated.hn.com',
      thumbnail_url: 'https://hn.com/thumb.png',
      description: 'Updated description',
    }
    const gw = createGatewayDouble()
    gw.respond('PUT', '/api/backend/admin/featured-sites/hn', { ok: true, value: updated })
    const result = unwrap(
      await updateFeaturedSite(gw, 'hn', {
        name: 'Hacker News',
        url: 'https://updated.hn.com',
        order: 0,
      })
    )

    expect(result.id).toBe('hn')
    expect(result.url).toBe('https://updated.hn.com')
  })

  test('returns a not_found failure on 404 Not Found', async () => {
    const gw = createGatewayDouble()
    gw.respond('PUT', '/api/backend/admin/featured-sites/nonexistent', {
      ok: false,
      failure: { kind: 'not_found' },
    })

    expect(
      await updateFeaturedSite(gw, 'nonexistent', { name: 'N', url: 'https://n.com', order: 0 })
    ).toEqual({ ok: false, failure: { kind: 'not_found' } })
  })
})

describe('deleteFeaturedSite', () => {
  test('sends DELETE to /api/backend/admin/featured-sites/{id}', async () => {
    const gw = createGatewayDouble()
    gw.respond('DELETE', '/api/backend/admin/featured-sites/hn', {
      ok: true,
      value: { status: 'deleted', id: 'hn' },
    })
    await deleteFeaturedSite(gw, 'hn')

    expect(gw.calls).toEqual([
      { method: 'DELETE', path: '/api/backend/admin/featured-sites/hn', body: undefined },
    ])
  })

  test('encodes id in path', async () => {
    const gw = createGatewayDouble()
    await deleteFeaturedSite(gw, 'site-with/slash')

    const url = gw.calls[0].path
    expect(url).toContain(encodeURIComponent('site-with/slash'))
    expect(url).not.toContain('site-with/slash')
  })

  test('returns status and id', async () => {
    const gw = createGatewayDouble()
    gw.respond('DELETE', '/api/backend/admin/featured-sites/hn', {
      ok: true,
      value: { status: 'deleted', id: 'hn' },
    })
    const result = unwrap(await deleteFeaturedSite(gw, 'hn'))

    expect(result.status).toBe('deleted')
    expect(result.id).toBe('hn')
  })

  test('returns a not_found failure on 404 Not Found', async () => {
    const gw = createGatewayDouble()
    gw.respond('DELETE', '/api/backend/admin/featured-sites/nonexistent', {
      ok: false,
      failure: { kind: 'not_found' },
    })

    expect(await deleteFeaturedSite(gw, 'nonexistent')).toEqual({
      ok: false,
      failure: { kind: 'not_found' },
    })
  })
})

// ==========================================================
describe('Security: API key is not logged', () => {
  test('console.log is not called during normal operations', async () => {
    mockFetchOk({ articles: [], date: '2026-06-10' })
    const consoleSpy = vi.spyOn(console, 'log')
    await getFeed(createGateway())

    // API key is now stored in server-only env vars, not in client-side calls
    // This test verifies no sensitive data is inadvertently logged
    expect(consoleSpy).not.toHaveBeenCalled()
  })
})

// ==========================================================
// CSRF token injection on state-changing methods
// ==========================================================
describe('CSRF token injection', () => {
  // Helper to clear jsdom cookies between tests
  function clearCookies() {
    document.cookie.split(';').forEach(c => {
      const name = c.trim().split('=')[0]
      if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
    })
  }

  beforeEach(() => {
    clearCookies()
  })

  test('adds X-CSRF-Token header to PATCH when csrf_token cookie is present', async () => {
    const podcast = {
      id: 'p1',
      type: 'single',
      article_ids: ['a1'],
      difficulty: 'toeic_900',
      audio_url: 'https://storage.example.com/audio.mp3',
      japanese_intro_text: 'test',
      duration_seconds: 300,
      created_at: '2026-06-10T09:00:00+09:00',
      status: 'completed' as const,
      error_message: null,
      playback_position_seconds: 120,
    }
    mockFetchOk(podcast)
    document.cookie = 'csrf_token=patch-token'
    await updatePosition(createGateway(), 'p1', 150)

    const call = vi.mocked(fetch).mock.calls[0]
    const headers = (call[1] as RequestInit).headers as Record<string, string>
    expect(headers['X-CSRF-Token']).toBe('patch-token')
  })

  test('adds X-CSRF-Token header to PUT when csrf_token cookie is present', async () => {
    const prefs = {
      default_difficulty: 'toeic_900' as const,
      default_playback_speed: 1.0,
      digest_enabled: true,
      digest_article_count: 10,
    }
    mockFetchOk(prefs)
    document.cookie = 'csrf_token=put-token'
    await updatePreferences(createGateway(), { default_difficulty: 'toeic_900' })

    const call = vi.mocked(fetch).mock.calls[0]
    const headers = (call[1] as RequestInit).headers as Record<string, string>
    expect(headers['X-CSRF-Token']).toBe('put-token')
  })

  test('adds X-CSRF-Token header to DELETE when csrf_token cookie is present', async () => {
    mockFetchOk({ sources: [] })
    document.cookie = 'csrf_token=delete-token'
    await deleteSource(createGateway(), 'https://example.com/rss')

    const call = vi.mocked(fetch).mock.calls[0]
    const headers = (call[1] as RequestInit).headers as Record<string, string>
    expect(headers['X-CSRF-Token']).toBe('delete-token')
  })

  test('does NOT add X-CSRF-Token to POST when csrf_token cookie is absent', async () => {
    mockFetchOk({ status: 'starred', article_id: 'a1' })
    // no cookie set
    await starArticle(createGateway(), 'a1')

    const call = vi.mocked(fetch).mock.calls[0]
    const headers = (call[1] as RequestInit).headers as Record<string, string>
    expect(headers['X-CSRF-Token']).toBeUndefined()
  })
})

// ==========================================================
// getVapidPublicKey — GET /api/backend/notifications/vapid-public-key
// ==========================================================
describe('getVapidPublicKey', () => {
  const PATH = '/api/backend/notifications/vapid-public-key'

  test('GET /api/backend/notifications/vapid-public-key にリクエストを送る', async () => {
    const gw = createGatewayDouble()
    gw.respond('GET', PATH, { ok: true, value: { public_key: 'test-vapid-key-base64url' } })
    await getVapidPublicKey(gw)

    expect(gw.calls).toEqual([{ method: 'GET', path: PATH, body: undefined }])
  })

  test('public_key フィールドを含むレスポンスを返す', async () => {
    const key = 'BNVa2nUfxEMGkLfDNj3xRnqGqX3z12345'
    const gw = createGatewayDouble()
    gw.respond('GET', PATH, { ok: true, value: { public_key: key } })
    const result = unwrap(await getVapidPublicKey(gw))

    expect(result.public_key).toBe(key)
  })
})

// ==========================================================
// subscribePush — POST /api/backend/notifications/subscriptions
// ==========================================================
describe('subscribePush', () => {
  const PATH = '/api/backend/notifications/subscriptions'

  test('POST /api/backend/notifications/subscriptions にリクエストを送る', async () => {
    const gw = createGatewayDouble()
    gw.respond('POST', PATH, { ok: true, value: {} })
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test',
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    }
    const res = await subscribePush(gw, subscription)

    expect(gw.calls).toEqual([{ method: 'POST', path: PATH, body: subscription }])
    expect(res).toEqual({ ok: true, value: {} })
  })

  test('サブスクリプション JSON をリクエストボディに含める', async () => {
    const gw = createGatewayDouble()
    gw.respond('POST', PATH, { ok: true, value: {} })
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
    }
    await subscribePush(gw, subscription)

    expect(gw.calls[0].body).toEqual(subscription)
  })
})

// ==========================================================
// unsubscribePush — DELETE /api/backend/notifications/subscriptions
// ==========================================================
describe('unsubscribePush', () => {
  test('DELETE /api/backend/notifications/subscriptions にリクエストを送る', async () => {
    const path =
      '/api/backend/notifications/subscriptions?endpoint=https%3A%2F%2Ffcm.googleapis.com%2Ffcm%2Fsend%2Ftest'
    const gw = createGatewayDouble()
    gw.respond('DELETE', path, { ok: true, value: {} })
    const res = await unsubscribePush(gw, 'https://fcm.googleapis.com/fcm/send/test')

    expect(gw.calls).toEqual([{ method: 'DELETE', path, body: undefined }])
    expect(res).toEqual({ ok: true, value: {} })
  })

  test('endpoint を URL エンコードしてクエリパラメータに含める', async () => {
    const gw = createGatewayDouble()
    const endpoint = 'https://fcm.googleapis.com/fcm/send/xyz'
    await unsubscribePush(gw, endpoint)

    expect(gw.calls[0].path).toBe(
      `/api/backend/notifications/subscriptions?endpoint=${encodeURIComponent(endpoint)}`,
    )
    // DELETE はボディを持たない（クエリパラメータ規約）
    expect(gw.calls[0].body).toBeUndefined()
  })
})

// ==========================================================
// submitQuizAnswers — POST /api/backend/podcasts/:id/quiz-answers（ADR-070・F2 理解度クイズ）
// 正解キー（answer_index）はサーバのみが保持し、採点結果でのみ correct_index を開示する。
// ==========================================================
describe('submitQuizAnswers', () => {
  const PATH = '/api/backend/podcasts/p1/quiz-answers'
  const GRADE_RESULT = {
    correct_count: 2,
    total: 3,
    correct_rate: 0.667,
    results: [
      { question_index: 0, selected_index: 1, correct_index: 1, is_correct: true },
      { question_index: 1, selected_index: 0, correct_index: 2, is_correct: false },
      { question_index: 2, selected_index: 3, correct_index: 3, is_correct: true },
    ],
  }

  test('sends POST to /api/backend/podcasts/:id/quiz-answers with selected answer indices in body', async () => {
    const gw = createGatewayDouble()
    gw.respond('POST', PATH, { ok: true, value: GRADE_RESULT })
    await submitQuizAnswers(gw, 'p1', [1, 0, 3])

    expect(gw.calls).toEqual([{ method: 'POST', path: PATH, body: { answers: [1, 0, 3] } }])
  })

  test('returns correct_count/total/correct_rate/results fields (interface contract)', async () => {
    const gw = createGatewayDouble()
    gw.respond('POST', PATH, { ok: true, value: GRADE_RESULT })

    expect(await submitQuizAnswers(gw, 'p1', [1, 0, 3])).toEqual({ ok: true, value: GRADE_RESULT })
  })

  test('returns a validation failure on 422 when answer indices are out of range or count mismatches', async () => {
    const failure: ApiFailure = { kind: 'validation', detail: 'Invalid answers', reason: 'schema' }
    const gw = createGatewayDouble()
    gw.respond('POST', PATH, { ok: false, failure })

    expect(await submitQuizAnswers(gw, 'p1', [9])).toEqual({ ok: false, failure })
  })

  test('returns a network failure on network failure', async () => {
    const gw = createGatewayDouble()

    expect(await submitQuizAnswers(gw, 'p1', [0, 1, 2])).toEqual(NETWORK_FAILURE)
  })
})

// ==========================================================
// Engagement Phase 2 — vocabulary API contracts (ADR-087)
// ==========================================================
describe('vocabulary engagement API', () => {
  test('registers a glossary term with the authoritative podcast_id + term payload', async () => {
    const gw = createGatewayDouble()
    const saved = {
      ok: true,
      value: {
        vocabulary_id: 'p1__accelerate',
        podcast_id: 'p1',
        term: 'accelerate',
        meaning: '加速する',
        example: 'The rollout will accelerate.',
        registered_at: '2026-07-29T00:00:00Z',
      },
    } as const
    gw.respond('POST', '/api/backend/vocabulary', saved)

    const res = await saveVocabulary(gw, 'p1', 'accelerate')

    expect(gw.calls).toEqual([
      {
        method: 'POST',
        path: '/api/backend/vocabulary',
        body: { podcast_id: 'p1', term: 'accelerate' },
      },
    ])
    expect(res).toEqual(saved)
  })

  test('loads the vocabulary list and due test session from their GET endpoints', async () => {
    const gw = createGatewayDouble()
    const list = { ok: true, value: { vocabulary: [{ vocabulary_id: 'v1' }], count: 1 } } as const
    const session = { ok: true, value: { items: [{ vocabulary_id: 'v1' }] } } as const
    gw.respond('GET', '/api/backend/vocabulary', list)
    gw.respond('GET', '/api/backend/vocabulary/test-session', session)

    const listRes = await getVocabulary(gw)
    const sessionRes = await getVocabularyTestSession(gw)

    expect(gw.calls).toEqual([
      { method: 'GET', path: '/api/backend/vocabulary', body: undefined },
      { method: 'GET', path: '/api/backend/vocabulary/test-session', body: undefined },
    ])
    expect(listRes).toEqual(list)
    expect(sessionRes).toEqual(session)
  })

  test('submits the complete batch array without wrapping or renaming result fields', async () => {
    const gw = createGatewayDouble()
    gw.respond('POST', '/api/backend/vocabulary/test-result', { ok: true, value: { updated: 2 } })
    const results = [
      { vocabulary_id: 'v1', self_known: true, retest_correct: null },
      { vocabulary_id: 'v2', self_known: false, retest_correct: true },
    ]

    const res = await submitVocabularyTestResult(gw, results)

    expect(gw.calls).toEqual([
      { method: 'POST', path: '/api/backend/vocabulary/test-result', body: results },
    ])
    expect(res).toEqual({ ok: true, value: { updated: 2 } })
  })
})
