import { vi } from 'vitest'

type EventListener = (event: Event) => void

/**
 * jsdom に Audio 実装がないため、テスト用モッククラスを提供する。
 * play/pause/currentTime/volume/playbackRate/イベント発火ヘルパーを備える。
 */
export class MockAudio {
  src: string = ''
  currentTime: number = 0
  duration: number = 0
  volume: number = 1
  playbackRate: number = 1
  paused: boolean = true
  // HTMLMediaElement.error は MediaError | null だが、テストでは boolean flag で代替
  error: null | { code: number } = null

  private _listeners: Map<string, Set<EventListener>> = new Map()

  play(): Promise<void> {
    this.paused = false
    return Promise.resolve()
  }

  pause(): void {
    this.paused = true
  }

  load(): void {
    // src が変わった後の再ロード
  }

  addEventListener(type: string, listener: EventListener): void {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, new Set())
    }
    this._listeners.get(type)!.add(listener)
  }

  removeEventListener(type: string, listener: EventListener): void {
    this._listeners.get(type)?.delete(listener)
  }

  dispatchEvent(event: Event): boolean {
    this._listeners.get(event.type)?.forEach((listener) => listener(event))
    return true
  }

  // --- テスト用ヘルパーメソッド ---

  /** 指定イベントを発火して登録済みリスナーを呼ぶ */
  fireEvent(type: string, extra?: Partial<Event>): void {
    const event = Object.assign(new Event(type), extra)
    this._listeners.get(type)?.forEach((listener) => listener(event))
  }

  /** timeupdate イベントを発火（currentTime を事前にセットしてから呼ぶ） */
  fireTimeUpdate(currentTime: number): void {
    this.currentTime = currentTime
    this.fireEvent('timeupdate')
  }

  /** ended イベントを発火 */
  fireEnded(): void {
    this.paused = true
    this.fireEvent('ended')
  }

  /** error イベントを発火 */
  fireError(): void {
    this.fireEvent('error')
  }

  /** loadedmetadata イベントを発火（duration をセットしてから呼ぶ） */
  fireLoadedMetadata(duration: number): void {
    this.duration = duration
    this.fireEvent('loadedmetadata')
  }
}

/**
 * グローバル Audio をモックに差し替え、インスタンスを返す。
 * テスト終了後は vitest の afterEach で vi.unstubAllGlobals() を呼ぶこと。
 */
export function setupMockAudio(): MockAudio {
  const instance = new MockAudio()
  vi.stubGlobal('Audio', vi.fn(() => instance))
  return instance
}
