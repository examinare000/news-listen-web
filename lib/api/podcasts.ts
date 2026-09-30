import type {
  PodcastsResponse,
  Podcast,
  QuizAnswerResponse,
} from '@/types/index'
import { request } from '@/lib/api/legacyRequest'

export function getPodcasts() {
  return request<PodcastsResponse>('/api/backend/podcasts', { method: 'GET' })
}

export function getPodcast(id: string) {
  return request<Podcast>(`/api/backend/podcasts/${id}`, { method: 'GET' })
}

export function updatePosition(id: string, positionSeconds: number) {
  return request<Podcast>(
    `/api/backend/podcasts/${id}/position`,
    {
      method: 'PATCH',
      body: JSON.stringify({ position_seconds: positionSeconds }),
    },
  )
}

/**
 * 完聴イベント発火（ADR-075 決定3）。ended（自然終端）到達時に呼ぶ。ボディ不要・
 * サーバ側で first-write-wins のため、呼び出し側は fire-and-forget（失敗握りつぶし）でよい。
 * updatePosition の鏡像だが、責務が別（同期 vs イベント）のため専用エンドポイントに分離する。
 */
export function markCompleted(id: string) {
  return request<Podcast>(
    `/api/backend/podcasts/${id}/completed`,
    { method: 'POST' },
  )
}

/**
 * 理解度チェッククイズの回答送信・サーバ採点（ADR-070 決定7）。
 * answers は各設問で選んだ option の添字（設問順）。正解キーはクライアントに一切渡らず、
 * このレスポンスの results[].correct_index で採点後にのみ開示される。
 */
export function submitQuizAnswers(podcastId: string, answers: number[]) {
  return request<QuizAnswerResponse>(
    `/api/backend/podcasts/${podcastId}/quiz-answers`,
    {
      method: 'POST',
      body: JSON.stringify({ answers }),
    },
  )
}
