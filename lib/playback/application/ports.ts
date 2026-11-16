// Playback application の port。実装は Catalog の infrastructure が持つ（HTTP・DTO はここに現れない）。
import type { Episode, PlayableEpisode } from '@/lib/catalog/domain/episode'
import type { PlaybackSpeed } from '@/lib/playback/domain/session'
import type { OfflineEpisodeView, StorageUsageView } from '@/lib/playback/application/readModels'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

export interface EpisodeSource {
  fetch(id: string): Promise<Result<Episode, ApiFailure>>
}

/** サーバーが返した位置と記録時刻（epoch ms。読めない・無いときは null = 最古）。 */
export interface RemotePosition {
  readonly positionSeconds: number
  readonly recordedAt: number | null
}

/** 位置と完聴の送信。位置の応答は取り込みのために RemotePosition として返す。 */
export interface PositionSync {
  updatePosition(id: string, seconds: number, recordedAt: number): Promise<Result<RemotePosition, ApiFailure>>
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

/** 端末に残す再生位置（主体 × episode の最新 1 件）。recordedAt は epoch ms。 */
export interface StoredPosition {
  readonly positionSeconds: number
  readonly recordedAt: number
  readonly synced: boolean
}

export interface UnsentPosition {
  readonly episodeId: string
  readonly record: StoredPosition
}

export interface LocalPositionStore {
  read(userId: string, episodeId: string): StoredPosition | null
  /** 保存に成功したか。失敗しても呼び出し側は送信を試みる。 */
  write(userId: string, episodeId: string, record: StoredPosition): boolean
  unsent(userId: string): ReadonlyArray<UnsentPosition>
  /** 保存中の記録の recordedAt が一致するときだけ送信済みにする。 */
  markSynced(userId: string, episodeId: string, recordedAt: number): void
  /** 主体離脱で、その主体の記録だけを送らずに消す。 */
  clearSubject(userId: string): void
  /** 起動時の回収。keep 以外の主体の記録を消す（null なら全部）。 */
  reclaim(keep: string | null): void
  /** 旧い形（持ち主も時刻も無い）の記録を取り込まずに消す。 */
  discardLegacy(): void
}

export type Clock = () => number

/** recording = 記録の主体、sending = 送信の主体（認証が確定しているときだけ値を持つ）。 */
export interface PositionSubject {
  recording(): string | null
  sending(): string | null
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
