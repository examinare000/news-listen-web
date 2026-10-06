// 再生ドメインが駆動する音声要素の port（型のみ）。実装は lib/platform/audioElement.ts とテスト double が持つ。
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
