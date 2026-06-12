import React from 'react'
import { formatDate } from '@/lib/format'
import type { Article } from '@/types/index'

interface ArticleCardProps {
  article: Article
  onStar: (id: string) => void
  onDismiss: (id: string) => void
  busy: boolean
  starred: boolean
}

// デザイン app-ui.html L1489 の塗りスター（starred 時）
function StarFilledIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  )
}

// デザイン app-ui.html L1517 の線スター（未スター時）
function StarOutlineIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  )
}

// デザイン app-ui.html L1492 の非表示アイコン
function DismissIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

export function ArticleCard({ article, onStar, onDismiss, busy, starred }: ArticleCardProps) {
  return (
    <div className={starred ? 'article-card starred' : 'article-card'}>
      <div>
        <div className="article-meta">
          <span className="article-source">{article.source}</span>
          <span className="article-dot">·</span>
          {/* D28: 相対表記化はせず既存 formatDate の出力を維持する */}
          <span className="article-date">{formatDate(article.published_at)}</span>
        </div>
        <div className="article-title">
          <a href={article.url} target="_blank" rel="noopener noreferrer">
            {article.title}
          </a>
        </div>
        <div className="score-row">
          <div
            className="score-bar-track"
            role="progressbar"
            aria-valuenow={article.score}
            aria-valuemin={0}
            aria-valuemax={1}
          >
            <div className="score-bar-fill" style={{ width: `${article.score * 100}%` }} />
          </div>
          <span className="score-label">{article.score.toFixed(2)} 関連度</span>
        </div>
      </div>

      {/* デザインは div だが、キーボード操作・スクリーンリーダー対応のため button を維持する */}
      <div className="article-actions">
        <button
          type="button"
          className={starred ? 'action-btn star active' : 'action-btn star'}
          onClick={() => onStar(article.id)}
          disabled={busy}
          aria-pressed={starred}
          aria-label={starred ? 'スター済み' : 'スターする'}
        >
          {starred ? <StarFilledIcon /> : <StarOutlineIcon />}
        </button>

        <button
          type="button"
          className="action-btn dismiss"
          onClick={() => onDismiss(article.id)}
          disabled={busy}
          aria-label="非表示"
        >
          <DismissIcon />
        </button>
      </div>
    </div>
  )
}
