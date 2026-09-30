// 再生ドメインが外界と話すための port（型のみ）。実装は lib/platform/* とテスト double が持つ。
import type { Result, ApiFailure } from '@/lib/api/gateway'

export type AudioElementEventType = 'loadedmetadata' | 'timeupdate' | 'ended' | 'error'

export interface AudioElement {
  src: string
  currentTime: number
  readonly duration: number
  volume: number
  playbackRate: number
  defaultPlaybackRate: number
  readonly paused: boolean
  play(): Promise<void>
  pause(): void
  load(): void
  addEventListener(type: AudioElementEventType, listener: () => void): void
  removeEventListener(type: AudioElementEventType, listener: () => void): void
}

export interface CacheBucket {
  put(key: string, response: Response): Promise<void>
  match(key: string): Promise<Response | undefined>
  delete(key: string): Promise<boolean>
  keys(): Promise<ReadonlyArray<{ readonly url: string }>>
}

export type CacheWriteFailure =
  | { kind: 'download_failed'; failure: ApiFailure }
  | { kind: 'storage_full' }

export interface CacheStore {
  open(cacheName: string): Promise<CacheBucket>
  delete(cacheName: string): Promise<boolean>
  has(cacheName: string): Promise<boolean>
  keys(): Promise<string[]>
  /** URL の応答を取得し、成功時のみ key で格納する。失敗は reject せず Result で返す。 */
  putFromUrl(cacheName: string, key: string, url: string): Promise<Result<void, CacheWriteFailure>>
}

export interface KeyValueStore {
  get(key: string): string | null
  set(key: string, value: string): boolean
  remove(key: string): void
}
