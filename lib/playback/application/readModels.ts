// 画面が読む再生のリードモデル 6 つと生成関数。毎回新しい深く凍結した値を返し、domain の object・関数を含めない。
import type { QueuedEpisode } from '@/lib/catalog/domain/episode'
import { nowPlayingTitle, upNextTitle } from '@/lib/playback/domain/queueEntry'
import { isPlayableEpisode } from '@/lib/playback/domain/session'
import type { PlaybackSpeed, PlaybackState } from '@/lib/playback/domain/session'
import type { DifficultyLevel } from '@/lib/shared/difficulty'

export interface NowPlaying {
  readonly episodeId: string
  readonly title: string
  readonly difficulty: DifficultyLevel
  readonly createdAt: string
  readonly durationSeconds: number
}

export interface UpNextItem {
  readonly id: string
  readonly title: string
}

export interface QueueView {
  readonly nowPlaying: NowPlaying | null
  readonly upNext: ReadonlyArray<UpNextItem>
  readonly canSkipNext: boolean
}

export type PlaybackPrimaryAction = 'play' | 'pause' | 'retry' | 'replay' | 'none'

export interface PlaybackView {
  readonly status: PlaybackState['status']
  readonly position: number
  readonly duration: number
  readonly speed: PlaybackSpeed
  readonly primaryAction: PlaybackPrimaryAction
  readonly failure: 'media' | 'unavailable' | null
}

export interface OfflineEpisodeView {
  readonly episodeId: string
  readonly title: string
  readonly durationSeconds: number
  readonly sizeBytes: number | null
  readonly savedAt: string | null
}

export interface OfflineEpisodeViewInput {
  readonly episodeId: string
  readonly title: string
  readonly durationSeconds: number
  readonly sizeBytes?: number | null
  readonly savedAt?: string | null
}

export interface StorageUsageView {
  readonly usage: number
  readonly quota: number
}

export function toNowPlaying(entry: QueuedEpisode | null, state: PlaybackState): NowPlaying | null {
  if (entry === null || state.status === 'idle') return null
  const episode = state.episode
  if (!isPlayableEpisode(episode) || episode.id !== entry.id) return null
  return Object.freeze({
    episodeId: episode.id,
    title: nowPlayingTitle(entry.label),
    difficulty: episode.difficulty,
    createdAt: episode.createdAt,
    durationSeconds: episode.durationSeconds,
  })
}

export function toUpNextItems(entries: ReadonlyArray<QueuedEpisode>): ReadonlyArray<UpNextItem> {
  return Object.freeze(entries.map((entry) => Object.freeze({ id: entry.id, title: upNextTitle(entry.label) })))
}

export function toQueueView(nowPlaying: NowPlaying | null, upNext: ReadonlyArray<UpNextItem>): QueueView {
  return Object.freeze({
    nowPlaying: nowPlaying === null ? null : Object.freeze({ ...nowPlaying }),
    upNext: Object.freeze(upNext.map((item) => Object.freeze({ ...item }))),
    canSkipNext: upNext.length > 0,
  })
}

function positionOf(state: PlaybackState): number {
  switch (state.status) {
    case 'loading':
      return state.resumePosition
    case 'playing':
    case 'paused':
    case 'errored':
      return state.position
    case 'idle':
    case 'ended':
      return 0
  }
}

function durationOf(state: PlaybackState, nowPlaying: NowPlaying | null): number {
  if ((state.status === 'playing' || state.status === 'paused' || state.status === 'ended') && state.duration > 0) {
    return state.duration
  }
  return nowPlaying?.durationSeconds ?? 0
}

function speedOf(state: PlaybackState, defaultSpeed: PlaybackSpeed): PlaybackSpeed {
  return state.status === 'idle' || state.status === 'ended' ? defaultSpeed : state.speed
}

function primaryActionOf(state: PlaybackState): PlaybackPrimaryAction {
  switch (state.status) {
    case 'playing':
      return 'pause'
    case 'paused':
      return 'play'
    case 'errored':
      return 'retry'
    case 'ended':
      return 'replay'
    case 'idle':
    case 'loading':
      return 'none'
  }
}

function failureOf(state: PlaybackState): PlaybackView['failure'] {
  if (state.status !== 'errored') return null
  const kind = state.reason.kind
  return kind === 'media' || kind === 'autoplay_blocked' ? 'media' : 'unavailable'
}

export function toPlaybackView(
  state: PlaybackState,
  nowPlaying: NowPlaying | null,
  defaultSpeed: PlaybackSpeed,
): PlaybackView {
  return Object.freeze({
    status: state.status,
    position: positionOf(state),
    duration: durationOf(state, nowPlaying),
    speed: speedOf(state, defaultSpeed),
    primaryAction: primaryActionOf(state),
    failure: failureOf(state),
  })
}

export function toOfflineEpisodeView(input: OfflineEpisodeViewInput): OfflineEpisodeView {
  return Object.freeze({
    episodeId: input.episodeId,
    title: input.title,
    durationSeconds: input.durationSeconds,
    sizeBytes: input.sizeBytes ?? null,
    savedAt: input.savedAt ?? null,
  })
}

export function toStorageUsageView(input: { readonly usage: number; readonly quota: number } | null): StorageUsageView | null {
  return input === null ? null : Object.freeze({ usage: input.usage, quota: input.quota })
}
