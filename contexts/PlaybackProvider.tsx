'use client'

import React, { createContext, useContext, useEffect, useReducer, useState } from 'react'
import { useApiClient } from '@/contexts/ApiClientProvider'
import { useApp } from '@/contexts/AppContext'
import { KEY_PLAYER_VOLUME } from '@/lib/config'
import type { ApiGateway } from '@/lib/api/gateway'
import { createEpisodeGateway } from '@/lib/catalog/infrastructure/episodeGateway'
import type { OfflineLibrary } from '@/lib/playback/application/ports'
import { createPlaybackCoordinator } from '@/lib/playback/application/coordinator'
import type { PlaybackCommands, PlaybackQueries } from '@/lib/playback/application/coordinator'
import { createPositionReporter } from '@/lib/playback/application/positionReporter'
import type { PlaybackView } from '@/lib/playback/application/readModels'
import { createPlaybackSession } from '@/lib/playback/application/session'
import type { PlaybackSession } from '@/lib/playback/application/session'
import { PLAYBACK_SPEEDS } from '@/lib/playback/domain/session'
import type { PlaybackSpeed } from '@/lib/playback/domain/session'
import { createPositionSync } from '@/lib/playback/infrastructure/gatewayFns'
import { createLocalPositionStore } from '@/lib/playback/infrastructure/localPositionStore'
import { createOfflineLibrary } from '@/lib/playback/infrastructure/offlineLibrary'
import { createBrowserAudioElement } from '@/lib/platform/audioElement'
import { createBrowserCacheStore } from '@/lib/platform/cacheStore'
import { createBrowserKeyValueStore } from '@/lib/platform/keyValueStore'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'
import { createBrowserObjectUrl } from '@/lib/platform/objectUrl'
import { createBrowserStorageEstimate } from '@/lib/platform/storageEstimate'

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

// 8 段に含まれる値はそのまま、含まれなければ 1.0。Session が丸めるのは start のときだけなので、idle・ended の表示のためにここで狭める。
function narrowSpeed(value: number): PlaybackSpeed {
  return PLAYBACK_SPEEDS.find((speed) => speed === value) ?? 1.0
}

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

// 音量の codec（暫定。設定の登録簿へ移すまで Provider が持つ）。範囲外・型違い・壊れた値は 1.0。
function readVolume(kv: KeyValueStore): number {
  const raw = kv.get(KEY_PLAYER_VOLUME)
  if (raw === null) return DEFAULT_VOLUME
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'number' && parsed >= 0 && parsed <= 1 ? parsed : DEFAULT_VOLUME
  } catch {
    return DEFAULT_VOLUME
  }
}

function createWiring(gateway: ApiGateway, defaultSpeed: PlaybackSpeed) {
  const session = createPlaybackSession(createBrowserAudioElement())
  const kv = createBrowserKeyValueStore()
  const localPositions = createLocalPositionStore(kv)
  const offline = createOfflineLibrary({
    cacheStore: createBrowserCacheStore(),
    gateway,
    objectUrl: createBrowserObjectUrl(),
    estimate: createBrowserStorageEstimate(),
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
  const volume = readVolume(kv)
  session.setVolume(volume)
  return {
    session,
    coordinator,
    offline,
    speed,
    volume,
    saveVolume: (value: number) => {
      kv.set(KEY_PLAYER_VOLUME, JSON.stringify(value))
    },
  }
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
  const { state } = useApp()
  const defaultSpeed = narrowSpeed(state.playbackSpeed)
  const [wiring] = useState<Wiring | null>(() => (typeof window === 'undefined' ? null : createWiring(gateway, defaultSpeed)))
  const [volume, setVolume] = useState(() => wiring?.volume ?? DEFAULT_VOLUME)
  // 関数の同一性を保つため、操作の束は 1 回だけ作る。
  const [operations] = useState(() => (wiring === null ? null : createOperations(wiring, setVolume)))
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

  // 描画のたびに最新の既定速度を渡す。effect で更新すると 1 描画遅れる。
  wiring?.speed.set(defaultSpeed)

  const value: PlaybackContextValue =
    wiring === null || operations === null
      ? createServerValue(defaultSpeed)
      : { ...operations, playback: wiring.coordinator.playbackView(), volume }
  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>
}

function createOperations(wiring: Wiring, setVolume: (volume: number) => void): Omit<PlaybackContextValue, 'playback' | 'volume'> {
  const { coordinator, session, offline } = wiring
  return {
    startEpisode: (id) => coordinator.startEpisode(id),
    retry: () => coordinator.retry(),
    addToQueue: (input) => coordinator.addToQueue(input),
    playNext: (input) => coordinator.playNext(input),
    removeFromQueue: (id) => coordinator.removeFromQueue(id),
    reorder: (from, toOffset) => coordinator.reorder(from, toOffset),
    skipToNext: () => coordinator.skipToNext(),
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
      wiring.saveVolume(next)
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
