'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useToast } from '@/components/ui/Toast'
import { createApiClient } from '@/lib/api'
import { playSfx, prepareSfx } from '@/lib/sfx'
import type { VocabularyTestItem, VocabularyTestResultItem } from '@/types/index'

type Phase = 'loading' | 'self-assessment' | 'retest' | 'submitting' | 'result' | 'empty' | 'error'

interface ResultSummary {
  reviewed: number
  retestCount: number
  correct: number
}

function buildChoices(item: VocabularyTestItem): string[] {
  const choices = [item.meaning, ...item.distractors.slice(0, 3)]
  if (choices.length < 2) return choices

  // Fisher-Yates shuffle
  const shuffled = [...choices]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

export default function VocabularyTestPage() {
  const { showToast } = useToast()
  const [phase, setPhase] = useState<Phase>('loading')
  const [items, setItems] = useState<VocabularyTestItem[]>([])
  const [assessmentIndex, setAssessmentIndex] = useState(0)
  const [assessments, setAssessments] = useState<Record<string, boolean>>({})
  const [retestItems, setRetestItems] = useState<VocabularyTestItem[]>([])
  const [retestIndex, setRetestIndex] = useState(0)
  const [retestResults, setRetestResults] = useState<Record<string, boolean>>({})
  const [showCorrectCheck, setShowCorrectCheck] = useState(false)
  const [revealedCorrect, setRevealedCorrect] = useState<string | null>(null)
  const [isAdvancing, setIsAdvancing] = useState(false)
  const [exitDirection, setExitDirection] = useState<'left' | 'right' | null>(null)
  const [summary, setSummary] = useState<ResultSummary | null>(null)
  const pointerStartXRef = useRef<number | null>(null)
  const swipeCardRef = useRef<HTMLDivElement | null>(null)
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const assessmentHeadingRef = useRef<HTMLHeadingElement>(null)
  const retestHeadingRef = useRef<HTMLHeadingElement>(null)
  const resultHeadingRef = useRef<HTMLHeadingElement>(null)
  const errorHeadingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    let active = true
    createApiClient()
      .getVocabularyTestSession()
      .then((session) => {
        if (!active) return
        const boundedItems = session.items.slice(0, 10)
        setItems(boundedItems)
        setPhase(boundedItems.length === 0 ? 'empty' : 'self-assessment')
      })
      .catch(() => {
        if (!active) return
        setSummary({ reviewed: 0, retestCount: 0, correct: 0 })
        setPhase('error')
        showToast('単語テストの読み込みに失敗しました', 'error')
      })
    return () => {
      active = false
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    }
  }, [showToast])

  // Focus management for phase transitions
  useEffect(() => {
    if (phase === 'self-assessment' && assessmentHeadingRef.current) {
      assessmentHeadingRef.current.focus()
    } else if (phase === 'retest' && retestHeadingRef.current) {
      retestHeadingRef.current.focus()
    } else if (phase === 'result' && resultHeadingRef.current) {
      resultHeadingRef.current.focus()
    } else if (phase === 'error' && errorHeadingRef.current) {
      errorHeadingRef.current.focus()
    }
  }, [phase])

  async function submitResults(
    finalAssessments: Record<string, boolean>,
    finalRetestResults: Record<string, boolean>,
  ) {
    setPhase('submitting')
    const payload: VocabularyTestResultItem[] = items.map((item) => {
      const selfKnown = finalAssessments[item.vocabulary_id]
      return {
        vocabulary_id: item.vocabulary_id,
        self_known: selfKnown,
        retest_correct: selfKnown ? null : (finalRetestResults[item.vocabulary_id] ?? false),
      }
    })
    try {
      await createApiClient().submitVocabularyTestResult(payload)
      const retestCount = payload.filter((item) => item.retest_correct !== null).length
      const correctCount = payload.filter((item) => item.retest_correct === true).length
      setSummary({
        reviewed: payload.length,
        retestCount,
        correct: correctCount,
      })
      setPhase('result')
    } catch {
      setPhase('error')
      showToast('単語テストの結果送信に失敗しました', 'error')
    }
  }

  function recordSelfAssessment(known: boolean) {
    const item = items[assessmentIndex]
    if (!item || phase !== 'self-assessment') return
    prepareSfx()
    const nextAssessments = { ...assessments, [item.vocabulary_id]: known }
    setAssessments(nextAssessments)
    if (assessmentIndex < items.length - 1) {
      setAssessmentIndex((index) => index + 1)
      return
    }

    const unknown = items.filter((candidate) => nextAssessments[candidate.vocabulary_id] === false)
    if (unknown.length === 0) {
      void submitResults(nextAssessments, {})
      return
    }
    setRetestItems(unknown)
    setPhase('retest')
  }

  function prefersReducedMotion(): boolean {
    // matchMedia 非対応環境（jsdom 等）ではアニメーションを行わない側に倒す
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  /// 確定時: 方向へ短い slide-out（0.2s）を見せてから次カードへ。reduced-motion では即時。
  function confirmAssessment(known: boolean) {
    if (exitDirection !== null) return
    resetCardTransform()
    if (prefersReducedMotion()) {
      recordSelfAssessment(known)
      return
    }
    setExitDirection(known ? 'right' : 'left')
    window.setTimeout(() => {
      setExitDirection(null)
      recordSelfAssessment(known)
    }, 200)
  }

  function resetCardTransform() {
    if (swipeCardRef.current) swipeCardRef.current.style.transform = ''
  }

  function finishSwipe(endX: number) {
    const startX = pointerStartXRef.current
    pointerStartXRef.current = null
    resetCardTransform()
    if (startX === null) return
    const distance = endX - startX
    if (distance >= 60) confirmAssessment(true)
    if (distance <= -60) confirmAssessment(false)
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    pointerStartXRef.current = event.clientX
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const startX = pointerStartXRef.current
    if (startX === null || prefersReducedMotion()) return
    const dx = event.clientX - startX
    if (swipeCardRef.current) {
      swipeCardRef.current.style.transform = `translateX(${dx * 0.4}px) rotate(${dx * 0.02}deg)`
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    finishSwipe(event.clientX)
  }

  function handlePointerCancel() {
    pointerStartXRef.current = null
    resetCardTransform()
  }

  function handleTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    pointerStartXRef.current = event.touches[0]?.clientX ?? null
  }

  function handleTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    const endX = event.changedTouches[0]?.clientX
    if (endX !== undefined) finishSwipe(endX)
  }

  function handleRetestChoice(choice: string) {
    const item = retestItems[retestIndex]
    if (!item || isAdvancing) return
    prepareSfx()
    setIsAdvancing(true)

    // Clear existing timer if any
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)

    const correct = choice === item.meaning
    const nextResults = { ...retestResults, [item.vocabulary_id]: correct }
    setRetestResults(nextResults)
    if (correct) {
      playSfx('correct')
      setShowCorrectCheck(true)
    } else {
      // 罰的な赤・バツは使わず、正解肢の提示で学習機会を残す（ADR-088 原則）。
      playSfx('incorrect')
      setRevealedCorrect(item.meaning)
    }

    feedbackTimerRef.current = setTimeout(() => {
      setShowCorrectCheck(false)
      setRevealedCorrect(null)
      if (retestIndex < retestItems.length - 1) {
        setRetestIndex((index) => index + 1)
        setIsAdvancing(false)
      } else {
        void submitResults(assessments, nextResults)
      }
    }, 800)
  }

  const currentAssessment = items[assessmentIndex]
  const currentRetest = retestItems[retestIndex]
  // 同一問題の表示中に選択肢が並び替わらないよう、問題単位でメモ化する
  const retestChoices = useMemo(
    () => (currentRetest ? buildChoices(currentRetest) : []),
    [currentRetest],
  )

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">単語テスト</h1>
          <p className="page-subtitle">30 秒から始める、短い語彙の振り返り</p>
        </div>
        <Link href="/dashboard" className="btn btn-ghost">ダッシュボードへ戻る</Link>
      </div>

      <div className="content-area content-narrow vocabulary-test-page">
        {phase === 'loading' ? (
          <div className="vocabulary-test-status" role="status">単語を準備しています</div>
        ) : null}

        {phase === 'empty' ? (
          <div className="empty-state">
            <p className="empty-state-title">いま復習する単語はありません</p>
            <p className="empty-state-desc">次の学習タイミングで、またここに単語が届きます。</p>
            <Link href="/dashboard" className="btn btn-ghost">ダッシュボードへ戻る</Link>
          </div>
        ) : null}

        {phase === 'self-assessment' && currentAssessment ? (
          <section aria-labelledby="assessment-term">
            <div className="vocabulary-test-progress" aria-live="polite" aria-atomic="true">{assessmentIndex + 1} / {items.length}</div>
            <div
              ref={swipeCardRef}
              className={`vocabulary-swipe-card${exitDirection ? ` swipe-exit-${exitDirection}` : ''}`}
              data-testid="vocabulary-swipe-card"
              tabIndex={0}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              onKeyDown={(event) => {
                if (
                  event.key === 'ArrowRight'
                  || event.code === 'ArrowRight'
                  || event.keyCode === 39
                ) {
                  event.preventDefault()
                  confirmAssessment(true)
                }
                if (
                  event.key === 'ArrowLeft'
                  || event.code === 'ArrowLeft'
                  || event.keyCode === 37
                ) {
                  event.preventDefault()
                  confirmAssessment(false)
                }
              }}
            >
              <p className="vocabulary-test-kicker">この単語を知っていますか？</p>
              <h2 id="assessment-term" ref={assessmentHeadingRef} tabIndex={-1}>{currentAssessment.term}</h2>
              <p>{currentAssessment.example}</p>
              <p className="vocabulary-gesture-hint">← まだ　／　知ってる →</p>
            </div>
            <div className="vocabulary-answer-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => confirmAssessment(false)}
              >
                まだ
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => confirmAssessment(true)}
              >
                知ってる
              </button>
            </div>
            <p className="vocabulary-keyboard-hint">
              キーボードでは左矢印で「まだ」、右矢印で「知ってる」
            </p>
          </section>
        ) : null}

        {phase === 'retest' && currentRetest ? (
          <section className="vocabulary-retest" aria-labelledby="retest-term">
            <div className="vocabulary-test-progress" aria-live="polite" aria-atomic="true">{retestIndex + 1} / {retestItems.length}</div>
            <p className="vocabulary-test-kicker">意味を選んでください</p>
            <h2 id="retest-term" ref={retestHeadingRef} tabIndex={-1}>{currentRetest.term}</h2>
            <div className="vocabulary-choice-list">
              {retestChoices.map((choice, index) => (
                <button
                  key={`${choice}-${index}`}
                  type="button"
                  className={`vocabulary-choice${revealedCorrect === choice ? ' is-correct-reveal' : ''}`}
                  disabled={isAdvancing}
                  onClick={() => handleRetestChoice(choice)}
                >
                  {choice}
                </button>
              ))}
            </div>
            {revealedCorrect ? (
              <div className="vocabulary-reveal-note" role="status">
                正解: {revealedCorrect}
              </div>
            ) : null}
            {showCorrectCheck ? (
              <div
                className="quiz-correct-feedback vocabulary-correct-feedback"
                data-testid="vocabulary-correct-check"
                role="status"
              >
                <svg
                  className="quiz-correct-mark"
                  width="28"
                  height="28"
                  viewBox="0 0 20 20"
                  fill="none"
                  aria-hidden="true"
                >
                  <path d="M4 10.5l3.5 3.5L16 5.5" />
                </svg>
                正解
              </div>
            ) : null}
          </section>
        ) : null}

        {phase === 'submitting' ? (
          <div className="vocabulary-test-status" role="status">結果を記録しています</div>
        ) : null}

        {phase === 'result' && summary ? (
          <section className="vocabulary-result" aria-labelledby="vocabulary-result-title">
            <p className="vocabulary-test-kicker">今回の記録</p>
            <h2 id="vocabulary-result-title" ref={resultHeadingRef} tabIndex={-1}>知ってる {summary.reviewed - summary.retestCount} 語</h2>
            {summary.retestCount === 0 ? (
              <>
                <p>すべて知っている単語でした</p>
                <p>復習の間隔は自動で調整されます。</p>
              </>
            ) : (
              <>
                <p>
                  再確認 {summary.retestCount} 語中 <strong>{summary.correct}</strong> 正解
                </p>
                <p>復習の間隔は自動で調整されます。</p>
              </>
            )}
            <div className="vocabulary-result-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setPhase('loading')
                  setItems([])
                  setAssessmentIndex(0)
                  setAssessments({})
                  setRetestItems([])
                  setRetestIndex(0)
                  setRetestResults({})
                  setSummary(null)
                  createApiClient()
                    .getVocabularyTestSession()
                    .then((session) => {
                      const boundedItems = session.items.slice(0, 10)
                      setItems(boundedItems)
                      setPhase(boundedItems.length === 0 ? 'empty' : 'self-assessment')
                    })
                    .catch(() => {
                      setPhase('error')
                      showToast('単語テストの読み込みに失敗しました', 'error')
                    })
                }}
              >
                もう一度テスト
              </button>
              <Link href="/podcast" className="btn btn-ghost">エピソードを聴きに行く</Link>
              <Link href="/dashboard" className="btn btn-ghost">ダッシュボードへ戻る</Link>
            </div>
          </section>
        ) : null}

        {phase === 'error' ? (
          <section className="vocabulary-result" aria-labelledby="vocabulary-error-title">
            {Object.keys(assessments).length === 0 ? (
              <>
                <p className="vocabulary-test-kicker">読み込みに失敗しました</p>
                <h2 id="vocabulary-error-title" ref={errorHeadingRef} tabIndex={-1}>もう一度試す</h2>
                <p>申し訳ありません。単語テストの読み込みに失敗しました。</p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setPhase('loading')
                    createApiClient()
                      .getVocabularyTestSession()
                      .then((session) => {
                        const boundedItems = session.items.slice(0, 10)
                        setItems(boundedItems)
                        setAssessments({})
                        setRetestItems([])
                        setRetestIndex(0)
                        setRetestResults({})
                        setPhase(boundedItems.length === 0 ? 'empty' : 'self-assessment')
                      })
                      .catch(() => {
                        showToast('単語テストの読み込みに失敗しました', 'error')
                      })
                  }}
                >
                  リロードする
                </button>
                <Link href="/dashboard" className="btn btn-ghost">ダッシュボードへ戻る</Link>
              </>
            ) : (
              <>
                <p className="vocabulary-test-kicker">送信に失敗しました</p>
                <h2 id="vocabulary-error-title">もう一度送信する</h2>
                <p>ご回答は保存されていますので、以下のボタンから再度送信できます。</p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void submitResults(assessments, retestResults)}
                >
                  送信を再試行する
                </button>
                <Link href="/dashboard" className="btn btn-ghost">キャンセルしてダッシュボードに戻る</Link>
              </>
            )}
          </section>
        ) : null}
      </div>
    </>
  )
}
