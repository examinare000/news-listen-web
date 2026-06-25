'use client'

import React, { useState, useEffect } from 'react'
import { createApiClient, ApiError } from '@/lib/api'
import type { FeaturedSource } from '@/types/index'
import { useFocusTrap } from '@/hooks/useFocusTrap'

interface OnboardingSourcesModalProps {
  baseUrl: string
  apiKey: string
  /** 完了/スキップ後（completeOnboarding 済み）に呼ばれる。呼び出し側で /feed へ遷移する。 */
  onDone: () => void
}

/**
 * 初回ログイン時の「おすすめサイト追加」ステップ。
 *
 * API 設定完了後、まだオンボーディング未完了のユーザーにのみ表示される（出し分けは app/page.tsx）。
 * おすすめサイトをワンクリックで即購読でき、「完了」/「スキップ」で completeOnboarding を呼ぶ。
 */
export function OnboardingSourcesModal({ baseUrl, apiKey, onDone }: OnboardingSourcesModalProps) {
  const client = createApiClient({ baseUrl, apiKey })

  const [featured, setFeatured] = useState<FeaturedSource[]>([])
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())
  const [subscribingId, setSubscribingId] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)
  const dialogRef = useFocusTrap<HTMLDivElement>()

  useEffect(() => {
    let cancelled = false
    client
      .getFeaturedSources()
      .then((data) => {
        if (!cancelled) setFeatured(data.sites)
      })
      .catch(() => {
        if (!cancelled) setFeatured([])
      })
    return () => {
      cancelled = true
    }
    // baseUrl/apiKey が変わらない限り 1 回だけ取得する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, apiKey])

  async function handleSubscribe(site: FeaturedSource) {
    setSubscribingId(site.id)
    try {
      await client.addSource(site.name, site.url)
      setAddedIds((prev) => new Set(prev).add(site.id))
    } catch (err) {
      // 既に登録済み（409）も「追加済み」として扱う
      if (err instanceof ApiError && err.status === 409) {
        setAddedIds((prev) => new Set(prev).add(site.id))
      }
    } finally {
      setSubscribingId(null)
    }
  }

  async function handleFinish() {
    setFinishing(true)
    try {
      await client.completeOnboarding()
    } catch {
      // 完了フラグの保存に失敗してもフィードへは進ませる（次回再表示されるだけ）
    } finally {
      onDone()
    }
  }

  return (
    <div className="modal-backdrop">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="onboarding-title" className="modal-box">
        <h2 id="onboarding-title" className="modal-title">
          おすすめサイトを購読
        </h2>
        <p className="modal-desc">
          気になるサイトを選んで購読しましょう。あとから購読管理でいつでも追加・削除できます。
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '12px 0' }}>
          {featured.map((site) => {
            const added = addedIds.has(site.id)
            return (
              <div
                key={site.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '8px 12px',
                  background: 'var(--bg-base)',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  {site.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- 任意ホストのサムネイルのため next/image の最適化対象外
                    <img
                      src={site.thumbnail_url}
                      alt=""
                      width={24}
                      height={24}
                      style={{ borderRadius: 4, flexShrink: 0, objectFit: 'cover' }}
                    />
                  ) : (
                    <span aria-hidden="true" style={{ flexShrink: 0 }}>📡</span>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{site.name}</div>
                    {site.description && (
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--text-muted)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {site.description}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  className={added ? 'btn btn-ghost' : 'btn btn-primary'}
                  style={{ padding: '4px 12px', fontSize: 12, flexShrink: 0 }}
                  onClick={() => handleSubscribe(site)}
                  disabled={added || subscribingId === site.id}
                  aria-label={`${site.name} を購読`}
                >
                  {added ? '購読済み' : subscribingId === site.id ? '購読中…' : '購読'}
                </button>
              </div>
            )
          })}
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={handleFinish} disabled={finishing}>
            スキップ
          </button>
          <button className="btn btn-primary" onClick={handleFinish} disabled={finishing}>
            完了
          </button>
        </div>
      </div>
    </div>
  )
}
