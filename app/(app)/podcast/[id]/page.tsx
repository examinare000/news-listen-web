'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { useToast } from '@/components/ui/Toast'
import { DifficultyBadge } from '@/components/ui/DifficultyBadge'
import { formatDuration, formatDate } from '@/lib/format'
import { useApiClient } from '@/contexts/ApiClientProvider'
import { useCatalogQueries } from '@/contexts/useCatalogQueries'
import type { EpisodeDetailView } from '@/lib/catalog/application/readModels'
import { getVocabulary, saveVocabulary, submitQuizAnswers } from '@/lib/learning/infrastructure/api'
import { usePlayback } from '@/contexts/PlaybackProvider'
import { usePlaybackActions } from '@/components/PlaybackToasts'
import { failureMessage } from '@/lib/catalog/presentation/failureMessage'
import { highlightTerms } from '@/lib/highlightTerms'
import { playSfx, prepareSfx } from '@/lib/sfx'
import type { QuizAnswerResponse } from '@/types/index'

interface PodcastDetailPageProps {
  params: Promise<{ id: string }>
}

function PageHeader({ showBackLink }: { showBackLink: boolean }) {
  return (
    <div className="page-header">
      <div>
        <div className="page-title">エピソード詳細</div>
      </div>
      {/* 404 時は本文の empty-state 側に戻るリンクを置くため、ヘッダーには出さない
          （同名リンクの重複でアクセシビリティ上の曖昧さを生まないため） */}
      {showBackLink && (
        <div className="header-actions">
          <Link href="/podcast" className="btn btn-ghost">
            一覧へ戻る
          </Link>
        </div>
      )}
    </div>
  )
}

export default function PodcastDetailPage({ params }: PodcastDetailPageProps) {
  const { showToast } = useToast()
  const gateway = useApiClient()
  const queries = useCatalogQueries()
  const { offline } = usePlayback()
  const { startEpisode } = usePlaybackActions()

  const [podcast, setPodcast] = useState<EpisodeDetailView | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)
  const [podcastId, setPodcastId] = useState<string | null>(null)

  useEffect(() => {
    params.then((p) => setPodcastId(p.id))
  }, [params])

  useEffect(() => {
    if (!podcastId) return

    async function fetch() {
      try {
        const result = await queries.getEpisodeDetail(podcastId!)
        if (!result.ok) {
          if (result.failure.kind === 'not_found') {
            setNotFound(true)
          } else {
            showToast('読み込みに失敗しました', 'error')
          }
          return
        }
        setPodcast(result.value)
      } catch {
        showToast('読み込みに失敗しました', 'error')
      } finally {
        setLoading(false)
      }
    }

    fetch()
  }, [podcastId, queries]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handlePlay() {
    if (!podcast) return
    await startEpisode(podcast.id)
  }

  // オフライン保存（issue #167）。読み込み後にキャッシュ済みかを確認し、
  // ダウンロード完了で「保存済み」表示へ切り替える。
  const [downloaded, setDownloaded] = useState(false)

  useEffect(() => {
    if (!podcast) return
    offline.has(podcast.id).then(setDownloaded).catch(() => {
      // 確認に失敗しても致命的ではない（未保存として扱い、ボタンは表示し続ける）。
    })
  }, [podcast, offline])

  async function handleDownload() {
    if (!podcast) return
    try {
      const saved = await offline.save(podcast.id)
      if (!saved.ok) {
        showToast('オフライン保存に失敗しました', 'error')
        return
      }
      setDownloaded(true)
    } catch {
      showToast('オフライン保存に失敗しました', 'error')
    }
  }

  // 理解度チェッククイズ（ADR-070・F2）。正解キー（answer_index）は backend が API 境界で
  // 落とすため、この state には一切含まれない。Submit 後の quizResult にのみ correct_index が載る。
  // WHY a sparse Record keyed by question index (not a pre-filled array): 「未回答」の初期値が
  // 空オブジェクトそのもので表現できるため、podcast 読み込み完了時に配列を作り直す effect が不要になる。
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({})
  const [quizResult, setQuizResult] = useState<QuizAnswerResponse | null>(null)
  const [submittingQuiz, setSubmittingQuiz] = useState(false)
  const [registeredTerms, setRegisteredTerms] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (!podcast) return
    getVocabulary(gateway)
      .then((result) => {
        if (!result.ok) return
        setRegisteredTerms(new Set(result.value.vocabulary.map((item) => item.term)))
      })
      .catch(() => {
        // best-effort: 失敗時は現状動作（空のセットのまま）
      })
  }, [podcast, gateway])
  const [savingTerms, setSavingTerms] = useState<Set<string>>(() => new Set())

  function handleSelectQuizAnswer(questionIndex: number, optionIndex: number) {
    setQuizAnswers((prev) => ({ ...prev, [questionIndex]: optionIndex }))
  }

  const quizAllAnswered = Boolean(
    podcast?.quiz && podcast.quiz.every((_, index) => quizAnswers[index] !== undefined)
  )

  async function handleSubmitQuiz() {
    if (!podcast?.quiz || !quizAllAnswered) return
    prepareSfx()
    setSubmittingQuiz(true)
    try {
      const answers = podcast.quiz.map((_, index) => quizAnswers[index])
      const result = await submitQuizAnswers(gateway, podcast.id, answers)
      if (!result.ok) {
        showToast('採点に失敗しました', 'error')
        return
      }
      setQuizResult(result.value)
      playSfx(result.value.correct_count / result.value.total >= 0.5 ? 'correct' : 'incorrect')
    } catch {
      showToast('採点に失敗しました', 'error')
    } finally {
      setSubmittingQuiz(false)
    }
  }

  async function handleSaveVocabulary(term: string) {
    if (!podcast) return
    setSavingTerms((current) => new Set(current).add(term))
    try {
      const result = await saveVocabulary(gateway, podcast.id, term)
      if (!result.ok) {
        showToast('語彙の登録に失敗しました', 'error')
        return
      }
      setRegisteredTerms((current) => new Set(current).add(term))
    } catch {
      showToast('語彙の登録に失敗しました', 'error')
    } finally {
      setSavingTerms((current) => {
        const next = new Set(current)
        next.delete(term)
        return next
      })
    }
  }

  if (notFound) {
    return (
      <>
        <PageHeader showBackLink={false} />
        <div className="content-area">
          <div className="empty-state">
            <div className="empty-state-icon" aria-hidden="true">
              🔍
            </div>
            <p className="empty-state-title">エピソードが見つかりません</p>
            <p className="empty-state-desc">
              <Link href="/podcast" className="btn btn-ghost">
                一覧へ戻る
              </Link>
            </p>
          </div>
        </div>
      </>
    )
  }

  if (loading || !podcast) {
    return (
      <>
        <PageHeader showBackLink />
        <div className="content-area content-narrow">
          {/* 読み込み中テキストは維持しつつ .skeleton のシマーで視覚表現する */}
          <div className="skeleton" style={{ height: 150, borderRadius: 'var(--radius)' }}>
            <span className="sr-only">読み込み中...</span>
          </div>
        </div>
      </>
    )
  }

  // トランスクリプト中の語彙用語ハイライト用（issue: 語彙グロッサリ表示）。vocabulary が
  // null/欠落なら空配列 → highlightTerms は原文をそのまま返す。
  const vocabularyTerms = podcast.glossary.map((entry) => entry.term)

  return (
    <>
      <PageHeader showBackLink />
      <div className="content-area content-narrow">
        <div className="podcast-badges" style={{ marginBottom: 14 }}>
          <DifficultyBadge difficulty={podcast.difficulty} />
          {podcast.isDigest && <span className="badge">DIGEST</span>}
        </div>

        {/* イントロは全文表示（.podcast-intro は一覧用の 2 行クランプを持つため使わない） */}
        <p style={{ fontSize: 14, lineHeight: 1.8, marginBottom: 16 }}>
          {podcast.intro}
        </p>

        {/* 英語本編トランスクリプト（issue #162）。旧エピソード/劣化生成では segments が
            null/欠落するため、その場合は控えめなフォールバック文言に留めレイアウトを維持する。 */}
        {podcast.transcript.length > 0 ? (
          <div style={{ marginBottom: 16 }}>
            {podcast.transcript.map((segment, index) => (
              <div
                key={index}
                style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}
              >
                <span className="badge" style={{ flexShrink: 0 }}>
                  {segment.speaker}
                </span>
                <p style={{ fontSize: 14, lineHeight: 1.7 }}>
                  {highlightTerms(segment.text, vocabularyTerms)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
            トランスクリプトはありません
          </p>
        )}

        {/* 語彙グロッサリ。旧エピソードや劣化生成では vocabulary が null/欠落/空になるため、
            その場合はフォールバック文言も出さずセクションごと非表示にする。 */}
        {podcast.glossary.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <h2 className="settings-section-title" style={{ marginBottom: 8 }}>
              語彙
            </h2>
            {podcast.glossary.map((entry, index) => (
              <div key={`${entry.term}-${index}`} className="vocabulary-glossary-item">
                <div className="vocabulary-glossary-copy">
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{entry.term}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {entry.meaningJa}
                  </div>
                </div>
                {registeredTerms.has(entry.term) ? (
                  <span className="vocabulary-registered">登録済み</span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost vocabulary-save"
                    aria-label={`${entry.term} を習得`}
                    disabled={savingTerms.has(entry.term)}
                    onClick={() => void handleSaveVocabulary(entry.term)}
                  >
                    {savingTerms.has(entry.term) ? '登録中' : '習得'}
                  </button>
                )}
                <p
                  style={{
                    fontSize: 13,
                    fontStyle: 'italic',
                    color: 'var(--text-muted)',
                    borderLeft: '2px solid var(--border-mid)',
                    paddingLeft: 8,
                    marginTop: 4,
                  }}
                >
                  {entry.example}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* 理解度チェッククイズ（ADR-070・F2）。旧エピソードや劣化生成では quiz が null/欠落/空になる
            ため、その場合はセクションごと非表示にする（語彙グロッサリと同じ graceful-hide 方針）。
            正解（correct_index）は quizResult が届く＝採点後にのみ表示する。採点前は一切保持しない。 */}
        {podcast.quiz.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <h2 className="settings-section-title" style={{ marginBottom: 8 }}>
              理解度チェック
            </h2>
            {podcast.quiz.map((question, questionIndex) => {
              const questionResult = quizResult?.results.find(
                (r) => r.question_index === questionIndex
              )
              return (
                <fieldset
                  key={`${question.question}-${questionIndex}`}
                  style={{ border: 'none', padding: 0, marginBottom: 14 }}
                >
                  <legend style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                    {`Q${questionIndex + 1}. ${question.question}`}
                  </legend>
                  {question.options.map((option, optionIndex) => {
                    const isSelected = quizAnswers[questionIndex] === optionIndex
                    const isCorrectOption = questionResult?.correct_index === optionIndex
                    const isWrongSelection = isSelected && questionResult && !questionResult.is_correct
                    return (
                      <label
                        key={`${option}-${optionIndex}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 13,
                          marginBottom: 4,
                        }}
                      >
                        <input
                          type="radio"
                          name={`quiz-question-${questionIndex}`}
                          checked={isSelected}
                          disabled={Boolean(quizResult)}
                          onChange={() => handleSelectQuizAnswer(questionIndex, optionIndex)}
                        />
                        {option}
                        {questionResult && isCorrectOption && (
                          <span className="quiz-correct-feedback">
                            <svg
                              className="quiz-correct-mark"
                              width="18"
                              height="18"
                              viewBox="0 0 20 20"
                              fill="none"
                              aria-hidden="true"
                            >
                              <path d="M4 10.5l3.5 3.5L16 5.5" />
                            </svg>
                            <span className="sr-only">正解</span>
                          </span>
                        )}
                        {isWrongSelection && <span className="badge badge-failed">あなたの回答</span>}
                      </label>
                    )
                  })}
                </fieldset>
              )
            })}

            {quizResult ? (
              <div className="quiz-score-card" aria-live="polite">
                <p className="quiz-score">
                  <span className="quiz-score-label">スコア</span>
                  {quizResult.correct_count} / {quizResult.total}
                </p>
                {quizResult.correct_count === quizResult.total && (
                  <div className="quiz-perfect-stamp">Perfect</div>
                )}
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!quizAllAnswered || submittingQuiz}
                onClick={() => void handleSubmitQuiz()}
              >
                採点する
              </button>
            )}
          </div>
        )}

        <div className="podcast-meta" style={{ marginBottom: 16 }}>
          <span>
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {formatDuration(podcast.durationSeconds)}
          </span>
          <span>{formatDate(podcast.createdAt)}</span>
        </div>

        {/* 出典とライセンス表記（ADR-095）。CC BY-SA 4.0 の表示可否は view の showsShareAlikeNotice が持つ。
            出典を持たない旧エピソードでは出典ブロック自体を表示しない。 */}
        {podcast.sources.length > 0 && (
          <div
            style={{
              marginBottom: 20,
              fontSize: 12,
              color: 'var(--text-muted)',
            }}
          >
            <strong>出典</strong>
            <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0' }}>
              {podcast.sources.map((s) => (
                <li key={s.articleId} style={{ marginBottom: 4 }}>
                  <span className="article-source">{s.siteName}</span>
                  <span className="article-dot">·</span>
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
            {podcast.showsShareAlikeNotice && (
              <p style={{ margin: '8px 0 0' }}>
                この音声コンテンツは{' '}
                <a
                  href="https://creativecommons.org/licenses/by-sa/4.0/deed.ja"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  CC BY-SA 4.0
                </a>{' '}
                で提供されます。
              </p>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {podcast.failureReason !== null && (
            <p data-testid="podcast-failure-message">{failureMessage(podcast.failureReason)}</p>
          )}
          {podcast.kind === 'playable' && (
            <>
              <button type="button" className="btn btn-primary" onClick={handlePlay} aria-label="再生">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                再生
              </button>

              {/* オフライン保存（issue #167）。保存済みなら状態表示に切り替える。 */}
              {downloaded ? (
                <span className="btn btn-ghost" aria-label="オフライン保存済み">
                  保存済み
                </span>
              ) : (
                <button type="button" className="btn btn-ghost" onClick={() => void handleDownload()}>
                  オフライン保存
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
