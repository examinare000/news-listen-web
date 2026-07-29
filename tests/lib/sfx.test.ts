import { beforeEach, describe, expect, test, vi } from 'vitest'

type SfxName = 'correct' | 'incorrect' | 'achievement' | 'streak' | 'swipe'

interface SfxModule {
  isSfxEnabled: () => boolean
  setSfxEnabled: (enabled: boolean) => void
  prepareSfx: () => void
  playSfx: (name: SfxName) => void
}

class AudioParamMock {
  setValueAtTime = vi.fn()
  exponentialRampToValueAtTime = vi.fn()
  linearRampToValueAtTime = vi.fn()
}

class OscillatorNodeMock {
  frequency = new AudioParamMock()
  type: OscillatorType = 'sine'
  connect = vi.fn()
  start = vi.fn()
  stop = vi.fn()
}

class GainNodeMock {
  gain = new AudioParamMock()
  connect = vi.fn()
}

class AudioContextMock {
  static instances: AudioContextMock[] = []

  currentTime = 1
  destination = {}
  state: AudioContextState = 'running'
  createOscillator = vi.fn(() => new OscillatorNodeMock())
  createGain = vi.fn(() => new GainNodeMock())
  resume = vi.fn().mockResolvedValue(undefined)

  constructor() {
    AudioContextMock.instances.push(this)
  }
}

async function loadSfx(): Promise<SfxModule> {
  return import('@/lib/sfx')
}

beforeEach(() => {
  vi.resetModules()
  vi.useRealTimers()
  vi.stubGlobal('AudioContext', AudioContextMock)
  AudioContextMock.instances = []
  localStorage.clear()
})

describe('SFX preference', () => {
  test('defaults to enabled and persists an explicit local override', async () => {
    const sfx = await loadSfx()

    expect(sfx.isSfxEnabled()).toBe(true)

    sfx.setSfxEnabled(false)
    expect(localStorage.getItem('sfx_enabled')).toBe('false')
    expect(sfx.isSfxEnabled()).toBe(false)
  })
})

describe('playSfx', () => {
  test('prepares one silent AudioContext during the initiating user gesture', async () => {
    const sfx = await loadSfx()

    sfx.prepareSfx()
    sfx.prepareSfx()

    expect(AudioContextMock.instances).toHaveLength(1)
    expect(AudioContextMock.instances[0].createOscillator).not.toHaveBeenCalled()
  })

  test('creates AudioContext lazily and does not create it while disabled', async () => {
    const sfx = await loadSfx()

    expect(AudioContextMock.instances).toHaveLength(0)
    sfx.setSfxEnabled(false)
    sfx.playSfx('correct')
    expect(AudioContextMock.instances).toHaveLength(0)

    sfx.setSfxEnabled(true)
    sfx.playSfx('correct')
    expect(AudioContextMock.instances).toHaveLength(1)
  })

  test('throttles the same vocabulary for 300ms without throttling another vocabulary', async () => {
    vi.setSystemTime(new Date('2026-07-29T00:00:00Z'))
    const sfx = await loadSfx()

    sfx.playSfx('correct')
    const context = AudioContextMock.instances[0]
    const firstVoiceCount = context.createOscillator.mock.calls.length

    vi.setSystemTime(new Date('2026-07-29T00:00:00.200Z'))
    sfx.playSfx('correct')
    expect(context.createOscillator).toHaveBeenCalledTimes(firstVoiceCount)

    sfx.playSfx('incorrect')
    expect(context.createOscillator.mock.calls.length).toBeGreaterThan(firstVoiceCount)

    const secondVoiceCount = context.createOscillator.mock.calls.length
    vi.setSystemTime(new Date('2026-07-29T00:00:00.301Z'))
    sfx.playSfx('correct')
    expect(context.createOscillator.mock.calls.length).toBeGreaterThan(secondVoiceCount)
  })

  test.each<SfxName>(['correct', 'incorrect', 'achievement', 'streak', 'swipe'])(
    'synthesizes %s without throwing',
    async (name) => {
      const sfx = await loadSfx()

      expect(() => sfx.playSfx(name)).not.toThrow()
      expect(AudioContextMock.instances[0].createOscillator).toHaveBeenCalled()
      expect(AudioContextMock.instances[0].createGain).toHaveBeenCalled()
    },
  )

  test('fails silently when WebAudio is unavailable', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const sfx = await loadSfx()

    expect(() => sfx.playSfx('swipe')).not.toThrow()
  })
})
