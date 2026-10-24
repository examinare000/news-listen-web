// Playback application の port。実装は Catalog の infrastructure が持つ（HTTP・DTO はここに現れない）。
import type { Episode, PlayableEpisode } from '@/lib/catalog/domain/episode'
import type { PlaybackSpeed } from '@/lib/playback/domain/session'
import type { OfflineEpisodeView, StorageUsageView } from '@/lib/playback/application/readModels'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

export interface EpisodeSource {
  fetch(id: string): Promise<Result<Episode, ApiFailure>>
}

/** 位置と完聴の送信。応答の本文は捨て、成否だけを返す。 */
export interface PositionSync {
  updatePosition(id: string, seconds: number): Promise<Result<void, ApiFailure>>
  markCompleted(id: string): Promise<Result<void, ApiFailure>>
}

export type SaveFailure =
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'storage_full' }
  | { readonly kind: 'download_failed'; readonly failure: ApiFailure }
  | { readonly kind: 'not_playable' }

export interface OfflineLibrary {
  save(id: string): Promise<Result<void, SaveFailure>>
  /** 保存済みなら audioHandle 付きの PlayableEpisode。無い・再生できないときは null。 */
  get(id: string): Promise<PlayableEpisode | null>
  has(id: string): Promise<boolean>
  remove(id: string): Promise<void>
  clear(): Promise<void>
  list(): Promise<ReadonlyArray<OfflineEpisodeView>>
  usage(): Promise<StorageUsageView | null>
}

/** 端末に残す再生位置。表示と resume の候補に使う。 */
export interface LocalPositionStore {
  read(id: string): number | null
  write(id: string, seconds: number): void
}

export type Connectivity = () => boolean

export type DefaultSpeedSource = () => PlaybackSpeed

export interface QueueEntryInput {
  readonly id: string
  readonly title: string | null
  readonly intro: string
}

export type StartResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly notice: 'offline_uncached' | 'not_playable' | 'fetch_failed' }

export type AudioElementEventType = 'loadedmetadata' | 'timeupdate' | 'ended' | 'error'

// 音声 engine の操作だけを公開する。書き込める property は adapter（lib/platform/audioElement.ts）の中に閉じ込める。
export interface AudioElement {
  readonly currentTime: number
  readonly duration: number
  readonly paused: boolean
  /** src を設定して load() する。 */
  load(src: string): void
  /** pause() → src を空に → load()。音源を外す。 */
  unload(): void
  play(): Promise<void>
  pause(): void
  seek(seconds: number): void
  /** defaultPlaybackRate と playbackRate の両方に設定する。 */
  setPlaybackRate(rate: number): void
  setVolume(volume: number): void
  addEventListener(type: AudioElementEventType, listener: () => void): void
  removeEventListener(type: AudioElementEventType, listener: () => void): void
}
