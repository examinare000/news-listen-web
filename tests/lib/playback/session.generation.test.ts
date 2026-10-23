// application の PlaybackSession の 2 つの規則を固定する。session.test.ts（既存の観測面）では検出できない誤実装を対象にする。
// - play() の遅延 reject の世代: seek・setSpeed・2 回目の play() は世代を進めない。
// - 2 段の適用: loading・playing からの start で、購読者が見る事象・state()・audio.src と release の時点が現行と同じ。
// RED 理由（実装前）: `@/lib/playback/application/session` がまだ存在しない。
import { describe, expect, test, vi } from 'vitest'
import { createPlaybackSession } from '@/lib/playback/application/session'
import type { PlayableEpisode } from '@/lib/playback/domain/session'
import { MockAudio } from '../../helpers/mockAudio'

const playable = (id: string): PlayableEpisode => ({
  kind: 'playable',
  id,
  title: 't',
  audioUrl: `u-${id}`,
  durationSeconds: 100,
  difficulty: 'toeic_600',
  createdAt: '',
  serverPositionSeconds: 0,
})

const episode = (id: string, release: () => void) =>
  ({ id, title: 't', audioUrl: `u-${id}`, durationSeconds: 100, difficulty: 'easy', createdAt: '', serverPositionSeconds: 0, audioHandle: { release } }) as never

describe('PlaybackSession の世代と適用の順序', () => {
  test('play() の直後に seek・setSpeed・2 回目の play() を挟んでから 1 回目が NotAllowedError で reject すると errored(autoplay_blocked)', async () => {
    const audio = new MockAudio()
    const session = createPlaybackSession(audio)
    session.start(playable('a'), 0, 1)
    audio.fireLoadedMetadata(100)

    let rejectFirst!: (e: unknown) => void
    const pending = new Promise<void>((_, reject) => {
      rejectFirst = reject
    })
    vi.spyOn(audio, 'play').mockReturnValueOnce(pending)

    const first = session.play()
    session.seek(20)
    session.setSpeed(1.5)
    const second = session.play()
    expect(session.state().status).toBe('playing')

    rejectFirst(Object.assign(new Error('autoplay blocked'), { name: 'NotAllowedError' }))
    await first
    await second

    const state = session.state()
    if (state.status !== 'errored') throw new Error(`errored のはずが ${state.status}`)
    expect(state.reason).toEqual({ kind: 'autoplay_blocked' })
  })

  test('2 段の適用: loading・playing からの start で、購読者が見る事象・state()・audio.src と release の時点が現行と同じ', async () => {
    const observe = async (from: 'loading' | 'playing'): Promise<string[]> => {
      const audio = new MockAudio()
      const session = createPlaybackSession(audio)
      const log: string[] = []
      session.start(episode('1', () => log.push(`release src=${audio.src} state=${session.state().status}`)), 0, 1)
      if (from === 'playing') {
        audio.fireLoadedMetadata(100)
        await session.play()
        audio.currentTime = 12
      }
      session.subscribe((e) =>
        log.push(`${e.type}${e.type === 'stateChanged' ? `(${e.state.status})` : ''} state()=${session.state().status} src=${audio.src} paused=${audio.paused}`),
      )
      session.start(episode('2', () => {}), 5, 1.5)
      return log
    }
    expect(await observe('loading')).toEqual([
      'stateChanged(idle) state()=idle src= paused=true',
      'stateChanged(loading) state()=loading src=u-2 paused=true',
      'release src=u-2 state=loading',
    ])
    expect(await observe('playing')).toEqual([
      'stateChanged(paused) state()=paused src=u-1 paused=true',
      'stateChanged(loading) state()=loading src=u-2 paused=true',
      'release src=u-2 state=loading',
    ])
  })
})
