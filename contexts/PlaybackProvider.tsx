'use client'

import React, { createContext, useContext, useEffect, useReducer, useState } from 'react'
import { useApiClient } from '@/contexts/ApiClientProvider'
import { useAuth } from '@/contexts/AuthProvider'
import { usePreferences } from '@/contexts/PreferencesProvider'
import type { ApiGateway } from '@/lib/api/gateway'
import { createEpisodeGateway } from '@/lib/catalog/infrastructure/episodeGateway'
import type { OfflineLibrary } from '@/lib/playback/application/ports'
import { createPlaybackCoordinator } from '@/lib/playback/application/coordinator'
import type { PlaybackCommands, PlaybackQueries } from '@/lib/playback/application/coordinator'
import { createPositionReporter } from '@/lib/playback/application/positionReporter'
import type { PlaybackView } from '@/lib/playback/application/readModels'
import { createPlaybackSession } from '@/lib/playback/application/session'
import type { PlaybackSession } from '@/lib/playback/application/session'
import type { PlaybackSpeed } from '@/lib/playback/domain/session'
import { createPositionSync } from '@/lib/playback/infrastructure/gatewayFns'
import { createLocalPositionStore } from '@/lib/playback/infrastructure/localPositionStore'
import { createOfflineLibrary } from '@/lib/playback/infrastructure/offlineLibrary'
import { createBrowserAudioElement } from '@/lib/platform/audioElement'
import { createBrowserCacheStore } from '@/lib/platform/cacheStore'
import { createBrowserKeyValueStore } from '@/lib/platform/keyValueStore'
import { createBrowserObjectUrl } from '@/lib/platform/objectUrl'
import { createBrowserStorageEstimate } from '@/lib/platform/storageEstimate'
import { defaultPlaybackSpeed, volume as volumeSetting } from '@/lib/preferences/domain/settings'

type SessionOperations = Pick<PlaybackSession, 'play' | 'pause' | 'seek' | 'seekRelative' | 'setSpeed'>

export type PlaybackContextValue = PlaybackCommands &
  PlaybackQueries &
  SessionOperations & {
    /** playbackView() を描画のたびに評価した値。PlaybackState は外へ出さない。 */
    readonly playback: PlaybackView
    setVolume(volume: number): void
    readonly volume: number
    readonly offline: OfflineLibrary
  }

const PlaybackContext = createContext<PlaybackContextValue | null>(null)

const SERVER_ERROR = 'PlaybackProvider is not available during server rendering'
const DEFAULT_VOLUME = 1.0

// 閉包の値を読み書きする小さな入れ物。Coordinator は生成時に関数を 1 回だけ受け取るので、最新の既定速度をここ経由で渡す。
function createSpeedHolder(initial: PlaybackSpeed): { get: () => PlaybackSpeed; set: (next: PlaybackSpeed) => void } {
  let current = initial
  return {
    get: () => current,
    set: (next) => {
      current = next
    },
  }
}

function createWiring(
  gateway: ApiGateway,
  defaultSpeed: PlaybackSpeed,
  initialVolume: number,
  currentUserId: () => string | null,
) {
  const session = createPlaybackSession(createBrowserAudioElement())
  const kv = createBrowserKeyValueStore()
  const localPositions = createLocalPositionStore(kv)
  const offline = createOfflineLibrary({
    cacheStore: createBrowserCacheStore(),
    gateway,
    objectUrl: createBrowserObjectUrl(),
    estimate: createBrowserStorageEstimate(),
    currentUserId,
  })
  const speed = createSpeedHolder(defaultSpeed)
  const coordinator = createPlaybackCoordinator({
    session,
    offline,
    positionReporter: createPositionReporter({ sync: createPositionSync(gateway), local: localPositions }),
    episodes: createEpisodeGateway(gateway),
    localPositions,
    isOnline: () => typeof navigator === 'undefined' || navigator.onLine,
    defaultSpeed: speed.get,
  })
  session.setVolume(initialVolume)
  return { session, coordinator, offline, speed, volume: initialVolume }
}

type Wiring = ReturnType<typeof createWiring>

function serverError(): never {
  throw new Error(SERVER_ERROR)
}

// server render 用。query は idle の値を返し、操作は呼ばれたら投げる。
function createServerValue(defaultSpeed: PlaybackSpeed): PlaybackContextValue {
  const playback: PlaybackView = Object.freeze({
    status: 'idle',
    position: 0,
    duration: 0,
    speed: defaultSpeed,
    primaryAction: 'none',
    failure: null,
  })
  return {
    startEpisode: serverError,
    retry: serverError,
    addToQueue: serverError,
    playNext: serverError,
    removeFromQueue: serverError,
    reorder: serverError,
    skipToNext: serverError,
    stopForSubjectLeave: serverError,
    nowPlaying: () => null,
    upNext: () => [],
    queueView: () => ({ nowPlaying: null, upNext: [], canSkipNext: false }),
    playbackView: () => playback,
    savedPosition: () => null,
    playback,
    play: serverError,
    pause: serverError,
    seek: serverError,
    seekRelative: serverError,
    setSpeed: serverError,
    setVolume: serverError,
    volume: DEFAULT_VOLUME,
    offline: {
      save: serverError,
      get: serverError,
      has: serverError,
      remove: serverError,
      clear: serverError,
      list: serverError,
      usage: serverError,
    },
  }
}

export function PlaybackProvider({ children }: { children: React.ReactNode }) {
  const gateway = useApiClient()
  const { get, set } = usePreferences()
  const { currentUserId, registerSubjectLeaveStep } = useAuth()
  const defaultSpeed = get(defaultPlaybackSpeed)
  // 音量は wiring の生成時に 1 回だけ読み、以後は変更を set で書くだけにする。
  const [wiring] = useState<Wiring | null>(() =>
    typeof window === 'undefined' ? null : createWiring(gateway, defaultSpeed, get(volumeSetting), currentUserId),
  )
  const [volume, setVolume] = useState(() => wiring?.volume ?? DEFAULT_VOLUME)
  // 関数の同一性を保つため、操作の束は 1 回だけ作る。
  const [operations] = useState(() => (wiring === null ? null : createOperations(wiring, setVolume, (next) => set(volumeSetting, next))))
  const [, tick] = useReducer((count: number) => count + 1, 0)

  useEffect(() => {
    if (wiring === null) return undefined
    const unsubscribeSession = wiring.session.subscribe(tick)
    const unsubscribeCoordinator = wiring.coordinator.subscribe(tick)
    return () => {
      unsubscribeSession()
      unsubscribeCoordinator()
    }
  }, [wiring])

  // 主体離脱の後始末 (d) が呼ぶ停止の登録口。AuthProvider は再生を知らない（web-dec-73）。
  useEffect(() => {
    if (wiring === null) return undefined
    return registerSubjectLeaveStep(() => wiring.coordinator.stopForSubjectLeave())
  }, [wiring, registerSubjectLeaveStep])

  // 描画のたびに最新の既定速度を渡す。effect で更新すると 1 描画遅れる。
  wiring?.speed.set(defaultSpeed)

  const value: PlaybackContextValue =
    wiring === null || operations === null
      ? createServerValue(defaultSpeed)
      : { ...operations, playback: wiring.coordinator.playbackView(), volume }
  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>
}

function createOperations(
  wiring: Wiring,
  setVolume: (volume: number) => void,
  saveVolume: (volume: number) => void,
): Omit<PlaybackContextValue, 'playback' | 'volume'> {
  const { coordinator, session, offline } = wiring
  return {
    startEpisode: (id) => coordinator.startEpisode(id),
    retry: () => coordinator.retry(),
    addToQueue: (input) => coordinator.addToQueue(input),
    playNext: (input) => coordinator.playNext(input),
    removeFromQueue: (id) => coordinator.removeFromQueue(id),
    reorder: (from, toOffset) => coordinator.reorder(from, toOffset),
    skipToNext: () => coordinator.skipToNext(),
    stopForSubjectLeave: () => coordinator.stopForSubjectLeave(),
    nowPlaying: () => coordinator.nowPlaying(),
    upNext: () => coordinator.upNext(),
    queueView: () => coordinator.queueView(),
    playbackView: () => coordinator.playbackView(),
    savedPosition: (id) => coordinator.savedPosition(id),
    play: () => session.play(),
    pause: () => session.pause(),
    seek: (seconds) => session.seek(seconds),
    seekRelative: (delta) => session.seekRelative(delta),
    setSpeed: (speed) => session.setSpeed(speed),
    setVolume: (next) => {
      session.setVolume(next)
      setVolume(next)
      saveVolume(next)
    },
    offline,
  }
}

export function usePlayback(): PlaybackContextValue {
  const ctx = useContext(PlaybackContext)
  if (!ctx) {
    throw new Error('usePlayback must be used within PlaybackProvider')
  }
  return ctx
}
