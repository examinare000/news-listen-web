'use client'

import React, { useState } from 'react'
import { usePlayback } from '@/contexts/PlaybackProvider'
import { usePlaybackActions } from '@/components/PlaybackToasts'
import { DifficultyBadge } from '@/components/ui/DifficultyBadge'
import { ResumeChoiceDialog } from '@/components/ui/ResumeChoiceDialog'
import { formatDuration, formatDate } from '@/lib/presentation/format'
import { PLAYBACK_SPEEDS } from '@/lib/playback/domain/session'
import type { PlaybackSpeed } from '@/lib/playback/domain/session'

// 波形アートのバー本数（デザイン正本 app-ui.html L1944〜1950 と同じ 5 本）
const WAVEFORM_BAR_COUNT = 5

const isPlaybackSpeed = (value: number): value is PlaybackSpeed => PLAYBACK_SPEEDS.some((speed) => speed === value)

export function AudioPlayerBar() {
  const pb = usePlayback()
  const actions = usePlaybackActions()
  const { playback } = pb
  const nowPlaying = pb.nowPlaying()
  const queue = pb.queueView()
  // 再生待ちキューパネルの開閉（issue #81）。
  const [showQueue, setShowQueue] = useState(false)
  // 再開時の確認（ADR-109 決定 11）。尋ねるかの判定は coordinator が持ち、ここは表示だけを持つ。
  const [confirm, setConfirm] = useState<{
    readonly episodeId: string
    readonly remoteSeconds: number
    readonly localSeconds: number
  } | null>(null)

  // 確認の対象が一時停止でなくなった・別の episode になった・bar が消えたら閉じる（shared-dec-44）。
  // effect ではなく render の中で判定する。早期 return より前に置くので、nowPlaying が null の間も判定が動く。
  if (
    confirm !== null &&
    (playback.status !== 'paused' || nowPlaying === null || nowPlaying.episodeId !== confirm.episodeId)
  ) {
    setConfirm(null)
  }

  if (nowPlaying === null) return null

  const isPlaying = playback.primaryAction === 'pause'
  const duration = playback.duration || (nowPlaying.durationSeconds ?? 0)

  const handlePrimary = (): void => {
    switch (playback.primaryAction) {
      case 'pause':
        pb.pause()
        return
      case 'play':
        {
          const request = pb.requestResume()
          if (request.kind === 'choose') {
            setConfirm({
              episodeId: nowPlaying.episodeId,
              remoteSeconds: request.remoteSeconds,
              localSeconds: request.localSeconds,
            })
          }
        }
        return
      case 'retry':
        void actions.retry()
        return
      case 'replay':
        void actions.startEpisode(nowPlaying.episodeId)
        return
      case 'none':
        return
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
                  animationPlayState: playback.status === 'playing' ? 'running' : 'paused',
                }}
              />
            ))}
          </div>
        </div>
        <div className="player-info">
          <div className="player-title">{nowPlaying.title}</div>
          <div className="player-subtitle">
            {nowPlaying.difficulty !== null && <DifficultyBadge difficulty={nowPlaying.difficulty} />}
            {nowPlaying.createdAt !== null && <span>{formatDate(nowPlaying.createdAt)}</span>}
          </div>
        </div>
      </div>

      {/* 中央: 再生コントロール + 進捗 */}
      <div className="player-controls">
        <div className="player-buttons">
          <button
            className="ctrl-btn"
            onClick={() => pb.seekRelative(-15)}
            aria-label="-15秒戻る"
          >
            -15
          </button>

          <button
            className="ctrl-btn-main"
            onClick={handlePrimary}
            aria-label={isPlaying ? '一時停止' : '再生'}
          >
            {isPlaying ? (
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
            onClick={() => pb.seekRelative(30)}
            aria-label="+30秒進む"
          >
            +30
          </button>

          {/* 次へ（連続再生・issue #81）。待機列があるときのみ表示。 */}
          {queue.canSkipNext && (
            <button
              className="ctrl-btn"
              onClick={() => void actions.skipToNext()}
              aria-label="次のエピソードへ"
              title="次へ"
            >
              次へ
            </button>
          )}
        </div>

        <div className="player-progress">
          <span className="progress-time">{formatDuration(playback.position)}</span>
          <input
            type="range"
            min={0}
            max={duration}
            value={playback.position}
            onChange={(e) => pb.seek(Number(e.target.value))}
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
                const dur = duration
                if (!dur || !isFinite(dur) || dur <= 0) return '0%'
                const pct = Math.min(100, Math.max(0, (playback.position / dur) * 100))
                return `${pct}%`
              })(),
            } as React.CSSProperties}
          />
          <span className="progress-time end">
            {formatDuration(duration)}
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
          ☰{queue.upNext.length > 0 ? ` ${queue.upNext.length}` : ''}
        </button>
        {showQueue && (
          <div className="queue-panel" role="region" aria-label="プレイリスト">
            {queue.upNext.length === 0 ? (
              <p className="queue-empty">再生待ちはありません</p>
            ) : (
              <ol className="queue-list">
                {queue.upNext.map((p, i) => (
                  <li key={p.id} className="queue-item">
                    <span className="queue-item-title">{p.title}</span>
                    <span className="queue-item-actions">
                      <button
                        type="button"
                        className="ctrl-btn"
                        onClick={() => pb.reorder(i, i - 1)}
                        disabled={i === 0}
                        aria-label="上へ"
                      >
                        ↑
                      </button>
                      {/* 削除前オフセット意味論では「1つ下へ」= 次要素の直後 = i+2（spec §2.7） */}
                      <button
                        type="button"
                        className="ctrl-btn"
                        onClick={() => pb.reorder(i, i + 2)}
                        disabled={i === queue.upNext.length - 1}
                        aria-label="下へ"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="ctrl-btn"
                        onClick={() => pb.removeFromQueue(p.id)}
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
          value={Math.round(pb.volume * 100)}
          onChange={(e) => pb.setVolume(Number(e.target.value) / 100)}
          aria-label="音量"
          className="volume-slider"
        />

        <select
          aria-label="速度"
          className="speed-pill"
          value={playback.speed}
          onChange={(e) => {
            // この回の速度だけを変える。既定速度（設定）は書き換えない。
            const speed = Number(e.target.value)
            if (isPlaybackSpeed(speed)) pb.setSpeed(speed)
          }}
        >
          {PLAYBACK_SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
      </div>
      <ResumeChoiceDialog
        isOpen={confirm !== null}
        remoteSeconds={confirm?.remoteSeconds ?? 0}
        localSeconds={confirm?.localSeconds ?? 0}
        onChooseRemote={() => {
          pb.chooseResume('remote')
          setConfirm(null)
        }}
        onChooseLocal={() => {
          pb.chooseResume('local')
          setConfirm(null)
        }}
        onClose={() => setConfirm(null)}
      />
    </footer>
  )
}
