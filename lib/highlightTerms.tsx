import React from 'react'

/** 正規表現の特殊文字をエスケープする（term は AI 生成物のため、そのまま正規表現に埋め込めない）。 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * トランスクリプト本文中の語彙用語を <mark> でハイライトする（issue: 語彙グロッサリ表示）。
 *
 * - 単語境界（\b）付き・大文字小文字区別なしで一致させる。"art" が "start" 内の部分文字列に
 *   誤って一致しないようにするため。
 * - フレーズ優先: 長い term から先にマッチさせる。"climate" と "climate change" が両方
 *   term に含まれる場合、"climate change" 全体を一つの <mark> にする。
 * - dangerouslySetInnerHTML は使わない（term は AI 生成物であり XSS 経路になり得るため）。
 *   React 要素として構築することで、常にテキストとしてエスケープされた描画になる。
 */
export function highlightTerms(text: string, terms: string[]): React.ReactNode[] {
  const validTerms = terms.filter((term) => term.length > 0)
  if (validTerms.length === 0) {
    return [text]
  }

  const sortedByLengthDesc = [...validTerms].sort((a, b) => b.length - a.length)
  // \b は単語文字（[A-Za-z0-9_]）と非単語文字の境界にしか成立しない。"$5.00" のように
  // 記号で始まる term では先頭に \b を付けると恒久的に不一致になるため、term の先頭/末尾
  // 文字が単語文字の場合のみ \b を付与する（記号側はエスケープ済みリテラル一致に任せる）。
  const alternatives = sortedByLengthDesc.map((term) => {
    const leadingBoundary = /^\w/.test(term) ? '\\b' : ''
    const trailingBoundary = /\w$/.test(term) ? '\\b' : ''
    return `${leadingBoundary}${escapeRegExp(term)}${trailingBoundary}`
  })
  const pattern = new RegExp(`(${alternatives.join('|')})`, 'gi')

  // 捕捉グループ付き正規表現での split は、一致した区切り文字列も結果配列に含める
  // （奇数インデックスが一致部分、偶数インデックスがその前後の非一致テキスト）。
  // key に index を使うのは意図的: 同一呼び出し内で生成される固定長・不変の断片列であり、
  // 並べ替えや挿入は発生しないため一覧レンダリングの index-key アンチパターンに該当しない。
  return text.split(pattern).map((part, index) =>
    index % 2 === 1 ? (
      // eslint-disable-next-line @eslint-react/no-array-index-key -- 上記コメントの通り安全
      <mark key={index}>{part}</mark>
    ) : (
      part
    )
  )
}
