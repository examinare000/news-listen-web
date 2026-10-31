import { beforeEach, describe, expect, test, vi } from 'vitest'

type SfxName = 'correct' | 'incorrect' | 'achievement' | 'streak' | 'swipe'

interface SfxModule {
  configureSfx: (isEnabled: () => boolean) => void
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
})

describe('SFX enablement injection', () => {
  test('configureSfx を一度も呼んでいない間は有効とみなして鳴らす', async () => {
    const sfx = await loadSfx()

    sfx.playSfx('correct')

    expect(AudioContextMock.instances).toHaveLength(1)
    expect(AudioContextMock.instances[0].createOscillator).toHaveBeenCalled()
  })

  test('有効かどうかの判定で localStorage を読み書きしない', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const sfx = await loadSfx()

    sfx.configureSfx(() => true)
    sfx.prepareSfx()
    sfx.playSfx('correct')

    expect(getItem).not.toHaveBeenCalled()
    expect(setItem).not.toHaveBeenCalled()
    getItem.mockRestore()
    setItem.mockRestore()
  })

  test('最後に設定した判定関数が有効になる', async () => {
    const sfx = await loadSfx()

    sfx.configureSfx(() => false)
    sfx.configureSfx(() => true)
    sfx.playSfx('correct')

    expect(AudioContextMock.instances).toHaveLength(1)
  })

  test('localStorage を使っていた旧アクセサを export しない', async () => {
    const sfx = (await loadSfx()) as unknown as Record<string, unknown>

    expect(sfx.isSfxEnabled).toBeUndefined()
    expect(sfx.setSfxEnabled).toBeUndefined()
    expect(typeof sfx.configureSfx).toBe('function')
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
    sfx.configureSfx(() => false)
    sfx.playSfx('correct')
    sfx.prepareSfx()
    expect(AudioContextMock.instances).toHaveLength(0)

    sfx.configureSfx(() => true)
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
