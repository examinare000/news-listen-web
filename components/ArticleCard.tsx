import React from 'react'
import type { Article } from '@/types/index'

interface ArticleCardProps {
  article: Article
  onStar: (id: string) => void
  onDismiss: (id: string) => void
  busy: boolean
  starred: boolean
}

export function ArticleCard({ article, onStar, onDismiss, busy, starred }: ArticleCardProps) {
  return (
    <div className="article-card">
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="article-title"
      >
        {article.title}
      </a>

      <span className="article-source">{article.source}</span>

      <div
        role="progressbar"
        aria-valuenow={article.score}
        aria-valuemin={0}
        aria-valuemax={1}
        style={{ width: `${article.score * 100}%` }}
        className="score-bar"
      />

      <button
        onClick={() => onStar(article.id)}
        disabled={busy}
        aria-pressed={starred ? 'true' : 'false'}
        className={starred ? 'starred' : ''}
        aria-label={starred ? '★ Star' : '☆ Star'}
      >
        {starred ? '★' : '☆'}
      </button>

      <button
        onClick={() => onDismiss(article.id)}
        disabled={busy}
        aria-label="× 非表示"
      >
        ×
      </button>
    </div>
  )
}
