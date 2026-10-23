import type { AudioElement } from '@/lib/playback/application/ports'

/** new Audio() を、操作だけの port の形で包む。書き込める property への代入はここに閉じ込める。 */
export function createBrowserAudioElement(): AudioElement {
  const el = new Audio()
  return {
    get currentTime() {
      return el.currentTime
    },
    get duration() {
      return el.duration
    },
    get paused() {
      return el.paused
    },
    load: (src) => {
      el.src = src
      el.load()
    },
    unload: () => {
      el.pause()
      el.src = ''
      el.load()
    },
    play: () => el.play(),
    pause: () => {
      el.pause()
    },
    seek: (seconds) => {
      el.currentTime = seconds
    },
    setPlaybackRate: (rate) => {
      el.defaultPlaybackRate = rate
      el.playbackRate = rate
    },
    setVolume: (volume) => {
      el.volume = volume
    },
    addEventListener: (type, listener) => {
      el.addEventListener(type, listener)
    },
    removeEventListener: (type, listener) => {
      el.removeEventListener(type, listener)
    },
  }
}
