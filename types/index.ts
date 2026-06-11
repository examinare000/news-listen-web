// Domain types shared across the frontend

export type DifficultyLevel =
  | 'toeic_600'
  | 'toeic_900'
  | 'ielts_55'
  | 'ielts_7'
  | 'eiken_2'
  | 'eiken_p1'

export interface Article {
  id: string
  title: string
  url: string
  source: string
  score: number
  published_at: string
}

export interface FeedResponse {
  articles: Article[]
  date: string
}

export interface Podcast {
  id: string
  type: string
  article_ids: string[]
  difficulty: DifficultyLevel
  audio_url: string
  japanese_intro_text: string
  duration_seconds: number
  created_at: string
}

export interface PodcastsResponse {
  podcasts: Podcast[]
}

export interface Source {
  name: string
  url: string
}

export interface SourcesResponse {
  sources: Source[]
}
