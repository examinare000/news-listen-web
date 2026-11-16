'use client'

import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useToast } from '@/components/ui/Toast'
import { useSfx } from '@/contexts/SfxProvider'
import { useVocabularyTestSession } from '@/contexts/useVocabularyTestSession'

const LOAD_FAILURE_MESSAGE = '単語テストの読み込みに失敗しました'
const SUBMIT_FAILURE_MESSAGE = '単語テストの結果送信に失敗しました'

export default function VocabularyTestPage() {
  const { showToast } = useToast()
  const { play: playSfx, prepare: prepareSfx } = useSfx()
  const { view, commands } = useVocabularyTestSession()
  const [exitDirection, setExitDirection] = useState<'left' | 'right' | null>(null)
  const pointerStartXRef = useRef<number | null>(null)
  const swipeCardRef = useRef<HTMLDivElement | null>(null)
  const assessmentHeadingRef = useRef<HTMLHeadingElement>(null)
  const retestHeadingRef = useRef<HTMLHeadingElement>(null)
  const resultHeadingRef = useRef<HTMLHeadingElement>(null)
  const errorHeadingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    let active = true
    void commands.startVocabularyTest().then((result) => {
      if (active && !result.ok) showToast(LOAD_FAILURE_MESSAGE, 'error')
    })
    return () => {
      active = false
    }
  }, [commands, showToast])

  // Focus management for phase transitions
  useEffect(() => {
    if (view.phase === 'self-assessment' && assessmentHeadingRef.current) {
      assessmentHeadingRef.current.focus()
    } else if (view.phase === 'retest' && retestHeadingRef.current) {
      retestHeadingRef.current.focus()
    } else if (view.phase === 'result' && resultHeadingRef.current) {
      resultHeadingRef.current.focus()
    } else if (view.phase === 'error' && errorHeadingRef.current) {
      errorHeadingRef.current.focus()
    }
  }, [view.phase])

  // 正誤の合図の音は、feedback が出た契機で 1 回だけ鳴らす。
  useEffect(() => {
    if (view.retestFeedback) playSfx(view.retestFeedback.kind)
  }, [view.retestFeedback, playSfx])

  function reload() {
    void commands.startVocabularyTest().then((result) => {
      if (!result.ok) showToast(LOAD_FAILURE_MESSAGE, 'error')
    })
  }

  function recordSelfAssessment(known: boolean) {
    if (view.phase !== 'self-assessment') return
    prepareSfx()
    void commands.assessVocabulary(known).then((result) => {
      if (!result.ok) showToast(SUBMIT_FAILURE_MESSAGE, 'error')
    })
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
    if (view.phase !== 'retest' || view.isAnswerLocked) return
    prepareSfx()
    void commands.answerRetest(choice).then((result) => {
      if (!result.ok) showToast(SUBMIT_FAILURE_MESSAGE, 'error')
    })
  }

  // 罰的な赤・バツは使わず、正解肢の提示で学習機会を残す（ADR-088 原則）。
  const revealedCorrect = view.retestFeedback?.kind === 'incorrect' ? view.retestFeedback.correctMeaning : null
  const showCorrectCheck = view.retestFeedback?.kind === 'correct'

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
        {view.phase === 'loading' ? (
          <div className="vocabulary-test-status" role="status">単語を準備しています</div>
        ) : null}

        {view.phase === 'empty' ? (
          <div className="empty-state">
            <p className="empty-state-title">いま復習する単語はありません</p>
            <p className="empty-state-desc">次の学習タイミングで、またここに単語が届きます。</p>
            <Link href="/dashboard" className="btn btn-ghost">ダッシュボードへ戻る</Link>
          </div>
        ) : null}

        {view.phase === 'self-assessment' && view.currentTerm !== null ? (
          <section aria-labelledby="assessment-term">
            <div className="vocabulary-test-progress" aria-live="polite" aria-atomic="true">{view.progress?.position} / {view.progress?.total}</div>
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
              <h2 id="assessment-term" ref={assessmentHeadingRef} tabIndex={-1}>{view.currentTerm}</h2>
              <p>{view.currentExample}</p>
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

        {view.phase === 'retest' && view.currentTerm !== null ? (
          <section className="vocabulary-retest" aria-labelledby="retest-term">
            <div className="vocabulary-test-progress" aria-live="polite" aria-atomic="true">{view.progress?.position} / {view.progress?.total}</div>
            <p className="vocabulary-test-kicker">意味を選んでください</p>
            <h2 id="retest-term" ref={retestHeadingRef} tabIndex={-1}>{view.currentTerm}</h2>
            <div className="vocabulary-choice-list">
              {view.choices.map((choice, index) => (
                <button
                  key={`${choice}-${index}`}
                  type="button"
                  className={`vocabulary-choice${revealedCorrect === choice ? ' is-correct-reveal' : ''}`}
                  disabled={view.isAnswerLocked}
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

        {view.phase === 'submitting' ? (
          <div className="vocabulary-test-status" role="status">結果を記録しています</div>
        ) : null}

        {view.phase === 'result' && view.summary ? (
          <section className="vocabulary-result" aria-labelledby="vocabulary-result-title">
            <p className="vocabulary-test-kicker">今回の記録</p>
            <h2 id="vocabulary-result-title" ref={resultHeadingRef} tabIndex={-1}>知ってる {view.summary.knownCount} 語</h2>
            {view.summary.retestCount === 0 ? (
              <>
                <p>すべて知っている単語でした</p>
                <p>復習の間隔は自動で調整されます。</p>
              </>
            ) : (
              <>
                <p>
                  再確認 {view.summary.retestCount} 語中 <strong>{view.summary.retestCorrectCount}</strong> 正解
                </p>
                <p>復習の間隔は自動で調整されます。</p>
              </>
            )}
            <div className="vocabulary-result-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={reload}
              >
                もう一度テスト
              </button>
              <Link href="/podcast" className="btn btn-ghost">エピソードを聴きに行く</Link>
              <Link href="/dashboard" className="btn btn-ghost">ダッシュボードへ戻る</Link>
            </div>
          </section>
        ) : null}

        {view.phase === 'error' ? (
          <section className="vocabulary-result" aria-labelledby="vocabulary-error-title">
            {view.errorReason === 'load' ? (
              <>
                <p className="vocabulary-test-kicker">読み込みに失敗しました</p>
                <h2 id="vocabulary-error-title" ref={errorHeadingRef} tabIndex={-1}>もう一度試す</h2>
                <p>申し訳ありません。単語テストの読み込みに失敗しました。</p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={reload}
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
                  onClick={() => {
                    void commands.submitVocabularyTest().then((result) => {
                      if (!result.ok) showToast(SUBMIT_FAILURE_MESSAGE, 'error')
                    })
                  }}
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
