'use client'

import { useEffect, useRef } from 'react'
import { usePlayback } from '@/contexts/PlaybackProvider'
import { useToast } from '@/components/ui/Toast'
import type { PlaybackView } from '@/lib/playback/application/readModels'
import type { QueueEntryInput, StartResult } from '@/lib/playback/application/ports'

const MESSAGE_MEDIA = '音声を再生できません'
const MESSAGE_UNAVAILABLE = '再生できませんでした'
const MESSAGE_OFFLINE = 'オフラインのため再生できません'

function failureMessage(failure: PlaybackView['failure']): string | null {
  if (failure === 'media') return MESSAGE_MEDIA
  if (failure === 'unavailable') return MESSAGE_UNAVAILABLE
  return null
}

function noticeMessage(result: StartResult): string | null {
  if (result.ok) return null
  return result.notice === 'offline_uncached' ? MESSAGE_OFFLINE : MESSAGE_UNAVAILABLE
}

/** failure が null から値に変わったときだけ toast を出す。描画は何もしない。 */
export function PlaybackErrorToaster(): null {
  const { playback } = usePlayback()
  const { showToast } = useToast()
  const previousRef = useRef<PlaybackView['failure']>(null)
  const { failure } = playback

  useEffect(() => {
    const message = failureMessage(failure)
    if (previousRef.current === null && message !== null) showToast(message, 'error')
    previousRef.current = failure
  }, [failure, showToast])

  return null
}

/** 開始系 4 操作と retry の結果を toast に写す。戻り値は元の結果のまま。 */
export function usePlaybackActions() {
  const pb = usePlayback()
  const { showToast } = useToast()

  const report = (result: StartResult): StartResult => {
    const message = noticeMessage(result)
    if (message !== null) showToast(message, 'error')
    return result
  }

  return {
    startEpisode: async (id: string) => report(await pb.startEpisode(id)),
    addToQueue: async (input: QueueEntryInput) => report(await pb.addToQueue(input)),
    playNext: async (input: QueueEntryInput) => report(await pb.playNext(input)),
    skipToNext: async () => report(await pb.skipToNext()),
    // retry は結果を返さないので、await の後に同期の query で失敗を読む。描画の値は await の後では古い。
    retry: async () => {
      await pb.retry()
      const view = pb.playbackView()
      const message = view.status === 'errored' ? failureMessage(view.failure) : null
      if (message !== null) showToast(message, 'error')
    },
  }
}
