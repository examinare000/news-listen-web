import type {
  DifficultyLevel,
  StarredArticlesResponse,
} from '@/types/index'
import type { ApiGateway } from '@/lib/api/gateway'

/**
 * Star 済み記事のサーバ側一覧（新しい star 順）。backend が GET /feed から star 済み記事を
 * 恒久除外する移行に伴い、Star タブの真実の源をこちらへ切り替える。
 */
export function getStarredArticles(gateway: ApiGateway) {
  return gateway.request<StarredArticlesResponse>('/api/backend/articles/starred', { method: 'GET' })
}

// difficulty 省略時は backend 側で prefs のデフォルト難易度が使われる（後方互換・issue #163）。
// remaining は生成残回数（issue #164 / ADR-061）。旧 backend は未送信のため optional。
export function starArticle(gateway: ApiGateway, id: string, difficulty?: DifficultyLevel) {
  return gateway.request<{ status: string; article_id: string; remaining?: number | null }>(
    `/api/backend/articles/${id}/star`,
    {
      method: 'POST',
      ...(difficulty ? { body: { difficulty } } : {}),
    },
  )
}

export function dismissArticle(gateway: ApiGateway, id: string) {
  return gateway.request<{ status: string; article_id: string }>(
    `/api/backend/articles/${id}/dismiss`,
    { method: 'POST' },
  )
}

// Star解除。backend側は冪等・生成済みPodcastも削除する。200 + ActionResponse
// （{status: "unstarred", article_id}）を返す（204は返さない）。
export function unstarArticle(gateway: ApiGateway, id: string) {
  return gateway.request<{ status: string; article_id: string }>(
    `/api/backend/articles/${id}/star`,
    { method: 'DELETE' },
  )
}
