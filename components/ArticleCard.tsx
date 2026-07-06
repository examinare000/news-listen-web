import React from 'react'
import { formatDate, formatRelativeTime } from '@/lib/format'
import { useApp } from '@/contexts/AppContext'
import { Menu } from '@/components/ui/Menu'
import { DIFFICULTY_LABELS } from '@/components/ui/DifficultyBadge'
import type { Article, DifficultyLevel } from '@/types/index'

// DIFFICULTY_LABELS のキー順（toeic_600 → ... → eiken_p1）をメニュー表示順として使う。
// WHY: 難易度の並びを別途配列で複製すると表示順の二重管理になるため、
// 既存のラベル定義（Record）のキー順を単一の正本として再利用する。
const DIFFICULTY_MENU_ORDER = Object.keys(DIFFICULTY_LABELS) as DifficultyLevel[]

interface ArticleCardProps {
  article: Article
  onStar: (id: string, difficulty?: DifficultyLevel) => void
  onDismiss: (id: string) => void
  busy: boolean
  starred: boolean
  selectionMode?: boolean
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
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

export function ArticleCard({
  article,
  onStar,
  onDismiss,
  busy,
  starred,
  selectionMode = false,
  isSelected = false,
  onToggleSelect,
}: ArticleCardProps) {
  const { state } = useApp()

  // WHY: now を current time に注入して相対表記を計算する（決定的にテスト可能）
  const formattedDate = state.timeFormat === 'relative'
    ? formatRelativeTime(new Date(article.published_at), new Date())
    : formatDate(article.published_at)

  return (
    <div className={starred ? 'article-card starred' : 'article-card'}>
      {selectionMode && (
        <div className="article-checkbox">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect?.(article.id)}
            aria-label={`${article.title} を選択`}
          />
        </div>
      )}
      <div>
        <div className="article-meta">
          <span className="article-source">{article.source}</span>
          <span className="article-dot">·</span>
          <span className="article-date">{formattedDate}</span>
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
        <div className="star-group">
          <button
            type="button"
            className={starred ? 'action-btn star active' : 'action-btn star'}
            onClick={() => onStar(article.id)}
            disabled={busy}
            aria-pressed={starred}
            aria-label={starred ? 'スター済み' : 'スターする'}
            data-testid={`star-button-${article.id}`}
          >
            {starred ? <StarFilledIcon /> : <StarOutlineIcon />}
          </button>

          {/* スター済み記事は難易度選び直しの余地がないため、メニューごと出さない（issue #163） */}
          {!starred && (
            <Menu
              triggerLabel="記事の生成難易度を指定"
              triggerContent={<span aria-hidden="true">▾</span>}
              triggerClassName="action-btn"
              disabled={busy}
              items={DIFFICULTY_MENU_ORDER.map((difficulty) => ({
                key: difficulty,
                label: DIFFICULTY_LABELS[difficulty],
                onSelect: () => onStar(article.id, difficulty),
              }))}
            />
          )}
        </div>

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
