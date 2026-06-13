import { describe, test, expect, vi } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'

// next/font/local は Next.js のビルド時変換（フォントファイル読込）が前提で vitest では
// 動かないため、variable プロパティを返す形だけ模倣する（フォント変数が body に配線される
// ことを検証する目的）。渡された CSS 変数名から mock-font-* クラスを導出する。
vi.mock('next/font/local', () => ({
  default: vi.fn((opts: { variable: string }) => ({
    variable: `mock-font-${opts.variable.replace('--font-', '')}`,
  })),
}))

import RootLayout from '@/app/layout'
import { KEY_THEME } from '@/lib/config'

// RootLayout は <html> を返すため RTL の render ではネスト警告が出る。
// 既存テストに先例がないため、renderToString による HTML 文字列検証を採用する（指示書の許容手法）
function renderLayoutToString(children: React.ReactNode = <p>child-content</p>): string {
  return renderToString(<RootLayout>{children}</RootLayout>)
}

describe('RootLayout', () => {
  test('children を描画する（既存挙動の維持）', () => {
    const html = renderLayoutToString(<p>child-content</p>)
    expect(html).toContain('child-content')
  })

  test('main 要素が存在し children を内包する', () => {
    const html = renderLayoutToString(<p>inside-main</p>)
    expect(html).toMatch(/<main[^>]*>[\s\S]*inside-main[\s\S]*<\/main>/)
  })

  test('main 要素に main-content クラスが付与される（app-shell グリッドの第2列）', () => {
    const html = renderLayoutToString()
    expect(html).toMatch(/<main[^>]*class="[^"]*main-content[^"]*"/)
  })

  test('app-shell グリッドコンテナが存在する', () => {
    const html = renderLayoutToString()
    expect(html).toMatch(/class="[^"]*app-shell[^"]*"/)
  })

  test('テーマ初期化スクリプトが出力に含まれる（localStorage と data-theme を参照）', () => {
    const html = renderLayoutToString()
    // FOUC 防止のためインラインスクリプトが <head> 相当の出力に存在すること
    expect(html).toMatch(/<script>[\s\S]*localStorage\.getItem\('theme'\)[\s\S]*<\/script>/)
    expect(html).toMatch(/<script>[\s\S]*dataset\.theme[\s\S]*<\/script>/)
    expect(html).toMatch(/<script>[\s\S]*prefers-color-scheme[\s\S]*<\/script>/)
  })

  test('html 要素に lang="ja" が設定される', () => {
    const html = renderLayoutToString()
    expect(html).toMatch(/<html[^>]*lang="ja"/)
  })

  test('body にフォント CSS 変数クラスが付与される', () => {
    const html = renderLayoutToString()
    expect(html).toMatch(/<body[^>]*class="[^"]*mock-font-display[^"]*"/)
    expect(html).toMatch(/<body[^>]*class="[^"]*mock-font-body[^"]*"/)
    expect(html).toMatch(/<body[^>]*class="[^"]*mock-font-mono[^"]*"/)
  })
})

describe('lib/config — テーマ用 localStorage キー', () => {
  test('KEY_THEME はデザイン正本と同じ "theme"', () => {
    // app-ui.html の初期化スクリプトが localStorage.getItem('theme') を参照するため、
    // キー名はデザインと一致させる必要がある
    expect(KEY_THEME).toBe('theme')
  })
})
