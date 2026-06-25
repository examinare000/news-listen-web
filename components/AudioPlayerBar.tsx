'use client'

import React, { useEffect } from 'react'
import { useApp } from '@/contexts/AppContext'
import { useAudioPlayerContext } from '@/contexts/AudioPlayerContext'
import { PLAYBACK_SPEEDS } from '@/hooks/useAudioPlayer'
import { DifficultyBadge } from '@/components/ui/DifficultyBadge'
import { formatDuration, formatDate } from '@/lib/format'

// 波形アートのバー本数（デザイン正本 app-ui.html L1944〜1950 と同じ 5 本）
const WAVEFORM_BAR_COUNT = 5

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
    <footer aria-label="プレイヤー" className="player-bar" data-testid="audio-player-bar">
      {/* 左: トラック情報（波形アート + タイトル + バッジ/生成日） */}
      <div className="player-track">
        <div className="player-art">
          <div className="player-art-waveform">
            {Array.from({ length: WAVEFORM_BAR_COUNT }, (_, i) => (
              <div
                key={i}
                className="player-art-bar"
                // globals.css に paused 用クラスがないため、インラインの
                // animation-play-state で再生/停止に同期させる（指示書 T06）
                style={{
                  animationPlayState: player.isPlaying ? 'running' : 'paused',
                }}
              />
            ))}
          </div>
        </div>
        <div className="player-info">
          <div className="player-title">{intro50}</div>
          <div className="player-subtitle">
            <DifficultyBadge difficulty={currentPodcast.difficulty} />
            <span>{formatDate(currentPodcast.created_at)}</span>
          </div>
        </div>
      </div>

      {/* 中央: 再生コントロール + 進捗 */}
      <div className="player-controls">
        <div className="player-buttons">
          <button
            className="ctrl-btn"
            onClick={() => player.seekRelative(-15)}
            aria-label="-15秒戻る"
          >
            -15
          </button>

          <button
            className="ctrl-btn-main"
            onClick={handlePlayPause}
            aria-label={player.isPlaying ? '一時停止' : '再生'}
          >
            {player.isPlaying ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
                focusable="false"
              >
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
                focusable="false"
              >
                <polygon points="7 4 20 12 7 20" />
              </svg>
            )}
          </button>

          <button
            className="ctrl-btn"
            onClick={() => player.seekRelative(30)}
            aria-label="+30秒進む"
          >
            +30
          </button>
        </div>

        <div className="player-progress">
          <span className="progress-time">{formatDuration(player.currentTime)}</span>
          <input
            type="range"
            min={0}
            max={player.duration || currentPodcast.duration_seconds}
            value={player.currentTime}
            onChange={(e) => player.seek(Number(e.target.value))}
            aria-label="シーク"
            // a11y を守るため div 化せず range 入力のまま .progress-track 風に装飾
            className="progress-track seek-slider"
            // --seek-fill: WebKit/Firefox 両エンジンで再生済み区間を amber で塗るための
            // CSS カスタムプロパティ。擬似要素は親要素のカスタムプロパティを継承するため
            // インラインで渡す（globals.css T11 ブロックで linear-gradient / -moz-range-progress に使用）。
            // duration が 0・未定義・NaN の場合はゼロ除算を防ぎ 0% に固定し、
            // currentTime が duration を超える保存値ズレにも 0〜100 で clamp する。
            style={{
              '--seek-fill': (() => {
                const dur = player.duration
                if (!dur || !isFinite(dur) || dur <= 0) return '0%'
                const pct = Math.min(100, Math.max(0, (player.currentTime / dur) * 100))
                return `${pct}%`
              })(),
            } as React.CSSProperties}
          />
          <span className="progress-time end">
            {formatDuration(player.duration || currentPodcast.duration_seconds)}
          </span>
        </div>
      </div>

      {/* 右: 音量 + 速度（シャッフルは D19 により実装しない） */}
      <div className="player-extra">
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
          className="speed-pill"
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
      </div>
    </footer>
  )
}
