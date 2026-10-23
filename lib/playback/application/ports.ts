// Playback application の port。実装は Catalog の infrastructure が持つ（HTTP・DTO はここに現れない）。
import type { Episode } from '@/lib/catalog/domain/episode'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

export interface EpisodeSource {
  fetch(id: string): Promise<Result<Episode, ApiFailure>>
}

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
