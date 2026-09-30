import type { AudioElement } from '@/lib/playback/ports'

export function createBrowserAudioElement(): AudioElement {
  return new Audio()
}
