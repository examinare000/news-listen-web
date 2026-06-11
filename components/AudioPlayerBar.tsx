'use client'

import React, { useEffect } from 'react'
import { useApp } from '@/contexts/AppContext'
import { useAudioPlayerContext } from '@/contexts/AudioPlayerContext'
import { PLAYBACK_SPEEDS } from '@/hooks/useAudioPlayer'
import { DifficultyBadge } from '@/components/ui/DifficultyBadge'
import { formatDuration } from '@/lib/format'

export function AudioPlayerBar() {
  const { state, dispatch } = useApp()
  const { currentPodcast } = state

  const player = useAudioPlayerContext()

  // Sync AppContext.playbackSpeed → audio.playbackRate whenever the speed changes
  // (includes initial mount with restored default speed and settings-page updates).
  useEffect(() => {
    player.setSpeed(state.playbackSpeed)
  }, [state.playbackSpeed]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!currentPodcast) return null

  const intro50 = currentPodcast.japanese_intro_text.slice(0, 50)

  async function handlePlayPause() {
    if (player.isPlaying) {
      player.pause()
    } else {
      // Resume from current position — the Audio element retains src and
      // currentTime across pause, so re-loading would destructively reset
      // the playhead to 0. Just call play().
      await player.play()
    }
  }

  return (
    <section aria-label="プレイヤー" className="audio-player-bar">
      <div className="player-info">
        <span>{intro50}</span>
        <DifficultyBadge difficulty={currentPodcast.difficulty} />
        <span>{formatDuration(currentPodcast.duration_seconds)}</span>
      </div>

      <div className="player-controls">
        <button
          onClick={() => player.seekRelative(-15)}
          aria-label="-15秒戻る"
        >
          -15
        </button>

        <button
          onClick={handlePlayPause}
          aria-label={player.isPlaying ? '一時停止' : '再生'}
        >
          {player.isPlaying ? '一時停止' : '再生'}
        </button>

        <button
          onClick={() => player.seekRelative(30)}
          aria-label="+30秒進む"
        >
          +30
        </button>
      </div>

      <input
        type="range"
        min={0}
        max={player.duration || currentPodcast.duration_seconds}
        value={player.currentTime}
        onChange={(e) => player.seek(Number(e.target.value))}
        aria-label="シーク"
        className="seek-slider"
      />

      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(player.volume * 100)}
        onChange={(e) => player.setVolume(Number(e.target.value) / 100)}
        aria-label="音量"
        className="volume-slider"
      />

      <select
        aria-label="速度"
        value={state.playbackSpeed}
        onChange={(e) => {
          // Dispatch to AppContext; the useEffect above syncs state.playbackSpeed → player.setSpeed()
          dispatch({ type: 'SET_SPEED', speed: Number(e.target.value) })
        }}
      >
        {PLAYBACK_SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}x
          </option>
        ))}
      </select>
    </section>
  )
}
