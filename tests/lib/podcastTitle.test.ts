import { describe, test, expect } from 'vitest'
import { podcastTitle } from '@/lib/podcastTitle'

// podcastTitle(p, maxLen) は Podcast タイトル表示の共通フォールバックロジック。
// title フィールドが追加されたが既存データや未デプロイ環境では空/欠落するため、
// title があればそれを、なければ japanese_intro_text の先頭 maxLen 文字を返す。

const LONG_INTRO =
  'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん1234567890'

describe('podcastTitle — title フィールドあり', () => {
  test('Given title is non-empty, returns title regardless of maxLen', () => {
    const p = { title: 'AIが選ぶ今日のニュース', japanese_intro_text: LONG_INTRO }
    expect(podcastTitle(p, 10)).toBe('AIが選ぶ今日のニュース')
  })

  test('Given title is non-empty and longer than maxLen, still returns full title (title は切り詰めない)', () => {
    const p = { title: 'とても長いタイトルです', japanese_intro_text: LONG_INTRO }
    expect(podcastTitle(p, 3)).toBe('とても長いタイトルです')
  })
})

describe('podcastTitle — title フィールドなし（フォールバック）', () => {
  test('Given title is undefined, returns japanese_intro_text sliced to maxLen', () => {
    const p = { title: undefined, japanese_intro_text: LONG_INTRO }
    expect(podcastTitle(p, 5)).toBe('あいうえお')
  })

  test('Given title is empty string, falls back to japanese_intro_text slice', () => {
    const p = { title: '', japanese_intro_text: LONG_INTRO }
    expect(podcastTitle(p, 5)).toBe('あいうえお')
  })

  test('Given title is whitespace-only string, falls back to japanese_intro_text slice', () => {
    const p = { title: '   ', japanese_intro_text: LONG_INTRO }
    expect(podcastTitle(p, 5)).toBe('あいうえお')
  })
})

describe('podcastTitle — maxLen 境界', () => {
  test('Given japanese_intro_text shorter than maxLen, returns full text', () => {
    const p = { japanese_intro_text: 'abc' }
    expect(podcastTitle(p, 10)).toBe('abc')
  })

  test('Given japanese_intro_text exactly maxLen chars, returns full text', () => {
    const text = 'あ'.repeat(50)
    const p = { japanese_intro_text: text }
    expect(podcastTitle(p, 50)).toBe(text)
  })

  test('Given japanese_intro_text longer than maxLen, truncates to maxLen', () => {
    const p = { japanese_intro_text: 'あ'.repeat(60) }
    expect(podcastTitle(p, 50)).toBe('あ'.repeat(50))
  })

  test('Given maxLen=0, returns empty string when no title', () => {
    const p = { japanese_intro_text: LONG_INTRO }
    expect(podcastTitle(p, 0)).toBe('')
  })

  test('Given maxLen=40 (queue item default), slices to 40 chars', () => {
    const p = { japanese_intro_text: LONG_INTRO }
    expect(podcastTitle(p, 40)).toBe(LONG_INTRO.slice(0, 40))
  })

  test('Given negative maxLen, returns empty string (clamp to 0)', () => {
    // 負値を渡すと String.slice が末尾から数えるため、Math.max(0, n) でガードする
    const p = { japanese_intro_text: LONG_INTRO }
    expect(podcastTitle(p, -1)).toBe('')
    expect(podcastTitle(p, -100)).toBe('')
  })
})
