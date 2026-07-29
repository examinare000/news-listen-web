import { KEY_SFX_ENABLED } from '@/lib/config'

export type SfxName = 'correct' | 'incorrect' | 'achievement' | 'streak' | 'swipe'

interface Voice {
  frequency: number
  duration: number
  gain: number
  delay?: number
  type?: OscillatorType
  glideTo?: number
}

const THROTTLE_MS = 300
const MIN_GAIN = 0.0001

const VOCABULARY: Record<SfxName, readonly Voice[]> = {
  correct: [
    { frequency: 540, duration: 0.09, gain: 0.12, type: 'triangle' },
    { frequency: 760, duration: 0.08, gain: 0.06, delay: 0.035, type: 'sine' },
  ],
  incorrect: [
    { frequency: 190, duration: 0.17, gain: 0.09, type: 'sine', glideTo: 150 },
  ],
  // WHY: ゲーム的ファンファーレ（上昇アルペジオ）を廃し、印鑑/紙の質感を表現する 2 音構成へ。
  // Editorial なスタンプ演出として低音（フレーム）と中音（押印音）で構成。
  achievement: [
    { frequency: 330, duration: 0.12, gain: 0.08, type: 'sine' },
    { frequency: 480, duration: 0.14, gain: 0.09, delay: 0.06, type: 'triangle' },
  ],
  // Shared streak refresh plays this only when the successful value increases.
  streak: [
    { frequency: 280, duration: 0.07, gain: 0.05, type: 'triangle', glideTo: 420 },
    { frequency: 520, duration: 0.1, gain: 0.04, delay: 0.045, type: 'sine' },
  ],
  swipe: [
    { frequency: 780, duration: 0.065, gain: 0.055, type: 'triangle', glideTo: 1040 },
  ],
}

let audioContext: AudioContext | null = null
const lastPlayedAt = new Map<SfxName, number>()

export function isSfxEnabled(): boolean {
  if (typeof window === 'undefined') return true

  try {
    const stored = window.localStorage.getItem(KEY_SFX_ENABLED)
    return stored === null ? true : JSON.parse(stored) !== false
  } catch {
    return true
  }
}

export function setSfxEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(KEY_SFX_ENABLED, JSON.stringify(enabled))
  } catch {
    // Storage can be unavailable in privacy modes; sound remains usable for this session.
  }
}

function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return null

  try {
    audioContext = new window.AudioContext()
    return audioContext
  } catch {
    return null
  }
}

export function prepareSfx(): void {
  if (!isSfxEnabled()) return

  const context = getAudioContext()
  if (context?.state === 'suspended') {
    void context.resume().catch(() => {
      // Autoplay policy failures are non-fatal; the next user gesture can retry.
    })
  }
}

function synthesizeVoice(context: AudioContext, voice: Voice): void {
  const startAt = context.currentTime + (voice.delay ?? 0)
  const stopAt = startAt + voice.duration
  const attackAt = Math.min(startAt + 0.008, stopAt)
  const oscillator = context.createOscillator()
  const envelope = context.createGain()

  oscillator.type = voice.type ?? 'sine'
  oscillator.frequency.setValueAtTime(voice.frequency, startAt)
  if (voice.glideTo) {
    oscillator.frequency.exponentialRampToValueAtTime(voice.glideTo, stopAt)
  }

  envelope.gain.setValueAtTime(MIN_GAIN, startAt)
  envelope.gain.linearRampToValueAtTime(voice.gain, attackAt)
  envelope.gain.exponentialRampToValueAtTime(MIN_GAIN, stopAt)

  oscillator.connect(envelope)
  envelope.connect(context.destination)
  oscillator.start(startAt)
  oscillator.stop(stopAt)
}

export function playSfx(name: SfxName): void {
  if (!isSfxEnabled()) return

  const now = Date.now()
  const previous = lastPlayedAt.get(name)
  if (previous !== undefined && now - previous < THROTTLE_MS) return

  const context = getAudioContext()
  if (!context) return
  lastPlayedAt.set(name, now)

  prepareSfx()

  try {
    for (const voice of VOCABULARY[name]) {
      synthesizeVoice(context, voice)
    }
  } catch {
    // Audio feedback must never interrupt the primary user action.
  }
}
