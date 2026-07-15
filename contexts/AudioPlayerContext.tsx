'use client'

import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react'
import { useAudioPlayer } from '@/hooks/useAudioPlayer'
import { getSavedPosition } from '@/hooks/useAudioPlayer'
import { useToast } from '@/components/ui/Toast'
import { useApp } from '@/contexts/AppContext'
import { createApiClient, ApiError } from '@/lib/api'
import { resolveResumePosition } from '@/lib/playbackPosition'
import { resolvePlaybackSource } from '@/lib/resolvePlayback'
import { getCachedAudioUrl, getCachedPodcast } from '@/lib/audioCache'
import * as Q from '@/lib/playbackQueue'
import type { Podcast } from '@/types'

// Single shared player instance for the entire app.
// Without this provider, each component calling useAudioPlayer() would get
// its own Audio element — making AudioPlayerBar unable to control pages' audio.
//
// issue #81: this provider also owns the playback queue (playlist) and auto-advances
// to the next episode when the current one ends.
type Player = ReturnType<typeof useAudioPlayer>

interface QueueApi {
  /** 待機列（現在より後ろ）。 */
  upNext: Podcast[]
  /** この Podcast を今すぐ再生し、キューを整える（一覧/詳細の再生起点）。 */
  playById: (podcastId: string) => Promise<void>
  /** キュー末尾に追加（何も再生していなければ即再生）。 */
  addToQueue: (podcast: Podcast) => Promise<void>
  /** 現在の次に割り込み（何も再生していなければ即再生）。 */
  playNextInQueue: (podcast: Podcast) => Promise<void>
  /** キューから取り除く。 */
  removeFromQueue: (id: string) => void
  /** 待機列を並べ替える（upNext 基準のインデックス）。 */
  reorderQueue: (fromIndex: number, toIndex: number) => void
  /** 次のエピソードへスキップ（無ければ何もしない）。 */
  skipToNext: () => Promise<void>
}

type AudioPlayerContextValue = Player & QueueApi

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null)

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const { showToast } = useToast()
  const { dispatch } = useApp()

  // キュー状態。onEnded（イベントリスナ）から最新値を読むため ref も併用する。
  const [queue, setQueue] = useState<Q.QueueState>(Q.emptyQueue)
  const queueRef = useRef<Q.QueueState>(Q.emptyQueue)
  const setQueueState = useCallback((next: Q.QueueState) => {
    queueRef.current = next
    setQueue(next)
  }, [])

  const onPositionSave = useCallback((podcastId: string, seconds: number) => {
    createApiClient()
      .updatePosition(podcastId, Math.max(0, seconds))
      .catch(() => {
        // Silent catch: network failures should not interrupt playback
      })
  }, [])

  // ADR-075 決定3: 完聴イベント発火。fire-and-forget（失敗は再生体験に影響させない・リトライ不要）。
  const onCompleted = useCallback((podcastId: string) => {
    createApiClient()
      .markCompleted(podcastId)
      .catch(() => {
        // Silent catch: network failures should not interrupt playback
      })
  }, [])

  // player を作る前に onEnded から呼ぶ関数を ref で前方参照する（初期化順の循環を避ける）。
  const advanceRef = useRef<() => void>(() => {})

  const player = useAudioPlayer({
    onError: () => showToast('音声を再生できません', 'error'),
    onPositionSave,
    onCompleted,
    onEnded: () => advanceRef.current(),
  })

  // 指定 Podcast を読み込んで再生する（キューは変更しない）。
  const loadAndPlay = useCallback(
    async (podcast: Podcast) => {
      const local = getSavedPosition(podcast.id)
      const resume = resolveResumePosition(podcast.playback_position_seconds, local)
      player.load(podcast.audio_url, resume, podcast.id)
      await player.play()
      dispatch({ type: 'SET_PODCAST', podcast })
    },
    [player, dispatch],
  )

  // オフライン保存済みならキャッシュ済み Blob URL + メタデータで再生し、getPodcast() の
  // 再取得（署名付き URL は期限切れうる上、そもそもオフラインでは失敗する）をスキップする。
  // 未キャッシュなら null を返し、呼び出し側が従来どおり getPodcast() で取得する。
  const resolveCachedPodcast = useCallback(async (podcastId: string): Promise<Podcast | null> => {
    const cachedUrl = await getCachedAudioUrl(podcastId)
    const source = resolvePlaybackSource({
      hasCached: cachedUrl !== null,
      isOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
    })
    if (source !== 'cached') return null

    const cachedPodcast = await getCachedPodcast(podcastId)
    if (!cachedPodcast || !cachedUrl) return null
    return { ...cachedPodcast, audio_url: cachedUrl }
  }, [])

  // 署名付き URL を取り直して再生する（キューは変更しない）。自動次再生・スキップで使う。
  const fetchAndPlay = useCallback(
    async (podcastId: string) => {
      try {
        const cached = await resolveCachedPodcast(podcastId)
        const fresh = cached ?? (await createApiClient().getPodcast(podcastId))
        await loadAndPlay(fresh)
      } catch (err) {
        showToast(err instanceof ApiError ? `再生できませんでした (${err.status})` : '再生できませんでした', 'error')
      }
    },
    [loadAndPlay, showToast, resolveCachedPodcast],
  )

  // 再生終了 → キューの次へ自動遷移（無ければ停止）。issue #81。
  const handleEnded = useCallback(() => {
    const { queue: nq, next } = Q.advance(queueRef.current)
    setQueueState(nq)
    if (next) {
      void fetchAndPlay(next.id)
    }
    // next が null のときは停止（'ended' で isPlaying は既に false）。
  }, [fetchAndPlay, setQueueState])

  // 最新の handleEnded を ref へ反映する（player の onEnded が event 時に参照する）。
  useEffect(() => {
    advanceRef.current = handleEnded
  }, [handleEnded])

  // 一覧/詳細の再生起点。キューにあればそこへジャンプ、無ければ現在の次に挿入して再生する。
  // WHY(#81 review): 旧実装は Q.start で既存のキューを丸ごと置き換えており、利用者が組んだ
  // 待機列が▶タップで消えていた。現在の次に挿入して jump することで待機列を保持する。
  const playById = useCallback(
    async (podcastId: string) => {
      try {
        const cached = await resolveCachedPodcast(podcastId)
        const fresh = cached ?? (await createApiClient().getPodcast(podcastId))
        const existing = Q.jump(queueRef.current, podcastId)
        if (existing.found) {
          setQueueState(existing.queue)
        } else {
          const inserted = Q.playNext(queueRef.current, fresh)
          setQueueState(Q.jump(inserted, podcastId).queue)
        }
        await loadAndPlay(fresh)
      } catch (err) {
        showToast(err instanceof ApiError ? `再生できませんでした (${err.status})` : '再生できませんでした', 'error')
      }
    },
    [loadAndPlay, showToast, setQueueState, resolveCachedPodcast],
  )

  const addToQueue = useCallback(
    async (podcast: Podcast) => {
      const nothingPlaying = Q.current(queueRef.current) === null
      setQueueState(Q.add(queueRef.current, podcast))
      if (nothingPlaying) await playById(podcast.id)
    },
    [playById, setQueueState],
  )

  const playNextInQueue = useCallback(
    async (podcast: Podcast) => {
      const nothingPlaying = Q.current(queueRef.current) === null
      setQueueState(Q.playNext(queueRef.current, podcast))
      if (nothingPlaying) await playById(podcast.id)
    },
    [playById, setQueueState],
  )

  const removeFromQueue = useCallback(
    (id: string) => setQueueState(Q.remove(queueRef.current, id)),
    [setQueueState],
  )

  const reorderQueue = useCallback(
    (fromIndex: number, toIndex: number) =>
      setQueueState(Q.reorderUpNext(queueRef.current, fromIndex, toIndex)),
    [setQueueState],
  )

  const skipToNext = useCallback(async () => {
    const { queue: nq, next } = Q.advance(queueRef.current)
    setQueueState(nq)
    if (next) await fetchAndPlay(next.id)
  }, [fetchAndPlay, setQueueState])

  const value: AudioPlayerContextValue = {
    ...player,
    upNext: Q.upNext(queue),
    playById,
    addToQueue,
    playNextInQueue,
    removeFromQueue,
    reorderQueue,
    skipToNext,
  }

  return <AudioPlayerContext.Provider value={value}>{children}</AudioPlayerContext.Provider>
}

export function useAudioPlayerContext(): AudioPlayerContextValue {
  const ctx = useContext(AudioPlayerContext)
  if (!ctx) {
    throw new Error('useAudioPlayerContext must be used within AudioPlayerProvider')
  }
  return ctx
}
