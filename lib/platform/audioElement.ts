import type { AudioElement } from '@/lib/playback/domain/audioElement'

export function createBrowserAudioElement(): AudioElement {
  return new Audio()
}
