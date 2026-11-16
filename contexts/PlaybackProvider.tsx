'use client'

import React, { createContext, useContext, useEffect, useReducer, useState } from 'react'
import { useApiClient } from '@/contexts/ApiClientProvider'
import { useAuth } from '@/contexts/AuthProvider'
import { NO_INTAKE, PositionIntakeContext } from '@/contexts/PositionIntakeContext'
import { usePreferences } from '@/contexts/PreferencesProvider'
import type { ApiGateway } from '@/lib/api/gateway'
import { createEpisodeGateway } from '@/lib/catalog/infrastructure/episodeGateway'
import type { Clock, Foreground, OfflineLibrary, PositionSubject } from '@/lib/playback/application/ports'
import { createPlaybackCoordinator } from '@/lib/playback/application/coordinator'
import type { PlaybackCommands, PlaybackQueries } from '@/lib/playback/application/coordinator'
import { createPositionOutbox } from '@/lib/playback/application/positionOutbox'
import { createPositionReporter } from '@/lib/playback/application/positionReporter'
import type { PlaybackView } from '@/lib/playback/application/readModels'
import { createResumeAdvisor } from '@/lib/playback/application/resumeAdvisor'
import { createPlaybackSession } from '@/lib/playback/application/session'
import type { PlaybackSession } from '@/lib/playback/application/session'
import type { PlaybackSpeed } from '@/lib/playback/domain/session'
import { createPositionSync } from '@/lib/playback/infrastructure/gatewayFns'
import { createLocalPositionStore } from '@/lib/playback/infrastructure/localPositionStore'
import { createOfflineLibrary } from '@/lib/playback/infrastructure/offlineLibrary'
import { createBrowserAudioElement } from '@/lib/platform/audioElement'
import { createBrowserCacheStore } from '@/lib/platform/cacheStore'
import { createBrowserConnectivityEvents } from '@/lib/platform/connectivityEvents'
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

// 描画のたびに書く認証の種類だけを持つ。userId は持たない（直接交代で lastSubject が同期に替わった後、再描画の前でも sending が新しい主体を返すため）。
function createSendingHolder(): { get: () => boolean; set: (next: boolean) => void } {
  let current = false
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
  authenticated: () => boolean,
) {
  const session = createPlaybackSession(createBrowserAudioElement())
  const kv = createBrowserKeyValueStore()
  const localPositions = createLocalPositionStore(kv)
  // 旧い形の記録は取り込まずに捨てる。毎起動で冪等。
  localPositions.discardLegacy()
  const subject: PositionSubject = {
    recording: currentUserId,
    sending: () => (authenticated() ? currentUserId() : null),
  }
  const clock: Clock = Date.now
  const sync = createPositionSync(gateway)
  // 取り込みで端末の記録が置き換わった位置の控え。outbox・reporter・coordinator が同じ 1 つを共有する。
  const advisor = createResumeAdvisor()
  const outbox = createPositionOutbox({
    sync,
    local: localPositions,
    subject,
    // 再生中・一時停止中のその episode だけ控える。ほかの状態や別の episode の取り込みは尋ねる対象にしない。
    onAdopted: (episodeId, remote) => {
      const state = session.state()
      if ((state.status === 'playing' || state.status === 'paused') && state.episode.id === episodeId) {
        advisor.note(episodeId, remote)
      }
    },
  })
  // 描画のたびに作ると useCatalogQueries の useMemo が作り直され、一覧が取り直される。wiring と同じ寿命で 1 つだけ持つ。
  const intake = { capture: () => outbox.capture() }
  const offline = createOfflineLibrary({
    cacheStore: createBrowserCacheStore(),
    gateway,
    objectUrl: createBrowserObjectUrl(),
    estimate: createBrowserStorageEstimate(),
    currentUserId,
  })
  const speed = createSpeedHolder(defaultSpeed)
  const isForeground: Foreground = () => typeof document === 'undefined' || document.visibilityState === 'visible'
  const coordinator = createPlaybackCoordinator({
    session,
    offline,
    positionReporter: createPositionReporter({ sync, outbox, local: localPositions, clock, subject, advisor }),
    episodes: createEpisodeGateway(gateway),
    localPositions,
    subject,
    positionIntake: outbox,
    isOnline: () => typeof navigator === 'undefined' || navigator.onLine,
    defaultSpeed: speed.get,
    resumeAdvisor: advisor,
    isForeground,
  })
  session.setVolume(initialVolume)
  return { session, coordinator, offline, speed, outbox, intake, volume: initialVolume }
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
    requestResume: serverError,
    chooseResume: serverError,
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
  const { currentUserId, registerSubjectLeaveStep, view: authView } = useAuth()
  const defaultSpeed = get(defaultPlaybackSpeed)
  // 音量は wiring の生成時に 1 回だけ読み、以後は変更を set で書くだけにする。
  // 送信の主体は認証の確定後だけ値を持つ。wiring は 1 回しか作らないので、最新の認証の種類を入れ物経由で渡す。
  const [sendingHolder] = useState(() => createSendingHolder())
  sendingHolder.set(authView.kind === 'authenticated')
  const [wiring] = useState<Wiring | null>(() =>
    typeof window === 'undefined'
      ? null
      : createWiring(gateway, defaultSpeed, get(volumeSetting), currentUserId, sendingHolder.get),
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

  // 認証の確定（起動・再確立・直接交代）で未送信を送る。
  const authenticatedUser = authView.kind === 'authenticated' ? currentUserId() : null
  useEffect(() => {
    if (wiring === null || authenticatedUser === null) return
    void wiring.outbox.flush()
  }, [wiring, authenticatedUser])

  // 回線の復帰で再送する。タイマーでは再試行しない。
  useEffect(() => {
    if (wiring === null) return undefined
    return createBrowserConnectivityEvents().onOnline(() => {
      void wiring.outbox.flush()
    })
  }, [wiring])

  // 描画のたびに最新の既定速度を渡す。effect で更新すると 1 描画遅れる。
  wiring?.speed.set(defaultSpeed)

  const intake = wiring === null ? NO_INTAKE : wiring.intake

  const value: PlaybackContextValue =
    wiring === null || operations === null
      ? createServerValue(defaultSpeed)
      : { ...operations, playback: wiring.coordinator.playbackView(), volume }
  return (
    <PlaybackContext.Provider value={value}>
      <PositionIntakeContext.Provider value={intake}>{children}</PositionIntakeContext.Provider>
    </PlaybackContext.Provider>
  )
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
    requestResume: () => coordinator.requestResume(),
    chooseResume: (choice) => coordinator.chooseResume(choice),
    stopForSubjectLeave: () => coordinator.stopForSubjectLeave(),
    nowPlaying: () => coordinator.nowPlaying(),
    upNext: () => coordinator.upNext(),
    queueView: () => coordinator.queueView(),
    playbackView: () => coordinator.playbackView(),
    savedPosition: (id, durationSeconds) => coordinator.savedPosition(id, durationSeconds),
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
