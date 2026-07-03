'use client'

import React, { useEffect, useState } from 'react'
import { useApp } from '@/contexts/AppContext'
import { useAudioPlayerContext } from '@/contexts/AudioPlayerContext'
import { PLAYBACK_SPEEDS } from '@/hooks/useAudioPlayer'
import { DifficultyBadge } from '@/components/ui/DifficultyBadge'
import { formatDuration, formatDate } from '@/lib/format'
import { podcastTitle } from '@/lib/podcastTitle'

// 波形アートのバー本数（デザイン正本 app-ui.html L1944〜1950 と同じ 5 本）
const WAVEFORM_BAR_COUNT = 5

export function AudioPlayerBar() {
  const { state, dispatch } = useApp()
  const { currentPodcast } = state

  const player = useAudioPlayerContext()
  // 再生待ちキューパネルの開閉（issue #81）。
  const [showQueue, setShowQueue] = useState(false)

  // Sync AppContext.playbackSpeed → audio.playbackRate whenever the speed changes
  // (includes initial mount with restored default speed and settings-page updates).
  useEffect(() => {
    player.setSpeed(state.playbackSpeed)
  }, [state.playbackSpeed]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!currentPodcast) return null

  const trackTitle = podcastTitle(currentPodcast, 50)

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
          <div className="player-title">{trackTitle}</div>
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

          {/* 次へ（連続再生・issue #81）。待機列があるときのみ表示。 */}
          {player.upNext.length > 0 && (
            <button
              className="ctrl-btn"
              onClick={() => void player.skipToNext()}
              aria-label="次のエピソードへ"
              title="次へ"
            >
              次へ
            </button>
          )}
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

      {/* 右: 再生待ち + 音量 + 速度（シャッフルは D19 により実装しない） */}
      <div className="player-extra">
        {/* 再生待ちキュー（issue #81）: 確認・並べ替え・削除。 */}
        <button
          type="button"
          className="ctrl-btn"
          onClick={() => setShowQueue((v) => !v)}
          aria-label="プレイリスト"
          aria-expanded={showQueue}
          title="プレイリスト"
        >
          ☰{player.upNext.length > 0 ? ` ${player.upNext.length}` : ''}
        </button>
        {showQueue && (
          <div className="queue-panel" role="region" aria-label="プレイリスト">
            {player.upNext.length === 0 ? (
              <p className="queue-empty">再生待ちはありません</p>
            ) : (
              <ol className="queue-list">
                {player.upNext.map((p, i) => (
                  <li key={p.id} className="queue-item">
                    <span className="queue-item-title">{podcastTitle(p, 40)}</span>
                    <span className="queue-item-actions">
                      <button
                        type="button"
                        className="ctrl-btn"
                        onClick={() => player.reorderQueue(i, i - 1)}
                        disabled={i === 0}
                        aria-label="上へ"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="ctrl-btn"
                        onClick={() => player.reorderQueue(i, i + 1)}
                        disabled={i === player.upNext.length - 1}
                        aria-label="下へ"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="ctrl-btn"
                        onClick={() => player.removeFromQueue(p.id)}
                        aria-label="キューから削除"
                      >
                        ✕
                      </button>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

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
