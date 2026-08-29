import React from 'react'
import Link from 'next/link'
import { BrandLogo } from '@/components/ui/BrandLogo'

interface LandingPageProps {
  /** ヘッダー/ヒーローの「ログイン」ボタン押下時（root gate 側で LoginModal を開く）。 */
  onLoginClick: () => void
}

interface Feature {
  index: string
  title: string
  desc: string
}

// 波形バーは中身を持たない装飾要素（aria-hidden）のため、インデックスではなく
// 固定の識別子リストをキーにして配列インデックスキー警告を避ける。
const WAVEFORM_BAR_KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']

const FEATURES: Feature[] = [
  {
    index: '01',
    title: 'パーソナライズドフィード',
    desc: '様々なサイトの海外ニュースをお好み順に',
  },
  {
    index: '02',
    title: 'ワンタップでPodcast生成',
    desc: 'Starから1〜2分で音声化',
  },
  {
    index: '03',
    title: '日本語イントロ+英語本文',
    desc: '内容を掴んでから英語を聴くリスニング設計',
  },
  {
    index: '04',
    title: '6段階の難易度',
    desc: 'TOEIC 600〜英検1級レベルまで調整可能',
  },
]

// 未接続/未ログイン時のランディングページ。root gate（app/page.tsx）が
// unknown/unauthenticated のときに即座に描画する（LP は静的なので isRestoring を待たない）。
export function LandingPage({ onLoginClick }: LandingPageProps) {
  return (
    <div className="lp-page">
      <header className="lp-header">
        <BrandLogo />

        <div className="lp-header-actions">
          <button type="button" className="btn btn-ghost" onClick={onLoginClick}>
            ログイン
          </button>
          <Link href="/signup" className="btn btn-primary">
            新規登録
          </Link>
        </div>
      </header>

      <section className="lp-hero" data-testid="lp-hero" aria-label="NewsListen の紹介">
        <div className="lp-hero-copy">
          <h1 className="lp-hero-title">今日の海外テックニュースを、聴く英語学習に。</h1>
          <p className="lp-hero-subcopy">
            AI がパーソナライズしたニュースを、日本語イントロ+英語本文のポッドキャストに自動変換。
            通勤・家事の耳時間でキャッチアップ
          </p>
          <div className="lp-hero-actions">
            <Link href="/signup" className="btn btn-primary lp-hero-cta">
              招待コードで登録
            </Link>
            <button type="button" className="btn btn-ghost lp-hero-cta" onClick={onLoginClick}>
              ログイン
            </button>
          </div>
        </div>

        <div className="lp-hero-visual" aria-hidden="true">
          <div className="lp-hero-waveform">
            {WAVEFORM_BAR_KEYS.map((key) => (
              <span key={key} className="lp-hero-waveform-bar" />
            ))}
          </div>
        </div>
      </section>

      <section className="lp-features" aria-labelledby="lp-features-heading">
        <h2 id="lp-features-heading" className="sr-only">
          NewsListen の特徴
        </h2>
        <ul className="lp-features-grid">
          {FEATURES.map((feature) => (
            <li key={feature.index} className="lp-feature-card">
              <span className="lp-feature-index" aria-hidden="true">
                {feature.index}
              </span>
              <h3 className="lp-feature-title">{feature.title}</h3>
              <p className="lp-feature-desc">{feature.desc}</p>
            </li>
          ))}
        </ul>
      </section>

      <footer className="lp-footer">
        <span>© 2026 news-listen</span>
        <div className="lp-footer-links">
          <Link href="/terms">利用規約</Link>
          <Link href="/privacy">プライバシーポリシー</Link>
        </div>
      </footer>
    </div>
  )
}
