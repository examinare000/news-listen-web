import type {
  DifficultyLevel,
  StarredArticlesResponse,
} from '@/types/index'
import { request } from '@/lib/api/legacyRequest'

/**
 * Star 済み記事のサーバ側一覧（新しい star 順）。backend が GET /feed から star 済み記事を
 * 恒久除外する移行に伴い、Star タブの真実の源をこちらへ切り替える。
 */
export function getStarredArticles() {
  return request<StarredArticlesResponse>('/api/backend/articles/starred', { method: 'GET' })
}

// difficulty 省略時は backend 側で prefs のデフォルト難易度が使われる（後方互換・issue #163）。
// remaining は生成残回数（issue #164 / ADR-061）。旧 backend は未送信のため optional。
export function starArticle(id: string, difficulty?: DifficultyLevel) {
  return request<{ status: string; article_id: string; remaining?: number | null }>(
    `/api/backend/articles/${id}/star`,
    {
      method: 'POST',
      ...(difficulty ? { body: JSON.stringify({ difficulty }) } : {}),
    },
  )
}

export function dismissArticle(id: string) {
  return request<{ status: string; article_id: string }>(
    `/api/backend/articles/${id}/dismiss`,
    { method: 'POST' },
  )
}

// Star解除。backend側は冪等・生成済みPodcastも削除する。200 + ActionResponse
// （{status: "unstarred", article_id}）を返す（204は返さない）。
export function unstarArticle(id: string) {
  return request<{ status: string; article_id: string }>(
    `/api/backend/articles/${id}/star`,
    { method: 'DELETE' },
  )
}
